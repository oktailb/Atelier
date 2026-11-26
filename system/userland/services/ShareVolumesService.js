/**
 * Atelier by GallusTech - Share, Mounted Volumes & Multi-User Session Service
 * Manages:
 * - Current user identity (`window.SG_CURRENT_USER`) and mounted volumes (`window.SG_MOUNTED_VOLUMES`)
 * - Explorer "Mounted Volumes & Shared Drives" bar with 1-click navigation & Share button
 * - Modal Share Dialog (User/Group mounted disk shares + Signed External Share Links)
 * - Automatic `?share=<token>` URL link handler (with password prompt if protected)
 */
(function (window, document) {
  'use strict';

  window.sys = window.sys || {};

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function t(key, replacements = {}) {
    if (window.I18nEngine && typeof window.I18nEngine.t === 'function') {
      return window.I18nEngine.t(key, replacements);
    }
    if (window.sys && window.sys.i18n && typeof window.sys.i18n.t === 'function') {
      return window.sys.i18n.t(key, replacements);
    }
    if (window.desktop && typeof window.desktop.t === 'function') {
      return window.desktop.t(key, replacements);
    }
    return key;
  }

  function showToast(level, msg) {
    const toast = (window.sys && window.sys.toast) || (window.sys && window.sys.ui && window.sys.ui.toast);
    if (toast && typeof toast[level] === 'function') {
      toast[level](msg);
    }
  }

  function isLightTheme() {
    const active = String(
      document.body?.getAttribute('data-theme') ||
      document.documentElement?.getAttribute('data-theme') || ''
    ).toLowerCase();
    return active.includes('light');
  }

  function formatBytesCompact(bytes) {
    const b = Number(bytes) || 0;
    if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(1) + ' Go';
    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' Mo';
    if (b >= 1024) return Math.round(b / 1024) + ' Ko';
    return b + ' o';
  }

  class ShareVolumesService {
    constructor() {
      this.currentUser = window.SG_CURRENT_USER || null;
      this.volumes = Array.isArray(window.SG_MOUNTED_VOLUMES) ? window.SG_MOUNTED_VOLUMES : [];
      this.quota = window.SG_USER_QUOTA || null;
      this.storeDriver = '';
    }

    getCurrentUser() {
      return this.currentUser || window.SG_CURRENT_USER || null;
    }

    getVolumes() {
      return Array.isArray(this.volumes) ? this.volumes : [];
    }

    getQuota() {
      return this.quota || window.SG_USER_QUOTA || null;
    }

    isLoggedIn() {
      return Boolean(window.IS_ADMIN || this.getCurrentUser());
    }

    async refreshIdentity() {
      if (!window.sys || !window.sys.api) return null;
      const res = await window.sys.api.get('get_current_user');
      if (res && res.success) {
        if (res.csrf_token && window.sys && window.sys.api && typeof window.sys.api.syncCsrfToken === 'function') {
          window.sys.api.syncCsrfToken(res.csrf_token);
        }
        this.currentUser = res.user || null;
        this.volumes = Array.isArray(res.mounted_volumes) ? res.mounted_volumes : [];
        this.quota = res.quota || null;
        this.storeDriver = res.store_driver || '';
        window.SG_CURRENT_USER = this.currentUser;
        window.SG_MOUNTED_VOLUMES = this.volumes;
        window.SG_USER_QUOTA = this.quota;
        window.SG_USER_PREFERENCES = (res.preferences && typeof res.preferences === 'object') ? res.preferences : {};
        if (res.desktop_config && typeof res.desktop_config === 'object') {
          window.SG_DESKTOP_CONFIG = res.desktop_config;
        }
        window.IS_ADMIN = Boolean(res.is_admin);
        this.updateHeaderUserBadge();
        this.emitChange();
        if (window.sys && window.sys.desktopShortcuts && typeof window.sys.desktopShortcuts.render === 'function') {
          window.sys.desktopShortcuts.render();
        }
      }
      return res;
    }

    emitChange() {
      const payload = {
        user: this.currentUser,
        isAdmin: Boolean(window.IS_ADMIN),
        volumes: this.volumes
      };
      if (window.EventBus && typeof window.EventBus.emit === 'function') {
        window.EventBus.emit('volumes:changed', payload);
        window.EventBus.emit('auth:changed', payload);
      }
      if (window.sys && window.sys.events && window.sys.events !== window.EventBus && typeof window.sys.events.emit === 'function') {
        window.sys.events.emit('volumes:changed', payload);
      }
    }

    updateHeaderUserBadge() {
      const btnEl = document.getElementById('adminBtn');
      const iconEl = document.getElementById('adminBtnIcon');
      const textEl = document.getElementById('adminBtnText');
      if (!textEl) return;
      const user = this.getCurrentUser();
      if (user) {
        const label = user.display_name || user.username;
        if (iconEl) iconEl.textContent = window.IS_ADMIN ? '🛡️' : '👤';
        textEl.textContent = label;
        if (btnEl) {
          btnEl.classList.add('active');
          btnEl.title = `${label} (@${user.username} · ${user.role})`;
        }
      } else if (window.IS_ADMIN) {
        const label = t('nav.admin');
        if (iconEl) iconEl.textContent = '🔑';
        textEl.textContent = label;
        if (btnEl) {
          btnEl.classList.add('active');
          btnEl.title = label;
        }
      } else {
        const label = t('auth.sign_in_short');
        if (iconEl) iconEl.textContent = '🔑';
        textEl.textContent = label;
        if (btnEl) {
          btnEl.classList.remove('active');
          btnEl.title = label;
        }
      }
    }

    /**
     * Renders the "Mounted Volumes & Shares" strip inside an Explorer window.
     */
    renderExplorerMountsBar(barEl, currentDir, onNavigate) {
      if (!barEl) return;
      const volumes = this.getVolumes();
      const isLoggedIn = this.isLoggedIn();
      const canShareCurrent = Boolean(
        currentDir && isLoggedIn && (
          window.IS_ADMIN ||
          (this.currentUser && currentDir.startsWith(this.currentUser.home_dir || ('users/' + this.currentUser.username)))
        )
      );

      if (volumes.length === 0 && !canShareCurrent) {
        barEl.style.display = 'none';
        barEl.innerHTML = '';
        return;
      }

      barEl.style.display = 'flex';
      const normCur = String(currentDir || '').replace(/^\/+|\/+$/g, '');

      const pillsHtml = [
        `<button type="button" class="vol-pill ${normCur === '' ? 'active' : ''}" data-vol-path="">
          <span>💾</span><span>${escapeHtml(t('nav.root'))}</span>
        </button>`
      ];

      volumes.forEach((v) => {
        const vPath = String(v.path || '').replace(/^\/+|\/+$/g, '');
        const isActive = normCur === vPath || normCur.startsWith(vPath + '/');
        const permBadge = v.kind === 'shared'
          ? `<span class="vol-perm-badge ${v.permission === 'read' ? 'is-ro' : 'is-rw'}">${v.permission === 'read' ? 'R' : 'RW'}</span>`
          : '';
        const lockIcon = v.is_encrypted ? ' 🔐' : '';
        const titleTip = v.kind === 'shared'
          ? t('volumes.shared_by_tooltip', { owner: v.owner_name || v.owner_username, perm: v.permission })
          : t('volumes.home_tooltip');

        pillsHtml.push(`
          <button type="button" class="vol-pill ${isActive ? 'active' : ''}" data-vol-path="${escapeHtml(vPath)}" title="${escapeHtml(titleTip)}">
            <span>${escapeHtml(v.mount_icon || (v.kind === 'home' ? '🏠' : '💽'))}</span>
            <span>${escapeHtml(v.mount_name)}${lockIcon}</span>
            ${permBadge}
          </button>
        `);
      });

      const quota = this.getQuota();
      const quotaPillHtml = (quota && quota.is_limited) ? `
        <span class="vol-pill vol-quota-pill" style="cursor:default;pointer-events:none;font-size:0.74rem;gap:6px;" title="${escapeHtml(formatBytesCompact(quota.used_bytes) + ' / ' + formatBytesCompact(quota.quota_bytes))}">
          <span>📊</span>
          <span>${escapeHtml(formatBytesCompact(quota.used_bytes))} / ${escapeHtml(formatBytesCompact(quota.quota_bytes))}</span>
          <span style="display:inline-block;width:44px;height:5px;border-radius:99px;background:rgba(148,163,184,0.28);overflow:hidden;">
            <span style="display:block;height:100%;width:${Math.min(100, Number(quota.percent) || 0)}%;background:${quota.percent >= 90 ? '#ef4444' : (quota.percent >= 70 ? '#f59e0b' : '#22c55e')};"></span>
          </span>
        </span>
      ` : '';

      const shareBtnHtml = canShareCurrent ? `
        <button type="button" class="vol-pill vol-share-action" data-share-path="${escapeHtml(normCur)}" style="margin-left:${quotaPillHtml ? '6px' : 'auto'};">
          <span>🔗</span><span>${escapeHtml(t('shares.share_folder_btn'))}</span>
        </button>
      ` : '';

      barEl.innerHTML = `
        <div class="explorer-volumes-list" style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; width:100%;">
          ${pillsHtml.join('')}
          ${quotaPillHtml ? `<span style="margin-left:auto;display:inline-flex;align-items:center;gap:6px;">${quotaPillHtml}${shareBtnHtml}</span>` : shareBtnHtml}
        </div>
      `;

      barEl.querySelectorAll('[data-vol-path]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (typeof onNavigate === 'function') {
            onNavigate(btn.dataset.volPath || '');
          }
        });
      });

      const shareBtn = barEl.querySelector('[data-share-path]');
      if (shareBtn) {
        shareBtn.addEventListener('click', () => {
          this.openShareDialog(shareBtn.dataset.sharePath);
        });
      }
    }

    /**
     * Opens the modal dialog to share a folder with another user/group (mounted disk) or via signed link.
     */
    async openShareDialog(folderPath) {
      const cleanPath = String(folderPath || '').replace(/^\/+|\/+$/g, '');
      if (!cleanPath || !window.sys || !window.sys.api) return;

      const [usersRes, groupsRes, sharesRes, linksRes] = await Promise.all([
        window.sys.api.get('list_users'),
        window.sys.api.get('list_groups'),
        window.sys.api.get('list_user_shares', { all: window.IS_ADMIN ? '1' : '0' }),
        window.sys.api.get('list_share_links')
      ]);

      const users = (usersRes && usersRes.success && Array.isArray(usersRes.users)) ? usersRes.users : [];
      const groups = (groupsRes && groupsRes.success && Array.isArray(groupsRes.groups)) ? groupsRes.groups : [];
      const existingShares = ((sharesRes && sharesRes.shares) || []).filter(s => String(s.source_path) === cleanPath);
      const existingLinks = ((linksRes && linksRes.links) || []).filter(l => String(l.target_path) === cleanPath && !l.revoked_at);

      const light = isLightTheme();
      const bg = light ? '#ffffff' : 'var(--window-bg, #1e293b)';
      const fg = light ? '#0f172a' : 'var(--text-main, #f8fafc)';
      const muted = light ? '#64748b' : 'var(--text-muted, #94a3b8)';
      const border = light ? 'rgba(15,23,42,0.14)' : 'rgba(255,255,255,0.12)';
      const inputBg = light ? '#f8fafc' : 'rgba(0,0,0,0.28)';

      const overlay = document.createElement('div');
      overlay.className = 'webos-share-modal-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:100100;background:rgba(15,23,42,0.72);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:16px;';

      const defaultMountName = cleanPath.split('/').pop() || cleanPath;
      const modal = document.createElement('div');
      modal.style.cssText = `width:640px;max-width:96vw;max-height:88vh;overflow-y:auto;background:${bg};color:${fg};border:1px solid ${border};border-radius:14px;box-shadow:0 24px 50px rgba(0,0,0,0.45);padding:20px;display:flex;flex-direction:column;gap:16px;`;

      const targetOptionsHtml = [
        ...users.map(u => `<option value="user:${u.id}">👤 ${escapeHtml(u.display_name || u.username)} (@${escapeHtml(u.username)})</option>`),
        ...groups.map(g => `<option value="group:${g.id}">👥 ${escapeHtml(g.display_name || g.name)}</option>`)
      ].join('');

      modal.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ${border};padding-bottom:10px;">
          <div>
            <div style="font-weight:700;font-size:1rem;">🔗 ${escapeHtml(t('shares.modal_title'))}</div>
            <div style="font-size:0.78rem;color:${muted};font-family:monospace;">/${escapeHtml(cleanPath)}</div>
          </div>
          <button type="button" class="share-modal-close" style="background:none;border:none;color:${muted};font-size:1.3rem;cursor:pointer;">✕</button>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid ${border};border-radius:10px;">
          <div style="font-weight:600;font-size:0.9rem;">💽 ${escapeHtml(t('shares.mount_section_title'))}</div>
          ${targetOptionsHtml ? `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <select id="shareTargetSelect" style="padding:7px 9px;border-radius:7px;border:1px solid ${border};background:${inputBg};color:${fg};">
                ${targetOptionsHtml}
              </select>
              <select id="sharePermSelect" style="padding:7px 9px;border-radius:7px;border:1px solid ${border};background:${inputBg};color:${fg};">
                <option value="read">${escapeHtml(t('shares.perm_read'))}</option>
                <option value="write">${escapeHtml(t('shares.perm_write'))}</option>
              </select>
            </div>
            <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;">
              <input type="text" id="shareMountNameInput" value="${escapeHtml(defaultMountName)}" placeholder="${escapeHtml(t('shares.mount_name_placeholder'))}" style="padding:7px 9px;border-radius:7px;border:1px solid ${border};background:${inputBg};color:${fg};" />
              <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.8rem;color:${muted};cursor:pointer;">
                <input type="checkbox" id="shareShowDesktop" checked />
                <span>${escapeHtml(t('shares.show_on_desktop'))}</span>
              </label>
            </div>
            <button type="button" id="shareCreateMountBtn" style="align-self:flex-start;padding:7px 14px;border-radius:7px;border:none;background:var(--accent,#4f46e5);color:#fff;font-weight:600;cursor:pointer;">
              ➕ ${escapeHtml(t('shares.add_mount_btn'))}
            </button>
          ` : `<div style="font-size:0.82rem;color:${muted};">${escapeHtml(t('shares.no_users_hint'))}</div>`}

          ${existingShares.length > 0 ? `
            <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px;">
              ${existingShares.map(s => `
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;border-radius:7px;background:${inputBg};font-size:0.82rem;">
                  <span>${escapeHtml(s.mount_icon || '💽')} <strong>${escapeHtml(s.mount_name)}</strong> → ${escapeHtml(s.target_label)} (${escapeHtml(s.permission)})</span>
                  <button type="button" class="share-revoke-mount-btn" data-id="${s.id}" style="padding:3px 8px;border-radius:5px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.75rem;">${escapeHtml(t('shares.revoke_btn'))}</button>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>

        <div style="display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid ${border};border-radius:10px;">
          <div style="font-weight:600;font-size:0.9rem;">🌐 ${escapeHtml(t('shares.link_section_title'))}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <input type="password" id="shareLinkPassInput" placeholder="${escapeHtml(t('shares.link_password_placeholder'))}" style="padding:7px 9px;border-radius:7px;border:1px solid ${border};background:${inputBg};color:${fg};" />
            <select id="shareLinkExpireSelect" style="padding:7px 9px;border-radius:7px;border:1px solid ${border};background:${inputBg};color:${fg};">
              <option value="0">${escapeHtml(t('shares.expire_never'))}</option>
              <option value="86400">24h</option>
              <option value="604800">7d</option>
              <option value="2592000">30d</option>
            </select>
          </div>
          <button type="button" id="shareCreateLinkBtn" style="align-self:flex-start;padding:7px 14px;border-radius:7px;border:none;background:#0ea5e9;color:#fff;font-weight:600;cursor:pointer;">
            🔗 ${escapeHtml(t('shares.create_link_btn'))}
          </button>

          ${existingLinks.length > 0 ? `
            <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px;">
              ${existingLinks.map(l => {
                const url = `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(l.token)}`;
                return `
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;border-radius:7px;background:${inputBg};font-size:0.78rem;">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.has_password ? '🔒 ' : '🔗 '}<code>?share=${escapeHtml(l.token.slice(0, 12))}…</code></span>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                      <button type="button" class="share-copy-link-btn" data-url="${escapeHtml(url)}" style="padding:3px 8px;border-radius:5px;border:1px solid ${border};background:transparent;color:${fg};cursor:pointer;font-size:0.75rem;">📋</button>
                      <button type="button" class="share-revoke-link-btn" data-id="${l.id}" style="padding:3px 8px;border-radius:5px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.75rem;">${escapeHtml(t('shares.revoke_btn'))}</button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          ` : ''}
        </div>
      `;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const close = () => overlay.remove();
      modal.querySelector('.share-modal-close')?.addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

      modal.querySelector('#shareCreateMountBtn')?.addEventListener('click', async () => {
        const rawTarget = modal.querySelector('#shareTargetSelect')?.value || '';
        const [targetType, targetId] = rawTarget.split(':');
        const permission = modal.querySelector('#sharePermSelect')?.value || 'read';
        const mountName = modal.querySelector('#shareMountNameInput')?.value || defaultMountName;
        const showOnDesktop = Boolean(modal.querySelector('#shareShowDesktop')?.checked);

        const res = await window.sys.api.post('create_user_share', {
          source_path: cleanPath,
          target_type: targetType,
          target_id: parseInt(targetId, 10),
          permission,
          mount_name: mountName,
          show_on_desktop: showOnDesktop ? 1 : 0
        });
        if (res && res.success) {
          showToast('success', t('shares.mount_created_toast'));
          close();
          await this.refreshIdentity();
          this.openShareDialog(cleanPath);
        } else {
          showToast('error', (res && res.error) || t('shares.action_error'));
        }
      });

      modal.querySelectorAll('.share-revoke-mount-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const res = await window.sys.api.post('revoke_user_share', { share_id: parseInt(btn.dataset.id, 10) });
          if (res && res.success) {
            showToast('info', t('shares.revoked_toast'));
            close();
            await this.refreshIdentity();
            this.openShareDialog(cleanPath);
          }
        });
      });

      modal.querySelector('#shareCreateLinkBtn')?.addEventListener('click', async () => {
        const password = modal.querySelector('#shareLinkPassInput')?.value || '';
        const ttl = parseInt(modal.querySelector('#shareLinkExpireSelect')?.value || '0', 10);
        const expiresAt = ttl > 0 ? Math.floor(Date.now() / 1000) + ttl : null;
        const res = await window.sys.api.post('create_share_link', {
          target_path: cleanPath,
          password,
          expires_at: expiresAt
        });
        if (res && res.success && res.link) {
          const shareUrl = `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(res.link.token)}`;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(shareUrl).catch(() => {});
          }
          showToast('success', t('shares.link_created_copied'));
          close();
          this.openShareDialog(cleanPath);
        } else {
          showToast('error', (res && res.error) || t('shares.action_error'));
        }
      });

      modal.querySelectorAll('.share-copy-link-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(btn.dataset.url).then(() => showToast('success', t('shares.link_copied')));
          }
        });
      });

      modal.querySelectorAll('.share-revoke-link-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const res = await window.sys.api.post('revoke_share_link', { link_id: parseInt(btn.dataset.id, 10) });
          if (res && res.success) {
            showToast('info', t('shares.revoked_toast'));
            close();
            this.openShareDialog(cleanPath);
          }
        });
      });
    }

    /**
     * Handles incoming `?share=<token>` links on page boot.
     */
    async checkIncomingShareLink() {
      if (!window.location || !window.location.search || !window.sys || !window.sys.api) return;
      const params = new URLSearchParams(window.location.search);
      const token = params.get('share');
      if (!token) return;

      let res = await window.sys.api.post('access_share_link', { token });
      if (res && res.requires_password) {
        const promptFn = window.sys.dialog && typeof window.sys.dialog.prompt === 'function'
          ? () => window.sys.dialog.prompt({ title: t('shares.link_password_prompt_title'), message: t('shares.link_password_prompt_msg') })
          : () => Promise.resolve(window.prompt(t('shares.link_password_prompt_msg')));
        const pwd = await promptFn();
        if (!pwd) return;
        res = await window.sys.api.post('access_share_link', { token, password: pwd });
      }

      if (res && res.success && res.target_path) {
        showToast('success', t('shares.link_opened_toast', { label: res.label || res.target_path }));
        setTimeout(() => {
          if (window.explorerApp && typeof window.explorerApp.open === 'function') {
            window.explorerApp.open({ dir: res.target_path });
          }
        }, 250);
      } else if (res && res.error) {
        showToast('error', res.error);
      }
    }
  }

  const service = new ShareVolumesService();
  window.ShareVolumesService = ShareVolumesService;
  window.sys.shares = service;

  if (document && typeof document.addEventListener === 'function') {
    const boot = () => {
      service.updateHeaderUserBadge();
      service.checkIncomingShareLink();
      if (window.EventBus && typeof window.EventBus.on === 'function') {
        window.EventBus.on('locale:changed', () => service.updateHeaderUserBadge());
        window.EventBus.on('auth:changed', () => service.updateHeaderUserBadge());
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
})(window, document);
