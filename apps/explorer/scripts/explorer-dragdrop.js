/**
 * Atelier by GallusTech - Explorer Drag & Drop Manager (apps/explorer/scripts/explorer-dragdrop.js)
 * Single unified drag-and-drop coordinator for cross-window item moves and external OS file uploads.
 * Strictly scoped per Explorer instance with proper teardown on destroy().
 */
(function (window) {
  'use strict';

  class ExplorerDragDropManager {
    constructor(instance) {
      this.inst = instance;
      this._cleanup = null;
    }

    init() {
      if (this._cleanup) this._cleanup();
      const container = this.inst.containerEl;
      if (!container) return;

      const setOverlayVisible = (visible) => {
        if (!this.inst.el || !this.inst.el.dropZoneOverlay) return;
        this.inst.el.dropZoneOverlay.style.display = visible ? 'flex' : 'none';
        this.inst.el.dropZoneOverlay.classList.toggle('active', visible);
      };

      const onDragOver = (e) => {
        e.preventDefault();
        const hasExternalFiles = e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files');
        const hasInternalItems = !!window.ATELIER_DRAGGING_PATHS || !!this.inst.state.draggingPaths;

        if (hasInternalItems) {
          e.dataTransfer.dropEffect = 'move';
        } else if (hasExternalFiles) {
          e.dataTransfer.dropEffect = 'copy';
          setOverlayVisible(true);
        }
      };

      const onDragLeave = (e) => {
        if (e.relatedTarget === null || !container.contains(e.relatedTarget)) {
          setOverlayVisible(false);
        }
      };

      const onDrop = async (e) => {
        setOverlayVisible(false);

        // Let specific child drop targets (folder cards, breadcrumbs) handle their own drop
        if (e.target && (e.target.closest('.folder-card') || e.target.closest('.crumb-item'))) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        // 1. External files dropped from local OS
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0 && !window.ATELIER_DRAGGING_PATHS) {
          await this.handleExternalFileUpload(e.dataTransfer.files, this.inst.state.currentPath);
          return;
        }

        // 2. Internal items dropped onto instance background
        const paths = this.extractDraggedPaths(e);
        if (paths.length > 0) {
          window.ATELIER_DRAGGING_PATHS = null;
          this.inst.state.draggingPaths = null;
          await this.inst.moveItems(paths, this.inst.state.currentPath);
        }
      };

      container.addEventListener('dragover', onDragOver);
      container.addEventListener('dragleave', onDragLeave);
      container.addEventListener('drop', onDrop);

      this._cleanup = () => {
        container.removeEventListener('dragover', onDragOver);
        container.removeEventListener('dragleave', onDragLeave);
        container.removeEventListener('drop', onDrop);
        setOverlayVisible(false);
      };
    }

    extractDraggedPaths(e) {
      let paths = this.inst.state.draggingPaths || window.ATELIER_DRAGGING_PATHS;
      if (!paths && e && e.dataTransfer) {
        try {
          const raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
          if (raw) paths = JSON.parse(raw);
        } catch (err) { }
      }
      if (!paths) return [];
      return (Array.isArray(paths) ? paths : [paths]).filter(p => typeof p === 'string' && p.trim().length > 0);
    }

    clearVisualDragClasses() {
      if (this.inst.containerEl) {
        this.inst.containerEl.querySelectorAll('.is-dragging').forEach(c => c.classList.remove('is-dragging'));
        this.inst.containerEl.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
      }
      if (this.inst.manager && this.inst.manager.instances) {
        this.inst.manager.instances.forEach(inst => {
          if (inst && inst.containerEl && inst.containerEl !== this.inst.containerEl) {
            inst.containerEl.querySelectorAll('.is-dragging').forEach(c => c.classList.remove('is-dragging'));
            inst.containerEl.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
          }
        });
      }
    }

    bindDropTarget(targetEl, targetPath) {
      if (!targetEl) return;

      targetEl.ondragover = (e) => {
        e.preventDefault();
        const hasInternal = !!window.ATELIER_DRAGGING_PATHS || !!this.inst.state.draggingPaths;
        e.dataTransfer.dropEffect = hasInternal ? 'move' : 'copy';
      };

      targetEl.ondragenter = (e) => {
        e.preventDefault();
        targetEl.classList.add('drag-over');
      };

      targetEl.ondragleave = (e) => {
        if (!targetEl.contains(e.relatedTarget)) {
          targetEl.classList.remove('drag-over');
        }
      };

      targetEl.ondrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        targetEl.classList.remove('drag-over');

        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0 && !window.ATELIER_DRAGGING_PATHS) {
          await this.handleExternalFileUpload(e.dataTransfer.files, targetPath);
          return;
        }

        const paths = this.extractDraggedPaths(e);
        if (paths.length > 0) {
          window.ATELIER_DRAGGING_PATHS = null;
          this.inst.state.draggingPaths = null;
          await this.inst.moveItems(paths, targetPath);
        }
      };
    }

    bindFolderDropTarget(folderEl, folderPath) {
      this.bindDropTarget(folderEl, folderPath);
    }

    async handleExternalFileUpload(files, targetDir = null) {
      const canUpload = this.inst.state.isAdmin || (this.inst.state.userRights && this.inst.state.userRights.can_upload);
      if (!canUpload) {
        this.inst.showToast(this.inst.t('explorer.err_upload_denied'), 'error');
        return;
      }
      await this.inst.handleUploadFiles(files, targetDir !== null ? targetDir : this.inst.state.currentPath);
    }

    destroy() {
      if (this._cleanup) {
        this._cleanup();
        this._cleanup = null;
      }
    }
  }

  window.ExplorerDragDropManager = ExplorerDragDropManager;
})(window);
