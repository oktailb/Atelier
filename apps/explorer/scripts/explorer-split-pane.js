/**
 * Atelier by GallusTech - Explorer Dual Pane / Commander Manager (apps/explorer/scripts/explorer-split-pane.js)
 * Toggles an independent secondary file pane (F3) supporting folders-first listing,
 * navigation history, pane swap/sync, and full bidirectional Drag & Drop with the primary pane.
 */
(function (window) {
  'use strict';

  class ExplorerSplitPaneManager {
    constructor(instance) {
      this.inst = instance;
      this.open = false;
      this.currentPath = '';
      this.history = [''];
      this.historyIndex = 0;
      this.directories = [];
      this.files = [];
    }

    isOpen() {
      return this.open;
    }

    toggle(forceState) {
      const next = (forceState !== undefined) ? Boolean(forceState) : !this.open;
      this.open = next;
      const pane = this.inst.el.secondaryPane;
      if (pane) {
        pane.style.display = this.open ? 'flex' : 'none';
      }
      if (this.inst.el.splitToggleBtn) {
        this.inst.el.splitToggleBtn.classList.toggle('active', this.open);
      }
      if (this.open) {
        const initPath = this.currentPath || this.inst.state.currentPath || '';
        this.bindEvents();
        this.loadPath(initPath, true);
      }
    }

    bindEvents() {
      const pane = this.inst.el.secondaryPane;
      if (!pane || pane._splitBound) return;
      pane._splitBound = true;

      const backBtn = pane.querySelector('.split-back-btn');
      const upBtn = pane.querySelector('.split-up-btn');
      const refreshBtn = pane.querySelector('.split-refresh-btn');
      const swapBtn = pane.querySelector('.split-swap-btn');
      const syncBtn = pane.querySelector('.split-sync-btn');
      const closeBtn = pane.querySelector('.split-close-btn');

      if (backBtn) backBtn.onclick = () => this.goBack();
      if (upBtn) upBtn.onclick = () => this.goUp();
      if (refreshBtn) refreshBtn.onclick = () => this.loadPath(this.currentPath, false);
      if (swapBtn) swapBtn.onclick = () => this.swapWithPrimary();
      if (syncBtn) syncBtn.onclick = () => this.syncFromPrimary();
      if (closeBtn) closeBtn.onclick = () => this.toggle(false);

      // Pane background drop target (moves dragged items from primary pane or uploads OS files)
      const listArea = pane.querySelector('.split-pane-list');
      if (listArea) {
        listArea.addEventListener('dragover', (e) => {
          e.preventDefault();
          const hasInternal = !!window.ATELIER_DRAGGING_PATHS || !!this.inst.state.draggingPaths;
          e.dataTransfer.dropEffect = hasInternal ? 'move' : 'copy';
          listArea.classList.add('drag-over');
        });
        listArea.addEventListener('dragleave', (e) => {
          if (!listArea.contains(e.relatedTarget)) listArea.classList.remove('drag-over');
        });
        listArea.addEventListener('drop', async (e) => {
          listArea.classList.remove('drag-over');
          if (e.target && e.target.closest('.split-row-folder')) return;
          e.preventDefault();
          e.stopPropagation();

          if (e.dataTransfer && !window.ATELIER_DRAGGING_PATHS && ((e.dataTransfer.items && e.dataTransfer.items.length > 0 && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) || (e.dataTransfer.files && e.dataTransfer.files.length > 0))) {
            if (this.inst.dragDropManager && typeof this.inst.dragDropManager.handleExternalDrop === 'function') {
              await this.inst.dragDropManager.handleExternalDrop(e.dataTransfer, this.currentPath);
            } else {
              await this.inst.handleUploadFiles(e.dataTransfer.files, this.currentPath);
            }
            return;
          }
          const paths = this.inst.dragDropManager ? this.inst.dragDropManager.extractDraggedPaths(e) : [];
          if (paths.length > 0) {
            window.ATELIER_DRAGGING_PATHS = null;
            this.inst.state.draggingPaths = null;
            await this.inst.moveItems(paths, this.currentPath);
          }
        });
      }
    }

    async loadPath(dirPath, pushHistory = true) {
      if (!this.open) return;
      const clean = this.inst.stateManager ? this.inst.stateManager.normalizePath(dirPath) : (dirPath || '');
      this.currentPath = clean;

      if (pushHistory && this.history[this.historyIndex] !== clean) {
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(clean);
        this.historyIndex = this.history.length - 1;
      }

      const pane = this.inst.el.secondaryPane;
      const pathLabel = pane && pane.querySelector('.split-path-label');
      if (pathLabel) {
        const displayPath = this.inst.stateManager
          ? this.inst.stateManager.getFriendlyFullPath(clean)
          : (clean || this.inst.t('nav.root'));
        pathLabel.textContent = displayPath;
        pathLabel.title = clean ? `${displayPath} (${clean})` : displayPath;
      }
      const backBtn = pane && pane.querySelector('.split-back-btn');
      const upBtn = pane && pane.querySelector('.split-up-btn');
      if (backBtn) backBtn.disabled = this.historyIndex <= 0;
      if (upBtn) upBtn.disabled = clean === '';

      try {
        const json = await window.sys.api.get('get_gallery', { dir: clean, _t: Date.now() });
        if (!json || !json.success) {
          this.directories = [];
          this.files = [];
          this.renderList((json && json.error) || this.inst.t('explorer.err_access_denied'));
          return;
        }
        const norm = (u) => this.inst.stateManager ? this.inst.stateManager.normalizeThumbUrl(u) : u;
        this.directories = (json.directories || []).map(d => ({ ...d, cover: norm(d.cover) }));
        this.files = (json.files || []).map(f => ({ ...f, thumb_url: norm(f.thumb_url), file_url: norm(f.file_url) }));
        this.renderList();
      } catch (e) {
        this.renderList(e.message);
      }
    }

    renderList(errorMsg = null) {
      const pane = this.inst.el.secondaryPane;
      const listEl = pane && pane.querySelector('.split-pane-list');
      if (!listEl) return;

      if (errorMsg) {
        listEl.innerHTML = `<div class="split-pane-empty">🔒 ${this.inst.escapeHtml(errorMsg)}</div>`;
        return;
      }

      if (this.directories.length === 0 && this.files.length === 0) {
        listEl.innerHTML = `<div class="split-pane-empty">📂 ${this.inst.escapeHtml(this.inst.t('stats.empty'))}</div>`;
        return;
      }

      const canMove = this.inst.state.isAdmin || (this.inst.state.userRights && this.inst.state.userRights.can_move);

      // Folders first (Commander style), then files
      const folderRows = this.directories.map(d => `
        <div class="split-row split-row-folder" data-path="${this.inst.escapeHtml(d.path)}" draggable="${canMove ? 'true' : 'false'}">
          <span class="split-row-icon">${d.is_protected ? '🔒' : '📁'}</span>
          <span class="split-row-name">${this.inst.escapeHtml(d.name)}</span>
          <span class="split-row-meta">${this.inst.escapeHtml(this.inst.t('folder.items_count', { count: d.item_count }))}</span>
        </div>`).join('');

      const fileRows = this.files.map((f, idx) => {
        const icon = window.IconHelper ? window.IconHelper.getFileIcon(f) : '📄';
        return `
          <div class="split-row split-row-file" data-file-index="${idx}" data-path="${this.inst.escapeHtml(f.path)}" draggable="${canMove ? 'true' : 'false'}">
            <span class="split-row-icon">${icon}</span>
            <span class="split-row-name">${this.inst.escapeHtml(f.name)}</span>
            <span class="split-row-meta">${this.inst.escapeHtml(f.size_formatted || '')}</span>
          </div>`;
      }).join('');

      listEl.innerHTML = folderRows + fileRows;

      listEl.querySelectorAll('.split-row-folder').forEach(row => {
        const path = row.dataset.path;
        row.onclick = () => this.loadPath(path, true);
        if (this.inst.dragDropManager) {
          this.inst.dragDropManager.bindDropTarget(row, path);
        }
        row.ondragstart = (e) => {
          window.ATELIER_DRAGGING_PATHS = [path];
          this.inst.state.draggingPaths = [path];
          e.dataTransfer.setData('application/json', JSON.stringify([path]));
          e.dataTransfer.setData('text/plain', JSON.stringify([path]));
          e.dataTransfer.effectAllowed = 'copyMove';
          row.classList.add('is-dragging');
        };
        row.ondragend = () => {
          row.classList.remove('is-dragging');
          setTimeout(() => { window.ATELIER_DRAGGING_PATHS = null; }, 250);
        };
      });

      listEl.querySelectorAll('.split-row-file').forEach(row => {
        const idx = parseInt(row.dataset.fileIndex, 10);
        const file = this.files[idx];
        if (!file) return;
        row.ondblclick = () => this.inst.openMedia(file, idx);
        row.ondragstart = (e) => {
          window.ATELIER_DRAGGING_PATHS = [file.path];
          this.inst.state.draggingPaths = [file.path];
          e.dataTransfer.setData('application/json', JSON.stringify([file.path]));
          e.dataTransfer.setData('text/plain', JSON.stringify([file.path]));
          e.dataTransfer.effectAllowed = 'copyMove';
          row.classList.add('is-dragging');
        };
        row.ondragend = () => {
          row.classList.remove('is-dragging');
          setTimeout(() => { window.ATELIER_DRAGGING_PATHS = null; }, 250);
        };
      });
    }

    goBack() {
      if (this.historyIndex <= 0) return;
      this.historyIndex--;
      this.loadPath(this.history[this.historyIndex], false);
    }

    goUp() {
      const parent = this.inst.stateManager ? this.inst.stateManager.getParentPath(this.currentPath) : '';
      if (parent === null) return;
      this.loadPath(parent, true);
    }

    swapWithPrimary() {
      const primaryPath = this.inst.state.currentPath || '';
      const secondaryPath = this.currentPath || '';
      this.inst.navigateTo(secondaryPath);
      this.loadPath(primaryPath, true);
    }

    syncFromPrimary() {
      this.loadPath(this.inst.state.currentPath || '', true);
    }

    refreshIfOpen() {
      if (this.open) {
        this.loadPath(this.currentPath, false);
      }
    }
  }

  window.ExplorerSplitPaneManager = ExplorerSplitPaneManager;
})(window);
