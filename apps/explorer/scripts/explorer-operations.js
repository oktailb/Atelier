/**
 * Atelier by GallusTech - Explorer File Operations & Transfer Manager (apps/explorer/scripts/explorer-operations.js)
 * Handles item moves, clipboard copy/cut/paste, and file uploads via SyscallClient.
 */
(function (window) {
  'use strict';

  class ExplorerOperationsManager {
    constructor(instance) {
      this.inst = instance;
    }

    async moveItems(sourcePaths, targetDir) {
      const paths = Array.isArray(sourcePaths) ? sourcePaths : [sourcePaths];
      const validPaths = paths.filter(p => typeof p === 'string' && p.trim().length > 0);
      if (validPaths.length === 0) return;
      if (typeof targetDir !== 'string') return;

      const canMove = this.inst.state.isAdmin || (this.inst.state.userRights && this.inst.state.userRights.can_move);
      if (!canMove) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_move_denied'), 'error');
        return;
      }

      const cleanTarget = (targetDir === '.' || !targetDir) ? '' : String(targetDir).replace(/\/+$/, '').trim();

      // Don't attempt to move items into their current folder
      const itemsToMove = validPaths.filter(p => {
        const cleanP = String(p).replace(/\/+$/, '').trim();
        const parts = cleanP.split('/');
        parts.pop();
        const parentDir = parts.join('/');
        return parentDir !== cleanTarget;
      });

      if (itemsToMove.length === 0) return;

      try {
        let success = false;
        let errMsg = null;
        let movedCount = itemsToMove.length;

        if (itemsToMove.length === 1) {
          const json = await window.sys.api.fs.moveItem(itemsToMove[0], cleanTarget);
          if (json && json.success) {
            success = true;
          } else {
            errMsg = json ? json.error : null;
          }
        } else {
          const json = await window.sys.api.fs.moveItem(itemsToMove, cleanTarget);
          if (json && json.success) {
            success = true;
            movedCount = json.moved_count || itemsToMove.length;
          } else {
            let count = 0;
            for (const item of itemsToMove) {
              try {
                const res = await window.sys.api.fs.moveItem(item, cleanTarget);
                if (res && res.success) count++;
                else if (res && res.error) errMsg = res.error;
              } catch (e) {
                errMsg = e.message;
              }
            }
            if (count > 0) {
              success = true;
              movedCount = count;
            }
          }
        }

        if (success) {
          this.inst.clearSelection();
          this.inst.showToast(this.inst.t('clipboard.items_pasted', { count: movedCount }), 'success');

          if (window.EventBus && typeof window.EventBus.emit === 'function') {
            window.EventBus.emit('fs:changed', { action: 'move', sourcePaths: itemsToMove, targetDir: cleanTarget });
          } else if (this.inst.manager && this.inst.manager.instances) {
            this.inst.manager.instances.forEach(inst => {
              inst.loadDirectory(inst.state.currentPath);
            });
          }
        } else {
          this.inst.showToast('⚠️ ' + (errMsg || this.inst.t('api.err_save_failed')), 'error');
        }
      } catch (err) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_network', { message: err.message }), 'error');
      }
    }

    async handleUploadFiles(files, targetDir = null) {
      if (!files || files.length === 0) return;
      const canUpload = this.inst.state.isAdmin || (this.inst.state.userRights && this.inst.state.userRights.can_upload);
      if (!canUpload) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_upload_denied'), 'error');
        return;
      }

      const destination = (targetDir !== null && typeof targetDir === 'string') ? targetDir : this.inst.state.currentPath;

      const formData = new FormData();
      formData.append('dir', destination);
      for (let i = 0; i < files.length; i++) {
        formData.append('files[]', files[i]);
      }

      const progressModal = document.getElementById('uploadProgressModal');
      const progressBar = document.getElementById('uploadProgressBar');
      const progressStatus = document.getElementById('uploadProgressStatus');

      const statusText = this.inst.t('explorer.uploading_files', { count: files.length });
      if (progressModal) {
        if (progressBar) {
          progressBar.style.width = '0%';
          progressBar.textContent = '0%';
        }
        if (progressStatus) {
          progressStatus.textContent = statusText;
        }
        progressModal.style.display = 'flex';
        progressModal.classList.add('open');
      } else {
        this.inst.showToast(statusText, 'info');
      }

      try {
        const json = await window.sys.api.upload('upload_file', formData, (percent) => {
          if (progressBar) {
            progressBar.style.width = `${percent}%`;
            progressBar.textContent = `${percent}%`;
          }
        });

        if (json && json.success) {
          this.inst.showToast(json.message || this.inst.t('api.success_uploaded', { count: files.length }), 'success');
          if (window.EventBus) {
            window.EventBus.emit('fs:changed', { action: 'upload', dir: destination });
          } else {
            await this.inst.loadDirectory(this.inst.state.currentPath);
          }
        } else {
          this.inst.showToast('⚠️ ' + ((json && json.error) || this.inst.t('api.err_upload_failed')), 'error');
        }
      } catch (err) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_network', { message: err.message }), 'error');
      } finally {
        if (progressModal) {
          progressModal.style.display = 'none';
          progressModal.classList.remove('open');
        }
      }
    }

    _collectSelectedClipboardItems() {
      const selectedPaths = Array.from(this.inst.state.selectedPaths || []);
      if (selectedPaths.length === 0) return [];
      const files = this.inst.state.files || [];
      const folders = this.inst.state.directories || this.inst.state.folders || [];
      const items = [];
      selectedPaths.forEach(p => {
        const f = files.find(item => item.path === p);
        const folder = folders.find(item => item.path === p);
        if (f) items.push(f);
        else if (folder) items.push({ ...folder, is_folder: true });
        else items.push({ path: p, name: p.split('/').pop() });
      });
      return items;
    }

    copySelection() {
      const items = this._collectSelectedClipboardItems();
      if (items.length === 0) return;
      if (window.sys && window.sys.clipboard) {
        window.sys.clipboard.copyFiles(items);
        this.inst.showToast(this.inst.t('clipboard.items_copied', { count: items.length }), 'info');
      }
    }

    cutSelection() {
      const items = this._collectSelectedClipboardItems();
      if (items.length === 0) return;
      if (window.sys && window.sys.clipboard) {
        window.sys.clipboard.cutFiles(items);
        this.inst.showToast(this.inst.t('clipboard.items_cut', { count: items.length }), 'info');
      }
    }

    async pasteClipboard() {
      if (!window.sys || !window.sys.clipboard || !window.sys.clipboard.hasData()) return;
      const clip = window.sys.clipboard.paste();
      if (clip.type !== 'files' || !Array.isArray(clip.data) || clip.data.length === 0) return;

      const dest = this.inst.state.currentPath;
      let successCount = 0;
      let lastError = null;

      for (const item of clip.data) {
        const sourcePath = item.path || item;
        try {
          const res = (clip.op === 'cut')
            ? await window.sys.api.fs.moveItem(sourcePath, dest)
            : await window.sys.api.fs.copyItem(sourcePath, dest);
          if (res && res.success) successCount++;
          else if (res && res.error) lastError = res.error;
        } catch (e) {
          lastError = e.message;
        }
      }

      if (clip.op === 'cut' && successCount > 0) {
        window.sys.clipboard.clear();
      }

      if (successCount > 0) {
        this.inst.showToast(this.inst.t('clipboard.items_pasted', { count: successCount }), 'success');
        if (window.EventBus) {
          window.EventBus.emit('fs:changed', { action: clip.op, dir: dest });
        } else {
          await this.inst.loadDirectory(this.inst.state.currentPath);
        }
      } else if (lastError) {
        this.inst.showToast(`⚠️ ${lastError}`, 'error');
      }
    }
  }

  window.ExplorerOperationsManager = ExplorerOperationsManager;
})(window);
