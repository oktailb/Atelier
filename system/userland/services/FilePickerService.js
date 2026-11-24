/**
 * SimpleGallery WebOS - Unified VFS File, Folder & Save Location Picker Service
 * Provides modal browsing, opening, and saving dialogs for native & embedded applications
 * (`window.sys.pickFile`, `window.sys.pickFolder`, `window.sys.pickSaveLocation`).
 */
(function (window, document) {
  'use strict';

  window.sys = window.sys || {};

  // Minimal fallback used only if window.SG_MIME_MAP was not injected (e.g., isolated unit tests).
  // In production, index.php injects window.SG_MIME_MAP dynamically from Kernel FormatRegistry.
  const FALLBACK_MIME_TO_EXTENSIONS = {
    'image/png': ['png'],
    'image/jpeg': ['jpg', 'jpeg'],
    'image/webp': ['webp'],
    'image/gif': ['gif'],
    'image/svg+xml': ['svg'],
    'image/vnd.adobe.photoshop': ['psd', 'psb'],
    'application/pdf': ['pdf'],
    'application/json': ['json'],
    'application/zip': ['zip'],
    'application/vnd.oasis.opendocument.text': ['odt'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    'text/plain': ['txt', 'log', 'ini', 'cfg'],
    'text/markdown': ['md', 'markdown'],
    'text/csv': ['csv'],
    'video/mp4': ['mp4', 'm4v'],
    'audio/mpeg': ['mp3']
  };

  function getExtensionsForMime(mime) {
    if (!mime) return null;
    if (window.SG_MIME_MAP && Array.isArray(window.SG_MIME_MAP[mime])) {
      return window.SG_MIME_MAP[mime];
    }
    return FALLBACK_MIME_TO_EXTENSIONS[mime] || null;
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

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

  function matchesAcceptFilter(file, acceptFilter) {
    if (!acceptFilter || acceptFilter === '*/*' || acceptFilter === '*') return true;
    const extRaw = (file.extension || (file.name && file.name.includes('.') ? file.name.split('.').pop() : '') || '').toLowerCase();
    const extDot = extRaw ? '.' + extRaw : '';
    const category = (file.category || '').toLowerCase();
    const fileMime = (file.mime || '').toLowerCase();

    const filters = String(acceptFilter)
      .split(',')
      .map(f => f.trim().toLowerCase())
      .filter(Boolean);

    if (filters.length === 0 || filters.includes('*/*') || filters.includes('*')) return true;

    return filters.some((f) => {
      if (f === extDot || f === extRaw) return true;
      if (f === 'image/*' && (category === 'image' || fileMime.startsWith('image/'))) return true;
      if (f === 'video/*' && (category === 'video' || fileMime.startsWith('video/'))) return true;
      if (f === 'audio/*' && (category === 'audio' || fileMime.startsWith('audio/'))) return true;
      if (f === 'text/*' && (category === 'doc' || fileMime.startsWith('text/'))) return true;
      if (fileMime && f === fileMime) return true;
      if (f.includes('/')) {
        const mapped = getExtensionsForMime(f);
        if (mapped && mapped.includes(extRaw)) return true;
      }
      if (f === category) return true;
      return false;
    });
  }

  class FilePickerService {
    constructor() {
      this.activeDialog = null;
    }

    /**
     * Expose pure accept matcher for unit testing & external callers
     */
    matchesAccept(file, acceptFilter) {
      return matchesAcceptFilter(file, acceptFilter);
    }

    /**
     * Pick one or multiple files from the gallery storage
     * @param {Object} options { title, initialPath, accept, multiple, allowLocalFallback }
     * @returns {Promise<Object|Array<Object>|null>} Selected file(s), { __localFallback: true }, or null if cancelled
     */
    pickFile(options = {}) {
      return this._openDialog({
        ...options,
        mode: 'file',
        selectFolder: false,
        title: options.title || translate('vfs.pick_file_title')
      });
    }

    /**
     * Pick a folder from the gallery storage
     * @param {Object} options { title, initialPath }
     * @returns {Promise<Object|null>} Selected folder or null if cancelled
     */
    pickFolder(options = {}) {
      return this._openDialog({
        ...options,
        mode: 'folder',
        selectFolder: true,
        multiple: false,
        title: options.title || translate('vfs.pick_folder_title')
      });
    }

    /**
     * Pick a destination directory + filename in the gallery storage for saving an exported file
     * @param {Object} options { title, initialPath, suggestedName, allowLocalFallback }
     * @returns {Promise<{dir: string, filename: string, overwrite: boolean}|{__localFallback: true}|null>}
     */
    pickSaveLocation(options = {}) {
      return this._openDialog({
        ...options,
        mode: 'save',
        selectFolder: false,
        multiple: false,
        suggestedName: options.suggestedName || 'export.png',
        title: options.title || translate('vfs.save_file_title')
      });
    }

    /**
     * Modal compatibility method supporting onSelect / onCancel callbacks
     */
    openModal(options = {}) {
      const opts = {
        title: options.title || translate('vfs.pick_file_title'),
        initialPath: options.initialPath || '',
        accept: options.accept || '*/*',
        multiple: Boolean(options.allowMultiple || options.multiple),
        selectFolder: Boolean(options.selectFolder),
        allowLocalFallback: Boolean(options.allowLocalFallback),
        mode: options.mode || (options.selectFolder ? 'folder' : 'file')
      };

      return this._openDialog(opts).then((result) => {
        if (result && !result.__localFallback && typeof options.onSelect === 'function') {
          options.onSelect(result);
        }
        if (!result && typeof options.onCancel === 'function') {
          options.onCancel();
        }
        return result;
      });
    }

    open(options = {}) {
      return this.openModal(options);
    }

    _openDialog(options) {
      return new Promise((resolve) => {
        if (this.activeDialog) {
          this.activeDialog.close(null);
        }

        const mode = options.mode || (options.selectFolder ? 'folder' : 'file');
        const isFolderMode = mode === 'folder';
        const isSaveMode = mode === 'save';
        const isMultiple = !isFolderMode && !isSaveMode && Boolean(options.multiple);
        const allowLocalFallback = Boolean(options.allowLocalFallback);
        const acceptFilter = options.accept || '*/*';

        const getMountedVolumes = () => {
          if (window.sys && window.sys.shares && typeof window.sys.shares.getVolumes === 'function') {
            return window.sys.shares.getVolumes();
          }
          return Array.isArray(window.SG_MOUNTED_VOLUMES) ? window.SG_MOUNTED_VOLUMES : [];
        };

        const currentUser = (window.sys && window.sys.shares && typeof window.sys.shares.getCurrentUser === 'function')
          ? window.sys.shares.getCurrentUser()
          : (window.SG_CURRENT_USER || null);

        // In Save mode, default a standard user to their personal home when no explicit folder was requested
        let currentPath = options.initialPath || '';
        if (isSaveMode && !currentPath && !window.IS_ADMIN && currentUser && currentUser.home_dir) {
          currentPath = currentUser.home_dir;
        }
        let currentParentPath = null;
        let currentCanUpload = true;
        const selectedItems = new Map();

        const activeTheme = String(
          document.body?.getAttribute('data-theme') ||
          document.documentElement?.getAttribute('data-theme') ||
          ''
        ).toLowerCase();
        const isLightTheme = activeTheme.includes('light');

        const palette = isLightTheme ? {
          dialogBg: '#ffffff',
          headerBg: '#f1f5f9',
          toolbarBg: '#f8fafc',
          border: 'rgba(15, 23, 42, 0.12)',
          text: '#0f172a',
          muted: '#64748b',
          cardBg: '#f8fafc',
          cardHover: '#eef2ff',
          inputBg: '#ffffff',
          btnBg: '#e2e8f0',
          btnText: '#1e293b'
        } : {
          dialogBg: 'var(--bg-card, #1e293b)',
          headerBg: 'rgba(0, 0, 0, 0.22)',
          toolbarBg: 'rgba(0, 0, 0, 0.12)',
          border: 'rgba(255, 255, 255, 0.12)',
          text: 'var(--text-main, #f8fafc)',
          muted: 'var(--text-muted, #94a3b8)',
          cardBg: 'rgba(255, 255, 255, 0.04)',
          cardHover: 'rgba(255, 255, 255, 0.10)',
          inputBg: 'rgba(0, 0, 0, 0.30)',
          btnBg: 'rgba(255, 255, 255, 0.08)',
          btnText: '#e2e8f0'
        };

        const overlay = document.createElement('div');
        overlay.className = 'webos-file-picker-overlay';
        overlay.style.cssText = `
          position: fixed; inset: 0; z-index: 100000;
          background: rgba(15, 23, 42, 0.72); backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        `;

        const dialog = document.createElement('div');
        dialog.className = 'webos-file-picker-dialog';
        dialog.style.cssText = `
          width: 840px; max-width: 96vw; height: 610px; max-height: 90vh;
          background: ${palette.dialogBg}; color: ${palette.text};
          border: 1px solid ${palette.border}; border-radius: 14px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.55);
          display: flex; flex-direction: column; overflow: hidden;
        `;

        const headerIcon = isSaveMode ? '💾' : (isFolderMode ? '📁' : '📂');
        const confirmLabel = isSaveMode
          ? translate('vfs.save_in_gallery')
          : translate('vfs.select_btn');
        const localFallbackLabel = isSaveMode
          ? translate('vfs.download_local_pc')
          : translate('vfs.choose_local_pc');

        const saveBarHtml = isSaveMode ? `
          <div class="picker-save-bar" style="padding: 10px 20px; border-top: 1px solid ${palette.border}; background: ${palette.toolbarBg}; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <label style="font-size: 12px; font-weight: 600; color: ${palette.muted}; white-space: nowrap;">${escapeHtml(translate('vfs.filename_label'))}</label>
            <input type="text" class="picker-save-filename" value="${escapeHtml(options.suggestedName || 'export.png')}" style="flex: 1; min-width: 180px; padding: 7px 10px; background: ${palette.inputBg}; border: 1px solid ${palette.border}; border-radius: 7px; color: ${palette.text}; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">
            <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: ${palette.muted}; cursor: pointer; user-select: none;">
              <input type="checkbox" class="picker-save-overwrite" checked>
              <span>${escapeHtml(translate('vfs.overwrite_if_exists'))}</span>
            </label>
          </div>
        ` : '';

        const localFallbackHtml = allowLocalFallback ? `
          <button type="button" class="picker-local-fallback-btn" style="padding: 8px 14px; background: ${palette.btnBg}; border: 1px solid ${palette.border}; border-radius: 7px; color: ${palette.btnText}; cursor: pointer; font-size: 12px; font-weight: 500;">
            💻 ${escapeHtml(localFallbackLabel)}
          </button>
        ` : '';

        dialog.innerHTML = `
          <div class="picker-header" style="padding: 14px 20px; border-bottom: 1px solid ${palette.border}; display: flex; align-items: center; justify-content: space-between; background: ${palette.headerBg};">
            <div style="display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 15px;">
              <span>${headerIcon}</span>
              <span>${escapeHtml(options.title)}</span>
            </div>
            <button type="button" class="picker-close-btn" style="background: transparent; border: none; color: ${palette.muted}; font-size: 20px; cursor: pointer; line-height: 1; padding: 4px 8px; border-radius: 6px;">&times;</button>
          </div>

          <div class="picker-volumes-bar" style="display: none; padding: 8px 20px; border-bottom: 1px solid ${palette.border}; background: ${palette.headerBg}; align-items: center; gap: 6px; flex-wrap: wrap;"></div>

          <div class="picker-toolbar" style="padding: 10px 20px; border-bottom: 1px solid ${palette.border}; display: flex; align-items: center; gap: 12px; background: ${palette.toolbarBg};">
            <button type="button" class="picker-up-btn" style="padding: 6px 12px; background: ${palette.btnBg}; border: 1px solid ${palette.border}; border-radius: 6px; color: ${palette.btnText}; cursor: pointer; font-size: 12px;">⬆ ${escapeHtml(translate('vfs.parent_dir'))}</button>
            <div class="picker-breadcrumbs" style="flex: 1; display: flex; align-items: center; gap: 6px; font-size: 13px; color: ${palette.muted}; overflow-x: auto; white-space: nowrap;"></div>
            <input type="text" class="picker-search-input" placeholder="${escapeHtml(translate('vfs.filter_placeholder'))}" style="width: 165px; padding: 6px 10px; background: ${palette.inputBg}; border: 1px solid ${palette.border}; border-radius: 6px; color: ${palette.text}; font-size: 12px;">
          </div>

          <div class="picker-content" style="flex: 1; overflow-y: auto; padding: 16px 20px; display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); grid-auto-rows: max-content; gap: 14px;">
            <div style="grid-column: 1 / -1; text-align: center; color: ${palette.muted}; padding: 40px;">${escapeHtml(translate('vfs.loading'))}</div>
          </div>

          ${saveBarHtml}

          <div class="picker-footer" style="padding: 12px 20px; border-top: 1px solid ${palette.border}; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; background: ${palette.headerBg};">
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              ${localFallbackHtml}
              <div class="picker-selection-info" style="font-size: 12px; color: ${palette.muted};">${escapeHtml(isSaveMode ? translate('vfs.save_folder_hint') : translate('vfs.none_selected'))}</div>
            </div>
            <div style="display: flex; gap: 10px;">
              <button type="button" class="picker-cancel-btn" style="padding: 8px 16px; background: ${palette.btnBg}; border: 1px solid ${palette.border}; border-radius: 7px; color: ${palette.btnText}; cursor: pointer; font-size: 13px;">${escapeHtml(translate('common.cancel'))}</button>
              <button type="button" class="picker-confirm-btn" style="padding: 8px 18px; background: var(--accent, #3b82f6); border: none; border-radius: 7px; color: #fff; font-weight: 600; cursor: pointer; font-size: 13px; opacity: ${isSaveMode ? '1' : '0.5'};" ${isSaveMode ? '' : 'disabled'}>${escapeHtml(confirmLabel)}</button>
            </div>
          </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const contentEl = dialog.querySelector('.picker-content');
        const volumesBarEl = dialog.querySelector('.picker-volumes-bar');
        const breadcrumbsEl = dialog.querySelector('.picker-breadcrumbs');
        const searchInput = dialog.querySelector('.picker-search-input');
        const upBtn = dialog.querySelector('.picker-up-btn');
        const closeBtn = dialog.querySelector('.picker-close-btn');
        const cancelBtn = dialog.querySelector('.picker-cancel-btn');
        const confirmBtn = dialog.querySelector('.picker-confirm-btn');
        const selectionInfo = dialog.querySelector('.picker-selection-info');
        const localFallbackBtn = dialog.querySelector('.picker-local-fallback-btn');
        const saveFilenameInput = dialog.querySelector('.picker-save-filename');
        const saveOverwriteInput = dialog.querySelector('.picker-save-overwrite');

        let cleanedUp = false;
        const keyHandler = (e) => {
          if (e.key === 'Escape') {
            closeDialog(null);
          } else if (e.key === 'Enter') {
            if (isSaveMode) {
              const fname = (saveFilenameInput ? saveFilenameInput.value : '').trim();
              if (fname) {
                closeDialog({
                  dir: currentPath,
                  filename: fname,
                  overwrite: saveOverwriteInput ? Boolean(saveOverwriteInput.checked) : true
                });
              }
            } else if (selectedItems.size > 0) {
              const items = Array.from(selectedItems.values());
              closeDialog(isMultiple ? items : items[0]);
            }
          }
        };

        const closeDialog = (result) => {
          if (cleanedUp) return;
          cleanedUp = true;
          document.removeEventListener('keydown', keyHandler);
          overlay.remove();
          this.activeDialog = null;
          resolve(result);
        };

        this.activeDialog = { close: closeDialog };
        document.addEventListener('keydown', keyHandler);

        const renderVolumesBar = () => {
          if (!volumesBarEl) return;
          const volumes = getMountedVolumes();
          if (!volumes || volumes.length === 0) {
            volumesBarEl.style.display = 'none';
            volumesBarEl.innerHTML = '';
            return;
          }

          volumesBarEl.style.display = 'flex';
          const normCur = String(currentPath || '').replace(/^\/+|\/+$/g, '');
          const pillStyle = (active) => `
            display: inline-flex; align-items: center; gap: 6px;
            padding: 4px 10px; border-radius: 99px; font-size: 12px; font-weight: 600; cursor: pointer;
            border: 1px solid ${active ? 'var(--accent, #6366f1)' : palette.border};
            background: ${active ? 'var(--accent, #6366f1)' : palette.btnBg};
            color: ${active ? '#ffffff' : palette.btnText};
          `;

          const pills = [
            `<button type="button" class="picker-vol-pill" data-vol-path="" style="${pillStyle(normCur === '')}">
              <span>💾</span><span>${escapeHtml(translate('vfs.root_storage'))}</span>
            </button>`
          ];

          volumes.forEach((v) => {
            const vPath = String(v.path || '').replace(/^\/+|\/+$/g, '');
            const isActive = normCur === vPath || normCur.startsWith(vPath + '/');
            const permBadge = v.kind === 'shared'
              ? `<span style="font-size:10px;font-weight:800;padding:1px 5px;border-radius:4px;background:${v.permission === 'read' ? 'rgba(14,165,233,0.25)' : 'rgba(34,197,94,0.28)'};">${v.permission === 'read' ? 'R' : 'RW'}</span>`
              : '';
            const lockIcon = v.is_encrypted ? ' 🔐' : '';
            pills.push(`
              <button type="button" class="picker-vol-pill" data-vol-path="${escapeHtml(vPath)}" style="${pillStyle(isActive)}">
                <span>${escapeHtml(v.mount_icon || (v.kind === 'home' ? '🏠' : '💽'))}</span>
                <span>${escapeHtml(v.mount_name)}${lockIcon}</span>
                ${permBadge}
              </button>
            `);
          });

          volumesBarEl.innerHTML = pills.join('');
          volumesBarEl.querySelectorAll('[data-vol-path]').forEach((btn) => {
            btn.addEventListener('click', () => loadDirectory(btn.dataset.volPath || ''));
          });
        };

        const updateSelectionUI = () => {
          if (isSaveMode) {
            const fname = (saveFilenameInput ? saveFilenameInput.value : '').trim();
            const dirLabel = currentPath ? `/${currentPath}` : '/';
            if (!currentCanUpload) {
              selectionInfo.textContent = translate('vfs.read_only_folder', { path: dirLabel });
              selectionInfo.style.color = '#f59e0b';
              confirmBtn.disabled = true;
              confirmBtn.style.opacity = '0.45';
              return;
            }
            selectionInfo.style.color = palette.muted;
            selectionInfo.textContent = translate('vfs.save_target_info', { path: dirLabel });
            confirmBtn.disabled = !fname;
            confirmBtn.style.opacity = fname ? '1' : '0.5';
            return;
          }

          const count = selectedItems.size;
          if (count === 0) {
            selectionInfo.textContent = translate('vfs.none_selected');
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.5';
          } else {
            const first = Array.from(selectedItems.values())[0];
            selectionInfo.textContent = (count === 1)
              ? translate('vfs.one_selected', { name: first.name })
              : translate('vfs.many_selected', { count });
            confirmBtn.disabled = false;
            confirmBtn.style.opacity = '1';
          }
        };

        if (saveFilenameInput) {
          saveFilenameInput.addEventListener('input', updateSelectionUI);
        }

        const loadDirectory = async (dirPath) => {
          currentPath = dirPath || '';
          renderVolumesBar();
          contentEl.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: ${palette.muted}; padding: 40px;">${escapeHtml(translate('vfs.loading'))}</div>`;
          if (isSaveMode) updateSelectionUI();

          try {
            let data;
            if (window.sys && window.sys.api && typeof window.sys.api.get === 'function') {
              data = await window.sys.api.get('get_gallery', { dir: currentPath });
            } else {
              const res = await fetch(`system/endpoints/api.php?action=get_gallery&dir=${encodeURIComponent(currentPath)}`, { credentials: 'same-origin' });
              data = await res.json();
            }

            if (!data || !data.success) {
              contentEl.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 40px;">${escapeHtml(translate('vfs.load_error'))}</div>`;
              return;
            }

            currentParentPath = (data.parent_path !== undefined && data.parent_path !== null) ? data.parent_path : null;
            currentCanUpload = Boolean(
              (data.user_rights && (data.user_rights.is_admin || data.user_rights.can_upload)) ||
              data.is_admin ||
              window.IS_ADMIN
            );
            if (isSaveMode) updateSelectionUI();

            // Render Breadcrumbs
            breadcrumbsEl.innerHTML = '';
            const bc = data.breadcrumbs || [{ name: translate('vfs.root_storage'), path: '' }];
            bc.forEach((b, i) => {
              const span = document.createElement('span');
              span.textContent = b.name;
              span.style.cursor = 'pointer';
              span.style.color = (i === bc.length - 1) ? palette.text : 'var(--accent, #38bdf8)';
              span.addEventListener('click', () => loadDirectory(b.path));
              breadcrumbsEl.appendChild(span);
              if (i < bc.length - 1) {
                const sep = document.createElement('span');
                sep.textContent = ' / ';
                breadcrumbsEl.appendChild(sep);
              }
            });

            upBtn.disabled = (currentParentPath === null && (data.current_path === '' || currentPath === ''));
            upBtn.style.opacity = upBtn.disabled ? '0.4' : '1';

            const dirs = data.directories || [];
            let files = data.files || [];
            if (!isFolderMode && !isSaveMode) {
              files = files.filter((f) => matchesAcceptFilter(f, acceptFilter));
            }

            contentEl.innerHTML = '';

            if (dirs.length === 0 && (isFolderMode || files.length === 0)) {
              contentEl.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: ${palette.muted}; padding: 40px;">${escapeHtml(translate('vfs.empty_dir'))}</div>`;
              return;
            }

            // Render Folders
            dirs.forEach((dir) => {
              const card = document.createElement('div');
              card.className = 'picker-item picker-folder';
              card.dataset.path = dir.path;
              card.style.cssText = `
                padding: 10px; border-radius: 8px; background: ${palette.cardBg};
                border: 1px solid ${palette.border}; text-align: center; cursor: pointer;
                display: flex; flex-direction: column; align-items: center; gap: 6px; user-select: none;
                transition: background 0.15s, border-color 0.15s;
              `;

              card.innerHTML = `
                <div style="font-size: 34px; line-height: 1;">📁</div>
                <div style="font-size: 12px; font-weight: 500; color: ${palette.text}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%;" title="${escapeHtml(dir.name)}">${escapeHtml(dir.name)}</div>
                <div style="font-size: 10px; color: ${palette.muted};">${escapeHtml(translate('vfs.item_count', { count: dir.item_count || 0 }))}</div>
              `;

              card.addEventListener('mouseenter', () => { card.style.background = palette.cardHover; });
              card.addEventListener('mouseleave', () => {
                if (!selectedItems.has(dir.path)) card.style.background = palette.cardBg;
              });

              if (isFolderMode) {
                card.addEventListener('click', () => {
                  selectedItems.clear();
                  selectedItems.set(dir.path, dir);
                  contentEl.querySelectorAll('.picker-item').forEach((el) => {
                    el.style.background = palette.cardBg;
                    el.style.borderColor = palette.border;
                  });
                  card.style.background = 'rgba(59, 130, 246, 0.18)';
                  card.style.borderColor = '#3b82f6';
                  updateSelectionUI();
                });
                card.addEventListener('dblclick', () => loadDirectory(dir.path));
              } else {
                card.addEventListener('click', () => loadDirectory(dir.path));
              }

              contentEl.appendChild(card);
            });

            // Render Files (for file selection, or as overwrite reference in save mode)
            if (!isFolderMode) {
              files.forEach((file) => {
                const card = document.createElement('div');
                card.className = 'picker-item picker-file';
                card.dataset.path = file.path;
                card.style.cssText = `
                  padding: 8px; border-radius: 8px; background: ${palette.cardBg};
                  border: 1px solid ${palette.border}; text-align: center; cursor: pointer;
                  display: flex; flex-direction: column; align-items: center; gap: 6px; user-select: none;
                  transition: background 0.15s, border-color 0.15s;
                `;

                const thumbUrl = file.thumb_url || `system/endpoints/thumb.php?file=${encodeURIComponent(file.path)}`;
                const isImg = file.category === 'image' || file.category === 'video';

                card.innerHTML = `
                  <div style="width: 100%; height: 72px; border-radius: 6px; overflow: hidden; background: rgba(0,0,0,0.22); display: flex; align-items: center; justify-content: center;">
                    ${isImg
                      ? `<img src="${escapeHtml(thumbUrl)}" alt="${escapeHtml(file.name)}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy">`
                      : `<span style="font-size: 28px;">📄</span>`
                    }
                  </div>
                  <div style="font-size: 11px; font-weight: 500; color: ${palette.text}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%;" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
                  <div style="font-size: 10px; color: ${palette.muted};">${escapeHtml(file.size_formatted || '')}</div>
                `;

                card.addEventListener('mouseenter', () => {
                  if (!selectedItems.has(file.path)) card.style.background = palette.cardHover;
                });
                card.addEventListener('mouseleave', () => {
                  if (!selectedItems.has(file.path)) card.style.background = palette.cardBg;
                });

                if (isSaveMode) {
                  // Clicking an existing file populates the filename field for quick overwrite
                  card.addEventListener('click', () => {
                    if (saveFilenameInput) {
                      saveFilenameInput.value = file.name;
                      updateSelectionUI();
                    }
                  });
                } else {
                  card.addEventListener('click', () => {
                    if (!isMultiple) {
                      selectedItems.clear();
                      contentEl.querySelectorAll('.picker-item').forEach((el) => {
                        el.style.background = palette.cardBg;
                        el.style.borderColor = palette.border;
                      });
                    }

                    if (selectedItems.has(file.path)) {
                      selectedItems.delete(file.path);
                      card.style.background = palette.cardBg;
                      card.style.borderColor = palette.border;
                    } else {
                      selectedItems.set(file.path, file);
                      card.style.background = 'rgba(59, 130, 246, 0.18)';
                      card.style.borderColor = '#3b82f6';
                    }

                    updateSelectionUI();
                  });

                  card.addEventListener('dblclick', () => {
                    selectedItems.clear();
                    selectedItems.set(file.path, file);
                    closeDialog(isMultiple ? [file] : file);
                  });
                }

                contentEl.appendChild(card);
              });
            }
          } catch (err) {
            contentEl.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: #ef4444; padding: 40px;">${escapeHtml(translate('vfs.load_error'))}</div>`;
          }
        };

        upBtn.addEventListener('click', () => {
          if (currentParentPath !== null) {
            loadDirectory(currentParentPath);
            return;
          }
          if (currentPath === '') return;
          const parts = currentPath.split('/');
          parts.pop();
          loadDirectory(parts.join('/'));
        });

        searchInput.addEventListener('input', (e) => {
          const query = (e.target.value || '').toLowerCase();
          contentEl.querySelectorAll('.picker-item').forEach((item) => {
            const name = (item.querySelector('div:nth-child(2)')?.textContent || '').toLowerCase();
            item.style.display = name.includes(query) ? 'flex' : 'none';
          });
        });

        closeBtn.addEventListener('click', () => closeDialog(null));
        cancelBtn.addEventListener('click', () => closeDialog(null));

        if (localFallbackBtn) {
          localFallbackBtn.addEventListener('click', () => closeDialog({ __localFallback: true }));
        }

        confirmBtn.addEventListener('click', () => {
          if (isSaveMode) {
            const fname = (saveFilenameInput ? saveFilenameInput.value : '').trim();
            if (!fname) return;
            closeDialog({
              dir: currentPath,
              filename: fname,
              overwrite: saveOverwriteInput ? Boolean(saveOverwriteInput.checked) : true
            });
            return;
          }
          const items = Array.from(selectedItems.values());
          if (items.length === 0) return;
          closeDialog(isMultiple ? items : items[0]);
        });

        loadDirectory(currentPath);
      });
    }
  }

  const pickerInstance = new FilePickerService();
  window.FilePickerService = FilePickerService;
  window.sys.pickFile = (opts) => pickerInstance.pickFile(opts);
  window.sys.pickFolder = (opts) => pickerInstance.pickFolder(opts);
  window.sys.pickSaveLocation = (opts) => pickerInstance.pickSaveLocation(opts);
  window.sys.filePicker = pickerInstance;
})(window, document);
