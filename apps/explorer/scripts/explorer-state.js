/**
 * Atelier by GallusTech - Explorer State & Preferences Manager (apps/explorer/scripts/explorer-state.js)
 * Manages per-user storage scopes, persistent view preferences, per-folder sorts, favorites,
 * URL normalization, and filtering/sorting of directory entries.
 */
(function (window) {
  'use strict';

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

    normalizeThumbUrl(url) {
      if (!url) return url;
      if (typeof url === 'string' && url.startsWith('thumb.php?')) {
        return 'system/endpoints/' + url;
      }
      return url;
    }

    loadSavedPreferences() {
      try {
        const scope = this.getUserStorageScope();
        let savedView = null;
        if (window.sys && window.sys.storage && typeof window.sys.storage.getPref === 'function') {
          savedView = window.sys.storage.getPref('explorer_view_mode', null, 'atelier_explorer_view_mode');
        }
        if (!savedView && !scope.startsWith('user_')) {
          savedView = localStorage.getItem('atelier_explorer_view_mode') || localStorage.getItem('gallery_view_mode');
        }
        if (savedView) this.inst.state.viewMode = savedView;

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
