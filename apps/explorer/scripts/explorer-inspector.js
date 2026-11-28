/**
 * Atelier by GallusTech - Explorer Inspector Drawer Manager (apps/explorer/scripts/explorer-inspector.js)
 * Manages the instance-scoped side inspector drawer (preview, EXIF/GPS metadata, Open With actions).
 */
(function (window) {
  'use strict';

  class ExplorerInspectorManager {
    constructor(instance) {
      this.inst = instance;
    }

    toggleInspector(forceState) {
      const el = this.inst.el;
      if (!el.inspectorDrawer) return;
      const isVisible = (el.inspectorDrawer.style.display !== 'none');
      const newState = (forceState !== undefined) ? forceState : !isVisible;
      el.inspectorDrawer.style.display = newState ? 'flex' : 'none';
      if (el.inspectorToggleBtn) {
        el.inspectorToggleBtn.classList.toggle('active', newState);
      }
      if (newState) {
        this.updateInspectorUI();
      }
    }

    updateInspectorUI() {
      const el = this.inst.el;
      if (!el.inspectorDrawer || el.inspectorDrawer.style.display === 'none') return;

      const selected = Array.from(this.inst.state.selectedPaths || []);
      if (selected.length === 0) {
        if (el.inspectorEmptyState) el.inspectorEmptyState.style.display = 'block';
        if (el.inspectorDetails) el.inspectorDetails.style.display = 'none';
        return;
      }

      const firstPath = selected[0];
      const file = (this.inst.state.files || []).find(f => f.path === firstPath);
      if (!file) {
        if (el.inspectorEmptyState) el.inspectorEmptyState.style.display = 'block';
        if (el.inspectorDetails) el.inspectorDetails.style.display = 'none';
        return;
      }

      if (el.inspectorEmptyState) el.inspectorEmptyState.style.display = 'none';
      if (el.inspectorDetails) el.inspectorDetails.style.display = 'block';

      if (el.inspectorFilenameBadge) el.inspectorFilenameBadge.textContent = file.name;
      if (el.inspectorMetaName) el.inspectorMetaName.textContent = file.name;
      if (el.inspectorMetaSize) {
        el.inspectorMetaSize.textContent = file.size_formatted || this.inst.t('explorer.bytes_unit', { size: file.size || 0 });
      }
      if (el.inspectorMetaDim) el.inspectorMetaDim.textContent = file.dimensions || '-';
      if (el.inspectorMetaDate) {
        const d = new Date((file.effective_mtime || file.mtime || Date.now() / 1000) * 1000);
        el.inspectorMetaDate.textContent = d.toLocaleString();
      }
      if (el.inspectorMetaComment) el.inspectorMetaComment.textContent = file.comment || '-';
      if (el.inspectorMetaCamera) {
        const exif = file.exif || {};
        const cam = [exif.make, exif.model].filter(Boolean).join(' ');
        el.inspectorMetaCamera.textContent = cam || '-';
      }
      if (el.inspectorMetaGps) {
        const gps = (file.exif && file.exif.gps)
          ? `${file.exif.gps.lat.toFixed(4)}, ${file.exif.gps.lng.toFixed(4)}`
          : '-';
        el.inspectorMetaGps.textContent = gps;
      }

      // Preview rendering
      if (el.inspectorPreviewImg && el.inspectorPreviewIcon) {
        if (file.category === 'image' || file.thumb_url) {
          el.inspectorPreviewImg.src = file.thumb_url || file.file_url;
          el.inspectorPreviewImg.style.display = 'block';
          el.inspectorPreviewIcon.style.display = 'none';
        } else {
          el.inspectorPreviewImg.style.display = 'none';
          el.inspectorPreviewIcon.style.display = 'block';
          el.inspectorPreviewIcon.textContent = window.IconHelper ? window.IconHelper.getFileIcon(file) : '📄';
        }
      }

      // Open-with compatible apps (native + standalone third-party web apps)
      if (el.inspectorOpenWithSection && el.inspectorOpenWithList) {
        const appMgr = window.sys && window.sys.appManager;
        const compatibleApps = (appMgr && typeof appMgr.getAppsForFile === 'function')
          ? appMgr.getAppsForFile(file)
          : [];

        if (compatibleApps.length > 0) {
          el.inspectorOpenWithSection.style.display = 'block';
          el.inspectorOpenWithList.innerHTML = '';
          compatibleApps.forEach((app) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'inspector-open-with-btn';
            btn.innerHTML = `<span>${app.icon || '🗔'}</span><span>${this.inst.escapeHtml(app.name)}</span>`;
            btn.onclick = () => {
              if (appMgr && typeof appMgr.launchApp === 'function') {
                appMgr.launchApp(app.id, { file });
              }
            };
            el.inspectorOpenWithList.appendChild(btn);
          });
        } else {
          el.inspectorOpenWithSection.style.display = 'none';
          el.inspectorOpenWithList.innerHTML = '';
        }
      }
    }
  }

  window.ExplorerInspectorManager = ExplorerInspectorManager;
})(window);
