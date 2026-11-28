/**
 * Atelier by GallusTech - Explorer Unified Pro List View Plugin (apps/explorer/views/list/view.js)
 * Folders first, sortable column headers (▲/▼), selection checkboxes, compact Tags/GPS/Shared badges,
 * and incremental chunked rendering support for large directories.
 */
(function(window) {
  'use strict';

  const ListViewPlugin = {
    id: 'list',
    icon: '📑',
    name: 'Liste',
    nameKey: 'view.list',
    containerClass: 'tabular-list-container',
    cssPath: 'apps/explorer/views/list/view.css',
    supportsUnifiedFolders: true,

    _sortArrow(col, ctx) {
      const sortBy = ctx.sortBy || 'name';
      const normalized = (sortBy === 'mtime' || sortBy === 'exif_date') ? 'date' : sortBy;
      if (normalized !== col) return '<span class="list-sort-indicator" aria-hidden="true">⇅</span>';
      const arrow = (ctx.sortOrder === 'desc') ? '▼' : '▲';
      return `<span class="list-sort-indicator active" aria-hidden="true">${arrow}</span>`;
    },

    renderContainer(files, ctx) {
      const folders = Array.isArray(ctx.directories) ? ctx.directories : [];
      const folderRows = folders.map(dir => this.renderFolderRow(dir, ctx)).join('');
      const fileRows = files.map((file, idx) => this.renderItem(file, idx, ctx)).join('');
      const totalCount = folders.length + (ctx.totalFileCount !== undefined ? ctx.totalFileCount : files.length);
      const selectedSize = ctx.selectedPaths ? ctx.selectedPaths.size : 0;
      const allChecked = totalCount > 0 && selectedSize >= totalCount;

      const sortHeader = (col, labelKey, extraClass) => {
        const label = ctx.t(labelKey);
        const sortBy = ctx.sortBy || 'name';
        const normalized = (sortBy === 'mtime' || sortBy === 'exif_date') ? 'date' : sortBy;
        const isActive = normalized === col;
        return `<button type="button" class="list-sort-btn ${extraClass} ${isActive ? 'is-sorted' : ''}" data-sort-col="${col}" title="${ctx.escapeHtml(ctx.t('explorer.list_sort_col', { col: label }))}"><span>${ctx.escapeHtml(label)}</span>${this._sortArrow(col, ctx)}</button>`;
      };

      return `
        <div class="list-table-wrapper">
          <div class="list-table-header" role="row">
            <div class="list-col-check">
              <input type="checkbox" class="list-select-all-cb" ${allChecked ? 'checked' : ''} aria-label="${ctx.escapeHtml(ctx.t('explorer.list_select_all'))}" title="${ctx.escapeHtml(ctx.t('explorer.list_select_all'))}" />
            </div>
            <div class="list-col-preview-hdr">${ctx.escapeHtml(ctx.t('explorer.list_preview'))}</div>
            ${sortHeader('name', 'explorer.list_name', 'list-col-name')}
            ${sortHeader('category', 'explorer.list_type', 'list-col-category')}
            ${sortHeader('size', 'explorer.list_size', 'list-col-size')}
            ${sortHeader('date', 'explorer.list_date', 'list-col-date')}
            <div class="list-col-actions-hdr">${ctx.escapeHtml(ctx.t('explorer.list_actions'))}</div>
          </div>
          <div class="list-table-body">
            ${folderRows}
            ${fileRows}
          </div>
        </div>
      `;
    },

    renderFolderRow(folder, ctx) {
      const isSelected = Boolean(ctx.selectedPaths && ctx.selectedPaths.has(folder.path));
      const isProtected = Boolean(folder.is_protected);
      const isLocked = isProtected && !folder.is_unlocked && !ctx.isAdmin;
      const icon = isLocked ? '🔒' : '📁';
      const dateFormatted = folder.mtime ? new Date(folder.mtime * 1000).toLocaleDateString() : '—';
      const countText = (typeof folder.item_count === 'number')
        ? ctx.t('folder.items_count', { count: folder.item_count })
        : '—';
      const canDelete = ctx.isAdmin || (ctx.userRights && ctx.userRights.can_delete);
      const badgesHtml = [
        isProtected ? '<span class="list-inline-badge badge-lock" title="🔒">🔒</span>' : '',
        folder.is_shared ? '<span class="list-inline-badge badge-share" title="🤝">🤝</span>' : ''
      ].filter(Boolean).join('');

      const previewHtml = (!isLocked && folder.cover)
        ? `<img src="${ctx.escapeHtml(folder.cover)}" alt="" loading="lazy" draggable="false" onerror="this.style.display='none';if(this.nextElementSibling){this.nextElementSibling.style.display='flex';}" /><span class="list-preview-fallback" style="display:none;" aria-hidden="true">${icon}</span>`
        : `<span class="list-preview-fallback" aria-hidden="true">${icon}</span>`;

      return `
        <div class="list-table-row list-table-row-folder ${ctx.handleClass || ''} ${isSelected ? 'selected' : ''}" data-path="${ctx.escapeHtml(folder.path)}" data-protected="${isProtected ? '1' : '0'}" data-unlocked="${folder.is_unlocked ? '1' : '0'}" draggable="${ctx.isDraggable || 'false'}" role="row">
          <div class="list-col-check">
            <input type="checkbox" class="list-row-cb" data-select-path="${ctx.escapeHtml(folder.path)}" ${isSelected ? 'checked' : ''} aria-label="${ctx.escapeHtml(folder.name)}" />
          </div>
          <div class="list-col-preview">${previewHtml}</div>
          <div class="list-col-name">
            <div class="list-name-line">
              <span class="list-item-main-title list-folder-title" title="${ctx.escapeHtml(folder.name)}">${ctx.escapeHtml(folder.name)}</span>
              ${badgesHtml}
            </div>
            ${folder.comment ? `<div class="list-item-sub-comment" title="${ctx.escapeHtml(folder.comment)}">${ctx.escapeHtml(folder.comment)}</div>` : ''}
          </div>
          <div class="list-col-category">
            <span class="list-category-badge list-folder-badge">📁 ${ctx.escapeHtml(ctx.t('explorer.list_folder_type'))}</span>
          </div>
          <div class="list-col-size"><span>${ctx.escapeHtml(countText)}</span></div>
          <div class="list-col-date"><span>${ctx.escapeHtml(dateFormatted)}</span></div>
          <div class="list-col-actions">
            ${ctx.isAdmin ? `<button type="button" class="folder-settings-btn list-inline-action-btn" data-path="${ctx.escapeHtml(folder.path)}" data-name="${ctx.escapeHtml(folder.name)}" title="${ctx.escapeHtml(ctx.t('nav.folder_settings'))}">⚙️</button>` : ''}
            ${canDelete ? `<button type="button" class="delete-item-btn" data-path="${ctx.escapeHtml(folder.path)}" data-name="${ctx.escapeHtml(folder.name)}" data-type="folder" title="${ctx.escapeHtml(ctx.t('folder.delete_title'))}">🗑️</button>` : ''}
          </div>
        </div>
      `;
    },

    renderItem(file, idx, ctx) {
      let categoryIcon = '📄';
      if (file.category === 'image') categoryIcon = '🖼️';
      else if (file.category === 'video') categoryIcon = '🎬';
      else if (file.category === 'audio') categoryIcon = '🎵';
      else if (file.category === 'archive') categoryIcon = '📦';

      const isSelected = Boolean(ctx.selectedPaths && ctx.selectedPaths.has(file.path));

      let gpsBadge = '';
      if (file.exif && file.exif.gps) {
        gpsBadge = `<button type="button" class="gps-badge list-inline-badge" data-path="${ctx.escapeHtml(file.path)}" title="${ctx.escapeHtml(ctx.t('card.gps_locate'))}">📍 GPS</button>`;
      } else if (ctx.smartLocationsMap && ctx.smartLocationsMap.has(file.path)) {
        gpsBadge = `<button type="button" class="gps-badge magic-badge list-inline-badge" data-path="${ctx.escapeHtml(file.path)}" title="${ctx.escapeHtml(ctx.t('card.gps_locate_deduced'))}">✨ GPS</button>`;
      }

      const tagsHtml = (Array.isArray(file.tags) && file.tags.length > 0)
        ? file.tags.slice(0, 2).map(t => `<span class="list-inline-badge badge-tag">🏷️ ${ctx.escapeHtml(t)}</span>`).join('')
        : '';

      const canDelete = ctx.userRights ? ctx.userRights.can_delete : ctx.isAdmin;
      const canComment = ctx.userRights ? ctx.userRights.can_comment : ctx.isAdmin;
      const isFav = ctx.favorites && ctx.favorites.includes(file.path);

      const deleteBtnHtml = canDelete
        ? `<button type="button" class="delete-item-btn" data-path="${ctx.escapeHtml(file.path)}" data-name="${ctx.escapeHtml(file.name)}" data-type="file" title="${ctx.escapeHtml(ctx.t('card.delete_item'))}">🗑️</button>`
        : '';
      const favBtnHtml = `<button type="button" class="favorite-btn ${isFav ? 'is-favorite' : ''}" data-path="${ctx.escapeHtml(file.path)}" title="${ctx.escapeHtml(isFav ? ctx.t('lightbox.favorite_remove') : ctx.t('lightbox.favorite_add'))}">${isFav ? '❤️' : '🤍'}</button>`;
      const pipCardBtn = ['video', 'audio'].includes(file.category)
        ? `<button type="button" class="pip-card-btn" data-index="${idx}" title="${ctx.escapeHtml(ctx.t('card.pip_mode'))}">🗗</button>`
        : '';

      const dateFormatted = file.mtime_formatted || file.date_formatted || (file.mtime ? new Date(file.mtime * 1000).toLocaleDateString() : '—');
      const previewHtml = file.thumb_url
        ? `<img src="${ctx.escapeHtml(file.thumb_url)}" alt="" loading="lazy" draggable="false" onerror="this.style.display='none';if(this.nextElementSibling){this.nextElementSibling.style.display='flex';}" /><span class="list-preview-fallback" style="display:none;" aria-hidden="true">${categoryIcon}</span>`
        : `<span class="list-preview-fallback" aria-hidden="true">${categoryIcon}</span>`;

      return `
        <div class="list-table-row ${ctx.handleClass || ''} ${isSelected ? 'selected' : ''}" data-index="${idx}" data-path="${ctx.escapeHtml(file.path)}" draggable="${ctx.isDraggable || 'false'}" role="row">
          <div class="list-col-check">
            <input type="checkbox" class="list-row-cb" data-select-index="${idx}" data-select-path="${ctx.escapeHtml(file.path)}" ${isSelected ? 'checked' : ''} aria-label="${ctx.escapeHtml(file.name)}" />
          </div>
          <div class="list-col-preview">
            ${previewHtml}
          </div>
          <div class="list-col-name">
            <div class="list-name-line">
              <span class="list-item-main-title" title="${ctx.escapeHtml(file.name)}">${ctx.escapeHtml(file.name)}</span>
              ${tagsHtml}
              ${gpsBadge}
            </div>
            ${file.comment ? `<div class="list-item-sub-comment" title="${ctx.escapeHtml(file.comment)}">${ctx.escapeHtml(file.comment)}</div>` : ''}
          </div>
          <div class="list-col-category">
            <span class="list-category-badge">${categoryIcon} ${ctx.escapeHtml(file.category || 'file')}</span>
          </div>
          <div class="list-col-size">
            <span>${file.size_formatted || '—'}</span>
          </div>
          <div class="list-col-date">
            <span>${ctx.escapeHtml(dateFormatted)}</span>
          </div>
          <div class="list-col-actions">
            ${canComment ? `<button type="button" class="edit-media-comment-btn" data-filename="${ctx.escapeHtml(file.name)}" data-comment="${ctx.escapeHtml(file.comment || '')}" title="${ctx.escapeHtml(ctx.t('card.edit_comment'))}">✏️</button>` : ''}
            ${pipCardBtn}
            ${favBtnHtml}
            ${deleteBtnHtml}
          </div>
        </div>
      `;
    }
  };

  if (window.GalleryViewRegistry) {
    window.GalleryViewRegistry.register(ListViewPlugin);
  }
})(window);
