/**
 * Atelier Userland - Syscall Client
 * Unified, zero-boilerplate API client for WebOS communicating with Kernel (api.php).
 */
class SyscallClient {
  constructor(endpoint = 'system/endpoints/api.php') {
    this.endpoint = endpoint;
  }

  forApp(appId) {
    // Route all plugin backend actions centrally through the kernel API gateway (ActionRouter + manifest.backend)
    // because direct HTTP execution of PHP files under apps/ is strictly blocked by .htaccess & docker/nginx.conf.
    return new SyscallClient(this.endpoint);
  }

  getCsrfToken() {

    return (typeof window !== 'undefined' && (
      window.ATELIER_CSRF_TOKEN ||
      window.CSRF_TOKEN ||
      document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
    )) || '';
  }

  syncCsrfToken(token) {
    if (!token || typeof token !== 'string' || typeof window === 'undefined') return;
    window.ATELIER_CSRF_TOKEN = token;
    window.CSRF_TOKEN = token;
    if (window.desktop && window.desktop.state) {
      window.desktop.state.csrfToken = token;
    }
    if (typeof document !== 'undefined') {
      const meta = document.querySelector('meta[name="csrf-token"]');
      if (meta) meta.setAttribute('content', token);
    }
  }

  /**
   * Build complete API URL for action and parameters
   */
  url(action, params = {}) {
    const url = new URL(this.endpoint, window.location.href);
    if (action) url.searchParams.set('action', action);
    Object.keys(params).forEach(k => {
      if (params[k] !== undefined && params[k] !== null) {
        url.searchParams.set(k, params[k]);
      }
    });
    return url.toString();
  }

  /**
   * Perform HTTP GET request returning raw text (for documents, INI configs, subtitles, etc.)
   * Always includes same-origin credentials and optional cache control.
   */
  async getText(rawUrl, options = {}) {
    const fetchOpts = {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      ...options
    };
    const res = await fetch(rawUrl, fetchOpts);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  }

  /**
   * Perform HTTP GET request to API
   */
  async get(action, params = {}) {
    const fetchUrl = this.url(action, params);
    try {
      const res = await fetch(fetchUrl, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        if (parsed && parsed.csrf_token) this.syncCsrfToken(parsed.csrf_token);
        return parsed;
      } catch (e) {
        console.warn(`[SyscallClient] Non-JSON payload received for GET "${action}":`, text);
        return { success: false, error: text || `HTTP ${res.status}` };
      }
    } catch (err) {
      console.error(`[SyscallClient] GET ${action} failed:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Perform HTTP POST request to API with JSON payload & CSRF token
   */
  async post(action, payload = {}, options = {}) {
    const csrfToken = this.getCsrfToken();
    const bodyData = {
      action,
      csrf_token: csrfToken,
      ...payload
    };

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify(bodyData)
      });
      const text = await res.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        console.warn(`[SyscallClient] Non-JSON payload received for POST "${action}":`, text);
        return { success: false, error: text || `HTTP ${res.status}` };
      }

      if (parsed && parsed.csrf_token) {
        this.syncCsrfToken(parsed.csrf_token);
      }

      // Same-origin automatic CSRF resync & single transparent retry if token went stale
      const isCsrfError = res.status === 403 && parsed && (
        parsed.code === 'invalid_csrf' || parsed.error === 'api.err_invalid_csrf'
      );
      if (isCsrfError && !options._csrfRetried && this.endpoint.includes('api.php')) {
        const fresh = await this.get('get_current_user');
        if (fresh && fresh.success && fresh.csrf_token) {
          this.syncCsrfToken(fresh.csrf_token);
          const publicActions = ['login', 'verify_2fa_login', 'register_account', 'verify_email', 'resend_verification', 'request_password_reset', 'confirm_password_reset', 'access_share_link', 'unlock_folder'];
          if (fresh.is_logged_in || publicActions.includes(action)) {
            return this.post(action, payload, { ...options, _csrfRetried: true });
          }
          if (typeof window !== 'undefined' && window.sys && window.sys.shares && typeof window.sys.shares.refreshIdentity === 'function') {
            window.sys.shares.refreshIdentity();
          }
          const expiredMsg = (typeof window !== 'undefined' && window.I18nEngine && typeof window.I18nEngine.t === 'function')
            ? window.I18nEngine.t('api.err_session_expired')
            : parsed.error;
          return { success: false, code: 'session_expired', error: expiredMsg };
        }
      }

      return parsed;
    } catch (err) {
      console.error(`[SyscallClient] POST ${action} failed:`, err);
      return { success: false, error: err.message };
    }
  }


  /**
   * Perform Multipart / FormData File Upload with optional progress listener
   */
  upload(action, formData, onProgress = null) {
    return new Promise((resolve) => {
      const csrfToken = this.getCsrfToken();
      if (!(formData instanceof FormData)) {
        const fd = new FormData();
        Object.keys(formData).forEach(k => fd.append(k, formData[k]));
        formData = fd;
      }

      if (!formData.has('action') && action) {
        formData.append('action', action);
      }
      if (!formData.has('csrf_token') && csrfToken) {
        formData.append('csrf_token', csrfToken);
      }

      const xhr = new XMLHttpRequest();
      xhr.open('POST', this.endpoint, true);
      xhr.withCredentials = true;
      if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);

      if (typeof onProgress === 'function') {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            onProgress(percent, e.loaded, e.total);
          }
        };
      }

      xhr.onload = () => {
        try {
          const json = JSON.parse(xhr.responseText);
          resolve(json);
        } catch (err) {
          resolve({ success: false, error: 'Réponse serveur invalide' });
        }
      };

      xhr.onerror = () => {
        resolve({ success: false, error: 'Erreur réseau lors du téléversement' });
      };

      xhr.send(formData);
    });
  }

  /**
   * Phase B: Resumable Chunked File Upload for multi-GB files (`upload_chunk_init` -> `upload_chunk` -> `upload_chunk_complete`)
   */
  async uploadChunked(file, dir = '', options = {}) {
    if (!file) return { success: false, error: 'Missing file' };
    const chunkSize = Math.max(262144, Number(options.chunkSize) || (4 * 1024 * 1024));
    const totalSize = Number(file.size) || 0;
    const totalChunks = Math.max(1, Math.ceil(totalSize / chunkSize));
    const overwrite = options.overwrite !== false;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const maxRetries = Math.max(0, Number(options.retries ?? 2));

    const initRes = await this.post('upload_chunk_init', {
      dir,
      filename: file.name || 'upload.bin',
      total_size: totalSize,
      total_chunks: totalChunks,
      overwrite
    });
    if (!initRes || !initRes.success || !initRes.upload_id) {
      return initRes || { success: false, error: 'Chunk upload initialization failed' };
    }

    const uploadId = initRes.upload_id;
    let uploadedBytes = 0;
    const isCancelled = typeof options.isCancelled === 'function' ? options.isCancelled : () => false;

    for (let idx = 0; idx < totalChunks; idx++) {
      if (isCancelled()) {
        return { success: false, cancelled: true, error: 'Upload cancelled', upload_id: uploadId };
      }
      const start = idx * chunkSize;
      const end = Math.min(totalSize, start + chunkSize);
      const slice = file.slice(start, end);
      let chunkOk = false;
      let lastErr = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const fd = new FormData();
        fd.append('upload_id', uploadId);
        fd.append('chunk_index', String(idx));
        fd.append('chunk', slice, `chunk_${idx}.part`);
        const res = await this.upload('upload_chunk', fd, (pct, loaded) => {
          if (onProgress && totalSize > 0) {
            const totalLoaded = Math.min(totalSize, uploadedBytes + loaded);
            onProgress(Math.round((totalLoaded / totalSize) * 100), totalLoaded, totalSize);
          }
        });
        if (res && res.success) {
          chunkOk = true;
          break;
        }
        lastErr = (res && res.error) || `Chunk #${idx} failed`;
      }

      if (!chunkOk) {
        return { success: false, error: lastErr || 'Chunk transfer failed', upload_id: uploadId };
      }
      uploadedBytes += (end - start);
      if (onProgress && totalSize > 0) {
        onProgress(Math.min(99, Math.round((uploadedBytes / totalSize) * 100)), uploadedBytes, totalSize);
      }
    }

    const doneRes = await this.post('upload_chunk_complete', { upload_id: uploadId });
    if (doneRes && doneRes.success && onProgress) {
      onProgress(100, totalSize, totalSize);
    }
    return doneRes;
  }

  /**
   * Generic call method for backwards compatibility
   */
  async call(action, params = {}, method = 'POST') {
    if (method.toUpperCase() === 'GET') {
      return this.get(action, params);
    }
    return this.post(action, params);
  }

  // High-level FS Syscalls
  get fs() {
    return {
      list: (path = '') => this.get('', { dir: path }),
      search: (params = {}) => this.get('search', params),
      createFolder: (dir, name) => this.post('create_folder', { dir, folder_name: name, name }),
      deleteItem: (target_path) => this.post('delete_item', { target: target_path, target_path }),
      moveItem: (source, target_dir, new_name) => this.post('move_item', { source, target_dir, new_name }),
      renameItem: (source, new_name) => this.post('rename_item', { source, new_name }),
      copyItem: (source, target_dir, new_name) => this.post('copy_item', { source, target_dir, new_name }),
      saveTextFile: (file, content) => this.post('save_text_file', { file, content }),
      getMetadata: (file) => this.get('get_metadata', { file }),
      unlockFolder: (dir, password) => this.post('unlock_folder', { dir, password }),
      saveFolderSettings: (params) => this.post('save_folder_settings', params),
      saveComment: (dir, filename, comment) => this.post('save_comment', { dir, filename, comment })
    };
  }

  // High-level Auth Syscalls
  get auth() {
    return {
      login: (password) => this.post('login', { password }),
      logout: () => this.post('logout', {}),
      changePassword: (oldPassword, newPassword) => this.post('change_password', { old_password: oldPassword, new_password: newPassword })
    };
  }
}

window.sys = window.sys || {};
// Expose SyscallClient globally so apps can instantiate it directly if needed
window.SyscallClient = SyscallClient;
// window.sys.api  → system API (system/endpoints/api.php)
window.sys.api = window.sys.api || new SyscallClient();
// window.sys.syscall → alias with forApp() convenience (same system endpoint by default)
window.sys.syscall = window.sys.syscall || window.sys.api;
