/**
 * SimpleGallery WebOS - Development Reference Application (`TemplateApp` v2.1)
 * Exemplary reference implementation adhering to all WebOS guidelines:
 * - WebOSApp lifecycle (renderTab, bindEvents, onOpen, onClose, onLocaleChanged)
 * - SyscallClient (System API + App Private Backend `forApp()`)
 * - FilePickerService (pickFile & pickSaveLocation)
 * - MenuBarManager (`registerAppMenu` with i18n labels)
 * - EventBus IPC (`this.subscribe` with automatic cleanup on close)
 * - App-scoped i18n (`apps/template-app/locales/{fr,en,ja}.json`, zero hardcoded fallbacks)
 */
(function (window) {
  'use strict';

  const WebOSApp = (window.sys && window.sys.App) || window.WebOSApp;

  class TemplateApp extends WebOSApp {
    constructor() {
      super({
        id: 'template-app',
        title: 'apps.template-app.title',
        icon: '🧪',
        width: 880,
        height: 620,
        tabs: [
          { id: 'overview',   label: 'template.tab_overview',   icon: '🏠' },
          { id: 'filepicker', label: 'template.tab_filepicker', icon: '📁' },
          { id: 'backend',    label: 'template.tab_backend',    icon: '💾' },
          { id: 'events',     label: 'template.tab_events',     icon: '⚡' }
        ]
      });

      const syscall = (window.sys && window.sys.syscall) || (window.sys && window.sys.api);
      this.appApi = syscall
        ? syscall.forApp('template-app')
        : new window.SyscallClient('apps/template-app/api.php');

      this.selectedFile = null;
      this.selectedSaveDest = null;
      this.notes = [];
      this.eventLogs = [];
    }

    onInit() {
      const logEvent = (name, payload) => {
        const time = new Date().toLocaleTimeString();
        this.eventLogs.unshift({ time, name, payload: JSON.stringify(payload || {}) });
        if (this.eventLogs.length > 30) this.eventLogs.pop();
        this.updateEventLogUI();
      };

      // Subscribing via WebOSApp.subscribe() ensures automatic cleanup when the window closes
      this.subscribe('theme:changed', (e) => logEvent('theme:changed', e));
      this.subscribe('locale:changed', (e) => logEvent('locale:changed', e));
      this.subscribe('template:ping', (e) => logEvent('template:ping', e));
      this.subscribe('filepicker:select', (e) => logEvent('filepicker:select', e));
    }

    onOpen() {
      this.registerMenus();
      this.loadNotes();
      if (this.toast) {
        this.toast.info(this.t('template.status_ready'));
      }
    }

    onLocaleChanged() {
      if (this.window && window.WindowManager) {
        window.WindowManager.setTitle(this.window.id, `${this.icon} ${this.t('apps.template-app.title')}`);
      }
      this.registerMenus();
    }

    /**
     * Top MenuBar integration (uses MenuBarManager.registerAppMenu)
     */
    registerMenus() {
      if (!window.MenuBarManager || typeof window.MenuBarManager.registerAppMenu !== 'function') return;
      window.MenuBarManager.registerAppMenu('template-app', [
        {
          id: 'file',
          label: this.t('template.menu_file'),
          items: [
            { id: 'open-filepicker', label: this.t('template.menu_open_picker'), action: () => this.openFilePickerDemo() },
            { id: 'save-picker', label: this.t('template.menu_save_picker'), action: () => this.openSavePickerDemo() },
            { id: 'clear-notes', label: this.t('template.clear_notes'), action: () => this.clearNotes() },
            { separator: true },
            { id: 'close-app', label: this.t('common.close'), action: () => this.close() }
          ]
        },
        {
          id: 'tools',
          label: this.t('template.menu_tools'),
          items: [
            { id: 'ping-system', label: this.t('template.ping_api'), action: () => this.testSystemSyscall() },
            { id: 'emit-event', label: this.t('template.emit_ping'), action: () => this.emitDemoEvent() }
          ]
        },
        {
          id: 'help',
          label: this.t('template.menu_help'),
          items: [
            { id: 'about-template', label: this.t('template.menu_about'), action: () => this.showAboutModal() }
          ]
        }
      ]);
    }

    // -------------------------------------------------------------
    // Tab Renderers (WebOSApp calls renderTab when `tabs` is set)
    // -------------------------------------------------------------

    renderTab(tabId) {
      if (tabId === 'overview') return this.renderOverviewTab();
      if (tabId === 'filepicker') return this.renderFilePickerTab();
      if (tabId === 'backend') return this.renderBackendTab();
      if (tabId === 'events') return this.renderEventsTab();
      return '';
    }

    renderOverviewTab() {
      return `
        <div class="template-app-container">
          <div class="template-card">
            <h2>🧪 ${this.escapeHtml(this.t('template.welcome_title'))}</h2>
            <p>${this.escapeHtml(this.t('template.welcome_subtitle'))}</p>

            <div class="template-actions" style="margin-top:8px;">
              <button type="button" class="webos-btn webos-btn-primary" id="tmplBtnToast">
                🔔 ${this.escapeHtml(this.t('template.btn_toast'))}
              </button>
              <button type="button" class="webos-btn" id="tmplBtnConfirm">
                ❓ ${this.escapeHtml(this.t('template.btn_confirm'))}
              </button>
              <button type="button" class="webos-btn" id="tmplBtnAudio">
                🎵 ${this.escapeHtml(this.t('template.btn_audio'))}
              </button>
              <button type="button" class="webos-btn" id="tmplBtnPingSystem">
                📡 ${this.escapeHtml(this.t('template.ping_api'))}
              </button>
            </div>
          </div>

          <div class="template-card">
            <h3>📖 ${this.escapeHtml(this.t('template.guide_title'))}</h3>
            <p>${this.escapeHtml(this.t('template.guide_intro'))}</p>
            <ul style="margin:0; padding-left:20px; font-size:0.875rem; color:var(--text-muted); line-height:1.65;">
              <li><strong>FilePickerService</strong> : <code>window.sys.pickFile()</code> / <code>window.sys.pickSaveLocation()</code></li>
              <li><strong>SyscallClient</strong> : <code>window.sys.api.forApp('template-app')</code> → <code>apps/template-app/api.php</code></li>
              <li><strong>StorageRepository</strong> : <code>StorageRepository::forApp('id', $context['project_root'])</code></li>
              <li><strong>EventBus IPC</strong> : <code>this.subscribe('event', cb)</code> &amp; <code>window.sys.events.emit()</code></li>
              <li><strong>App Locales</strong> : <code>apps/&lt;id&gt;/locales/{fr,en,ja}.json</code></li>
            </ul>
          </div>
        </div>
      `;
    }

    renderFilePickerTab() {
      const file = this.selectedFile;
      const saveDest = this.selectedSaveDest;
      return `
        <div class="template-app-container">
          <div class="template-card">
            <h3>📁 ${this.escapeHtml(this.t('template.filepicker_heading'))}</h3>
            <p>${this.escapeHtml(this.t('template.filepicker_desc'))}</p>

            <div class="template-actions">
              <button type="button" class="webos-btn webos-btn-primary" id="tmplBtnOpenFilePicker">
                📂 ${this.escapeHtml(this.t('template.open_file_picker'))}
              </button>
              <button type="button" class="webos-btn" id="tmplBtnOpenSavePicker">
                💾 ${this.escapeHtml(this.t('template.open_save_picker'))}
              </button>
            </div>

            <div style="margin-top:12px;">
              <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:8px;">
                ${this.escapeHtml(this.t('template.selected_file'))}
              </label>

              ${file ? `
                <div class="template-file-preview">
                  ${(file.category === 'image' || file.category === 'video') ? `
                    <img src="system/endpoints/thumb.php?file=${encodeURIComponent(file.path)}" class="template-file-thumb" alt="${this.escapeHtml(file.name)}" />
                  ` : `
                    <div class="template-file-thumb">📄</div>
                  `}
                  <div class="template-file-info">
                    <div class="template-file-name">${this.escapeHtml(file.name)}</div>
                    <div class="template-file-details">
                      <span>${this.escapeHtml(file.size_formatted || `${file.size || 0} B`)}</span> ·
                      <span>${this.escapeHtml((file.extension || '').toUpperCase())}</span> ·
                      <code>${this.escapeHtml(file.path)}</code>
                    </div>
                  </div>
                  <div style="display:flex; gap:8px;">
                    <button type="button" class="webos-btn" id="tmplBtnInspectFile">ℹ️ ${this.escapeHtml(this.t('template.inspect_meta'))}</button>
                    <button type="button" class="webos-btn webos-btn-primary" id="tmplBtnOpenViewer">👁️ ${this.escapeHtml(this.t('template.open_viewer'))}</button>
                  </div>
                </div>
              ` : `
                <div style="padding:20px; text-align:center; background:var(--bg-main, rgba(0,0,0,0.03)); border-radius:8px; color:var(--text-muted); font-size:0.875rem;">
                  ${this.escapeHtml(this.t('template.no_file_selected'))}
                </div>
              `}

              ${saveDest ? `
                <div style="margin-top:10px; font-size:0.82rem; color:var(--text-muted);">
                  💾 ${this.escapeHtml(this.t('template.save_dest_chosen', { path: (saveDest.dir ? saveDest.dir + '/' : '') + saveDest.filename }))}
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }

    renderBackendTab() {
      return `
        <div class="template-app-container">
          <div class="template-card">
            <h3>💾 ${this.escapeHtml(this.t('template.notepad_title'))}</h3>
            <p>${this.escapeHtml(this.t('template.notepad_desc'))}</p>

            <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
              <input type="text" id="tmplNoteTitle" class="webos-search-input" placeholder="${this.escapeHtml(this.t('template.note_title_placeholder'))}" style="width:100%; box-sizing:border-box;">
              <textarea id="tmplNoteContent" class="webos-search-input" placeholder="${this.escapeHtml(this.t('template.note_content_placeholder'))}" style="width:100%; height:80px; box-sizing:border-box; resize:vertical; font-family:inherit;"></textarea>

              <div class="template-actions">
                <button type="button" class="webos-btn webos-btn-primary" id="tmplBtnSaveNote">
                  💾 ${this.escapeHtml(this.t('template.save_note'))}
                </button>
                <button type="button" class="webos-btn" id="tmplBtnClearNotes">
                  🗑️ ${this.escapeHtml(this.t('template.clear_notes'))}
                </button>
                <button type="button" class="webos-btn" id="tmplBtnPingAppBackend">
                  ⚡ ${this.escapeHtml(this.t('template.ping_backend'))}
                </button>
              </div>
            </div>

            <div style="margin-top:14px;">
              <label style="font-size:0.8rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:8px;">
                ${this.escapeHtml(this.t('template.notes_count', { count: this.notes.length }))}
              </label>
              <div class="template-notes-list" id="tmplNotesContainer">
                ${this.renderNotesList()}
              </div>
            </div>
          </div>
        </div>
      `;
    }

    renderNotesList() {
      if (!this.notes || this.notes.length === 0) {
        return `<div style="padding:12px; text-align:center; color:var(--text-muted); font-size:0.8rem;">${this.escapeHtml(this.t('template.notes_empty'))}</div>`;
      }
      return this.notes.map(note => `
        <div class="template-note-item">
          <div class="template-note-header">
            <span class="template-note-title">📝 ${this.escapeHtml(note.title)}</span>
            <span class="template-note-date">${new Date((note.timestamp || 0) * 1000).toLocaleString()}</span>
          </div>
          ${note.content ? `<div class="template-note-content">${this.escapeHtml(note.content)}</div>` : ''}
        </div>
      `).join('');
    }

    renderEventsTab() {
      return `
        <div class="template-app-container">
          <div class="template-card">
            <h3>⚡ ${this.escapeHtml(this.t('template.events_title'))}</h3>
            <p>${this.escapeHtml(this.t('template.events_desc'))}</p>

            <div class="template-actions">
              <button type="button" class="webos-btn webos-btn-primary" id="tmplBtnEmitEvent">
                📢 ${this.escapeHtml(this.t('template.emit_ping'))}
              </button>
              <button type="button" class="webos-btn" id="tmplBtnClearLogs">
                🧹 ${this.escapeHtml(this.t('template.clear_logs'))}
              </button>
            </div>

            <div style="margin-top:10px;">
              <div class="template-event-log" id="tmplEventLogContainer">
                ${this.renderEventRows()}
              </div>
            </div>
          </div>
        </div>
      `;
    }

    renderEventRows() {
      if (!this.eventLogs || this.eventLogs.length === 0) {
        return `<div style="color:var(--text-muted);">${this.escapeHtml(this.t('template.events_waiting'))}</div>`;
      }
      return this.eventLogs.map(ev => `
        <div class="template-event-row">
          <span class="template-event-time">[${this.escapeHtml(ev.time)}]</span>
          <span class="template-event-name">${this.escapeHtml(ev.name)}</span>
          <span style="color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this.escapeHtml(ev.payload)}</span>
        </div>
      `).join('');
    }

    // -------------------------------------------------------------
    // Event Handlers & API Actions
    // -------------------------------------------------------------

    bindEvents(container) {
      if (!container) return;

      container.querySelector('#tmplBtnToast')?.addEventListener('click', () => {
        if (this.toast) this.toast.success(this.t('template.toast_demo'));
      });

      container.querySelector('#tmplBtnConfirm')?.addEventListener('click', () => {
        if (this.dialog) {
          this.dialog.confirm({
            title: this.t('template.confirm_title'),
            message: this.t('template.confirm_message'),
            onConfirm: () => {
              if (this.toast) this.toast.info(this.t('template.confirm_ok'));
            }
          });
        }
      });

      container.querySelector('#tmplBtnAudio')?.addEventListener('click', () => {
        if (window.sys && window.sys.audio && typeof window.sys.audio.play === 'function') {
          window.sys.audio.play('pop');
        } else if (this.toast) {
          this.toast.info(this.t('template.audio_triggered'));
        }
      });

      container.querySelector('#tmplBtnPingSystem')?.addEventListener('click', () => this.testSystemSyscall());
      container.querySelector('#tmplBtnOpenFilePicker')?.addEventListener('click', () => this.openFilePickerDemo());
      container.querySelector('#tmplBtnOpenSavePicker')?.addEventListener('click', () => this.openSavePickerDemo());

      container.querySelector('#tmplBtnInspectFile')?.addEventListener('click', () => {
        if (!this.selectedFile) return;
        if (window.sys && typeof window.sys.showMetadata === 'function') {
          window.sys.showMetadata(this.selectedFile);
        } else if (window.MetadataInspector && typeof window.MetadataInspector.open === 'function') {
          window.MetadataInspector.open(this.selectedFile.path || this.selectedFile);
        }
      });

      container.querySelector('#tmplBtnOpenViewer')?.addEventListener('click', () => {
        if (!this.selectedFile) return;
        if (window.sys && typeof window.sys.openFile === 'function') {
          window.sys.openFile(this.selectedFile);
        } else if (window.sys && window.sys.appManager && typeof window.sys.appManager.openFile === 'function') {
          window.sys.appManager.openFile(this.selectedFile);
        }
      });

      container.querySelector('#tmplBtnSaveNote')?.addEventListener('click', () => this.saveNote());
      container.querySelector('#tmplBtnClearNotes')?.addEventListener('click', () => this.clearNotes());
      container.querySelector('#tmplBtnPingAppBackend')?.addEventListener('click', () => this.pingAppBackend());

      container.querySelector('#tmplBtnEmitEvent')?.addEventListener('click', () => this.emitDemoEvent());
      container.querySelector('#tmplBtnClearLogs')?.addEventListener('click', () => {
        this.eventLogs = [];
        this.updateEventLogUI();
      });
    }

    async openFilePickerDemo() {
      if (!window.sys || typeof window.sys.pickFile !== 'function') {
        if (this.toast) this.toast.error(this.t('template.picker_unavailable'));
        return;
      }

      const selected = await window.sys.pickFile({
        title: this.t('template.open_file_picker'),
        multiple: false
      });
      const file = Array.isArray(selected) ? selected[0] : selected;
      if (file && !file.__localFallback) {
        this.selectedFile = file;
        if (this.toast) this.toast.success(this.t('template.file_selected_toast', { name: file.name }));
        if (window.sys && window.sys.events) {
          window.sys.events.emit('filepicker:select', { file: file.name, path: file.path });
        }
        this.switchTab('filepicker');
      }
    }

    async openSavePickerDemo() {
      if (!window.sys || typeof window.sys.pickSaveLocation !== 'function') {
        if (this.toast) this.toast.error(this.t('template.picker_unavailable'));
        return;
      }

      const dest = await window.sys.pickSaveLocation({
        title: this.t('template.open_save_picker'),
        suggestedName: 'template-export.txt'
      });
      if (dest && !dest.__localFallback) {
        this.selectedSaveDest = dest;
        if (this.toast) this.toast.info(this.t('template.save_dest_chosen', { path: (dest.dir ? dest.dir + '/' : '') + dest.filename }));
        this.switchTab('filepicker');
      }
    }

    async loadNotes() {
      try {
        const res = await this.appApi.get('template_get_notes');
        if (res && res.success && Array.isArray(res.notes)) {
          this.notes = res.notes;
          const container = document.getElementById('tmplNotesContainer');
          if (container) container.innerHTML = this.renderNotesList();
        }
      } catch (e) {
        console.warn('[TemplateApp] Failed to load notes:', e);
      }
    }

    async saveNote() {
      const titleInput = document.getElementById('tmplNoteTitle');
      const contentInput = document.getElementById('tmplNoteContent');
      const title = titleInput ? titleInput.value.trim() : '';
      const content = contentInput ? contentInput.value.trim() : '';

      if (!title) {
        if (this.toast) this.toast.warning(this.t('template.note_title_required'));
        return;
      }

      try {
        const res = await this.appApi.post('template_save_note', { title, content });
        if (res && res.success) {
          if (this.toast) this.toast.success(this.t('template.note_saved_toast'));
          if (titleInput) titleInput.value = '';
          if (contentInput) contentInput.value = '';
          if (res.notes) this.notes = res.notes;
          this.render();
        } else if (this.toast) {
          this.toast.error((res && res.error) || this.t('template.backend_error'));
        }
      } catch (e) {
        if (this.toast) this.toast.error(this.t('template.backend_error'));
      }
    }

    async clearNotes() {
      try {
        const res = await this.appApi.post('template_clear_notes');
        if (res && res.success) {
          this.notes = [];
          this.render();
          if (this.toast) this.toast.info(this.t('template.notes_cleared_toast'));
        } else if (this.toast) {
          this.toast.error((res && res.error) || this.t('template.backend_error'));
        }
      } catch (e) {
        if (this.toast) this.toast.error(this.t('template.backend_error'));
      }
    }

    async pingAppBackend() {
      try {
        const res = await this.appApi.get('template_ping');
        if (res && res.success && this.toast) {
          this.toast.success(this.t('template.ping_ok', { msg: res.message }));
        }
      } catch (e) {
        if (this.toast) this.toast.error(this.t('template.backend_error'));
      }
    }

    async testSystemSyscall() {
      if (!window.sys || !window.sys.api) return;
      try {
        const res = await window.sys.api.get('get_system_info');
        if (res && res.success && this.toast) {
          this.toast.success(this.t('template.syscall_ok'));
        } else if (this.toast) {
          this.toast.warning(this.t('template.backend_error'));
        }
      } catch (e) {
        if (this.toast) this.toast.error(this.t('template.backend_error'));
      }
    }

    emitDemoEvent() {
      if (window.sys && window.sys.events) {
        const payload = { timestamp: Date.now(), source: 'template-app', random: Math.floor(Math.random() * 1000) };
        window.sys.events.emit('template:ping', payload);
        if (this.toast) this.toast.info(this.t('template.event_emitted'));
      }
    }

    updateEventLogUI() {
      const container = document.getElementById('tmplEventLogContainer');
      if (container) {
        container.innerHTML = this.renderEventRows();
      }
    }

    showAboutModal() {
      if (this.dialog) {
        this.dialog.alert({
          title: this.t('template.menu_about'),
          message: this.t('template.about_message')
        });
      }
    }
  }

  const instance = new TemplateApp();
  window.TemplateApp = instance;
  if (window.sys && window.sys.appManager) {
    window.sys.appManager.register(instance);
  }
})(window);
