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

    getEffectiveSrc() {
      if (!this.htmlEntry) return 'about:blank';
      if (this.activeRendererFlag) {
        const sep = this.htmlEntry.includes('?') ? '&' : '?';
        return `${this.htmlEntry}${sep}${encodeURIComponent(this.activeRendererFlag)}`;
      }
      return this.htmlEntry;
    }

    getIframeElement() {
      return document.getElementById(`webappIframe-${this.id}`);
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

      const contentHtml = `
        <div class="webapp-iframe-host" data-webapp-id="${this.escapeHtml(this.id)}" style="position:relative;width:100%;height:100%;overflow:hidden;background:#1e1e1e;">
          <iframe
            id="webappIframe-${this.escapeHtml(this.id)}"
            class="webapp-iframe"
            src="${this.escapeHtml(this.getEffectiveSrc())}"
            title="${this.escapeHtml(appTitle)}"
            sandbox="allow-scripts allow-same-origin allow-downloads allow-popups allow-forms allow-modals"
            allow="fullscreen; clipboard-read; clipboard-write"
            allowfullscreen
            style="width:100%;height:100%;border:0;display:block;"
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
          this.iframeLoaded = false;
          this.win = null;
        }
      });

      this.refreshMenus();

      const iframe = this.getIframeElement();
      if (iframe) {
        iframe.addEventListener('load', () => {
          this.iframeLoaded = true;
          if (this.activeFile) {
            this.injectFileIntoIframe(this.activeFile);
          }
        });
      }

      return this.win;
    }

    reload() {
      const iframe = this.getIframeElement();
      if (!iframe) return;
      this.iframeLoaded = false;
      iframe.src = this.getEffectiveSrc();
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
