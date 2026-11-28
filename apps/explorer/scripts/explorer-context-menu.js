/**
 * Atelier by GallusTech - Explorer Context Menu Manager (apps/explorer/scripts/explorer-context-menu.js)
 * Coordinates context menus across Explorer surfaces (files, Open With & default app star,
 * details, and clean dismissal on outside click / destroy).
 */
(function (window) {
  'use strict';

  class ExplorerContextMenuManager {
    constructor(instance) {
      this.inst = instance;
      this._activeMenu = null;
      this._dismissHandler = null;
    }

    close() {
      if (this._dismissHandler) {
        document.removeEventListener('click', this._dismissHandler, true);
        document.removeEventListener('contextmenu', this._dismissHandler, true);
        this._dismissHandler = null;
      }
      if (this._activeMenu && this._activeMenu.parentNode) {
        this._activeMenu.parentNode.removeChild(this._activeMenu);
      }
      this._activeMenu = null;
      document.querySelectorAll('.explorer-open-with-menu').forEach(m => m.remove());
    }

    showFileContextMenu(file, index, clientX, clientY) {
      this.close();

      const appMgr = window.sys && window.sys.appManager;
      const compatibleApps = (appMgr && typeof appMgr.getAppsForFile === 'function')
        ? appMgr.getAppsForFile(file)
        : [];

      const menu = document.createElement('div');
      menu.className = 'explorer-open-with-menu';
      menu.addEventListener('contextmenu', (evt) => evt.preventDefault());

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'explorer-open-with-item';
      openBtn.innerHTML = `<span>▶️</span><span>${this.inst.escapeHtml(this.inst.t('explorer.open'))}</span>`;
      openBtn.onclick = () => {
        this.close();
        this.inst.openMedia(file, index);
      };
      menu.appendChild(openBtn);

      if (compatibleApps.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'explorer-open-with-sep';
        menu.appendChild(sep);

        const hdr = document.createElement('div');
        hdr.className = 'explorer-open-with-header';
        hdr.textContent = this.inst.t('explorer.open_with');
        menu.appendChild(hdr);

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

      const sep2 = document.createElement('div');
      sep2.className = 'explorer-open-with-sep';
      menu.appendChild(sep2);

      const inspectBtn = document.createElement('button');
      inspectBtn.type = 'button';
      inspectBtn.className = 'explorer-open-with-item';
      inspectBtn.innerHTML = `<span>ℹ️</span><span>${this.inst.escapeHtml(this.inst.t('explorer.details'))}</span>`;
      inspectBtn.onclick = () => {
        this.close();
        this.inst.state.selectedPaths.clear();
        this.inst.state.selectedPaths.add(file.path);
        this.inst.updateSelectionUI();
        this.inst.toggleInspector(true);
      };
      menu.appendChild(inspectBtn);

      document.body.appendChild(menu);
      this._activeMenu = menu;

      const rect = menu.getBoundingClientRect();
      const left = Math.min(clientX, Math.max(8, window.innerWidth - rect.width - 8));
      const top = Math.min(clientY, Math.max(8, window.innerHeight - rect.height - 8));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;

      this._dismissHandler = (evt) => {
        if (!menu.contains(evt.target)) {
          this.close();
        }
      };
      setTimeout(() => {
        if (this._dismissHandler) {
          document.addEventListener('click', this._dismissHandler, true);
          document.addEventListener('contextmenu', this._dismissHandler, true);
        }
      }, 0);
    }

    destroy() {
      this.close();
    }
  }

  window.ExplorerContextMenuManager = ExplorerContextMenuManager;
})(window);
