/**
 * Atelier by GallusTech - Explorer Non-Blocking Transfer & Chunked Upload Manager
 * (apps/explorer/scripts/explorer-transfers.js)
 * Features:
 *  - Automatic SyscallClient.uploadChunked() for large files (>= 2 MB) & standard upload for small files
 *  - Recursive OS folder drag-and-drop via DataTransferItem.webkitGetAsEntry()
 *  - Non-blocking bottom-right floating transfer panel per Explorer instance with per-file progress & cancel
 */
(function (window) {
  'use strict';

  const CHUNK_THRESHOLD_BYTES = 2 * 1024 * 1024; // 2 MB -> chunked resumable upload
  const CHUNK_SIZE_BYTES = 1536 * 1024;          // 1.5 MB chunks (safe under standard 2M PHP defaults)

  class ExplorerTransfersManager {
    constructor(instance) {
      this.inst = instance;
      this.queue = [];
      this.isRunning = false;
      this.minimized = false;
      this._seq = 0;
      this._destroyed = false;
    }

    /**
     * Enqueues a FileList or Array<File> into a single target directory.
     */
    async enqueueFiles(files, targetDir = null) {
      if (!files || files.length === 0) return;
      const canUpload = this.inst.state.isAdmin || (this.inst.state.userRights && this.inst.state.userRights.can_upload);
      if (!canUpload) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_upload_denied'), 'error');
        return;
      }
      const dest = (targetDir !== null && typeof targetDir === 'string') ? targetDir : (this.inst.state.currentPath || '');
      const list = Array.from(files).map(file => ({ file, targetDir: dest }));
      this._addEntriesToQueue(list);
      await this._processQueue();
    }

    /**
     * Enqueues a DataTransfer from drag-and-drop, supporting recursive OS directories via webkitGetAsEntry().
     */
    async enqueueDataTransfer(dataTransfer, targetDir = null) {
      if (!dataTransfer) return;
      const canUpload = this.inst.state.isAdmin || (this.inst.state.userRights && this.inst.state.userRights.can_upload);
      if (!canUpload) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_upload_denied'), 'error');
        return;
      }

      const baseDir = (targetDir !== null && typeof targetDir === 'string') ? targetDir : (this.inst.state.currentPath || '');
      const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
      const hasEntries = items.length > 0 && items.some(it => typeof it.webkitGetAsEntry === 'function');

      if (!hasEntries) {
        if (dataTransfer.files && dataTransfer.files.length > 0) {
          await this.enqueueFiles(dataTransfer.files, baseDir);
        }
        return;
      }

      const entries = items
        .map(it => (typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null))
        .filter(Boolean);

      if (entries.length === 0) {
        if (dataTransfer.files && dataTransfer.files.length > 0) {
          await this.enqueueFiles(dataTransfer.files, baseDir);
        }
        return;
      }

      const collected = [];
      const foldersToCreate = new Set();

      const joinDir = (parent, child) => {
        const cleanParent = String(parent || '').replace(/\/+$/, '');
        const cleanChild = String(child || '').replace(/^\/+|\/+$/g, '');
        if (!cleanParent) return cleanChild;
        if (!cleanChild) return cleanParent;
        return `${cleanParent}/${cleanChild}`;
      };

      const readAllDirEntries = (dirReader) => new Promise((resolve) => {
        const all = [];
        const step = () => {
          dirReader.readEntries((batch) => {
            if (!batch || batch.length === 0) {
              resolve(all);
            } else {
              all.push(...batch);
              step();
            }
          }, () => resolve(all));
        };
        step();
      });

      const walk = async (entry, curDir) => {
        if (!entry) return;
        if (entry.isFile) {
          const fileObj = await new Promise((resolve) => {
            entry.file(f => resolve(f), () => resolve(null));
          });
          if (fileObj) {
            collected.push({ file: fileObj, targetDir: curDir });
          }
        } else if (entry.isDirectory) {
          const nextDir = joinDir(curDir, entry.name);
          foldersToCreate.add(JSON.stringify({ parent: curDir, name: entry.name }));
          const reader = entry.createReader();
          const children = await readAllDirEntries(reader);
          for (const child of children) {
            await walk(child, nextDir);
          }
        }
      };

      for (const entry of entries) {
        await walk(entry, baseDir);
      }

      // Create dropped folder hierarchy first (shallowest first)
      const folderList = Array.from(foldersToCreate)
        .map(s => JSON.parse(s))
        .sort((a, b) => a.parent.length - b.parent.length);

      for (const f of folderList) {
        try {
          await window.sys.api.fs.createFolder(f.parent, f.name);
        } catch (e) { }
      }

      if (collected.length > 0) {
        this._addEntriesToQueue(collected);
        await this._processQueue();
      } else if (folderList.length > 0) {
        if (window.EventBus) {
          window.EventBus.emit('fs:changed', { action: 'create_folder', dir: baseDir });
        } else {
          await this.inst.loadDirectory(this.inst.state.currentPath);
        }
      }
    }

    _addEntriesToQueue(entries) {
      entries.forEach(({ file, targetDir }) => {
        this.queue.push({
          id: ++this._seq,
          file,
          name: file.name || 'file',
          size: Number(file.size) || 0,
          targetDir: targetDir || '',
          progress: 0,
          status: 'pending', // pending | uploading | done | cancelled | error
          error: null,
          cancelled: false
        });
      });
      this.minimized = false;
      this.renderPanel();
    }

    cancelItem(id) {
      const item = this.queue.find(t => t.id === id);
      if (!item) return;
      item.cancelled = true;
      if (item.status === 'pending' || item.status === 'uploading') {
        item.status = 'cancelled';
      }
      this.renderPanel();
    }

    cancelAll() {
      this.queue.forEach(item => {
        if (item.status === 'pending' || item.status === 'uploading') {
          item.cancelled = true;
          item.status = 'cancelled';
        }
      });
      this.renderPanel();
    }

    clearFinished() {
      this.queue = this.queue.filter(t => t.status === 'pending' || t.status === 'uploading');
      this.renderPanel();
    }

    async _processQueue() {
      if (this.isRunning) return;
      this.isRunning = true;

      let batchOk = 0;
      let batchErr = 0;
      let lastDir = this.inst.state.currentPath || '';

      try {
        while (!this._destroyed) {
          const item = this.queue.find(t => t.status === 'pending');
          if (!item) break;
          if (item.cancelled) {
            item.status = 'cancelled';
            this.renderPanel();
            continue;
          }

          item.status = 'uploading';
          item.progress = 0;
          lastDir = item.targetDir;
          this.renderPanel();

          try {
            let res;
            const useChunked = item.size >= CHUNK_THRESHOLD_BYTES
              && window.sys && window.sys.api && typeof window.sys.api.uploadChunked === 'function';

            if (useChunked) {
              res = await window.sys.api.uploadChunked(item.file, item.targetDir, {
                chunkSize: CHUNK_SIZE_BYTES,
                isCancelled: () => item.cancelled || this._destroyed,
                onProgress: (pct) => {
                  item.progress = Math.max(0, Math.min(100, Number(pct) || 0));
                  this._updateItemProgressDOM(item);
                }
              });
            } else {
              const fd = new FormData();
              fd.append('dir', item.targetDir);
              fd.append('files[]', item.file, item.name);
              res = await window.sys.api.upload('upload_file', fd, (pct) => {
                item.progress = Math.max(0, Math.min(100, Number(pct) || 0));
                this._updateItemProgressDOM(item);
              });
            }

            if (item.cancelled || (res && res.cancelled)) {
              item.status = 'cancelled';
            } else if (res && res.success) {
              item.progress = 100;
              item.status = 'done';
              batchOk++;
            } else {
              item.status = 'error';
              item.error = (res && res.error) || this.inst.t('api.err_upload_failed');
              batchErr++;
            }
          } catch (err) {
            if (item.cancelled) {
              item.status = 'cancelled';
            } else {
              item.status = 'error';
              item.error = err.message || this.inst.t('explorer.err_unknown');
              batchErr++;
            }
          }

          this.renderPanel();
        }
      } finally {
        this.isRunning = false;
      }

      if (this._destroyed) return;

      if (batchOk > 0) {
        if (batchErr > 0) {
          this.inst.showToast(this.inst.t('explorer.transfer_summary_err', { ok: batchOk, failed: batchErr }), 'warning');
        } else {
          this.inst.showToast(this.inst.t('explorer.transfer_summary_ok', { count: batchOk }), 'success');
        }
        if (window.EventBus) {
          window.EventBus.emit('fs:changed', { action: 'upload', dir: lastDir });
        } else {
          await this.inst.loadDirectory(this.inst.state.currentPath);
        }
      } else if (batchErr > 0) {
        const lastFail = this.queue.find(t => t.status === 'error');
        this.inst.showToast('⚠️ ' + ((lastFail && lastFail.error) || this.inst.t('api.err_upload_failed')), 'error');
      }
    }

    _updateItemProgressDOM(item) {
      const panel = this.inst.el && this.inst.el.transferPanel;
      if (!panel) return;
      const bar = panel.querySelector(`[data-transfer-bar="${item.id}"]`);
      const pct = panel.querySelector(`[data-transfer-pct="${item.id}"]`);
      if (bar) bar.style.width = `${item.progress}%`;
      if (pct) pct.textContent = `${item.progress}%`;
    }

    renderPanel() {
      const panel = this.inst.el && this.inst.el.transferPanel;
      if (!panel) return;

      if (this.queue.length === 0) {
        panel.style.display = 'none';
        panel.innerHTML = '';
        return;
      }

      const total = this.queue.length;
      const done = this.queue.filter(t => t.status === 'done').length;
      const hasActive = this.queue.some(t => t.status === 'pending' || t.status === 'uploading');
      const fmt = (b) => this.inst.stateManager ? this.inst.stateManager.formatBytes(b) : `${b} B`;

      panel.style.display = 'flex';
      panel.classList.toggle('minimized', this.minimized);

      const itemsHtml = this.minimized ? '' : `<div class="transfer-panel-list">${this.queue.map(item => {
        let statusBadge = `${item.progress}%`;
        if (item.status === 'done') statusBadge = `✅ ${this.inst.escapeHtml(this.inst.t('explorer.transfer_done'))}`;
        else if (item.status === 'cancelled') statusBadge = `⊘ ${this.inst.escapeHtml(this.inst.t('explorer.transfer_cancelled'))}`;
        else if (item.status === 'error') statusBadge = `⚠️ ${this.inst.escapeHtml(this.inst.t('explorer.transfer_error'))}`;

        const cancelHtml = (item.status === 'pending' || item.status === 'uploading')
          ? `<button type="button" class="transfer-item-cancel" data-cancel-id="${item.id}" title="${this.inst.escapeHtml(this.inst.t('explorer.transfer_cancel_btn'))}">✕</button>`
          : '';

        return `
          <div class="transfer-item transfer-status-${item.status}">
            <div class="transfer-item-top">
              <span class="transfer-item-name" title="${this.inst.escapeHtml(item.name)}">${this.inst.escapeHtml(item.name)}</span>
              <span class="transfer-item-size">${this.inst.escapeHtml(fmt(item.size))}</span>
              <span class="transfer-item-pct" data-transfer-pct="${item.id}">${statusBadge}</span>
              ${cancelHtml}
            </div>
            <div class="transfer-item-track">
              <div class="transfer-item-bar" data-transfer-bar="${item.id}" style="width:${item.progress}%;"></div>
            </div>
            ${item.error ? `<div class="transfer-item-error">${this.inst.escapeHtml(item.error)}</div>` : ''}
          </div>`;
      }).join('')}</div>`;

      panel.innerHTML = `
        <div class="transfer-panel-header">
          <div class="transfer-panel-title">
            <span>📤 ${this.inst.escapeHtml(this.inst.t('explorer.transfer_title'))}</span>
            <span class="transfer-panel-count">${this.inst.escapeHtml(this.inst.t('explorer.transfer_active', { done, total }))}</span>
          </div>
          <div class="transfer-panel-actions">
            ${hasActive ? `<button type="button" class="transfer-hdr-btn transfer-cancel-all-btn" title="${this.inst.escapeHtml(this.inst.t('explorer.transfer_cancel_btn'))}">⏹</button>` : ''}
            ${!hasActive ? `<button type="button" class="transfer-hdr-btn transfer-clear-btn" title="${this.inst.escapeHtml(this.inst.t('explorer.transfer_clear_btn'))}">✕</button>` : ''}
            <button type="button" class="transfer-hdr-btn transfer-min-btn" title="${this.inst.escapeHtml(this.inst.t('explorer.transfer_minimize_btn'))}">${this.minimized ? '▴' : '▾'}</button>
          </div>
        </div>
        ${itemsHtml}
      `;

      const minBtn = panel.querySelector('.transfer-min-btn');
      if (minBtn) minBtn.onclick = () => { this.minimized = !this.minimized; this.renderPanel(); };

      const clearBtn = panel.querySelector('.transfer-clear-btn');
      if (clearBtn) clearBtn.onclick = () => this.clearFinished();

      const cancelAllBtn = panel.querySelector('.transfer-cancel-all-btn');
      if (cancelAllBtn) cancelAllBtn.onclick = () => this.cancelAll();

      panel.querySelectorAll('[data-cancel-id]').forEach(btn => {
        btn.onclick = () => this.cancelItem(parseInt(btn.dataset.cancelId, 10));
      });
    }

    destroy() {
      this._destroyed = true;
      this.cancelAll();
    }
  }

  window.ExplorerTransfersManager = ExplorerTransfersManager;
})(window);
