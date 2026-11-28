/**
 * Atelier by GallusTech - Explorer Tabular List View Plugin (apps/explorer/views/list/view.js)
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

    renderContainer(files, ctx) {
      const rows = files.map((file, idx) => this.renderItem(file, idx, ctx)).join('');
      return `
        <div class="list-table-wrapper">
          <div class="list-table-header">
            <div class="list-col-preview">${ctx.escapeHtml(ctx.t('explorer.list_preview'))}</div>
            <div class="list-col-name">${ctx.escapeHtml(ctx.t('explorer.list_name'))}</div>
            <div class="list-col-category">${ctx.escapeHtml(ctx.t('explorer.list_type'))}</div>
            <div class="list-col-size">${ctx.escapeHtml(ctx.t('explorer.list_size'))}</div>
            <div class="list-col-date">${ctx.escapeHtml(ctx.t('explorer.list_date'))}</div>
            <div class="list-col-actions">${ctx.escapeHtml(ctx.t('explorer.list_actions'))}</div>
          </div>
          <div class="list-table-body">
            ${rows}
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

      let gpsBadge = '';
      if (file.exif && file.exif.gps) {
        gpsBadge = `<button type="button" class="gps-badge" data-path="${ctx.escapeHtml(file.path)}" title="${ctx.escapeHtml(ctx.t('card.gps_locate'))}">📍 GPS</button>`;
      } else if (ctx.smartLocationsMap && ctx.smartLocationsMap.has(file.path)) {
        gpsBadge = `<button type="button" class="gps-badge magic-badge" data-path="${ctx.escapeHtml(file.path)}" title="${ctx.escapeHtml(ctx.t('card.gps_locate_deduced'))}">✨ GPS</button>`;
      }

      const canDelete = ctx.userRights ? ctx.userRights.can_delete : ctx.isAdmin;
      const canComment = ctx.userRights ? ctx.userRights.can_comment : ctx.isAdmin;
      const isFav = ctx.favorites && ctx.favorites.includes(file.path);

      const deleteBtnHtml = canDelete
        ? `<button type="button" class="delete-item-btn" data-path="${ctx.escapeHtml(file.path)}" data-name="${ctx.escapeHtml(file.name)}" data-type="file" title="${ctx.escapeHtml(ctx.t('card.delete_item'))}">🗑️</button>`
        : '';
      const favBtnHtml = `<button type="button" class="favorite-btn ${isFav ? 'is-favorite' : ''}" data-path="${ctx.escapeHtml(file.path)}" title="${ctx.escapeHtml(isFav ? ctx.t('lightbox.favorite_remove') : ctx.t('lightbox.favorite_add'))}" onclick="event.stopPropagation()">${isFav ? '❤️' : '🤍'}</button>`;
      const pipCardBtn = ['video', 'audio'].includes(file.category)
        ? `<button type="button" class="pip-card-btn" data-index="${idx}" title="${ctx.escapeHtml(ctx.t('card.pip_mode'))}" onclick="event.stopPropagation()">🗗</button>`
        : '';

      const dateFormatted = file.mtime_formatted || file.date_formatted || (file.mtime ? new Date(file.mtime * 1000).toLocaleDateString() : '—');
      const previewHtml = file.thumb_url
        ? `<img src="${ctx.escapeHtml(file.thumb_url)}" alt="" loading="lazy" draggable="false" onerror="this.style.display='none';if(this.nextElementSibling){this.nextElementSibling.style.display='flex';}" /><span class="list-preview-fallback" style="display:none;" aria-hidden="true">${categoryIcon}</span>`
        : `<span class="list-preview-fallback" aria-hidden="true">${categoryIcon}</span>`;

      return `
        <div class="list-table-row ${ctx.handleClass || ''}" data-index="${idx}" draggable="${ctx.isDraggable || 'false'}">
          <div class="list-col-preview">
            ${previewHtml}
          </div>
          <div class="list-col-name">
            <div class="list-item-main-title" title="${ctx.escapeHtml(file.name)}">${ctx.escapeHtml(file.name)}</div>
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
          <div class="list-col-actions" onclick="event.stopPropagation()">
            ${gpsBadge}
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
