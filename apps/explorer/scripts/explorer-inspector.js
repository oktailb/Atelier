/**
 * Atelier by GallusTech - Explorer Inspector Drawer Manager (apps/explorer/scripts/explorer-inspector.js)
 * Manages the 3-tab side inspector drawer:
 *  - Tab 1 (details): preview, EXIF/GPS metadata, inline caption editing, Share, Open With apps
 *  - Tab 2 (tags): single & batch item tagging (`list_tags`, `get_item_tags`, `set_item_tags`)
 *  - Tab 3 (versions): automatic file version history (`list_file_versions`, `restore_file_version`)
 */
(function (window) {
  'use strict';

  class ExplorerInspectorManager {
    constructor(instance) {
      this.inst = instance;
      this.activeTab = 'details';
      this._tabsBound = false;
      this._currentTagLabels = [];
      this._availableTags = [];
      this._lastTagsKey = null;
      this._lastVersionsPath = null;
    }

    _bindTabEvents() {
      if (this._tabsBound) return;
      const root = this.inst.el && this.inst.el.inspectorDrawer;
      if (!root) return;
      this._tabsBound = true;

      root.querySelectorAll('.inspector-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this.setActiveTab(btn.dataset.inspectorTab || 'details');
        });
      });

      const addTagBtn = root.querySelector('.inspector-tags-add-btn');
      const addTagInput = root.querySelector('.inspector-tags-input');
      if (addTagBtn) {
        addTagBtn.addEventListener('click', () => {
          if (addTagInput && addTagInput.value.trim()) {
            this.addTagToSelection(addTagInput.value.trim());
            addTagInput.value = '';
          }
        });
      }
      if (addTagInput) {
        addTagInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (addTagInput.value.trim()) {
              this.addTagToSelection(addTagInput.value.trim());
              addTagInput.value = '';
            }
          }
        });
      }

      const commentSaveBtn = root.querySelector('.inspector-comment-save-btn');
      const commentInput = root.querySelector('.inspector-comment-input');
      if (commentSaveBtn) {
        commentSaveBtn.addEventListener('click', () => this.saveInlineComment());
      }
      if (commentInput) {
        commentInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.saveInlineComment();
          }
        });
      }

      const shareBtn = root.querySelector('.inspector-share-btn');
      if (shareBtn) {
        shareBtn.addEventListener('click', () => {
          const selected = Array.from(this.inst.state.selectedPaths || []);
          if (selected.length !== 1) return;
          const p = selected[0];
          const isFile = Boolean((this.inst.state.files || []).find(f => f.path === p));
          if (typeof this.inst.openShareDialogForPath === 'function') {
            this.inst.openShareDialogForPath(p, { isFile });
          } else if (window.sys && window.sys.shares && typeof window.sys.shares.openShareDialog === 'function') {
            window.sys.shares.openShareDialog(p, { isFile });
          }
        });
      }
    }

    setActiveTab(tabId) {
      const valid = ['details', 'tags', 'versions'].includes(tabId) ? tabId : 'details';
      this.activeTab = valid;
      const root = this.inst.el && this.inst.el.inspectorDrawer;
      if (!root) return;

      root.querySelectorAll('.inspector-tab-btn').forEach(btn => {
        const isActive = btn.dataset.inspectorTab === valid;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      root.querySelectorAll('.inspector-tab-pane').forEach(pane => {
        pane.style.display = (pane.dataset.inspectorPane === valid) ? 'block' : 'none';
      });

      if (valid === 'tags') {
        this.loadTagsForSelection(true);
      } else if (valid === 'versions') {
        this.loadVersionsForSelection(true);
      }
    }

    openTab(tabId) {
      this.toggleInspector(true);
      this.setActiveTab(tabId);
    }

    toggleInspector(forceState) {
      const el = this.inst.el;
      if (!el.inspectorDrawer) return;
      this._bindTabEvents();
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

    _resolveSelectedObjects() {
      const selected = Array.from(this.inst.state.selectedPaths || []);
      const files = this.inst.state.files || [];
      const dirs = this.inst.state.directories || [];
      return selected.map(p => {
        const f = files.find(item => item.path === p);
        if (f) return { type: 'file', path: p, item: f };
        const d = dirs.find(item => item.path === p);
        if (d) return { type: 'folder', path: p, item: d };
        return { type: 'unknown', path: p, item: { path: p, name: p.split('/').filter(Boolean).pop() || p } };
      });
    }

    _isLoggedIn() {
      return Boolean(
        this.inst.state.isAdmin ||
        window.IS_ADMIN ||
        (window.sys && window.sys.shares && typeof window.sys.shares.isLoggedIn === 'function' && window.sys.shares.isLoggedIn())
      );
    }

    updateInspectorUI() {
      const el = this.inst.el;
      if (!el.inspectorDrawer || el.inspectorDrawer.style.display === 'none') return;
      this._bindTabEvents();

      const resolved = this._resolveSelectedObjects();
      if (resolved.length === 0) {
        if (el.inspectorEmptyState) el.inspectorEmptyState.style.display = 'block';
        if (el.inspectorDetails) el.inspectorDetails.style.display = 'none';
        return;
      }

      if (el.inspectorEmptyState) el.inspectorEmptyState.style.display = 'none';
      if (el.inspectorDetails) el.inspectorDetails.style.display = 'block';

      this._renderDetailsTab(resolved);

      if (this.activeTab === 'tags') {
        this.loadTagsForSelection(false);
      } else if (this.activeTab === 'versions') {
        this.loadVersionsForSelection(false);
      }
    }

    _renderDetailsTab(resolved) {
      const el = this.inst.el;
      const root = el.inspectorDrawer;
      const shareBtn = root ? root.querySelector('.inspector-share-btn') : null;
      const commentEditor = root ? root.querySelector('.inspector-comment-editor') : null;
      const commentInput = root ? root.querySelector('.inspector-comment-input') : null;

      // Multi-selection summary
      if (resolved.length > 1) {
        const totalBytes = resolved.reduce((acc, r) => acc + (Number(r.item && r.item.size) || 0), 0);
        const fmtSize = this.inst.stateManager ? this.inst.stateManager.formatBytes(totalBytes) : `${totalBytes} B`;
        if (el.inspectorPreviewImg) el.inspectorPreviewImg.style.display = 'none';
        if (el.inspectorPreviewIcon) {
          el.inspectorPreviewIcon.style.display = 'block';
          el.inspectorPreviewIcon.textContent = '📚';
        }
        if (el.inspectorFilenameBadge) {
          el.inspectorFilenameBadge.textContent = this.inst.t('explorer.inspector_multi_title', { count: resolved.length });
        }
        if (el.inspectorMetaName) el.inspectorMetaName.textContent = this.inst.t('explorer.inspector_multi_title', { count: resolved.length });
        if (el.inspectorMetaSize) el.inspectorMetaSize.textContent = fmtSize;
        if (el.inspectorMetaDim) el.inspectorMetaDim.textContent = '-';
        if (el.inspectorMetaDate) el.inspectorMetaDate.textContent = '-';
        if (el.inspectorMetaComment) el.inspectorMetaComment.textContent = this.inst.t('explorer.inspector_multi_hint');
        if (el.inspectorMetaCamera) el.inspectorMetaCamera.textContent = '-';
        if (el.inspectorMetaGps) el.inspectorMetaGps.textContent = '-';
        if (el.inspectorOpenWithSection) el.inspectorOpenWithSection.style.display = 'none';
        if (commentEditor) commentEditor.style.display = 'none';
        if (shareBtn) shareBtn.style.display = 'none';
        return;
      }

      const entry = resolved[0];
      const item = entry.item;
      const isFile = entry.type === 'file';
      const isExternal = String(entry.path || '').startsWith('ext://');

      if (el.inspectorFilenameBadge) el.inspectorFilenameBadge.textContent = item.name || entry.path;
      if (el.inspectorMetaName) el.inspectorMetaName.textContent = item.name || entry.path;

      if (shareBtn) {
        const canShare = this._isLoggedIn() && !isExternal && Boolean(window.sys && window.sys.shares && typeof window.sys.shares.openShareDialog === 'function');
        shareBtn.style.display = canShare ? 'inline-flex' : 'none';
      }

      if (!isFile) {
        if (el.inspectorPreviewImg) el.inspectorPreviewImg.style.display = 'none';
        if (el.inspectorPreviewIcon) {
          el.inspectorPreviewIcon.style.display = 'block';
          el.inspectorPreviewIcon.textContent = item.is_protected ? '🔒' : '📁';
        }
        if (el.inspectorMetaSize) {
          el.inspectorMetaSize.textContent = (typeof item.item_count === 'number')
            ? this.inst.t('folder.items_count', { count: item.item_count })
            : '-';
        }
        if (el.inspectorMetaDim) el.inspectorMetaDim.textContent = '-';
        if (el.inspectorMetaDate) {
          el.inspectorMetaDate.textContent = item.mtime ? new Date(item.mtime * 1000).toLocaleString() : '-';
        }
        if (el.inspectorMetaComment) el.inspectorMetaComment.textContent = item.comment || '-';
        if (el.inspectorMetaCamera) el.inspectorMetaCamera.textContent = '-';
        if (el.inspectorMetaGps) el.inspectorMetaGps.textContent = '-';
        if (el.inspectorOpenWithSection) el.inspectorOpenWithSection.style.display = 'none';
        if (commentEditor) commentEditor.style.display = 'none';
        return;
      }

      const file = item;
      if (el.inspectorMetaSize) {
        el.inspectorMetaSize.textContent = file.size_formatted || this.inst.t('explorer.bytes_unit', { size: file.size || 0 });
      }
      if (el.inspectorMetaDim) el.inspectorMetaDim.textContent = file.dimensions || '-';
      if (el.inspectorMetaDate) {
        const ts = file.effective_mtime || file.mtime;
        el.inspectorMetaDate.textContent = file.mtime_formatted || file.date_formatted || (ts ? new Date(ts * 1000).toLocaleString() : '-');
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

      // Inline caption editor (when user has comment rights on local storage)
      const canComment = !isExternal && (this.inst.state.isAdmin || (this.inst.state.userRights && this.inst.state.userRights.can_comment));
      if (commentEditor && commentInput) {
        commentEditor.style.display = canComment ? 'flex' : 'none';
        if (canComment) {
          commentInput.value = file.comment || '';
          commentInput.dataset.filename = file.name || '';
        }
      }

      // Preview rendering with fallback on error
      if (el.inspectorPreviewImg && el.inspectorPreviewIcon) {
        const fallbackIcon = window.IconHelper ? window.IconHelper.getFileIcon(file) : '📄';
        if (file.category === 'image' || file.thumb_url) {
          el.inspectorPreviewImg.onerror = () => {
            el.inspectorPreviewImg.style.display = 'none';
            el.inspectorPreviewIcon.style.display = 'block';
            el.inspectorPreviewIcon.textContent = fallbackIcon;
          };
          el.inspectorPreviewImg.src = file.thumb_url || file.file_url;
          el.inspectorPreviewImg.style.display = 'block';
          el.inspectorPreviewIcon.style.display = 'none';
        } else {
          el.inspectorPreviewImg.style.display = 'none';
          el.inspectorPreviewIcon.style.display = 'block';
          el.inspectorPreviewIcon.textContent = fallbackIcon;
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

    async saveInlineComment() {
      const root = this.inst.el && this.inst.el.inspectorDrawer;
      const input = root ? root.querySelector('.inspector-comment-input') : null;
      if (!input || !window.sys || !window.sys.api) return;
      const filename = input.dataset.filename || '';
      if (!filename) return;
      const comment = input.value.trim();

      try {
        const res = await window.sys.api.post('save_file_comment', {
          dir: this.inst.state.currentPath || '',
          filename,
          comment
        });
        if (res && res.success) {
          const target = (this.inst.state.files || []).find(f => f.name === filename);
          if (target) target.comment = comment;
          if (this.inst.el.inspectorMetaComment) {
            this.inst.el.inspectorMetaComment.textContent = comment || '-';
          }
          this.inst.showToast(this.inst.t('explorer.inspector_comment_saved'), 'success');
          this.inst.applyFilterAndRender();
        } else {
          this.inst.showToast('⚠️ ' + ((res && res.error) || this.inst.t('api.err_save_failed')), 'error');
        }
      } catch (err) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_network', { message: err.message }), 'error');
      }
    }

    // -------------------------------------------------------------
    // TAB 2: TAGS (SINGLE & BATCH)
    // -------------------------------------------------------------
    async loadTagsForSelection(force = false) {
      const root = this.inst.el && this.inst.el.inspectorDrawer;
      if (!root) return;
      const chipsHost = root.querySelector('.inspector-tags-chips');
      const batchHint = root.querySelector('.inspector-tags-batch-hint');
      const addRow = root.querySelector('.inspector-tags-add-row');
      const suggWrap = root.querySelector('.inspector-tags-suggestions-wrap');
      const suggHost = root.querySelector('.inspector-tags-suggestions');
      if (!chipsHost) return;

      const selected = Array.from(this.inst.state.selectedPaths || []);
      const key = selected.join('|');
      if (!force && key === this._lastTagsKey) return;
      this._lastTagsKey = key;

      if (!this._isLoggedIn()) {
        chipsHost.innerHTML = `<div class="inspector-muted-note">${this.inst.escapeHtml(this.inst.t('explorer.tags_login_required'))}</div>`;
        if (addRow) addRow.style.display = 'none';
        if (batchHint) batchHint.style.display = 'none';
        if (suggWrap) suggWrap.style.display = 'none';
        return;
      }

      const localPaths = selected.filter(p => !String(p).startsWith('ext://'));
      if (localPaths.length === 0) {
        chipsHost.innerHTML = `<div class="inspector-muted-note">${this.inst.escapeHtml(this.inst.t('explorer.tags_external_unsupported'))}</div>`;
        if (addRow) addRow.style.display = 'none';
        if (batchHint) batchHint.style.display = 'none';
        if (suggWrap) suggWrap.style.display = 'none';
        return;
      }

      if (addRow) addRow.style.display = 'flex';
      if (batchHint) {
        if (localPaths.length > 1) {
          batchHint.style.display = 'block';
          batchHint.textContent = this.inst.t('explorer.tags_batch_hint', { count: localPaths.length });
        } else {
          batchHint.style.display = 'none';
        }
      }

      try {
        const [allTagsRes, itemTagsRes] = await Promise.all([
          window.sys.api.get('list_tags').catch(() => null),
          localPaths.length === 1
            ? window.sys.api.get('get_item_tags', { path: localPaths[0] }).catch(() => null)
            : Promise.resolve(null)
        ]);

        this._availableTags = (allTagsRes && allTagsRes.success && Array.isArray(allTagsRes.tags)) ? allTagsRes.tags : [];

        if (localPaths.length === 1 && itemTagsRes && itemTagsRes.success && Array.isArray(itemTagsRes.tags)) {
          this._currentTagLabels = itemTagsRes.tags.map(t => String(t.label || t.name || '')).filter(Boolean);
        } else if (localPaths.length > 1) {
          // Fetch tags for up to first 12 items to compute intersection/union
          const sample = localPaths.slice(0, 12);
          const allItemRes = await Promise.all(
            sample.map(p => window.sys.api.get('get_item_tags', { path: p }).catch(() => null))
          );
          const tagSet = new Set();
          allItemRes.forEach(r => {
            if (r && r.success && Array.isArray(r.tags)) {
              r.tags.forEach(t => {
                const lbl = String(t.label || t.name || '').trim();
                if (lbl) tagSet.add(lbl);
              });
            }
          });
          this._currentTagLabels = Array.from(tagSet);
        } else {
          this._currentTagLabels = [];
        }
      } catch (e) {
        this._currentTagLabels = [];
      }

      this._renderTagsChips(chipsHost, suggWrap, suggHost);
    }

    _renderTagsChips(chipsHost, suggWrap, suggHost) {
      if (this._currentTagLabels.length === 0) {
        chipsHost.innerHTML = `<div class="inspector-muted-note">${this.inst.escapeHtml(this.inst.t('explorer.tags_empty'))}</div>`;
      } else {
        chipsHost.innerHTML = this._currentTagLabels.map(lbl => {
          const match = this._availableTags.find(t => (t.label || t.name) === lbl);
          const color = (match && match.color) ? match.color : '#6366f1';
          return `
            <span class="inspector-tag-chip" style="--tag-color:${this.inst.escapeHtml(color)};">
              <span class="inspector-tag-dot" style="background:${this.inst.escapeHtml(color)};"></span>
              <span class="inspector-tag-text">${this.inst.escapeHtml(lbl)}</span>
              <button type="button" class="inspector-tag-remove" data-remove-tag="${this.inst.escapeHtml(lbl)}" aria-label="Remove">×</button>
            </span>`;
        }).join('');

        chipsHost.querySelectorAll('.inspector-tag-remove').forEach(btn => {
          btn.onclick = () => this.removeTagFromSelection(btn.dataset.removeTag || '');
        });
      }

      if (suggWrap && suggHost) {
        const lowerActive = new Set(this._currentTagLabels.map(l => l.toLowerCase()));
        const suggestions = this._availableTags.filter(t => {
          const lbl = String(t.label || t.name || '').trim();
          return lbl && !lowerActive.has(lbl.toLowerCase());
        });

        if (suggestions.length > 0) {
          suggWrap.style.display = 'block';
          suggHost.innerHTML = suggestions.slice(0, 16).map(t => {
            const lbl = String(t.label || t.name || '');
            const color = t.color || '#6366f1';
            return `
              <button type="button" class="inspector-tag-suggestion" data-add-tag="${this.inst.escapeHtml(lbl)}">
                <span class="inspector-tag-dot" style="background:${this.inst.escapeHtml(color)};"></span>
                <span>+ ${this.inst.escapeHtml(lbl)}</span>
              </button>`;
          }).join('');
          suggHost.querySelectorAll('.inspector-tag-suggestion').forEach(btn => {
            btn.onclick = () => this.addTagToSelection(btn.dataset.addTag || '');
          });
        } else {
          suggWrap.style.display = 'none';
          suggHost.innerHTML = '';
        }
      }
    }

    async addTagToSelection(rawLabel) {
      const label = String(rawLabel || '').trim();
      if (!label || !window.sys || !window.sys.api) return;
      const localPaths = Array.from(this.inst.state.selectedPaths || []).filter(p => !String(p).startsWith('ext://'));
      if (localPaths.length === 0) return;

      try {
        if (localPaths.length === 1) {
          const next = Array.from(new Set([...this._currentTagLabels, label]));
          const res = await window.sys.api.post('set_item_tags', { path: localPaths[0], tags: next });
          if (!res || !res.success) {
            this.inst.showToast('⚠️ ' + ((res && res.error) || this.inst.t('api.err_save_failed')), 'error');
            return;
          }
        } else {
          // Batch mode: preserve existing tags of each item and append the new label
          for (const p of localPaths) {
            const curRes = await window.sys.api.get('get_item_tags', { path: p }).catch(() => null);
            const curLabels = (curRes && curRes.success && Array.isArray(curRes.tags))
              ? curRes.tags.map(t => String(t.label || t.name || '')).filter(Boolean)
              : [];
            if (!curLabels.some(l => l.toLowerCase() === label.toLowerCase())) {
              curLabels.push(label);
              await window.sys.api.post('set_item_tags', { path: p, tags: curLabels });
            }
          }
        }

        this.inst.showToast(this.inst.t('explorer.tags_saved'), 'success');
        if (this.inst.sidebarManager && typeof this.inst.sidebarManager.refreshOrganizationMeta === 'function') {
          this.inst.sidebarManager.refreshOrganizationMeta();
        }
        await this.loadTagsForSelection(true);
      } catch (err) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_network', { message: err.message }), 'error');
      }
    }

    async removeTagFromSelection(label) {
      if (!label || !window.sys || !window.sys.api) return;
      const localPaths = Array.from(this.inst.state.selectedPaths || []).filter(p => !String(p).startsWith('ext://'));
      if (localPaths.length === 0) return;

      try {
        if (localPaths.length === 1) {
          const next = this._currentTagLabels.filter(l => l.toLowerCase() !== label.toLowerCase());
          const res = await window.sys.api.post('set_item_tags', { path: localPaths[0], tags: next });
          if (!res || !res.success) {
            this.inst.showToast('⚠️ ' + ((res && res.error) || this.inst.t('api.err_save_failed')), 'error');
            return;
          }
        } else {
          for (const p of localPaths) {
            const curRes = await window.sys.api.get('get_item_tags', { path: p }).catch(() => null);
            const curLabels = (curRes && curRes.success && Array.isArray(curRes.tags))
              ? curRes.tags.map(t => String(t.label || t.name || '')).filter(Boolean)
              : [];
            const filtered = curLabels.filter(l => l.toLowerCase() !== label.toLowerCase());
            if (filtered.length !== curLabels.length) {
              await window.sys.api.post('set_item_tags', { path: p, tags: filtered });
            }
          }
        }

        this.inst.showToast(this.inst.t('explorer.tags_saved'), 'success');
        if (this.inst.sidebarManager && typeof this.inst.sidebarManager.refreshOrganizationMeta === 'function') {
          this.inst.sidebarManager.refreshOrganizationMeta();
        }
        await this.loadTagsForSelection(true);
      } catch (err) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_network', { message: err.message }), 'error');
      }
    }

    // -------------------------------------------------------------
    // TAB 3: FILE VERSION HISTORY
    // -------------------------------------------------------------
    async loadVersionsForSelection(force = false) {
      const root = this.inst.el && this.inst.el.inspectorDrawer;
      const listHost = root ? root.querySelector('.inspector-versions-list') : null;
      if (!listHost) return;

      const resolved = this._resolveSelectedObjects();
      if (resolved.length !== 1 || resolved[0].type !== 'file') {
        this._lastVersionsPath = null;
        listHost.innerHTML = `<div class="inspector-muted-note">${this.inst.escapeHtml(this.inst.t('explorer.versions_folder_unsupported'))}</div>`;
        return;
      }

      const filePath = resolved[0].path;
      if (String(filePath).startsWith('ext://')) {
        this._lastVersionsPath = null;
        listHost.innerHTML = `<div class="inspector-muted-note">${this.inst.escapeHtml(this.inst.t('explorer.versions_external_unsupported'))}</div>`;
        return;
      }

      if (!force && this._lastVersionsPath === filePath) return;
      this._lastVersionsPath = filePath;

      listHost.innerHTML = `<div class="inspector-muted-note">${this.inst.escapeHtml(this.inst.t('explorer.versions_loading'))}</div>`;

      try {
        const res = await window.sys.api.get('list_file_versions', { file: filePath });
        const versions = (res && res.success && Array.isArray(res.versions)) ? res.versions : [];
        if (versions.length === 0) {
          listHost.innerHTML = `<div class="inspector-muted-note">${this.inst.escapeHtml(this.inst.t('explorer.versions_empty'))}</div>`;
          return;
        }

        const canRestore = this.inst.state.isAdmin || (this.inst.state.userRights && this.inst.state.userRights.can_upload);
        const fmtSize = (b) => this.inst.stateManager ? this.inst.stateManager.formatBytes(b) : `${b} B`;

        listHost.innerHTML = versions.map(v => {
          const dt = v.created_at ? new Date(v.created_at * 1000).toLocaleString() : '—';
          const hashShort = v.sha256 ? String(v.sha256).slice(0, 8) : '';
          const actorStr = v.actor ? this.inst.t('explorer.versions_actor', { actor: v.actor }) : '';
          return `
            <div class="inspector-version-row">
              <div class="inspector-version-meta">
                <div class="inspector-version-date">🕓 ${this.inst.escapeHtml(dt)}</div>
                <div class="inspector-version-sub">
                  <span>${this.inst.escapeHtml(fmtSize(v.size_bytes || 0))}</span>
                  ${actorStr ? `<span>· ${this.inst.escapeHtml(actorStr)}</span>` : ''}
                  ${hashShort ? `<code>${this.inst.escapeHtml(hashShort)}</code>` : ''}
                </div>
              </div>
              ${canRestore ? `<button type="button" class="inspector-version-restore-btn" data-version-id="${this.inst.escapeHtml(v.version_id)}">↩️ ${this.inst.escapeHtml(this.inst.t('explorer.versions_restore_btn'))}</button>` : ''}
            </div>`;
        }).join('');

        listHost.querySelectorAll('.inspector-version-restore-btn').forEach(btn => {
          btn.onclick = () => this.restoreVersion(filePath, btn.dataset.versionId || '');
        });
      } catch (err) {
        listHost.innerHTML = `<div class="inspector-muted-note">⚠️ ${this.inst.escapeHtml(err.message)}</div>`;
      }
    }

    async restoreVersion(filePath, versionId) {
      if (!filePath || !versionId || !window.sys || !window.sys.api) return;
      const confirmMsg = this.inst.t('explorer.versions_restore_confirm');
      const confirmed = (window.sys.dialog && typeof window.sys.dialog.confirm === 'function')
        ? await window.sys.dialog.confirm(confirmMsg, this.inst.t('explorer.inspector_tab_versions'))
        : window.confirm(confirmMsg);
      if (!confirmed) return;

      try {
        const res = await window.sys.api.post('restore_file_version', {
          file: filePath,
          version_id: versionId
        });
        if (res && res.success) {
          this.inst.showToast(this.inst.t('explorer.versions_restored'), 'success');
          if (window.EventBus) {
            window.EventBus.emit('fs:changed', { action: 'restore_version', file: filePath });
          } else {
            await this.inst.loadDirectory(this.inst.state.currentPath);
          }
          await this.loadVersionsForSelection(true);
        } else {
          this.inst.showToast('⚠️ ' + ((res && res.error) || this.inst.t('api.err_save_failed')), 'error');
        }
      } catch (err) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_network', { message: err.message }), 'error');
      }
    }
  }

  window.ExplorerInspectorManager = ExplorerInspectorManager;
})(window);
