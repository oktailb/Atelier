/**
 * Atelier by GallusTech - Phase E (Lot 2): Universal WebOS Agent Tool Registry (`AgentToolRegistry.js`)
 *
 * Central client-side tool & live context bus (`window.sys.agentTools`) bridging:
 *   - Core OS window & app management (`WindowManager`, `AppManager`)
 *   - User-scoped VFS operations (`SyscallClient` / `window.sys.api`, inheriting exact session ACLs & quotas)
 *   - Extensible providers for native apps/games (`WebOSApp`, Lot 4) and external WASM apps (`craft-web-api`, Lot 3)
 *
 * Security invariants:
 *   - NEVER exposes admin/auth/key-management/permanent-delete actions as tools.
 *   - Enforces `disabled_apps` per-user opt-out list on every app-scoped tool and launch call.
 *   - Classifies every tool by risk tier (`read` | `mutate_app` | `mutate_fs` | `destructive`)
 *     so the Copilot enforces Human-in-the-Loop confirmation according to autonomy level.
 */
(function (window) {
  'use strict';

  const FORBIDDEN_APP_IDS = new Set(['taskbar']);

  class AgentToolRegistry {
    constructor() {
      this.tools = new Map();
      this.dynamicProviders = new Set();
      this._registerCoreOsTools();
      this._registerCoreVfsTools();
      this._registerNativeAppsProvider();
    }

    /**
     * Registers a static tool definition.
     * @param {Object} def { name, description, parameters, risk, appId?, handler(args, ctx) }
     */
    registerTool(def) {
      if (!def || !def.name || typeof def.handler !== 'function') return;
      const risk = ['read', 'mutate_app', 'mutate_fs', 'destructive'].includes(def.risk)
        ? def.risk
        : 'mutate_fs';
      this.tools.set(String(def.name), {
        name: String(def.name),
        description: String(def.description || ''),
        parameters: def.parameters || { type: 'object', properties: {} },
        risk,
        appId: def.appId || null,
        handler: def.handler
      });
    }

    unregisterTool(name) {
      this.tools.delete(String(name));
    }

    /**
     * Registers a dynamic tool/context provider (used by Lot 3 `craft-web-api` & Lot 4 `WebOSApp`).
     * Provider shape: `{ id, getTools(ctx), getContext(ctx) }`.
     */
    registerProvider(provider) {
      if (provider && typeof provider.getTools === 'function') {
        this.dynamicProviders.add(provider);
      }
    }

    unregisterProvider(provider) {
      this.dynamicProviders.delete(provider);
    }

    /**
     * Evaluates whether executing `tool` requires explicit user confirmation (Human-in-the-Loop).
     */
    requiresConfirmation(tool, autonomyLevel = 'assisted', activeAppId = null, toolArgs = null) {
      const risk = tool ? tool.risk : 'destructive';
      if (risk === 'read') return false;
      if (risk === 'destructive' || risk === 'mutate_fs') return true;
      // risk === 'mutate_app'
      const targetAppId = (tool && tool.appId) || (toolArgs && typeof toolArgs === 'object' && toolArgs.app_id) || null;
      if (autonomyLevel === 'autonomous_app') {
        if (!targetAppId || !activeAppId || targetAppId === activeAppId) {
          return false;
        }
        return true;
      }
      return true;
    }

    /**
     * Collects live desktop, active window, Explorer folder, and registered app context.
     */
    collectContext(disabledApps = []) {
      const disabled = new Set(Array.isArray(disabledApps) ? disabledApps : []);
      const wm = window.WindowManager;
      const windows = [];
      let activeWindow = null;

      if (wm && wm.windows) {
        const list = (wm.windows instanceof Map) ? Array.from(wm.windows.values()) : Array.from(wm.windows);
        for (const w of list) {
          if (!w || !w.id) continue;
          const appId = w.appId || w.id;
          if (disabled.has(appId)) continue;
          const entry = {
            window_id: w.id,
            app_id: appId,
            title: w.title || appId,
            state: w.state || 'normal',
            is_active: wm.activeWindowId === w.id
          };
          windows.push(entry);
          if (entry.is_active) activeWindow = entry;
        }
      }

      let explorerDir = '';
      let selectedPaths = [];
      if (!disabled.has('explorer') && window.explorerApp && window.explorerApp.state) {
        explorerDir = String(window.explorerApp.state.currentPath || '');
        if (window.explorerApp.state.selectedItems && typeof window.explorerApp.state.selectedItems.forEach === 'function') {
          window.explorerApp.state.selectedItems.forEach(p => selectedPaths.push(String(p)));
        }
      }

      const appContexts = {};
      this.dynamicProviders.forEach(prov => {
        if (typeof prov.getContext !== 'function') return;
        try {
          const c = prov.getContext({ disabledApps: disabled, activeWindow, windows });
          if (c && typeof c === 'object') {
            Object.assign(appContexts, c);
          }
        } catch (e) { }
      });

      return {
        user: window.SG_CURRENT_USER ? {
          username: window.SG_CURRENT_USER.username,
          display_name: window.SG_CURRENT_USER.display_name,
          home_dir: window.SG_CURRENT_USER.home_dir
        } : null,
        active_window: activeWindow,
        open_windows: windows,
        explorer_dir: explorerDir,
        selected_paths: selectedPaths.slice(0, 20),
        app_contexts: appContexts
      };
    }

    /**
     * Returns all tools permitted under the current autonomy level, vision toggle, and user `disabled_apps`.
     */
    getAvailableTools(autonomyLevel = 'assisted', disabledApps = [], opts = {}) {
      const disabled = new Set(Array.isArray(disabledApps) ? disabledApps : []);
      const allowVision = !(opts && opts.allowVision === false);
      const all = [];

      for (const tool of this.tools.values()) {
        if (tool.appId && disabled.has(tool.appId)) continue;
        if (autonomyLevel === 'read_only' && tool.risk !== 'read') continue;
        all.push(tool);
      }

      const ctx = this.collectContext(Array.from(disabled));
      this.dynamicProviders.forEach(prov => {
        try {
          const list = prov.getTools({ autonomyLevel, disabledApps: disabled, context: ctx, allowVision }) || [];
          for (const t of list) {
            if (!t || !t.name || typeof t.handler !== 'function') continue;
            if (t.appId && disabled.has(t.appId)) continue;
            if (!allowVision && t.name === 'craft_screenshot') continue;
            if (autonomyLevel === 'read_only' && t.risk !== 'read') continue;
            all.push(t);
          }
        } catch (e) { }
      });

      return all;
    }

    /**
     * Converts permitted tools to the normalized JSON Schema format expected by `ai_chat`.
     */
    getToolSchemas(autonomyLevel = 'assisted', disabledApps = [], opts = {}) {
      return this.getAvailableTools(autonomyLevel, disabledApps, opts).map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }));
    }

    /**
     * Looks up a permitted tool by name and executes it with strict policy checks.
     */
    findTool(name, autonomyLevel = 'assisted', disabledApps = [], opts = {}) {
      const list = this.getAvailableTools(autonomyLevel, disabledApps, opts);
      return list.find(t => t.name === name) || null;
    }

    async executeTool(name, args = {}, opts = {}) {
      const autonomyLevel = opts.autonomyLevel || 'assisted';
      const disabledApps = Array.isArray(opts.disabledApps) ? opts.disabledApps : [];
      const tool = this.findTool(name, autonomyLevel, disabledApps, opts);
      if (!tool) {
        return { success: false, error: `Tool '${name}' is unavailable or disallowed in mode '${autonomyLevel}'.` };
      }

      try {
        const res = await tool.handler(args && typeof args === 'object' ? args : {}, {
          autonomyLevel,
          disabledApps: new Set(disabledApps),
          api: window.sys && window.sys.api ? window.sys.api : null
        });
        return res && typeof res === 'object' ? res : { success: true, result: res };
      } catch (err) {
        return { success: false, error: err && err.message ? err.message : String(err) };
      }
    }

    // -------------------------------------------------------------------------
    // BUILT-IN OS & WINDOW MANAGER TOOLS
    // -------------------------------------------------------------------------
    _registerCoreOsTools() {
      this.registerTool({
        name: 'os_list_windows',
        description: 'Lists currently open windows on the Atelier desktop (ID, app ID, title, active/minimized state).',
        risk: 'read',
        parameters: { type: 'object', properties: {} },
        handler: (_args, ctx) => {
          const live = this.collectContext(Array.from(ctx.disabledApps));
          return { success: true, active_window: live.active_window, windows: live.open_windows };
        }
      });

      this.registerTool({
        name: 'os_focus_window',
        description: 'Brings an open window to the front (restoring it if minimized) by window_id or app_id.',
        risk: 'mutate_app',
        parameters: {
          type: 'object',
          properties: {
            window_id: { type: 'string', description: 'Exact WindowManager window ID' },
            app_id: { type: 'string', description: 'Application ID to focus if window_id is omitted' }
          }
        },
        handler: (args, ctx) => {
          const wm = window.WindowManager;
          if (!wm || !wm.windows) return { success: false, error: 'WindowManager unavailable.' };
          const list = (wm.windows instanceof Map) ? Array.from(wm.windows.values()) : Array.from(wm.windows);
          const target = list.find(w =>
            (args.window_id && w.id === args.window_id) ||
            (args.app_id && (w.appId === args.app_id || w.id === args.app_id))
          );
          if (!target) return { success: false, error: 'Matching window not found.' };
          if (ctx.disabledApps.has(target.appId || target.id)) {
            return { success: false, error: 'This application is excluded from AI Agent access.' };
          }
          if (target.state === 'minimized' && typeof wm.restoreWindow === 'function') {
            wm.restoreWindow(target.id);
          } else if (typeof wm.focusWindow === 'function') {
            wm.focusWindow(target.id);
          }
          return { success: true, focused: { window_id: target.id, title: target.title } };
        }
      });

      this.registerTool({
        name: 'os_close_window',
        description: 'Closes an open desktop window cleanly (respecting unsaved changes prompts).',
        risk: 'mutate_app',
        parameters: {
          type: 'object',
          properties: {
            window_id: { type: 'string', description: 'Exact WindowManager window ID to close' }
          },
          required: ['window_id']
        },
        handler: async (args, ctx) => {
          const wm = window.WindowManager;
          if (!wm || typeof wm.closeWindow !== 'function') return { success: false, error: 'WindowManager unavailable.' };
          const win = wm.windows && typeof wm.windows.get === 'function' ? wm.windows.get(args.window_id) : null;
          if (!win) return { success: false, error: 'Window not found.' };
          if (ctx.disabledApps.has(win.appId || win.id)) {
            return { success: false, error: 'This application is excluded from AI Agent access.' };
          }
          const closed = await wm.closeWindow(args.window_id);
          return { success: Boolean(closed !== false), window_id: args.window_id };
        }
      });

      this.registerTool({
        name: 'os_list_apps',
        description: 'Lists installed applications available on Atelier (native apps, games, and external WASM apps) with supported file extensions.',
        risk: 'read',
        parameters: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Optional category filter (e.g. games, media, productivity, system)' }
          }
        },
        handler: (args, ctx) => {
          const discovered = window.SG_DISCOVERED_APPS || {};
          const catFilter = String(args.category || '').toLowerCase();
          const apps = [];
          for (const [id, info] of Object.entries(discovered)) {
            if (FORBIDDEN_APP_IDS.has(id) || ctx.disabledApps.has(id)) continue;
            const m = (info && info.manifest) || {};
            const cat = String(info.category || m.category || '').toLowerCase();
            if (catFilter && cat !== catFilter) continue;
            apps.push({
              id,
              name: info.name || m.name || id,
              category: cat || 'other',
              extensions: Array.isArray(m.extensions) ? m.extensions : [],
              runtime: (info.distribution === 'standalone-web' || m.runtime === 'iframe') ? 'wasm-external' : 'native'
            });
          }
          return { success: true, count: apps.length, apps };
        }
      });

      this.registerTool({
        name: 'os_launch_app',
        description: 'Launches an Atelier application by its app_id and waits briefly for WASM/external apps to expose their agent API (e.g. craft-web-api).',
        risk: 'mutate_app',
        parameters: {
          type: 'object',
          properties: {
            app_id: { type: 'string', description: 'Application identifier (from os_list_apps)' }
          },
          required: ['app_id']
        },
        handler: async (args, ctx) => {
          const appId = String(args.app_id || '').trim();
          if (!appId || FORBIDDEN_APP_IDS.has(appId) || ctx.disabledApps.has(appId)) {
            return { success: false, error: `Application '${appId}' is not allowed.` };
          }
          const appMgr = window.sys && window.sys.appManager;
          if (!appMgr || typeof appMgr.launchApp !== 'function') {
            return { success: false, error: 'AppManager unavailable.' };
          }
          appMgr.launchApp(appId, { blank: true });

          const host = (window.sys && window.sys.webAppHost) || window.WebAppHost;
          const agentBridge = window.sys && window.sys.webAppAgentBridge;
          if (host && typeof host.get === 'function' && host.get(appId) && agentBridge && typeof agentBridge.waitForAppReady === 'function') {
            const readyInfo = await agentBridge.waitForAppReady(appId, 8000);
            if (readyInfo && readyInfo.ready) {
              return {
                success: true,
                launched: appId,
                ready: true,
                agent_protocol: readyInfo.protocol,
                craft_prefix: readyInfo.prefix || undefined,
                hint: readyInfo.protocol === 'craft-web-api'
                  ? `Application '${appId}' is ready with craft-web-api. Call craft_commands once (supports comma-separated filter like "text,font,color,para") then craft_execute_batch (include file.new first if no document is open yet).`
                  : `Application '${appId}' registered dynamic agent tools.`
              };
            }
          }
          // Report any native WebOSApp agent tools exposed by the launched app
          const nativeTools = this.getAvailableTools(ctx.autonomyLevel || 'assisted', Array.from(ctx.disabledApps || []))
            .filter(t => t.appId === appId)
            .map(t => t.name);
          if (nativeTools.length > 0) {
            return {
              success: true,
              launched: appId,
              agent_protocol: 'webos-native',
              available_tools: nativeTools
            };
          }
          return { success: true, launched: appId };
        }
      });
    }

    // -------------------------------------------------------------------------
    // BUILT-IN USER-SCOPED VFS TOOLS (Strictly inherits user session ACLs & quotas)
    // -------------------------------------------------------------------------
    _registerCoreVfsTools() {
      this.registerTool({
        name: 'vfs_list_dir',
        description: 'Lists folders and files inside a VFS directory (public gallery "", personal home "users/<username>", shared folder, or external cloud mount "ext://<id>").',
        risk: 'read',
        parameters: {
          type: 'object',
          properties: {
            dir: { type: 'string', description: 'Relative VFS path (empty string for gallery root, or users/<me>, or ext://<id>)' }
          }
        },
        handler: async (args, ctx) => {
          if (!ctx.api) return { success: false, error: 'Syscall API unavailable.' };
          const dir = String(args.dir || '');
          const res = await ctx.api.get('get_gallery', { dir });
          if (!res || !res.success) {
            return { success: false, error: (res && res.error) || 'Unable to list directory.' };
          }
          const dirs = (res.directories || []).slice(0, 80).map(d => ({ name: d.name, path: d.path }));
          const files = (res.files || []).slice(0, 120).map(f => ({
            name: f.name,
            path: f.path,
            size: f.size || 0,
            category: f.category || ''
          }));
          return {
            success: true,
            dir: res.current_dir || dir,
            directories: dirs,
            files,
            total_dirs: (res.directories || []).length,
            total_files: (res.files || []).length
          };
        }
      });

      this.registerTool({
        name: 'vfs_search',
        description: 'Searches accessible files across the VFS by filename or keyword.',
        risk: 'read',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term' },
            category: { type: 'string', description: 'Optional filter: all, image, video, audio, document, archive' }
          },
          required: ['query']
        },
        handler: async (args, ctx) => {
          if (!ctx.api) return { success: false, error: 'Syscall API unavailable.' };
          const q = String(args.query || '').trim();
          if (!q) return { success: false, error: 'Query required.' };
          const res = await ctx.api.get('search_file_index', { q, category: args.category || 'all', limit: 40 });
          if (res && res.success && Array.isArray(res.results)) {
            return { success: true, count: res.results.length, results: res.results.slice(0, 40) };
          }
          const fallback = await ctx.api.get('search', { q });
          return {
            success: Boolean(fallback && fallback.success),
            results: (fallback && (fallback.results || fallback.files) || []).slice(0, 40)
          };
        }
      });

      this.registerTool({
        name: 'vfs_read_text_file',
        description: 'Reads the text content of an accessible text, Markdown, JSON, CSV, or code file in the VFS (up to 32 KB).',
        risk: 'read',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative VFS file path' }
          },
          required: ['path']
        },
        handler: async (args, ctx) => {
          if (!ctx.api || typeof ctx.api.getText !== 'function') return { success: false, error: 'Syscall API unavailable.' };
          const path = String(args.path || '').trim();
          if (!path) return { success: false, error: 'File path required.' };
          try {
            const rawUrl = 'system/endpoints/thumb.php?file=' + encodeURIComponent(path) + '&raw=1';
            const raw = String(await ctx.api.getText(rawUrl) || '');
            const truncated = raw.length > 32768;
            return {
              success: true,
              path,
              truncated,
              content: truncated ? raw.slice(0, 32768) : raw
            };
          } catch (err) {
            return { success: false, error: err && err.message ? err.message : 'Unable to read file.' };
          }
        }
      });

      this.registerTool({
        name: 'vfs_open_file',
        description: 'Opens a VFS file in its default Atelier application (or a specific app_id).',
        risk: 'mutate_app',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative VFS file path (or ext://<id>/...)' },
            app_id: { type: 'string', description: 'Optional application ID to open the file with' }
          },
          required: ['path']
        },
        handler: (args, ctx) => {
          const path = String(args.path || '').trim();
          if (!path) return { success: false, error: 'File path required.' };
          const appId = args.app_id ? String(args.app_id).trim() : null;
          if (appId && ctx.disabledApps.has(appId)) {
            return { success: false, error: `Application '${appId}' is excluded from AI Agent access.` };
          }
          const name = path.split('/').pop() || path;
          const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
          const fileObj = { path, name, extension: ext };
          const appMgr = window.sys && window.sys.appManager;
          if (appId && appMgr && typeof appMgr.launchApp === 'function') {
            appMgr.launchApp(appId, { file: fileObj });
            return { success: true, opened: path, app_id: appId };
          }
          if (appMgr && typeof appMgr.openFile === 'function') {
            appMgr.openFile(fileObj);
            return { success: true, opened: path };
          }
          return { success: false, error: 'AppManager.openFile unavailable.' };
        }
      });

      this.registerTool({
        name: 'vfs_create_folder',
        description: 'Creates a new folder inside an authorized VFS directory.',
        risk: 'mutate_fs',
        parameters: {
          type: 'object',
          properties: {
            dir: { type: 'string', description: 'Parent VFS directory path' },
            name: { type: 'string', description: 'New folder name' }
          },
          required: ['name']
        },
        handler: async (args, ctx) => {
          if (!ctx.api) return { success: false, error: 'Syscall API unavailable.' };
          const res = await ctx.api.post('create_folder', {
            dir: String(args.dir || ''),
            name: String(args.name || '')
          });
          if (res && res.success && window.EventBus) {
            window.EventBus.emit('vfs:changed', { dir: String(args.dir || '') });
          }
          return res || { success: false, error: 'Create folder failed.' };
        }
      });

      this.registerTool({
        name: 'vfs_write_text_file',
        description: 'Creates or updates a text/Markdown/JSON/CSV file in an authorized VFS path (automatically versions overwrites).',
        risk: 'mutate_fs',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Destination VFS file path (e.g. users/alice/notes.md)' },
            content: { type: 'string', description: 'Full UTF-8 text content to write' }
          },
          required: ['path', 'content']
        },
        handler: async (args, ctx) => {
          if (!ctx.api) return { success: false, error: 'Syscall API unavailable.' };
          const res = await ctx.api.post('save_text_file', {
            file: String(args.path || ''),
            content: String(args.content || '')
          });
          if (res && res.success && window.EventBus) {
            window.EventBus.emit('vfs:changed', { file: String(args.path || '') });
          }
          return res || { success: false, error: 'Save file failed.' };
        }
      });

      this.registerTool({
        name: 'vfs_move_item',
        description: 'Moves or renames an existing file or folder in the VFS.',
        risk: 'mutate_fs',
        parameters: {
          type: 'object',
          properties: {
            source: { type: 'string', description: 'Source VFS path' },
            target_dir: { type: 'string', description: 'Target VFS parent directory' },
            new_name: { type: 'string', description: 'Optional new filename' }
          },
          required: ['source', 'target_dir']
        },
        handler: async (args, ctx) => {
          if (!ctx.api) return { success: false, error: 'Syscall API unavailable.' };
          const payload = { source: String(args.source || ''), target_dir: String(args.target_dir || '') };
          if (args.new_name) payload.new_name = String(args.new_name);
          const res = await ctx.api.post('move_item', payload);
          if (res && res.success && window.EventBus) {
            window.EventBus.emit('vfs:changed', { dir: payload.target_dir });
          }
          return res || { success: false, error: 'Move item failed.' };
        }
      });

      this.registerTool({
        name: 'vfs_delete_item',
        description: 'Moves a file or folder into the 30-day soft-delete Trash (never permanently deletes).',
        risk: 'destructive',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative VFS path to move to Trash' }
          },
          required: ['path']
        },
        handler: async (args, ctx) => {
          if (!ctx.api) return { success: false, error: 'Syscall API unavailable.' };
          // Strictly soft-delete (never sends permanent: true)
          const res = await ctx.api.post('delete_item', { target: String(args.path || '') });
          if (res && res.success && window.EventBus) {
            window.EventBus.emit('vfs:changed', {});
          }
          return res || { success: false, error: 'Delete item failed.' };
        }
      });
    }

    // -------------------------------------------------------------------------
    // UNIVERSAL NATIVE WEBOSAPP PROVIDER (Phase E — Lot 4)
    // Auto-discovers any native app or game implementing getAgentTools() / getAgentContext()
    // -------------------------------------------------------------------------
    _collectNativeAppInstances() {
      const found = new Map(); // appId -> instance
      const addIfEligible = (id, inst) => {
        if (!id || !inst || typeof inst !== 'object') return;
        const cleanId = String(id).trim();
        if (!cleanId || FORBIDDEN_APP_IDS.has(cleanId) || found.has(cleanId)) return;
        if (typeof inst.getAgentTools === 'function' || typeof inst.getAgentContext === 'function') {
          found.set(cleanId, inst);
        }
      };

      const am = (window.sys && window.sys.appManager) || window.AppManager;
      if (am && am.apps && typeof am.apps.forEach === 'function') {
        am.apps.forEach((entry, id) => {
          if (entry && entry.instance) addIfEligible(id, entry.instance);
        });
      }

      // Also probe well-known global app singletons (for apps instantiated before/outside AppManager.apps)
      const globals = [
        ['explorer', window.explorerApp],
        ['doc-viewer', window.DocViewerApp],
        ['image-viewer', window.ImageViewerApp],
        ['maps', window.MapsApp],
        ['graphing-calc', window.GraphingCalcApp],
        ['hanoi', window.HanoiApp],
        ['8queens', window.EightQueensApp],
        ['pipe', window.PipeApp],
        ['foot', window.FootApp]
      ];
      globals.forEach(([id, inst]) => addIfEligible(id, inst));
      return found;
    }

    _isNativeAppOpen(appId, inst) {
      if (inst && typeof inst.isWindowOpen === 'function') {
        try { if (inst.isWindowOpen()) return true; } catch (e) {}
      }
      if (inst && inst.instances && typeof inst.instances.size === 'number' && inst.instances.size > 0) {
        return true;
      }
      const wm = window.WindowManager;
      if (wm && wm.windows) {
        const list = (wm.windows instanceof Map) ? Array.from(wm.windows.values()) : Array.from(wm.windows);
        if (list.some(w => w && (w.appId === appId || w.id === appId))) return true;
      }
      return false;
    }

    _registerNativeAppsProvider() {
      const sanitizePart = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

      this.registerProvider({
        id: 'native-webos-apps',
        getContext: (ctx) => {
          const disabled = (ctx && ctx.disabledApps instanceof Set) ? ctx.disabledApps : new Set();
          const contexts = {};
          const apps = this._collectNativeAppInstances();
          apps.forEach((inst, appId) => {
            if (disabled.has(appId)) return;
            if (!this._isNativeAppOpen(appId, inst)) return;
            if (typeof inst.getAgentContext !== 'function') return;
            try {
              const snap = inst.getAgentContext();
              if (snap && typeof snap === 'object') {
                contexts[appId] = Object.assign({ agent_protocol: 'webos-native' }, snap);
              }
            } catch (e) {}
          });
          return contexts;
        },
        getTools: (ctx) => {
          const disabled = (ctx && ctx.disabledApps instanceof Set) ? ctx.disabledApps : new Set();
          const tools = [];
          const apps = this._collectNativeAppInstances();
          apps.forEach((inst, appId) => {
            if (disabled.has(appId)) return;
            if (typeof inst.getAgentTools !== 'function') return;
            const isOpen = this._isNativeAppOpen(appId, inst);
            let defs = [];
            try { defs = inst.getAgentTools() || []; } catch (e) { defs = []; }
            if (!Array.isArray(defs) || defs.length === 0) return;

            const safeApp = sanitizePart(appId);
            for (const d of defs) {
              if (!d || !d.name) continue;
              if (!isOpen && !d.alwaysAvailable) continue;
              const shortName = String(d.name);
              const fullName = shortName.startsWith(`app_${safeApp}_`) ? shortName : `app_${safeApp}_${sanitizePart(shortName)}`;
              const risk = ['read', 'mutate_app', 'mutate_fs', 'destructive'].includes(d.risk) ? d.risk : 'mutate_app';
              tools.push({
                name: fullName,
                description: `[${appId}] ${d.description || shortName}`,
                parameters: (d.parameters && typeof d.parameters === 'object') ? d.parameters : { type: 'object', properties: {} },
                risk,
                appId,
                handler: async (args, execCtx) => {
                  if (typeof d.handler === 'function') {
                    return d.handler(args, execCtx);
                  }
                  if (typeof inst.executeAgentTool === 'function') {
                    return inst.executeAgentTool(shortName, args, execCtx);
                  }
                  return { success: false, error: `Tool '${shortName}' has no handler on '${appId}'.` };
                }
              });
            }
          });
          return tools;
        }
      });
    }
  }

  window.sys = window.sys || {};
  window.sys.agentTools = new AgentToolRegistry();
  window.AgentToolRegistry = AgentToolRegistry;
})(window);
