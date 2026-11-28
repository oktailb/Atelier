/**
 * Atelier by GallusTech - Explorer State & Preferences Manager (apps/explorer/scripts/explorer-state.js)
 * Manages per-user storage scopes, 3-profile view mode inheritance per folder (Pro/Thumbnails/Multimedia),
 * per-folder sorts, favorites, recent folders, sidebar width, thumbnail zoom, and filtering/sorting.
 */
(function (window) {
  'use strict';

  const DEFAULT_VIEW_MODE = 'list'; // Mode Pro (dossiers en premier + liste détaillée + sidebar)
  const VALID_VIEWS = ['list', 'grid', 'mosaic', 'polaroid'];

  class ExplorerStateManager {
    constructor(instance) {
      this.inst = instance;
    }

    getUserStorageScope() {
      const u = (window.sys && window.sys.shares && typeof window.sys.shares.getCurrentUser === 'function')
        ? window.sys.shares.getCurrentUser()
        : window.ATELIER_CURRENT_USER;
      if (u && u.username) return `user_${u.username}`;
      return window.IS_ADMIN ? 'admin' : 'guest';
    }

    normalizePath(dirPath) {
      if (!dirPath || dirPath === '.') return '';
      return String(dirPath).replace(/\/+$/, '').trim();
    }

    normalizeThumbUrl(url) {
      if (!url) return url;
      if (typeof url === 'string' && url.startsWith('thumb.php?')) {
        return 'system/endpoints/' + url;
      }
      return url;
    }

    /**
     * Maps concrete viewMode ('list'|'grid'|'mosaic'|'polaroid') to UX profile:
     *  - 'pro'        : list (folders first, detailed table, sidebar visible, Commander ready)
     *  - 'thumbs'     : grid / mosaic (large previews, sidebar visible)
     *  - 'multimedia' : polaroid (immersive polaroids & video strips, sidebar hidden by default)
     */
    getViewProfile(mode) {
      if (mode === 'polaroid') return 'multimedia';
      if (mode === 'grid' || mode === 'mosaic') return 'thumbs';
      return 'pro';
    }

    shouldShowSidebarByDefault(mode) {
      return this.getViewProfile(mode) !== 'multimedia';
    }

    getParentPath(dirPath) {
      const clean = this.normalizePath(dirPath);
      if (!clean) return null;
      if (clean.startsWith('ext://')) {
        const rest = clean.slice(6);
        const parts = rest.split('/').filter(Boolean);
        if (parts.length <= 1) return '';
        parts.pop();
        return 'ext://' + parts.join('/');
      }
      const parts = clean.split('/').filter(Boolean);
      if (parts.length <= 1) return '';
      parts.pop();
      return parts.join('/');
    }

    _folderViewsKey() {
      return `atelier_folder_views_${this.getUserStorageScope()}`;
    }

    getFolderViewsMap() {
      try {
        const raw = localStorage.getItem(this._folderViewsKey());
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
      } catch (e) {
        return {};
      }
    }

    _saveFolderViewsMap(map) {
      try {
        localStorage.setItem(this._folderViewsKey(), JSON.stringify(map || {}));
      } catch (e) { }
    }

    /**
     * Resolves the effective view mode for `dirPath` using hierarchical inheritance:
     * Exact folder override -> closest ancestor override -> root override -> default 'list' (Mode Pro).
     */
    resolveViewModeForPath(dirPath) {
      const clean = this.normalizePath(dirPath);
      const map = this.getFolderViewsMap();
      const exactKey = clean || '__root__';

      if (map[exactKey] && VALID_VIEWS.includes(map[exactKey])) {
        return {
          mode: map[exactKey],
          profile: this.getViewProfile(map[exactKey]),
          sourcePath: clean,
          inherited: false,
          isExplicit: true
        };
      }

      // Walk ancestor chain up to mount/root
      let cursor = this.getParentPath(clean);
      const visited = new Set([clean]);
      while (cursor !== null && !visited.has(cursor)) {
        visited.add(cursor);
        const key = cursor || '__root__';
        if (map[key] && VALID_VIEWS.includes(map[key])) {
          return {
            mode: map[key],
            profile: this.getViewProfile(map[key]),
            sourcePath: cursor,
            inherited: true,
            isExplicit: false
          };
        }
        if (cursor === '') break;
        cursor = this.getParentPath(cursor);
      }

      // Fallback to saved global user preference if valid, else Mode Pro ('list')
      let fallback = DEFAULT_VIEW_MODE;
      try {
        if (window.sys && window.sys.storage && typeof window.sys.storage.getPref === 'function') {
          const pref = window.sys.storage.getPref('explorer_view_mode', null, 'atelier_explorer_view_mode');
          if (pref && VALID_VIEWS.includes(pref)) fallback = pref;
        }
      } catch (e) { }

      return {
        mode: fallback,
        profile: this.getViewProfile(fallback),
        sourcePath: '',
        inherited: clean !== '',
        isExplicit: false
      };
    }

    setFolderViewMode(dirPath, mode) {
      if (!VALID_VIEWS.includes(mode)) return;
      const clean = this.normalizePath(dirPath);
      const key = clean || '__root__';
      const map = this.getFolderViewsMap();
      map[key] = mode;
      this._saveFolderViewsMap(map);

      if (clean === '') {
        this.saveViewMode(mode);
      }
    }

    resetFolderViewMode(dirPath) {
      const clean = this.normalizePath(dirPath);
      const key = clean || '__root__';
      const map = this.getFolderViewsMap();
      if (Object.prototype.hasOwnProperty.call(map, key)) {
        delete map[key];
        this._saveFolderViewsMap(map);
      }
      return this.resolveViewModeForPath(clean);
    }

    loadSavedPreferences() {
      try {
        const scope = this.getUserStorageScope();
        const resolved = this.resolveViewModeForPath(this.inst.state.currentPath || '');
        this.inst.state.viewMode = resolved.mode;
        this.inst.state.viewResolution = resolved;

        const rawFavs = localStorage.getItem(`atelier_favorites_${scope}`)
          || (scope === 'guest' ? localStorage.getItem('atelier_favorites') : null)
          || '[]';
        const savedFavs = JSON.parse(rawFavs);
        this.inst.state.favorites = Array.isArray(savedFavs) ? savedFavs : [];
      } catch (e) { }
    }

    saveViewMode(mode) {
      try {
        if (window.sys && window.sys.storage && typeof window.sys.storage.setPref === 'function') {
          window.sys.storage.setPref('explorer_view_mode', mode, { legacyLocalKey: 'atelier_explorer_view_mode' });
        } else {
          localStorage.setItem(`atelier_explorer_view_mode_${this.getUserStorageScope()}`, mode);
        }
      } catch (e) { }
    }

    saveFolderSort(dirPath, sortBy, sortOrder) {
      try {
        const key = `atelier_folder_sorts_${this.getUserStorageScope()}`;
        const sorts = JSON.parse(localStorage.getItem(key) || '{}');
        sorts[dirPath || '__root__'] = { sortBy, sortOrder };
        localStorage.setItem(key, JSON.stringify(sorts));
      } catch (e) { }
    }

    getFolderSort(dirPath) {
      try {
        const key = `atelier_folder_sorts_${this.getUserStorageScope()}`;
        const sorts = JSON.parse(localStorage.getItem(key) || '{}');
        return sorts[dirPath || '__root__'] || null;
      } catch (e) {
        return null;
      }
    }

    getRecentFolders() {
      try {
        const key = `atelier_recent_folders_${this.getUserStorageScope()}`;
        const list = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(list) ? list : [];
      } catch (e) {
        return [];
      }
    }

    recordRecentFolder(dirPath, label = '') {
      const clean = this.normalizePath(dirPath);
      if (!clean) return;
      try {
        const key = `atelier_recent_folders_${this.getUserStorageScope()}`;
        const list = this.getRecentFolders().filter(item => item && item.path !== clean);
        const name = label || clean.split('/').filter(Boolean).pop() || clean;
        list.unshift({ path: clean, name, ts: Date.now() });
        localStorage.setItem(key, JSON.stringify(list.slice(0, 8)));
      } catch (e) { }
    }

    getSidebarWidth() {
      try {
        const val = parseInt(localStorage.getItem(`atelier_explorer_sidebar_w_${this.getUserStorageScope()}`), 10);
        if (!isNaN(val) && val >= 170 && val <= 420) return val;
      } catch (e) { }
      return 236;
    }

    setSidebarWidth(px) {
      const clamped = Math.max(170, Math.min(420, Math.round(Number(px) || 236)));
      try {
        localStorage.setItem(`atelier_explorer_sidebar_w_${this.getUserStorageScope()}`, String(clamped));
      } catch (e) { }
      return clamped;
    }

    getThumbZoom() {
      try {
        const val = parseInt(localStorage.getItem(`atelier_explorer_thumb_zoom_${this.getUserStorageScope()}`), 10);
        if (!isNaN(val) && val >= 120 && val <= 320) return val;
      } catch (e) { }
      return 210;
    }

    setThumbZoom(px) {
      const clamped = Math.max(120, Math.min(320, Math.round(Number(px) || 210)));
      try {
        localStorage.setItem(`atelier_explorer_thumb_zoom_${this.getUserStorageScope()}`, String(clamped));
      } catch (e) { }
      return clamped;
    }

    formatBytes(bytes) {
      const b = Number(bytes) || 0;
      if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + ' Go';
      if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' Mo';
      if (b >= 1024) return (b / 1024).toFixed(1) + ' Ko';
      return this.inst.t('explorer.bytes_unit', { size: b });
    }

    toggleFavorite(filePath) {
      const state = this.inst.state;
      const idx = state.favorites.indexOf(filePath);
      if (idx !== -1) {
        state.favorites.splice(idx, 1);
        this.inst.showToast(this.inst.t('lightbox.favorite_removed'), 'info');
      } else {
        state.favorites.push(filePath);
        this.inst.showToast(this.inst.t('lightbox.favorite_added'), 'success');
      }
      try {
        localStorage.setItem(`atelier_favorites_${this.getUserStorageScope()}`, JSON.stringify(state.favorites));
      } catch (e) { }

      this.inst.manager.updateMenuBarForActiveInstance();
      if (this.inst.sidebarManager) this.inst.sidebarManager.renderQuickAccess();
      this.inst.applyFilterAndRender();
    }

    computeFilteredAndSortedFiles() {
      const state = this.inst.state;
      let list = [...(state.files || [])];

      if (state.filterCategory !== 'all') {
        list = list.filter(f => f.category === state.filterCategory);
      }

      if (state.showFavoritesOnly) {
        list = list.filter(f => state.favorites.includes(f.path));
      }

      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        list = list.filter(f =>
          f.name.toLowerCase().includes(q) ||
          (f.comment && f.comment.toLowerCase().includes(q))
        );
      }

      list.sort((a, b) => {
        let res = 0;
        if (state.sortBy === 'name') {
          res = a.name.localeCompare(b.name, undefined, { numeric: true });
        } else if (state.sortBy === 'exif_date') {
          res = (a.effective_mtime || a.mtime) - (b.effective_mtime || b.mtime);
        } else if (state.sortBy === 'date' || state.sortBy === 'mtime') {
          res = a.mtime - b.mtime;
        } else if (state.sortBy === 'size') {
          res = a.size - b.size;
        }
        return (state.sortOrder === 'asc') ? res : -res;
      });

      return list;
    }
  }

  window.ExplorerStateManager = ExplorerStateManager;
})(window);
