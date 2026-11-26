/**
 * SimpleGallery Userland - Bidirectional VFS Bridge for Embedded Standalone Web Apps
 * (FEAT-06: WebAppVfsBridge)
 *
 * Bridges same-origin third-party HTML/JS/WASM applications (e.g. ArtCraft, PdfCraft, PixelCraft)
 * directly to the SimpleGallery VFS so users can open and save gallery files natively without
 * manual download/upload round-trips:
 *   1. Open Hook  : Intercepts <input type="file">.click() and window.showOpenFilePicker()
 *   2. Save Hook  : Intercepts window.showSaveFilePicker() and <a download href="blob:..."> clicks
 *   3. Blob Cache : Captures URL.createObjectURL(blob) objects before immediate revocation
 *   4. postMessage: Standardized `webos:vfs-pick` / `webos:vfs-save` protocol for cooperative apps
 */
(function (window) {
  'use strict';

  const STORAGE_PREFIX = 'sg_vfs_bridge_enabled_';
  const MAX_TRACKED_BLOBS = 32;

  function translate(key, replacements = {}) {
    if (window.I18nEngine && typeof window.I18nEngine.t === 'function') {
      return window.I18nEngine.t(key, replacements);
    }
    if (window.sys && window.sys.i18n && typeof window.sys.i18n.t === 'function') {
      return window.sys.i18n.t(key, replacements);
    }
    if (window.desktop && typeof window.desktop.t === 'function') {
      return window.desktop.t(key, replacements);
    }
    return key;
  }

  function showToast(level, msg) {
    const t = (window.sys && window.sys.toast) || (window.sys && window.sys.ui && window.sys.ui.toast);
    if (t && typeof t[level] === 'function') {
      t[level](msg);
    }
  }

  function getCurrentExplorerDir() {
    return (window.explorerApp && window.explorerApp.state && window.explorerApp.state.currentDir) || '';
  }

  function refreshExplorerIfVisible(dir) {
    if (window.explorerApp && typeof window.explorerApp.loadDirectory === 'function') {
      const cur = getCurrentExplorerDir();
      if (dir === cur || !dir) {
        window.explorerApp.loadDirectory(cur);
      }
    }
  }

  /**
   * Convert W3C showOpenFilePicker / showSaveFilePicker `types` array to an HTML `accept` string.
   */
  function pickerTypesToAccept(pickerOptions) {
    if (!pickerOptions || !Array.isArray(pickerOptions.types) || pickerOptions.types.length === 0) {
      return '*/*';
    }
    const tokens = [];
    pickerOptions.types.forEach((t) => {
      if (!t || !t.accept || typeof t.accept !== 'object') return;
      Object.entries(t.accept).forEach(([mime, exts]) => {
        if (Array.isArray(exts) && exts.length > 0) {
          exts.forEach((e) => { if (e) tokens.push(String(e)); });
        } else if (mime) {
          tokens.push(String(mime));
        }
      });
    });
    return tokens.length > 0 ? Array.from(new Set(tokens)).join(',') : '*/*';
  }

  function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl).split(',');
    const header = parts[0] || '';
    const data = parts[1] || '';
    const mimeMatch = header.match(/data:([^;]+)/i);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const isBase64 = /;base64/i.test(header);
    if (isBase64) {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(data)], { type: mime });
  }

  /**
   * Resolves effective VFS bridge configuration for a StandaloneWebAppInstance.
   * Manifest/config override:
   *   "vfsBridge": false | true | { "enabled": true, "hookOpen": true, "hookSave": true }
   */
  function getBridgeConfig(appInstance) {
    const manifest = (appInstance && appInstance.manifest) || {};
    const decl = manifest.vfsBridge;
    const cfg = {
      enabled: true,
      hookOpen: true,
      hookSave: true
    };

    if (decl === false) {
      cfg.enabled = false;
      cfg.hookOpen = false;
      cfg.hookSave = false;
    } else if (decl && typeof decl === 'object') {
      if (decl.enabled === false) cfg.enabled = false;
      if (decl.hookOpen === false) cfg.hookOpen = false;
      if (decl.hookSave === false) cfg.hookSave = false;
    }

    // User per-app toggle persisted in user-scoped localStorage
    try {
      if (appInstance && appInstance.id && window.localStorage) {
        const scope = (window.sys && window.sys.storage && typeof window.sys.storage.getUserScope === 'function')
          ? window.sys.storage.getUserScope()
          : (window.SG_CURRENT_USER && window.SG_CURRENT_USER.id ? `u_${window.SG_CURRENT_USER.id}` : (window.IS_ADMIN ? 'admin' : 'guest'));
        let stored = window.localStorage.getItem(`sg_vfs_bridge_${scope}_${appInstance.id}`);
        if (stored === null && !scope.startsWith('u_')) {
          stored = window.localStorage.getItem(STORAGE_PREFIX + appInstance.id);
        }
        if (stored === '0') cfg.enabled = false;
        else if (stored === '1') cfg.enabled = true;
      }
    } catch (e) {}

    return cfg;
  }

  function setUserBridgeEnabled(appId, enabled) {
    try {
      if (appId && window.localStorage) {
        const scope = (window.sys && window.sys.storage && typeof window.sys.storage.getUserScope === 'function')
          ? window.sys.storage.getUserScope()
          : (window.SG_CURRENT_USER && window.SG_CURRENT_USER.id ? `u_${window.SG_CURRENT_USER.id}` : (window.IS_ADMIN ? 'admin' : 'guest'));
        window.localStorage.setItem(`sg_vfs_bridge_${scope}_${appId}`, enabled ? '1' : '0');
      }
    } catch (e) {}
  }

  async function fetchVfsFileAsBlob(appInstance, file) {
    const fileUrl = appInstance && typeof appInstance.resolveFileUrl === 'function'
      ? appInstance.resolveFileUrl(file)
      : (file.file_url || `system/endpoints/thumb.php?file=${encodeURIComponent(file.path || '')}&raw=1`);

    const fetchFn = (window && typeof window.fetch === 'function') ? window.fetch.bind(window) : fetch;
    const resp = await fetchFn(fileUrl, { credentials: 'same-origin' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const mime = (appInstance && typeof appInstance.guessMimeType === 'function' && appInstance.guessMimeType(file))
      || blob.type
      || 'application/octet-stream';
    const fileName = file.name || (file.path ? file.path.split('/').pop() : 'document');
    return { blob, mime, fileName, fileUrl };
  }

  async function uploadBlobToVfs(blob, dir, filename, overwrite = true) {
    const api = (window.sys && window.sys.api);
    if (!api || typeof api.upload !== 'function') {
      return { success: false, error: translate('vfs.upload_unavailable') };
    }
    const FormDataCtor = (window && window.FormData) || FormData;
    const fd = new FormDataCtor();
    fd.append('dir', dir || '');
    fd.append('overwrite', overwrite ? '1' : '0');
    fd.append('file', blob, filename);

    const res = await api.upload('upload_file', fd);
    if (res && res.success) {
      refreshExplorerIfVisible(dir || '');
      return { success: true, path: dir ? `${dir}/${filename}` : filename, data: res };
    }
    const serverErr = (res && res.error)
      || (res && Array.isArray(res.errors) && res.errors.length > 0 ? res.errors.join(' ') : '')
      || (res && res.message)
      || '';
    return { success: false, error: serverErr || translate('vfs.save_denied') };
  }

  /**
   * Wraps an async operation in the iframe's OWN `cw.Promise` constructor so Rust/wasm-bindgen
   * (`JsFuture::from`, which checks `val instanceof iframe.Promise`) accepts it natively.
   */
  function toIframePromise(cw, fnOrPromise) {
    const PromiseCtor = (cw && typeof cw.Promise === 'function') ? cw.Promise : Promise;
    return new PromiseCtor((resolve, reject) => {
      Promise.resolve()
        .then(() => (typeof fnOrPromise === 'function' ? fnOrPromise() : fnOrPromise))
        .then(resolve, reject);
    });
  }

  function splitVfsPath(fullPath) {
    const raw = String(fullPath || '').replace(/\\/g, '/').trim();
    if (!raw) return { dir: '', filename: '' };
    const extMatch = raw.match(/^(ext:\/\/\d+)(?:\/(.*))?$/i);
    if (extMatch) {
      const mountRoot = extMatch[1];
      const rest = (extMatch[2] || '').replace(/^\/+/, '');
      if (!rest) return { dir: mountRoot, filename: '' };
      const idx = rest.lastIndexOf('/');
      if (idx === -1) return { dir: mountRoot, filename: rest };
      return { dir: `${mountRoot}/${rest.slice(0, idx)}`, filename: rest.slice(idx + 1) };
    }
    const clean = raw.replace(/^\/+/, '');
    const idx = clean.lastIndexOf('/');
    if (idx === -1) return { dir: '', filename: clean };
    return { dir: clean.slice(0, idx), filename: clean.slice(idx + 1) };
  }

  /**
   * Builds a W3C-compatible FileSystemFileHandle backed by the SimpleGallery VFS.
   * Supports both reading (`getFile()`) and saving back to the gallery (`createWritable()`).
   * All Promise-returning methods return `cw.Promise` instances for cross-realm WASM compatibility.
   */
  function createVirtualFileHandle(cw, appInstance, meta) {
    const split = splitVfsPath(meta.path || '');
    const dir = meta.dir !== undefined ? meta.dir : split.dir;
    const fileName = meta.filename || meta.name || split.filename || 'document';
    const overwrite = meta.overwrite !== false;
    let cachedFileObj = meta.fileObj || null;

    return {
      kind: 'file',
      name: fileName,
      queryPermission() { return toIframePromise(cw, 'granted'); },
      requestPermission() { return toIframePromise(cw, 'granted'); },
      isSameEntry(other) { return toIframePromise(cw, Boolean(other && other.name === fileName)); },
      getFile() {
        return toIframePromise(cw, async () => {
          if (cachedFileObj) return cachedFileObj;
          const { blob, mime } = await fetchVfsFileAsBlob(appInstance, meta);
          const FileCtor = (cw && cw.File) || window.File;
          cachedFileObj = new FileCtor([blob], fileName, { type: mime });
          return cachedFileObj;
        });
      },
      createWritable() {
        return toIframePromise(cw, () => {
          const chunks = [];
          let closed = false;
          return {
            write(data) {
              return toIframePromise(cw, () => {
                if (closed) return;
                if (data && typeof data === 'object' && data.type === 'write' && data.data !== undefined) {
                  chunks.push(data.data);
                } else if (data && typeof data === 'object' && data.type === 'truncate') {
                  chunks.length = 0;
                } else if (data !== undefined && data !== null) {
                  chunks.push(data);
                }
              });
            },
            seek() { return toIframePromise(cw, undefined); },
            truncate() { return toIframePromise(cw, () => { chunks.length = 0; }); },
            abort() { return toIframePromise(cw, () => { closed = true; chunks.length = 0; }); },
            close() {
              return toIframePromise(cw, async () => {
                if (closed) return;
                closed = true;
                const BlobCtor = (cw && cw.Blob) || window.Blob;
                const mime = (meta && meta.mime) || 'application/octet-stream';
                const finalBlob = new BlobCtor(chunks, { type: mime });
                const res = await uploadBlobToVfs(finalBlob, dir, fileName, overwrite);
                if (res.success) {
                  const FileCtor = (cw && cw.File) || window.File;
                  cachedFileObj = new FileCtor([finalBlob], fileName, { type: mime });
                  showToast('success', translate('vfs.saved_to_gallery', { name: fileName }));
                } else {
                  showToast('error', res.error || translate('vfs.save_denied'));
                  throw new Error(res.error || 'VFS save failed');
                }
              });
            }
          };
        });
      }
    };
  }

  class WebAppVfsBridge {
    constructor() {
      this._messageListenerBound = false;
    }

    getBridgeConfig(appInstance) {
      return getBridgeConfig(appInstance);
    }

    isEnabledForApp(appInstance) {
      return getBridgeConfig(appInstance).enabled;
    }

    setEnabledForApp(appId, enabled) {
      setUserBridgeEnabled(appId, enabled);
    }

    pickerTypesToAccept(pickerOptions) {
      return pickerTypesToAccept(pickerOptions);
    }

    /**
     * Checks whether the iframe's contentWindow is same-origin and accessible.
     */
    isSameOriginIframe(iframe) {
      if (!iframe) return false;
      try {
        const cw = iframe.contentWindow;
        if (!cw) return false;
        // Accessing origin/document throws SecurityError on cross-origin frames
        const sameOrigin = !window.location || !cw.location || cw.location.origin === window.location.origin;
        return Boolean(sameOrigin && cw.document);
      } catch (e) {
        return false;
      }
    }

    /**
     * Installs non-destructive VFS Open & Save hooks inside a same-origin standalone app iframe.
     * Safe to call multiple times (idempotent per iframe contentWindow).
     */
    attachToIframe(iframe, appInstance) {
      if (!iframe || !appInstance) return false;
      if (!this.isSameOriginIframe(iframe)) return false;

      let cw;
      try {
        cw = iframe.contentWindow;
      } catch (e) {
        return false;
      }
      if (!cw || cw.__sgVfsBridgeInstalled) return Boolean(cw && cw.__sgVfsBridgeInstalled);

      cw.__sgVfsBridgeInstalled = true;
      const appTitle = typeof appInstance.getAppTitle === 'function' ? appInstance.getAppTitle() : appInstance.id;

      // 1. Track blob: URLs created inside the iframe so exports can be captured even if revoked immediately
      const blobRegistry = new Map();
      if (cw.URL && typeof cw.URL.createObjectURL === 'function') {
        const origCreateObjectURL = cw.URL.createObjectURL.bind(cw.URL);
        const origRevokeObjectURL = typeof cw.URL.revokeObjectURL === 'function'
          ? cw.URL.revokeObjectURL.bind(cw.URL)
          : null;

        cw.URL.createObjectURL = function (obj) {
          const url = origCreateObjectURL(obj);
          if (obj && (typeof Blob === 'undefined' || obj instanceof Blob || (cw.Blob && obj instanceof cw.Blob))) {
            blobRegistry.set(url, obj);
            if (blobRegistry.size > MAX_TRACKED_BLOBS) {
              const oldestKey = blobRegistry.keys().next().value;
              blobRegistry.delete(oldestKey);
            }
          }
          return url;
        };

        if (origRevokeObjectURL) {
          cw.URL.revokeObjectURL = function (url) {
            // Defer deletion slightly so async Save Hook can still read the captured blob
            setTimeout(() => blobRegistry.delete(url), 15000);
            return origRevokeObjectURL(url);
          };
        }
      }

      // 2. OPEN HOOK A: Intercept <input type="file">.click()
      if (cw.HTMLInputElement && cw.HTMLInputElement.prototype && typeof cw.HTMLInputElement.prototype.click === 'function') {
        const origInputClick = cw.HTMLInputElement.prototype.click;

        cw.HTMLInputElement.prototype.click = function () {
          const cfg = getBridgeConfig(appInstance);
          const isFileInput = this && String(this.type || '').toLowerCase() === 'file';
          if (!isFileInput || this.__sgBypassVfsHook || !cfg.enabled || !cfg.hookOpen || !window.sys || typeof window.sys.pickFile !== 'function') {
            return origInputClick.apply(this, arguments);
          }

          const inputEl = this;
          const accept = inputEl.accept || '*/*';
          const multiple = Boolean(inputEl.multiple);

          window.sys.pickFile({
            title: translate('vfs.open_for_app', { app: appTitle }),
            initialPath: getCurrentExplorerDir(),
            accept,
            multiple,
            allowLocalFallback: true
          }).then(async (picked) => {
            if (!picked) {
              try { inputEl.dispatchEvent(new cw.Event('cancel', { bubbles: false })); } catch (e) {}
              return;
            }
            if (picked.__localFallback) {
              inputEl.__sgBypassVfsHook = true;
              try {
                origInputClick.call(inputEl);
              } finally {
                setTimeout(() => { inputEl.__sgBypassVfsHook = false; }, 100);
              }
              return;
            }

            const filesList = Array.isArray(picked) ? picked : [picked];
            const DTCtor = cw.DataTransfer || window.DataTransfer;
            const FileCtor = cw.File || window.File;
            const dt = new DTCtor();

            for (const f of filesList) {
              const { blob, mime, fileName } = await fetchVfsFileAsBlob(appInstance, f);
              dt.items.add(new FileCtor([blob], fileName, { type: mime }));
            }

            if (filesList[0]) {
              appInstance.activeFile = filesList[0];
              if (typeof appInstance.refreshMenus === 'function') appInstance.refreshMenus();
            }

            try {
              inputEl.files = dt.files;
            } catch (err) {
              Object.defineProperty(inputEl, 'files', { value: dt.files, configurable: true });
            }
            inputEl.dispatchEvent(new cw.Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new cw.Event('change', { bubbles: true }));
          }).catch((err) => {
            console.warn(`[WebAppVfsBridge:${appInstance.id}] Open hook failed:`, err);
            showToast('error', translate('vfs.open_error'));
          });
        };
      }

      // 3. OPEN HOOK B: Intercept window.showOpenFilePicker() (File System Access API)
      // Returns `cw.Promise` so cross-realm Rust/wasm-bindgen `JsFuture` accepts it natively.
      const origShowOpenFilePicker = typeof cw.showOpenFilePicker === 'function' ? cw.showOpenFilePicker.bind(cw) : null;
      cw.showOpenFilePicker = function (pickerOpts = {}) {
        return toIframePromise(cw, async () => {
          const cfg = getBridgeConfig(appInstance);
          if (!cfg.enabled || !cfg.hookOpen || !window.sys || typeof window.sys.pickFile !== 'function') {
            if (origShowOpenFilePicker) return origShowOpenFilePicker(pickerOpts);
            throw new (cw.DOMException || DOMException)('File picker unavailable', 'NotSupportedError');
          }

          const picked = await window.sys.pickFile({
            title: translate('vfs.open_for_app', { app: appTitle }),
            initialPath: getCurrentExplorerDir(),
            accept: pickerTypesToAccept(pickerOpts),
            multiple: Boolean(pickerOpts && pickerOpts.multiple),
            allowLocalFallback: Boolean(origShowOpenFilePicker)
          });

          if (!picked) {
            throw new (cw.DOMException || DOMException)('The user aborted a request.', 'AbortError');
          }
          if (picked.__localFallback && origShowOpenFilePicker) {
            return origShowOpenFilePicker(pickerOpts);
          }

          const list = Array.isArray(picked) ? picked : [picked];
          if (list[0]) {
            appInstance.activeFile = list[0];
            if (typeof appInstance.refreshMenus === 'function') appInstance.refreshMenus();
          }
          return list.map((f) => createVirtualFileHandle(cw, appInstance, f));
        });
      };

      // 4. SAVE HOOK A: Intercept window.showSaveFilePicker() (File System Access API)
      // Returns `cw.Promise` so cross-realm Rust/wasm-bindgen `JsFuture` accepts it natively.
      const origShowSaveFilePicker = typeof cw.showSaveFilePicker === 'function' ? cw.showSaveFilePicker.bind(cw) : null;
      cw.showSaveFilePicker = function (pickerOpts = {}) {
        return toIframePromise(cw, async () => {
          const cfg = getBridgeConfig(appInstance);
          if (!cfg.enabled || !cfg.hookSave || !window.sys || typeof window.sys.pickSaveLocation !== 'function') {
            if (origShowSaveFilePicker) return origShowSaveFilePicker(pickerOpts);
            throw new (cw.DOMException || DOMException)('Save picker unavailable', 'NotSupportedError');
          }

          const suggestedName = (pickerOpts && pickerOpts.suggestedName)
            || (appInstance.activeFile && appInstance.activeFile.name)
            || 'export.png';

          const dest = await window.sys.pickSaveLocation({
            title: translate('vfs.save_for_app', { app: appTitle }),
            initialPath: getCurrentExplorerDir(),
            suggestedName,
            allowLocalFallback: Boolean(origShowSaveFilePicker)
          });

          if (!dest) {
            throw new (cw.DOMException || DOMException)('The user aborted a request.', 'AbortError');
          }
          if (dest.__localFallback && origShowSaveFilePicker) {
            return origShowSaveFilePicker(pickerOpts);
          }

          return createVirtualFileHandle(cw, appInstance, {
            dir: dest.dir,
            filename: dest.filename,
            overwrite: dest.overwrite
          });
        });
      };

      // 5. SAVE HOOK B: Intercept <a download href="blob:...|data:..."> clicks (WASM / canvas exports)
      if (cw.HTMLAnchorElement && cw.HTMLAnchorElement.prototype && typeof cw.HTMLAnchorElement.prototype.click === 'function') {
        const origAnchorClick = cw.HTMLAnchorElement.prototype.click;

        cw.HTMLAnchorElement.prototype.click = function () {
          const cfg = getBridgeConfig(appInstance);
          const href = String(this.getAttribute ? (this.getAttribute('href') || '') : (this.href || ''));
          const isDownload = this && typeof this.hasAttribute === 'function' && this.hasAttribute('download');
          const isExportUrl = href.startsWith('blob:') || href.startsWith('data:');

          if (!isDownload || !isExportUrl || this.__sgBypassVfsHook || !cfg.enabled || !cfg.hookSave || !window.sys || typeof window.sys.pickSaveLocation !== 'function') {
            return origAnchorClick.apply(this, arguments);
          }

          const anchorEl = this;
          const suggestedName = anchorEl.getAttribute('download') || (appInstance.activeFile && appInstance.activeFile.name) || 'export.png';

          // Capture Blob immediately before the app revokes the object URL
          let blobPromise;
          if (href.startsWith('blob:') && blobRegistry.has(href)) {
            blobPromise = Promise.resolve(blobRegistry.get(href));
          } else if (href.startsWith('data:')) {
            blobPromise = Promise.resolve(dataUrlToBlob(href));
          } else {
            blobPromise = cw.fetch(href).then((r) => r.blob());
          }

          blobPromise.then(async (capturedBlob) => {
            const dest = await window.sys.pickSaveLocation({
              title: translate('vfs.save_for_app', { app: appTitle }),
              initialPath: getCurrentExplorerDir(),
              suggestedName,
              allowLocalFallback: true
            });

            if (!dest) return;

            if (dest.__localFallback) {
              const tempUrl = (cw.URL || window.URL).createObjectURL(capturedBlob);
              const dl = cw.document.createElement('a');
              dl.href = tempUrl;
              dl.download = suggestedName;
              dl.__sgBypassVfsHook = true;
              cw.document.body.appendChild(dl);
              try {
                origAnchorClick.call(dl);
              } finally {
                dl.remove();
                setTimeout(() => { try { (cw.URL || window.URL).revokeObjectURL(tempUrl); } catch (e) {} }, 5000);
              }
              return;
            }

            const res = await uploadBlobToVfs(capturedBlob, dest.dir, dest.filename, dest.overwrite);
            if (res.success) {
              showToast('success', translate('vfs.saved_to_gallery', { name: dest.filename }));
            } else {
              showToast('error', res.error || translate('vfs.save_denied'));
            }
          }).catch((err) => {
            console.warn(`[WebAppVfsBridge:${appInstance.id}] Save hook fallback:`, err);
            anchorEl.__sgBypassVfsHook = true;
            try { origAnchorClick.call(anchorEl); } finally { anchorEl.__sgBypassVfsHook = false; }
          });
        };
      }

      // 6. CAPTURE-PHASE DOM CLICK HOOK: catches visible <input type="file"> and <a download> clicked directly by user
      if (cw.document && typeof cw.document.addEventListener === 'function') {
        cw.document.addEventListener('click', (evt) => {
          const cfg = getBridgeConfig(appInstance);
          if (!cfg.enabled || !evt || !evt.target) return;
          const target = evt.target;

          if (cfg.hookOpen && target.tagName === 'INPUT' && String(target.type || '').toLowerCase() === 'file' && !target.__sgBypassVfsHook) {
            evt.preventDefault();
            evt.stopImmediatePropagation();
            target.click();
            return;
          }

          const anchor = typeof target.closest === 'function' ? target.closest('a[download]') : null;
          if (cfg.hookSave && anchor && !anchor.__sgBypassVfsHook) {
            const href = String(anchor.getAttribute('href') || '');
            if (href.startsWith('blob:') || href.startsWith('data:')) {
              evt.preventDefault();
              evt.stopImmediatePropagation();
              anchor.click();
            }
          }
        }, true);
      }

      return true;
    }

    splitVfsPath(fullPath) {
      return splitVfsPath(fullPath);
    }

    uploadBlobToVfs(blob, dir, filename, overwrite = true) {
      return uploadBlobToVfs(blob, dir, filename, overwrite);
    }

    /**
     * Binds the global `postMessage` listener for cooperative apps (`webos:vfs-pick`, `webos:vfs-save`).
     */
    bindPostMessageProtocol(hostManager) {
      if (this._messageListenerBound || !window || typeof window.addEventListener !== 'function') return;
      this._messageListenerBound = true;

      window.addEventListener('message', (event) => {
        this.handlePostMessage(event, hostManager);
      });
    }

    async handlePostMessage(event, hostManager) {
      const msg = event && event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type !== 'webos:vfs-pick' && msg.type !== 'webos:vfs-save') return;

      // Match event.source strictly against a known mounted iframe instance
      let matchedInstance = null;
      let matchedIframe = null;
      if (hostManager && hostManager.instances) {
        for (const inst of hostManager.instances.values()) {
          const iframe = typeof inst.getIframeElement === 'function' ? inst.getIframeElement() : null;
          if (iframe && iframe.contentWindow && iframe.contentWindow === event.source) {
            matchedInstance = inst;
            matchedIframe = iframe;
            break;
          }
        }
      }
      if (!matchedInstance || !matchedIframe) return;

      // For same-origin apps, strictly verify origin matches our own origin
      const targetOrigin = event.origin && event.origin !== 'null' ? event.origin : window.location.origin;
      if (this.isSameOriginIframe(matchedIframe) && window.location && event.origin && event.origin !== window.location.origin) {
        return;
      }

      const appTitle = typeof matchedInstance.getAppTitle === 'function' ? matchedInstance.getAppTitle() : matchedInstance.id;
      const requestId = msg.requestId || null;

      if (msg.type === 'webos:vfs-pick') {
        if (!window.sys || typeof window.sys.pickFile !== 'function') return;
        const picked = await window.sys.pickFile({
          title: msg.title || translate('vfs.open_for_app', { app: appTitle }),
          initialPath: msg.initialPath || getCurrentExplorerDir(),
          accept: msg.accept || '*/*',
          multiple: Boolean(msg.multiple),
          allowLocalFallback: false
        });

        if (!picked) {
          event.source.postMessage({ type: 'webos:vfs-pick-result', requestId, cancelled: true, files: [] }, targetOrigin);
          return;
        }

        const list = Array.isArray(picked) ? picked : [picked];
        const payloadFiles = [];
        for (const f of list) {
          try {
            const { blob, mime, fileName, fileUrl } = await fetchVfsFileAsBlob(matchedInstance, f);
            const buffer = typeof blob.arrayBuffer === 'function' ? await blob.arrayBuffer() : null;
            payloadFiles.push({ name: fileName, path: f.path || '', url: fileUrl, mime, buffer });
          } catch (e) {}
        }

        event.source.postMessage({
          type: 'webos:vfs-pick-result',
          requestId,
          cancelled: false,
          files: payloadFiles
        }, targetOrigin);
        return;
      }

      if (msg.type === 'webos:vfs-save') {
        if (!window.sys || typeof window.sys.pickSaveLocation !== 'function') return;
        const suggestedName = msg.filename || 'export.bin';
        const mime = msg.mime || 'application/octet-stream';

        let blob = null;
        if (msg.data instanceof Blob) {
          blob = msg.data;
        } else if (msg.data instanceof ArrayBuffer || ArrayBuffer.isView(msg.data)) {
          blob = new Blob([msg.data], { type: mime });
        } else if (typeof msg.data === 'string') {
          blob = msg.data.startsWith('data:') ? dataUrlToBlob(msg.data) : new Blob([msg.data], { type: mime });
        }
        if (!blob) {
          event.source.postMessage({ type: 'webos:vfs-save-result', requestId, success: false, error: 'Invalid data payload' }, targetOrigin);
          return;
        }

        const dest = await window.sys.pickSaveLocation({
          title: msg.title || translate('vfs.save_for_app', { app: appTitle }),
          initialPath: msg.dir || getCurrentExplorerDir(),
          suggestedName,
          allowLocalFallback: false
        });

        if (!dest) {
          event.source.postMessage({ type: 'webos:vfs-save-result', requestId, cancelled: true, success: false }, targetOrigin);
          return;
        }

        const res = await uploadBlobToVfs(blob, dest.dir, dest.filename, dest.overwrite);
        if (res.success) {
          showToast('success', translate('vfs.saved_to_gallery', { name: dest.filename }));
        } else {
          showToast('error', res.error || translate('vfs.save_denied'));
        }
        event.source.postMessage({
          type: 'webos:vfs-save-result',
          requestId,
          cancelled: false,
          success: Boolean(res.success),
          path: res.path || null,
          error: res.error || null
        }, targetOrigin);
      }
    }
  }

  const bridgeInstance = new WebAppVfsBridge();
  window.WebAppVfsBridge = WebAppVfsBridge;
  window.sys = window.sys || {};
  window.sys.webAppVfsBridge = bridgeInstance;
})(typeof window !== 'undefined' ? window : globalThis);
