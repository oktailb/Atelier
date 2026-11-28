/**
 * Atelier by GallusTech - Explorer Navigation, Tabs, Address Bar & Status Bar Manager
 * (apps/explorer/scripts/explorer-navigation.js)
 * Coordinates browser-grade tabs (Ctrl+T/W, DnD drop targets), Back/Forward/Up history,
 * editable path bar (Ctrl+L), "+ New" menu, and bottom Status Bar with thumbnail zoom slider.
 */
(function (window) {
  'use strict';

  class ExplorerNavigationManager {
    constructor(instance) {
      this.inst = instance;
      this.tabs = [];
      this.activeTabId = null;
      this._tabSeq = 0;
      this._navigatingFromHistory = false;
      this._docClickCleanup = null;
    }

    init(initialPath = '') {
      const clean = this.inst.stateManager ? this.inst.stateManager.normalizePath(initialPath) : (initialPath || '');
      const firstTab = this._makeTab(clean);
      this.tabs = [firstTab];
      this.activeTabId = firstTab.id;

      this.bindEvents();
      this.applyThumbZoom(this.inst.stateManager ? this.inst.stateManager.getThumbZoom() : 210);
      this.renderTabs();
      this.updateNavButtonsUI();
      this.updateStatusBar();
    }

    _makeTab(dirPath) {
      const id = ++this._tabSeq;
      const label = this.inst.stateManager
        ? this.inst.stateManager.getFriendlyPathLabel(dirPath)
        : (dirPath ? (dirPath.split('/').filter(Boolean).pop() || dirPath) : this.inst.t('nav.root'));
      const icon = dirPath.startsWith('ext://') ? '☁️' : (dirPath.startsWith('users/') ? '🏠' : '📁');
      return {
        id,
        path: dirPath,
        title: label,
        icon,
        history: [dirPath],
        historyIndex: 0,
        filterCategory: 'all',
        searchQuery: '',
        showFavoritesOnly: false
      };
    }

    getActiveTab() {
      return this.tabs.find(t => t.id === this.activeTabId) || this.tabs[0] || null;
    }

    createTab(dirPath = null, options = {}) {
      const activate = options.activate !== false;
      const target = dirPath !== null
        ? (this.inst.stateManager ? this.inst.stateManager.normalizePath(dirPath) : String(dirPath || ''))
        : (this.inst.state.currentPath || '');
      const tab = this._makeTab(target);
      this.tabs.push(tab);
      if (activate) {
        this.switchTab(tab.id);
      } else {
        this.renderTabs();
      }
      return tab;
    }

    switchTab(tabId) {
      const target = this.tabs.find(t => t.id === tabId);
      if (!target) return;

      // Snapshot outgoing tab state
      const current = this.getActiveTab();
      if (current && current.id !== target.id) {
        current.path = this.inst.state.currentPath || '';
        current.filterCategory = this.inst.state.filterCategory || 'all';
        current.searchQuery = this.inst.state.searchQuery || '';
        current.showFavoritesOnly = !!this.inst.state.showFavoritesOnly;
      }

      this.activeTabId = target.id;
      this.inst.state.filterCategory = target.filterCategory || 'all';
      this.inst.state.searchQuery = target.searchQuery || '';
      this.inst.state.showFavoritesOnly = !!target.showFavoritesOnly;
      if (this.inst.el.quickSearchInput) {
        this.inst.el.quickSearchInput.value = this.inst.state.searchQuery;
      }
      if (this.inst.el.quickSearchClearBtn) {
        this.inst.el.quickSearchClearBtn.style.display = this.inst.state.searchQuery ? 'block' : 'none';
      }

      this.renderTabs();
      this._navigatingFromHistory = true;
      this.inst.loadDirectory(target.path);
    }

    closeTab(tabId = null) {
      if (this.tabs.length <= 1) return;
      const targetId = tabId || this.activeTabId;
      const idx = this.tabs.findIndex(t => t.id === targetId);
      if (idx === -1) return;

      const wasActive = (targetId === this.activeTabId);
      this.tabs.splice(idx, 1);

      if (wasActive) {
        const nextTab = this.tabs[Math.min(idx, this.tabs.length - 1)] || this.tabs[0];
        if (nextTab) {
          this.activeTabId = nextTab.id;
          this.renderTabs();
          this._navigatingFromHistory = true;
          this.inst.loadDirectory(nextTab.path);
          return;
        }
      }
      this.renderTabs();
    }

    recordNavigation(dirPath) {
      const clean = this.inst.stateManager ? this.inst.stateManager.normalizePath(dirPath) : (dirPath || '');
      const tab = this.getActiveTab();
      if (!tab) return;

      if (this._navigatingFromHistory) {
        this._navigatingFromHistory = false;
        tab.path = clean;
      } else if (tab.history[tab.historyIndex] !== clean) {
        tab.history = tab.history.slice(0, tab.historyIndex + 1);
        tab.history.push(clean);
        if (tab.history.length > 50) {
          tab.history.shift();
        }
        tab.historyIndex = tab.history.length - 1;
        tab.path = clean;
      }

      this.updateNavButtonsUI();
      this.renderTabs();
    }

    updateActiveTabMeta(dirPath, crumbs = []) {
      const tab = this.getActiveTab();
      if (!tab) return;
      const clean = this.inst.stateManager ? this.inst.stateManager.normalizePath(dirPath) : (dirPath || '');
      tab.path = clean;
      const last = Array.isArray(crumbs) && crumbs.length > 0 ? crumbs[crumbs.length - 1] : null;
      const fallbackLabel = this.inst.stateManager
        ? this.inst.stateManager.getFriendlyPathLabel(clean)
        : (clean.split('/').pop() || clean);
      tab.title = (!clean) ? this.inst.t('nav.root') : ((last && last.name && last.name !== clean) ? last.name : fallbackLabel);
      tab.icon = clean.startsWith('ext://') ? '☁️' : (clean.startsWith('users/') ? '🏠' : (clean ? '📁' : '💾'));
      this.renderTabs();
    }

    goBack() {
      const tab = this.getActiveTab();
      if (!tab || tab.historyIndex <= 0) return;
      tab.historyIndex--;
      this._navigatingFromHistory = true;
      this.inst.loadDirectory(tab.history[tab.historyIndex]);
    }

    goForward() {
      const tab = this.getActiveTab();
      if (!tab || tab.historyIndex >= tab.history.length - 1) return;
      tab.historyIndex++;
      this._navigatingFromHistory = true;
      this.inst.loadDirectory(tab.history[tab.historyIndex]);
    }

    goUp() {
      const parent = this.inst.stateManager ? this.inst.stateManager.getParentPath(this.inst.state.currentPath || '') : '';
      if (parent === null) return;
      this.inst.navigateTo(parent);
    }

    refresh() {
      if (this.inst.sidebarManager) this.inst.sidebarManager.invalidateTreeCache();
      this.inst.loadDirectory(this.inst.state.currentPath || '');
    }

    updateNavButtonsUI() {
      const el = this.inst.el;
      const tab = this.getActiveTab();
      const canBack = Boolean(tab && tab.historyIndex > 0);
      const canForward = Boolean(tab && tab.historyIndex < tab.history.length - 1);
      const canUp = Boolean(this.inst.state.currentPath && this.inst.state.currentPath.length > 0);

      if (el.navBackBtn) el.navBackBtn.disabled = !canBack;
      if (el.navForwardBtn) el.navForwardBtn.disabled = !canForward;
      if (el.navUpBtn) el.navUpBtn.disabled = !canUp;

      const canCreate = this.inst.state.isAdmin || (this.inst.state.userRights && this.inst.state.userRights.can_create_folder);
      const canUpload = this.inst.state.isAdmin || (this.inst.state.userRights && this.inst.state.userRights.can_upload);
      if (el.navNewBtn) el.navNewBtn.style.display = (canCreate || canUpload) ? 'inline-flex' : 'none';
      if (el.navNewFolderItem) el.navNewFolderItem.style.display = canCreate ? 'flex' : 'none';
      if (el.navNewFileItem) el.navNewFileItem.style.display = canUpload ? 'flex' : 'none';
      if (el.navUploadItem) el.navUploadItem.style.display = canUpload ? 'flex' : 'none';
    }

    renderTabs() {
      const listEl = this.inst.el.tabsList;
      if (!listEl) return;

      listEl.innerHTML = this.tabs.map(tab => {
        const isActive = tab.id === this.activeTabId;
        const closeHtml = this.tabs.length > 1
          ? `<button type="button" class="explorer-tab-close" data-tab-close="${tab.id}" title="${this.inst.escapeHtml(this.inst.t('explorer.tab_close'))}">✕</button>`
          : '';
        return `
          <div class="explorer-tab ${isActive ? 'active' : ''}" data-tab-id="${tab.id}" data-path="${this.inst.escapeHtml(tab.path)}" role="tab" aria-selected="${isActive ? 'true' : 'false'}" title="${this.inst.escapeHtml(tab.path || this.inst.t('nav.root'))}">
            <span class="explorer-tab-icon">${tab.icon}</span>
            <span class="explorer-tab-title">${this.inst.escapeHtml(tab.title)}</span>
            ${closeHtml}
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.explorer-tab').forEach(tabEl => {
        const id = parseInt(tabEl.dataset.tabId, 10);
        const tabPath = tabEl.dataset.path || '';
        tabEl.onclick = (e) => {
          if (e.target.closest('.explorer-tab-close')) return;
          this.switchTab(id);
        };
        tabEl.onauxclick = (e) => {
          if (e.button === 1 && this.tabs.length > 1) {
            e.preventDefault();
            this.closeTab(id);
          }
        };
        const closeBtn = tabEl.querySelector('.explorer-tab-close');
        if (closeBtn) {
          closeBtn.onclick = (e) => {
            e.stopPropagation();
            this.closeTab(id);
          };
        }
        if (this.inst.dragDropManager) {
          this.inst.dragDropManager.bindDropTarget(tabEl, tabPath);
        }
      });
    }

    enterAddressEditMode() {
      const el = this.inst.el;
      if (!el.addressInput || !el.breadcrumbs) return;
      el.breadcrumbs.style.display = 'none';
      el.addressInput.style.display = 'block';
      el.addressInput.value = this.inst.state.currentPath || '';
      el.addressInput.focus();
      el.addressInput.select();
    }

    exitAddressEditMode(navigate = false) {
      const el = this.inst.el;
      if (!el.addressInput || !el.breadcrumbs) return;
      const typed = el.addressInput.value.trim();
      el.addressInput.style.display = 'none';
      el.breadcrumbs.style.display = 'flex';
      if (navigate) {
        this.inst.navigateTo(typed);
      }
    }

    applyThumbZoom(px) {
      const size = this.inst.stateManager ? this.inst.stateManager.setThumbZoom(px) : px;
      if (this.inst.containerEl) {
        this.inst.containerEl.style.setProperty('--explorer-thumb-size', `${size}px`);
        this.inst.containerEl.style.setProperty('--explorer-polaroid-size', `${Math.max(180, size + 50)}px`);
      }
      if (this.inst.el.statusZoomSlider) {
        this.inst.el.statusZoomSlider.value = String(size);
      }
    }

    updateStatusBar() {
      const el = this.inst.el;
      const foldersCount = (this.inst.state.directories || []).length;
      const filesCount = (this.inst.state.filteredFiles || []).length;

      if (el.statusItemsCount) {
        el.statusItemsCount.textContent = this.inst.t('explorer.status_items', {
          folders: foldersCount,
          files: filesCount
        });
      }

      if (el.statusSelectionInfo) {
        const selectedPaths = this.inst.state.selectedPaths || new Set();
        if (selectedPaths.size > 0) {
          let totalBytes = 0;
          const files = this.inst.state.files || [];
          selectedPaths.forEach(p => {
            const f = files.find(item => item.path === p);
            if (f && f.size) totalBytes += Number(f.size) || 0;
          });
          const formatted = this.inst.stateManager ? this.inst.stateManager.formatBytes(totalBytes) : `${totalBytes} B`;
          el.statusSelectionInfo.textContent = this.inst.t('explorer.status_selected', {
            count: selectedPaths.size,
            size: formatted
          });
          el.statusSelectionInfo.style.display = 'inline-flex';
        } else {
          el.statusSelectionInfo.style.display = 'none';
        }
      }

      if (el.statusViewBadge) {
        const res = this.inst.state.viewResolution || (this.inst.stateManager
          ? this.inst.stateManager.resolveViewModeForPath(this.inst.state.currentPath || '')
          : { mode: this.inst.state.viewMode, profile: 'pro', inherited: false, isExplicit: false });
        const profileKey = res.profile === 'multimedia'
          ? 'explorer.profile_multimedia'
          : (res.profile === 'thumbs' ? 'explorer.profile_thumbs' : 'explorer.profile_pro');
        const originKey = res.isExplicit ? 'explorer.view_custom' : 'explorer.view_inherited';
        el.statusViewBadge.textContent = `${this.inst.t(profileKey)} · ${this.inst.t(originKey)}`;
      }

      if (el.statusResetInheritBtn) {
        const res = this.inst.state.viewResolution;
        const showReset = Boolean(res && res.isExplicit && (this.inst.state.currentPath || '') !== '');
        el.statusResetInheritBtn.style.display = showReset ? 'inline-flex' : 'none';
      }

      if (el.statusZoomWrap) {
        const isList = this.inst.state.viewMode === 'list';
        el.statusZoomWrap.style.display = isList ? 'none' : 'inline-flex';
      }
    }

    bindEvents() {
      const el = this.inst.el;

      if (el.navBackBtn) el.navBackBtn.onclick = () => this.goBack();
      if (el.navForwardBtn) el.navForwardBtn.onclick = () => this.goForward();
      if (el.navUpBtn) el.navUpBtn.onclick = () => this.goUp();
      if (el.navRefreshBtn) el.navRefreshBtn.onclick = () => this.refresh();
      if (el.tabNewBtn) el.tabNewBtn.onclick = () => this.createTab();

      if (el.sidebarToggleBtn) {
        el.sidebarToggleBtn.onclick = () => {
          if (this.inst.sidebarManager) this.inst.sidebarManager.toggleManual();
        };
      }

      if (el.splitToggleBtn) {
        el.splitToggleBtn.onclick = () => {
          if (this.inst.splitPaneManager) this.inst.splitPaneManager.toggle();
        };
      }

      if (el.addressEditBtn) {
        el.addressEditBtn.onclick = (e) => {
          e.stopPropagation();
          this.enterAddressEditMode();
        };
      }

      if (el.addressBar) {
        el.addressBar.addEventListener('click', (e) => {
          if (e.target === el.addressBar || e.target === el.breadcrumbs) {
            this.enterAddressEditMode();
          }
        });
      }

      if (el.addressInput) {
        el.addressInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.exitAddressEditMode(true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            this.exitAddressEditMode(false);
          }
        });
        el.addressInput.addEventListener('blur', () => {
          if (el.addressInput.style.display !== 'none') {
            this.exitAddressEditMode(false);
          }
        });
      }

      // "+ New" Dropdown Menu
      if (el.navNewBtn && el.navNewMenu) {
        el.navNewBtn.onclick = (e) => {
          e.stopPropagation();
          const isOpen = el.navNewMenu.style.display === 'flex';
          el.navNewMenu.style.display = isOpen ? 'none' : 'flex';
        };
      }
      if (el.navNewFolderItem) {
        el.navNewFolderItem.onclick = () => {
          if (el.navNewMenu) el.navNewMenu.style.display = 'none';
          this.inst.openCreateFolderModal();
        };
      }
      if (el.navNewFileItem) {
        el.navNewFileItem.onclick = () => {
          if (el.navNewMenu) el.navNewMenu.style.display = 'none';
          this.inst.createNewFile();
        };
      }
      if (el.navUploadItem && el.navUploadInput) {
        el.navUploadItem.onclick = () => {
          if (el.navNewMenu) el.navNewMenu.style.display = 'none';
          el.navUploadInput.click();
        };
        el.navUploadInput.onchange = (e) => {
          if (e.target.files && e.target.files.length > 0) {
            this.inst.handleUploadFiles(e.target.files, this.inst.state.currentPath);
          }
          e.target.value = '';
        };
      }

      const onDocClick = (e) => {
        if (el.navNewMenu && el.navNewMenu.style.display === 'flex' &&
            el.navNewBtn && !el.navNewBtn.contains(e.target) && !el.navNewMenu.contains(e.target)) {
          el.navNewMenu.style.display = 'none';
        }
      };
      document.addEventListener('click', onDocClick);
      this._docClickCleanup = () => document.removeEventListener('click', onDocClick);

      if (el.statusZoomSlider) {
        el.statusZoomSlider.addEventListener('input', (e) => {
          this.applyThumbZoom(e.target.value);
        });
      }

      if (el.statusResetInheritBtn) {
        el.statusResetInheritBtn.onclick = () => {
          this.inst.resetCurrentFolderViewMode();
        };
      }
    }

    destroy() {
      if (this._docClickCleanup) {
        this._docClickCleanup();
        this._docClickCleanup = null;
      }
    }
  }

  window.ExplorerNavigationManager = ExplorerNavigationManager;
})(window);
