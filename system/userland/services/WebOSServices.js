/**
 * SimpleGallery WebOS - Centralized WebOS Services Engine (`window.sys.services` / `window.sys.*`)
 * High-level system abstractions for Filesystem, UI Dialogs, Toasts, WebAudio Sound Synthesis, and Storage.
 */

(function (window, document) {
  'use strict';

  window.sys = window.sys || {};

  // =========================================================================
  // 1. Storage Service (`sys.storage`) — User-Scoped Multi-User Isolation
  // =========================================================================
  const SYNCABLE_PREFS = ['theme', 'wallpaper', 'window_style', 'locale', 'explorer_view_mode', 'default_apps'];
  let _prefSyncTimer = null;
  let _prefSyncQueue = {};

  function flushUserPrefsSync() {
    _prefSyncTimer = null;
    const patch = Object.assign({}, _prefSyncQueue);
    _prefSyncQueue = {};
    if (Object.keys(patch).length === 0) return;

    const u = (window.sys && window.sys.shares && typeof window.sys.shares.getCurrentUser === 'function')
      ? window.sys.shares.getCurrentUser()
      : window.SG_CURRENT_USER;
    if (!u || !u.id) return;

    const api = (window.sys && window.sys.api) || window.SyscallClient;
    if (api && typeof api.post === 'function') {
      api.post('save_user_preferences', { preferences: patch }).catch(() => {});
    }
  }

  const StorageService = {
    getUserScope() {
      const u = (window.sys && window.sys.shares && typeof window.sys.shares.getCurrentUser === 'function')
        ? window.sys.shares.getCurrentUser()
        : window.SG_CURRENT_USER;
      if (u && u.id) return `u_${u.id}`;
      if (u && u.username) return `u_${String(u.username).toLowerCase()}`;
      if (window.IS_ADMIN || (window.desktop && window.desktop.state && window.desktop.state.isAdmin)) {
        return 'admin';
      }
      return 'guest';
    },
    isNamedUserScope(scope) {
      return typeof scope === 'string' && scope.startsWith('u_');
    },
    get(appId, key, defaultValue = null) {
      try {
        const scope = this.getUserScope();
        const scopedKey = `webos_${scope}_app_${appId}_${key}`;
        let raw = localStorage.getItem(scopedKey);
        if (raw === null && !this.isNamedUserScope(scope)) {
          raw = localStorage.getItem(`webos_app_${appId}_${key}`);
        }
        if (raw === null) return defaultValue;
        return JSON.parse(raw);
      } catch (e) {
        console.warn(`[WebOS Storage] Failed to get '${key}' for '${appId}':`, e);
        return defaultValue;
      }
    },
    set(appId, key, value) {
      try {
        const scope = this.getUserScope();
        const scopedKey = `webos_${scope}_app_${appId}_${key}`;
        localStorage.setItem(scopedKey, JSON.stringify(value));
        return true;
      } catch (e) {
        console.warn(`[WebOS Storage] Failed to set '${key}' for '${appId}':`, e);
        return false;
      }
    },
    remove(appId, key) {
      try {
        const scope = this.getUserScope();
        localStorage.removeItem(`webos_${scope}_app_${appId}_${key}`);
        if (!this.isNamedUserScope(scope)) {
          localStorage.removeItem(`webos_app_${appId}_${key}`);
        }
      } catch (e) {}
    },
    getPref(key, defaultValue = null, legacyLocalKey = null) {
      try {
        const scope = this.getUserScope();
        const expectsObject = defaultValue !== null && typeof defaultValue === 'object';
        if (this.isNamedUserScope(scope) && window.SG_USER_PREFERENCES && typeof window.SG_USER_PREFERENCES === 'object') {
          const serverVal = window.SG_USER_PREFERENCES[key];
          if (serverVal !== undefined && serverVal !== null && serverVal !== '') {
            if (expectsObject && typeof serverVal === 'string') {
              try { return JSON.parse(serverVal); } catch (e) { return defaultValue; }
            }
            return serverVal;
          }
        }
        const scopedVal = localStorage.getItem(`sg_pref_${scope}_${key}`);
        if (scopedVal !== null) {
          if (expectsObject) {
            try { return JSON.parse(scopedVal); } catch (e) { return defaultValue; }
          }
          return scopedVal;
        }
        if (!this.isNamedUserScope(scope) && legacyLocalKey) {
          const legacyVal = localStorage.getItem(legacyLocalKey);
          if (legacyVal !== null) {
            if (expectsObject) {
              try { return JSON.parse(legacyVal); } catch (e) { return defaultValue; }
            }
            return legacyVal;
          }
        }
        return defaultValue;
      } catch (e) {
        return defaultValue;
      }
    },
    setPref(key, value, opts = {}) {
      try {
        const scope = this.getUserScope();
        const isObj = value !== null && typeof value === 'object';
        const strVal = (value === null || value === undefined) ? '' : (isObj ? JSON.stringify(value) : String(value));
        localStorage.setItem(`sg_pref_${scope}_${key}`, strVal);
        if (!this.isNamedUserScope(scope) && opts.legacyLocalKey) {
          localStorage.setItem(opts.legacyLocalKey, strVal);
        }
        if (this.isNamedUserScope(scope)) {
          window.SG_USER_PREFERENCES = window.SG_USER_PREFERENCES || {};
          window.SG_USER_PREFERENCES[key] = isObj ? value : strVal;
          if (opts.sync !== false && SYNCABLE_PREFS.includes(key)) {
            _prefSyncQueue[key] = isObj ? value : strVal;
            if (_prefSyncTimer) clearTimeout(_prefSyncTimer);
            _prefSyncTimer = setTimeout(flushUserPrefsSync, 250);
          }
        }
        return true;
      } catch (e) {
        return false;
      }
    },
    removePref(key, legacyLocalKey = null) {
      try {
        const scope = this.getUserScope();
        localStorage.removeItem(`sg_pref_${scope}_${key}`);
        if (!this.isNamedUserScope(scope) && legacyLocalKey) {
          localStorage.removeItem(legacyLocalKey);
        }
        if (this.isNamedUserScope(scope) && window.SG_USER_PREFERENCES && typeof window.SG_USER_PREFERENCES === 'object') {
          delete window.SG_USER_PREFERENCES[key];
        }
      } catch (e) {}
    },
    clearUserScope() {
      try {
        const scope = this.getUserScope();
        const u = (window.sys && window.sys.shares && typeof window.sys.shares.getCurrentUser === 'function')
          ? window.sys.shares.getCurrentUser()
          : window.SG_CURRENT_USER;
        const username = u && u.username ? String(u.username) : '';

        const prefixes = [
          `webos_${scope}_`,
          `sg_pref_${scope}_`,
          `tribune_${scope}_`,
          `sg_vfs_bridge_${scope}_`,
          `sg_favorites_${scope}`,
          `sg_folder_sorts_${scope}`
        ];
        if (username) {
          prefixes.push(`sg_favorites_user_${username}`, `sg_folder_sorts_user_${username}`);
        }

        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k) continue;
          if (prefixes.some(p => k.startsWith(p))) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));

        if (!this.isNamedUserScope(scope)) {
          [
            'sg_desktop_wallpaper',
            'sg_active_theme',
            'sg_window_style',
            'sg_favorites',
            'sg_view_mode',
            'sg_explorer_view_mode',
            'gallery_view_mode',
            'sg_cookie_consent'
          ].forEach(k => localStorage.removeItem(k));
        }
        return keysToRemove.length;
      } catch (e) {
        return 0;
      }
    },
    forApp(appId) {
      return {
        get: (key, defaultValue = null) => StorageService.get(appId, key, defaultValue),
        set: (key, value) => StorageService.set(appId, key, value),
        remove: (key) => StorageService.remove(appId, key)
      };
    }
  };

  // =========================================================================
  // 2. WebAudio Synthesizer Service (`sys.audio`)
  // =========================================================================
  class WebAudioSynth {
    constructor() {
      this.ctx = null;
      this.enabled = true;
    }

    _getAudioContext() {
      if (!this.ctx && typeof AudioContext !== 'undefined') {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }

    playTone(freq, type = 'sine', duration = 0.1, gainVal = 0.1) {
      if (!this.enabled) return;
      try {
        const ctx = this._getAudioContext();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(gainVal, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      } catch (e) {}
    }

    // Standard Preset Effects for Games & UI
    playClick() { this.playTone(800, 'sine', 0.04, 0.05); }
    playPop() { this.playTone(600, 'sine', 0.05, 0.08); }
    playSuccess() {
      this.playTone(523.25, 'triangle', 0.08, 0.08); // C5
      setTimeout(() => this.playTone(659.25, 'triangle', 0.12, 0.08), 80); // E5
    }
    playWarning() { this.playTone(300, 'sawtooth', 0.15, 0.08); }
    playError() {
      this.playTone(180, 'sawtooth', 0.15, 0.1);
      setTimeout(() => this.playTone(130, 'sawtooth', 0.2, 0.1), 100);
    }

    // Arcade Game Sound Presets
    playBounce() { this.playTone(350, 'sine', 0.05, 0.08); }
    playScore() { this.playTone(880, 'triangle', 0.15, 0.1); }
    playMove() { this.playTone(440, 'sine', 0.04, 0.05); }
    playRotate() {
      if (!this.enabled) return;
      try {
        const ctx = this._getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.05);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.06);
      } catch (e) {}
    }
    playFlow() {
      if (!this.enabled) return;
      try {
        const ctx = this._getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(540, now);
        osc.frequency.linearRampToValueAtTime(720, now + 0.08);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.11);
      } catch (e) {}
    }
    playVictory() {
      const notes = [440, 554.37, 659.25, 880];
      notes.forEach((freq, idx) => {
        setTimeout(() => this.playTone(freq, 'triangle', 0.15, 0.1), idx * 100);
      });
    }
    playWin() {
      this.playVictory();
    }

    /**
     * Universal sound effect trigger by name
     */
    play(name = 'pop') {
      const n = (name || '').toLowerCase();
      if (n === 'pop') return this.playPop();
      if (n === 'click') return this.playClick();
      if (n === 'success') return this.playSuccess();
      if (n === 'warning') return this.playWarning();
      if (n === 'error') return this.playError();
      if (n === 'bounce') return this.playBounce();
      if (n === 'score') return this.playScore();
      if (n === 'move') return this.playMove();
      if (n === 'rotate') return this.playRotate();
      if (n === 'flow') return this.playFlow();
      if (n === 'victory' || n === 'win') return this.playVictory();
      return this.playClick();
    }
  }

  const AudioService = new WebAudioSynth();

  // =========================================================================
  // 3. High-Level Filesystem Service (`sys.fs`)
  // =========================================================================
  const FilesystemService = {
    get api() {
      return (window.sys && window.sys.api) || window.SyscallClient;
    },
    getMetadata(filePath) {
      if (this.api && typeof this.api.get === 'function') {
        return this.api.get('get_metadata', { file: filePath });
      }
      return Promise.reject(new Error('SyscallClient not available'));
    },
    saveTextFile(filePath, content) {
      if (this.api && typeof this.api.post === 'function') {
        return this.api.post('save_text_file', { file: filePath, content: content });
      }
      return Promise.reject(new Error('SyscallClient not available'));
    },
    uploadFile(fileObj, targetDir) {
      const formData = new FormData();
      formData.append('action', 'upload_file');
      formData.append('target_dir', targetDir || '');
      formData.append('file', fileObj);

      const csrf = window.CSRF_TOKEN || (window.desktop && window.desktop.state && window.desktop.state.csrfToken) || '';
      formData.append('csrf_token', csrf);

      return fetch('system/endpoints/api.php', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrf },
        body: formData
      }).then(r => r.json());
    }
  };

  // Attach Services to `window.sys`
  window.sys.storage = StorageService;
  window.sys.audio = AudioService;
  window.sys.fs = FilesystemService;

  // Shortcuts & Proxy bindings
  window.sys.toast = {
    info: (msg, opts) => (window.sys.ui && window.sys.ui.toast ? window.sys.ui.toast.info(msg, opts) : (window.WebOSToolkit ? window.WebOSToolkit.toastInfo(msg, opts) : console.log('[Toast]', msg))),
    success: (msg, opts) => (window.sys.ui && window.sys.ui.toast ? window.sys.ui.toast.success(msg, opts) : (window.WebOSToolkit ? window.WebOSToolkit.toastSuccess(msg, opts) : console.log('[Toast]', msg))),
    warning: (msg, opts) => (window.sys.ui && window.sys.ui.toast ? window.sys.ui.toast.warning(msg, opts) : (window.WebOSToolkit ? window.WebOSToolkit.toastWarning(msg, opts) : console.warn('[Toast]', msg))),
    error: (msg, opts) => (window.sys.ui && window.sys.ui.toast ? window.sys.ui.toast.error(msg, opts) : (window.WebOSToolkit ? window.WebOSToolkit.toastError(msg, opts) : console.error('[Toast]', msg))),
    show: (msg, typeOrOpts = 'info') => {
      const type = (typeof typeOrOpts === 'string' ? typeOrOpts : (typeOrOpts && typeOrOpts.type)) || 'info';
      const fn = window.sys.toast[type] || window.sys.toast.info;
      return fn(msg, typeof typeOrOpts === 'object' ? typeOrOpts : {});
    }
  };

  window.sys.dialog = {
    alert: (msgOrOpts, title, opts = {}) => {
      const options = (typeof msgOrOpts === 'object') ? msgOrOpts : { message: msgOrOpts, title: title, ...opts };
      return window.sys.ui ? window.sys.ui.alertDialog(options) : Promise.resolve(window.alert(options.message || options.title));
    },
    confirm: (msgOrOpts, title, isDanger, opts = {}) => {
      const options = (typeof msgOrOpts === 'object') ? msgOrOpts : { message: msgOrOpts, title: title, danger: isDanger, ...opts };
      if (window.sys.ui) {
        return window.sys.ui.confirmDialog(options).then(confirmed => {
          if (confirmed && typeof options.onConfirm === 'function') options.onConfirm();
          if (!confirmed && typeof options.onCancel === 'function') options.onCancel();
          return confirmed;
        });
      }
      const confirmed = window.confirm(options.message || options.title);
      if (confirmed && typeof options.onConfirm === 'function') options.onConfirm();
      if (!confirmed && typeof options.onCancel === 'function') options.onCancel();
      return Promise.resolve(confirmed);
    },
    prompt: (msgOrOpts, defaultVal, title, opts = {}) => {
      const options = (typeof msgOrOpts === 'object') ? msgOrOpts : { message: msgOrOpts, defaultValue: defaultVal, title: title, ...opts };
      return window.sys.ui ? window.sys.ui.promptDialog(options) : Promise.resolve(window.prompt(options.message || '', options.defaultValue || ''));
    }
  };

  window.sys.openFile = (file) => (window.sys.appManager && typeof window.sys.appManager.openFile === 'function') ? window.sys.appManager.openFile(file) : null;
  window.sys.mediaViewer = {
    openFile: (file) => (window.sys.appManager && typeof window.sys.appManager.openFile === 'function') ? window.sys.appManager.openFile(file) : null
  };

})(window, document);
