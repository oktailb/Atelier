/**
 * Atelier by GallusTech - Explorer Application Orchestrator (apps/explorer/explorer.js)
 * Modular, multi-instance WebOS Explorer coordinating specialized managers in apps/explorer/scripts/.
 */
(function (window) {
  'use strict';

  // -------------------------------------------------------------
  // EXPLORER INDIVIDUAL WINDOW INSTANCE CLASS
  // -------------------------------------------------------------
  class ExplorerInstance {
    constructor(manager, instanceId, options = {}) {
      this.manager = manager;
      this.id = instanceId;
      this.winId = `explorer-${instanceId}`;

      const initialDir = options.dir !== undefined ? options.dir : (options.initialPath !== undefined ? options.initialPath : '');
      this.state = {
        currentPath: initialDir,
        directories: [],
        files: [],
        filteredFiles: [],
        overrides: {},
        sortBy: 'name',
        sortOrder: 'asc',
        filterCategory: 'all',
        searchQuery: '',
        isSearchActive: false,
        showFavoritesOnly: false,
        favorites: [],
        selectedPaths: new Set(),
        lastSelectedIndex: null,
        draggingItemPath: null,
        draggingPaths: null,
        currentBreadcrumbs: null,
        isAdmin: false,
        adminEnabled: false,
        csrfToken: (typeof window !== 'undefined' && (window.CSRF_TOKEN || window.ATELIER_CSRF_TOKEN)) || '',
        userRights: {},
        availableArchives: [],
        viewMode: 'list',
        viewResolution: { mode: 'list', profile: 'pro', sourcePath: '', inherited: false, isExplicit: false },
        galleryTitle: 'Atelier by GallusTech'
      };

      this.isSmartGpsEnabled = true;
      this.leafletMap = null;
      this.leafletMarkersLayer = null;
      this.leafletRouteLayer = null;
      this.leafletTileLayer = null;
      this.isRouteVisible = true;
      this.currentTileLayerName = 'streets';
      this.isSearchModalOpen = false;

      this.emptyDragImage = new Image();
      this._dirCache = new Map();
      this._dirCacheTtlMs = 60000;
      this._renderGeneration = 0;
      this._chunkObserver = null;

      this.initContainer();
      this.initElements();
      this.initWindow(options);
      this.initManagers();
      this.loadSavedPreferences();
      this.updateViewModeButtonsUI();
      this.bindEvents();
      this.initMarqueeSelection();
      if (this.stateManager && this.stateManager.getExplorerPrefs().openInspectorOnStart) {
        this.toggleInspector(true);
      }
      this.loadDirectory(this.state.currentPath);
    }

    initManagers() {
      this.stateManager = window.ExplorerStateManager ? new window.ExplorerStateManager(this) : null;
      this.selectionManager = window.ExplorerSelectionManager ? new window.ExplorerSelectionManager(this) : null;
      this.dragDropManager = window.ExplorerDragDropManager ? new window.ExplorerDragDropManager(this) : null;
      this.mapManager = window.ExplorerMapManager ? new window.ExplorerMapManager(this) : null;
      this.modalsManager = window.ExplorerModalsManager ? new window.ExplorerModalsManager(this) : null;
      this.operationsManager = window.ExplorerOperationsManager ? new window.ExplorerOperationsManager(this) : null;
      this.contextMenuManager = window.ExplorerContextMenuManager ? new window.ExplorerContextMenuManager(this) : null;
      this.inspectorManager = window.ExplorerInspectorManager ? new window.ExplorerInspectorManager(this) : null;
      this.searchManager = window.ExplorerSearchManager ? new window.ExplorerSearchManager(this) : null;
      this.navigationManager = window.ExplorerNavigationManager ? new window.ExplorerNavigationManager(this) : null;
      this.sidebarManager = window.ExplorerSidebarManager ? new window.ExplorerSidebarManager(this) : null;
      this.splitPaneManager = window.ExplorerSplitPaneManager ? new window.ExplorerSplitPaneManager(this) : null;
      this.transfersManager = window.ExplorerTransfersManager ? new window.ExplorerTransfersManager(this) : null;
      this.quickLookManager = window.ExplorerQuickLookManager ? new window.ExplorerQuickLookManager(this) : null;

      if (this.dragDropManager && typeof this.dragDropManager.init === 'function') {
        this.dragDropManager.init();
      }
      if (this.contextMenuManager && typeof this.contextMenuManager.init === 'function') {
        this.contextMenuManager.init();
      }
      if (this.navigationManager && typeof this.navigationManager.init === 'function') {
        this.navigationManager.init(this.state.currentPath || '');
      }
      if (this.sidebarManager && typeof this.sidebarManager.init === 'function') {
        this.sidebarManager.init();
      }
    }

    initContainer() {
      const template = document.getElementById('explorerAppTemplate');
      if (template && template.content && template.content.firstElementChild) {
        this.containerEl = template.content.cloneNode(true).firstElementChild;
      } else {
        const existing = document.getElementById('explorerAppContainer');
        if (existing) {
          this.containerEl = existing.cloneNode(true);
        } else {
          console.error('[Explorer] Template #explorerAppTemplate not found in DOM! Ensure apps/explorer/template.php is rendered by the Kernel.');
          this.containerEl = document.createElement('div');
          this.containerEl.className = 'webos-explorer-container';
          this.containerEl.innerHTML = `
            <div style="padding: 2.5rem 1.5rem; text-align: center; color: var(--text-main, #e2e8f0); font-family: system-ui, sans-serif;">
              <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">⚠️</div>
              <h3 style="margin-bottom: 0.5rem; font-size: 1.1rem;">${this.escapeHtml(this.t('explorer.err_template_missing_title'))}</h3>
              <p style="color: var(--text-muted, #94a3b8); font-size: 0.9rem; max-width: 480px; margin: 0 auto 1.5rem auto;">
                ${this.escapeHtml(this.t('explorer.err_template_missing_desc'))}
              </p>
              <button type="button" onclick="location.reload()" style="padding: 0.5rem 1.25rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(99,102,241,0.2); color: #fff; cursor: pointer;">
                ${this.escapeHtml(this.t('explorer.refresh_page'))}
              </button>
            </div>
          `;
        }
      }
      this.containerEl.id = `explorer-container-${this.id}`;
    }

    initWindow(options = {}) {
      if (!window.WindowManager) return;

      const appTitle = (window.sys && window.sys.appManager)
        ? window.sys.appManager.getAppTitle('explorer')
        : this.t('apps.explorer.title');

      const isFirst = (this.manager.instances.size === 0);
      const offset = ((this.id - 1) * 32) % 160;
      const defaultW = Math.min(960, Math.max(520, Math.round(window.innerWidth * 0.76)));
      const defaultH = Math.min(660, Math.max(420, Math.round(window.innerHeight * 0.72)));
      const defaultX = Math.max(20, Math.round((window.innerWidth - defaultW) / 2) + offset);
      const defaultY = Math.max(50, Math.round((window.innerHeight - defaultH) / 2) + offset);
      const targetWindowState = options.state || ((isFirst && !options.dir) ? 'maximized' : 'floating');

      this.win = window.WindowManager.createWindow({
        id: this.winId,
        appId: 'explorer',
        appName: appTitle,
        title: this.state.galleryTitle,
        icon: '🗂️',
        x: defaultX,
        y: defaultY,
        width: defaultW,
        height: defaultH,
        isMaximized: targetWindowState === 'maximized',
        state: targetWindowState,
        content: this.containerEl,
        onFocus: () => {
          this.manager.setActiveInstance(this);
        },
        onClose: () => {
          this.destroy();
        }
      });
    }

    destroy() {
      if (this.selectionManager && typeof this.selectionManager.destroy === 'function') this.selectionManager.destroy();
      if (this.dragDropManager && typeof this.dragDropManager.destroy === 'function') this.dragDropManager.destroy();
      if (this.mapManager && typeof this.mapManager.destroy === 'function') this.mapManager.destroy();
      if (this.contextMenuManager && typeof this.contextMenuManager.destroy === 'function') this.contextMenuManager.destroy();
      if (this.searchManager && typeof this.searchManager.destroy === 'function') this.searchManager.destroy();
      if (this.navigationManager && typeof this.navigationManager.destroy === 'function') this.navigationManager.destroy();
      if (this.sidebarManager && typeof this.sidebarManager.destroy === 'function') this.sidebarManager.destroy();
      if (this.transfersManager && typeof this.transfersManager.destroy === 'function') this.transfersManager.destroy();
      if (this.quickLookManager && typeof this.quickLookManager.destroy === 'function') this.quickLookManager.destroy();
      this._disconnectChunkObserver();
      if (this._dirCache) this._dirCache.clear();

      if (this.containerEl && this.containerEl.parentNode) {
        this.containerEl.parentNode.removeChild(this.containerEl);
      }
      if (this.manager.activeModalInstance === this) {
        this.manager.activeModalInstance = null;
      }
      this.win = null;
      this.manager.removeInstance(this.id);
    }

    initElements() {
      const root = this.containerEl;
      this.el = {
        // Phase G (Lot 2) Shell Elements: Tabs, Nav Bar, Address Bar, Sidebar, Split Pane & Status Bar
        tabsBar: root.querySelector('.explorer-tabs-bar'),
        tabsList: root.querySelector('.explorer-tabs-list'),
        tabNewBtn: root.querySelector('.explorer-tab-new-btn'),
        sidebarToggleBtn: root.querySelector('.explorer-sidebar-toggle-btn'),
        navBackBtn: root.querySelector('.explorer-nav-back-btn'),
        navForwardBtn: root.querySelector('.explorer-nav-forward-btn'),
        navUpBtn: root.querySelector('.explorer-nav-up-btn'),
        navRefreshBtn: root.querySelector('.explorer-nav-refresh-btn'),
        addressBar: root.querySelector('.explorer-address-bar'),
        addressInput: root.querySelector('.explorer-address-input'),
        addressEditBtn: root.querySelector('.explorer-address-edit-btn'),
        navNewBtn: root.querySelector('.explorer-nav-new-btn'),
        navNewMenu: root.querySelector('.explorer-new-menu'),
        navNewFolderItem: root.querySelector('.explorer-new-folder-item'),
        navNewFileItem: root.querySelector('.explorer-new-file-item'),
        navUploadItem: root.querySelector('.explorer-new-upload-item'),
        navUploadInput: root.querySelector('.explorer-nav-upload-input'),
        transferPanel: root.querySelector('.explorer-transfer-panel'),
        splitToggleBtn: root.querySelector('.explorer-split-toggle-btn'),
        sidebar: root.querySelector('.explorer-sidebar'),
        sidebarResizer: root.querySelector('.explorer-sidebar-resizer'),
        sidebarQuickAccess: root.querySelector('.sidebar-quick-access'),
        sidebarMountsSection: root.querySelector('.sidebar-mounts-section'),
        sidebarMounts: root.querySelector('.sidebar-mounts'),
        sidebarTree: root.querySelector('.sidebar-tree'),
        sidebarOrganization: root.querySelector('.sidebar-organization'),
        sidebarQuota: root.querySelector('.sidebar-quota'),
        secondaryPane: root.querySelector('.explorer-secondary-pane'),
        statusItemsCount: root.querySelector('.status-items-count'),
        statusSelectionInfo: root.querySelector('.status-selection-info'),
        statusViewBadge: root.querySelector('.status-view-badge'),
        statusResetInheritBtn: root.querySelector('.status-reset-inherit-btn'),
        statusZoomWrap: root.querySelector('.status-zoom-wrap'),
        statusZoomSlider: root.querySelector('.status-zoom-slider'),
        volumesBar: root.querySelector('.explorer-volumes-bar'),
        breadcrumbs: root.querySelector('.breadcrumbs'),
        folderDescBanner: root.querySelector('.folder-desc-banner'),
        folderSection: root.querySelector('.folder-section'),
        foldersGrid: root.querySelector('.folders-grid'),
        mediaSection: root.querySelector('.media-section'),
        mediaGrid: root.querySelector('.media-grid'),
        trashView: root.querySelector('.explorer-trash-view'),
        loadingState: root.querySelector('.loading-spinner'),
        emptyState: root.querySelector('.empty-state'),
        filterPills: root.querySelector('.filter-pills'),
        galleryStats: root.querySelector('.gallery-stats'),
        folderMapBtn: root.querySelector('.folder-map-btn'),
        folderSettingsBtn: root.querySelector('.explorer-folder-settings-btn'),
        searchResultsBanner: root.querySelector('.search-results-banner'),
        searchResultsCountText: root.querySelector('.search-results-count-text'),
        exitSearchBtn: root.querySelector('.exit-search-btn'),
        dropZoneOverlay: root.querySelector('.drop-zone-overlay'),
        selectionToolbar: root.querySelector('.selection-toolbar'),
        selectionToolbarCount: root.querySelector('.selection-toolbar-count'),
        selectionCopyBtn: root.querySelector('.selection-copy-btn'),
        selectionCutBtn: root.querySelector('.selection-cut-btn'),
        selectionDeleteBtn: root.querySelector('.selection-delete-btn'),
        selectionInfoBtn: root.querySelector('.selection-info-btn'),
        selectionSelectAllBtn: root.querySelector('.selection-select-all-btn'),
        selectionClearBtn: root.querySelector('.selection-clear-btn'),
        // Instance-scoped modals
        mapModal: root.querySelector('.map-modal'),
        mapModalCloseBtn: root.querySelector('.map-modal-close-btn'),
        mapModalCountBadge: root.querySelector('.map-modal-count-badge'),
        mapSmartGpsCount: root.querySelector('.map-smart-gps-count'),
        mapToggleSmartGpsBtn: root.querySelector('.map-toggle-smart-gps-btn'),
        mapToggleRouteBtn: root.querySelector('.map-toggle-route-btn'),
        mapFitBoundsBtn: root.querySelector('.map-fit-bounds-btn'),
        galleryLeafletMap: root.querySelector('.gallery-leaflet-map'),
        searchModal: root.querySelector('.search-modal'),
        searchModalCard: root.querySelector('.search-modal-card'),
        searchModalCloseBtn: root.querySelector('.search-modal-close-btn'),
        searchAdvancedForm: root.querySelector('.search-advanced-form'),
        advSearchTiming: root.querySelector('.adv-search-timing'),
        advSearchCustomDateRow: root.querySelector('.adv-search-custom-date-row'),
        advSearchResetBtn: root.querySelector('.adv-search-reset-btn'),
        advSearchCategory: root.querySelector('.adv-search-category'),
        advSearchName: root.querySelector('.adv-search-name'),
        advSearchWords: root.querySelector('.adv-search-words'),
        advSearchTag: root.querySelector('.adv-search-tag'),
        advSearchOpenBtn: root.querySelector('.explorer-adv-search-open-btn'),
        advSearchLocation: root.querySelector('.adv-search-location'),
        advSearchDateFrom: root.querySelector('.adv-search-date-from'),
        advSearchDateTo: root.querySelector('.adv-search-date-to'),
        advSearchSize: root.querySelector('.adv-search-size'),
        advSearchGpsOnly: root.querySelector('.adv-search-gps-only'),
        advSearchFavOnly: root.querySelector('.adv-search-fav-only'),
        // Shared shell modal references (routed via manager.activeModalInstance)
        createFolderModal: document.getElementById('createFolderModal'),
        createFolderCloseBtn: document.getElementById('createFolderCloseBtn'),
        createFolderForm: document.getElementById('createFolderForm'),
        newFolderNameInput: document.getElementById('createFolderNameInput') || document.getElementById('newFolderNameInput'),
        createFolderError: document.getElementById('createFolderError'),
        deleteConfirmModal: document.getElementById('deleteConfirmModal'),
        deleteConfirmCloseBtn: document.getElementById('deleteConfirmCloseBtn'),
        deleteCancelBtn: document.getElementById('deleteCancelBtn'),
        deleteConfirmActionBtn: document.getElementById('deleteConfirmActionBtn'),
        deleteConfirmMessage: document.getElementById('deleteConfirmMessage'),
        deleteConfirmItemName: document.getElementById('deleteConfirmItemName'),
        deleteConfirmItemType: document.getElementById('deleteConfirmItemType'),
        mediaCommentModal: document.getElementById('mediaCommentModal'),
        mediaCommentCloseBtn: document.getElementById('mediaCommentCloseBtn'),
        mediaCommentForm: document.getElementById('mediaCommentForm'),
        mediaCommentInput: document.getElementById('mediaCommentInput'),
        mediaCommentFilenameBadge: document.getElementById('mediaCommentFilenameBadge'),
        folderUnlockModal: document.getElementById('folderUnlockModal'),
        folderUnlockCloseBtn: document.getElementById('folderUnlockCloseBtn'),
        folderUnlockForm: document.getElementById('folderUnlockForm'),
        folderPasswordInput: document.getElementById('folderPasswordInput'),
        folderUnlockError: document.getElementById('folderUnlockError'),
        folderSettingsModal: document.getElementById('folderSettingsModal'),
        folderSettingsCloseBtn: document.getElementById('folderSettingsCloseBtn'),
        folderSettingsForm: document.getElementById('folderSettingsForm'),
        dotfileTitleInput: document.getElementById('dotfileTitleInput'),
        dotfileDescInput: document.getElementById('dotfileDescInput'),
        dotfileBgInput: document.getElementById('dotfileBgInput'),
        dotfileAccessModeSelect: document.getElementById('dotfileAccessModeSelect'),
        folderPasswordGroup: document.getElementById('folderPasswordGroup'),
        dotfilePasswordInput: document.getElementById('dotfilePasswordInput'),
        // Multimodal Autorun Banner
        autorunBanner: root.querySelector('.explorer-autorun-banner'),
        autorunTitle: root.querySelector('.autorun-title'),
        autorunDescription: root.querySelector('.autorun-description'),
        autorunPlayBtn: root.querySelector('.autorun-play-btn'),
        autorunEditBtn: root.querySelector('.autorun-edit-btn'),
        explorerAutorunBtn: root.querySelector('.explorer-autorun-btn'),
        // Quick Live Search & View Switcher
        quickSearchInput: root.querySelector('.explorer-quick-search-input'),
        quickSearchClearBtn: root.querySelector('.explorer-quick-search-clear'),
        viewModeBtns: root.querySelectorAll('.view-mode-btn'),
        // Inspector Drawer
        inspectorToggleBtn: root.querySelector('.explorer-inspector-toggle-btn'),
        inspectorDrawer: root.querySelector('.explorer-inspector-drawer'),
        inspectorCloseBtn: root.querySelector('.inspector-close-btn'),
        inspectorEmptyState: root.querySelector('.inspector-empty-state'),
        inspectorDetails: root.querySelector('.inspector-details'),
        inspectorPreviewImg: root.querySelector('.inspector-preview-img'),
        inspectorPreviewIcon: root.querySelector('.inspector-preview-icon'),
        inspectorFilenameBadge: root.querySelector('.inspector-filename-badge'),
        inspectorOpenBtn: root.querySelector('.inspector-open-btn'),
        inspectorQuicklookBtn: root.querySelector('.inspector-quicklook-btn'),
        inspectorOpenWithSection: root.querySelector('.inspector-open-with-section'),
        inspectorOpenWithList: root.querySelector('.inspector-open-with-list'),
        inspectorMetaName: root.querySelector('.inspector-meta-name'),
        inspectorMetaSize: root.querySelector('.inspector-meta-size'),
        inspectorMetaDim: root.querySelector('.inspector-meta-dim'),
        inspectorMetaDate: root.querySelector('.inspector-meta-date'),
        inspectorMetaComment: root.querySelector('.inspector-meta-comment'),
        inspectorMetaCamera: root.querySelector('.inspector-meta-camera'),
        inspectorMetaGps: root.querySelector('.inspector-meta-gps')
      };
    }

    getUserStorageScope() {
      return this.stateManager ? this.stateManager.getUserStorageScope() : 'guest';
    }

    loadSavedPreferences() {
      if (this.stateManager) this.stateManager.loadSavedPreferences();
    }

    t(key, params = {}) {
      if (window.desktop && typeof window.desktop.t === 'function') {
        return window.desktop.t(key, params);
      }
      if (window.sys && window.sys.i18n && typeof window.sys.i18n.t === 'function') {
        return window.sys.i18n.t(key, params);
      }
      if (window.I18nEngine && typeof window.I18nEngine.t === 'function') {
        return window.I18nEngine.t(key, params);
      }
      return key;
    }

    escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    showLoading(show) {
      if (this.el.loadingState) {
        this.el.loadingState.style.display = show ? 'flex' : 'none';
      }
    }

    showToast(msg, type = 'info') {
      if (window.desktop && typeof window.desktop.showToast === 'function') {
        window.desktop.showToast(msg, type);
      }
    }

    // -------------------------------------------------------------
    // NAVIGATION, DIRECTORY CACHE & LOADING
    // -------------------------------------------------------------
    invalidateDirCache(dirPath = null) {
      if (!this._dirCache) return;
      if (dirPath === null || dirPath === undefined) {
        this._dirCache.clear();
      } else {
        const clean = (dirPath === '.' || !dirPath) ? '' : String(dirPath).trim();
        this._dirCache.delete(clean);
      }
    }

    _disconnectChunkObserver() {
      if (this._chunkObserver) {
        try { this._chunkObserver.disconnect(); } catch (e) { }
        this._chunkObserver = null;
      }
    }

    navigateTo(dirPath, options = {}) {
      const cleanPath = (dirPath === '.' || !dirPath) ? '' : String(dirPath).trim();
      this.loadDirectory(cleanPath, options);
    }

    async loadDirectory(dirPath, options = {}) {
      const cleanPath = (dirPath === '.' || !dirPath) ? '' : String(dirPath).trim();
      const forceRefresh = Boolean(options && options.forceRefresh);
      this.state.isTrashView = false;
      if (this.el.trashView) this.el.trashView.style.display = 'none';
      if (this.el.mediaSection) this.el.mediaSection.style.display = '';
      this.state.currentPath = cleanPath;

      let json = null;
      const prefs = this.stateManager ? this.stateManager.getExplorerPrefs() : { enableNavCache: true };
      const cached = (!forceRefresh && prefs.enableNavCache !== false && this._dirCache) ? this._dirCache.get(cleanPath) : null;
      if (cached && (Date.now() - cached.ts) < this._dirCacheTtlMs) {
        json = cached.data;
      }

      if (!json) {
        this.showLoading(true);
      }

      try {
        if (!json) {
          json = await window.sys.api.get('get_gallery', { dir: cleanPath, _t: Date.now() });
          if (json && json.success && this._dirCache) {
            if (this._dirCache.size >= 30) {
              const oldestKey = this._dirCache.keys().next().value;
              if (oldestKey !== undefined) this._dirCache.delete(oldestKey);
            }
            this._dirCache.set(cleanPath, { ts: Date.now(), data: json });
          }
        }

        if (!json || !json.success) {
          this.state.directories = [];
          this.state.files = [];
          this.state.filteredFiles = [];
          this.renderFolders([]);
          this.updateStats();

          if (json && json.is_protected) {
            this.openFolderUnlockModal(cleanPath);
            this.renderProtectedState(cleanPath);
          } else {
            this.renderPrivateState((json && json.error) || this.t('explorer.err_access_denied'));
          }
          return;
        }

        this.state.isSearchActive = false;
        if (this.el.searchResultsBanner) this.el.searchResultsBanner.style.display = 'none';

        const norm = (url) => this.stateManager ? this.stateManager.normalizeThumbUrl(url) : url;

        this.state.directories = (json.directories || []).map(d => ({
          ...d,
          cover: norm(d.cover)
        }));
        this.state.files = (json.files || []).map(f => ({
          ...f,
          thumb_url: norm(f.thumb_url),
          file_url: norm(f.file_url)
        }));
        this.state.overrides = json.overrides || {};
        if (this.state.overrides.background) {
          this.state.overrides.background = norm(this.state.overrides.background);
        }

        this.state.isAdmin = !!json.is_admin;
        this.state.adminEnabled = !!json.admin_enabled;
        this.state.userRights = json.user_rights || {};
        if (json.csrf_token) {
          this.state.csrfToken = json.csrf_token;
          window.CSRF_TOKEN = json.csrf_token;
          window.ATELIER_CSRF_TOKEN = json.csrf_token;
        }
        if (json.available_archives) this.state.availableArchives = json.available_archives;

        this.applyFolderOverrides(this.state.overrides);

        // Resolve per-folder view mode with hierarchical parent inheritance (Pro / Thumbs / Multimedia)
        if (this.stateManager && typeof this.stateManager.resolveViewModeForPath === 'function') {
          const resolved = this.stateManager.resolveViewModeForPath(cleanPath);
          this.state.viewMode = resolved.mode;
          this.state.viewResolution = resolved;
          this.updateViewModeButtonsUI();
          if (this.sidebarManager) {
            this.sidebarManager.applyProfileVisibility(this.state.viewMode);
          }
        }

        const savedSort = this.getFolderSort(cleanPath);
        if (savedSort && savedSort.sortBy) {
          this.state.sortBy = savedSort.sortBy;
          this.state.sortOrder = savedSort.sortOrder || 'asc';
        } else {
          this.state.sortBy = 'name';
          this.state.sortOrder = 'asc';
        }

        this.manager.updateMenuBarForActiveInstance();

        if (this.navigationManager) {
          this.navigationManager.recordNavigation(cleanPath);
          this.navigationManager.updateActiveTabMeta(cleanPath, json.breadcrumbs || []);
          this.navigationManager.updateNavButtonsUI();
        }

        this.renderBreadcrumbs(json.breadcrumbs || []);
        this.renderVolumesBar();
        this.renderFolders(this.state.directories);

        if (this.sidebarManager) {
          this.sidebarManager.onDirectoryLoaded(cleanPath, this.state.directories);
        }

        this.state.filterCategory = 'all';
        this.updateFilterPillsUI();
        this.applyFilterAndRender();

        if (this.navigationManager) {
          this.navigationManager.updateStatusBar();
        }
      } catch (err) {
        console.error('[Explorer] Error fetching directory:', err);
      } finally {
        this.showLoading(false);
      }
    }

    applyFolderOverrides(overrides) {
      if (!this.containerEl) return;
      if (overrides && overrides.background) {
        const bg = overrides.background;
        if (bg.startsWith('#') || bg.startsWith('rgb') || bg.startsWith('hsl') || bg.startsWith('linear-gradient') || bg.startsWith('radial-gradient')) {
          this.containerEl.style.backgroundColor = bg;
          this.containerEl.style.backgroundImage = 'none';
        } else {
          const url = bg.startsWith('url(') ? bg : `url("${bg}")`;
          this.containerEl.style.backgroundImage = url;
          this.containerEl.style.backgroundSize = 'cover';
          this.containerEl.style.backgroundPosition = 'center';
          this.containerEl.style.backgroundRepeat = 'no-repeat';
        }
      } else {
        this.containerEl.style.backgroundImage = '';
        this.containerEl.style.backgroundColor = '';
        this.containerEl.style.backgroundSize = '';
        this.containerEl.style.backgroundPosition = '';
        this.containerEl.style.backgroundRepeat = '';
      }

      if (this.el.folderDescBanner) {
        if (overrides && overrides.description) {
          this.el.folderDescBanner.innerHTML = this.escapeHtml(overrides.description).replace(/\n/g, '<br/>');
          this.el.folderDescBanner.style.display = 'block';
        } else {
          this.el.folderDescBanner.style.display = 'none';
        }
      }

      if (this.el.autorunBanner) {
        if (overrides && overrides.has_autorun && overrides.autorun) {
          const ar = overrides.autorun;
          if (this.el.autorunTitle) this.el.autorunTitle.textContent = ar.title || this.t('autorun.badge');
          if (this.el.autorunDescription) this.el.autorunDescription.textContent = ar.description || '';
          if (this.el.autorunPlayBtn) {
            this.el.autorunPlayBtn.onclick = (e) => {
              e.preventDefault();
              this.launchAutorun(ar);
            };
          }
          if (this.el.autorunEditBtn) {
            const canEdit = this.state.isAdmin || (this.state.userRights && this.state.userRights.can_edit);
            this.el.autorunEditBtn.style.display = canEdit ? 'inline-flex' : 'none';
            this.el.autorunEditBtn.onclick = (e) => {
              e.preventDefault();
              this.openAutorunEditorModal();
            };
          }
          this.el.autorunBanner.style.display = 'block';
        } else {
          this.el.autorunBanner.style.display = 'none';
        }
      }

      if (this.el.explorerAutorunBtn) {
        const canEdit = this.state.isAdmin || (this.state.userRights && this.state.userRights.can_edit);
        this.el.explorerAutorunBtn.style.display = canEdit ? 'inline-flex' : 'none';
        this.el.explorerAutorunBtn.onclick = (e) => {
          e.preventDefault();
          this.openAutorunEditorModal();
        };
      }

      if (this.el.folderSettingsBtn) {
        this.el.folderSettingsBtn.style.display = this.state.isAdmin ? 'inline-flex' : 'none';
      }
    }

    renderVolumesBar() {
      if (!this.el || !this.el.volumesBar) return;
      if (this.sidebarManager && this.sidebarManager.isVisible) {
        this.el.volumesBar.style.display = 'none';
        return;
      }
      if (window.sys && window.sys.shares && typeof window.sys.shares.renderExplorerMountsBar === 'function') {
        window.sys.shares.renderExplorerMountsBar(
          this.el.volumesBar,
          this.state.currentPath || '',
          (targetPath) => this.loadDirectory(targetPath)
        );
      }
    }

    renderBreadcrumbs(crumbs) {
      this.state.currentBreadcrumbs = crumbs;
      const nav = this.el.breadcrumbs;
      if (!nav) return;

      const rootLabel = this.t('nav.root');

      nav.innerHTML = crumbs.map((crumb, idx) => {
        const isLast = idx === crumbs.length - 1;
        const isRoot = idx === 0 || crumb.path === '' || crumb.path === '.';
        const displayName = (!isRoot && this.stateManager && crumb.path && String(crumb.path).startsWith('ext://') && (!crumb.name || crumb.name === crumb.path))
          ? this.stateManager.getFriendlyPathLabel(crumb.path)
          : crumb.name;
        const contentHtml = isRoot
          ? `<span class="crumb-root-icon" aria-hidden="true">💾</span> <span class="crumb-root-name" data-i18n="nav.root">${this.escapeHtml(rootLabel)}</span>`
          : `<span>${this.escapeHtml(displayName)}</span>`;
        const titleAttr = isRoot ? `data-i18n-title="nav.root" title="${this.escapeHtml(rootLabel)}"` : `title="${this.escapeHtml(displayName)}"`;

        if (isLast) {
          return `<span class="crumb-item crumb-active ${isRoot ? 'crumb-root-item' : ''}" ${titleAttr}>${contentHtml}</span>`;
        }
        const targetPath = (crumb.path === undefined || crumb.path === null || crumb.path === '.') ? '' : crumb.path;
        return `
          <button type="button" class="crumb-item crumb-btn ${isRoot ? 'crumb-root-item' : ''}" data-path="${this.escapeHtml(targetPath)}" ${titleAttr}>
            ${contentHtml}
          </button>
          <span class="crumb-separator">/</span>
        `;
      }).join('');

      nav.onclick = (e) => {
        const btn = e.target.closest('.crumb-item');
        if (!btn || btn.classList.contains('crumb-active')) return;
        e.preventDefault();
        e.stopPropagation();
        const destPath = btn.getAttribute('data-path') !== null ? btn.getAttribute('data-path') : '';
        this.navigateTo(destPath);
      };

      nav.querySelectorAll('.crumb-btn').forEach(btn => {
        const destPath = btn.getAttribute('data-path') !== null ? btn.getAttribute('data-path') : '';
        btn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.navigateTo(destPath);
        };
        if (this.dragDropManager) {
          this.dragDropManager.bindDropTarget(btn, destPath);
        }
      });

      if (window.WindowManager) {
        const lastCrumb = (crumbs && crumbs.length) ? crumbs[crumbs.length - 1] : null;
        const isRootLast = (!crumbs || crumbs.length <= 1);
        const folderName = isRootLast ? rootLabel : (lastCrumb ? lastCrumb.name : rootLabel);
        const fullTitle = isRootLast ? `${this.state.galleryTitle} : ${rootLabel}` : `${this.state.galleryTitle} : ${folderName}`;
        window.WindowManager.setTitle(this.winId, fullTitle);
      }
    }

    renderFolders(folders) {
      if (!this.el.folderSection || !this.el.foldersGrid) return;

      // In Pro List mode, folders are rendered first inside the unified table (when enabled in preferences)
      const prefs = this.stateManager ? this.stateManager.getExplorerPrefs() : { unifiedFoldersInList: true };
      const activePlugin = window.GalleryViewRegistry && window.GalleryViewRegistry.get(this.state.viewMode);
      if (this.state.viewMode === 'list' && prefs.unifiedFoldersInList !== false && activePlugin && activePlugin.supportsUnifiedFolders) {
        this.el.folderSection.style.display = 'none';
        this.el.foldersGrid.innerHTML = '';
        return;
      }

      if (!folders || folders.length === 0) {
        this.el.folderSection.style.display = 'none';
        this.el.foldersGrid.innerHTML = '';
        return;
      }

      const sortedFolders = (this.stateManager && typeof this.stateManager.computeSortedDirectories === 'function')
        ? this.stateManager.computeSortedDirectories()
        : [...folders];

      const canMove = this.state.isAdmin || (this.state.userRights && this.state.userRights.can_move);

      this.el.folderSection.style.display = 'block';
      this.el.foldersGrid.innerHTML = sortedFolders.map(folder => {
        const badge = folder.is_protected ? '<span class="folder-badge lock-badge">🔒</span>' : '';
        const handleClass = canMove ? 'drag-handle' : '';
        const deleteBtnHtml = this.state.isAdmin ? `<button class="delete-item-btn" data-path="${this.escapeHtml(folder.path)}" data-name="${this.escapeHtml(folder.name)}" data-type="folder" title="${this.escapeHtml(this.t('folder.delete_title'))}">🗑️</button>` : '';
        const settingsBtnHtml = this.state.isAdmin ? `<button type="button" class="folder-settings-btn" data-path="${this.escapeHtml(folder.path)}" data-name="${this.escapeHtml(folder.name)}" title="${this.escapeHtml(this.t('nav.folder_settings'))}">⚙️</button>` : '';

        return `
          <div class="folder-card ${handleClass} ${folder.is_protected && !folder.is_unlocked && !this.state.isAdmin ? 'protected-card' : ''}" data-path="${this.escapeHtml(folder.path)}" data-protected="${folder.is_protected ? '1' : '0'}" data-unlocked="${folder.is_unlocked ? '1' : '0'}" draggable="true" role="button" tabindex="0">
            ${deleteBtnHtml}
            ${settingsBtnHtml}
            ${badge}
            <div class="folder-icon-wrapper">
              ${folder.is_protected && !folder.is_unlocked && !this.state.isAdmin ? '<div class="folder-lock-icon">🔒</div>' : (folder.cover ? `<img src="${this.escapeHtml(folder.cover)}" alt="${this.escapeHtml(folder.name)}" class="folder-cover-img" loading="lazy" draggable="false" />` : '📁')}
            </div>
            <div class="folder-name">${this.escapeHtml(folder.name)}</div>
            ${typeof folder.item_count === 'number' ? `<div class="folder-meta"><span>${this.escapeHtml(this.t('folder.items_count', { count: folder.item_count }))}</span></div>` : ''}
            ${folder.comment ? `<div class="folder-comment">💬 ${this.escapeHtml(folder.comment)}</div>` : ''}
          </div>
        `;
      }).join('');

      this.el.foldersGrid.querySelectorAll('.folder-card').forEach(card => {
        const folderPath = card.dataset.path;
        const folderObj = (folders && folders.find(fd => fd.path === folderPath)) || {};
        const folderName = folderObj.name || card.querySelector('.folder-name')?.textContent || folderPath.split('/').pop();
        const folderCover = folderObj.cover || folderObj.cover_url || '';

        const openThisFolder = () => {
          const isProtected = card.dataset.protected === '1';
          const isUnlocked = card.dataset.unlocked === '1';
          if (isProtected && !isUnlocked && !this.state.isAdmin) {
            this.openFolderUnlockModal(folderPath);
          } else {
            this.navigateTo(folderPath);
          }
        };

        card.onclick = (e) => {
          if (e.target.closest('.delete-item-btn, .folder-settings-btn')) return;
          e.preventDefault();
          const prefs = this.stateManager ? this.stateManager.getExplorerPrefs() : { openMode: 'double' };
          if (e.ctrlKey || e.metaKey) {
            e.stopPropagation();
            if (this.state.selectedPaths.has(folderPath)) this.state.selectedPaths.delete(folderPath);
            else this.state.selectedPaths.add(folderPath);
            this.updateSelectionUI();
            return;
          }
          if (prefs.openMode === 'double') {
            this.state.selectedPaths.clear();
            this.state.selectedPaths.add(folderPath);
            this.updateSelectionUI();
            return;
          }
          openThisFolder();
        };

        card.ondblclick = (e) => {
          if (e.target.closest('.delete-item-btn, .folder-settings-btn')) return;
          e.preventDefault();
          openThisFolder();
        };

        card.onauxclick = (e) => {
          if (e.button === 1 && this.navigationManager) {
            e.preventDefault();
            this.navigationManager.createTab(folderPath, { activate: true });
          }
        };

        const delBtn = card.querySelector('.delete-item-btn');
        if (delBtn) {
          delBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openDeleteConfirmModal(delBtn.dataset.path, delBtn.dataset.name, 'folder');
          };
        }

        const settingsBtn = card.querySelector('.folder-settings-btn');
        if (settingsBtn) {
          settingsBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openFolderSettingsModal(folderPath);
          };
        }

        card.ondragstart = (e) => {
          this.state.draggingPaths = [folderPath];
          this.state.draggingItemPath = folderPath;
          window.ATELIER_DRAGGING_PATHS = [folderPath];
          window.ATELIER_DRAG_SOURCE_INSTANCE = this.id;

          const folderData = {
            type: 'folder',
            path: folderPath,
            name: folderName,
            icon: folderObj.icon || '📁',
            cover_url: folderCover
          };
          window.ATELIER_DRAGGING_ITEM_DATA = folderData;

          e.dataTransfer.setData('text/plain', JSON.stringify([folderPath]));
          e.dataTransfer.setData('application/json', JSON.stringify([folderPath]));
          e.dataTransfer.setData('application/atelier-item', JSON.stringify(folderData));
          e.dataTransfer.effectAllowed = 'copyMove';
          card.classList.add('is-dragging');
        };

        card.ondragend = () => {
          this.state.draggingPaths = null;
          this.state.draggingItemPath = null;
          setTimeout(() => {
            window.ATELIER_DRAGGING_PATHS = null;
            window.ATELIER_DRAG_SOURCE_INSTANCE = null;
            window.ATELIER_DRAGGING_ITEM_DATA = null;
          }, 300);
          if (this.dragDropManager) this.dragDropManager.clearVisualDragClasses();
        };

        if (this.dragDropManager) {
          this.dragDropManager.bindFolderDropTarget(card, folderPath);
        }
      });
    }

    applyFilterAndRender() {
      this.state.filteredFiles = this.stateManager
        ? this.stateManager.computeFilteredAndSortedFiles()
        : [...(this.state.files || [])];
      this.updateStats();
      this.updateFolderMapButton();
      this.renderMedia();
    }

    renderMedia() {
      if (!this.el.mediaGrid) return;
      this._disconnectChunkObserver();
      const renderGen = ++this._renderGeneration;
      const list = this.state.filteredFiles || [];

      const prefs = this.stateManager ? this.stateManager.getExplorerPrefs() : { unifiedFoldersInList: true, showCheckboxesInList: true };
      const viewPlugin = (window.GalleryViewRegistry && window.GalleryViewRegistry.get(this.state.viewMode))
        || (window.GalleryViewRegistry && window.GalleryViewRegistry.get('polaroid'))
        || (window.GalleryViewRegistry && window.GalleryViewRegistry.getAll()[0]);
      const isUnifiedList = Boolean(this.state.viewMode === 'list' && prefs.unifiedFoldersInList !== false && viewPlugin && viewPlugin.supportsUnifiedFolders);
      const sortedDirs = (isUnifiedList && !this.state.isSearchActive && !this.state.showFavoritesOnly)
        ? (this.stateManager && typeof this.stateManager.computeSortedDirectories === 'function'
            ? this.stateManager.computeSortedDirectories()
            : [...(this.state.directories || [])])
        : [];

      if (list.length === 0 && (!isUnifiedList || sortedDirs.length === 0)) {
        if (this.state.showFavoritesOnly) {
          this.el.emptyState.style.display = 'block';
          this.el.mediaGrid.style.display = 'none';
          this.el.emptyState.innerHTML = `
            <div class="empty-state-icon">🤍</div>
            <h3>${this.escapeHtml(this.t('stats.no_favorites_title'))}</h3>
            <p>${this.escapeHtml(this.t('stats.no_favorites_desc'))}</p>
          `;
          return;
        }
        if (this.state.filterCategory !== 'all' && this.state.files.length > 0) {
          this.el.emptyState.style.display = 'block';
          this.el.mediaGrid.style.display = 'none';
          this.el.emptyState.innerHTML = `
            <div class="empty-state-icon">🔍</div>
            <h3>${this.escapeHtml(this.t('view.no_filter_results'))}</h3>
            <p>${this.escapeHtml(this.t('view.no_filter_results_desc'))}</p>
            <button type="button" class="pill-btn active" style="margin-top: 1rem;">
              ${this.escapeHtml(this.t('view.filter_all'))}
            </button>
          `;
          const btn = this.el.emptyState.querySelector('button');
          if (btn) btn.onclick = () => this.setFilterCategory('all');
          return;
        }
        if (this.state.directories.length === 0) {
          this.el.emptyState.style.display = 'block';
          this.el.mediaGrid.style.display = 'none';
          this.el.emptyState.innerHTML = `
            <div class="empty-state-icon">📂</div>
            <h3>${this.escapeHtml(this.t('stats.empty'))}</h3>
            <p>${this.escapeHtml(this.t('stats.drag_drop_hint'))}</p>
          `;
          return;
        }
        this.el.emptyState.style.display = 'none';
        this.el.mediaGrid.style.display = 'none';
        this.el.mediaGrid.innerHTML = '';
        return;
      }

      this.el.emptyState.style.display = 'none';
      this.el.mediaGrid.style.display = '';

      const smartLocationsMap = new Map();
      if (this.isSmartGpsEnabled) {
        const smartLocations = this.computeSmartGpsLocations(list);
        smartLocations.forEach(item => smartLocationsMap.set(item.file.path, item));
      }

      const canMove = this.state.isAdmin || (this.state.userRights && this.state.userRights.can_move);
      const context = {
        t: this.t.bind(this),
        escapeHtml: this.escapeHtml.bind(this),
        isAdmin: this.state.isAdmin,
        userRights: this.state.userRights,
        favorites: this.state.favorites,
        selectedPaths: this.state.selectedPaths,
        smartLocationsMap: smartLocationsMap,
        directories: sortedDirs,
        sortBy: this.state.sortBy || 'name',
        sortOrder: this.state.sortOrder || 'asc',
        totalFileCount: list.length,
        isDraggable: canMove ? 'true' : 'false',
        handleClass: canMove ? 'drag-handle' : ''
      };

      const RENDER_BATCH_SIZE = 80;
      const initialSlice = list.length > RENDER_BATCH_SIZE ? list.slice(0, RENDER_BATCH_SIZE) : list;

      if (viewPlugin) {
        const hideCbClass = (this.state.viewMode === 'list' && prefs.showCheckboxesInList === false) ? ' list-hide-checkboxes' : '';
        this.el.mediaGrid.className = `media-grid ${viewPlugin.containerClass || 'polaroid-grid'}${hideCbClass}`;
        if (typeof viewPlugin.renderContainer === 'function') {
          this.el.mediaGrid.innerHTML = viewPlugin.renderContainer(initialSlice, context);
        } else if (typeof viewPlugin.renderItem === 'function') {
          this.el.mediaGrid.innerHTML = initialSlice.map((file, idx) => viewPlugin.renderItem(file, idx, context)).join('');
        }

        // Progressive chunked rendering for large galleries (> 80 files)
        if (list.length > RENDER_BATCH_SIZE && typeof viewPlugin.renderItem === 'function') {
          this._setupChunkedRendering(list, RENDER_BATCH_SIZE, viewPlugin, context, renderGen);
        }
      }

      // Bind folder rows in unified list view as drop targets
      if (isUnifiedList && this.dragDropManager) {
        this.el.mediaGrid.querySelectorAll('.list-table-row-folder[data-path]').forEach(row => {
          this.dragDropManager.bindFolderDropTarget(row, row.dataset.path);
        });
      }

      this.bindMediaCardEvents();
    }

    _setupChunkedRendering(list, batchSize, viewPlugin, context, renderGen) {
      const targetContainer = this.el.mediaGrid.querySelector('.list-table-body') || this.el.mediaGrid;
      if (!targetContainer) return;

      let renderedCount = batchSize;
      const sentinel = document.createElement('div');
      sentinel.className = 'explorer-chunk-sentinel';
      sentinel.textContent = this.t('explorer.chunk_loading_more', { shown: renderedCount, total: list.length });
      targetContainer.appendChild(sentinel);

      const appendNextChunk = () => {
        if (renderGen !== this._renderGeneration) {
          this._disconnectChunkObserver();
          return;
        }
        const nextEnd = Math.min(list.length, renderedCount + batchSize);
        let html = '';
        for (let i = renderedCount; i < nextEnd; i++) {
          html += viewPlugin.renderItem(list[i], i, context);
        }
        sentinel.insertAdjacentHTML('beforebegin', html);
        renderedCount = nextEnd;

        if (renderedCount >= list.length) {
          sentinel.remove();
          this._disconnectChunkObserver();
        } else {
          sentinel.textContent = this.t('explorer.chunk_loading_more', { shown: renderedCount, total: list.length });
        }
      };

      if (typeof IntersectionObserver === 'function') {
        const scrollRoot = this.el.mainArea || null;
        this._chunkObserver = new IntersectionObserver((entries) => {
          if (entries.some(e => e.isIntersecting)) {
            appendNextChunk();
          }
        }, { root: scrollRoot, rootMargin: '280px 0px' });
        this._chunkObserver.observe(sentinel);
      } else {
        // Graceful fallback when IntersectionObserver is unavailable
        sentinel.onclick = appendNextChunk;
      }
    }

    updateViewModeButtonsUI() {
      if (!this.el || !this.el.viewModeBtns) return;
      this.el.viewModeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === this.state.viewMode);
      });
    }

    setViewMode(mode) {
      if (!mode) return;
      this.state.viewMode = mode;
      if (this.stateManager) {
        this.stateManager.setFolderViewMode(this.state.currentPath || '', mode);
        this.state.viewResolution = this.stateManager.resolveViewModeForPath(this.state.currentPath || '');
      }

      if (this.sidebarManager) {
        this.sidebarManager.applyProfileVisibility(mode);
      }

      this.updateViewModeButtonsUI();
      this.renderFolders(this.state.directories);
      this.renderMedia();

      if (this.navigationManager) {
        this.navigationManager.updateStatusBar();
      }
      if (this.manager) {
        this.manager.updateViewModeUI();
      }
    }

    resetCurrentFolderViewMode() {
      if (!this.stateManager) return;
      const resolved = this.stateManager.resetFolderViewMode(this.state.currentPath || '');
      this.state.viewMode = resolved.mode;
      this.state.viewResolution = resolved;
      if (this.sidebarManager) {
        this.sidebarManager.applyProfileVisibility(resolved.mode);
      }
      this.updateViewModeButtonsUI();
      this.renderFolders(this.state.directories);
      this.renderMedia();
      if (this.navigationManager) this.navigationManager.updateStatusBar();
      if (this.manager) this.manager.updateViewModeUI();
      this.showToast(this.t('explorer.view_inherit_reset_done'), 'info');
    }

    bindMediaCardEvents() {
      if (!this.el.mediaGrid) return;
      this.updateSelectionUI();

      if (this.el.mediaGrid._mediaEventsDelegated) return;
      this.el.mediaGrid._mediaEventsDelegated = true;

      const canMove = () => this.state.isAdmin || (this.state.userRights && this.state.userRights.can_move);

      // 1. Delegated Click Listener
      this.el.mediaGrid.addEventListener('click', (e) => {
        const sortBtn = e.target.closest('.list-sort-btn[data-sort-col]');
        if (sortBtn) {
          e.stopPropagation();
          const col = sortBtn.dataset.sortCol;
          const cur = (this.state.sortBy === 'mtime' || this.state.sortBy === 'exif_date') ? 'date' : (this.state.sortBy || 'name');
          const nextOrder = (cur === col && this.state.sortOrder === 'asc') ? 'desc' : 'asc';
          this.setSort(col, nextOrder);
          return;
        }

        const folderSettingsBtn = e.target.closest('.folder-settings-btn[data-path]');
        if (folderSettingsBtn) {
          e.stopPropagation();
          return this.openFolderSettingsModal(folderSettingsBtn.dataset.path);
        }

        const gpsBtn = e.target.closest('.gps-badge[data-path]');
        if (gpsBtn) {
          e.stopPropagation();
          return this.openMapModal(gpsBtn.dataset.path);
        }

        const delBtn = e.target.closest('.delete-item-btn');
        if (delBtn) {
          e.stopPropagation();
          return this.openDeleteConfirmModal(delBtn.dataset.path, delBtn.dataset.name, delBtn.dataset.type || 'file');
        }

        const favBtn = e.target.closest('.favorite-btn');
        if (favBtn) {
          e.stopPropagation();
          return this.toggleFavorite(favBtn.dataset.path);
        }

        const commBtn = e.target.closest('.edit-media-comment-btn');
        if (commBtn) {
          e.stopPropagation();
          return this.openMediaCommentModal(commBtn.dataset.filename, commBtn.dataset.comment);
        }

        // Unified List Folder Row click (honors Single vs Double click preference)
        const folderRow = e.target.closest('.list-table-row-folder[data-path]');
        if (folderRow && this.el.mediaGrid.contains(folderRow)) {
          if (e.target.closest('button, input, a, .list-col-check, .list-col-actions')) return;
          const folderPath = folderRow.dataset.path;
          const prefs = this.stateManager ? this.stateManager.getExplorerPrefs() : { openMode: 'double' };
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            if (this.state.selectedPaths.has(folderPath)) this.state.selectedPaths.delete(folderPath);
            else this.state.selectedPaths.add(folderPath);
            this.updateSelectionUI();
            return;
          }
          if (prefs.openMode === 'double') {
            this.state.selectedPaths.clear();
            this.state.selectedPaths.add(folderPath);
            this.updateSelectionUI();
            return;
          }
          const isProtected = folderRow.dataset.protected === '1';
          const isUnlocked = folderRow.dataset.unlocked === '1';
          if (isProtected && !isUnlocked && !this.state.isAdmin) {
            this.openFolderUnlockModal(folderPath);
          } else {
            this.navigateTo(folderPath);
          }
          return;
        }

        const card = e.target.closest('[data-index]');
        if (card && this.el.mediaGrid.contains(card)) {
          if (e.target.closest('button, input, a, .pip-card-btn, .list-col-check, .list-col-actions')) return;

          const index = parseInt(card.dataset.index, 10);
          const file = this.state.filteredFiles[index];
          if (!file) return;

          const prefs = this.stateManager ? this.stateManager.getExplorerPrefs() : { openMode: 'double' };

          if (e.ctrlKey || e.metaKey || e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            if (this.selectionManager) {
              this.selectionManager.selectItem(index, e);
            }
            return;
          }

          if (prefs.openMode === 'double') {
            if (this.selectionManager) {
              this.selectionManager.selectItem(index, null);
            } else {
              this.state.selectedPaths.clear();
              this.state.selectedPaths.add(file.path);
              this.state.lastSelectedIndex = index;
              this.updateSelectionUI();
            }
            return;
          }

          if (this.state.selectedPaths.size > 0) {
            if (!this.state.selectedPaths.has(file.path)) {
              this.clearSelection();
              this.openMedia(file, index);
            } else if (this.state.selectedPaths.size === 1) {
              this.openMedia(file, index);
            }
            return;
          }

          this.openMedia(file, index);
        }
      });

      // 1b. Delegated Checkbox Selection (Unified List View)
      this.el.mediaGrid.addEventListener('change', (e) => {
        const masterCb = e.target.closest('.list-select-all-cb');
        if (masterCb) {
          if (masterCb.checked) this.selectAll();
          else this.clearSelection();
          return;
        }
        const rowCb = e.target.closest('.list-row-cb[data-select-path]');
        if (rowCb) {
          const p = rowCb.dataset.selectPath;
          if (rowCb.checked) this.state.selectedPaths.add(p);
          else this.state.selectedPaths.delete(p);
          if (rowCb.dataset.selectIndex !== undefined) {
            this.state.lastSelectedIndex = parseInt(rowCb.dataset.selectIndex, 10);
          }
          this.updateSelectionUI();
        }
      });

      // 1c. Middle-click on unified folder row opens new tab
      this.el.mediaGrid.addEventListener('auxclick', (e) => {
        if (e.button !== 1) return;
        const folderRow = e.target.closest('.list-table-row-folder[data-path]');
        if (folderRow && this.navigationManager) {
          e.preventDefault();
          this.navigationManager.createTab(folderRow.dataset.path, { activate: true });
        }
      });

      // 2. Delegated Double Click Listener
      this.el.mediaGrid.addEventListener('dblclick', (e) => {
        const folderRow = e.target.closest('.list-table-row-folder[data-path]');
        if (folderRow && this.el.mediaGrid.contains(folderRow)) {
          if (e.target.closest('button, input, a, .list-col-check, .list-col-actions')) return;
          e.preventDefault();
          const folderPath = folderRow.dataset.path;
          const isProtected = folderRow.dataset.protected === '1';
          const isUnlocked = folderRow.dataset.unlocked === '1';
          if (isProtected && !isUnlocked && !this.state.isAdmin) {
            this.openFolderUnlockModal(folderPath);
          } else {
            this.navigateTo(folderPath);
          }
          return;
        }
        const card = e.target.closest('[data-index]');
        if (card && this.el.mediaGrid.contains(card)) {
          if (e.target.closest('button, input, a, .pip-card-btn, .list-col-check, .list-col-actions')) return;
          const index = parseInt(card.dataset.index, 10);
          const file = this.state.filteredFiles[index];
          if (file) {
            e.preventDefault();
            this.openMedia(file, index);
          }
        }
      });

      // 3. Delegated Drag Start Listener (scoped to this instance)
      this.el.mediaGrid.addEventListener('dragstart', (e) => {
        const folderRow = e.target.closest('.list-table-row-folder[data-path]');
        if (folderRow && canMove()) {
          const folderPath = folderRow.dataset.path;
          const folderObj = (this.state.directories || []).find(d => d.path === folderPath) || { path: folderPath, name: folderPath.split('/').pop() };
          const pathsToMove = this.state.selectedPaths.has(folderPath) ? Array.from(this.state.selectedPaths) : [folderPath];
          this.state.draggingPaths = pathsToMove;
          this.state.draggingItemPath = folderPath;
          window.ATELIER_DRAGGING_PATHS = pathsToMove;
          window.ATELIER_DRAG_SOURCE_INSTANCE = this.id;
          const folderData = { type: 'folder', path: folderPath, name: folderObj.name, icon: '📁', cover_url: folderObj.cover || '' };
          window.ATELIER_DRAGGING_ITEM_DATA = folderData;
          e.dataTransfer.setData('text/plain', JSON.stringify(pathsToMove));
          e.dataTransfer.setData('application/json', JSON.stringify(pathsToMove));
          e.dataTransfer.setData('application/atelier-item', JSON.stringify(folderData));
          e.dataTransfer.effectAllowed = 'copyMove';
          folderRow.classList.add('is-dragging');
          return;
        }

        const card = e.target.closest('[data-index]');
        if (!card || !canMove()) return;

        const index = parseInt(card.dataset.index, 10);
        const file = this.state.filteredFiles[index];
        if (!file) return;

        let pathsToMove = [];
        if (this.state.selectedPaths.has(file.path)) {
          pathsToMove = Array.from(this.state.selectedPaths);
        } else {
          pathsToMove = [file.path];
          this.state.selectedPaths.clear();
          this.state.selectedPaths.add(file.path);
          this.updateSelectionUI();
        }

        this.state.draggingPaths = pathsToMove;
        this.state.draggingItemPath = file.path;
        window.ATELIER_DRAGGING_PATHS = pathsToMove;
        window.ATELIER_DRAG_SOURCE_INSTANCE = this.id;

        const fileIcon = window.IconHelper ? window.IconHelper.getFileIcon(file) : '📄';
        const fileUrl = file.file_url || (`system/endpoints/thumb.php?file=${encodeURIComponent(file.path)}&raw=1`);
        const thumbUrl = file.thumb_url || (`system/endpoints/thumb.php?file=${encodeURIComponent(file.path)}`);
        const fileData = {
          type: 'file',
          path: file.path,
          name: file.name,
          category: file.category || '',
          extension: file.extension || (file.name.split('.').pop() || '').toLowerCase(),
          thumb_url: thumbUrl,
          file_url: fileUrl,
          size_formatted: file.size_formatted || '',
          icon: fileIcon
        };
        window.ATELIER_DRAGGING_ITEM_DATA = fileData;

        e.dataTransfer.setData('text/plain', JSON.stringify(pathsToMove));
        e.dataTransfer.setData('application/json', JSON.stringify(pathsToMove));
        e.dataTransfer.setData('application/atelier-item', JSON.stringify(fileData));
        e.dataTransfer.effectAllowed = 'copyMove';

        card.classList.add('is-dragging');
        this.el.mediaGrid.querySelectorAll('.selected').forEach(c => c.classList.add('is-dragging'));
      });

      // 4. Delegated Drag End Listener
      this.el.mediaGrid.addEventListener('dragend', () => {
        this.state.draggingPaths = null;
        this.state.draggingItemPath = null;
        setTimeout(() => {
          window.ATELIER_DRAGGING_PATHS = null;
          window.ATELIER_DRAG_SOURCE_INSTANCE = null;
          window.ATELIER_DRAGGING_ITEM_DATA = null;
        }, 300);
        if (this.dragDropManager) this.dragDropManager.clearVisualDragClasses();
      });

      // 5. Delegated Context Menu ("Ouvrir avec...") on Media Cards
      this.el.mediaGrid.addEventListener('contextmenu', (e) => {
        const card = e.target.closest('[data-index]');
        if (!card || !this.el.mediaGrid.contains(card)) return;
        const index = parseInt(card.dataset.index, 10);
        const file = this.state.filteredFiles[index];
        if (!file) return;
        e.preventDefault();
        e.stopPropagation();
        this.showFileContextMenu(file, index, e.clientX, e.clientY);
      });
    }

    // -------------------------------------------------------------
    // DELEGATED PUBLIC FACADE METHODS (100% Iso-Functional)
    // -------------------------------------------------------------
    showFileContextMenu(file, index, clientX, clientY) {
      if (this.contextMenuManager) {
        this.contextMenuManager.showFileContextMenu(file, index, clientX, clientY);
      }
    }

    async moveItems(sourcePaths, targetDir) {
      if (this.operationsManager) {
        return this.operationsManager.moveItems(sourcePaths, targetDir);
      }
    }

    openMedia(file, index) {
      if (!file) return;
      if (window.MediaViewerRegistry) {
        window.MediaViewerRegistry.open(file, { index }, this);
      }
    }

    setSort(sortBy, sortOrder = null) {
      const nextBy = sortBy || 'name';
      const curNorm = (this.state.sortBy === 'mtime' || this.state.sortBy === 'exif_date') ? 'date' : (this.state.sortBy || 'name');
      const nextOrder = sortOrder || ((curNorm === nextBy && this.state.sortOrder === 'asc') ? 'desc' : 'asc');
      this.state.sortBy = nextBy;
      this.state.sortOrder = nextOrder;
      this.saveFolderSort(this.state.currentPath, this.state.sortBy, this.state.sortOrder);
      if (this.manager) this.manager.updateMenuBarForActiveInstance();
      this.renderFolders(this.state.directories);
      this.applyFilterAndRender();
    }

    toggleSortOrder() {
      this.state.sortOrder = (this.state.sortOrder === 'asc') ? 'desc' : 'asc';
      this.saveFolderSort(this.state.currentPath, this.state.sortBy, this.state.sortOrder);
      if (this.manager) this.manager.updateMenuBarForActiveInstance();
      this.renderFolders(this.state.directories);
      this.applyFilterAndRender();
    }

    saveFolderSort(dirPath, sortBy, sortOrder) {
      if (this.stateManager) this.stateManager.saveFolderSort(dirPath, sortBy, sortOrder);
    }

    getFolderSort(dirPath) {
      return this.stateManager ? this.stateManager.getFolderSort(dirPath) : null;
    }

    toggleFavorite(filePath) {
      if (this.stateManager) this.stateManager.toggleFavorite(filePath);
    }

    toggleFavoritesFilter() {
      this.state.showFavoritesOnly = !this.state.showFavoritesOnly;
      this.manager.updateMenuBarForActiveInstance();
      this.applyFilterAndRender();
    }

    setFilterCategory(category) {
      this.state.filterCategory = category || 'all';
      this.updateFilterPillsUI();
      this.applyFilterAndRender();
    }

    updateFilterPillsUI() {
      if (!this.el.filterPills) return;
      this.el.filterPills.querySelectorAll('.pill-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === this.state.filterCategory);
      });
    }

    updateStats() {
      if (this.el.galleryStats) {
        this.el.galleryStats.textContent = this.t('stats.summary', {
          folders: this.state.directories.length,
          files: this.state.filteredFiles.length
        });
      }
      this.updateFolderMapButton();
      if (this.navigationManager) this.navigationManager.updateStatusBar();
    }

    clearSelection() {
      if (this.selectionManager) this.selectionManager.clearSelection();
    }

    selectAll() {
      if (this.selectionManager) this.selectionManager.selectAll();
    }

    updateSelectionUI() {
      if (this.selectionManager) this.selectionManager.updateSelectionUI();
      if (this.navigationManager) this.navigationManager.updateStatusBar();
    }

    initMarqueeSelection() {
      if (this.selectionManager) this.selectionManager.initMarqueeSelection();
    }

    computeSmartGpsLocations(files) {
      return this.mapManager ? this.mapManager.computeSmartGpsLocations(files, this.isSmartGpsEnabled) : [];
    }

    updateFolderMapButton() {
      if (this.mapManager) this.mapManager.updateFolderMapButton();
    }

    openMapModal(focusPath = null) {
      if (this.mapManager) this.mapManager.openMapModal(focusPath);
    }

    closeMapModal() {
      if (this.mapManager) this.mapManager.closeMapModal();
    }

    initLeafletMap(focusPath = null) {
      if (this.mapManager) this.mapManager.initLeafletMap(focusPath);
    }

    openSearchModal() {
      if (this.searchManager) this.searchManager.openSearchModal();
    }

    closeSearchModal() {
      if (this.searchManager) this.searchManager.closeSearchModal();
    }

    positionSearchModal() {
      if (this.searchManager) this.searchManager.positionSearchModal();
    }

    exitSearch() {
      if (this.searchManager) this.searchManager.exitSearch();
    }

    openCreateFolderModal() {
      if (this.modalsManager) this.modalsManager.openCreateFolderModal();
    }

    closeCreateFolderModal() {
      if (this.modalsManager) this.modalsManager.closeCreateFolderModal();
    }

    async createFolder() {
      if (this.modalsManager) return this.modalsManager.createFolder();
    }

    openDeleteConfirmModal(path, name, type = 'file') {
      if (this.modalsManager) this.modalsManager.openDeleteConfirmModal(path, name, type);
    }

    closeDeleteConfirmModal() {
      if (this.modalsManager) this.modalsManager.closeDeleteConfirmModal();
    }

    async confirmDeleteItem() {
      if (this.modalsManager) return this.modalsManager.confirmDeleteItem();
    }

    deleteSelection() {
      if (this.modalsManager) this.modalsManager.deleteSelection();
    }

    openMediaCommentModal(filename, comment = '') {
      if (this.modalsManager) this.modalsManager.openMediaCommentModal(filename, comment);
    }

    closeMediaCommentModal() {
      if (this.modalsManager) this.modalsManager.closeMediaCommentModal();
    }

    async saveMediaComment() {
      if (this.modalsManager) return this.modalsManager.saveMediaComment();
    }

    openFolderUnlockModal(dirPath) {
      if (this.modalsManager) this.modalsManager.openFolderUnlockModal(dirPath);
    }

    closeFolderUnlockModal() {
      if (this.modalsManager) this.modalsManager.closeFolderUnlockModal();
    }

    async unlockFolder() {
      if (this.modalsManager) return this.modalsManager.unlockFolder();
    }

    async openFolderSettingsModal(targetDir = null) {
      if (this.modalsManager) return this.modalsManager.openFolderSettingsModal(targetDir);
    }

    closeFolderSettingsModal() {
      if (this.modalsManager) this.modalsManager.closeFolderSettingsModal();
    }

    async saveFolderSettings() {
      if (this.modalsManager) return this.modalsManager.saveFolderSettings();
    }

    async handleUploadFiles(files, targetDir = null) {
      if (this.operationsManager) return this.operationsManager.handleUploadFiles(files, targetDir);
    }

    async renameItem(itemPath, currentName = '') {
      if (this.operationsManager) return this.operationsManager.renameItem(itemPath, currentName);
    }

    async renameSelection() {
      if (this.operationsManager) return this.operationsManager.renameSelection();
    }

    async createNewFile(targetDir = null) {
      if (this.operationsManager) return this.operationsManager.createNewFile(targetDir);
    }

    async duplicateItem(itemPath) {
      if (this.operationsManager) return this.operationsManager.duplicateItem(itemPath);
    }

    async copyPathToClipboard(path) {
      if (this.operationsManager) return this.operationsManager.copyPathToClipboard(path);
    }

    copySelection() {
      if (this.operationsManager) this.operationsManager.copySelection();
    }

    cutSelection() {
      if (this.operationsManager) this.operationsManager.cutSelection();
    }

    async pasteClipboard() {
      if (this.operationsManager) return this.operationsManager.pasteClipboard();
    }

    toggleInspector(forceState) {
      if (this.inspectorManager) this.inspectorManager.toggleInspector(forceState);
    }

    openInspectorTab(tabId) {
      if (this.inspectorManager && typeof this.inspectorManager.openTab === 'function') {
        this.inspectorManager.openTab(tabId);
      }
    }

    openShareDialogForPath(targetPath, options = {}) {
      if (window.sys && window.sys.shares && typeof window.sys.shares.openShareDialog === 'function') {
        window.sys.shares.openShareDialog(targetPath, options);
      }
    }

    searchByTag(tagLabel) {
      if (this.searchManager && typeof this.searchManager.searchByTag === 'function') {
        this.searchManager.searchByTag(tagLabel);
      }
    }

    openQuickLook(fileOrIndex) {
      if (this.quickLookManager && typeof this.quickLookManager.toggle === 'function') {
        if (fileOrIndex !== undefined) {
          this.quickLookManager.open(fileOrIndex);
        } else {
          this.quickLookManager.toggle();
        }
        return;
      }
      const first = Array.from(this.state.selectedPaths || [])[0];
      const file = (this.state.files || []).find(f => f.path === first);
      if (file && window.sys && window.sys.openFile) window.sys.openFile(file);
    }

    updateInspectorUI() {
      if (this.inspectorManager) this.inspectorManager.updateInspectorUI();
    }

    renderProtectedState(dirPath) {
      if (!this.el.emptyState) return;
      if (this.el.mediaGrid) this.el.mediaGrid.style.display = 'none';
      this.el.emptyState.style.display = 'block';
      this.el.emptyState.innerHTML = `
        <div class="empty-state-icon">🔒</div>
        <h3>${this.escapeHtml(this.t('stats.folder_locked'))}</h3>
        <p>${this.escapeHtml(this.t('stats.folder_locked_desc'))}</p>
        <button class="pill-btn active" style="margin-top: 1rem;">
          ${this.escapeHtml(this.t('stats.folder_unlock_action'))}
        </button>
      `;
      const btn = this.el.emptyState.querySelector('button');
      if (btn) btn.onclick = () => this.openFolderUnlockModal(dirPath);
    }

    renderPrivateState(msg) {
      if (!this.el.emptyState) return;
      if (this.el.mediaGrid) this.el.mediaGrid.style.display = 'none';
      this.el.emptyState.style.display = 'block';
      this.el.emptyState.innerHTML = `
        <div class="empty-state-icon">👁️‍🗨️</div>
        <h3>${this.escapeHtml(this.t('stats.folder_private'))}</h3>
        <p>${this.escapeHtml(msg || this.t('stats.folder_private_desc'))}</p>
      `;
    }

    // -------------------------------------------------------------
    // INLINE TRASH BIN VIEW (30-Day Soft Delete, Restore & Purge)
    // -------------------------------------------------------------
    async openTrashView() {
      const host = this.el.trashView;
      if (!host) return;

      this.state.isTrashView = true;
      this.clearSelection();
      if (this.el.folderSection) this.el.folderSection.style.display = 'none';
      if (this.el.mediaSection) this.el.mediaSection.style.display = 'none';
      if (this.el.emptyState) this.el.emptyState.style.display = 'none';
      if (this.el.searchResultsBanner) this.el.searchResultsBanner.style.display = 'none';
      host.style.display = 'block';

      if (this.sidebarManager) this.sidebarManager.renderAll();

      this.showLoading(true);
      try {
        const res = await window.sys.api.get('list_trash');
        const items = (res && res.success && Array.isArray(res.items)) ? res.items : [];
        if (this.sidebarManager) {
          this.sidebarManager.trashCount = items.length;
          this.sidebarManager.renderOrganization();
        }
        this._renderTrashView(items);
      } catch (err) {
        this.showToast('⚠️ ' + this.t('explorer.err_network', { message: err.message }), 'error');
        this._renderTrashView([]);
      } finally {
        this.showLoading(false);
      }
    }

    exitTrashView() {
      this.state.isTrashView = false;
      if (this.el.trashView) this.el.trashView.style.display = 'none';
      if (this.el.mediaSection) this.el.mediaSection.style.display = '';
      this.loadDirectory(this.state.currentPath || '');
    }

    _renderTrashView(items) {
      const host = this.el.trashView;
      if (!host) return;
      const fmtSize = (b) => this.stateManager ? this.stateManager.formatBytes(b) : `${b || 0} B`;

      const emptyBtnHtml = items.length > 0
        ? `<button type="button" class="trash-btn trash-btn-danger trash-empty-all-btn">🗑️ ${this.escapeHtml(this.t('explorer.trash_empty_all'))}</button>`
        : '';

      const rowsHtml = items.length === 0
        ? `<div class="trash-empty-state"><div class="empty-state-icon">🗑️</div><p>${this.escapeHtml(this.t('explorer.sidebar_trash_empty'))}</p></div>`
        : `<div class="trash-list">${items.map(item => {
            const id = String(item.id || '');
            const icon = item.is_dir ? '📁' : '📄';
            const name = item.name || id;
            const orig = item.original_path || '/';
            const dateStr = item.deleted_at ? new Date(Number(item.deleted_at) * 1000).toLocaleString() : '—';
            const sizeStr = fmtSize(item.size_bytes || 0);
            return `
              <div class="trash-row" data-trash-id="${this.escapeHtml(id)}">
                <span class="trash-row-icon">${icon}</span>
                <div class="trash-row-main">
                  <div class="trash-row-name">${this.escapeHtml(name)}</div>
                  <div class="trash-row-meta">
                    <span title="${this.escapeHtml(this.t('explorer.trash_original_path'))}">📍 ${this.escapeHtml(orig)}</span>
                    <span>·</span>
                    <span>${this.escapeHtml(sizeStr)}</span>
                    <span>·</span>
                    <span title="${this.escapeHtml(this.t('explorer.trash_deleted_at'))}">🕒 ${this.escapeHtml(dateStr)}</span>
                  </div>
                </div>
                <div class="trash-row-actions">
                  <button type="button" class="trash-btn trash-btn-restore" data-restore-id="${this.escapeHtml(id)}">↩️ ${this.escapeHtml(this.t('explorer.trash_restore'))}</button>
                  <button type="button" class="trash-btn trash-btn-danger" data-purge-id="${this.escapeHtml(id)}" data-purge-name="${this.escapeHtml(name)}">✕ ${this.escapeHtml(this.t('explorer.trash_purge'))}</button>
                </div>
              </div>`;
          }).join('')}</div>`;

      host.innerHTML = `
        <div class="trash-header">
          <div>
            <h2 class="trash-title">🗑️ ${this.escapeHtml(this.t('explorer.trash_title'))} (${items.length})</h2>
            <p class="trash-desc">${this.escapeHtml(this.t('explorer.trash_desc'))}</p>
          </div>
          <div class="trash-header-actions">
            ${emptyBtnHtml}
            <button type="button" class="trash-btn trash-exit-btn">← ${this.escapeHtml(this.t('explorer.trash_exit'))}</button>
          </div>
        </div>
        ${rowsHtml}
      `;

      const exitBtn = host.querySelector('.trash-exit-btn');
      if (exitBtn) exitBtn.onclick = () => this.exitTrashView();

      const emptyBtn = host.querySelector('.trash-empty-all-btn');
      if (emptyBtn) {
        emptyBtn.onclick = async () => {
          const msg = this.t('explorer.trash_confirm_empty', { count: items.length });
          const ok = (window.sys && window.sys.dialog && typeof window.sys.dialog.confirm === 'function')
            ? await window.sys.dialog.confirm(msg, this.t('explorer.trash_title'), true)
            : true;
          if (!ok) return;
          const res = await window.sys.api.post('empty_trash', {});
          if (res && res.success) {
            this.showToast(this.t('explorer.trash_emptied_ok'), 'success');
            await this.openTrashView();
          } else {
            this.showToast('⚠️ ' + ((res && res.error) || this.t('explorer.err_delete_failed')), 'error');
          }
        };
      }

      host.querySelectorAll('[data-restore-id]').forEach(btn => {
        btn.onclick = async () => {
          const trashId = btn.dataset.restoreId;
          const res = await window.sys.api.post('restore_trash_item', { trash_id: trashId });
          if (res && res.success) {
            this.showToast(this.t('explorer.trash_restored_ok'), 'success');
            if (window.EventBus) window.EventBus.emit('fs:changed', { action: 'restore_trash' });
            await this.openTrashView();
          } else {
            this.showToast('⚠️ ' + ((res && res.error) || this.t('explorer.err_unknown')), 'error');
          }
        };
      });

      host.querySelectorAll('[data-purge-id]').forEach(btn => {
        btn.onclick = async () => {
          const trashId = btn.dataset.purgeId;
          const name = btn.dataset.purgeName || trashId;
          const msg = this.t('explorer.trash_confirm_purge', { name });
          const ok = (window.sys && window.sys.dialog && typeof window.sys.dialog.confirm === 'function')
            ? await window.sys.dialog.confirm(msg, this.t('explorer.trash_title'), true)
            : true;
          if (!ok) return;
          const res = await window.sys.api.post('purge_trash_item', { trash_id: trashId });
          if (res && res.success) {
            this.showToast(this.t('explorer.trash_purged_ok'), 'info');
            await this.openTrashView();
          } else {
            this.showToast('⚠️ ' + ((res && res.error) || this.t('explorer.err_delete_failed')), 'error');
          }
        };
      });
    }

    onLocaleChanged() {
      if (this.containerEl) {
        this.containerEl.querySelectorAll('[data-i18n]').forEach(el => {
          const key = el.dataset.i18n;
          const trans = this.t(key);
          if (trans && trans !== key) {
            if (trans.includes('<') && trans.includes('>')) {
              el.innerHTML = trans;
            } else {
              el.textContent = trans;
            }
          }
        });

        this.containerEl.querySelectorAll('[data-i18n-title]').forEach(el => {
          const key = el.dataset.i18nTitle;
          const trans = this.t(key);
          if (trans && trans !== key) el.setAttribute('title', trans);
        });

        this.containerEl.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
          const key = el.dataset.i18nPlaceholder;
          const trans = this.t(key);
          if (trans && trans !== key) el.setAttribute('placeholder', trans);
        });
      }

      this.updateSelectionUI();

      if (this.state && Array.isArray(this.state.currentBreadcrumbs)) {
        this.renderBreadcrumbs(this.state.currentBreadcrumbs);
      }

      this.applyFilterAndRender();
      if (typeof this.updateSortUI === 'function') {
        this.updateSortUI();
      }
    }

    // -------------------------------------------------------------
    // 2D KEYBOARD GRID NAVIGATION HELPER (Lot 6)
    // -------------------------------------------------------------
    _computeGridColumnCount() {
      if (this.state.viewMode === 'list') return 1;
      if (!this.el || !this.el.mediaGrid) return 1;
      const cards = this.el.mediaGrid.querySelectorAll('[data-index]');
      if (cards.length >= 2 && typeof cards[0].getBoundingClientRect === 'function') {
        const firstTop = Math.round(cards[0].getBoundingClientRect().top);
        let cols = 0;
        for (let i = 0; i < cards.length; i++) {
          if (Math.abs(Math.round(cards[i].getBoundingClientRect().top) - firstTop) <= 6) {
            cols++;
          } else {
            break;
          }
        }
        if (cols >= 1) return cols;
      }
      return 1;
    }

    navigateSelectionByArrow(key, extendRange = false) {
      const files = this.state.filteredFiles || [];
      if (files.length === 0) return;

      const cols = this._computeGridColumnCount();
      const currentIndex = (this.state.lastSelectedIndex !== null && this.state.lastSelectedIndex !== undefined)
        ? this.state.lastSelectedIndex
        : -1;

      let nextIndex = currentIndex;
      if (key === 'Home') {
        nextIndex = 0;
      } else if (key === 'End') {
        nextIndex = files.length - 1;
      } else if (key === 'ArrowRight') {
        nextIndex = currentIndex < 0 ? 0 : Math.min(files.length - 1, currentIndex + 1);
      } else if (key === 'ArrowLeft') {
        nextIndex = currentIndex <= 0 ? 0 : Math.max(0, currentIndex - 1);
      } else if (key === 'ArrowDown') {
        nextIndex = currentIndex < 0 ? 0 : Math.min(files.length - 1, currentIndex + cols);
      } else if (key === 'ArrowUp') {
        nextIndex = currentIndex < 0 ? 0 : Math.max(0, currentIndex - cols);
      }

      if (nextIndex < 0 || nextIndex >= files.length) return;

      const targetFile = files[nextIndex];
      if (!targetFile) return;

      if (extendRange) {
        const anchor = currentIndex >= 0 ? currentIndex : 0;
        const start = Math.min(anchor, nextIndex);
        const end = Math.max(anchor, nextIndex);
        for (let i = start; i <= end; i++) {
          if (files[i]) this.state.selectedPaths.add(files[i].path);
        }
      } else {
        this.state.selectedPaths.clear();
        this.state.selectedPaths.add(targetFile.path);
      }
      this.state.lastSelectedIndex = nextIndex;
      this.updateSelectionUI();

      const card = this.el.mediaGrid && this.el.mediaGrid.querySelector(`[data-index="${nextIndex}"]`);
      if (card && typeof card.scrollIntoView === 'function') {
        card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      }
    }

    // -------------------------------------------------------------
    // INSTANCE EVENTS (KEYBOARD, TOOLBARS, INSPECTOR, SEARCH)
    // -------------------------------------------------------------
    bindEvents() {
      this.containerEl.setAttribute('tabindex', '-1');
      this.containerEl.addEventListener('mousedown', (e) => {
        const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '';
        if (!['input', 'textarea', 'select', 'button', 'a'].includes(tag) && !e.target.isContentEditable) {
          try { this.containerEl.focus({ preventScroll: true }); } catch (err) { }
        }
      });

      this.containerEl.addEventListener('keydown', (e) => {
        const tag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) {
          return;
        }

        if (e.ctrlKey || e.metaKey) {
          const key = e.key.toLowerCase();
          if (key === 'c') {
            e.preventDefault();
            this.copySelection();
          } else if (key === 'x') {
            e.preventDefault();
            this.cutSelection();
          } else if (key === 'v') {
            e.preventDefault();
            this.pasteClipboard();
          } else if (key === 'a') {
            e.preventDefault();
            this.selectAll();
          } else if (key === 't' && this.navigationManager) {
            e.preventDefault();
            this.navigationManager.createTab();
          } else if (key === 'w' && this.navigationManager && this.navigationManager.tabs.length > 1) {
            e.preventDefault();
            this.navigationManager.closeTab();
          } else if (key === 'l' && this.navigationManager) {
            e.preventDefault();
            this.navigationManager.enterAddressEditMode();
          } else if (key === 'f') {
            e.preventDefault();
            if (e.shiftKey && this.searchManager) {
              this.searchManager.openSearchModal();
            } else if (this.el.quickSearchInput) {
              this.el.quickSearchInput.focus();
              this.el.quickSearchInput.select();
            } else if (this.searchManager) {
              this.searchManager.openSearchModal();
            }
          } else if (key === 'n' && e.shiftKey) {
            e.preventDefault();
            this.openCreateFolderModal();
          }
        } else if (e.altKey) {
          if (e.key === 'ArrowLeft' && this.navigationManager) {
            e.preventDefault();
            this.navigationManager.goBack();
          } else if (e.key === 'ArrowRight' && this.navigationManager) {
            e.preventDefault();
            this.navigationManager.goForward();
          } else if (e.key === 'ArrowUp' && this.navigationManager) {
            e.preventDefault();
            this.navigationManager.goUp();
          }
        } else if (e.key === 'F2') {
          if (this.state.selectedPaths && this.state.selectedPaths.size === 1) {
            e.preventDefault();
            this.renameSelection();
          }
        } else if (e.key === 'F3' && this.splitPaneManager) {
          e.preventDefault();
          this.splitPaneManager.toggle();
        } else if (e.key === 'F5' && this.navigationManager) {
          e.preventDefault();
          this.navigationManager.refresh();
        } else if (e.key === 'Delete') {
          if (this.state.selectedPaths && this.state.selectedPaths.size > 0 && (this.state.isAdmin || (this.state.userRights && this.state.userRights.can_delete))) {
            e.preventDefault();
            this.deleteSelection();
          }
        } else if (e.key === 'Backspace') {
          if (this.state.selectedPaths && this.state.selectedPaths.size > 0 && (this.state.isAdmin || (this.state.userRights && this.state.userRights.can_delete))) {
            e.preventDefault();
            this.deleteSelection();
          } else if (this.navigationManager) {
            e.preventDefault();
            this.navigationManager.goUp();
          }
        } else if (e.key === 'Escape') {
          if (this.state.selectedPaths && this.state.selectedPaths.size > 0) {
            e.preventDefault();
            this.clearSelection();
          }
        } else if (e.key === ' ' || e.key === 'Spacebar') {
          if (this.quickLookManager && this.quickLookManager.isOpen) {
            e.preventDefault();
            this.quickLookManager.close();
          } else if (this.state.selectedPaths && this.state.selectedPaths.size > 0) {
            e.preventDefault();
            this.openQuickLook();
          }
        } else if (e.key === 'Enter') {
          if (this.state.selectedPaths && this.state.selectedPaths.size > 0) {
            e.preventDefault();
            const first = Array.from(this.state.selectedPaths)[0];
            const folders = this.state.directories || this.state.folders || [];
            const folder = folders.find(f => f.path === first);
            if (folder) {
              this.loadDirectory(folder.path);
            } else {
              const file = (this.state.files || []).find(f => f.path === first);
              if (file && window.sys && window.sys.openFile) {
                window.sys.openFile(file);
              }
            }
          }
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
          if (this.state.filteredFiles && this.state.filteredFiles.length > 0) {
            e.preventDefault();
            this.navigateSelectionByArrow(e.key, Boolean(e.shiftKey));
          }
        } else if (e.key === 'i' || e.key === 'I') {
          if (!e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            this.toggleInspector();
          }
        }
      });

      if (this.el.filterPills) {
        this.el.filterPills.onclick = (e) => {
          const pill = e.target.closest('.pill-btn');
          if (pill && pill.dataset.category) {
            this.setFilterCategory(pill.dataset.category);
          }
        };
      }

      if (this.el.folderMapBtn) this.el.folderMapBtn.onclick = () => this.openMapModal();
      if (this.el.folderSettingsBtn) this.el.folderSettingsBtn.onclick = () => this.openFolderSettingsModal();
      if (this.el.mapModalCloseBtn) this.el.mapModalCloseBtn.onclick = () => this.closeMapModal();
      if (this.el.selectionCopyBtn) this.el.selectionCopyBtn.onclick = () => this.copySelection();
      if (this.el.selectionCutBtn) this.el.selectionCutBtn.onclick = () => this.cutSelection();
      if (this.el.selectionDeleteBtn) this.el.selectionDeleteBtn.onclick = () => this.deleteSelection();
      if (this.el.selectionSelectAllBtn) this.el.selectionSelectAllBtn.onclick = () => this.selectAll();
      if (this.el.selectionClearBtn) this.el.selectionClearBtn.onclick = () => this.clearSelection();

      if (this.searchManager) {
        this.searchManager.bindEvents();
      }

      if (this.el.viewModeBtns) {
        this.el.viewModeBtns.forEach(btn => {
          btn.onclick = () => {
            const mode = btn.dataset.view;
            if (mode) this.setViewMode(mode);
          };
        });
      }

      if (this.el.inspectorToggleBtn) {
        this.el.inspectorToggleBtn.onclick = () => this.toggleInspector();
      }
      if (this.el.inspectorCloseBtn) {
        this.el.inspectorCloseBtn.onclick = () => this.toggleInspector(false);
      }
      if (this.el.inspectorOpenBtn) {
        this.el.inspectorOpenBtn.onclick = () => {
          const first = Array.from(this.state.selectedPaths)[0];
          const file = (this.state.files || []).find(f => f.path === first);
          if (file && window.sys && window.sys.openFile) window.sys.openFile(file);
        };
      }
      if (this.el.inspectorQuicklookBtn) {
        this.el.inspectorQuicklookBtn.onclick = () => {
          this.openQuickLook();
        };
      }
    }

    // -------------------------------------------------------------
    // MULTIMODAL BLOG & AUTORUN PRESENTATION LAUNCHER & DELEGATES
    // -------------------------------------------------------------
    launchAutorun(autorunConfig) {
      const config = autorunConfig || (this.state.overrides && this.state.overrides.autorun);
      if (!config) return;
      let cleanConfig = config;
      try {
        cleanConfig = JSON.parse(JSON.stringify(config));
      } catch (e) {
        cleanConfig = config;
      }
      if (window.sys && window.sys.autorun && typeof window.sys.autorun.launch === 'function') {
        window.sys.autorun.launch(cleanConfig, this.state.currentPath, this);
      } else {
        this.showToast(this.t('explorer.err_autorun_unavailable'), 'error');
      }
    }

    openAutorunEditorModal(existingConfig = null) {
      if (window.AutorunStudio && typeof window.AutorunStudio.openFolder === 'function') {
        window.AutorunStudio.openFolder(this.state.currentPath, { config: existingConfig });
        return;
      }
      if (window.sys && window.sys.appManager && typeof window.sys.appManager.open === 'function') {
        window.sys.appManager.open('autorun-editor', { path: this.state.currentPath, config: existingConfig });
      }
    }

    closeAutorunEditorModal() {
      if (this.el && this.el.autorunEditorModal) this.el.autorunEditorModal.style.display = 'none';
      if (window.AutorunStudio && typeof window.AutorunStudio.close === 'function') {
        window.AutorunStudio.close();
      }
    }

    switchAutorunTab(tabId) {
      if (window.AutorunStudio && typeof window.AutorunStudio.switchTab === 'function') {
        window.AutorunStudio.switchTab(tabId);
      }
    }

    onAutorunMasterTypeChange() {
      // Delegated to standalone AutorunStudio
    }

    syncVisualToConfig() {
      if (window.AutorunStudio && typeof window.AutorunStudio.syncVisualToConfig === 'function') {
        window.AutorunStudio.syncVisualToConfig();
      }
    }

    renderAutorunVisualTimeline() {
      if (window.AutorunStudio && typeof window.AutorunStudio.renderTimeline === 'function') {
        window.AutorunStudio.renderTimeline();
      }
    }

    addAutorunStep() {
      if (window.AutorunStudio && typeof window.AutorunStudio.addStep === 'function') {
        window.AutorunStudio.addStep();
      }
    }

    removeAutorunStep(index) {
      if (window.AutorunStudio && typeof window.AutorunStudio.removeStep === 'function') {
        window.AutorunStudio.removeStep(index);
      }
    }

    moveAutorunStep(index, direction) {
      if (window.AutorunStudio && typeof window.AutorunStudio.moveStep === 'function') {
        window.AutorunStudio.moveStep(index, direction);
      }
    }

    previewCurrentAutorun() {
      if (window.AutorunStudio && typeof window.AutorunStudio.preview === 'function') {
        window.AutorunStudio.preview();
      }
    }

    async saveAutorunConfig() {
      if (window.AutorunStudio && typeof window.AutorunStudio.save === 'function') {
        return window.AutorunStudio.save();
      }
    }

    async deleteAutorunConfig() {
      if (window.AutorunStudio && typeof window.AutorunStudio.delete === 'function') {
        return window.AutorunStudio.delete();
      }
    }
  }

  // -------------------------------------------------------------
  // EXPLORER MULTI-INSTANCE MANAGER (window.explorerApp)
  // -------------------------------------------------------------
  const WebOSApp = (window.sys && window.sys.App) || window.WebOSApp || Object;

  class ExplorerApp extends WebOSApp {
    constructor() {
      super({
        id: 'explorer',
        title: 'apps.explorer.title',
        icon: '📁'
      });
      this.instances = new Map();
      this.instanceCounter = 0;
      this.activeInstance = null;
      this.activeModalInstance = null;

      window.explorerApp = this;

      if (window.WindowManager) window.WindowManager.init();
      if (window.MenuBarManager) window.MenuBarManager.init('appHeaderZone');

      this.bindMenuBar();
      this.bindGlobalModals();

      if (window.EventBus && typeof window.EventBus.on === 'function') {
        window.EventBus.on('explorer:prefs_changed', (prefs) => {
          this.instances.forEach(inst => {
            if (prefs && prefs.enableNavCache === false && typeof inst.invalidateDirCache === 'function') {
              inst.invalidateDirCache();
            }
            if (inst.stateManager) {
              const resolved = inst.stateManager.resolveViewModeForPath(inst.state.currentPath || '');
              inst.state.viewMode = resolved.mode;
              inst.state.viewResolution = resolved;
              inst.updateViewModeButtonsUI();
              if (inst.sidebarManager) {
                inst.sidebarManager.applyProfileVisibility(inst.state.viewMode);
                inst.sidebarManager.renderQuickAccess();
              }
            }
            if (prefs && prefs.defaultThumbZoom && inst.navigationManager && typeof inst.navigationManager.applyThumbZoom === 'function') {
              inst.navigationManager.applyThumbZoom(prefs.defaultThumbZoom);
            }
            inst.renderFolders(inst.state.directories);
            inst.applyFilterAndRender();
            if (inst.navigationManager) inst.navigationManager.updateStatusBar();
          });
          this.updateViewModeUI();
        });

        window.EventBus.on('fs:changed', () => {
          this.instances.forEach(inst => {
            if (typeof inst.invalidateDirCache === 'function') inst.invalidateDirCache();
            if (inst.sidebarManager) {
              inst.sidebarManager.invalidateTreeCache();
              inst.sidebarManager.refreshOrganizationMeta();
            }
            if (inst.state && inst.state.isTrashView && typeof inst.openTrashView === 'function') {
              inst.openTrashView();
            } else {
              inst.loadDirectory(inst.state.currentPath, { forceRefresh: true });
            }
            if (inst.splitPaneManager) inst.splitPaneManager.refreshIfOpen();
          });
        });

        const refreshVolumes = () => {
          const vols = (window.sys && window.sys.shares && typeof window.sys.shares.getVolumes === 'function')
            ? window.sys.shares.getVolumes()
            : [];
          const mountedPaths = vols.map(v => String(v.path || '').replace(/^\/+|\/+$/g, ''));
          this.instances.forEach(inst => {
            if (typeof inst.invalidateDirCache === 'function') inst.invalidateDirCache();
            if (typeof inst.loadSavedPreferences === 'function') inst.loadSavedPreferences();
            if (typeof inst.updateViewModeButtonsUI === 'function') inst.updateViewModeButtonsUI();
            if (typeof inst.renderVolumesBar === 'function') inst.renderVolumesBar();
            if (inst.sidebarManager) {
              inst.sidebarManager.invalidateTreeCache();
              inst.sidebarManager.renderAll();
              inst.sidebarManager.loadOrganizationMeta();
            }
            const cur = String(inst.state.currentPath || '').replace(/^\/+|\/+$/g, '');
            const isScopedPath = cur.startsWith('ext://') || cur.startsWith('users/');
            if (isScopedPath) {
              const stillMounted = mountedPaths.some(mp => mp && (cur === mp || cur.startsWith(mp + '/')));
              if (!stillMounted && typeof inst.loadDirectory === 'function') {
                inst.loadDirectory('');
              }
            }
          });
        };
        window.EventBus.on('volumes:changed', refreshVolumes);
        window.EventBus.on('auth:changed', refreshVolumes);
      }

      if (!window.ATELIER_AUTOSTART_CONFIG) {
        this.createInstance();
      }
    }

    get state() {
      const active = this.getActiveInstance();
      return active ? active.state : {};
    }

    set state(val) {
      const active = this.getActiveInstance();
      if (active) active.state = val;
    }

    loadDirectory(path) {
      if (this.instances && this.instances.size > 0) {
        this.instances.forEach(inst => {
          if (typeof inst.loadDirectory === 'function') {
            inst.loadDirectory(path !== undefined ? path : inst.state.currentPath);
          }
        });
      } else {
        const active = this.getActiveInstance();
        if (active && typeof active.loadDirectory === 'function') {
          active.loadDirectory(path !== undefined ? path : active.state.currentPath);
        }
      }
    }

    getActiveInstance() {
      if (this.activeInstance && this.instances.has(this.activeInstance.id)) {
        return this.activeInstance;
      }
      const first = this.instances.values().next().value;
      return first || null;
    }

    setActiveInstance(instance) {
      this.activeInstance = instance;
      if (window.MenuBarManager) {
        window.MenuBarManager.setActiveApp('explorer');
        this.updateMenuBarForActiveInstance();
      }
    }

    removeInstance(id) {
      this.instances.delete(id);
      if (this.activeInstance && this.activeInstance.id === id) {
        this.activeInstance = this.instances.values().next().value || null;
      }
      if (this.instances.size === 0 && window.MenuBarManager) {
        window.MenuBarManager.restoreDefaultMenu();
      }
    }

    createInstance(params = {}) {
      const id = ++this.instanceCounter;
      const instance = new ExplorerInstance(this, id, params);
      this.instances.set(id, instance);
      this.setActiveInstance(instance);
      return instance;
    }

    open(params = {}) {
      if (params.newWindow || this.instances.size === 0) {
        return this.createInstance(params);
      }

      const targetDir = params.dir !== undefined ? params.dir : params.initialPath;
      if (targetDir !== undefined) {
        const normalizedParams = Object.assign({}, params, { dir: targetDir });
        for (const inst of this.instances.values()) {
          if (inst.state.currentPath === targetDir) {
            if (inst.win.state === 'minimized') window.WindowManager.restoreWindow(inst.winId);
            window.WindowManager.focusWindow(inst.winId);
            return inst;
          }
        }
        return this.createInstance(normalizedParams);
      }

      return this.createInstance(params);
    }

    // -------------------------------------------------------------
    // CONTEXTUAL TOP MENUBAR INTEGRATION
    // -------------------------------------------------------------
    bindMenuBar() {
      if (!window.MenuBarManager) return;

      window.MenuBarManager.registerAppMenu('explorer', (container) => {
        const active = this.getActiveInstance();
        const activeState = active ? active.state : {};

        container.innerHTML = `
          <div class="explorer-header-bar">
            <div class="search-box">
              <span class="search-icon">🔍</span>
              <input type="text" id="searchInput" class="search-input" placeholder="${this.escapeHtml(this.t('nav.search_placeholder'))}" value="${this.escapeHtml(activeState.searchQuery || '')}" aria-label="${this.escapeHtml(this.t('nav.search_placeholder'))}">
              <button type="button" id="searchClearBtn" class="search-clear-btn" title="${this.escapeHtml(this.t('nav.search_clear'))}" style="${activeState.searchQuery ? 'display:inline-flex;' : 'display:none;'}">✕</button>
              <button type="button" id="advancedSearchBtn" class="search-filter-btn" title="${this.escapeHtml(this.t('nav.search_advanced'))}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line>
                  <line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line>
                  <line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line>
                  <line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line>
                </svg>
              </button>
            </div>

            <div class="sort-group">
              <select id="sortSelect" class="sort-select" aria-label="${this.escapeHtml(this.t('sort.title'))}">
                <option value="name" ${activeState.sortBy === 'name' ? 'selected' : ''}>${this.escapeHtml(this.t('sort.name'))}</option>
                <option value="category" ${activeState.sortBy === 'category' ? 'selected' : ''}>${this.escapeHtml(this.t('explorer.list_type'))}</option>
                <option value="exif_date" ${activeState.sortBy === 'exif_date' ? 'selected' : ''}>${this.escapeHtml(this.t('sort.date'))}</option>
                <option value="date" ${activeState.sortBy === 'date' ? 'selected' : ''}>${this.escapeHtml(this.t('sort.mtime'))}</option>
                <option value="size" ${activeState.sortBy === 'size' ? 'selected' : ''}>${this.escapeHtml(this.t('sort.size'))}</option>
              </select>
              <button id="sortOrderBtn" class="btn-toggle" title="${this.escapeHtml(this.t('sort.order_asc'))}">
                <span id="sortOrderIcon" style="font-size:1.1rem;font-weight:bold;">${activeState.sortOrder === 'asc' ? '⇧' : '⇩'}</span>
              </button>
            </div>

            <button id="toggleFavoritesBtn" class="btn-toggle ${activeState.showFavoritesOnly ? 'active' : ''}" title="${this.escapeHtml(this.t('nav.favorites'))}">
              <span>❤️</span><span id="favCountBadge" class="fav-count-badge" style="${(activeState.favorites && activeState.favorites.length > 0) ? 'display:inline-flex;' : 'display:none;'}">${(activeState.favorites && activeState.favorites.length) || 0}</span>
            </button>

            <button type="button" id="menuFolderMapBtn" class="btn-toggle" style="display: none;" title="${this.escapeHtml(this.t('nav.map'))}">
              <span>🗺️</span>
            </button>

            <div class="archive-dropdown-container" id="archiveDropdownContainer" style="${(activeState.userRights && activeState.userRights.can_download_archive === false && !activeState.isAdmin) ? 'display:none;' : 'display:inline-flex;'}">
              <button id="downloadArchiveBtn" class="btn-toggle" title="${this.escapeHtml(this.t('nav.download_archive'))}">
                <span>⇲</span> ▾
              </button>
              <div id="archiveMenu" class="archive-dropdown-menu"></div>
            </div>

            <div class="view-selector-container" id="viewSelectorContainer">
              <button type="button" id="viewSelectorBtn" class="btn-toggle view-btn" title="${this.escapeHtml(this.t('view.switch_mode'))}">
                <span id="currentViewIcon">${this.getViewModeIcon(activeState.viewMode || 'list')}</span>
                <span id="currentViewLabel">${this.getViewModeLabel(activeState.viewMode || 'list')}</span>
                <span class="view-dropdown-arrow">▾</span>
              </button>
              <div id="viewDropdownMenu" class="view-dropdown-menu" style="display: none;"></div>
            </div>

            <button id="newExplorerWindowBtn" class="btn-toggle" title="${this.escapeHtml(this.t('explorer.new_window'))}" style="display:inline-flex;">
              <span>🗂️+</span>
            </button>

            <button id="createFolderBtn" class="btn-toggle" title="${this.escapeHtml(this.t('nav.create_folder'))}" style="${(activeState.isAdmin || (activeState.userRights && activeState.userRights.can_create_folder)) ? 'display:inline-flex;' : 'display:none;'}">
              <span>📁+</span>
            </button>
            <button id="uploadMediaBtn" class="btn-toggle" title="${this.escapeHtml(this.t('nav.upload_media'))}" style="${(activeState.isAdmin || (activeState.userRights && activeState.userRights.can_upload)) ? 'display:inline-flex;' : 'display:none;'}">
              <span>📤</span>
            </button>
            <input type="file" id="uploadFileInput" multiple style="display: none;" />
            <button id="folderSettingsBtn" class="btn-toggle" title="${this.escapeHtml(this.t('nav.folder_settings'))}" style="${activeState.isAdmin ? 'display:inline-flex;' : 'display:none;'}">
              <span>⚙</span>
            </button>
          </div>
        `;

        this.bindMenuBarEvents();
        this.updateArchiveMenuUI();
        this.updateViewDropdownUI();
      });

      window.MenuBarManager.setActiveApp('explorer');
    }

    bindMenuBarEvents() {
      const searchInput = document.getElementById('searchInput');
      const searchClearBtn = document.getElementById('searchClearBtn');
      const advSearchBtn = document.getElementById('advancedSearchBtn');
      const sortSelect = document.getElementById('sortSelect');
      const sortOrderBtn = document.getElementById('sortOrderBtn');
      const toggleFavBtn = document.getElementById('toggleFavoritesBtn');
      const dlArchiveBtn = document.getElementById('downloadArchiveBtn');
      const viewSelectorBtn = document.getElementById('viewSelectorBtn');
      const createFolderBtn = document.getElementById('createFolderBtn');
      const uploadMediaBtn = document.getElementById('uploadMediaBtn');
      const uploadFileInput = document.getElementById('uploadFileInput');
      const folderSettingsBtn = document.getElementById('folderSettingsBtn');
      const newWinBtn = document.getElementById('newExplorerWindowBtn');
      const menuMapBtn = document.getElementById('menuFolderMapBtn');

      if (searchInput) {
        searchInput.oninput = (e) => {
          const active = this.getActiveInstance();
          if (active) {
            active.state.searchQuery = e.target.value.toLowerCase();
            if (searchClearBtn) searchClearBtn.style.display = e.target.value ? 'flex' : 'none';
            active.applyFilterAndRender();
          }
        };
      }

      if (searchClearBtn) {
        searchClearBtn.onclick = () => {
          const active = this.getActiveInstance();
          if (active) active.exitSearch();
        };
      }

      if (advSearchBtn) {
        advSearchBtn.onclick = (e) => {
          if (e) e.stopPropagation();
          const active = this.getActiveInstance();
          if (active) {
            if (active.isSearchModalOpen) active.closeSearchModal();
            else active.openSearchModal();
          }
        };
      }

      if (sortSelect) {
        sortSelect.onchange = (e) => {
          const active = this.getActiveInstance();
          if (active) {
            const nextOrder = ['date', 'exif_date', 'size'].includes(e.target.value) ? 'desc' : 'asc';
            active.setSort(e.target.value, nextOrder);
          }
        };
      }

      if (sortOrderBtn) {
        sortOrderBtn.onclick = () => {
          const active = this.getActiveInstance();
          if (active) active.toggleSortOrder();
        };
      }

      if (toggleFavBtn) {
        toggleFavBtn.onclick = () => {
          const active = this.getActiveInstance();
          if (active) active.toggleFavoritesFilter();
        };
      }

      if (menuMapBtn) {
        menuMapBtn.onclick = () => {
          const active = this.getActiveInstance();
          if (active) active.openMapModal();
        };
      }

      if (dlArchiveBtn) {
        dlArchiveBtn.onclick = (e) => {
          e.stopPropagation();
          const menu = document.getElementById('archiveMenu');
          if (menu) menu.classList.toggle('open');
        };
      }

      if (viewSelectorBtn) {
        viewSelectorBtn.onclick = (e) => {
          e.stopPropagation();
          this.toggleViewDropdown();
        };
      }

      if (newWinBtn) {
        newWinBtn.onclick = () => this.createInstance();
      }

      if (createFolderBtn) {
        createFolderBtn.onclick = () => {
          const active = this.getActiveInstance();
          if (active) active.openCreateFolderModal();
        };
      }

      if (uploadMediaBtn) {
        uploadMediaBtn.onclick = () => {
          if (uploadFileInput) uploadFileInput.click();
        };
      }

      if (uploadFileInput) {
        uploadFileInput.onchange = (e) => {
          const active = this.getActiveInstance();
          if (active && e.target.files && e.target.files.length > 0) {
            active.handleUploadFiles(e.target.files);
          }
          e.target.value = '';
        };
      }

      if (folderSettingsBtn) {
        folderSettingsBtn.onclick = () => {
          const active = this.getActiveInstance();
          if (active) active.openFolderSettingsModal();
        };
      }

      this.updateViewDropdownUI();
    }

    updateViewModeUI() {
      this.updateMenuBarForActiveInstance();
      this.updateViewDropdownUI();
    }

    updateMenuBarForActiveInstance() {
      const active = this.getActiveInstance();
      if (!active) return;

      const searchInput = document.getElementById('searchInput');
      const searchClearBtn = document.getElementById('searchClearBtn');
      const sortSelect = document.getElementById('sortSelect');
      const sortOrderIcon = document.getElementById('sortOrderIcon');
      const sortOrderBtn = document.getElementById('sortOrderBtn');
      const toggleFavBtn = document.getElementById('toggleFavoritesBtn');
      const favCountBadge = document.getElementById('favCountBadge');
      const icon = document.getElementById('currentViewIcon');
      const label = document.getElementById('currentViewLabel');

      if (searchInput) searchInput.value = active.state.searchQuery || '';
      if (searchClearBtn) searchClearBtn.style.display = active.state.searchQuery ? 'flex' : 'none';
      if (sortSelect) sortSelect.value = active.state.sortBy || 'name';
      if (sortOrderIcon) sortOrderIcon.textContent = (active.state.sortOrder === 'asc') ? '⇧' : '⇩';
      if (sortOrderBtn) sortOrderBtn.classList.toggle('active', active.state.sortOrder === 'asc');
      if (toggleFavBtn) toggleFavBtn.classList.toggle('active', !!active.state.showFavoritesOnly);
      if (favCountBadge) {
        const count = active.state.favorites ? active.state.favorites.length : 0;
        favCountBadge.textContent = count;
        favCountBadge.style.display = count > 0 ? 'inline-flex' : 'none';
      }
      if (icon) icon.textContent = this.getViewModeIcon(active.state.viewMode);
      if (label) label.textContent = this.getViewModeLabel(active.state.viewMode);

      this.updateArchiveMenuUI();
    }

    updateViewDropdownUI() {
      const active = this.getActiveInstance();
      const currentMode = active ? active.state.viewMode : 'list';
      const menu = document.getElementById('viewDropdownMenu');
      if (!menu) return;

      const views = (window.GalleryViewRegistry && window.GalleryViewRegistry.getAll()) || [];
      if (views.length === 0) return;

      menu.innerHTML = views.map(v => `
        <button type="button" class="view-option-btn ${currentMode === v.id ? 'active' : ''}" data-view-mode="${this.escapeHtml(v.id)}">
          <span>${v.icon || '🖼️'}</span> <span>${this.escapeHtml(this.t(v.nameKey))}</span>
        </button>
      `).join('');

      menu.querySelectorAll('.view-option-btn').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const mode = btn.dataset.viewMode;
          if (mode) {
            const inst = this.getActiveInstance();
            if (inst) inst.setViewMode(mode);
            this.closeViewDropdown();
          }
        };
      });
    }

    setViewMode(mode) {
      const inst = this.getActiveInstance();
      if (inst && typeof inst.setViewMode === 'function') {
        inst.setViewMode(mode);
      }
    }

    getViewModeIcon(mode) {
      const plugin = window.GalleryViewRegistry && window.GalleryViewRegistry.get(mode);
      return plugin ? (plugin.icon || '🖼️') : '🖼️';
    }

    getViewModeLabel(mode) {
      const plugin = window.GalleryViewRegistry && window.GalleryViewRegistry.get(mode);
      if (plugin && plugin.nameKey) return this.t(plugin.nameKey);
      return mode;
    }

    toggleViewDropdown() {
      this.updateViewDropdownUI();
      const menu = document.getElementById('viewDropdownMenu');
      if (!menu) return;
      menu.style.display = (menu.style.display === 'flex') ? 'none' : 'flex';
    }

    closeViewDropdown() {
      const menu = document.getElementById('viewDropdownMenu');
      if (menu) menu.style.display = 'none';
    }

    updateArchiveMenuUI() {
      const active = this.getActiveInstance();
      if (!active) return;

      const menu = document.getElementById('archiveMenu');
      if (!menu) return;
      const currentDir = encodeURIComponent(active.state.currentPath || '');
      const archives = active.state.availableArchives || {};

      let itemsHtml = '';
      if (Array.isArray(archives) && archives.length > 0) {
        itemsHtml = archives.map(arch => {
          const fmt = (arch.format || 'zip').toUpperCase();
          return `
            <a href="${arch.url || `system/endpoints/archive.php?dir=${currentDir}&format=${encodeURIComponent(arch.format || 'zip')}`}" download class="archive-menu-item">
              <span>📦</span> <span>${this.escapeHtml(arch.name || this.t('explorer.download_folder_format', { format: fmt }))}</span>
            </a>
          `;
        }).join('');
      } else if (archives && typeof archives === 'object' && Object.keys(archives).length > 0) {
        itemsHtml = Object.keys(archives).map(fmt => {
          const label = fmt.toUpperCase();
          return `
            <a href="system/endpoints/archive.php?dir=${currentDir}&format=${encodeURIComponent(fmt)}" download class="archive-menu-item">
              <span>📦</span> <span>${this.escapeHtml(this.t('explorer.download_folder_format', { format: label }))}</span>
            </a>
          `;
        }).join('');
      } else {
        itemsHtml = `
          <a href="system/endpoints/archive.php?dir=${currentDir}&format=zip" download class="archive-menu-item">
            <span>📦</span> <span>${this.escapeHtml(this.t('explorer.download_folder_format', { format: 'ZIP' }))}</span>
          </a>
        `;
      }

      menu.innerHTML = itemsHtml;
    }

    bindGlobalModals() {
      document.addEventListener('click', (e) => {
        const viewContainer = document.getElementById('viewSelectorContainer');
        if (viewContainer && !viewContainer.contains(e.target)) {
          this.closeViewDropdown();
        }
        const archiveContainer = document.querySelector('.archive-dropdown-container');
        const archiveMenu = document.getElementById('archiveMenu');
        if (archiveContainer && archiveMenu && !archiveContainer.contains(e.target)) {
          archiveMenu.classList.remove('open');
        }
      });

      const resolveModalInst = () => this.activeModalInstance || this.getActiveInstance();

      const createFolderCloseBtn = document.getElementById('createFolderCloseBtn');
      const createFolderForm = document.getElementById('createFolderForm');
      if (createFolderCloseBtn) createFolderCloseBtn.onclick = () => { const i = resolveModalInst(); if (i) i.closeCreateFolderModal(); };
      if (createFolderForm) createFolderForm.onsubmit = (e) => { e.preventDefault(); const i = resolveModalInst(); if (i) i.createFolder(); };

      const deleteConfirmCloseBtn = document.getElementById('deleteConfirmCloseBtn');
      const deleteCancelBtn = document.getElementById('deleteCancelBtn');
      const deleteConfirmActionBtn = document.getElementById('deleteConfirmActionBtn');
      if (deleteConfirmCloseBtn) deleteConfirmCloseBtn.onclick = () => { const i = resolveModalInst(); if (i) i.closeDeleteConfirmModal(); };
      if (deleteCancelBtn) deleteCancelBtn.onclick = () => { const i = resolveModalInst(); if (i) i.closeDeleteConfirmModal(); };
      if (deleteConfirmActionBtn) deleteConfirmActionBtn.onclick = () => { const i = resolveModalInst(); if (i) i.confirmDeleteItem(); };

      const mediaCommentCloseBtn = document.getElementById('mediaCommentCloseBtn');
      const mediaCommentForm = document.getElementById('mediaCommentForm');
      if (mediaCommentCloseBtn) mediaCommentCloseBtn.onclick = () => { const i = resolveModalInst(); if (i) i.closeMediaCommentModal(); };
      if (mediaCommentForm) mediaCommentForm.onsubmit = (e) => { e.preventDefault(); const i = resolveModalInst(); if (i) i.saveMediaComment(); };

      const folderUnlockCloseBtn = document.getElementById('folderUnlockCloseBtn');
      const folderUnlockForm = document.getElementById('folderUnlockForm');
      if (folderUnlockCloseBtn) folderUnlockCloseBtn.onclick = () => { const i = resolveModalInst(); if (i) i.closeFolderUnlockModal(); };
      if (folderUnlockForm) folderUnlockForm.onsubmit = (e) => { e.preventDefault(); const i = resolveModalInst(); if (i) i.unlockFolder(); };

      const folderSettingsCloseBtn = document.getElementById('folderSettingsCloseBtn');
      const folderSettingsForm = document.getElementById('folderSettingsForm');
      if (folderSettingsCloseBtn) folderSettingsCloseBtn.onclick = () => { const i = resolveModalInst(); if (i) i.closeFolderSettingsModal(); };
      if (folderSettingsForm) folderSettingsForm.onsubmit = (e) => { e.preventDefault(); const i = resolveModalInst(); if (i) i.saveFolderSettings(); };
    }

    t(key, params = {}) {
      if (window.desktop && typeof window.desktop.t === 'function') {
        return window.desktop.t(key, params);
      }
      if (window.sys && window.sys.i18n && typeof window.sys.i18n.t === 'function') {
        return window.sys.i18n.t(key, params);
      }
      if (window.I18nEngine && typeof window.I18nEngine.t === 'function') {
        return window.I18nEngine.t(key, params);
      }
      return key;
    }

    escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // -------------------------------------------------------------------------
    // UNIVERSAL AI AGENT CONTRACT (Phase E — Lot 4 + Phase G — Lot 6)
    // -------------------------------------------------------------------------
    isWindowOpen() {
      return Boolean(this.instances && this.instances.size > 0);
    }

    getAgentContext() {
      const inst = typeof this.getActiveInstance === 'function' ? this.getActiveInstance() : null;
      if (!inst || !inst.state) return null;
      const viewMode = inst.state.viewMode || 'list';
      const viewProfile = inst.stateManager && typeof inst.stateManager.getViewProfile === 'function'
        ? inst.stateManager.getViewProfile(viewMode)
        : (viewMode === 'list' ? 'pro' : (viewMode === 'polaroid' ? 'multimedia' : 'thumbs'));
      return {
        current_path: inst.state.currentPath || '',
        view_mode: viewMode,
        view_profile: viewProfile,
        sort_by: inst.state.sortBy || 'name',
        sort_order: inst.state.sortOrder || 'asc',
        filter_category: inst.state.filterCategory || 'all',
        search_query: inst.state.searchQuery || '',
        active_tag_filter: inst.state.activeTagFilter || null,
        selected_count: inst.state.selectedPaths ? inst.state.selectedPaths.size : 0,
        selected_paths: inst.state.selectedPaths ? Array.from(inst.state.selectedPaths).slice(0, 20) : [],
        visible_files: Array.isArray(inst.state.filteredFiles) ? inst.state.filteredFiles.length : 0,
        folders_count: Array.isArray(inst.state.directories) ? inst.state.directories.length : 0,
        tabs_count: inst.navigationManager && Array.isArray(inst.navigationManager.tabs) ? inst.navigationManager.tabs.length : 1,
        active_tab_id: inst.navigationManager ? inst.navigationManager.activeTabId : null,
        split_pane_open: Boolean(inst.splitPaneManager && inst.splitPaneManager.isOpen),
        split_pane_path: inst.splitPaneManager ? (inst.splitPaneManager.currentPath || '') : '',
        sidebar_visible: Boolean(inst.sidebarManager && inst.sidebarManager.isVisible),
        is_trash_view: Boolean(inst.state.isTrashView),
        inspector_open: Boolean(inst.el && inst.el.inspectorDrawer && inst.el.inspectorDrawer.style.display !== 'none'),
        quicklook_open: Boolean(inst.quickLookManager && inst.quickLookManager.isOpen)
      };
    }

    getAgentTools() {
      return [
        {
          name: 'navigate',
          description: 'Navigates the active Gallery Explorer window to a VFS directory (e.g. "", "users/<me>", "vacances", or "ext://<id>").',
          risk: 'mutate_app',
          parameters: {
            type: 'object',
            properties: {
              dir: { type: 'string', description: 'Target VFS directory path' }
            },
            required: ['dir']
          }
        },
        {
          name: 'set_view_options',
          description: 'Changes the active Explorer view mode (list, grid, mosaic, polaroid), sort field/order, or category filter (all, image, video, audio, doc, archive).',
          risk: 'mutate_app',
          parameters: {
            type: 'object',
            properties: {
              view_mode: { type: 'string', description: 'View mode: list (Pro), grid, mosaic, or polaroid (Multimedia)' },
              sort_by: { type: 'string', description: 'Sort key: name, category, date, exif_date, mtime, or size' },
              sort_order: { type: 'string', description: 'Sort direction: asc or desc' },
              filter_category: { type: 'string', description: 'Media filter: all, image, video, audio, doc, or archive' }
            }
          }
        },
        {
          name: 'manage_tabs',
          description: 'Lists, creates, switches, or closes Explorer navigation tabs.',
          risk: 'mutate_app',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', description: 'Action: list, create, switch, or close' },
              dir: { type: 'string', description: 'Initial directory path when creating a tab' },
              tab_id: { type: 'string', description: 'Target tab ID when switching or closing' }
            },
            required: ['action']
          }
        },
        {
          name: 'toggle_split_pane',
          description: 'Opens, closes, navigates, or swaps the Explorer Dual Pane (Commander F3) secondary panel.',
          risk: 'mutate_app',
          parameters: {
            type: 'object',
            properties: {
              open: { type: 'boolean', description: 'True to open split pane, false to close' },
              dir: { type: 'string', description: 'Optional directory path to load in the secondary pane' },
              swap: { type: 'boolean', description: 'True to swap primary and secondary pane directories' }
            }
          }
        },
        {
          name: 'rename_item',
          description: 'Renames a file or folder inside the VFS (subject to security & permission checks).',
          risk: 'mutate_fs',
          parameters: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'Relative VFS path of the item to rename' },
              new_name: { type: 'string', description: 'New filename or folder name (without path separators)' }
            },
            required: ['source', 'new_name']
          }
        },
        {
          name: 'manage_tags',
          description: 'Lists all user tags, reads or updates tags on a VFS item, or filters Explorer by a specific tag.',
          risk: 'mutate_fs',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', description: 'Action: list_all, get, set, or filter' },
              path: { type: 'string', description: 'Relative VFS item path (required for get/set)' },
              tags: { type: 'array', items: { type: 'string' }, description: 'Array of tag labels (for set)' },
              tag: { type: 'string', description: 'Tag label to filter Explorer by (for filter)' }
            },
            required: ['action']
          }
        },
        {
          name: 'manage_trash',
          description: 'Opens the 30-day Trash view, lists soft-deleted items, or restores a trashed item by ID (non-destructive).',
          risk: 'mutate_app',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', description: 'Action: open, list, or restore' },
              trash_id: { type: 'string', description: 'Trash item ID to restore (for restore)' }
            },
            required: ['action']
          }
        },
        {
          name: 'search_indexed',
          description: 'Runs an instant multi-criteria SQLite indexed search in Explorer (text, category, tag, size_range, timing, scope).',
          risk: 'read_only',
          parameters: {
            type: 'object',
            properties: {
              q: { type: 'string', description: 'Text query matching filename, path, comment, or tags' },
              category: { type: 'string', description: 'Category: all, image, video, audio, doc, archive' },
              tag: { type: 'string', description: 'Optional tag label filter' },
              scope: { type: 'string', description: 'Search scope: global or current' },
              size_range: { type: 'string', description: 'Size filter: all, small, medium, large, xlarge' },
              timing: { type: 'string', description: 'Time filter: all, today, week, month, year' }
            }
          }
        },
        {
          name: 'open_quicklook',
          description: 'Opens or closes Quick Look inline preview on a file in the active Explorer window.',
          risk: 'mutate_app',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative VFS file path to preview' },
              close: { type: 'boolean', description: 'True to close Quick Look' }
            }
          }
        }
      ];
    }

    async executeAgentTool(name, args = {}) {
      const inst = typeof this.getActiveInstance === 'function' ? this.getActiveInstance() : null;
      if (!inst) return { success: false, error: 'No active Explorer window.' };

      if (name === 'navigate') {
        const dir = String(args.dir || '');
        if (typeof inst.loadDirectory === 'function') {
          await inst.loadDirectory(dir);
          return { success: true, current_path: inst.state.currentPath || dir };
        }
        return { success: false, error: 'Explorer.loadDirectory unavailable.' };
      }

      if (name === 'set_view_options') {
        if (args.view_mode && ['polaroid', 'grid', 'mosaic', 'list'].includes(String(args.view_mode))) {
          if (typeof inst.setViewMode === 'function') inst.setViewMode(String(args.view_mode));
          else inst.state.viewMode = String(args.view_mode);
        }
        const hasSortBy = args.sort_by && ['name', 'category', 'date', 'exif_date', 'mtime', 'size'].includes(String(args.sort_by));
        const hasSortOrder = args.sort_order && ['asc', 'desc'].includes(String(args.sort_order));
        if (hasSortBy || hasSortOrder) {
          const nextBy = hasSortBy ? (String(args.sort_by) === 'mtime' ? 'date' : String(args.sort_by)) : (inst.state.sortBy || 'name');
          const nextOrder = hasSortOrder ? String(args.sort_order) : (inst.state.sortOrder || 'asc');
          if (typeof inst.setSort === 'function') {
            inst.setSort(nextBy, nextOrder);
          } else {
            inst.state.sortBy = nextBy;
            inst.state.sortOrder = nextOrder;
          }
        }
        if (args.filter_category && ['all', 'image', 'video', 'audio', 'doc', 'archive'].includes(String(args.filter_category))) {
          inst.state.filterCategory = String(args.filter_category);
        }
        if (typeof inst.applyFilterAndRender === 'function') inst.applyFilterAndRender();
        return {
          success: true,
          view_mode: inst.state.viewMode,
          sort_by: inst.state.sortBy,
          sort_order: inst.state.sortOrder,
          filter_category: inst.state.filterCategory
        };
      }

      if (name === 'manage_tabs') {
        const nav = inst.navigationManager;
        if (!nav) return { success: false, error: 'NavigationManager unavailable.' };
        const act = String(args.action || 'list');
        if (act === 'list') {
          return {
            success: true,
            active_tab_id: nav.activeTabId,
            tabs: (nav.tabs || []).map(t => ({ id: t.id, path: t.path, title: t.title }))
          };
        }
        if (act === 'create') {
          const created = nav.createTab(args.dir !== undefined ? String(args.dir) : (inst.state.currentPath || ''), { activate: true });
          return { success: true, tab: created ? { id: created.id, path: created.path } : null, tabs_count: nav.tabs.length };
        }
        if (act === 'switch') {
          nav.switchTab(String(args.tab_id || ''));
          return { success: true, active_tab_id: nav.activeTabId };
        }
        if (act === 'close') {
          nav.closeTab(args.tab_id ? String(args.tab_id) : nav.activeTabId);
          return { success: true, active_tab_id: nav.activeTabId, tabs_count: nav.tabs.length };
        }
        return { success: false, error: `Unknown manage_tabs action '${act}'.` };
      }

      if (name === 'toggle_split_pane') {
        const sp = inst.splitPaneManager;
        if (!sp) return { success: false, error: 'SplitPaneManager unavailable.' };
        if (args.swap && typeof sp.swapWithPrimary === 'function') {
          sp.swapWithPrimary();
          return { success: true, is_open: sp.isOpen, primary_path: inst.state.currentPath || '', secondary_path: sp.currentPath || '' };
        }
        const targetOpen = (typeof args.open === 'boolean') ? args.open : !sp.isOpen;
        sp.toggle(targetOpen);
        if (targetOpen && typeof args.dir === 'string' && typeof sp.loadPath === 'function') {
          await sp.loadPath(args.dir, true);
        }
        return { success: true, is_open: sp.isOpen, secondary_path: sp.currentPath || '' };
      }

      if (name === 'rename_item') {
        const source = String(args.source || '').trim();
        const newName = String(args.new_name || '').trim();
        if (!source || !newName) return { success: false, error: 'source and new_name are required.' };
        if (!window.sys || !window.sys.api || !window.sys.api.fs) return { success: false, error: 'Syscall FS API unavailable.' };
        const res = await window.sys.api.fs.renameItem(source, newName);
        if (res && res.success) {
          if (window.EventBus) window.EventBus.emit('fs:changed', { action: 'rename', source, new_name: newName });
          else await inst.loadDirectory(inst.state.currentPath || '', { forceRefresh: true });
          return { success: true, source, new_name: newName, new_path: res.new_path || null };
        }
        return { success: false, error: (res && res.error) || 'Rename failed.' };
      }

      if (name === 'manage_tags') {
        const act = String(args.action || 'list_all');
        if (!window.sys || !window.sys.api) return { success: false, error: 'API unavailable.' };
        if (act === 'list_all') {
          const res = await window.sys.api.get('list_tags');
          return { success: Boolean(res && res.success), tags: (res && res.tags) || [] };
        }
        if (act === 'get') {
          const res = await window.sys.api.get('get_item_tags', { path: String(args.path || '') });
          return { success: Boolean(res && res.success), tags: (res && res.tags) || [] };
        }
        if (act === 'set') {
          const res = await window.sys.api.post('set_item_tags', { path: String(args.path || ''), tags: Array.isArray(args.tags) ? args.tags : [] });
          if (res && res.success && inst.sidebarManager && typeof inst.sidebarManager.refreshOrganizationMeta === 'function') {
            inst.sidebarManager.refreshOrganizationMeta();
          }
          return { success: Boolean(res && res.success), tags: (res && res.tags) || [] };
        }
        if (act === 'filter') {
          const tagLabel = String(args.tag || '').trim();
          if (!tagLabel) return { success: false, error: 'tag is required.' };
          if (typeof inst.searchByTag === 'function') {
            await inst.searchByTag(tagLabel);
            return { success: true, tag: tagLabel, results_count: (inst.state.filteredFiles || []).length };
          }
          return { success: false, error: 'searchByTag unavailable.' };
        }
        return { success: false, error: `Unknown manage_tags action '${act}'.` };
      }

      if (name === 'manage_trash') {
        const act = String(args.action || 'list');
        if (!window.sys || !window.sys.api) return { success: false, error: 'API unavailable.' };
        if (act === 'open') {
          if (typeof inst.openTrashView === 'function') {
            await inst.openTrashView();
            return { success: true, is_trash_view: true };
          }
          return { success: false, error: 'openTrashView unavailable.' };
        }
        if (act === 'list') {
          const res = await window.sys.api.get('list_trash');
          return { success: Boolean(res && res.success), items: (res && res.items) || [] };
        }
        if (act === 'restore') {
          const tid = String(args.trash_id || '').trim();
          if (!tid) return { success: false, error: 'trash_id is required.' };
          const res = await window.sys.api.post('restore_trash_item', { trash_id: tid });
          if (res && res.success && window.EventBus) {
            window.EventBus.emit('fs:changed', { action: 'restore_trash', trash_id: tid });
          }
          return { success: Boolean(res && res.success), restored_path: res && res.restored_path, error: res && res.error };
        }
        return { success: false, error: `Unknown manage_trash action '${act}'.` };
      }

      if (name === 'search_indexed') {
        if (!inst.searchManager || typeof inst.searchManager.searchIndexed !== 'function') {
          return { success: false, error: 'SearchManager unavailable.' };
        }
        await inst.searchManager.searchIndexed({
          q: String(args.q || ''),
          category: String(args.category || 'all'),
          tag: String(args.tag || ''),
          scope: String(args.scope || 'global'),
          size_range: String(args.size_range || 'all'),
          timing: String(args.timing || 'all'),
          limit: 100
        });
        const files = inst.state.filteredFiles || [];
        return {
          success: true,
          count: files.length,
          results: files.slice(0, 25).map(f => ({ name: f.name, path: f.path, category: f.category, size_formatted: f.size_formatted }))
        };
      }

      if (name === 'open_quicklook') {
        if (!inst.quickLookManager) return { success: false, error: 'QuickLook unavailable.' };
        if (args.close) {
          inst.quickLookManager.close();
          return { success: true, is_open: false };
        }
        const targetPath = String(args.path || '');
        const files = inst.state.filteredFiles || [];
        const idx = targetPath ? files.findIndex(f => f.path === targetPath) : 0;
        if (idx < 0 || idx >= files.length) return { success: false, error: 'Target file not found in current view.' };
        inst.quickLookManager.open(idx);
        return { success: true, is_open: inst.quickLookManager.isOpen, file: files[idx].path };
      }

      return { success: false, error: `Unknown explorer tool '${name}'.` };
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    window.explorerApp = new ExplorerApp();
  });

})(window);
