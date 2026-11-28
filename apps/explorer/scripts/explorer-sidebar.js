/**
 * Atelier by GallusTech - Explorer Sidebar & Folder Tree Manager (apps/explorer/scripts/explorer-sidebar.js)
 * Provides a resizable sidebar with Quick Access (Home, Public, Favorites, Recents),
 * Mounted Volumes (Shares & ext:// Cloud), lazy-loaded interactive Folder Tree (DnD targets),
 * Organization (Tags & Trash badge), Quota bar, and profile-aware visibility (hidden in Multimedia/Polaroid).
 */
(function (window) {
  'use strict';

  class ExplorerSidebarManager {
    constructor(instance) {
      this.inst = instance;
      this.expandedPaths = new Set(['']);
      this.treeCache = new Map();
      this.tagsList = [];
      this.trashCount = 0;
      this.isVisible = true;
      this._manualOverride = null; // null = follow view profile; true/false = user forced
      this._cleanupResizer = null;
      this._orgLoadedForScope = null;
    }

    init() {
      const width = this.inst.stateManager ? this.inst.stateManager.getSidebarWidth() : 236;
      if (this.inst.el.sidebar) {
        this.inst.el.sidebar.style.width = `${width}px`;
      }
      this._bindResizer();
      this.applyProfileVisibility(this.inst.state.viewMode || 'list');
      this.renderAll();
      this.loadOrganizationMeta();
    }

    invalidateTreeCache() {
      this.treeCache.clear();
      this._orgLoadedForScope = null;
    }

    applyProfileVisibility(viewMode) {
      const defaultVisible = this.inst.stateManager
        ? this.inst.stateManager.shouldShowSidebarByDefault(viewMode)
        : (viewMode !== 'polaroid');

      // Reset manual override when profile switches between multimedia and pro/thumbs
      const profile = this.inst.stateManager ? this.inst.stateManager.getViewProfile(viewMode) : 'pro';
      if (this._lastProfile && this._lastProfile !== profile) {
        this._manualOverride = null;
      }
      this._lastProfile = profile;

      const visible = (this._manualOverride !== null) ? this._manualOverride : defaultVisible;
      this.setVisible(visible);
    }

    toggleManual() {
      this._manualOverride = !this.isVisible;
      this.setVisible(this._manualOverride);
    }

    setVisible(visible) {
      this.isVisible = !!visible;
      const el = this.inst.el;
      if (el.sidebar) {
        el.sidebar.style.display = this.isVisible ? 'flex' : 'none';
      }
      if (el.sidebarResizer) {
        el.sidebarResizer.style.display = this.isVisible ? 'block' : 'none';
      }
      if (el.sidebarToggleBtn) {
        el.sidebarToggleBtn.classList.toggle('active', this.isVisible);
      }
      // Show horizontal volumes bar only when sidebar is hidden (e.g. Multimedia/Polaroid mode)
      if (el.volumesBar && this.isVisible) {
        el.volumesBar.style.display = 'none';
      } else if (el.volumesBar && !this.isVisible) {
        this.inst.renderVolumesBar();
      }
    }

    renderAll() {
      this.renderQuickAccess();
      this.renderMounts();
      this.renderTree();
      this.renderOrganization();
      this.renderQuota();
    }

    onDirectoryLoaded(dirPath, directories = []) {
      const clean = this.inst.stateManager ? this.inst.stateManager.normalizePath(dirPath) : (dirPath || '');
      this.treeCache.set(clean, (directories || []).map(d => ({
        name: d.name,
        path: d.path,
        is_protected: !!d.is_protected
      })));

      // Expand ancestor chain of active path so tree stays synced
      let cur = clean;
      while (cur !== null) {
        this.expandedPaths.add(cur);
        if (cur === '') break;
        cur = this.inst.stateManager ? this.inst.stateManager.getParentPath(cur) : '';
      }

      if (clean && this.inst.stateManager) {
        const lastCrumb = Array.isArray(this.inst.state.currentBreadcrumbs) && this.inst.state.currentBreadcrumbs.length
          ? this.inst.state.currentBreadcrumbs[this.inst.state.currentBreadcrumbs.length - 1]
          : null;
        this.inst.stateManager.recordRecentFolder(clean, lastCrumb ? lastCrumb.name : '');
      }

      this.renderAll();
    }

    renderQuickAccess() {
      const host = this.inst.el.sidebarQuickAccess;
      if (!host) return;
      const curPath = this.inst.state.currentPath || '';
      const user = (window.sys && window.sys.shares && typeof window.sys.shares.getCurrentUser === 'function')
        ? window.sys.shares.getCurrentUser()
        : window.ATELIER_CURRENT_USER;
      const homePath = user && (user.home_dir || (user.username ? `users/${user.username}` : ''));
      const favCount = (this.inst.state.favorites || []).length;
      const recents = this.inst.stateManager ? this.inst.stateManager.getRecentFolders().slice(0, 4) : [];

      let html = '';
      if (homePath) {
        const active = curPath === homePath && !this.inst.state.showFavoritesOnly;
        html += `
          <button type="button" class="sidebar-nav-item ${active ? 'active' : ''}" data-nav-path="${this.inst.escapeHtml(homePath)}">
            <span class="sidebar-item-icon">🏠</span>
            <span class="sidebar-item-label">${this.inst.escapeHtml(this.inst.t('explorer.sidebar_home'))}</span>
          </button>`;
      }

      const publicActive = curPath === '' && !this.inst.state.showFavoritesOnly;
      html += `
        <button type="button" class="sidebar-nav-item ${publicActive ? 'active' : ''}" data-nav-path="">
          <span class="sidebar-item-icon">🌐</span>
          <span class="sidebar-item-label">${this.inst.escapeHtml(this.inst.t('explorer.sidebar_public'))}</span>
        </button>
        <button type="button" class="sidebar-nav-item ${this.inst.state.showFavoritesOnly ? 'active' : ''}" data-action="favorites">
          <span class="sidebar-item-icon">❤️</span>
          <span class="sidebar-item-label">${this.inst.escapeHtml(this.inst.t('explorer.sidebar_favorites'))}</span>
          ${favCount > 0 ? `<span class="sidebar-badge">${favCount}</span>` : ''}
        </button>`;

      if (recents.length > 0) {
        html += `<div class="sidebar-sublabel">${this.inst.escapeHtml(this.inst.t('explorer.sidebar_recents'))}</div>`;
        recents.forEach(item => {
          const isCur = !this.inst.state.isTrashView && curPath === item.path && !this.inst.state.showFavoritesOnly;
          const displayName = (this.inst.stateManager && (item.name === item.path || String(item.path || '').startsWith('ext://')))
            ? this.inst.stateManager.getFriendlyPathLabel(item.path)
            : item.name;
          const tooltipPath = this.inst.stateManager ? this.inst.stateManager.getFriendlyFullPath(item.path) : item.path;
          html += `
            <button type="button" class="sidebar-nav-item sidebar-recent-item ${isCur ? 'active' : ''}" data-nav-path="${this.inst.escapeHtml(item.path)}" title="${this.inst.escapeHtml(tooltipPath)}">
              <span class="sidebar-item-icon">🕘</span>
              <span class="sidebar-item-label">${this.inst.escapeHtml(displayName)}</span>
            </button>`;
        });
      }

      host.innerHTML = html;
      this._bindNavButtons(host);
    }

    renderMounts() {
      const section = this.inst.el.sidebarMountsSection;
      const host = this.inst.el.sidebarMounts;
      if (!host) return;

      const volumes = (window.sys && window.sys.shares && typeof window.sys.shares.getVolumes === 'function')
        ? window.sys.shares.getVolumes()
        : (Array.isArray(window.ATELIER_MOUNTED_VOLUMES) ? window.ATELIER_MOUNTED_VOLUMES : []);

      if (!volumes || volumes.length === 0) {
        if (section) section.style.display = 'none';
        host.innerHTML = '';
        return;
      }

      if (section) section.style.display = 'block';
      const curPath = this.inst.state.currentPath || '';

      host.innerHTML = volumes.map(vol => {
        const vPath = String(vol.path || '');
        const isActive = !this.inst.state.isTrashView && vPath && (curPath === vPath || curPath.startsWith(vPath + '/'));
        const label = this.inst.stateManager
          ? this.inst.stateManager.getVolumeLabel(vol)
          : String(vol.mount_name || vol.label || vol.name || vPath);
        const icon = this.inst.stateManager
          ? this.inst.stateManager.getVolumeIcon(vol)
          : (vol.mount_icon || vol.icon || (vPath.startsWith('ext://') ? '☁️' : (vol.kind === 'home' ? '🏠' : '🤝')));
        const perm = vol.permission === 'write' || vol.permission === 'admin' ? 'RW' : 'R';
        const tooltip = vol.driver ? `${label} (${String(vol.driver).toUpperCase()} · ${vPath})` : `${label} (${vPath})`;
        return `
          <button type="button" class="sidebar-nav-item ${isActive ? 'active' : ''}" data-nav-path="${this.inst.escapeHtml(vPath)}" title="${this.inst.escapeHtml(tooltip)}">
            <span class="sidebar-item-icon">${icon}</span>
            <span class="sidebar-item-label">${this.inst.escapeHtml(label)}</span>
            <span class="sidebar-perm-badge ${perm === 'RW' ? 'rw' : 'ro'}">${perm}</span>
          </button>`;
      }).join('');

      this._bindNavButtons(host);
    }

    renderTree() {
      const host = this.inst.el.sidebarTree;
      if (!host) return;

      const curPath = this.inst.state.currentPath || '';
      const renderBranch = (parentPath, depth) => {
        const children = this.treeCache.get(parentPath);
        if (!Array.isArray(children) || children.length === 0) return '';
        return children.map(dir => {
          const p = dir.path;
          const isExpanded = this.expandedPaths.has(p);
          const isActive = curPath === p;
          const hasLoaded = this.treeCache.has(p);
          const sub = this.treeCache.get(p);
          const hasChildren = !hasLoaded || (Array.isArray(sub) && sub.length > 0);
          const chevron = hasChildren ? (isExpanded ? '▾' : '▸') : '·';
          return `
            <div class="sidebar-tree-node" data-tree-path="${this.inst.escapeHtml(p)}">
              <div class="sidebar-tree-row ${isActive ? 'active' : ''}" style="padding-left: ${8 + depth * 14}px;" data-nav-path="${this.inst.escapeHtml(p)}" title="${this.inst.escapeHtml(p)}">
                <button type="button" class="sidebar-tree-chevron" data-toggle-path="${this.inst.escapeHtml(p)}" aria-label="Toggle">${chevron}</button>
                <span class="sidebar-item-icon">${dir.is_protected ? '🔒' : (isExpanded ? '📂' : '📁')}</span>
                <span class="sidebar-item-label">${this.inst.escapeHtml(dir.name)}</span>
              </div>
              ${isExpanded ? renderBranch(p, depth + 1) : ''}
            </div>`;
        }).join('');
      };

      const rootExpanded = this.expandedPaths.has('');
      const rootChildrenHtml = rootExpanded ? renderBranch('', 1) : '';

      host.innerHTML = `
        <div class="sidebar-tree-node" data-tree-path="">
          <div class="sidebar-tree-row ${curPath === '' ? 'active' : ''}" style="padding-left: 8px;" data-nav-path="">
            <button type="button" class="sidebar-tree-chevron" data-toggle-path="" aria-label="Toggle">${rootExpanded ? '▾' : '▸'}</button>
            <span class="sidebar-item-icon">💾</span>
            <span class="sidebar-item-label">${this.inst.escapeHtml(this.inst.t('nav.root'))}</span>
          </div>
          ${rootChildrenHtml}
        </div>`;

      host.querySelectorAll('.sidebar-tree-chevron').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          await this.toggleTreeNode(btn.dataset.togglePath || '');
        };
      });

      host.querySelectorAll('.sidebar-tree-row').forEach(row => {
        const destPath = row.dataset.navPath || '';
        row.onclick = (e) => {
          if (e.target.closest('.sidebar-tree-chevron')) return;
          if (this.inst.state.showFavoritesOnly) this.inst.state.showFavoritesOnly = false;
          this.inst.navigateTo(destPath);
        };
        row.onauxclick = (e) => {
          if (e.button === 1 && this.inst.navigationManager) {
            e.preventDefault();
            this.inst.navigationManager.createTab(destPath, { activate: true });
          }
        };
        if (this.inst.dragDropManager) {
          this.inst.dragDropManager.bindDropTarget(row, destPath);
        }
      });
    }

    async toggleTreeNode(dirPath) {
      const clean = this.inst.stateManager ? this.inst.stateManager.normalizePath(dirPath) : (dirPath || '');
      if (this.expandedPaths.has(clean)) {
        this.expandedPaths.delete(clean);
        this.renderTree();
        return;
      }

      this.expandedPaths.add(clean);
      if (!this.treeCache.has(clean) && window.sys && window.sys.api) {
        try {
          const json = await window.sys.api.get('get_gallery', { dir: clean });
          if (json && json.success) {
            this.treeCache.set(clean, (json.directories || []).map(d => ({
              name: d.name,
              path: d.path,
              is_protected: !!d.is_protected
            })));
          } else {
            this.treeCache.set(clean, []);
          }
        } catch (e) {
          this.treeCache.set(clean, []);
        }
      }
      this.renderTree();
    }

    async loadOrganizationMeta() {
      const scope = this.inst.getUserStorageScope();
      if (this._orgLoadedForScope === scope) return;
      this._orgLoadedForScope = scope;

      const isLoggedIn = Boolean(
        window.IS_ADMIN ||
        (window.sys && window.sys.shares && typeof window.sys.shares.isLoggedIn === 'function' && window.sys.shares.isLoggedIn())
      );
      if (!isLoggedIn || !window.sys || !window.sys.api) {
        this.tagsList = [];
        this.trashCount = 0;
        this.renderOrganization();
        return;
      }

      try {
        const [tagsRes, trashRes] = await Promise.all([
          window.sys.api.get('list_tags').catch(() => null),
          window.sys.api.get('list_trash').catch(() => null)
        ]);
        if (tagsRes && tagsRes.success && Array.isArray(tagsRes.tags)) {
          this.tagsList = tagsRes.tags;
        }
        if (trashRes && trashRes.success && Array.isArray(trashRes.items)) {
          this.trashCount = trashRes.items.length;
        }
      } catch (e) { }

      this.renderOrganization();
    }

    renderOrganization() {
      const host = this.inst.el.sidebarOrganization;
      if (!host) return;

      const trashActive = Boolean(this.inst.state && this.inst.state.isTrashView);
      let html = `
        <button type="button" class="sidebar-nav-item ${trashActive ? 'active' : ''}" data-action="trash">
          <span class="sidebar-item-icon">🗑️</span>
          <span class="sidebar-item-label">${this.inst.escapeHtml(this.inst.t('explorer.sidebar_trash'))}</span>
          ${this.trashCount > 0 ? `<span class="sidebar-badge">${this.trashCount}</span>` : ''}
        </button>`;

      if (this.tagsList.length > 0) {
        html += `<div class="sidebar-sublabel">${this.inst.escapeHtml(this.inst.t('explorer.sidebar_tags'))}</div>`;
        this.tagsList.slice(0, 8).forEach(tag => {
          const color = tag.color || '#6366f1';
          html += `
            <button type="button" class="sidebar-nav-item" data-tag-name="${this.inst.escapeHtml(tag.name || '')}">
              <span class="sidebar-tag-dot" style="background:${this.inst.escapeHtml(color)};"></span>
              <span class="sidebar-item-label">${this.inst.escapeHtml(tag.name || '')}</span>
            </button>`;
        });
      }

      host.innerHTML = html;

      host.querySelectorAll('[data-action="trash"]').forEach(btn => {
        btn.onclick = () => {
          if (typeof this.inst.openTrashView === 'function') {
            this.inst.openTrashView();
          }
        };
      });

      host.querySelectorAll('[data-tag-name]').forEach(btn => {
        btn.onclick = () => {
          const tagName = btn.dataset.tagName || '';
          if (this.inst.el.quickSearchInput) {
            this.inst.el.quickSearchInput.value = tagName;
          }
          this.inst.state.searchQuery = tagName.toLowerCase();
          this.inst.applyFilterAndRender();
        };
      });
    }

    renderQuota() {
      const host = this.inst.el.sidebarQuota;
      if (!host) return;
      const quota = (window.sys && window.sys.shares && typeof window.sys.shares.getQuota === 'function')
        ? window.sys.shares.getQuota()
        : window.ATELIER_USER_QUOTA;

      if (!quota || !quota.quota_bytes || quota.quota_bytes <= 0) {
        host.style.display = 'none';
        host.innerHTML = '';
        return;
      }

      const used = Number(quota.used_bytes) || 0;
      const total = Number(quota.quota_bytes) || 1;
      const pct = Math.min(100, Math.round((used / total) * 100));
      const color = pct >= 90 ? '#ef4444' : (pct >= 75 ? '#f59e0b' : 'var(--accent-primary, #6366f1)');
      const fmt = (b) => this.inst.stateManager ? this.inst.stateManager.formatBytes(b) : `${b} B`;

      host.style.display = 'block';
      host.innerHTML = `
        <div class="sidebar-quota-label">
          <span>${this.inst.escapeHtml(this.inst.t('explorer.sidebar_quota'))}</span>
          <span>${pct}%</span>
        </div>
        <div class="sidebar-quota-track">
          <div class="sidebar-quota-fill" style="width:${pct}%;background:${color};"></div>
        </div>
        <div class="sidebar-quota-meta">${this.inst.escapeHtml(fmt(used))} / ${this.inst.escapeHtml(fmt(total))}</div>`;
    }

    _bindNavButtons(host) {
      host.querySelectorAll('.sidebar-nav-item').forEach(btn => {
        const navPath = btn.getAttribute('data-nav-path');
        const action = btn.dataset.action;

        if (action === 'favorites') {
          btn.onclick = () => this.inst.toggleFavoritesFilter();
          return;
        }
        if (navPath !== null) {
          btn.onclick = () => {
            if (this.inst.state.showFavoritesOnly) {
              this.inst.state.showFavoritesOnly = false;
            }
            this.inst.navigateTo(navPath);
          };
          btn.onauxclick = (e) => {
            if (e.button === 1 && this.inst.navigationManager) {
              e.preventDefault();
              this.inst.navigationManager.createTab(navPath, { activate: true });
            }
          };
          if (this.inst.dragDropManager) {
            this.inst.dragDropManager.bindDropTarget(btn, navPath);
          }
        }
      });
    }

    _bindResizer() {
      const resizer = this.inst.el.sidebarResizer;
      const sidebar = this.inst.el.sidebar;
      if (!resizer || !sidebar) return;

      let dragging = false;
      let startX = 0;
      let startW = 236;

      const onDown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startW = sidebar.getBoundingClientRect().width || 236;
        resizer.classList.add('dragging');
      };

      const onMove = (e) => {
        if (!dragging) return;
        const nextW = Math.max(170, Math.min(420, Math.round(startW + (e.clientX - startX))));
        sidebar.style.width = `${nextW}px`;
      };

      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        resizer.classList.remove('dragging');
        const w = sidebar.getBoundingClientRect().width;
        if (this.inst.stateManager && w) this.inst.stateManager.setSidebarWidth(w);
      };

      resizer.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);

      this._cleanupResizer = () => {
        resizer.removeEventListener('mousedown', onDown);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
    }

    destroy() {
      if (this._cleanupResizer) {
        this._cleanupResizer();
        this._cleanupResizer = null;
      }
    }
  }

  window.ExplorerSidebarManager = ExplorerSidebarManager;
})(window);
