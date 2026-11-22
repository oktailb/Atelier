/**
 * SimpleGallery 2026 - Centralized Icon & Thumbnail Helper
 * Factorizes media categories, file extensions, and folder icon resolution across Explorer and Desktop.
 */
(function(window) {
  'use strict';

  const EXTENSION_ICONS = {
    // Images
    'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'webp': '🖼️', 'avif': '🖼️', 'svg': '🎨', 'bmp': '🖼️', 'ico': '🖼️', 'heic': '📷', 'heif': '📷',
    // Videos
    'mp4': '🎬', 'webm': '🎬', 'ogg': '🎬', 'mov': '🎥', 'm4v': '🎬', 'mkv': '🎬', 'avi': '🎬', 'wmv': '🎬',
    // Audio
    'mp3': '🎵', 'wav': '🎵', 'flac': '🎼', 'aac': '🎵', 'm4a': '🎵', 'wma': '🎵',
    // Documents
    'pdf': '📕', 'doc': '📄', 'docx': '📄', 'xls': '📊', 'xlsx': '📊', 'ppt': '📽️', 'pptx': '📽️', 'odt': '📄', 'ods': '📊', 'odp': '📽️',
    // Code & Text
    'txt': '📝', 'md': '📝', 'markdown': '📝', 'json': '📜', 'csv': '📊', 'xml': '📜', 'html': '🌐', 'css': '🎨', 'js': '⚡', 'php': '🐘', 'py': '🐍', 'sql': '🗄️', 'yaml': '⚙️', 'yml': '⚙️', 'log': '📋',
    // Archives
    'zip': '📦', 'tar': '📦', 'gz': '📦', 'tgz': '📦', 'bz2': '📦', '7z': '📦', 'rar': '📦'
  };

  const CATEGORY_ICONS = {
    'image': '🖼️',
    'video': '🎬',
    'audio': '🎵',
    'doc': '📄',
    'archive': '📦',
    'folder': '📁',
    'app': '🗔'
  };

  class IconHelperClass {
    getFileIcon(fileOrExt) {
      if (!fileOrExt) return '📄';
      const ext = typeof fileOrExt === 'string' 
        ? fileOrExt.toLowerCase().replace(/^\./, '') 
        : (fileOrExt.extension || (fileOrExt.name ? fileOrExt.name.split('.').pop() : '')).toLowerCase();
      
      if (EXTENSION_ICONS[ext]) return EXTENSION_ICONS[ext];

      if (typeof fileOrExt === 'object' && fileOrExt.category) {
        const cat = fileOrExt.category.toLowerCase();
        if (CATEGORY_ICONS[cat]) return CATEGORY_ICONS[cat];
      }

      return '📄';
    }

    getFolderIcon(folder) {
      if (!folder) return '📁';
      if (typeof folder === 'string') return '📁';
      return folder.icon || '📁';
    }

    getCategoryIcon(category) {
      if (!category) return '📁';
      return CATEGORY_ICONS[category.toLowerCase()] || '📁';
    }

    isSafeIconUrl(val) {
      if (typeof val !== 'string') return false;
      const s = val.trim();
      if (!s || /[\x00-\x1f"'<>]/.test(s)) return false;
      if (/^https:\/\//i.test(s)) return true;
      if (/^data:image\/(png|svg\+xml|webp|jpeg|gif|x-icon);/i.test(s)) return true;
      if (/^(apps|themes|assets|storage)\/[a-zA-Z0-9_./-]+\.(png|svg|webp|ico|jpg|jpeg|gif)$/i.test(s) && !s.includes('..')) {
        return true;
      }
      return false;
    }

    escapeAttr(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    /**
     * Renders an application icon as a crisp self-healing <img> when an image URL is available,
     * falling back cleanly to an emoji if offline or when no image icon exists.
     */
    renderAppIcon(manifestOrIcon, fallbackEmoji = '🗔') {
      let iconUrl = null;
      let emoji = fallbackEmoji || '🗔';

      if (manifestOrIcon && typeof manifestOrIcon === 'object') {
        if (this.isSafeIconUrl(manifestOrIcon.icon_url)) {
          iconUrl = manifestOrIcon.icon_url.trim();
        } else if (this.isSafeIconUrl(manifestOrIcon.icon)) {
          iconUrl = manifestOrIcon.icon.trim();
        }
        if (typeof manifestOrIcon.icon === 'string' && !this.isSafeIconUrl(manifestOrIcon.icon) && manifestOrIcon.icon.trim()) {
          emoji = manifestOrIcon.icon.trim();
        }
      } else if (typeof manifestOrIcon === 'string') {
        if (this.isSafeIconUrl(manifestOrIcon)) {
          iconUrl = manifestOrIcon.trim();
        } else if (manifestOrIcon.trim()) {
          emoji = manifestOrIcon.trim();
        }
      }

      if (iconUrl) {
        const safeUrl = this.escapeAttr(iconUrl);
        const safeFallback = this.escapeAttr(emoji);
        return `<img src="${safeUrl}" class="webos-app-icon-img" alt="" loading="lazy" draggable="false" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='inline';"><span class="webos-app-icon-fallback" style="display:none;">${safeFallback}</span>`;
      }

      return emoji;
    }
  }

  window.IconHelper = new IconHelperClass();
  window.sys = window.sys || {};
  window.sys.icons = window.IconHelper;

})(window);
