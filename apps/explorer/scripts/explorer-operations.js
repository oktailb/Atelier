/**
 * Atelier by GallusTech - Explorer File Operations Manager (apps/explorer/scripts/explorer-operations.js)
 * Handles item moves, in-place renaming (F2), new file creation, duplication,
 * clipboard copy/cut/paste, path copy, and upload delegation to ExplorerTransfersManager.
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

    async renameItem(itemPath, currentName = '') {
      if (!itemPath) return;
      const canMove = this.inst.state.isAdmin || (this.inst.state.userRights && this.inst.state.userRights.can_move);
      if (!canMove) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_move_denied'), 'error');
        return;
      }

      const oldName = currentName || String(itemPath).split('/').filter(Boolean).pop() || '';
      if (!window.sys || !window.sys.dialog || typeof window.sys.dialog.prompt !== 'function') return;

      const nextName = await window.sys.dialog.prompt({
        title: this.inst.t('explorer.rename_title'),
        message: this.inst.t('explorer.rename_prompt', { name: oldName }),
        defaultValue: oldName,
        selectStem: true
      });
      if (!nextName || !nextName.trim() || nextName.trim() === oldName) return;

      const cleanNew = nextName.trim();
      try {
        const json = await window.sys.api.fs.renameItem(itemPath, cleanNew);
        if (json && json.success) {
          this.inst.showToast(this.inst.t('explorer.rename_success', { name: cleanNew }), 'success');
          if (window.EventBus) {
            window.EventBus.emit('fs:changed', { action: 'rename', source: itemPath, new_name: cleanNew });
          } else {
            await this.inst.loadDirectory(this.inst.state.currentPath);
          }
        } else {
          this.inst.showToast('⚠️ ' + ((json && json.error) || this.inst.t('api.err_save_failed')), 'error');
        }
      } catch (err) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_network', { message: err.message }), 'error');
      }
    }

    async renameSelection() {
      const selected = Array.from(this.inst.state.selectedPaths || []);
      if (selected.length !== 1) return;
      const p = selected[0];
      const name = p.split('/').filter(Boolean).pop() || p;
      await this.renameItem(p, name);
    }

    async createNewFile(targetDir = null) {
      const canUpload = this.inst.state.isAdmin || (this.inst.state.userRights && this.inst.state.userRights.can_upload);
      if (!canUpload) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_upload_denied'), 'error');
        return;
      }
      if (!window.sys || !window.sys.dialog || typeof window.sys.dialog.prompt !== 'function') return;

      const filename = await window.sys.dialog.prompt({
        title: this.inst.t('explorer.new_file_title'),
        message: this.inst.t('explorer.new_file_prompt'),
        defaultValue: 'note.md',
        selectStem: true
      });
      if (!filename || !filename.trim()) return;

      const cleanName = filename.trim().replace(/[\/\\]/g, '');
      const destDir = (targetDir !== null && typeof targetDir === 'string') ? targetDir : (this.inst.state.currentPath || '');
      const fullRelPath = destDir ? `${destDir.replace(/\/+$/, '')}/${cleanName}` : cleanName;
      const ext = (cleanName.includes('.') ? cleanName.split('.').pop() : '').toLowerCase();
      const initialContent = ext === 'json' ? '{\n  \n}\n' : (ext === 'md' ? `# ${cleanName.replace(/\.md$/i, '')}\n\n` : '');

      try {
        const res = await window.sys.api.fs.saveTextFile(fullRelPath, initialContent);
        if (res && res.success) {
          this.inst.showToast(this.inst.t('explorer.new_file_created', { name: cleanName }), 'success');
          if (window.EventBus) {
            window.EventBus.emit('fs:changed', { action: 'create_file', dir: destDir, file: fullRelPath });
          } else {
            await this.inst.loadDirectory(this.inst.state.currentPath);
          }
        } else {
          this.inst.showToast('⚠️ ' + ((res && res.error) || this.inst.t('api.err_save_failed')), 'error');
        }
      } catch (err) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_network', { message: err.message }), 'error');
      }
    }

    async duplicateItem(itemPath) {
      if (!itemPath) return;
      const parent = this.inst.stateManager ? this.inst.stateManager.getParentPath(itemPath) : '';
      const targetDir = parent || '';
      const name = String(itemPath).split('/').filter(Boolean).pop() || 'copy';
      const dot = name.lastIndexOf('.');
      const copyName = dot > 0 ? `${name.slice(0, dot)}_copy${name.slice(dot)}` : `${name}_copy`;

      try {
        const res = await window.sys.api.fs.copyItem(itemPath, targetDir, copyName);
        if (res && res.success) {
          this.inst.showToast(this.inst.t('explorer.duplicate_success'), 'success');
          if (window.EventBus) {
            window.EventBus.emit('fs:changed', { action: 'copy', dir: targetDir });
          } else {
            await this.inst.loadDirectory(this.inst.state.currentPath);
          }
        } else {
          this.inst.showToast('⚠️ ' + ((res && res.error) || this.inst.t('api.err_save_failed')), 'error');
        }
      } catch (err) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_network', { message: err.message }), 'error');
      }
    }

    async copyPathToClipboard(path) {
      const text = String(path || '/');
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        }
        this.inst.showToast(this.inst.t('explorer.ctx_path_copied'), 'info');
      } catch (e) { }
    }

    async handleUploadFiles(files, targetDir = null) {
      if (!files || files.length === 0) return;
      if (this.inst.transfersManager && typeof this.inst.transfersManager.enqueueFiles === 'function') {
        return this.inst.transfersManager.enqueueFiles(files, targetDir);
      }

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

      try {
        const json = await window.sys.api.upload('upload_file', formData);
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
