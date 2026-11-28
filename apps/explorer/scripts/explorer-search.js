/**
 * Atelier by GallusTech - Explorer Search Manager (apps/explorer/scripts/explorer-search.js)
 * Coordinates quick live filtering, tag filtering, and SQLite multi-criteria indexed search (`search_file_index`).
 */
(function (window) {
  'use strict';

  class ExplorerSearchManager {
    constructor(instance) {
      this.inst = instance;
      this._onKeyDown = null;
      this._onResize = null;
    }

    bindEvents() {
      const el = this.inst.el;

      if (el.advSearchOpenBtn) {
        el.advSearchOpenBtn.onclick = () => this.openSearchModal();
      }

      if (el.searchModalCloseBtn) el.searchModalCloseBtn.onclick = () => this.closeSearchModal();
      if (el.searchModal) {
        el.searchModal.onclick = (e) => {
          if (e.target === el.searchModal) this.closeSearchModal();
        };
      }

      this._onKeyDown = (e) => {
        if (e.key === 'Escape' && this.inst.isSearchModalOpen) {
          this.closeSearchModal();
        }
      };
      document.addEventListener('keydown', this._onKeyDown);

      this._onResize = () => {
        if (this.inst.isSearchModalOpen) {
          this.positionSearchModal();
        }
      };
      window.addEventListener('resize', this._onResize);

      if (el.advSearchTiming) {
        el.advSearchTiming.onchange = () => {
          if (el.advSearchCustomDateRow) {
            el.advSearchCustomDateRow.style.display = (el.advSearchTiming.value === 'custom') ? 'flex' : 'none';
          }
        };
      }

      if (el.advSearchResetBtn) {
        el.advSearchResetBtn.onclick = () => {
          if (el.searchAdvancedForm) el.searchAdvancedForm.reset();
          if (el.advSearchCustomDateRow) el.advSearchCustomDateRow.style.display = 'none';
          this.exitSearch();
          this.closeSearchModal();
        };
      }

      if (el.exitSearchBtn) {
        el.exitSearchBtn.onclick = () => this.exitSearch();
      }

      if (el.searchAdvancedForm) {
        el.searchAdvancedForm.onsubmit = async (e) => {
          e.preventDefault();
          await this.submitAdvancedSearch();
        };
      }

      // Quick Live Filter Search Input (instance-scoped) + Enter for instant SQLite global search
      if (el.quickSearchInput) {
        el.quickSearchInput.oninput = (e) => {
          const val = (e.target.value || '').trim().toLowerCase();
          this.inst.state.searchQuery = val;
          if (el.quickSearchClearBtn) {
            el.quickSearchClearBtn.style.display = val ? 'block' : 'none';
          }
          this.inst.applyFilterAndRender();
        };
        el.quickSearchInput.onkeydown = (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            el.quickSearchInput.value = '';
            this.inst.state.searchQuery = '';
            if (el.quickSearchClearBtn) el.quickSearchClearBtn.style.display = 'none';
            if (this.inst.state.isSearchActive) {
              this.exitSearch();
            } else {
              this.inst.applyFilterAndRender();
            }
          } else if (e.key === 'Enter') {
            const raw = (el.quickSearchInput.value || '').trim();
            if (raw && !String(this.inst.state.currentPath || '').startsWith('ext://')) {
              e.preventDefault();
              this.searchIndexed({ q: raw, scope: 'global' });
            }
          }
        };
      }
      if (el.quickSearchClearBtn) {
        el.quickSearchClearBtn.onclick = () => {
          if (el.quickSearchInput) el.quickSearchInput.value = '';
          this.inst.state.searchQuery = '';
          el.quickSearchClearBtn.style.display = 'none';
          if (this.inst.state.isSearchActive) {
            this.exitSearch();
          } else {
            this.inst.applyFilterAndRender();
          }
        };
      }
    }

    openSearchModal() {
      const el = this.inst.el;
      if (!el.searchModal) return;
      if (el.searchModal.parentElement !== document.body) {
        document.body.appendChild(el.searchModal);
      }
      el.searchModal.style.display = 'block';
      el.searchModal.classList.add('open');
      this.inst.isSearchModalOpen = true;

      this.positionSearchModal();
      requestAnimationFrame(() => this.positionSearchModal());

      setTimeout(() => {
        if (el.advSearchName) el.advSearchName.focus();
      }, 50);
    }

    closeSearchModal() {
      const el = this.inst.el;
      if (!el.searchModal) return;
      el.searchModal.style.display = 'none';
      el.searchModal.classList.remove('open');
      this.inst.isSearchModalOpen = false;
    }

    positionSearchModal() {
      const el = this.inst.el;
      if (!el.searchModal) return;
      const card = el.searchModalCard || el.searchModal.querySelector('.search-modal-card');
      if (!card) return;

      const searchBox = (this.inst.containerEl && this.inst.containerEl.querySelector('.explorer-quick-search-wrapper'))
        || el.quickSearchInput
        || document.getElementById('searchInput');

      let top = 48;
      let left = 20;
      const cardWidth = Math.min(580, window.innerWidth - 24);

      if (searchBox) {
        const rect = searchBox.getBoundingClientRect();
        top = rect.bottom + 6;
        left = rect.left;

        if (left + cardWidth > window.innerWidth - 12) {
          left = window.innerWidth - cardWidth - 12;
        }
        if (left < 12) left = 12;

        const estimatedHeight = card.offsetHeight || 460;
        if (top + estimatedHeight > window.innerHeight - 12 && rect.top > estimatedHeight + 12) {
          top = Math.max(12, rect.top - estimatedHeight - 6);
        }
      } else {
        left = Math.max(12, (window.innerWidth - cardWidth) / 2);
        top = Math.max(20, (window.innerHeight - 460) / 2);
      }

      card.style.position = 'fixed';
      card.style.top = `${Math.round(top)}px`;
      card.style.left = `${Math.round(left)}px`;
      card.style.width = `${cardWidth}px`;
    }

    async searchByTag(tagLabel) {
      const cleanTag = String(tagLabel || '').trim();
      if (!cleanTag) return;
      this.inst.state.activeTagFilter = cleanTag;
      await this.searchIndexed({ tag: cleanTag, scope: 'global', limit: 200 }, {
        bannerText: (count) => this.inst.t('explorer.tags_filter_banner', { tag: cleanTag, count })
      });
      if (this.inst.sidebarManager) {
        this.inst.sidebarManager.renderOrganization();
      }
    }

    async searchIndexed(criteria = {}, uiOpts = {}) {
      const el = this.inst.el;
      if (this.inst.state.isTrashView && typeof this.inst.exitTrashView === 'function') {
        this.inst.exitTrashView();
      }
      this.inst.showLoading(true);

      try {
        const params = {
          q: criteria.q || '',
          category: criteria.category || 'all',
          tag: criteria.tag || '',
          dir: criteria.dir !== undefined ? criteria.dir : (this.inst.state.currentPath || ''),
          scope: criteria.scope || 'global',
          size_range: criteria.size_range || 'all',
          timing: criteria.timing || 'all',
          date_from: criteria.date_from || '',
          date_to: criteria.date_to || '',
          gps_only: criteria.gps_only ? 1 : 0,
          limit: criteria.limit || 200
        };

        const json = await window.sys.api.get('search_file_index', params);
        let results = (json && json.success && Array.isArray(json.results)) ? json.results : [];
        if (criteria.favOnly) {
          results = results.filter(f => (this.inst.state.favorites || []).includes(f.path));
        }

        this.inst.state.isSearchActive = true;
        this.inst.state.searchQuery = '';
        this.inst.state.files = results;
        this.inst.state.directories = [];

        if (el.folderSection) el.folderSection.style.display = 'none';
        if (el.searchResultsBanner) {
          el.searchResultsBanner.style.display = 'flex';
          if (el.searchResultsCountText) {
            el.searchResultsCountText.textContent = typeof uiOpts.bannerText === 'function'
              ? uiOpts.bannerText(results.length)
              : `${results.length} ${this.inst.t('search.results_found')} (${this.inst.t('explorer.search_index_badge')})`;
          }
        }

        this.inst.applyFilterAndRender();
        if (this.inst.navigationManager) this.inst.navigationManager.updateStatusBar();
      } catch (err) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_network', { message: err.message }), 'error');
      } finally {
        this.inst.showLoading(false);
      }
    }

    async submitAdvancedSearch() {
      const el = this.inst.el;
      const name = el.advSearchName ? el.advSearchName.value.trim() : '';
      const words = el.advSearchWords ? el.advSearchWords.value.trim() : '';
      const tag = el.advSearchTag ? el.advSearchTag.value.trim() : '';
      const category = el.advSearchCategory ? el.advSearchCategory.value : 'all';
      const location = el.advSearchLocation ? el.advSearchLocation.value : 'current';
      const timing = el.advSearchTiming ? el.advSearchTiming.value : 'all';
      const dateFrom = el.advSearchDateFrom ? el.advSearchDateFrom.value : '';
      const dateTo = el.advSearchDateTo ? el.advSearchDateTo.value : '';
      const sizeRange = el.advSearchSize ? el.advSearchSize.value : 'all';
      const gpsOnly = el.advSearchGpsOnly ? el.advSearchGpsOnly.checked : false;
      const favOnly = el.advSearchFavOnly ? el.advSearchFavOnly.checked : false;

      this.closeSearchModal();
      this.inst.state.activeTagFilter = tag || null;

      const isExternalCurrent = String(this.inst.state.currentPath || '').startsWith('ext://');

      // Use fast SQLite multi-criteria index for local VFS (and global queries)
      if (!isExternalCurrent || location === 'everywhere') {
        const combinedQuery = [name, words].filter(Boolean).join(' ');
        await this.searchIndexed({
          q: combinedQuery,
          category,
          tag,
          dir: this.inst.state.currentPath || '',
          scope: location === 'everywhere' ? 'global' : 'current',
          size_range: sizeRange,
          timing,
          date_from: dateFrom,
          date_to: dateTo,
          gps_only: gpsOnly,
          favOnly,
          limit: 200
        });
        if (this.inst.sidebarManager) this.inst.sidebarManager.renderOrganization();
        return;
      }

      // Fallback to live `search_media` when explicitly searching inside an external `ext://` mount
      this.inst.showLoading(true);
      try {
        const params = {
          dir: this.inst.state.currentPath,
          name: name,
          words: words,
          category: category,
          timing: timing,
          date_from: dateFrom,
          date_to: dateTo,
          size_range: sizeRange,
          gps_only: gpsOnly ? 1 : 0,
          recursive: location === 'everywhere' ? 1 : 0
        };

        const json = await window.sys.api.get('search_media', params);
        if (json && json.success && Array.isArray(json.results)) {
          let results = json.results;
          if (favOnly) {
            results = results.filter(f => (this.inst.state.favorites || []).includes(f.path));
          }

          this.inst.state.isSearchActive = true;
          this.inst.state.searchQuery = '';
          this.inst.state.files = results;
          this.inst.state.directories = [];

          if (el.folderSection) el.folderSection.style.display = 'none';
          if (el.searchResultsBanner) {
            el.searchResultsBanner.style.display = 'flex';
            if (el.searchResultsCountText) {
              el.searchResultsCountText.textContent = `${results.length} ${this.inst.t('search.results_found')}`;
            }
          }

          this.inst.applyFilterAndRender();
          this.inst.showToast(`${results.length} ${this.inst.t('search.results_found')}`, 'info');
        } else {
          this.inst.showToast(`${this.inst.t('search.results_found')}: 0`, 'info');
        }
      } catch (err) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_network', { message: err.message }), 'error');
      } finally {
        this.inst.showLoading(false);
      }
    }

    exitSearch() {
      const el = this.inst.el;
      this.inst.state.searchQuery = '';
      this.inst.state.isSearchActive = false;
      this.inst.state.activeTagFilter = null;

      if (el.quickSearchInput) el.quickSearchInput.value = '';
      if (el.quickSearchClearBtn) el.quickSearchClearBtn.style.display = 'none';

      if (this.inst.manager.getActiveInstance() === this.inst) {
        const searchInput = document.getElementById('searchInput');
        const searchClearBtn = document.getElementById('searchClearBtn');
        if (searchInput) searchInput.value = '';
        if (searchClearBtn) searchClearBtn.style.display = 'none';
      }

      if (el.searchResultsBanner) el.searchResultsBanner.style.display = 'none';
      if (this.inst.sidebarManager) this.inst.sidebarManager.renderOrganization();
      this.inst.loadDirectory(this.inst.state.currentPath);
    }

    destroy() {
      if (this._onKeyDown) {
        document.removeEventListener('keydown', this._onKeyDown);
        this._onKeyDown = null;
      }
      if (this._onResize) {
        window.removeEventListener('resize', this._onResize);
        this._onResize = null;
      }
      if (this.inst.el && this.inst.el.searchModal && this.inst.el.searchModal.parentElement) {
        this.inst.el.searchModal.parentElement.removeChild(this.inst.el.searchModal);
      }
    }
  }

  window.ExplorerSearchManager = ExplorerSearchManager;
})(window);
