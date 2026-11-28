/**
 * Atelier by GallusTech - Explorer Exhaustive Context Menu Manager
 * (apps/explorer/scripts/explorer-context-menu.js)
 * Enforces ZERO native browser context menus anywhere inside the Explorer surface,
 * providing RBAC-filtered contextual menus for files, folders, tree nodes, mounts,
 * tabs, breadcrumbs, trash items, text inputs, and folder background.
 */
(function (window) {
  'use strict';

  class ExplorerContextMenuManager {
    constructor(instance) {
      this.inst = instance;
      this._activeMenu = null;
      this._dismissHandler = null;
      this._escHandler = null;
      this._containerCtxHandler = null;
    }

    init() {
      this.destroy();
      const container = this.inst.containerEl;
      if (!container) return;

      this._containerCtxHandler = (e) => {
        // Strictly block native browser context menu everywhere inside Explorer
        e.preventDefault();
        e.stopPropagation();
        this.handleContextMenu(e);
      };
      container.addEventListener('contextmenu', this._containerCtxHandler);
    }

    close() {
      if (this._dismissHandler) {
        document.removeEventListener('click', this._dismissHandler, true);
        document.removeEventListener('contextmenu', this._dismissHandler, true);
        this._dismissHandler = null;
      }
      if (this._escHandler) {
        document.removeEventListener('keydown', this._escHandler, true);
        this._escHandler = null;
      }
      if (this._activeMenu && this._activeMenu.parentNode) {
        this._activeMenu.parentNode.removeChild(this._activeMenu);
      }
      this._activeMenu = null;
      document.querySelectorAll('.explorer-open-with-menu').forEach(m => m.remove());
    }

    handleContextMenu(e) {
      const target = e.target;
      if (!target) return;

      // 1. Text inputs / textareas -> clean WebOS text edit menu (zero native menu)
      const inputEl = target.closest('input[type="text"], input[type="search"], textarea');
      if (inputEl) {
        this.showTextInputContextMenu(inputEl, e.clientX, e.clientY);
        return;
      }

      // 2. Tab pill
      const tabEl = target.closest('.explorer-tab[data-tab-id]');
      if (tabEl) {
        this.showTabContextMenu(parseInt(tabEl.dataset.tabId, 10), tabEl.dataset.path || '', e.clientX, e.clientY);
        return;
      }

      // 3. Breadcrumb item
      const crumbEl = target.closest('.crumb-item');
      if (crumbEl) {
        const p = crumbEl.getAttribute('data-path') !== null ? crumbEl.getAttribute('data-path') : (this.inst.state.currentPath || '');
        this.showBreadcrumbContextMenu(p, e.clientX, e.clientY);
        return;
      }

      // 4. Sidebar tree node or mounted volume / quick-access folder
      const sidebarNode = target.closest('.sidebar-tree-row[data-nav-path], .sidebar-nav-item[data-nav-path]');
      if (sidebarNode) {
        this.showSidebarPathContextMenu(sidebarNode.getAttribute('data-nav-path') || '', e.clientX, e.clientY);
        return;
      }

      // 5. Trash item row
      const trashRow = target.closest('.trash-row[data-trash-id]');
      if (trashRow) {
        const trashId = trashRow.dataset.trashId;
        const nameEl = trashRow.querySelector('.trash-row-name');
        this.showTrashItemContextMenu(trashId, nameEl ? nameEl.textContent : trashId, e.clientX, e.clientY);
        return;
      }

      // 6. Primary or secondary pane File item
      const card = target.closest('[data-index]');
      if (card && this.inst.el.mediaGrid && this.inst.el.mediaGrid.contains(card)) {
        const index = parseInt(card.dataset.index, 10);
        const file = this.inst.state.filteredFiles[index];
        if (file) {
          this.showFileContextMenu(file, index, e.clientX, e.clientY);
          return;
        }
      }
      const splitFile = target.closest('.split-row-file[data-file-index]');
      if (splitFile && this.inst.splitPaneManager) {
        const idx = parseInt(splitFile.dataset.fileIndex, 10);
        const file = this.inst.splitPaneManager.files[idx];
        if (file) {
          this.showFileContextMenu(file, idx, e.clientX, e.clientY);
          return;
        }
      }

      // 7. Primary or secondary pane Folder item (cards or unified list folder rows)
      const folderCard = target.closest('.folder-card[data-path], .list-table-row-folder[data-path]');
      if (folderCard) {
        const folderPath = folderCard.dataset.path;
        const folderObj = (this.inst.state.directories || []).find(d => d.path === folderPath)
          || { path: folderPath, name: folderPath.split('/').pop() };
        this.showFolderContextMenu(folderObj, e.clientX, e.clientY);
        return;
      }
      // 7b. Table header sort menu
      const listHeader = target.closest('.list-table-header');
      if (listHeader) {
        this.showColumnSortContextMenu(e.clientX, e.clientY);
        return;
      }
      const splitFolder = target.closest('.split-row-folder[data-path]');
      if (splitFolder && this.inst.splitPaneManager) {
        const folderPath = splitFolder.dataset.path;
        const folderObj = (this.inst.splitPaneManager.directories || []).find(d => d.path === folderPath)
          || { path: folderPath, name: folderPath.split('/').pop() };
        this.showFolderContextMenu(folderObj, e.clientX, e.clientY);
        return;
      }

      // 8. Default: Folder background / workspace menu
      this.showBackgroundContextMenu(e.clientX, e.clientY);
    }

    _canWrite() {
      const r = this.inst.state.userRights || {};
      return Boolean(this.inst.state.isAdmin || r.can_move || r.can_upload || r.can_create_folder);
    }

    _mountMenu(menu, clientX, clientY) {
      menu.addEventListener('contextmenu', (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
      });
      document.body.appendChild(menu);
      this._activeMenu = menu;

      const rect = menu.getBoundingClientRect();
      const maxH = window.innerHeight - 16;
      if (rect.height > maxH) {
        menu.style.maxHeight = `${maxH}px`;
        menu.style.overflowY = 'auto';
      }
      const finalRect = menu.getBoundingClientRect();
      const left = Math.min(clientX, Math.max(8, window.innerWidth - finalRect.width - 8));
      const top = Math.min(clientY, Math.max(8, window.innerHeight - finalRect.height - 8));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;

      this._dismissHandler = (evt) => {
        if (!menu.contains(evt.target)) {
          this.close();
        }
      };
      this._escHandler = (evt) => {
        if (evt.key === 'Escape') {
          this.close();
        }
      };
      setTimeout(() => {
        if (this._dismissHandler) {
          document.addEventListener('click', this._dismissHandler, true);
          document.addEventListener('contextmenu', this._dismissHandler, true);
          document.addEventListener('keydown', this._escHandler, true);
        }
      }, 0);
    }

    _addSep(menu) {
      const sep = document.createElement('div');
      sep.className = 'explorer-open-with-sep';
      menu.appendChild(sep);
    }

    _addHeader(menu, text) {
      const hdr = document.createElement('div');
      hdr.className = 'explorer-open-with-header';
      hdr.textContent = text;
      menu.appendChild(hdr);
    }

    _addItem(menu, icon, label, onClick, opts = {}) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `explorer-open-with-item${opts.danger ? ' explorer-ctx-danger' : ''}${opts.active ? ' explorer-ctx-active' : ''}`;
      btn.innerHTML = `<span>${icon}</span><span>${this.inst.escapeHtml(label)}</span>`;
      if (opts.disabled) btn.disabled = true;
      btn.onclick = (evt) => {
        evt.stopPropagation();
        this.close();
        if (typeof onClick === 'function') onClick();
      };
      menu.appendChild(btn);
      return btn;
    }

    // -------------------------------------------------------------
    // 1. FILE CONTEXT MENU (Open, Open With + Default Star, Ops)
    // -------------------------------------------------------------
    showFileContextMenu(file, index, clientX, clientY) {
      this.close();
      const menu = document.createElement('div');
      menu.className = 'explorer-open-with-menu';

      const rights = this.inst.state.userRights || {};
      const isAdmin = !!this.inst.state.isAdmin;
      const canMove = isAdmin || !!rights.can_move;
      const canDelete = isAdmin || !!rights.can_delete;
      const canComment = isAdmin || !!rights.can_comment;
      const canDownload = isAdmin || rights.can_download_item !== false;
      const isFav = (this.inst.state.favorites || []).includes(file.path);
      const isLoggedIn = Boolean(isAdmin || (window.sys && window.sys.shares && window.sys.shares.isLoggedIn && window.sys.shares.isLoggedIn()));

      this._addItem(menu, '▶️', this.inst.t('explorer.open'), () => this.inst.openMedia(file, index));
      this._addItem(menu, '👁️', this.inst.t('explorer.ctx_quicklook'), () => {
        if (typeof this.inst.openQuickLook === 'function') {
          this.inst.openQuickLook(index);
        } else {
          this.inst.openMedia(file, index);
        }
      });
      this._addItem(menu, 'ℹ️', this.inst.t('explorer.details'), () => {
        this.inst.state.selectedPaths.clear();
        this.inst.state.selectedPaths.add(file.path);
        this.inst.updateSelectionUI();
        if (this.inst.inspectorManager && typeof this.inst.inspectorManager.openTab === 'function') {
          this.inst.inspectorManager.openTab('details');
        } else {
          this.inst.toggleInspector(true);
        }
      });
      const isExternalFile = String(file.path || '').startsWith('ext://');
      if (isLoggedIn && !isExternalFile) {
        this._addItem(menu, '🏷️', this.inst.t('explorer.ctx_tags'), () => {
          this.inst.state.selectedPaths.clear();
          this.inst.state.selectedPaths.add(file.path);
          this.inst.updateSelectionUI();
          if (this.inst.inspectorManager && typeof this.inst.inspectorManager.openTab === 'function') {
            this.inst.inspectorManager.openTab('tags');
          }
        });
      }
      if (!isExternalFile) {
        this._addItem(menu, '🕓', this.inst.t('explorer.ctx_versions'), () => {
          this.inst.state.selectedPaths.clear();
          this.inst.state.selectedPaths.add(file.path);
          this.inst.updateSelectionUI();
          if (this.inst.inspectorManager && typeof this.inst.inspectorManager.openTab === 'function') {
            this.inst.inspectorManager.openTab('versions');
          }
        });
      }

      // Compatible apps ("Ouvrir avec...") + default app star
      const appMgr = window.sys && window.sys.appManager;
      const compatibleApps = (appMgr && typeof appMgr.getAppsForFile === 'function')
        ? appMgr.getAppsForFile(file)
        : [];

      if (compatibleApps.length > 0) {
        this._addSep(menu);
        this._addHeader(menu, this.inst.t('explorer.open_with'));

        const fileExt = (file.extension || (file.name && file.name.includes('.') ? file.name.split('.').pop() : '') || '').toLowerCase();
        const currentDefaultEntry = (appMgr && typeof appMgr.getAppForFile === 'function') ? appMgr.getAppForFile(file) : null;
        const currentDefaultId = currentDefaultEntry && currentDefaultEntry.manifest ? currentDefaultEntry.manifest.id : null;

        compatibleApps.forEach((app) => {
          const isDef = (app.id === currentDefaultId);
          const row = document.createElement('div');
          row.className = 'explorer-open-with-row';
          row.style.cssText = 'display:flex;align-items:center;gap:4px;';

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'explorer-open-with-item';
          btn.style.flex = '1';
          btn.innerHTML = `<span>${app.icon || '🗔'}</span><span>${this.inst.escapeHtml(app.name)}</span>`;
          btn.onclick = () => {
            this.close();
            if (appMgr && typeof appMgr.launchApp === 'function') {
              appMgr.launchApp(app.id, { file, index });
            }
          };
          row.appendChild(btn);

          if (fileExt && appMgr && typeof appMgr.setDefaultAppForExtension === 'function') {
            const starBtn = document.createElement('button');
            starBtn.type = 'button';
            starBtn.className = 'explorer-open-with-default-btn';
            starBtn.dataset.ext = fileExt;
            starBtn.dataset.appId = app.id;
            starBtn.title = isDef
              ? this.inst.t('explorer.default_app_active', { ext: fileExt })
              : this.inst.t('explorer.set_default_app', { ext: fileExt });
            starBtn.style.cssText = `background:transparent;border:none;cursor:pointer;padding:4px 6px;font-size:0.9rem;color:${isDef ? '#f59e0b' : 'var(--text-muted, #94a3b8)'};`;
            starBtn.textContent = isDef ? '★' : '☆';
            starBtn.onclick = (evt) => {
              evt.stopPropagation();
              appMgr.setDefaultAppForExtension(fileExt, app.id);
              this.close();
              this.inst.showToast(this.inst.t('explorer.default_app_saved', { ext: fileExt, name: app.name }), 'success');
            };
            row.appendChild(starBtn);
          }

          menu.appendChild(row);
        });
      }

      this._addSep(menu);
      if (canMove) {
        this._addItem(menu, '✏️', this.inst.t('explorer.ctx_rename'), () => this.inst.renameItem(file.path, file.name));
        this._addItem(menu, '📄', this.inst.t('explorer.ctx_duplicate'), () => this.inst.duplicateItem(file.path));
      }
      this._addItem(menu, '📋', this.inst.t('explorer.ctx_copy'), () => {
        if (!this.inst.state.selectedPaths.has(file.path)) {
          this.inst.state.selectedPaths.clear();
          this.inst.state.selectedPaths.add(file.path);
          this.inst.updateSelectionUI();
        }
        this.inst.copySelection();
      });
      if (canMove) {
        this._addItem(menu, '✂️', this.inst.t('explorer.ctx_cut'), () => {
          if (!this.inst.state.selectedPaths.has(file.path)) {
            this.inst.state.selectedPaths.clear();
            this.inst.state.selectedPaths.add(file.path);
            this.inst.updateSelectionUI();
          }
          this.inst.cutSelection();
        });
      }

      this._addSep(menu);
      this._addItem(menu, isFav ? '🤍' : '❤️', isFav ? this.inst.t('explorer.ctx_favorite_remove') : this.inst.t('explorer.ctx_favorite_add'), () => {
        this.inst.toggleFavorite(file.path);
      });
      if (canComment) {
        this._addItem(menu, '💬', this.inst.t('explorer.ctx_comment'), () => this.inst.openMediaCommentModal(file.name, file.comment || ''));
      }
      if (isLoggedIn && !isExternalFile && window.sys && window.sys.shares && typeof window.sys.shares.openShareDialog === 'function') {
        this._addItem(menu, '🔗', this.inst.t('explorer.ctx_share'), () => window.sys.shares.openShareDialog(file.path, { isFile: true }));
      }
      if (canDownload) {
        this._addItem(menu, '⬇️', this.inst.t('explorer.ctx_download'), () => {
          const url = `system/endpoints/thumb.php?file=${encodeURIComponent(file.path)}&download=1`;
          const a = document.createElement('a');
          a.href = url;
          a.download = file.name || '';
          document.body.appendChild(a);
          a.click();
          a.remove();
        });
      }
      if (canDelete) {
        this._addSep(menu);
        this._addItem(menu, '🗑️', this.inst.t('explorer.ctx_delete'), () => {
          this.inst.openDeleteConfirmModal(file.path, file.name, 'file');
        }, { danger: true });
      }

      this._mountMenu(menu, clientX, clientY);
    }

    // -------------------------------------------------------------
    // 2. FOLDER CONTEXT MENU
    // -------------------------------------------------------------
    showFolderContextMenu(folder, clientX, clientY) {
      this.close();
      const menu = document.createElement('div');
      menu.className = 'explorer-open-with-menu';

      const rights = this.inst.state.userRights || {};
      const isAdmin = !!this.inst.state.isAdmin;
      const canMove = isAdmin || !!rights.can_move;
      const canDelete = isAdmin || !!rights.can_delete;
      const canArchive = isAdmin || rights.can_download_archive !== false;
      const isLoggedIn = Boolean(isAdmin || (window.sys && window.sys.shares && window.sys.shares.isLoggedIn && window.sys.shares.isLoggedIn()));

      this._addItem(menu, '📂', this.inst.t('explorer.open'), () => this.inst.navigateTo(folder.path));
      if (this.inst.navigationManager) {
        this._addItem(menu, '🗂️', this.inst.t('explorer.ctx_open_new_tab'), () => {
          this.inst.navigationManager.createTab(folder.path, { activate: true });
        });
      }
      if (this.inst.splitPaneManager) {
        this._addItem(menu, '◫', this.inst.t('explorer.ctx_open_split'), () => {
          this.inst.splitPaneManager.toggle(true);
          this.inst.splitPaneManager.loadPath(folder.path, true);
        });
      }

      this._addSep(menu);
      if (canMove) {
        this._addItem(menu, '✏️', this.inst.t('explorer.ctx_rename'), () => this.inst.renameItem(folder.path, folder.name));
      }
      this._addItem(menu, '📋', this.inst.t('explorer.ctx_copy'), () => {
        if (window.sys && window.sys.clipboard) {
          window.sys.clipboard.copyFiles([{ ...folder, is_folder: true }]);
          this.inst.showToast(this.inst.t('clipboard.items_copied', { count: 1 }), 'info');
        }
      });
      if (canMove) {
        this._addItem(menu, '✂️', this.inst.t('explorer.ctx_cut'), () => {
          if (window.sys && window.sys.clipboard) {
            window.sys.clipboard.cutFiles([{ ...folder, is_folder: true }]);
            this.inst.showToast(this.inst.t('clipboard.items_cut', { count: 1 }), 'info');
          }
        });
      }
      this._addItem(menu, '🔗', this.inst.t('explorer.ctx_copy_path'), () => this.inst.copyPathToClipboard(folder.path));

      if (isLoggedIn || canArchive || isAdmin) {
        this._addSep(menu);
      }
      const isExternalFolder = String(folder.path || '').startsWith('ext://');
      if (isLoggedIn && !isExternalFolder && window.sys && window.sys.shares && typeof window.sys.shares.openShareDialog === 'function') {
        this._addItem(menu, '🔗', this.inst.t('explorer.ctx_share'), () => window.sys.shares.openShareDialog(folder.path, { isFile: false }));
      }
      if (isLoggedIn && !isExternalFolder) {
        this._addItem(menu, '🏷️', this.inst.t('explorer.ctx_tags'), () => {
          this.inst.state.selectedPaths.clear();
          this.inst.state.selectedPaths.add(folder.path);
          this.inst.updateSelectionUI();
          if (this.inst.inspectorManager && typeof this.inst.inspectorManager.openTab === 'function') {
            this.inst.inspectorManager.openTab('tags');
          }
        });
      }
      if (canArchive) {
        this._addItem(menu, '📦', this.inst.t('explorer.ctx_download_zip'), () => {
          const a = document.createElement('a');
          a.href = `system/endpoints/archive.php?dir=${encodeURIComponent(folder.path)}&format=zip`;
          a.download = '';
          document.body.appendChild(a);
          a.click();
          a.remove();
        });
      }
      if (isAdmin) {
        this._addItem(menu, '⚙️', this.inst.t('explorer.ctx_folder_settings'), () => this.inst.openFolderSettingsModal(folder.path));
      }
      if (canDelete) {
        this._addSep(menu);
        this._addItem(menu, '🗑️', this.inst.t('explorer.ctx_delete'), () => {
          this.inst.openDeleteConfirmModal(folder.path, folder.name, 'folder');
        }, { danger: true });
      }

      this._mountMenu(menu, clientX, clientY);
    }

    // -------------------------------------------------------------
    // 3. SIDEBAR TREE NODE / MOUNT POINT CONTEXT MENU
    // -------------------------------------------------------------
    showSidebarPathContextMenu(dirPath, clientX, clientY) {
      this.close();
      const menu = document.createElement('div');
      menu.className = 'explorer-open-with-menu';

      this._addItem(menu, '📂', this.inst.t('explorer.open'), () => this.inst.navigateTo(dirPath));
      if (this.inst.navigationManager) {
        this._addItem(menu, '🗂️', this.inst.t('explorer.ctx_open_new_tab'), () => {
          this.inst.navigationManager.createTab(dirPath, { activate: true });
        });
      }
      if (this.inst.splitPaneManager) {
        this._addItem(menu, '◫', this.inst.t('explorer.ctx_open_split'), () => {
          this.inst.splitPaneManager.toggle(true);
          this.inst.splitPaneManager.loadPath(dirPath, true);
        });
      }
      this._addSep(menu);
      this._addItem(menu, '📋', this.inst.t('explorer.ctx_copy_path'), () => this.inst.copyPathToClipboard(dirPath || '/'));
      const isLoggedInSidebar = Boolean(this.inst.state.isAdmin || (window.sys && window.sys.shares && window.sys.shares.isLoggedIn && window.sys.shares.isLoggedIn()));
      if (dirPath && !String(dirPath).startsWith('ext://') && isLoggedInSidebar && window.sys && window.sys.shares && typeof window.sys.shares.openShareDialog === 'function') {
        this._addItem(menu, '🔗', this.inst.t('explorer.ctx_share'), () => window.sys.shares.openShareDialog(dirPath, { isFile: false }));
      }
      if (this.inst.state.isAdmin) {
        this._addItem(menu, '⚙️', this.inst.t('explorer.ctx_folder_settings'), () => this.inst.openFolderSettingsModal(dirPath));
      }
      this._addItem(menu, '↻', this.inst.t('explorer.ctx_refresh'), () => {
        if (this.inst.sidebarManager) {
          this.inst.sidebarManager.invalidateTreeCache();
          this.inst.sidebarManager.renderAll();
        }
      });

      this._mountMenu(menu, clientX, clientY);
    }

    // -------------------------------------------------------------
    // 4. TAB CONTEXT MENU
    // -------------------------------------------------------------
    showTabContextMenu(tabId, tabPath, clientX, clientY) {
      this.close();
      const nav = this.inst.navigationManager;
      if (!nav) return;

      const menu = document.createElement('div');
      menu.className = 'explorer-open-with-menu';

      this._addItem(menu, '🗂️', this.inst.t('explorer.ctx_tab_duplicate'), () => nav.createTab(tabPath, { activate: true }));
      if (this.inst.splitPaneManager) {
        this._addItem(menu, '◫', this.inst.t('explorer.ctx_open_split'), () => {
          this.inst.splitPaneManager.toggle(true);
          this.inst.splitPaneManager.loadPath(tabPath, true);
        });
      }
      if (nav.tabs.length > 1) {
        this._addSep(menu);
        this._addItem(menu, '✕', this.inst.t('explorer.tab_close'), () => nav.closeTab(tabId));
        this._addItem(menu, '⊘', this.inst.t('explorer.ctx_tab_close_others'), () => {
          const others = nav.tabs.filter(t => t.id !== tabId).map(t => t.id);
          nav.switchTab(tabId);
          others.forEach(id => nav.closeTab(id));
        });
      }

      this._mountMenu(menu, clientX, clientY);
    }

    // -------------------------------------------------------------
    // 5. BREADCRUMB CONTEXT MENU
    // -------------------------------------------------------------
    showBreadcrumbContextMenu(path, clientX, clientY) {
      this.close();
      const menu = document.createElement('div');
      menu.className = 'explorer-open-with-menu';

      this._addItem(menu, '📂', this.inst.t('explorer.open'), () => this.inst.navigateTo(path));
      if (this.inst.navigationManager) {
        this._addItem(menu, '🗂️', this.inst.t('explorer.ctx_open_new_tab'), () => {
          this.inst.navigationManager.createTab(path, { activate: true });
        });
        this._addItem(menu, '✎', this.inst.t('explorer.nav_edit_path'), () => {
          this.inst.navigationManager.enterAddressEditMode();
        });
      }
      this._addSep(menu);
      this._addItem(menu, '📋', this.inst.t('explorer.ctx_copy_path'), () => this.inst.copyPathToClipboard(path || '/'));

      this._mountMenu(menu, clientX, clientY);
    }

    // -------------------------------------------------------------
    // 6. TRASH ITEM CONTEXT MENU
    // -------------------------------------------------------------
    showTrashItemContextMenu(trashId, name, clientX, clientY) {
      this.close();
      const menu = document.createElement('div');
      menu.className = 'explorer-open-with-menu';

      this._addItem(menu, '↩️', this.inst.t('explorer.trash_restore'), async () => {
        const res = await window.sys.api.post('restore_trash_item', { trash_id: trashId });
        if (res && res.success) {
          this.inst.showToast(this.inst.t('explorer.trash_restored_ok'), 'success');
          if (window.EventBus) window.EventBus.emit('fs:changed', { action: 'restore_trash' });
          await this.inst.openTrashView();
        }
      });
      this._addItem(menu, '✕', this.inst.t('explorer.trash_purge'), async () => {
        const msg = this.inst.t('explorer.trash_confirm_purge', { name });
        const ok = (window.sys && window.sys.dialog && typeof window.sys.dialog.confirm === 'function')
          ? await window.sys.dialog.confirm(msg, this.inst.t('explorer.trash_title'), true)
          : true;
        if (!ok) return;
        const res = await window.sys.api.post('purge_trash_item', { trash_id: trashId });
        if (res && res.success) {
          this.inst.showToast(this.inst.t('explorer.trash_purged_ok'), 'info');
          await this.inst.openTrashView();
        }
      }, { danger: true });

      this._mountMenu(menu, clientX, clientY);
    }

    // -------------------------------------------------------------
    // 7. TEXT INPUT CONTEXT MENU (Zero Native Browser Menu)
    // -------------------------------------------------------------
    showTextInputContextMenu(inputEl, clientX, clientY) {
      this.close();
      const menu = document.createElement('div');
      menu.className = 'explorer-open-with-menu';

      const selectedText = () => {
        const start = inputEl.selectionStart || 0;
        const end = inputEl.selectionEnd || 0;
        return inputEl.value.slice(start, end);
      };

      this._addItem(menu, '✂️', this.inst.t('explorer.ctx_cut'), async () => {
        const txt = selectedText();
        if (!txt) return;
        try { if (navigator.clipboard) await navigator.clipboard.writeText(txt); } catch (e) { }
        const start = inputEl.selectionStart || 0;
        const end = inputEl.selectionEnd || 0;
        inputEl.value = inputEl.value.slice(0, start) + inputEl.value.slice(end);
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      });
      this._addItem(menu, '📋', this.inst.t('explorer.ctx_copy'), async () => {
        const txt = selectedText() || inputEl.value;
        if (!txt) return;
        try { if (navigator.clipboard) await navigator.clipboard.writeText(txt); } catch (e) { }
      });
      this._addItem(menu, '📥', this.inst.t('explorer.ctx_paste'), async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            const clip = await navigator.clipboard.readText();
            const start = inputEl.selectionStart || 0;
            const end = inputEl.selectionEnd || 0;
            inputEl.value = inputEl.value.slice(0, start) + clip + inputEl.value.slice(end);
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } catch (e) { }
      });
      this._addSep(menu);
      this._addItem(menu, '☑️', this.inst.t('explorer.ctx_select_all'), () => {
        inputEl.focus();
        inputEl.select();
      });

      this._mountMenu(menu, clientX, clientY);
    }

    // -------------------------------------------------------------
    // 8. BACKGROUND / EMPTY SPACE CONTEXT MENU
    // -------------------------------------------------------------
    showBackgroundContextMenu(clientX, clientY) {
      this.close();
      const menu = document.createElement('div');
      menu.className = 'explorer-open-with-menu';

      const rights = this.inst.state.userRights || {};
      const isAdmin = !!this.inst.state.isAdmin;
      const canCreate = isAdmin || !!rights.can_create_folder;
      const canUpload = isAdmin || !!rights.can_upload;
      const hasClipboard = Boolean(window.sys && window.sys.clipboard && window.sys.clipboard.hasData && window.sys.clipboard.hasData());

      if (canCreate) {
        this._addItem(menu, '📁', this.inst.t('explorer.nav_new_folder'), () => this.inst.openCreateFolderModal());
      }
      if (canUpload) {
        this._addItem(menu, '📄', this.inst.t('explorer.nav_new_file'), () => this.inst.createNewFile());
        this._addItem(menu, '📤', this.inst.t('explorer.nav_upload'), () => {
          if (this.inst.el.navUploadInput) this.inst.el.navUploadInput.click();
        });
      }
      if (hasClipboard && (isAdmin || rights.can_move || rights.can_upload)) {
        this._addItem(menu, '📋', this.inst.t('explorer.ctx_paste'), () => this.inst.pasteClipboard());
      }

      if (canCreate || canUpload || hasClipboard) this._addSep(menu);

      // View Mode Switcher
      this._addHeader(menu, this.inst.t('explorer.ctx_view_mode'));
      const curView = this.inst.state.viewMode || 'list';
      this._addItem(menu, '☰', `${this.inst.t('explorer.profile_pro')} (${this.inst.t('view.list')})`, () => this.inst.setViewMode('list'), { active: curView === 'list' });
      this._addItem(menu, '▦', `${this.inst.t('explorer.profile_thumbs')} (${this.inst.t('view.grid')})`, () => this.inst.setViewMode('grid'), { active: curView === 'grid' });
      this._addItem(menu, '☷', this.inst.t('view.mosaic'), () => this.inst.setViewMode('mosaic'), { active: curView === 'mosaic' });
      this._addItem(menu, '🖼️', `${this.inst.t('explorer.profile_multimedia')} (${this.inst.t('view.polaroid')})`, () => this.inst.setViewMode('polaroid'), { active: curView === 'polaroid' });

      if (this.inst.state.viewResolution && this.inst.state.viewResolution.isExplicit && (this.inst.state.currentPath || '') !== '') {
        this._addItem(menu, '↺', this.inst.t('explorer.view_reset_inherit'), () => this.inst.resetCurrentFolderViewMode());
      }

      this._addSep(menu);
      this._addItem(menu, '☑️', this.inst.t('explorer.ctx_select_all'), () => this.inst.selectAll());
      const curBgPath = this.inst.state.currentPath || '';
      const isLoggedInBg = Boolean(isAdmin || (window.sys && window.sys.shares && window.sys.shares.isLoggedIn && window.sys.shares.isLoggedIn()));
      if (curBgPath && !curBgPath.startsWith('ext://') && isLoggedInBg && window.sys && window.sys.shares && typeof window.sys.shares.openShareDialog === 'function') {
        this._addItem(menu, '🔗', this.inst.t('explorer.ctx_share'), () => window.sys.shares.openShareDialog(curBgPath, { isFile: false }));
      }
      if (isAdmin) {
        this._addItem(menu, '⚙️', this.inst.t('explorer.ctx_folder_settings'), () => this.inst.openFolderSettingsModal());
      }
      if (isAdmin || rights.can_edit) {
        this._addItem(menu, '🎬', this.inst.t('explorer.ctx_autorun'), () => this.inst.openAutorunEditorModal());
      }
      this._addItem(menu, '↻', this.inst.t('explorer.ctx_refresh'), () => {
        if (this.inst.navigationManager) this.inst.navigationManager.refresh();
        else this.inst.loadDirectory(this.inst.state.currentPath || '');
      });

      this._mountMenu(menu, clientX, clientY);
    }

    // -------------------------------------------------------------
    // 8b. LIST COLUMN HEADER SORT CONTEXT MENU
    // -------------------------------------------------------------
    showColumnSortContextMenu(clientX, clientY) {
      this.close();
      const menu = document.createElement('div');
      menu.className = 'explorer-open-with-menu';
      const curSort = this.inst.state.sortBy || 'name';
      const curOrder = this.inst.state.sortOrder || 'asc';
      const pick = (col) => {
        const nextOrder = (curSort === col && curOrder === 'asc') ? 'desc' : 'asc';
        this.inst.setSort(col, nextOrder);
      };

      this._addHeader(menu, this.inst.t('sort.title'));
      this._addItem(menu, '🔤', this.inst.t('explorer.list_name'), () => pick('name'), { active: curSort === 'name' });
      this._addItem(menu, '🏷️', this.inst.t('explorer.list_type'), () => pick('category'), { active: curSort === 'category' });
      this._addItem(menu, '📏', this.inst.t('explorer.list_size'), () => pick('size'), { active: curSort === 'size' });
      this._addItem(menu, '📅', this.inst.t('explorer.list_date'), () => pick('date'), { active: curSort === 'date' || curSort === 'mtime' || curSort === 'exif_date' });
      this._mountMenu(menu, clientX, clientY);
    }

    destroy() {
      this.close();
      if (this._containerCtxHandler && this.inst.containerEl) {
        this.inst.containerEl.removeEventListener('contextmenu', this._containerCtxHandler);
        this._containerCtxHandler = null;
      }
    }
  }

  window.ExplorerContextMenuManager = ExplorerContextMenuManager;
})(window);
