/**
 * Atelier by GallusTech - Explorer Quick Look Manager (apps/explorer/scripts/explorer-quicklook.js)
 * Instant centered overlay preview (Spacebar) for images, videos, audio, text/Markdown/code, PDF, and ZIP archives.
 * Navigable with Left/Right arrows without leaving Explorer.
 */
(function (window) {
  'use strict';

  const TEXT_EXTENSIONS = new Set([
    'txt', 'md', 'markdown', 'json', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
    'php', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'cs',
    'css', 'scss', 'less', 'html', 'htm', 'xml', 'svg', 'yaml', 'yml',
    'toml', 'ini', 'cfg', 'conf', 'sh', 'bash', 'zsh', 'sql', 'csv', 'tsv', 'log', 'env'
  ]);

  const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz']);
  const MAX_TEXT_PREVIEW_CHARS = 65536;

  class ExplorerQuickLookManager {
    constructor(instance) {
      this.inst = instance;
      this.isOpen = false;
      this.currentIndex = -1;
      this._overlay = null;
      this._keyHandler = null;
      this._loadToken = 0;
    }

    toggle(fileOrIndex) {
      if (this.isOpen) {
        this.close();
        return;
      }
      this.open(fileOrIndex);
    }

    open(fileOrIndex) {
      const files = this.inst.state.filteredFiles || [];
      if (files.length === 0) return;

      let idx = -1;
      if (typeof fileOrIndex === 'number') {
        idx = fileOrIndex;
      } else if (fileOrIndex && typeof fileOrIndex === 'object' && fileOrIndex.path) {
        idx = files.findIndex(f => f.path === fileOrIndex.path);
      } else if (this.inst.state.selectedPaths && this.inst.state.selectedPaths.size > 0) {
        const firstPath = Array.from(this.inst.state.selectedPaths)[0];
        idx = files.findIndex(f => f.path === firstPath);
      }

      if (idx < 0 || idx >= files.length) return;
      this.currentIndex = idx;
      this.isOpen = true;

      if (!this._overlay) {
        this._buildOverlay();
      }
      this._overlay.style.display = 'flex';
      this._bindKeyHandler();
      this._renderCurrent();
    }

    close() {
      this.isOpen = false;
      this._loadToken++;
      if (this._overlay) {
        // Stop any playing video/audio cleanly
        this._overlay.querySelectorAll('video, audio').forEach(el => {
          try { el.pause(); el.src = ''; } catch (e) { }
        });
        this._overlay.style.display = 'none';
      }
      this._unbindKeyHandler();
    }

    step(delta) {
      const files = this.inst.state.filteredFiles || [];
      if (!this.isOpen || files.length === 0) return;
      const next = this.currentIndex + delta;
      if (next < 0 || next >= files.length) return;
      this.currentIndex = next;
      const file = files[next];
      if (file) {
        this.inst.state.selectedPaths.clear();
        this.inst.state.selectedPaths.add(file.path);
        this.inst.state.lastSelectedIndex = next;
        this.inst.updateSelectionUI();
      }
      this._renderCurrent();
    }

    _bindKeyHandler() {
      if (this._keyHandler) return;
      this._keyHandler = (e) => {
        if (!this.isOpen) return;
        const tag = (e.target && e.target.tagName || '').toLowerCase();
        if (['input', 'textarea', 'select'].includes(tag)) return;

        if (e.key === 'Escape' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          this.step(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          this.step(1);
        } else if (e.key === 'Enter') {
          const files = this.inst.state.filteredFiles || [];
          const file = files[this.currentIndex];
          if (file) {
            e.preventDefault();
            e.stopPropagation();
            this.close();
            this.inst.openMedia(file, this.currentIndex);
          }
        }
      };
      document.addEventListener('keydown', this._keyHandler, true);
    }

    _unbindKeyHandler() {
      if (this._keyHandler) {
        document.removeEventListener('keydown', this._keyHandler, true);
        this._keyHandler = null;
      }
    }

    _buildOverlay() {
      const overlay = document.createElement('div');
      overlay.className = 'explorer-quicklook-overlay';
      overlay.style.display = 'none';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.close();
      });

      overlay.innerHTML = `
        <div class="ql-modal">
          <div class="ql-header">
            <div class="ql-title-wrap">
              <span class="ql-icon" aria-hidden="true">📄</span>
              <span class="ql-filename"></span>
              <span class="ql-counter"></span>
            </div>
            <div class="ql-header-actions">
              <button type="button" class="ql-btn ql-open-btn"></button>
              <a class="ql-btn ql-download-btn" download>⬇️</a>
              <button type="button" class="ql-btn ql-close-btn" aria-label="Close">✕</button>
            </div>
          </div>
          <div class="ql-stage">
            <button type="button" class="ql-nav-btn ql-prev-btn" aria-label="Previous">‹</button>
            <div class="ql-body"></div>
            <button type="button" class="ql-nav-btn ql-next-btn" aria-label="Next">›</button>
          </div>
          <div class="ql-footer"></div>
        </div>
      `;

      overlay.querySelector('.ql-close-btn').onclick = () => this.close();
      overlay.querySelector('.ql-prev-btn').onclick = () => this.step(-1);
      overlay.querySelector('.ql-next-btn').onclick = () => this.step(1);
      overlay.querySelector('.ql-open-btn').onclick = () => {
        const files = this.inst.state.filteredFiles || [];
        const file = files[this.currentIndex];
        if (file) {
          this.close();
          this.inst.openMedia(file, this.currentIndex);
        }
      };

      document.body.appendChild(overlay);
      this._overlay = overlay;
    }

    _getFileExtension(file) {
      if (file.extension) return String(file.extension).toLowerCase();
      const name = String(file.name || '');
      const dot = name.lastIndexOf('.');
      return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    }

    _getCategoryIcon(file) {
      if (window.IconHelper && typeof window.IconHelper.getFileIcon === 'function') {
        return window.IconHelper.getFileIcon(file);
      }
      if (file.category === 'image') return '🖼️';
      if (file.category === 'video') return '🎬';
      if (file.category === 'audio') return '🎵';
      if (file.category === 'archive') return '📦';
      return '📄';
    }

    async _renderCurrent() {
      if (!this._overlay) return;
      const files = this.inst.state.filteredFiles || [];
      const file = files[this.currentIndex];
      if (!file) {
        this.close();
        return;
      }

      const token = ++this._loadToken;
      const ext = this._getFileExtension(file);
      const icon = this._getCategoryIcon(file);

      const iconEl = this._overlay.querySelector('.ql-icon');
      const nameEl = this._overlay.querySelector('.ql-filename');
      const counterEl = this._overlay.querySelector('.ql-counter');
      const openBtn = this._overlay.querySelector('.ql-open-btn');
      const dlBtn = this._overlay.querySelector('.ql-download-btn');
      const prevBtn = this._overlay.querySelector('.ql-prev-btn');
      const nextBtn = this._overlay.querySelector('.ql-next-btn');
      const bodyEl = this._overlay.querySelector('.ql-body');
      const footerEl = this._overlay.querySelector('.ql-footer');

      if (iconEl) iconEl.textContent = icon;
      if (nameEl) {
        nameEl.textContent = file.name || '';
        nameEl.title = file.path || file.name || '';
      }
      if (counterEl) counterEl.textContent = `${this.currentIndex + 1} / ${files.length}`;
      if (openBtn) openBtn.textContent = `▶️ ${this.inst.t('explorer.open')}`;
      if (dlBtn) {
        dlBtn.href = file.download_url || `system/endpoints/thumb.php?file=${encodeURIComponent(file.path)}&download=1`;
        dlBtn.download = file.name || '';
        dlBtn.title = this.inst.t('explorer.ctx_download');
      }
      if (prevBtn) {
        prevBtn.disabled = this.currentIndex <= 0;
        prevBtn.title = this.inst.t('explorer.ql_prev');
      }
      if (nextBtn) {
        nextBtn.disabled = this.currentIndex >= files.length - 1;
        nextBtn.title = this.inst.t('explorer.ql_next');
      }

      const metaParts = [];
      if (file.size_formatted) metaParts.push(file.size_formatted);
      if (file.dimensions) metaParts.push(file.dimensions);
      const dateStr = file.mtime_formatted || file.date_formatted || (file.mtime ? new Date(file.mtime * 1000).toLocaleString() : '');
      if (dateStr) metaParts.push(dateStr);
      if (file.exif && (file.exif.make || file.exif.model)) {
        metaParts.push([file.exif.make, file.exif.model].filter(Boolean).join(' '));
      }
      if (file.exif && file.exif.gps) {
        metaParts.push(`📍 ${file.exif.gps.lat.toFixed(4)}, ${file.exif.gps.lng.toFixed(4)}`);
      }
      if (footerEl) footerEl.textContent = metaParts.join('  ·  ');

      const rawUrl = file.file_url || `system/endpoints/thumb.php?file=${encodeURIComponent(file.path)}&raw=1`;

      // 1. Image preview
      if (file.category === 'image' && ext !== 'svg') {
        bodyEl.innerHTML = `<img class="ql-image" src="${this.inst.escapeHtml(rawUrl)}" alt="${this.inst.escapeHtml(file.name)}" draggable="false" />`;
        return;
      }

      // 2. Video preview
      if (file.category === 'video') {
        bodyEl.innerHTML = `<video class="ql-video" src="${this.inst.escapeHtml(rawUrl)}" controls autoplay playsinline></video>`;
        return;
      }

      // 3. Audio preview
      if (file.category === 'audio') {
        bodyEl.innerHTML = `
          <div class="ql-audio-card">
            <div class="ql-audio-icon">🎵</div>
            <div class="ql-audio-title">${this.inst.escapeHtml(file.name)}</div>
            <audio class="ql-audio" src="${this.inst.escapeHtml(rawUrl)}" controls autoplay></audio>
          </div>`;
        return;
      }

      // 4. PDF preview
      if (ext === 'pdf') {
        bodyEl.innerHTML = `<iframe class="ql-pdf-frame" src="${this.inst.escapeHtml(rawUrl)}" title="${this.inst.escapeHtml(file.name)}"></iframe>`;
        return;
      }

      // 5. Text / Markdown / Code preview
      if (TEXT_EXTENSIONS.has(ext)) {
        bodyEl.innerHTML = `<div class="ql-status">${this.inst.escapeHtml(this.inst.t('explorer.ql_loading'))}</div>`;
        try {
          const text = await window.sys.api.getText(rawUrl, { cache: 'no-store' });
          if (token !== this._loadToken) return;
          const truncated = text.length > MAX_TEXT_PREVIEW_CHARS;
          const slice = truncated ? text.slice(0, MAX_TEXT_PREVIEW_CHARS) : text;
          const notice = truncated ? `<div class="ql-notice">${this.inst.escapeHtml(this.inst.t('explorer.ql_text_truncated'))}</div>` : '';

          if ((ext === 'md' || ext === 'markdown') && window.marked && typeof window.marked.parse === 'function') {
            const rawHtml = window.marked.parse(slice);
            const safeHtml = this._sanitizePreviewHtml(rawHtml);
            bodyEl.innerHTML = `${notice}<div class="ql-markdown-body">${safeHtml}</div>`;
          } else {
            bodyEl.innerHTML = `${notice}<pre class="ql-code-pre"><code>${this.inst.escapeHtml(slice)}</code></pre>`;
          }
        } catch (err) {
          if (token !== this._loadToken) return;
          bodyEl.innerHTML = `<div class="ql-status">⚠️ ${this.inst.escapeHtml(this.inst.t('explorer.ql_error'))}</div>`;
        }
        return;
      }

      // 6. Archive / ZIP preview
      if (file.category === 'archive' || ARCHIVE_EXTENSIONS.has(ext)) {
        bodyEl.innerHTML = `<div class="ql-status">${this.inst.escapeHtml(this.inst.t('explorer.ql_loading'))}</div>`;
        try {
          const res = await window.sys.api.get('get_metadata', { file: file.path });
          if (token !== this._loadToken) return;
          const arch = res && res.success && res.metadata && res.metadata.archive;
          if (arch && (Array.isArray(arch.files_sample) || typeof arch.files_count === 'number')) {
            const sample = Array.isArray(arch.files_sample) ? arch.files_sample : [];
            const summary = this.inst.t('explorer.ql_archive_summary', {
              count: arch.files_count || sample.length,
              size: arch.uncompressed_size_formatted || file.size_formatted || '—'
            });
            const rowsHtml = sample.length > 0
              ? sample.map(entry => {
                  const entryName = (typeof entry === 'string') ? entry : (entry.name || entry.path || '');
                  const entrySize = (typeof entry === 'object' && entry.size_formatted) ? entry.size_formatted : '';
                  return `<div class="ql-archive-row"><span class="ql-archive-name">📄 ${this.inst.escapeHtml(entryName)}</span>${entrySize ? `<span class="ql-archive-size">${this.inst.escapeHtml(entrySize)}</span>` : ''}</div>`;
                }).join('')
              : `<div class="ql-status">${this.inst.escapeHtml(this.inst.t('explorer.ql_archive_empty'))}</div>`;
            bodyEl.innerHTML = `
              <div class="ql-archive-view">
                <div class="ql-archive-summary">📦 ${this.inst.escapeHtml(summary)}</div>
                <div class="ql-archive-list">${rowsHtml}</div>
              </div>`;
          } else {
            bodyEl.innerHTML = `<div class="ql-status">${this.inst.escapeHtml(this.inst.t('explorer.ql_archive_empty'))}</div>`;
          }
        } catch (err) {
          if (token !== this._loadToken) return;
          bodyEl.innerHTML = `<div class="ql-status">${this.inst.escapeHtml(this.inst.t('explorer.ql_archive_empty'))}</div>`;
        }
        return;
      }

      // 7. Generic fallback
      bodyEl.innerHTML = `
        <div class="ql-fallback-card">
          <div class="ql-fallback-icon">${icon}</div>
          <div class="ql-fallback-name">${this.inst.escapeHtml(file.name)}</div>
          <div class="ql-fallback-note">${this.inst.escapeHtml(this.inst.t('explorer.ql_unsupported'))}</div>
        </div>`;
    }

    _sanitizePreviewHtml(html) {
      const tpl = document.createElement('template');
      tpl.innerHTML = String(html || '');
      tpl.content.querySelectorAll('script, iframe, object, embed, form, link, style').forEach(el => el.remove());
      tpl.content.querySelectorAll('*').forEach(el => {
        Array.from(el.attributes).forEach(attr => {
          const n = attr.name.toLowerCase();
          const v = String(attr.value || '').trim().toLowerCase();
          if (n.startsWith('on') || ((n === 'href' || n === 'src') && v.startsWith('javascript:'))) {
            el.removeAttribute(attr.name);
          }
        });
      });
      return tpl.innerHTML;
    }

    destroy() {
      this.close();
      if (this._overlay && this._overlay.parentElement) {
        this._overlay.parentElement.removeChild(this._overlay);
      }
      this._overlay = null;
    }
  }

  window.ExplorerQuickLookManager = ExplorerQuickLookManager;
})(window);
