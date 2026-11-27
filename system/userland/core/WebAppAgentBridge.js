/**
 * Atelier by GallusTech - Phase E (Lot 3): Dynamic External App Agent Bridge (`WebAppAgentBridge.js`)
 *
 * Dynamically discovers and bridges external standalone/WASM applications into `window.sys.agentTools`:
 *   1. ArtCraft WASM apps (`craft-web-api`): auto-discovers `iframe.contentWindow.<prefix>` exposing
 *      `commands()`, `execute()`, `docInspect()`, `uiInspect()`, `screenshot()`, `request()` across
 *      WordCraft, GridCraft, DeckCraft, CADCraft, PdfCraft, FilmCraft, and any future Craft app.
 *   2. Universal third-party external apps: open origin-locked `postMessage` cooperative protocol
 *      (`webos:agent-register-tools`, `webos:agent-context`, `webos:agent-call`, `webos:agent-result`).
 *
 * Security invariants:
 *   - Strictly verifies `event.origin === window.location.origin` AND `event.source === iframe.contentWindow`.
 *   - Enforces user `disabled_apps` exclusions and `read_only` / Human-in-the-Loop risk classification.
 *   - Caps screenshot payloads and tool outputs to protect memory and LLM context budgets.
 */
(function (window) {
  'use strict';

  const MAX_RESULT_CHARS = 28000;
  const MAX_BATCH_STEPS = 40;
  const MAX_SCREENSHOT_BASE64 = 1800000; // ~1.35 MB binary PNG max
  const RPC_TIMEOUT_MS = 20000;

  function plainObject(val) {
    return (val && typeof val === 'object' && !Array.isArray(val)) ? val : {};
  }

  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`${label || 'Agent RPC'} timed out after ${ms}ms.`));
        }
      }, ms);
      Promise.resolve(promise).then(
        (val) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(val);
          }
        },
        (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        }
      );
    });
  }

  function unwrapCraftResult(raw) {
    if (raw && typeof raw === 'object' && ('ok' in raw)) {
      if (raw.ok === false) {
        return {
          success: false,
          error: String(raw.error || 'Craft API returned ok=false'),
          raw
        };
      }
      return {
        success: true,
        result: ('result' in raw) ? raw.result : raw
      };
    }
    return { success: true, result: raw };
  }

  function truncateValue(val, maxChars = MAX_RESULT_CHARS) {
    try {
      const json = JSON.stringify(val);
      if (typeof json === 'string' && json.length <= maxChars) {
        return { data: val, truncated: false };
      }
      if (Array.isArray(val)) {
        const sliced = [];
        let acc = 2;
        for (const item of val) {
          const itemStr = JSON.stringify(item);
          if (acc + itemStr.length + 2 > maxChars) break;
          sliced.push(item);
          acc += itemStr.length + 2;
        }
        return { data: sliced, truncated: true, total_items: val.length };
      }
      return {
        data: String(json).slice(0, maxChars) + '… [truncated]',
        truncated: true
      };
    } catch (e) {
      return { data: String(val).slice(0, maxChars), truncated: true };
    }
  }

  function extractBase64Png(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
      const dataUrlMatch = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
      if (dataUrlMatch) {
        return { mime: dataUrlMatch[1], data: dataUrlMatch[2].replace(/\s+/g, '') };
      }
      if (/^[A-Za-z0-9+/=]{64,}$/.test(raw.trim())) {
        return { mime: 'image/png', data: raw.trim() };
      }
      return null;
    }
    if (typeof raw === 'object') {
      const inner = ('result' in raw && raw.result) ? raw.result : raw;
      if (typeof inner === 'string') return extractBase64Png(inner);
      if (inner && typeof inner === 'object') {
        const b64 = inner.png_base64 || inner.pngBase64 || inner.pngbase64 || inner.data_base64 || inner.base64 || inner.data || inner.image || inner.png;
        if (typeof b64 === 'string' && b64.length > 32) {
          const parsed = extractBase64Png(b64);
          if (parsed) {
            return { mime: inner.mime || inner.mimeType || parsed.mime || 'image/png', data: parsed.data };
          }
        }
      }
    }
    return null;
  }

  function sanitizeToolIdPart(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  class WebAppAgentBridge {
    constructor() {
      this.pmToolsByApp = new Map();     // appId -> Array<toolDef>
      this.pmContextByApp = new Map();   // appId -> object
      this.pendingCalls = new Map();     // callId -> { resolve, reject, timer, appId }
      this._callSeq = 0;
      this._bound = false;
      this._provider = null;
    }

    init() {
      if (!this._bound && typeof window.addEventListener === 'function') {
        this._bound = true;
        window.addEventListener('message', (evt) => this._handlePostMessage(evt));
      }
      this._registerWithRegistry();
    }

    _registerWithRegistry() {
      if (this._provider) return;
      const reg = window.sys && window.sys.agentTools;
      if (!reg || typeof reg.registerProvider !== 'function') return;

      this._provider = {
        id: 'webapp-agent-bridge',
        getContext: (ctx) => this.collectExternalContexts(ctx && ctx.disabledApps),
        getTools: (ctx) => this.getDynamicTools(ctx && ctx.autonomyLevel, ctx && ctx.disabledApps)
      };
      reg.registerProvider(this._provider);
    }

    /**
     * Cleans up any registered postMessage tools, context, and pending calls when an iframe closes or reloads.
     */
    detachApp(appId) {
      const id = String(appId || '');
      if (!id) return;
      this.pmToolsByApp.delete(id);
      this.pmContextByApp.delete(id);
      for (const [callId, entry] of this.pendingCalls.entries()) {
        if (entry.appId === id) {
          clearTimeout(entry.timer);
          this.pendingCalls.delete(callId);
          entry.reject(new Error(`Application '${id}' closed before completing tool call.`));
        }
      }
    }

    /**
     * Returns all currently mounted standalone web app instances from WebAppHost.
     */
    _getHostInstances() {
      const host = (window.sys && window.sys.webAppHost) || window.WebAppHost;
      if (!host || !host.instances) return [];
      return Array.from(host.instances.values());
    }

    /**
     * Detects a live `craft-web-api` handle on a mounted StandaloneWebAppInstance's same-origin iframe.
     */
    detectCraftApiForInstance(inst) {
      if (!inst || !inst.id) return null;
      const iframe = typeof inst.getIframeElement === 'function' ? inst.getIframeElement() : null;
      if (!iframe || !iframe.contentWindow) return null;
      let cw;
      try {
        cw = iframe.contentWindow;
        // Same-origin probe
        void cw.location && cw.location.origin;
      } catch (e) {
        return null;
      }

      const isCraftHandle = (obj) => Boolean(
        obj && typeof obj === 'object' &&
        typeof obj.commands === 'function' &&
        typeof obj.execute === 'function'
      );

      const candidates = [];
      if (inst.hostBridge && inst.hostBridge.prefix) candidates.push(String(inst.hostBridge.prefix));
      if (inst.manifest && inst.manifest.craftApiPrefix) candidates.push(String(inst.manifest.craftApiPrefix));
      candidates.push(String(inst.id));
      candidates.push(String(inst.id).replace(/[^a-z0-9]/gi, '').toLowerCase());

      for (const key of candidates) {
        if (!key) continue;
        try {
          if (isCraftHandle(cw[key])) {
            return { appId: inst.id, windowId: inst.windowId, prefix: key, api: cw[key], iframe, inst };
          }
        } catch (e) {}
      }

      // Auto-discovery fallback: scan global keys ending with 'craft' or exposing craft-web-api signature
      try {
        const keys = Object.keys(cw);
        for (const key of keys) {
          if (!/craft/i.test(key)) continue;
          try {
            if (isCraftHandle(cw[key])) {
              return { appId: inst.id, windowId: inst.windowId, prefix: key, api: cw[key], iframe, inst };
            }
          } catch (e) {}
        }
      } catch (e) {}

      return null;
    }

    /**
     * Lists all currently open external apps that expose a live `craft-web-api` handle.
     */
    listLiveCraftApps(disabledSet = new Set()) {
      const found = [];
      for (const inst of this._getHostInstances()) {
        if (!inst || !inst.id || disabledSet.has(inst.id)) continue;
        const detected = this.detectCraftApiForInstance(inst);
        if (detected) found.push(detected);
      }
      return found;
    }

    /**
     * Waits up to `timeoutMs` for a launched external app to expose `craft-web-api` or `webos:agent-register-tools`.
     */
    async waitForAppReady(appId, timeoutMs = 8000) {
      const id = String(appId || '');
      if (!id) return { ready: false, protocol: null };
      const host = (window.sys && window.sys.webAppHost) || window.WebAppHost;
      const inst = host && typeof host.get === 'function' ? host.get(id) : null;
      if (!inst) return { ready: false, protocol: null };

      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const craft = this.detectCraftApiForInstance(inst);
        if (craft) {
          return { ready: true, protocol: 'craft-web-api', prefix: craft.prefix };
        }
        if (this.pmToolsByApp.has(id) && this.pmToolsByApp.get(id).length > 0) {
          return { ready: true, protocol: 'webos:agent', tools_count: this.pmToolsByApp.get(id).length };
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return { ready: false, protocol: null };
    }

    /**
     * Resolves a Craft app target by `app_id`, falling back to the active Craft window or sole open Craft app.
     */
    _resolveCraftTarget(requestedAppId, disabledSet) {
      const live = this.listLiveCraftApps(disabledSet);
      if (live.length === 0) {
        return { error: 'No Craft WASM application with craft-web-api is currently open. Launch one first with os_launch_app (e.g. wordcraft, gridcraft, deckcraft, cadcraft, pdfcraft, filmcraft).' };
      }
      if (requestedAppId) {
        const wanted = String(requestedAppId).trim().toLowerCase();
        if (disabledSet && disabledSet.has(wanted)) {
          return { error: `Application '${wanted}' is excluded from AI Agent access.` };
        }
        const exact = live.find((c) => c.appId.toLowerCase() === wanted || c.prefix.toLowerCase() === wanted);
        if (!exact) {
          return { error: `Craft app '${requestedAppId}' is not currently open or its WASM API is still booting. Open Craft apps: ${live.map(c => c.appId).join(', ')}.` };
        }
        return { target: exact };
      }
      const wm = window.WindowManager;
      if (wm && wm.activeWindowId) {
        const activeMatch = live.find((c) => c.windowId === wm.activeWindowId);
        if (activeMatch) return { target: activeMatch };
      }
      if (live.length === 1) return { target: live[0] };
      return { error: `Multiple Craft apps are open (${live.map(c => c.appId).join(', ')}). Specify app_id explicitly.` };
    }

    /**
     * Collects live external app context (Craft API availability + custom postMessage app context).
     */
    collectExternalContexts(disabledSet = new Set()) {
      const disabled = disabledSet instanceof Set ? disabledSet : new Set(Array.isArray(disabledSet) ? disabledSet : []);
      const contexts = {};

      for (const craft of this.listLiveCraftApps(disabled)) {
        contexts[craft.appId] = {
          agent_protocol: 'craft-web-api',
          craft_prefix: craft.prefix,
          active_file: craft.inst.activeFile ? craft.inst.activeFile.name : null,
          is_dirty: Boolean(craft.inst.isDirty),
          available_tools: ['craft_commands', 'craft_doc_inspect', 'craft_ui_inspect', 'craft_execute', 'craft_execute_batch', 'craft_screenshot']
        };
      }

      for (const [appId, customCtx] of this.pmContextByApp.entries()) {
        if (disabled.has(appId)) continue;
        contexts[appId] = Object.assign({}, contexts[appId] || {}, {
          agent_protocol: 'webos:agent',
          context: customCtx
        });
      }

      return contexts;
    }

    /**
     * Captures a PNG screenshot from a Craft app (`api.screenshot()` with same-origin `<canvas>` fallback).
     */
    async _captureCraftScreenshot(target, params = {}) {
      let parsed = null;
      if (typeof target.api.screenshot === 'function') {
        try {
          const raw = await withTimeout(target.api.screenshot(params || {}), RPC_TIMEOUT_MS, `${target.prefix}.screenshot`);
          const unwrapped = unwrapCraftResult(raw);
          if (unwrapped.success) {
            parsed = extractBase64Png(unwrapped.result);
          }
        } catch (e) {}
      }

      // Fallback: read the iframe's primary <canvas> directly (same-origin)
      if (!parsed) {
        try {
          const doc = target.iframe && target.iframe.contentDocument;
          const canvas = doc && doc.querySelector('canvas');
          if (canvas && typeof canvas.toDataURL === 'function' && canvas.width > 0 && canvas.height > 0) {
            const dataUrl = canvas.toDataURL('image/png');
            parsed = extractBase64Png(dataUrl);
          }
        } catch (e) {}
      }

      if (!parsed || !parsed.data) {
        return { success: false, error: `Unable to capture screenshot for '${target.appId}'.` };
      }

      if (parsed.data.length > MAX_SCREENSHOT_BASE64) {
        return {
          success: false,
          error: `Screenshot for '${target.appId}' exceeded maximum payload size (${Math.round(parsed.data.length / 1024)} KB base64).`
        };
      }

      return {
        success: true,
        app_id: target.appId,
        mime: parsed.mime || 'image/png',
        bytes_approx: Math.round((parsed.data.length * 3) / 4),
        _vision_image: {
          mime: parsed.mime || 'image/png',
          data: parsed.data
        }
      };
    }

    /**
     * Builds dynamic tool definitions for all live Craft apps + postMessage-registered third-party apps.
     */
    getDynamicTools(autonomyLevel = 'assisted', disabledSet = new Set()) {
      const disabled = disabledSet instanceof Set ? disabledSet : new Set(Array.isArray(disabledSet) ? disabledSet : []);
      const tools = [];
      const liveCraft = this.listLiveCraftApps(disabled);

      if (liveCraft.length > 0) {
        const openIds = liveCraft.map((c) => c.appId);
        const idsDesc = `Target open Craft app_id (${openIds.join(', ')}). Optional if only one is open or active.`;

        tools.push({
          name: 'craft_commands',
          description: `Lists the internal engine commands supported by an open ArtCraft WASM app (${openIds.join(', ')}). Without filter/ids, returns a compact catalog of command IDs grouped by namespace (low token usage). Pass filter (e.g. "insert", "text", "font", "color", "paragraph", "style") or ids to retrieve exact parameter schemas before calling craft_execute / craft_execute_batch.`,
          risk: 'read',
          parameters: {
            type: 'object',
            properties: {
              app_id: { type: 'string', description: idsDesc },
              filter: { type: 'string', description: 'Optional case-insensitive filter; supports comma-separated keywords (e.g. "text,font,color,para,file") to fetch multiple categories in one call.' },
              ids: {
                type: 'array',
                description: 'Optional list of exact command IDs (e.g. ["text.insert", "font.color"]) to inspect their exact parameter schemas.',
                items: { type: 'string' }
              }
            }
          },
          handler: async (args, ctx) => {
            const resolved = this._resolveCraftTarget(args.app_id, ctx.disabledApps);
            if (resolved.error) return { success: false, error: resolved.error };
            const t = resolved.target;
            const raw = await withTimeout(t.api.commands(), RPC_TIMEOUT_MS, `${t.prefix}.commands`);
            const unwrapped = unwrapCraftResult(raw);
            if (!unwrapped.success) return unwrapped;

            let list = unwrapped.result;
            if (list && typeof list === 'object' && !Array.isArray(list) && Array.isArray(list.commands)) {
              list = list.commands;
            }

            if (!Array.isArray(list)) {
              const bounded = truncateValue(list, 12000);
              return { success: true, app_id: t.appId, prefix: t.prefix, truncated: bounded.truncated, commands: bounded.data };
            }

            // Exclude currently disabled commands to reduce noise & tokens
            const enabledList = list.filter((item) => !item || item.enabled !== false);
            const wantedIds = Array.isArray(args.ids)
              ? new Set(args.ids.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))
              : null;
            const filter = String(args.filter || '').trim().toLowerCase();

            // Compact overview mode when no filter/ids given (saves ~85% tokens on large Craft apps!)
            if (!filter && (!wantedIds || wantedIds.size === 0)) {
              const grouped = {};
              for (const item of enabledList) {
                const id = String((item && (item.id || item.name)) || '');
                if (!id) continue;
                const ns = id.includes('.') ? id.split('.')[0] : 'other';
                if (!grouped[ns]) grouped[ns] = [];
                const lbl = item.label ? `${id} (${item.label})` : id;
                grouped[ns].push(lbl);
              }
              const bounded = truncateValue(grouped, 10000);
              return {
                success: true,
                app_id: t.appId,
                prefix: t.prefix,
                mode: 'compact_catalog',
                total_enabled: enabledList.length,
                truncated: bounded.truncated,
                hint: 'Call craft_commands again with ids:[...] or filter:"<keyword>" (e.g. "text", "font", "color", "paragraph") to retrieve exact JSON parameter schemas.',
                namespaces: bounded.data
              };
            }

            let matched = enabledList;
            if (wantedIds && wantedIds.size > 0) {
              matched = enabledList.filter((item) => {
                const id = String((item && (item.id || item.name)) || '').toLowerCase();
                return wantedIds.has(id);
              });
            } else if (filter) {
              const terms = filter.split(/[,|]+/).map((s) => s.trim()).filter(Boolean);
              // Prioritize matches on id/label/location before matching verbose params prose
              const byMeta = enabledList.filter((item) => {
                const hay = `${item.id || item.name || ''} ${item.label || ''} ${item.description || ''} ${item.location || ''}`.toLowerCase();
                return terms.some((term) => hay.includes(term));
              });
              matched = byMeta.length > 0 ? byMeta : enabledList.filter((item) => {
                try {
                  const rawStr = JSON.stringify(item).toLowerCase();
                  return terms.some((term) => rawStr.includes(term));
                } catch (e) { return false; }
              });
            }

            const compactMatched = matched.slice(0, 45).map((item) => {
              const entry = {
                id: item.id || item.name,
                label: item.label || item.description || ''
              };
              if (item.params !== undefined && item.params !== '{}') {
                const pStr = typeof item.params === 'string' ? item.params : JSON.stringify(item.params);
                entry.params = pStr.length > 360 ? (pStr.slice(0, 360) + '…') : item.params;
              }
              return entry;
            });

            const bounded = truncateValue(compactMatched, 13000);
            return {
              success: true,
              app_id: t.appId,
              prefix: t.prefix,
              total_matched: matched.length,
              returned: Array.isArray(bounded.data) ? bounded.data.length : 0,
              truncated: bounded.truncated || matched.length > 45,
              commands: bounded.data
            };
          }
        });

        tools.push({
          name: 'craft_doc_inspect',
          description: `Inspects the current document structure, paragraphs, cells, slides, or selection inside an open Craft app (${openIds.join(', ')}).`,
          risk: 'read',
          parameters: {
            type: 'object',
            properties: {
              app_id: { type: 'string', description: idsDesc },
              params: { type: 'object', description: 'Optional inspection options (e.g. {"text": true} for WordCraft).' }
            }
          },
          handler: async (args, ctx) => {
            const resolved = this._resolveCraftTarget(args.app_id, ctx.disabledApps);
            if (resolved.error) return { success: false, error: resolved.error };
            const t = resolved.target;
            if (typeof t.api.docInspect !== 'function') {
              return { success: false, error: `'${t.appId}' does not expose docInspect().` };
            }
            const raw = await withTimeout(
              t.api.docInspect(plainObject(args.params)),
              RPC_TIMEOUT_MS,
              `${t.prefix}.docInspect`
            );
            const unwrapped = unwrapCraftResult(raw);
            if (!unwrapped.success) return unwrapped;
            const bounded = truncateValue(unwrapped.result, 14000);
            return { success: true, app_id: t.appId, truncated: bounded.truncated, document: bounded.data };
          }
        });

        tools.push({
          name: 'craft_ui_inspect',
          description: `Inspects the live UI state (active panels, tools, zoom, viewport) of an open Craft app (${openIds.join(', ')}).`,
          risk: 'read',
          parameters: {
            type: 'object',
            properties: {
              app_id: { type: 'string', description: idsDesc },
              params: { type: 'object', description: 'Optional UI inspection parameters.' }
            }
          },
          handler: async (args, ctx) => {
            const resolved = this._resolveCraftTarget(args.app_id, ctx.disabledApps);
            if (resolved.error) return { success: false, error: resolved.error };
            const t = resolved.target;
            if (typeof t.api.uiInspect !== 'function') {
              return { success: false, error: `'${t.appId}' does not expose uiInspect().` };
            }
            const raw = await withTimeout(
              t.api.uiInspect(plainObject(args.params)),
              RPC_TIMEOUT_MS,
              `${t.prefix}.uiInspect`
            );
            const unwrapped = unwrapCraftResult(raw);
            if (!unwrapped.success) return unwrapped;
            const bounded = truncateValue(unwrapped.result, 12000);
            return { success: true, app_id: t.appId, truncated: bounded.truncated, ui: bounded.data };
          }
        });

        tools.push({
          name: 'craft_screenshot',
          description: `Captures a live PNG screenshot of an open Craft app viewport (${openIds.join(', ')}) so you can visually inspect the document layout and styling.`,
          risk: 'read',
          parameters: {
            type: 'object',
            properties: {
              app_id: { type: 'string', description: idsDesc }
            }
          },
          handler: async (args, ctx) => {
            const resolved = this._resolveCraftTarget(args.app_id, ctx.disabledApps);
            if (resolved.error) return { success: false, error: resolved.error };
            return this._captureCraftScreenshot(resolved.target);
          }
        });

        tools.push({
          name: 'craft_execute',
          description: `Executes a single engine command inside an open Craft app (${openIds.join(', ')}). Discover valid command names & parameters first via craft_commands.`,
          risk: 'mutate_app',
          parameters: {
            type: 'object',
            properties: {
              app_id: { type: 'string', description: idsDesc },
              command: { type: 'string', description: 'Exact Craft command name returned by craft_commands.' },
              params: { type: 'object', description: 'Command parameters object (optional).' }
            },
            required: ['command']
          },
          handler: async (args, ctx) => {
            const resolved = this._resolveCraftTarget(args.app_id, ctx.disabledApps);
            if (resolved.error) return { success: false, error: resolved.error };
            const cmd = String(args.command || '').trim();
            if (!cmd) return { success: false, error: 'Command name is required.' };
            const t = resolved.target;
            const raw = await withTimeout(
              t.api.execute(cmd, plainObject(args.params)),
              RPC_TIMEOUT_MS,
              `${t.prefix}.execute(${cmd})`
            );
            const unwrapped = unwrapCraftResult(raw);
            if (!unwrapped.success) return unwrapped;
            const bounded = truncateValue(unwrapped.result, 12000);
            return { success: true, app_id: t.appId, command: cmd, result: bounded.data };
          }
        });

        tools.push({
          name: 'craft_execute_batch',
          description: `Executes an ordered sequence of up to ${MAX_BATCH_STEPS} engine commands inside an open Craft app (${openIds.join(', ')}) in one turn (ideal for writing and formatting multi-paragraph documents, tables, or slides efficiently).`,
          risk: 'mutate_app',
          parameters: {
            type: 'object',
            properties: {
              app_id: { type: 'string', description: idsDesc },
              steps: {
                type: 'array',
                description: 'Ordered array of { command, params } steps to run sequentially.',
                items: {
                  type: 'object',
                  properties: {
                    command: { type: 'string', description: 'Craft command name' },
                    params: { type: 'object', description: 'Command parameters object' }
                  },
                  required: ['command']
                }
              },
              continue_on_error: { type: 'boolean', description: 'If true, continues remaining steps after a failed command (default false).' }
            },
            required: ['steps']
          },
          handler: async (args, ctx) => {
            const resolved = this._resolveCraftTarget(args.app_id, ctx.disabledApps);
            if (resolved.error) return { success: false, error: resolved.error };
            const steps = Array.isArray(args.steps) ? args.steps.slice(0, MAX_BATCH_STEPS) : [];
            if (steps.length === 0) return { success: false, error: 'steps array must contain at least 1 command.' };
            const t = resolved.target;
            const continueOnErr = Boolean(args.continue_on_error);
            const results = [];
            let allOk = true;

            for (let i = 0; i < steps.length; i++) {
              const s = steps[i] || {};
              const cmd = String(s.command || '').trim();
              if (!cmd) {
                results.push({ step: i, command: '', success: false, error: 'Empty command name.' });
                allOk = false;
                if (!continueOnErr) break;
                continue;
              }
              try {
                const raw = await withTimeout(
                  t.api.execute(cmd, plainObject(s.params)),
                  RPC_TIMEOUT_MS,
                  `${t.prefix}.execute(${cmd})`
                );
                const unwrapped = unwrapCraftResult(raw);
                if (!unwrapped.success) {
                  results.push({ step: i, command: cmd, success: false, error: unwrapped.error });
                  allOk = false;
                  if (!continueOnErr) break;
                } else {
                  results.push({ step: i, command: cmd, success: true, result: truncateValue(unwrapped.result, 1500).data });
                }
              } catch (err) {
                results.push({ step: i, command: cmd, success: false, error: err && err.message ? err.message : String(err) });
                allOk = false;
                if (!continueOnErr) break;
              }
            }

            return {
              success: allOk,
              app_id: t.appId,
              executed: results.length,
              total_requested: steps.length,
              results
            };
          }
        });

        tools.push({
          name: 'craft_request',
          description: `Sends a direct RPC method call via craft-web-api request(method, params) on an open Craft app (${openIds.join(', ')}) for specialized read/write endpoints not covered by craft_execute.`,
          risk: 'mutate_app',
          parameters: {
            type: 'object',
            properties: {
              app_id: { type: 'string', description: idsDesc },
              method: { type: 'string', description: 'RPC method name (e.g. "document.text", "document.paragraph", "document.selection").' },
              params: { type: 'object', description: 'Optional method parameters object.' }
            },
            required: ['method']
          },
          handler: async (args, ctx) => {
            const resolved = this._resolveCraftTarget(args.app_id, ctx.disabledApps);
            if (resolved.error) return { success: false, error: resolved.error };
            const t = resolved.target;
            if (typeof t.api.request !== 'function') {
              return { success: false, error: `'${t.appId}' does not expose request().` };
            }
            const method = String(args.method || '').trim();
            if (!method) return { success: false, error: 'RPC method is required.' };
            const raw = await withTimeout(
              t.api.request(method, plainObject(args.params)),
              RPC_TIMEOUT_MS,
              `${t.prefix}.request(${method})`
            );
            const unwrapped = unwrapCraftResult(raw);
            if (!unwrapped.success) return unwrapped;
            const bounded = truncateValue(unwrapped.result, MAX_RESULT_CHARS);
            return { success: true, app_id: t.appId, method, truncated: bounded.truncated, result: bounded.data };
          }
        });
      }

      // Open cooperative `webos:agent-*` tools registered by third-party iframes
      for (const [appId, defs] of this.pmToolsByApp.entries()) {
        if (disabled.has(appId)) continue;
        const host = (window.sys && window.sys.webAppHost) || window.WebAppHost;
        const inst = host && typeof host.get === 'function' ? host.get(appId) : null;
        const iframe = inst && typeof inst.getIframeElement === 'function' ? inst.getIframeElement() : null;
        if (!iframe || !iframe.contentWindow) continue;

        for (const d of defs) {
          const safeToolName = `extapp_${sanitizeToolIdPart(appId)}_${sanitizeToolIdPart(d.name)}`;
          tools.push({
            name: safeToolName,
            description: `[${appId}] ${d.description || d.name}`,
            parameters: d.parameters || { type: 'object', properties: {} },
            risk: ['read', 'mutate_app', 'mutate_fs', 'destructive'].includes(d.risk) ? d.risk : 'mutate_app',
            appId,
            handler: (args) => this._invokePostMessageTool(appId, iframe, d.name, args)
          });
        }
      }

      return tools;
    }

    /**
     * Resolves which mounted WebAppHost instance owns a given `postMessage` event.source (strictly same-origin).
     */
    _resolveSourceApp(event) {
      if (!event || !event.source) return null;
      const expectedOrigin = window.location && window.location.origin;
      if (expectedOrigin && event.origin && event.origin !== expectedOrigin) {
        return null;
      }
      for (const inst of this._getHostInstances()) {
        const iframe = typeof inst.getIframeElement === 'function' ? inst.getIframeElement() : null;
        if (iframe && iframe.contentWindow && iframe.contentWindow === event.source) {
          return { appId: inst.id, inst, iframe };
        }
      }
      return null;
    }

    _handlePostMessage(event) {
      if (!event || !event.data || typeof event.data !== 'object') return;
      const msg = event.data;
      const type = String(msg.type || '');
      if (!type.startsWith('webos:agent-')) return;

      const src = this._resolveSourceApp(event);
      if (!src) return;

      if (type === 'webos:agent-register-tools') {
        const rawTools = Array.isArray(msg.tools) ? msg.tools.slice(0, 40) : [];
        const clean = [];
        for (const t of rawTools) {
          if (!t || typeof t !== 'object' || !t.name) continue;
          clean.push({
            name: String(t.name).slice(0, 64),
            description: String(t.description || '').slice(0, 500),
            parameters: (t.parameters && typeof t.parameters === 'object') ? t.parameters : { type: 'object', properties: {} },
            risk: ['read', 'mutate_app', 'mutate_fs', 'destructive'].includes(t.risk) ? t.risk : 'mutate_app'
          });
        }
        this.pmToolsByApp.set(src.appId, clean);
        return;
      }

      if (type === 'webos:agent-context') {
        if (msg.context && typeof msg.context === 'object') {
          this.pmContextByApp.set(src.appId, truncateValue(msg.context, 8000).data);
        } else {
          this.pmContextByApp.delete(src.appId);
        }
        return;
      }

      if (type === 'webos:agent-result') {
        const callId = String(msg.callId || '');
        const pending = this.pendingCalls.get(callId);
        if (!pending || pending.appId !== src.appId) return;
        clearTimeout(pending.timer);
        this.pendingCalls.delete(callId);

        if (msg.success === false) {
          pending.resolve({ success: false, error: String(msg.error || 'External app tool failed.') });
          return;
        }
        const out = {
          success: true,
          app_id: src.appId,
          result: truncateValue(msg.result, MAX_RESULT_CHARS).data
        };
        if (msg.image) {
          const img = extractBase64Png(msg.image);
          if (img && img.data.length <= MAX_SCREENSHOT_BASE64) {
            out._vision_image = img;
          }
        }
        pending.resolve(out);
      }
    }

    _invokePostMessageTool(appId, iframe, toolName, args) {
      return new Promise((resolve, reject) => {
        if (!iframe || !iframe.contentWindow) {
          resolve({ success: false, error: `Iframe for '${appId}' is not available.` });
          return;
        }
        const callId = `wac_${Date.now()}_${++this._callSeq}`;
        const timer = setTimeout(() => {
          this.pendingCalls.delete(callId);
          resolve({ success: false, error: `External app '${appId}' tool '${toolName}' timed out.` });
        }, RPC_TIMEOUT_MS);

        this.pendingCalls.set(callId, { resolve, reject, timer, appId });
        const targetOrigin = (window.location && window.location.origin) ? window.location.origin : '*';
        try {
          iframe.contentWindow.postMessage({
            type: 'webos:agent-call',
            callId,
            name: toolName,
            args: args && typeof args === 'object' ? args : {}
          }, targetOrigin);
        } catch (err) {
          clearTimeout(timer);
          this.pendingCalls.delete(callId);
          resolve({ success: false, error: err && err.message ? err.message : 'postMessage dispatch failed.' });
        }
      });
    }
  }

  const bridge = new WebAppAgentBridge();
  window.sys = window.sys || {};
  window.sys.webAppAgentBridge = bridge;
  window.WebAppAgentBridge = WebAppAgentBridge;
  bridge.init();
})(window);
