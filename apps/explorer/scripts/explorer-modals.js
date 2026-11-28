/**
 * Atelier by GallusTech - Explorer Modals Manager (apps/explorer/scripts/explorer-modals.js)
 * Manages folder creation, deletion confirmation, folder unlock, media comments,
 * and dotfile folder settings dialogs with strict i18n and multi-instance tracking.
 */
(function (window) {
  'use strict';

  class ExplorerModalsManager {
    constructor(instance) {
      this.inst = instance;
    }

    // -------------------------------------------------------------
    // FOLDER CREATION MODAL
    // -------------------------------------------------------------
    openCreateFolderModal() {
      const canCreate = this.inst.state.isAdmin || (this.inst.state.userRights && this.inst.state.userRights.can_create_folder);
      if (!canCreate) return;

      if (window.sys && window.sys.dialog && typeof window.sys.dialog.prompt === 'function') {
        window.sys.dialog.prompt(
          this.inst.t('folder.new_name_placeholder'),
          this.inst.t('nav.create_folder'),
          ''
        ).then(async (name) => {
          if (name && name.trim()) {
            await this._submitCreateFolder(name.trim());
          }
        });
        return;
      }

      this.inst.manager.activeModalInstance = this.inst;
      const modal = this.inst.el.createFolderModal || document.getElementById('createFolderModal');
      if (!modal) return;
      this.inst.el.createFolderModal = modal;
      this.inst.el.newFolderNameInput = this.inst.el.newFolderNameInput || document.getElementById('createFolderNameInput') || document.getElementById('newFolderNameInput');
      this.inst.el.createFolderError = this.inst.el.createFolderError || document.getElementById('createFolderError');

      if (this.inst.el.createFolderError) this.inst.el.createFolderError.style.display = 'none';
      modal.style.display = 'flex';
      modal.classList.add('open');
      if (this.inst.el.newFolderNameInput) {
        this.inst.el.newFolderNameInput.value = '';
        setTimeout(() => this.inst.el.newFolderNameInput.focus(), 50);
      }
    }

    closeCreateFolderModal() {
      const modal = this.inst.el.createFolderModal || document.getElementById('createFolderModal');
      if (!modal) return;
      modal.style.display = 'none';
      modal.classList.remove('open');
    }

    async _submitCreateFolder(name) {
      try {
        const json = await window.sys.api.fs.createFolder(this.inst.state.currentPath, name);
        if (json && json.success) {
          this.closeCreateFolderModal();
          this.inst.showToast(this.inst.t('folder.create_success'), 'success');
          if (window.EventBus) {
            window.EventBus.emit('fs:changed', { action: 'create_folder', dir: this.inst.state.currentPath });
          } else {
            await this.inst.loadDirectory(this.inst.state.currentPath);
          }
        } else {
          this.inst.showToast('⚠️ ' + ((json && json.error) || this.inst.t('explorer.err_create_folder')), 'error');
        }
      } catch (err) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_network', { message: err.message }), 'error');
      }
    }

    async createFolder() {
      if (!this.inst.el.newFolderNameInput) return;
      const name = this.inst.el.newFolderNameInput.value.trim();
      if (!name) return;
      await this._submitCreateFolder(name);
    }

    // -------------------------------------------------------------
    // DELETE CONFIRMATION MODAL & MULTI-SELECTION DELETE
    // -------------------------------------------------------------
    openDeleteConfirmModal(path, name, type = 'file') {
      const message = (type === 'folder')
        ? this.inst.t('delete_confirm.prompt_folder', { name })
        : this.inst.t('delete_confirm.prompt_file', { name });
      const title = this.inst.t('delete_confirm.title');

      if (window.sys && window.sys.dialog && typeof window.sys.dialog.confirm === 'function') {
        window.sys.dialog.confirm(message, title, true).then(async (confirmed) => {
          if (confirmed) {
            this.inst.pendingDeletePath = path;
            await this.confirmDeleteItem();
          }
        });
        return;
      }

      this.inst.manager.activeModalInstance = this.inst;
      this.inst.pendingDeletePath = path;
      this.inst.pendingDeleteType = type;
      const modal = this.inst.el.deleteConfirmModal || document.getElementById('deleteConfirmModal');
      if (!modal) return;
      this.inst.el.deleteConfirmModal = modal;

      if (this.inst.el.deleteConfirmMessage) {
        this.inst.el.deleteConfirmMessage.innerHTML = this.inst.escapeHtml(message);
      }
      if (this.inst.el.deleteConfirmItemName) this.inst.el.deleteConfirmItemName.textContent = name;
      if (this.inst.el.deleteConfirmItemType) {
        this.inst.el.deleteConfirmItemType.textContent = (type === 'folder')
          ? this.inst.t('explorer.type_folder')
          : this.inst.t('explorer.type_file');
      }
      modal.style.display = 'flex';
      modal.classList.add('open');
    }

    closeDeleteConfirmModal() {
      const modal = this.inst.el.deleteConfirmModal || document.getElementById('deleteConfirmModal');
      if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('open');
      }
      this.inst.pendingDeletePath = null;
    }

    async confirmDeleteItem() {
      if (!this.inst.pendingDeletePath) return;
      const path = this.inst.pendingDeletePath;

      try {
        const json = await window.sys.api.fs.deleteItem(path);
        if (json && json.success) {
          this.closeDeleteConfirmModal();
          this.inst.showToast(json.message || this.inst.t('api.success_deleted'), 'success');
          if (window.EventBus) {
            window.EventBus.emit('fs:changed', { action: 'delete_item', target_path: path });
          } else {
            await this.inst.loadDirectory(this.inst.state.currentPath);
          }
        } else {
          this.inst.showToast('⚠️ ' + ((json && json.error) || this.inst.t('explorer.err_delete_failed')), 'error');
        }
      } catch (err) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_network', { message: err.message }), 'error');
      }
    }

    deleteSelection() {
      if (!this.inst.state.selectedPaths || this.inst.state.selectedPaths.size === 0) return;
      const canDelete = this.inst.state.isAdmin || (this.inst.state.userRights && this.inst.state.userRights.can_delete);
      if (!canDelete) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_delete_denied'), 'error');
        return;
      }

      const selected = Array.from(this.inst.state.selectedPaths);
      if (selected.length === 1) {
        const first = selected[0];
        const name = first.split('/').pop();
        const folders = this.inst.state.directories || this.inst.state.folders || [];
        const isFolder = folders.some(f => f.path === first);
        this.openDeleteConfirmModal(first, name, isFolder ? 'folder' : 'file');
        return;
      }

      if (window.sys && window.sys.dialog && typeof window.sys.dialog.confirm === 'function') {
        const message = this.inst.t('delete_confirm.prompt_multiple', { count: selected.length });
        const title = this.inst.t('delete_confirm.title');
        window.sys.dialog.confirm(message, title, true).then(async (confirmed) => {
          if (!confirmed) return;
          let deletedCount = 0;
          for (const p of selected) {
            try {
              const res = await window.sys.api.fs.deleteItem(p);
              if (res && res.success) deletedCount++;
            } catch (err) { }
          }
          this.inst.clearSelection();
          this.inst.showToast(this.inst.t('explorer.items_deleted', { count: deletedCount }), 'success');
          if (window.EventBus) {
            window.EventBus.emit('fs:changed', { action: 'delete_item', dir: this.inst.state.currentPath });
          } else {
            await this.inst.loadDirectory(this.inst.state.currentPath);
          }
        });
      }
    }

    // -------------------------------------------------------------
    // MEDIA COMMENT MODAL
    // -------------------------------------------------------------
    openMediaCommentModal(filename, comment = '') {
      this.inst.manager.activeModalInstance = this.inst;
      const modal = this.inst.el.mediaCommentModal || document.getElementById('mediaCommentModal');
      if (!modal) return;
      this.inst.el.mediaCommentModal = modal;
      this.inst.pendingCommentFilename = filename;
      if (this.inst.el.mediaCommentFilenameBadge) this.inst.el.mediaCommentFilenameBadge.textContent = filename;
      if (this.inst.el.mediaCommentInput) this.inst.el.mediaCommentInput.value = comment;
      modal.style.display = 'flex';
      modal.classList.add('open');
      if (this.inst.el.mediaCommentInput) {
        setTimeout(() => this.inst.el.mediaCommentInput.focus(), 50);
      }
    }

    closeMediaCommentModal() {
      const modal = this.inst.el.mediaCommentModal || document.getElementById('mediaCommentModal');
      if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('open');
      }
      this.inst.pendingCommentFilename = null;
    }

    async saveMediaComment() {
      if (!this.inst.pendingCommentFilename || !this.inst.el.mediaCommentInput) return;
      const comment = this.inst.el.mediaCommentInput.value.trim();

      try {
        const json = await window.sys.api.fs.saveComment(this.inst.state.currentPath, this.inst.pendingCommentFilename, comment);
        if (json && json.success) {
          this.closeMediaCommentModal();
          this.inst.showToast(this.inst.t('explorer.comment_saved'), 'success');
          if (window.EventBus) {
            window.EventBus.emit('fs:changed', { action: 'save_comment', dir: this.inst.state.currentPath });
          } else {
            await this.inst.loadDirectory(this.inst.state.currentPath);
          }
        } else {
          this.inst.showToast('⚠️ ' + ((json && json.error) || this.inst.t('explorer.err_save_comment')), 'error');
        }
      } catch (err) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_network', { message: err.message }), 'error');
      }
    }

    // -------------------------------------------------------------
    // FOLDER UNLOCK MODAL
    // -------------------------------------------------------------
    openFolderUnlockModal(dirPath) {
      this.inst.manager.activeModalInstance = this.inst;
      const modal = this.inst.el.folderUnlockModal || document.getElementById('folderUnlockModal');
      if (!modal) return;
      this.inst.el.folderUnlockModal = modal;
      this.inst.pendingUnlockDirPath = dirPath;
      if (this.inst.el.folderPasswordInput) this.inst.el.folderPasswordInput.value = '';
      if (this.inst.el.folderUnlockError) this.inst.el.folderUnlockError.style.display = 'none';
      modal.style.display = 'flex';
      modal.classList.add('open');
      if (this.inst.el.folderPasswordInput) {
        setTimeout(() => this.inst.el.folderPasswordInput.focus(), 50);
      }
    }

    closeFolderUnlockModal() {
      const modal = this.inst.el.folderUnlockModal || document.getElementById('folderUnlockModal');
      if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('open');
      }
      this.inst.pendingUnlockDirPath = null;
    }

    async unlockFolder() {
      if (!this.inst.pendingUnlockDirPath || !this.inst.el.folderPasswordInput) return;
      const password = this.inst.el.folderPasswordInput.value;

      try {
        const json = await window.sys.api.fs.unlockFolder(this.inst.pendingUnlockDirPath, password);
        if (json && json.success) {
          const unlockedPath = this.inst.pendingUnlockDirPath;
          this.closeFolderUnlockModal();
          this.inst.showToast(this.inst.t('explorer.folder_unlocked'), 'success');
          await this.inst.navigateTo(unlockedPath);
        } else if (this.inst.el.folderUnlockError) {
          this.inst.el.folderUnlockError.textContent = (json && json.error) || this.inst.t('explorer.err_wrong_password');
          this.inst.el.folderUnlockError.style.display = 'block';
        }
      } catch (err) {
        this.inst.showToast('⚠️ ' + this.inst.t('explorer.err_network', { message: err.message }), 'error');
      }
    }

    // -------------------------------------------------------------
    // FOLDER SETTINGS MODAL (ADMIN DOTFILES)
    // -------------------------------------------------------------
    async openFolderSettingsModal(targetDir = null) {
      this.inst.manager.activeModalInstance = this.inst;
      const modal = this.inst.el.folderSettingsModal || document.getElementById('folderSettingsModal');
      if (!this.inst.state.isAdmin || !modal) return;
      this.inst.el.folderSettingsModal = modal;

      this.inst.el.dotfileTitleInput = this.inst.el.dotfileTitleInput || document.getElementById('dotfileTitleInput');
      this.inst.el.dotfileDescInput = this.inst.el.dotfileDescInput || document.getElementById('dotfileDescInput');
      this.inst.el.dotfileBgInput = this.inst.el.dotfileBgInput || document.getElementById('dotfileBgInput');
      this.inst.el.dotfileAccessModeSelect = this.inst.el.dotfileAccessModeSelect || document.getElementById('dotfileAccessModeSelect');
      this.inst.el.folderPasswordGroup = this.inst.el.folderPasswordGroup || document.getElementById('folderPasswordGroup');
      this.inst.el.dotfilePasswordInput = this.inst.el.dotfilePasswordInput || document.getElementById('dotfilePasswordInput');

      const target = (typeof targetDir === 'string') ? targetDir : (this.inst.state.currentPath || '');
      this.inst.modalFolderSettingsDir = target;

      let overrides = this.inst.state.overrides || {};
      if (target !== (this.inst.state.currentPath || '')) {
        try {
          const res = await window.sys.api.get('get_gallery', { dir: target, _t: Date.now() });
          if (res && res.success && res.overrides) {
            overrides = res.overrides;
          }
        } catch (e) {
          console.warn('[Explorer] Could not fetch overrides for folder:', target, e);
        }
      }

      if (this.inst.el.dotfileTitleInput) this.inst.el.dotfileTitleInput.value = overrides.title || '';
      if (this.inst.el.dotfileDescInput) this.inst.el.dotfileDescInput.value = overrides.description || '';
      if (this.inst.el.dotfileBgInput) this.inst.el.dotfileBgInput.value = overrides.background || '';
      if (this.inst.el.dotfileAccessModeSelect) {
        this.inst.el.dotfileAccessModeSelect.value = overrides.access_mode || 'public';
        this.inst.el.dotfileAccessModeSelect.onchange = () => {
          if (this.inst.el.folderPasswordGroup) {
            this.inst.el.folderPasswordGroup.style.display = (this.inst.el.dotfileAccessModeSelect.value === 'password') ? 'block' : 'none';
          }
        };
      }
      if (this.inst.el.dotfilePasswordInput) this.inst.el.dotfilePasswordInput.value = '';
      if (this.inst.el.folderPasswordGroup) {
        this.inst.el.folderPasswordGroup.style.display = (overrides.access_mode === 'password') ? 'block' : 'none';
      }
      modal.style.display = 'flex';
      modal.classList.add('open');
    }

    closeFolderSettingsModal() {
      const modal = this.inst.el.folderSettingsModal || document.getElementById('folderSettingsModal');
      if (!modal) return;
      modal.style.display = 'none';
      modal.classList.remove('open');
    }

    async saveFolderSettings() {
      try {
        const targetDir = (this.inst.modalFolderSettingsDir !== undefined && this.inst.modalFolderSettingsDir !== null)
          ? this.inst.modalFolderSettingsDir
          : (this.inst.state.currentPath || '');

        const json = await window.sys.api.fs.saveFolderSettings({
          dir: targetDir,
          title: this.inst.el.dotfileTitleInput ? this.inst.el.dotfileTitleInput.value.trim() : '',
          description: this.inst.el.dotfileDescInput ? this.inst.el.dotfileDescInput.value.trim() : '',
          background: this.inst.el.dotfileBgInput ? this.inst.el.dotfileBgInput.value.trim() : '',
          access_mode: this.inst.el.dotfileAccessModeSelect ? this.inst.el.dotfileAccessModeSelect.value : 'public',
          password: this.inst.el.dotfilePasswordInput ? this.inst.el.dotfilePasswordInput.value : ''
        });
        if (json && json.success) {
          this.closeFolderSettingsModal();
          this.inst.showToast(json.message || this.inst.t('api.msg_folder_settings_saved'), 'success');
          if (window.EventBus) {
            window.EventBus.emit('fs:changed', { action: 'save_folder_settings', dir: targetDir });
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
  }

  window.ExplorerModalsManager = ExplorerModalsManager;
})(window);
