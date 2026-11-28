/**
 * Atelier by GallusTech - Explorer Selection & Marquee Manager (apps/explorer/scripts/explorer-selection.js)
 * Handles item selection (single, Ctrl-toggle, Shift-range), scoped UI updates,
 * and instance-isolated rubber-band marquee selection with full cleanup on destroy().
 */
(function (window) {
  'use strict';

  class ExplorerSelectionManager {
    constructor(instance) {
      this.inst = instance;
      this._marqueeEl = null;
      this._cleanupMarquee = null;
    }

    clearSelection() {
      this.inst.state.selectedPaths.clear();
      this.inst.state.lastSelectedIndex = null;
      this.updateSelectionUI();
    }

    selectAll() {
      this.inst.state.selectedPaths.clear();
      (this.inst.state.filteredFiles || []).forEach(f => this.inst.state.selectedPaths.add(f.path));
      this.updateSelectionUI();
    }

    selectItem(index, e = null) {
      const file = this.inst.state.filteredFiles[index];
      if (!file) return;

      const isMulti = e && (e.ctrlKey || e.metaKey);
      const isRange = e && e.shiftKey;

      if (isRange) {
        const start = this.inst.state.lastSelectedIndex !== null ? Math.min(this.inst.state.lastSelectedIndex, index) : 0;
        const end = this.inst.state.lastSelectedIndex !== null ? Math.max(this.inst.state.lastSelectedIndex, index) : index;
        for (let i = start; i <= end; i++) {
          const item = this.inst.state.filteredFiles[i];
          if (item) this.inst.state.selectedPaths.add(item.path);
        }
        this.inst.state.lastSelectedIndex = index;
      } else if (isMulti) {
        if (this.inst.state.selectedPaths.has(file.path)) {
          this.inst.state.selectedPaths.delete(file.path);
        } else {
          this.inst.state.selectedPaths.add(file.path);
        }
        this.inst.state.lastSelectedIndex = index;
      } else {
        this.inst.state.selectedPaths.clear();
        this.inst.state.selectedPaths.add(file.path);
        this.inst.state.lastSelectedIndex = index;
      }

      this.updateSelectionUI();
    }

    updateSelectionUI() {
      const count = this.inst.state.selectedPaths.size;
      const el = this.inst.el;

      if (el.selectionToolbar) {
        el.selectionToolbar.style.display = count > 0 ? 'flex' : 'none';
      }
      if (el.selectionToolbarCount) {
        el.selectionToolbarCount.dataset.i18n = 'selection.selected_count';
        el.selectionToolbarCount.dataset.i18nCount = String(count);
        el.selectionToolbarCount.textContent = this.inst.t('selection.selected_count', { count });
      }
      if (el.mediaGrid) {
        el.mediaGrid.querySelectorAll('[data-index]').forEach(card => {
          const idx = parseInt(card.dataset.index, 10);
          const file = this.inst.state.filteredFiles[idx];
          if (file) {
            card.classList.toggle('selected', this.inst.state.selectedPaths.has(file.path));
          }
        });
      }

      this.inst.updateInspectorUI();
    }

    initMarqueeSelection() {
      if (this._cleanupMarquee) {
        this._cleanupMarquee();
      }

      const el = this.inst.el;
      const container = this.inst.containerEl;
      if (!container) return;

      if (el.selectionSelectAllBtn) {
        el.selectionSelectAllBtn.onclick = () => this.selectAll();
      }
      if (el.selectionClearBtn) {
        el.selectionClearBtn.onclick = () => this.clearSelection();
      }
      if (el.selectionInfoBtn) {
        el.selectionInfoBtn.onclick = () => {
          if (this.inst.state.selectedPaths.size > 0) {
            const firstPath = Array.from(this.inst.state.selectedPaths)[0];
            const file = this.inst.state.filteredFiles.find(f => f.path === firstPath);
            if (file && window.sys && window.sys.showMetadata) {
              window.sys.showMetadata(file);
            }
          }
        };
      }

      let isSelecting = false;
      let startX = 0;
      let startY = 0;
      let initialSelectedPaths = new Set();

      const onMouseDown = (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, input, a, select, .explorer-header-bar, .admin-modal, .selection-toolbar, .folder-card, .polaroid-card, .grid-card, .list-table-row, .mosaic-card, [data-index], .media-card, .sidebar, .explorer-inspector-drawer, .menubar')) {
          return;
        }
        if (!this.inst.el.mediaGrid) return;

        const hasModifier = e.shiftKey || e.ctrlKey || e.metaKey;
        if (!hasModifier) {
          this.clearSelection();
          initialSelectedPaths = new Set();
        } else {
          initialSelectedPaths = new Set(this.inst.state.selectedPaths);
        }

        isSelecting = true;
        startX = e.pageX;
        startY = e.pageY;

        if (!this._marqueeEl) {
          this._marqueeEl = document.createElement('div');
          this._marqueeEl.className = 'selection-marquee';
          this._marqueeEl.style.display = 'none';
          document.body.appendChild(this._marqueeEl);
        }
      };

      const onDocDragStart = () => {
        isSelecting = false;
        if (this._marqueeEl) this._marqueeEl.style.display = 'none';
      };

      const onDocMouseMove = (e) => {
        if (!isSelecting || !this._marqueeEl || !this.inst.el.mediaGrid) return;

        const currentX = e.pageX;
        const currentY = e.pageY;
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);

        if (width > 6 || height > 6) {
          this._marqueeEl.style.display = 'block';
          this._marqueeEl.style.left = `${Math.min(startX, currentX)}px`;
          this._marqueeEl.style.top = `${Math.min(startY, currentY)}px`;
          this._marqueeEl.style.width = `${width}px`;
          this._marqueeEl.style.height = `${height}px`;

          const marqueeRect = this._marqueeEl.getBoundingClientRect();
          const currentSelection = new Set(initialSelectedPaths);

          this.inst.el.mediaGrid.querySelectorAll('[data-index]').forEach(card => {
            const cardRect = card.getBoundingClientRect();
            const intersects = !(
              marqueeRect.right < cardRect.left ||
              marqueeRect.left > cardRect.right ||
              marqueeRect.bottom < cardRect.top ||
              marqueeRect.top > cardRect.bottom
            );

            const idx = parseInt(card.dataset.index, 10);
            const file = this.inst.state.filteredFiles[idx];
            if (file && intersects) {
              currentSelection.add(file.path);
            }
          });

          this.inst.state.selectedPaths = currentSelection;
          this.updateSelectionUI();
        }
      };

      const onDocMouseUp = () => {
        if (isSelecting) {
          isSelecting = false;
          if (this._marqueeEl) this._marqueeEl.style.display = 'none';
        }
      };

      container.addEventListener('mousedown', onMouseDown);
      document.addEventListener('dragstart', onDocDragStart);
      document.addEventListener('mousemove', onDocMouseMove);
      document.addEventListener('mouseup', onDocMouseUp);

      this._cleanupMarquee = () => {
        container.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('dragstart', onDocDragStart);
        document.removeEventListener('mousemove', onDocMouseMove);
        document.removeEventListener('mouseup', onDocMouseUp);
        if (this._marqueeEl && this._marqueeEl.parentNode) {
          this._marqueeEl.parentNode.removeChild(this._marqueeEl);
        }
        this._marqueeEl = null;
      };
    }

    destroy() {
      if (this._cleanupMarquee) {
        this._cleanupMarquee();
        this._cleanupMarquee = null;
      }
    }
  }

  window.ExplorerSelectionManager = ExplorerSelectionManager;
})(window);
