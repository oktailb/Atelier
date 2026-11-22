/**
 * SimpleGallery Userland - Generic Standalone Web Application Host (WebAppHost.js)
 * Automatically mounts third-party static/HTML/WASM/PWA applications discovered
 * by PluginDiscovery (distribution === 'standalone-web' / runtime === 'iframe')
 * with full WindowManager, MenuBarManager, AppManager, MediaViewerRegistry,
 * and automatic Gallery-to-Iframe file bridging.
 */
(function (window) {
  'use strict';

  const document = window.document;

  class StandaloneWebAppInstance {
    constructor(appInfo) {
      this.appInfo = appInfo || {};
      this.manifest = (appInfo && appInfo.manifest) ? appInfo.manifest : {};
      this.id = this.manifest.id || appInfo.id;
      this.name = this.manifest.name || appInfo.name || this.id;
      this.icon = this.manifest.icon || appInfo.icon || '🌐';
      this.htmlEntry = appInfo.html_entry || (this.manifest.entry && this.manifest.entry.html) || '';
      this.windowId = `webapp-${this.id}`;
      this.activeFile = null;
      this.activeRendererFlag = '';
      this.iframeLoaded = false;
      this.win = null;
    }

    t(key, replacements = {}) {
      if (window.I18nEngine && typeof window.I18nEngine.t === 'function') {
        return window.I18nEngine.t(key, replacements);
      }
      if (window.desktop && typeof window.desktop.t === 'function') {
        return window.desktop.t(key, replacements);
      }
      return key;
    }

    escapeHtml(str) {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    getAppTitle() {
      if (window.sys && window.sys.appManager && typeof window.sys.appManager.getAppTitle === 'function') {
        return window.sys.appManager.getAppTitle(this.id);
      }
      return this.name;
    }

    getAppIconHtml() {
      if (window.sys && window.sys.appManager && typeof window.sys.appManager.getAppIcon === 'function') {
        return window.sys.appManager.getAppIcon(this.id);
      }
      if (window.IconHelper && typeof window.IconHelper.renderAppIcon === 'function') {
        return window.IconHelper.renderAppIcon(this.manifest, this.icon);
      }
      return this.icon;
    }

    getEffectiveSrc(startupFile = null) {
      if (!this.htmlEntry) return 'about:blank';
      const params = [];
      if (this.activeRendererFlag) {
        params.push(encodeURIComponent(this.activeRendererFlag));
      }
      const openParam = this.manifest && this.manifest.openFileParam;
      if (startupFile && openParam) {
        const rawUrl = this.resolveFileUrl(startupFile);
        if (rawUrl) {
          let absUrl = rawUrl;
          try {
            if (window.location && window.location.href) {
              absUrl = new URL(rawUrl, window.location.href).href;
            }
          } catch (e) {}
          params.push(`${encodeURIComponent(openParam)}=${encodeURIComponent(absUrl)}`);
        }
      }
      if (params.length === 0) return this.htmlEntry;
      const sep = this.htmlEntry.includes('?') ? '&' : '?';
      return `${this.htmlEntry}${sep}${params.join('&')}`;
    }

    getIframeElement() {
      return document.getElementById(`webappIframe-${this.id}`);
    }

    getBootOverlayElement() {
      return document.getElementById(`webappBootOverlay-${this.id}`);
    }

    hideBootOverlay() {
      if (this._slowTimer) {
        clearTimeout(this._slowTimer);
        this._slowTimer = null;
      }
      if (this._bootPollTimer) {
        clearInterval(this._bootPollTimer);
        this._bootPollTimer = null;
      }
      const overlay = this.getBootOverlayElement();
      if (overlay) {
        overlay.classList.add('is-hidden');
        setTimeout(() => {
          if (overlay.classList.contains('is-hidden')) {
            overlay.style.display = 'none';
          }
        }, 280);
      }
    }

    showBootOverlay(errorMessage = '') {
      const overlay = this.getBootOverlayElement();
      if (!overlay) return;
      overlay.style.display = 'flex';
      overlay.classList.remove('is-hidden');

      const spinner = overlay.querySelector('.webapp-boot-spinner');
      const titleEl = overlay.querySelector('.webapp-boot-title');
      const hintEl = overlay.querySelector('.webapp-boot-hint');
      const actionsEl = overlay.querySelector('.webapp-boot-actions');

      if (errorMessage) {
        if (spinner) spinner.style.display = 'none';
        if (titleEl) titleEl.textContent = this.t('webapp.load_error', { app: this.getAppTitle() });
        if (hintEl) {
          hintEl.textContent = errorMessage;
          hintEl.style.display = 'block';
        }
        if (actionsEl) actionsEl.style.display = 'flex';
      } else {
        if (spinner) spinner.style.display = 'block';
        if (titleEl) titleEl.textContent = this.t('webapp.loading', { app: this.getAppTitle() });
        if (hintEl) {
          hintEl.textContent = '';
          hintEl.style.display = 'none';
        }
        if (actionsEl) actionsEl.style.display = 'none';
      }
    }

    bindBootLifecycle(iframe, filePassedViaQuery = false) {
      if (!iframe) return;
      if (this._slowTimer) clearTimeout(this._slowTimer);
      if (this._bootPollTimer) clearInterval(this._bootPollTimer);

      const overlay = this.getBootOverlayElement();
      const isWasm = Array.isArray(this.manifest.capabilities) && this.manifest.capabilities.includes('wasm');

      // Show recovery / renderer fallback buttons if WASM boot takes > 7s
      this._slowTimer = setTimeout(() => {
        if (!overlay || overlay.classList.contains('is-hidden')) return;
        const hintEl = overlay.querySelector('.webapp-boot-hint');
        const actionsEl = overlay.querySelector('.webapp-boot-actions');
        if (hintEl && !hintEl.textContent) {
          hintEl.textContent = this.t('webapp.loading_slow');
          hintEl.style.display = 'block';
        }
        if (actionsEl) actionsEl.style.display = 'flex';
      }, 7000);

      // Bind overlay recovery buttons
      if (overlay) {
        overlay.querySelectorAll('[data-webapp-action]').forEach((btn) => {
          btn.onclick = () => {
            const act = btn.dataset.webappAction;
            if (act === 'retry') this.reload();
            else if (act === 'new-tab') window.open(this.getEffectiveSrc(), '_blank', 'noopener,noreferrer');
            else if (act && act.startsWith('renderer:')) this.setRendererFlag(act.slice(9));
          };
        });
      }

      const attachIframeWindowHooks = () => {
        try {
          const cw = iframe.contentWindow;
          if (!cw || cw.__sgBootHooked) return;
          cw.__sgBootHooked = true;

          cw.addEventListener('TrunkApplicationStarted', () => {
            this.hideBootOverlay();
          });

          cw.addEventListener('error', (evt) => {
            const msg = (evt && (evt.message || (evt.error && evt.error.message))) || 'Runtime error';
            this.showBootOverlay(String(msg));
          });

          cw.addEventListener('unhandledrejection', (evt) => {
            const reason = evt && evt.reason;
            const msg = (reason && reason.message) ? reason.message : String(reason || 'Unhandled promise rejection');
            if (/webgpu|webgl|wasm|fetch|network|memory|abort|failed/i.test(msg)) {
              this.showBootOverlay(msg);
            }
          });
        } catch (e) {}
      };

      if (this._onIframeLoad) {
        iframe.removeEventListener('load', this._onIframeLoad);
      }
      this._onIframeLoad = () => {
        this.iframeLoaded = true;
        attachIframeWindowHooks();

        if (!isWasm) {
          this.hideBootOverlay();
        } else {
          // For WASM apps (especially those without their own loading screen like PdfCraft),
          // poll until TrunkApplicationStarted or canvas backing store initializes
          let checks = 0;
          this._bootPollTimer = setInterval(() => {
            checks++;
            attachIframeWindowHooks();
            try {
              const doc = iframe.contentDocument;
              if (doc) {
                const ownLoader = doc.querySelector('[id$="_loading"]');
                if (ownLoader && ownLoader.offsetParent !== null) {
                  // App has its own visible loading UI — let it take over immediately
                  this.hideBootOverlay();
                  return;
                }
                const canvas = doc.querySelector('canvas');
                if (canvas && canvas.width > 300 && canvas.height > 150) {
                  this.hideBootOverlay();
                  return;
                }
              }
            } catch (e) {
              this.hideBootOverlay();
              return;
            }
            if (checks >= 60) {
              this.hideBootOverlay();
            }
          }, 300);
        }

        if (this.activeFile && !filePassedViaQuery) {
          this.injectFileIntoIframe(this.activeFile);
        }
      };
      iframe.addEventListener('load', this._onIframeLoad);
    }

    buildMenuBarDefinition() {
      const fileItems = [
        {
          id: 'open-gallery-file',
          label: this.t('webapp.open_file'),
          action: () => {
            if (window.sys && window.sys.appManager && typeof window.sys.appManager.openFilePicker === 'function') {
              window.sys.appManager.openFilePicker(this.id);
            }
          }
        }
      ];

      if (this.activeFile) {
        fileItems.push({
          id: 'reinject-file',
          label: this.t('webapp.reinject_file'),
          action: () => this.injectFileIntoIframe(this.activeFile)
        });
      }

      const viewItems = [
        {
          id: 'reload',
          label: this.t('webapp.reload'),
          action: () => this.reload()
        },
        {
          id: 'fullscreen',
          label: this.t('webapp.fullscreen'),
          action: () => this.toggleFullscreen()
        },
        {
          id: 'open-tab',
          label: this.t('webapp.open_new_tab'),
          action: () => window.open(this.getEffectiveSrc(), '_blank', 'noopener,noreferrer')
        }
      ];

      const flags = Array.isArray(this.manifest.rendererFlags) ? this.manifest.rendererFlags : [];
      if (flags.length > 0) {
        viewItems.push({ separator: true });
        viewItems.push({
          id: 'renderer-auto',
          label: this.t('webapp.renderer_auto'),
          action: () => this.setRendererFlag('')
        });
        flags.forEach((f) => {
          if (!f || !f.flag) return;
          viewItems.push({
            id: `renderer-${f.flag}`,
            label: `🎨 ${f.label || f.flag} (?${f.flag})`,
            action: () => this.setRendererFlag(f.flag)
          });
        });
      }

      const windowItems = [
        {
          id: 'minimize',
          label: this.t('webapp.win_minimize'),
          action: () => {
            if (window.WindowManager && typeof window.WindowManager.minimizeWindow === 'function') {
              window.WindowManager.minimizeWindow(this.windowId);
            }
          }
        },
        {
          id: 'maximize',
          label: this.t('webapp.win_maximize'),
          action: () => {
            if (window.WindowManager && typeof window.WindowManager.toggleMaximize === 'function') {
              window.WindowManager.toggleMaximize(this.windowId);
            }
          }
        },
        { separator: true },
        {
          id: 'close',
          label: this.t('webapp.win_close'),
          action: () => {
            if (window.WindowManager && typeof window.WindowManager.closeWindow === 'function') {
              window.WindowManager.closeWindow(this.windowId);
            }
          }
        }
      ];

      return [
        { id: 'app-badge', badge: true, iconHtml: this.getAppIconHtml(), label: this.getAppTitle() },
        { id: 'file', label: this.t('webapp.menu_file'), items: fileItems },
        { id: 'view', label: this.t('webapp.menu_view'), items: viewItems },
        { id: 'window', label: this.t('webapp.menu_window'), items: windowItems }
      ];
    }

    registerMenus() {
      if (window.MenuBarManager && typeof window.MenuBarManager.registerAppMenu === 'function') {
        window.MenuBarManager.registerAppMenu(this.id, this.buildMenuBarDefinition());
      }
    }

    refreshMenus() {
      if (window.MenuBarManager && typeof window.MenuBarManager.registerAppMenu === 'function') {
        window.MenuBarManager.registerAppMenu(this.id, this.buildMenuBarDefinition());
      }
    }

    extractFileArg(fileOrParams, options) {
      if (fileOrParams && typeof fileOrParams === 'object') {
        if (fileOrParams.file && typeof fileOrParams.file === 'object') {
          return fileOrParams.file;
        }
        if (fileOrParams.path || fileOrParams.file_url || fileOrParams.name) {
          return fileOrParams;
        }
      }
      if (options && options.file && typeof options.file === 'object') {
        return options.file;
      }
      return null;
    }

    open(fileOrParams = {}, options = {}) {
      const file = this.extractFileArg(fileOrParams, options);
      if (file) {
        this.activeFile = file;
      }

      if (fileOrParams && typeof fileOrParams === 'object' && typeof fileOrParams.renderer === 'string') {
        this.activeRendererFlag = fileOrParams.renderer;
      }

      const appTitle = this.getAppTitle();
      const winTitle = this.activeFile && this.activeFile.name
        ? `${appTitle} — ${this.activeFile.name}`
        : appTitle;

      const wm = window.WindowManager;
      if (!wm || typeof wm.createWindow !== 'function') {
        window.open(this.getEffectiveSrc(), '_blank', 'noopener,noreferrer');
        return;
      }

      const existingWin = wm.windows && wm.windows.get(this.windowId);
      if (existingWin && existingWin.element && document.body.contains(existingWin.element)) {
        if (typeof wm.restoreWindow === 'function' && existingWin.isMinimized) {
          wm.restoreWindow(this.windowId);
        }
        if (typeof wm.focusWindow === 'function') {
          wm.focusWindow(this.windowId);
        }
        if (typeof wm.setTitle === 'function') {
          wm.setTitle(this.windowId, winTitle);
        }
        this.refreshMenus();
        if (file) {
          this.injectFileIntoIframe(file);
        }
        return existingWin;
      }

      const winCfg = this.manifest.window || {};
      const width = Math.min(winCfg.width || 1180, Math.max(640, (window.innerWidth || 1280) - 80));
      const height = Math.min(winCfg.height || 760, Math.max(480, (window.innerHeight || 800) - 110));

      this.iframeLoaded = false;

      const filePassedViaQuery = !!(file && this.manifest && this.manifest.openFileParam);
      const effectiveSrc = this.getEffectiveSrc(filePassedViaQuery ? file : null);
      const flags = Array.isArray(this.manifest.rendererFlags) ? this.manifest.rendererFlags : [];
      const rendererBtnsHtml = flags.map(f =>
        `<button type="button" class="webapp-boot-btn" data-webapp-action="renderer:${this.escapeHtml(f.flag)}">🎨 ${this.escapeHtml(f.label || f.flag)}</button>`
      ).join('');

      const contentHtml = `
        <div class="webapp-iframe-host" data-webapp-id="${this.escapeHtml(this.id)}">
          <div id="webappBootOverlay-${this.escapeHtml(this.id)}" class="webapp-boot-overlay">
            <div class="webapp-boot-icon">${this.getAppIconHtml()}</div>
            <div class="webapp-boot-spinner"></div>
            <div class="webapp-boot-title">${this.escapeHtml(this.t('webapp.loading', { app: appTitle }))}</div>
            <div class="webapp-boot-hint" style="display:none;"></div>
            <div class="webapp-boot-actions" style="display:none;">
              <button type="button" class="webapp-boot-btn" data-webapp-action="retry">${this.escapeHtml(this.t('webapp.retry'))}</button>
              ${rendererBtnsHtml}
              <button type="button" class="webapp-boot-btn" data-webapp-action="new-tab">${this.escapeHtml(this.t('webapp.open_new_tab'))}</button>
            </div>
          </div>
          <iframe
            id="webappIframe-${this.escapeHtml(this.id)}"
            class="webapp-iframe"
            src="${this.escapeHtml(effectiveSrc)}"
            title="${this.escapeHtml(appTitle)}"
            sandbox="allow-scripts allow-same-origin allow-downloads allow-popups allow-forms allow-modals"
            allow="fullscreen; clipboard-read; clipboard-write"
            allowfullscreen
          ></iframe>
        </div>
      `;

      this.win = wm.createWindow({
        id: this.windowId,
        appId: this.id,
        appName: appTitle,
        title: winTitle,
        icon: this.getAppIconHtml(),
        width,
        height,
        resizable: winCfg.resizable !== false,
        content: contentHtml,
        onFocus: () => {
          this.refreshMenus();
          if (window.MenuBarManager && typeof window.MenuBarManager.setActiveApp === 'function') {
            window.MenuBarManager.setActiveApp(this.id, { windowId: this.windowId });
          }
        },
        onClose: () => {
          if (this._slowTimer) clearTimeout(this._slowTimer);
          if (this._bootPollTimer) clearInterval(this._bootPollTimer);
          this.iframeLoaded = false;
          this.win = null;
        }
      });

      this.refreshMenus();

      const iframe = this.getIframeElement();
      if (iframe) {
        this.bindBootLifecycle(iframe, filePassedViaQuery);
      }

      return this.win;
    }

    reload() {
      const iframe = this.getIframeElement();
      if (!iframe) return;
      this.iframeLoaded = false;
      this.showBootOverlay('');
      const filePassedViaQuery = !!(this.activeFile && this.manifest && this.manifest.openFileParam);
      iframe.src = this.getEffectiveSrc(filePassedViaQuery ? this.activeFile : null);
      this.bindBootLifecycle(iframe, filePassedViaQuery);
    }

    setRendererFlag(flag) {
      this.activeRendererFlag = flag || '';
      this.reload();
    }

    toggleFullscreen() {
      const iframe = this.getIframeElement();
      if (iframe && typeof iframe.requestFullscreen === 'function') {
        if (document.fullscreenElement) {
          document.exitFullscreen?.();
        } else {
          iframe.requestFullscreen().catch(() => {
            if (window.WindowManager && typeof window.WindowManager.toggleMaximize === 'function') {
              window.WindowManager.toggleMaximize(this.windowId);
            }
          });
        }
      } else if (window.WindowManager && typeof window.WindowManager.toggleMaximize === 'function') {
        window.WindowManager.toggleMaximize(this.windowId);
      }
    }

    resolveFileUrl(file) {
      if (!file) return '';
      if (file.file_url) return file.file_url;
      if (file.path) return `system/endpoints/thumb.php?file=${encodeURIComponent(file.path)}&raw=1`;
      return '';
    }

    guessMimeType(file) {
      if (file && file.mime) return file.mime;
      const ext = ((file && file.extension) || (file && file.name && file.name.includes('.') ? file.name.split('.').pop() : '') || '').toLowerCase();
      const map = {
        psd: 'image/vnd.adobe.photoshop',
        psb: 'image/vnd.adobe.photoshop',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
        bmp: 'image/bmp',
        svg: 'image/svg+xml',
        tiff: 'image/tiff',
        tif: 'image/tiff',
        pdf: 'application/pdf',
        mp4: 'video/mp4',
        mp3: 'audio/mpeg',
        wav: 'audio/wav'
      };
      return map[ext] || 'application/octet-stream';
    }

    /**
     * Waits until the iframe document (and any WASM loading screen) is ready to accept dropped files.
     */
    async waitForIframeReady(iframe, timeoutMs = 15000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        try {
          const doc = iframe.contentDocument;
          if (doc && doc.readyState === 'complete' && doc.body) {
            const loadingEl = doc.querySelector('[id$="_loading"], .loading, .preloader');
            const isStillLoading = !!(loadingEl && loadingEl.offsetParent !== null && !loadingEl.hidden);
            if (!isStillLoading) {
              return doc;
            }
          }
        } catch (e) {
          return null;
        }
        await new Promise(r => setTimeout(r, 250));
      }
      try {
        return iframe.contentDocument || null;
      } catch (e) {
        return null;
      }
    }

    /**
     * Bridges a SimpleGallery file into the embedded standalone web app via:
     * 1. Synthetic HTML5 DragEvent('dragenter'/'dragover'/'drop') with a real File object
     * 2. Standard postMessage({ type: 'webos:open-file', ... })
     */
    async injectFileIntoIframe(file) {
      if (!file) return false;
      const iframe = this.getIframeElement();
      if (!iframe) return false;

      const fileUrl = this.resolveFileUrl(file);
      if (!fileUrl) return false;

      const appTitle = this.getAppTitle();
      if (window.sys && window.sys.toast && typeof window.sys.toast.info === 'function') {
        window.sys.toast.info(this.t('webapp.opening_file', { name: file.name || file.path, app: appTitle }));
      }

      try {
        const doc = await this.waitForIframeReady(iframe);
        const resp = await fetch(fileUrl, { credentials: 'same-origin' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const mime = this.guessMimeType(file) || blob.type || 'application/octet-stream';
        const fileName = file.name || (file.path ? file.path.split('/').pop() : 'document');
        const fileObj = new File([blob], fileName, { type: mime });

        // 1. Standard WebOS postMessage bridge
        if (iframe.contentWindow && typeof iframe.contentWindow.postMessage === 'function') {
          iframe.contentWindow.postMessage({
            type: 'webos:open-file',
            file: {
              name: fileName,
              path: file.path || '',
              url: fileUrl,
              extension: file.extension || '',
              mime
            }
          }, window.location.origin);
        }

        // 2. Synthetic Drag & Drop File injection (works natively with egui/eframe/WASM & modern web editors)
        if (doc && typeof window.DataTransfer === 'function' && typeof window.DragEvent === 'function') {
          const dt = new window.DataTransfer();
          dt.items.add(fileObj);

          const target = doc.querySelector('canvas') || doc.body || doc.documentElement;
          if (target) {
            ['dragenter', 'dragover', 'drop'].forEach((evtType) => {
              const evt = new window.DragEvent(evtType, {
                bubbles: true,
                cancelable: true,
                dataTransfer: dt
              });
              target.dispatchEvent(evt);
            });
          }
        }

        if (window.sys && window.sys.toast && typeof window.sys.toast.success === 'function') {
          window.sys.toast.success(this.t('webapp.file_sent', { name: fileName, app: appTitle }));
        }
        return true;
      } catch (err) {
        console.warn(`[WebAppHost:${this.id}] File bridge failed:`, err);
        if (window.sys && window.sys.toast && typeof window.sys.toast.error === 'function') {
          window.sys.toast.error(this.t('webapp.file_send_error', { name: file.name || '', app: appTitle }));
        }
        return false;
      }
    }

    handleCommand(command, params = {}) {
      switch (command) {
        case 'reload':
          this.reload();
          return true;
        case 'fullscreen':
          this.toggleFullscreen();
          return true;
        case 'setRenderer':
          this.setRendererFlag(params.flag || '');
          return true;
        case 'openFile':
          if (params.file) {
            this.open(params.file);
            return true;
          }
          return false;
        default:
          return false;
      }
    }
  }

  class WebAppHostManager {
    constructor() {
      this.instances = new Map();
    }

    isStandaloneWebApp(appInfo) {
      if (!appInfo || typeof appInfo !== 'object') return false;
      const manifest = appInfo.manifest || {};
      return (
        appInfo.distribution === 'standalone-web' ||
        manifest.distribution === 'standalone-web' ||
        manifest.runtime === 'iframe' ||
        (!appInfo.js_entry && !!(appInfo.html_entry || (manifest.entry && manifest.entry.html)))
      );
    }

    mountApp(appInfo) {
      if (!this.isStandaloneWebApp(appInfo)) return null;
      const appId = (appInfo.manifest && appInfo.manifest.id) || appInfo.id;
      if (!appId) return null;

      if (this.instances.has(appId)) {
        return this.instances.get(appId);
      }

      const instance = new StandaloneWebAppInstance(appInfo);
      this.instances.set(appId, instance);

      // 1. Register in AppManager (Launcher, Start Menu, Taskbar, Settings, Autostart, Shortcuts)
      if (window.sys && window.sys.appManager) {
        const am = window.sys.appManager;
        if (typeof am.registerApp === 'function') {
          am.registerApp(instance.manifest, instance);
        }
        if (typeof am.registerInstance === 'function') {
          am.registerInstance(appId, instance);
        }
      }

      // 2. Register contextual MenuBar definition
      instance.registerMenus();

      // 3. Register File Associations in MediaViewerRegistry (lower priority than built-in viewers)
      const exts = Array.isArray(instance.manifest.extensions) ? instance.manifest.extensions : [];
      const mimes = Array.isArray(instance.manifest.mimeTypes) ? instance.manifest.mimeTypes : [];
      if (window.MediaViewerRegistry && typeof window.MediaViewerRegistry.register === 'function' && (exts.length > 0 || mimes.length > 0)) {
        window.MediaViewerRegistry.register({
          id: appId,
          name: instance.name,
          icon: instance.getAppIconHtml(),
          priority: 50,
          extensions: exts,
          mimeTypes: mimes,
          open: (file, opts) => instance.open(file, opts)
        });
      }

      return instance;
    }

    mountDiscoveredApps(discoveredMap) {
      const discovered = discoveredMap || (typeof window !== 'undefined' && window.SG_DISCOVERED_APPS) || {};
      if (!discovered || typeof discovered !== 'object') return [];

      const mounted = [];
      Object.values(discovered).forEach((appInfo) => {
        const inst = this.mountApp(appInfo);
        if (inst) mounted.push(inst);
      });
      return mounted;
    }

    get(appId) {
      return this.instances.get(appId) || null;
    }
  }

  const hostManager = new WebAppHostManager();
  window.StandaloneWebAppInstance = StandaloneWebAppInstance;
  window.WebAppHost = hostManager;
  window.sys = window.sys || {};
  window.sys.webAppHost = hostManager;

  // Mount immediately if SG_DISCOVERED_APPS is already available, and also on DOMContentLoaded
  hostManager.mountDiscoveredApps();
  if (document && typeof document.addEventListener === 'function') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => hostManager.mountDiscoveredApps());
    }
  }
})(window);
