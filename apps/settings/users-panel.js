/**
 * Atelier by GallusTech — Modular Admin & Account Sections for Left-Sidebar Control Panel
 * Provides focused, well-scoped sections:
 *  - `users`        : Pending Approvals, User Accounts (with quota/2FA badges), Groups & Teams
 *  - `registration` : Self-Registration Policy, 2FA Policy, OIDC / SSO Provider, Invitation Links
 *  - `mail`         : Email / SMTP Transport Configuration, Test Delivery, Local Outbox Viewer
 *  - `shares`       : Mounted User/Group Shares, Signed External Links (`/s/<token>`), Audit Log
 *  - `sessions`     : Active Sessions & Remote Revocation card embedded in Security tab
 */
(function (window) {
  'use strict';

  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatTs(ts) {
    if (!ts) return '—';
    try {
      return new Date(Number(ts) * 1000).toLocaleString();
    } catch (e) {
      return String(ts);
    }
  }

  function formatQuotaMb(bytes) {
    const b = Number(bytes) || 0;
    if (b <= 0) return '∞';
    if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(1) + ' Go';
    return Math.round(b / (1024 * 1024)) + ' Mo';
  }

  function copyText(str) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(str);
    }
    return Promise.resolve();
  }

  const rowStyle = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);flex-wrap:wrap;';
  const inputStyle = 'padding:7px 10px;border-radius:7px;border:1px solid var(--border-color);background:var(--bg-main);color:var(--text-main);font-size:0.84rem;';
  const labelStyle = 'display:flex;flex-direction:column;gap:4px;font-size:0.78rem;color:var(--text-muted);';

  const PERM_OVERRIDE_KEYS = [
    { key: 'can_upload', labelKey: 'admin.perm_upload' },
    { key: 'can_delete', labelKey: 'admin.perm_delete' },
    { key: 'can_move', labelKey: 'admin.perm_move' },
    { key: 'can_comment', labelKey: 'admin.perm_comment' },
    { key: 'can_create_folder', labelKey: 'admin.perm_create_folder' },
    { key: 'can_download_archive', labelKey: 'admin.perm_download_archive' },
    { key: 'can_download_item', labelKey: 'admin.perm_download_item' },
    { key: 'can_use_browser_proxy', labelKey: 'settings.perm_browser_proxy' }
  ];

  function renderOverridesEditor(targetType, targetId, overrides, t) {
    const ov = (overrides && typeof overrides === 'object') ? overrides : {};
    const count = Object.keys(ov).length;
    const badge = count > 0
      ? `<span style="margin-left:6px;padding:1px 7px;border-radius:99px;font-size:0.68rem;background:rgba(99,102,241,0.18);color:var(--accent-primary,#6366f1);font-weight:700;">${esc(t('users.perm_overrides_count', { count }))}</span>`
      : '';
    return `
      <details class="perm-overrides-details" style="width:100%;margin-top:6px;border-top:1px dashed var(--border-color);padding-top:6px;">
        <summary style="cursor:pointer;font-size:0.76rem;color:var(--text-muted);user-select:none;">
          🔑 ${esc(t('users.perm_overrides_btn'))}${badge}
        </summary>
        <div class="perm-overrides-grid" data-ov-type="${targetType}" data-ov-id="${targetId}" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px;margin-top:8px;">
          ${PERM_OVERRIDE_KEYS.map(p => {
            const cur = ov[p.key] === 'allow' || ov[p.key] === 'deny' ? ov[p.key] : 'inherit';
            return `
              <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:0.76rem;padding:4px 8px;border-radius:6px;background:var(--bg-main);border:1px solid var(--border-color);">
                <span style="color:var(--text-main);">${esc(t(p.labelKey))}</span>
                <select class="perm-ov-select" data-perm-key="${p.key}" style="padding:3px 6px;border-radius:5px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-main);font-size:0.74rem;">
                  <option value="inherit" ${cur === 'inherit' ? 'selected' : ''}>${esc(t('settings.perm_inherit'))}</option>
                  <option value="allow" ${cur === 'allow' ? 'selected' : ''}>${esc(t('settings.perm_allow'))}</option>
                  <option value="deny" ${cur === 'deny' ? 'selected' : ''}>${esc(t('settings.perm_deny'))}</option>
                </select>
              </label>
            `;
          }).join('')}
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:8px;">
          <button type="button" class="perm-ov-save-btn" data-ov-type="${targetType}" data-ov-id="${targetId}" style="padding:4px 12px;border-radius:6px;border:none;background:var(--accent-primary,#6366f1);color:#fff;cursor:pointer;font-size:0.75rem;font-weight:600;">
            💾 ${esc(t('users.save_perms_btn'))}
          </button>
        </div>
      </details>
    `;
  }

  function renderAdminRequired(container, settingsApp, titleKey, icon) {
    container.innerHTML = window.sys.ui.card({
      title: titleKey,
      icon: icon || '🛡️',
      content: `<p style="font-size:0.88rem;color:var(--text-muted);margin:0;">${esc(settingsApp.t('users.admin_required'))}</p>`
    });
  }

  // ---------------------------------------------------------------------------
  // ACTIVE SESSIONS CARD (Embedded in Security tab for any logged-in user)
  // ---------------------------------------------------------------------------
  async function renderSessionsCard(container, settingsApp) {
    if (!container || !settingsApp) return;
    const t = (k, p) => settingsApp.t(k, p);
    const res = await settingsApp.api.get('list_sessions', settingsApp.isAdmin ? { all: '1' } : {});
    const sessions = (res && res.success && Array.isArray(res.sessions)) ? res.sessions : [];

    const content = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <span style="font-size:0.8rem;color:var(--text-muted);">${esc(t('users.sessions_hint'))}</span>
        ${sessions.length > 1 ? `
          <button type="button" id="settingsRevokeOtherSessionsBtn" class="sysmon-action-btn" style="padding:5px 11px;font-size:0.76rem;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;">
            🚪 ${esc(t('users.revoke_others_btn'))}
          </button>
        ` : ''}
      </div>
      ${sessions.length === 0
        ? `<div style="font-size:0.83rem;color:var(--text-muted);">${esc(t('users.empty_sessions'))}</div>`
        : `<div style="display:flex;flex-direction:column;gap:6px;">
            ${sessions.map(s => `
              <div style="${rowStyle}">
                <div style="display:flex;flex-direction:column;gap:2px;font-size:0.82rem;">
                  <div style="font-weight:600;color:var(--text-main);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span>💻 ${esc(s.device_label || 'Browser')}</span>
                    <span style="font-weight:400;color:var(--text-muted);">(@${esc(s.username)})</span>
                    ${s.is_current ? `<span style="padding:1px 7px;border-radius:99px;font-size:0.68rem;background:rgba(34,197,94,0.16);color:#22c55e;font-weight:700;">${esc(t('users.session_current_badge'))}</span>` : ''}
                  </div>
                  <div style="font-size:0.74rem;color:var(--text-muted);">
                    IP: ${esc(s.ip_address || '—')} · ${esc(t('users.session_last_seen'))}: ${esc(formatTs(s.last_seen_at))}
                  </div>
                </div>
                ${!s.is_current ? `
                  <button type="button" class="panel-revoke-session-btn" data-id="${s.id}" style="padding:4px 9px;border-radius:6px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.74rem;">
                    ${esc(t('shares.revoke_btn'))}
                  </button>
                ` : ''}
              </div>
            `).join('')}
          </div>`}
    `;

    container.innerHTML = window.sys.ui.card({
      title: 'users.section_sessions',
      icon: '💻',
      content
    });

    container.querySelector('#settingsRevokeOtherSessionsBtn')?.addEventListener('click', async () => {
      const r = await settingsApp.api.post('revoke_other_sessions', {});
      if (r && r.success) {
        settingsApp.toast.info(t('users.sessions_revoked_toast'));
        renderSessionsCard(container, settingsApp);
      }
    });

    container.querySelectorAll('.panel-revoke-session-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const r = await settingsApp.api.post('revoke_session', { session_id: parseInt(btn.dataset.id, 10) });
        if (r && r.success) {
          settingsApp.toast.info(t('users.sessions_revoked_toast'));
          renderSessionsCard(container, settingsApp);
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // SECTION 1: USERS & GROUPS (`users`)
  // ---------------------------------------------------------------------------
  async function renderUsersAndGroupsSection(container, settingsApp) {
    const t = (k, p) => settingsApp.t(k, p);
    if (!settingsApp.isAdmin) {
      return renderAdminRequired(container, settingsApp, 'settings.tab_users_accounts', '👤');
    }

    container.innerHTML = `<div style="padding:18px;color:var(--text-muted);font-size:0.9rem;">${esc(t('common.loading'))}</div>`;

    const [meRes, usersRes, groupsRes, authCfgRes] = await Promise.all([
      settingsApp.api.get('get_current_user'),
      settingsApp.api.get('list_users'),
      settingsApp.api.get('list_groups'),
      settingsApp.api.get('get_auth_settings')
    ]);

    const driver = (meRes && meRes.store_driver) ? String(meRes.store_driver) : 'json';
    const users = (usersRes && usersRes.success && Array.isArray(usersRes.users)) ? usersRes.users : [];
    const groups = (groupsRes && groupsRes.success && Array.isArray(groupsRes.groups)) ? groupsRes.groups : [];
    const pendingUsers = (authCfgRes && authCfgRes.success && Array.isArray(authCfgRes.pending_users)) ? authCfgRes.pending_users : [];

    const pendingCardHtml = pendingUsers.length > 0 ? window.sys.ui.card({
      title: 'users.section_pending',
      icon: '⏳',
      content: `
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${pendingUsers.map(u => `
            <div style="${rowStyle}">
              <div style="display:flex;flex-direction:column;gap:2px;">
                <div style="font-weight:600;font-size:0.88rem;color:var(--text-main);">
                  👤 ${esc(u.display_name || u.username)} <span style="color:var(--text-muted);font-weight:400;">(@${esc(u.username)})</span>
                </div>
                <div style="font-size:0.76rem;color:var(--text-muted);">
                  ✉️ ${esc(u.email || '—')} · ${u.email_verified ? '✅ ' + esc(t('users.email_verified_badge')) : '⏳ ' + esc(t('users.email_unverified_badge'))}
                </div>
              </div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="users-approve-btn" data-id="${u.id}" style="padding:5px 10px;border-radius:6px;border:none;background:#22c55e;color:#fff;cursor:pointer;font-size:0.76rem;font-weight:600;">
                  ✅ ${esc(t('users.approve_btn'))}
                </button>
                <button type="button" class="users-reject-btn" data-id="${u.id}" style="padding:5px 10px;border-radius:6px;border:1px solid rgba(239,68,68,0.45);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.76rem;font-weight:600;">
                  ❌ ${esc(t('users.reject_btn'))}
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `
    }) : '';

    const usersListHtml = users.length === 0
      ? `<div style="font-size:0.84rem;color:var(--text-muted);padding:6px 0;">${esc(t('users.empty_users'))}</div>`
      : `<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">
          ${users.map(u => {
            const active = Boolean(u.is_active);
            const roleColor = (u.role === 'admin' || u.role === 'superadmin') ? '#f59e0b' : '#38bdf8';
            return `
              <div style="${rowStyle}">
                <div style="display:flex;flex-direction:column;gap:3px;">
                  <div style="font-weight:600;font-size:0.88rem;color:var(--text-main);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span>👤 ${esc(u.display_name || u.username)}</span>
                    <span style="font-weight:400;color:var(--text-muted);">(@${esc(u.username)})</span>
                    <span style="padding:1px 7px;border-radius:99px;font-size:0.7rem;background:rgba(56,189,248,0.14);color:${roleColor};font-weight:700;">${esc(u.role)}</span>
                    ${u.has_2fa ? `<span style="padding:1px 7px;border-radius:99px;font-size:0.7rem;background:rgba(34,197,94,0.16);color:#22c55e;font-weight:700;">🛡️ 2FA</span>` : ''}
                    <span style="padding:1px 7px;border-radius:99px;font-size:0.7rem;background:rgba(148,163,184,0.16);color:var(--text-muted);">💾 ${esc(formatQuotaMb(u.quota_bytes))}</span>
                  </div>
                  <div style="font-size:0.75rem;color:var(--text-muted);display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <button type="button" class="users-open-home-btn" data-home="${esc(u.home_dir)}" style="padding:2px 7px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--accent-primary, #6366f1);cursor:pointer;font-size:0.75rem;font-family:monospace;">
                      📂 /${esc(u.home_dir)}
                    </button>
                    ${u.email ? `<span>✉️ ${esc(u.email)}</span>` : ''}
                  </div>
                </div>
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                  ${u.has_2fa ? `
                    <button type="button" class="users-reset-2fa-btn" data-id="${u.id}" data-username="${esc(u.username)}" style="padding:4px 9px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:#f59e0b;cursor:pointer;font-size:0.74rem;font-weight:600;">
                      🔓 ${esc(t('users.reset_2fa_btn'))}
                    </button>
                  ` : ''}
                  <button type="button" class="users-toggle-active-btn" data-id="${u.id}" data-active="${active ? '1' : '0'}" style="padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:${active ? '#22c55e' : '#ef4444'};cursor:pointer;font-size:0.76rem;font-weight:600;">
                    ${esc(active ? t('users.status_active') : t('users.status_disabled'))}
                  </button>
                  <button type="button" class="users-delete-btn" data-id="${u.id}" data-username="${esc(u.username)}" style="padding:4px 9px;border-radius:6px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.76rem;">
                    🗑️ ${esc(t('common.delete'))}
                  </button>
                </div>
                ${(u.role !== 'admin' && u.role !== 'superadmin') ? renderOverridesEditor('user', u.id, u.permission_overrides, t) : ''}
              </div>
            `;
          }).join('')}
        </div>`;

    const usersSectionHtml = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <span style="font-size:0.78rem;color:var(--text-muted);padding:3px 9px;border-radius:99px;border:1px solid var(--border-color);">
          🗄️ ${esc(t('users.store_driver_label'))}: <strong>${esc(driver.toUpperCase())}</strong>
        </span>
        <button type="button" id="usersPanelRefreshBtn" class="sysmon-action-btn" style="padding:5px 12px;font-size:0.78rem;">
          🔄 ${esc(t('users.refresh_btn'))}
        </button>
      </div>
      <form id="usersCreateForm" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;align-items:center;">
        <input type="text" id="newUserUsername" placeholder="${esc(t('users.username_placeholder'))}" required pattern="[a-zA-Z0-9._-]{2,32}" style="${inputStyle}" />
        <input type="text" id="newUserDisplayName" placeholder="${esc(t('users.display_name_placeholder'))}" style="${inputStyle}" />
        <input type="email" id="newUserEmail" placeholder="${esc(t('users.email_placeholder'))}" style="${inputStyle}" />
        <input type="password" id="newUserPassword" placeholder="${esc(t('users.password_placeholder'))}" required minlength="6" style="${inputStyle}" />
        <input type="number" id="newUserQuotaMb" min="0" placeholder="${esc(t('users.quota_mb_placeholder'))}" style="${inputStyle}" />
        <select id="newUserRole" style="${inputStyle}">
          <option value="user">${esc(t('users.role_user'))}</option>
          <option value="guest">${esc(t('users.role_guest'))}</option>
          <option value="admin">${esc(t('users.role_admin'))}</option>
        </select>
        <button type="submit" class="sysmon-action-btn" style="padding:7px 14px;background:var(--accent-primary, #6366f1);color:#fff;font-weight:600;justify-content:center;">
          ➕ ${esc(t('users.create_user_btn'))}
        </button>
      </form>
      ${usersListHtml}
    `;

    const groupsListHtml = groups.length === 0
      ? `<div style="font-size:0.84rem;color:var(--text-muted);padding:6px 0;">${esc(t('users.empty_groups'))}</div>`
      : `<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">
          ${groups.map(g => {
            const memberIds = Array.isArray(g.member_ids) ? g.member_ids.map(Number) : [];
            return `
              <div style="${rowStyle};flex-direction:column;align-items:stretch;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                  <div style="font-weight:600;font-size:0.88rem;color:var(--text-main);">
                    👥 ${esc(g.display_name || g.name)} <span style="font-weight:400;color:var(--text-muted);">(${esc(g.name)})</span>
                  </div>
                  <div style="display:flex;gap:6px;">
                    <button type="button" class="group-save-members-btn" data-id="${g.id}" style="padding:4px 10px;border-radius:6px;border:none;background:var(--accent-primary, #6366f1);color:#fff;cursor:pointer;font-size:0.76rem;font-weight:600;">
                      💾 ${esc(t('users.save_members_btn'))}
                    </button>
                    <button type="button" class="group-delete-btn" data-id="${g.id}" style="padding:4px 9px;border-radius:6px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.76rem;">
                      🗑️
                    </button>
                  </div>
                </div>
                ${users.length > 0 ? `
                  <div class="group-members-box" data-group-id="${g.id}" style="display:flex;flex-wrap:wrap;gap:10px;padding-top:4px;">
                    ${users.map(u => `
                      <label style="display:inline-flex;align-items:center;gap:5px;font-size:0.8rem;color:var(--text-main);cursor:pointer;">
                        <input type="checkbox" class="group-member-chk" value="${u.id}" ${memberIds.includes(Number(u.id)) ? 'checked' : ''} />
                        <span>@${esc(u.username)}</span>
                      </label>
                    `).join('')}
                  </div>
                ` : ''}
                ${renderOverridesEditor('group', g.id, g.permission_overrides, t)}
              </div>
            `;
          }).join('')}
        </div>`;

    const groupsSectionHtml = `
      <form id="groupsCreateForm" style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:center;">
        <input type="text" id="newGroupName" placeholder="${esc(t('users.group_name_placeholder'))}" required pattern="[a-zA-Z0-9._-]{2,32}" style="${inputStyle}" />
        <input type="text" id="newGroupDisplayName" placeholder="${esc(t('users.group_display_placeholder'))}" style="${inputStyle}" />
        <button type="submit" class="sysmon-action-btn" style="padding:7px 14px;background:var(--accent-primary, #6366f1);color:#fff;font-weight:600;">
          ➕ ${esc(t('users.create_group_btn'))}
        </button>
      </form>
      ${groupsListHtml}
    `;

    container.innerHTML = `
      ${pendingCardHtml}
      ${window.sys.ui.card({ title: 'users.section_users', icon: '👤', content: usersSectionHtml })}
      ${window.sys.ui.card({ title: 'users.section_groups', icon: '👥', content: groupsSectionHtml })}
    `;

    const rerender = () => renderUsersAndGroupsSection(container, settingsApp);
    container.querySelector('#usersPanelRefreshBtn')?.addEventListener('click', rerender);

    container.querySelectorAll('.users-approve-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await settingsApp.api.post('approve_user', { user_id: parseInt(btn.dataset.id, 10) });
        if (res && res.success) { settingsApp.toast.success(t('users.approved_toast')); rerender(); }
        else { settingsApp.toast.error((res && res.error) || t('users.action_error')); }
      });
    });

    container.querySelectorAll('.users-reject-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await settingsApp.api.post('reject_user', { user_id: parseInt(btn.dataset.id, 10) });
        if (res && res.success) { settingsApp.toast.info(t('users.rejected_toast')); rerender(); }
        else { settingsApp.toast.error((res && res.error) || t('users.action_error')); }
      });
    });

    container.querySelectorAll('.users-reset-2fa-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        const username = btn.dataset.username || '';
        const confirmed = (window.sys && window.sys.dialog && typeof window.sys.dialog.confirm === 'function')
          ? await window.sys.dialog.confirm(t('users.reset_2fa_confirm', { username }))
          : window.confirm(t('users.reset_2fa_confirm', { username }));
        if (!confirmed) return;
        const res = await settingsApp.api.post('disable_2fa', { user_id: id });
        if (res && res.success) { settingsApp.toast.info(t('users.reset_2fa_toast')); rerender(); }
        else { settingsApp.toast.error((res && res.error) || t('users.action_error')); }
      });
    });

    container.querySelector('#usersCreateForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = container.querySelector('#newUserUsername')?.value.trim() || '';
      const displayName = container.querySelector('#newUserDisplayName')?.value.trim() || '';
      const email = container.querySelector('#newUserEmail')?.value.trim() || '';
      const password = container.querySelector('#newUserPassword')?.value || '';
      const quotaMb = parseInt(container.querySelector('#newUserQuotaMb')?.value || '0', 10) || 0;
      const role = container.querySelector('#newUserRole')?.value || 'user';
      const res = await settingsApp.api.post('create_user', {
        username,
        display_name: displayName,
        email,
        password,
        role,
        quota_bytes: Math.max(0, quotaMb) * 1024 * 1024
      });
      if (res && res.success) {
        settingsApp.toast.success(t('users.user_created_toast'));
        if (window.sys && window.sys.shares) await window.sys.shares.refreshIdentity();
        if (window.EventBus && typeof window.EventBus.emit === 'function') window.EventBus.emit('fs:changed');
        rerender();
      } else {
        settingsApp.toast.error((res && res.error) || t('users.action_error'));
      }
    });

    container.querySelectorAll('.users-open-home-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const homeDir = btn.dataset.home || '';
        if (homeDir && window.explorerApp && typeof window.explorerApp.open === 'function') {
          window.explorerApp.open({ dir: homeDir });
        }
      });
    });

    container.querySelectorAll('.users-toggle-active-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        const nextActive = btn.dataset.active === '1' ? 0 : 1;
        const res = await settingsApp.api.post('update_user', { user_id: id, is_active: nextActive });
        if (res && res.success) { settingsApp.toast.success(t('users.user_updated_toast')); rerender(); }
        else { settingsApp.toast.error((res && res.error) || t('users.action_error')); }
      });
    });

    container.querySelectorAll('.users-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        const username = btn.dataset.username || '';
        const confirmed = (window.sys && window.sys.dialog && typeof window.sys.dialog.confirm === 'function')
          ? await window.sys.dialog.confirm(t('users.delete_user_confirm', { username }))
          : window.confirm(t('users.delete_user_confirm', { username }));
        if (!confirmed) return;
        const res = await settingsApp.api.post('delete_user', { user_id: id });
        if (res && res.success) { settingsApp.toast.info(t('users.user_deleted_toast')); rerender(); }
        else { settingsApp.toast.error((res && res.error) || t('users.action_error')); }
      });
    });

    container.querySelector('#groupsCreateForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = container.querySelector('#newGroupName')?.value.trim() || '';
      const displayName = container.querySelector('#newGroupDisplayName')?.value.trim() || '';
      const res = await settingsApp.api.post('create_group', { name, display_name: displayName });
      if (res && res.success) { settingsApp.toast.success(t('users.group_created_toast')); rerender(); }
      else { settingsApp.toast.error((res && res.error) || t('users.action_error')); }
    });

    container.querySelectorAll('.group-save-members-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const groupId = parseInt(btn.dataset.id, 10);
        const box = container.querySelector(`.group-members-box[data-group-id="${groupId}"]`);
        const userIds = box ? Array.from(box.querySelectorAll('.group-member-chk:checked')).map(c => parseInt(c.value, 10)) : [];
        const res = await settingsApp.api.post('set_group_members', { group_id: groupId, member_ids: userIds });
        if (res && res.success) { settingsApp.toast.success(t('users.group_saved_toast')); rerender(); }
        else { settingsApp.toast.error((res && res.error) || t('users.action_error')); }
      });
    });

    container.querySelectorAll('.group-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await settingsApp.api.post('delete_group', { group_id: parseInt(btn.dataset.id, 10) });
        if (res && res.success) { settingsApp.toast.info(t('users.group_deleted_toast')); rerender(); }
        else { settingsApp.toast.error((res && res.error) || t('users.action_error')); }
      });
    });

    container.querySelectorAll('.perm-ov-save-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetType = btn.dataset.ovType;
        const targetId = parseInt(btn.dataset.ovId, 10);
        const grid = container.querySelector(`.perm-overrides-grid[data-ov-type="${targetType}"][data-ov-id="${targetId}"]`);
        if (!grid) return;
        const overrides = {};
        grid.querySelectorAll('.perm-ov-select').forEach(sel => {
          if (sel.value === 'allow' || sel.value === 'deny') {
            overrides[sel.dataset.permKey] = sel.value;
          }
        });
        const action = targetType === 'group' ? 'set_group_permissions' : 'set_user_permissions';
        const payload = targetType === 'group'
          ? { group_id: targetId, permission_overrides: overrides }
          : { user_id: targetId, permission_overrides: overrides };
        const res = await settingsApp.api.post(action, payload);
        if (res && res.success) {
          settingsApp.toast.success(t('users.perms_saved_toast'));
          rerender();
        } else {
          settingsApp.toast.error((res && res.error) || t('users.action_error'));
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // SECTION 2: REGISTRATION, 2FA, OIDC SSO & INVITATIONS (`registration`)
  // ---------------------------------------------------------------------------
  async function renderRegistrationSection(container, settingsApp) {
    const t = (k, p) => settingsApp.t(k, p);
    if (!settingsApp.isAdmin) {
      return renderAdminRequired(container, settingsApp, 'settings.tab_registration', '🔐');
    }

    container.innerHTML = `<div style="padding:18px;color:var(--text-muted);font-size:0.9rem;">${esc(t('common.loading'))}</div>`;

    const [groupsRes, authCfgRes] = await Promise.all([
      settingsApp.api.get('list_groups'),
      settingsApp.api.get('get_auth_settings')
    ]);
    const groups = (groupsRes && groupsRes.success && Array.isArray(groupsRes.groups)) ? groupsRes.groups : [];
    const authCfg = (authCfgRes && authCfgRes.success && authCfgRes.settings) ? authCfgRes.settings : {};
    const invites = (authCfgRes && authCfgRes.success && Array.isArray(authCfgRes.invites)) ? authCfgRes.invites : [];

    const regMode = authCfg.registration_mode || 'disabled';
    const totpPol = authCfg.totp_policy || 'optional';
    const defGroupIds = Array.isArray(authCfg.default_group_ids) ? authCfg.default_group_ids.map(Number) : [];
    const allowedDomainsStr = Array.isArray(authCfg.allowed_email_domains) ? authCfg.allowed_email_domains.join(', ') : '';
    const blockedDomainsStr = Array.isArray(authCfg.blocked_email_domains) ? authCfg.blocked_email_domains.join(', ') : '';

    const regPolicySectionHtml = `
      <form id="authPolicyForm" style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
          <label style="${labelStyle}">
            <span>${esc(t('users.reg_mode_label'))}</span>
            <select id="cfgRegMode" style="${inputStyle}">
              <option value="disabled" ${regMode === 'disabled' ? 'selected' : ''}>${esc(t('users.reg_mode_disabled'))}</option>
              <option value="invite_only" ${regMode === 'invite_only' ? 'selected' : ''}>${esc(t('users.reg_mode_invite'))}</option>
              <option value="approval" ${regMode === 'approval' ? 'selected' : ''}>${esc(t('users.reg_mode_approval'))}</option>
              <option value="open" ${regMode === 'open' ? 'selected' : ''}>${esc(t('users.reg_mode_open'))}</option>
            </select>
          </label>
          <label style="${labelStyle}">
            <span>${esc(t('users.totp_policy_label'))}</span>
            <select id="cfgTotpPolicy" style="${inputStyle}">
              <option value="disabled" ${totpPol === 'disabled' ? 'selected' : ''}>${esc(t('users.totp_policy_disabled'))}</option>
              <option value="optional" ${totpPol === 'optional' ? 'selected' : ''}>${esc(t('users.totp_policy_optional'))}</option>
              <option value="required_admins" ${totpPol === 'required_admins' ? 'selected' : ''}>${esc(t('users.totp_policy_admins'))}</option>
              <option value="required_all" ${totpPol === 'required_all' ? 'selected' : ''}>${esc(t('users.totp_policy_all'))}</option>
            </select>
          </label>
          <label style="${labelStyle}">
            <span>${esc(t('users.totp_issuer_label'))}</span>
            <input type="text" id="cfgTotpIssuer" value="${esc(authCfg.totp_issuer || 'Atelier by GallusTech')}" style="${inputStyle}" />
          </label>
          <label style="${labelStyle}">
            <span>${esc(t('users.min_pwd_len_label'))}</span>
            <input type="number" id="cfgMinPwdLen" min="6" max="64" value="${Number(authCfg.min_password_length) || 8}" style="${inputStyle}" />
          </label>
          <label style="${labelStyle}">
            <span>${esc(t('users.default_quota_label'))}</span>
            <input type="number" id="cfgDefaultQuotaMb" min="0" value="${Number(authCfg.default_quota_mb) || 0}" style="${inputStyle}" />
          </label>
          <label style="${labelStyle}">
            <span>${esc(t('users.verify_ttl_label'))}</span>
            <input type="number" id="cfgVerifyTtlHours" min="1" max="168" value="${Number(authCfg.email_verify_ttl_hours) || 24}" style="${inputStyle}" />
          </label>
        </div>

        <div style="display:flex;gap:16px;flex-wrap:wrap;">
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.83rem;color:var(--text-main);cursor:pointer;">
            <input type="checkbox" id="cfgRequireEmailVerify" ${authCfg.require_email_verification !== false ? 'checked' : ''} />
            <span>${esc(t('users.require_email_verify_label'))}</span>
          </label>
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.83rem;color:var(--text-main);cursor:pointer;">
            <input type="checkbox" id="cfgAllowPwdReset" ${authCfg.allow_password_reset !== false ? 'checked' : ''} />
            <span>${esc(t('users.allow_pwd_reset_label'))}</span>
          </label>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">
          <label style="${labelStyle}">
            <span>${esc(t('users.allowed_domains_label'))}</span>
            <input type="text" id="cfgAllowedDomains" value="${esc(allowedDomainsStr)}" placeholder="studio.fr, company.com" style="${inputStyle}" />
          </label>
          <label style="${labelStyle}">
            <span>${esc(t('users.blocked_domains_label'))}</span>
            <input type="text" id="cfgBlockedDomains" value="${esc(blockedDomainsStr)}" placeholder="tempmail.com, mailinator.com" style="${inputStyle}" />
          </label>
        </div>

        ${groups.length > 0 ? `
          <div style="display:flex;flex-direction:column;gap:4px;">
            <span style="font-size:0.78rem;color:var(--text-muted);">${esc(t('users.default_groups_label'))}</span>
            <div style="display:flex;flex-wrap:wrap;gap:10px;">
              ${groups.map(g => `
                <label style="display:inline-flex;align-items:center;gap:5px;font-size:0.8rem;color:var(--text-main);cursor:pointer;">
                  <input type="checkbox" class="cfg-default-group-chk" value="${g.id}" ${defGroupIds.includes(Number(g.id)) ? 'checked' : ''} />
                  <span>${esc(g.display_name || g.name)}</span>
                </label>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div style="display:flex;justify-content:flex-end;">
          <button type="submit" class="sysmon-action-btn" style="padding:7px 16px;background:var(--accent-primary, #6366f1);color:#fff;font-weight:600;">
            💾 ${esc(t('users.save_policy_btn'))}
          </button>
        </div>
      </form>
    `;

    const oidcSectionHtml = `
      <form id="authOidcForm" style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.84rem;color:var(--text-main);cursor:pointer;">
            <input type="checkbox" id="cfgOidcEnabled" ${authCfg.oidc_enabled ? 'checked' : ''} />
            <span>${esc(t('users.oidc_enable_label'))}</span>
          </label>
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.84rem;color:var(--text-main);cursor:pointer;">
            <input type="checkbox" id="cfgOidcAutoCreate" ${authCfg.oidc_auto_create ? 'checked' : ''} />
            <span>${esc(t('users.oidc_auto_create_label'))}</span>
          </label>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;">
          <label style="${labelStyle}">
            <span>${esc(t('users.oidc_provider_label'))}</span>
            <input type="text" id="cfgOidcProviderName" value="${esc(authCfg.oidc_provider_name || 'SSO')}" placeholder="Authentik / Keycloak" style="${inputStyle}" />
          </label>
          <label style="${labelStyle}">
            <span>${esc(t('users.oidc_issuer_label'))}</span>
            <input type="url" id="cfgOidcIssuer" value="${esc(authCfg.oidc_issuer_url || '')}" placeholder="https://auth.example.com/application/o/atelier" style="${inputStyle}" />
          </label>
          <label style="${labelStyle}">
            <span>${esc(t('users.oidc_client_id_label'))}</span>
            <input type="text" id="cfgOidcClientId" value="${esc(authCfg.oidc_client_id || '')}" style="${inputStyle}" />
          </label>
          <label style="${labelStyle}">
            <span>${esc(t('users.oidc_client_secret_label'))} ${authCfg.oidc_client_secret_set ? '✅' : ''}</span>
            <input type="password" id="cfgOidcClientSecret" placeholder="${authCfg.oidc_client_secret_set ? '••••••••' : ''}" autocomplete="new-password" style="${inputStyle}" />
          </label>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:0.75rem;color:var(--text-muted);">Callback URI: <code>${esc((authCfg.public_base_url || window.location.origin) + '/?oidc_callback=1')}</code></span>
          <button type="submit" class="sysmon-action-btn" style="padding:7px 16px;background:var(--accent-primary, #6366f1);color:#fff;font-weight:600;">
            💾 ${esc(t('users.save_oidc_btn'))}
          </button>
        </div>
      </form>
    `;

    const invitesSectionHtml = `
      <form id="inviteCreateForm" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;align-items:center;">
        <input type="email" id="newInviteEmail" placeholder="${esc(t('users.invite_email_placeholder'))}" style="${inputStyle}" />
        <select id="newInviteRole" style="${inputStyle}">
          <option value="user">${esc(t('users.role_user'))}</option>
          <option value="admin">${esc(t('users.role_admin'))}</option>
        </select>
        <input type="number" id="newInviteTtlDays" min="1" max="90" value="${Number(authCfg.invite_ttl_days) || 7}" title="${esc(t('users.invite_ttl_days_label'))}" style="${inputStyle}" />
        <label style="display:inline-flex;align-items:center;gap:5px;font-size:0.8rem;color:var(--text-main);cursor:pointer;">
          <input type="checkbox" id="newInviteSendEmail" checked />
          <span>${esc(t('users.invite_send_email_label'))}</span>
        </label>
        <button type="submit" class="sysmon-action-btn" style="padding:7px 14px;background:var(--accent-primary, #6366f1);color:#fff;font-weight:600;justify-content:center;">
          🎟️ ${esc(t('users.create_invite_btn'))}
        </button>
      </form>
      <div id="lastCreatedInviteBox" style="display:none;margin-top:8px;padding:8px 10px;border-radius:8px;border:1px solid rgba(99,102,241,0.4);background:rgba(99,102,241,0.1);font-size:0.8rem;"></div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">
        ${invites.length === 0
          ? `<div style="font-size:0.83rem;color:var(--text-muted);">${esc(t('users.empty_invites'))}</div>`
          : invites.map(inv => `
            <div style="${rowStyle}">
              <div style="font-size:0.8rem;color:var(--text-main);">
                🎟️ <strong>${esc(inv.target_email || t('users.invite_any_email'))}</strong>
                <span style="margin-left:6px;padding:1px 6px;border-radius:6px;background:rgba(99,102,241,0.16);font-size:0.7rem;">${esc(inv.role)}</span>
                <span style="margin-left:6px;font-size:0.74rem;color:${inv.is_active ? '#22c55e' : 'var(--text-muted)'};">
                  ${inv.used_at ? esc(t('users.invite_used')) : (inv.is_expired ? esc(t('users.invite_expired')) : esc(t('users.invite_active')))}
                </span>
              </div>
              ${inv.is_active ? `
                <button type="button" class="panel-revoke-invite-btn" data-id="${inv.id}" style="padding:4px 9px;border-radius:6px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.74rem;">
                  ${esc(t('shares.revoke_btn'))}
                </button>
              ` : ''}
            </div>
          `).join('')}
      </div>
    `;

    container.innerHTML = `
      ${window.sys.ui.card({ title: 'users.section_registration', icon: '🔐', content: regPolicySectionHtml })}
      ${window.sys.ui.card({ title: 'users.section_oidc', icon: '🌐', content: oidcSectionHtml })}
      ${window.sys.ui.card({ title: 'users.section_invites', icon: '🎟️', content: invitesSectionHtml })}
    `;

    const rerender = () => renderRegistrationSection(container, settingsApp);

    container.querySelector('#authPolicyForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const defaultGroupIds = Array.from(container.querySelectorAll('.cfg-default-group-chk:checked')).map(c => parseInt(c.value, 10));
      const payload = {
        registration_mode: container.querySelector('#cfgRegMode')?.value || 'disabled',
        totp_policy: container.querySelector('#cfgTotpPolicy')?.value || 'optional',
        totp_issuer: container.querySelector('#cfgTotpIssuer')?.value.trim() || 'Atelier by GallusTech',
        min_password_length: parseInt(container.querySelector('#cfgMinPwdLen')?.value || '8', 10),
        default_quota_mb: parseInt(container.querySelector('#cfgDefaultQuotaMb')?.value || '0', 10),
        email_verify_ttl_hours: parseInt(container.querySelector('#cfgVerifyTtlHours')?.value || '24', 10),
        require_email_verification: Boolean(container.querySelector('#cfgRequireEmailVerify')?.checked),
        allow_password_reset: Boolean(container.querySelector('#cfgAllowPwdReset')?.checked),
        allowed_email_domains: container.querySelector('#cfgAllowedDomains')?.value || '',
        blocked_email_domains: container.querySelector('#cfgBlockedDomains')?.value || '',
        default_group_ids: defaultGroupIds
      };
      const res = await settingsApp.api.post('save_auth_settings', { settings: payload });
      if (res && res.success) {
        if (res.policy) window.SG_AUTH_POLICY = res.policy;
        settingsApp.toast.success(t('users.policy_saved_toast'));
        rerender();
      } else {
        settingsApp.toast.error((res && res.error) || t('users.action_error'));
      }
    });

    container.querySelector('#authOidcForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        oidc_enabled: Boolean(container.querySelector('#cfgOidcEnabled')?.checked),
        oidc_auto_create: Boolean(container.querySelector('#cfgOidcAutoCreate')?.checked),
        oidc_provider_name: container.querySelector('#cfgOidcProviderName')?.value.trim() || 'SSO',
        oidc_issuer_url: container.querySelector('#cfgOidcIssuer')?.value.trim() || '',
        oidc_client_id: container.querySelector('#cfgOidcClientId')?.value.trim() || ''
      };
      const sec = container.querySelector('#cfgOidcClientSecret')?.value || '';
      if (sec !== '') payload.oidc_client_secret = sec;
      const res = await settingsApp.api.post('save_auth_settings', { settings: payload });
      if (res && res.success) {
        if (res.policy) window.SG_AUTH_POLICY = res.policy;
        settingsApp.toast.success(t('users.oidc_saved_toast'));
        rerender();
      } else {
        settingsApp.toast.error((res && res.error) || t('users.action_error'));
      }
    });

    container.querySelector('#inviteCreateForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = container.querySelector('#newInviteEmail')?.value.trim() || '';
      const role = container.querySelector('#newInviteRole')?.value || 'user';
      const ttl_days = parseInt(container.querySelector('#newInviteTtlDays')?.value || '7', 10);
      const send_email = Boolean(container.querySelector('#newInviteSendEmail')?.checked);
      const res = await settingsApp.api.post('create_invite', { email, role, ttl_days, send_email });
      if (res && res.success && res.invite) {
        settingsApp.toast.success(t('users.invite_created_toast'));
        const box = container.querySelector('#lastCreatedInviteBox');
        if (box) {
          box.style.display = 'block';
          box.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
              <code style="word-break:break-all;">${esc(res.invite.url)}</code>
              <button type="button" id="copyLastInviteBtn" class="sysmon-action-btn" style="padding:4px 10px;font-size:0.75rem;">📋 ${esc(t('users.copy_link_btn'))}</button>
            </div>
          `;
          box.querySelector('#copyLastInviteBtn')?.addEventListener('click', () => {
            copyText(res.invite.url).then(() => settingsApp.toast.success(t('users.copied_toast')));
          });
        }
      } else {
        settingsApp.toast.error((res && res.error) || t('users.action_error'));
      }
    });

    container.querySelectorAll('.panel-revoke-invite-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await settingsApp.api.post('revoke_invite', { invite_id: parseInt(btn.dataset.id, 10) });
        if (res && res.success) { settingsApp.toast.info(t('shares.revoked_toast')); rerender(); }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // SECTION 3: EMAIL & SMTP (`mail`)
  // ---------------------------------------------------------------------------
  async function renderMailSection(container, settingsApp) {
    const t = (k, p) => settingsApp.t(k, p);
    if (!settingsApp.isAdmin) {
      return renderAdminRequired(container, settingsApp, 'settings.tab_mail', '✉️');
    }

    container.innerHTML = `<div style="padding:18px;color:var(--text-muted);font-size:0.9rem;">${esc(t('common.loading'))}</div>`;

    const authCfgRes = await settingsApp.api.get('get_auth_settings');
    const authCfg = (authCfgRes && authCfgRes.success && authCfgRes.settings) ? authCfgRes.settings : {};
    const outbox = (authCfgRes && authCfgRes.success && Array.isArray(authCfgRes.outbox)) ? authCfgRes.outbox : [];
    const mailDrv = authCfg.mail_driver || 'outbox_log';
    const smtpEnc = authCfg.smtp_encryption || 'tls';

    const mailSectionHtml = `
      <form id="authMailForm" style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;">
          <label style="${labelStyle}">
            <span>${esc(t('users.mail_driver_label'))}</span>
            <select id="cfgMailDriver" style="${inputStyle}">
              <option value="outbox_log" ${mailDrv === 'outbox_log' ? 'selected' : ''}>${esc(t('users.mail_driver_outbox'))}</option>
              <option value="php_mail" ${mailDrv === 'php_mail' ? 'selected' : ''}>${esc(t('users.mail_driver_phpmail'))}</option>
              <option value="smtp" ${mailDrv === 'smtp' ? 'selected' : ''}>${esc(t('users.mail_driver_smtp'))}</option>
            </select>
          </label>
          <label style="${labelStyle}">
            <span>${esc(t('users.mail_from_email_label'))}</span>
            <input type="email" id="cfgMailFromEmail" value="${esc(authCfg.mail_from_email || 'noreply@localhost')}" style="${inputStyle}" />
          </label>
          <label style="${labelStyle}">
            <span>${esc(t('users.mail_from_name_label'))}</span>
            <input type="text" id="cfgMailFromName" value="${esc(authCfg.mail_from_name || 'Atelier by GallusTech')}" style="${inputStyle}" />
          </label>
          <label style="${labelStyle}">
            <span>${esc(t('users.public_base_url_label'))}</span>
            <input type="url" id="cfgPublicBaseUrl" value="${esc(authCfg.public_base_url || '')}" placeholder="https://cloud.example.com" style="${inputStyle}" />
          </label>
        </div>

        <div id="cfgSmtpFields" style="display:${mailDrv === 'smtp' ? 'grid' : 'none'};grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;padding:10px;border-radius:8px;border:1px dashed var(--border-color);">
          <label style="${labelStyle}">
            <span>${esc(t('users.smtp_host_label'))}</span>
            <input type="text" id="cfgSmtpHost" value="${esc(authCfg.smtp_host || '')}" placeholder="smtp.example.com" style="${inputStyle}" />
          </label>
          <label style="${labelStyle}">
            <span>${esc(t('users.smtp_port_label'))}</span>
            <input type="number" id="cfgSmtpPort" value="${Number(authCfg.smtp_port) || 587}" style="${inputStyle}" />
          </label>
          <label style="${labelStyle}">
            <span>${esc(t('users.smtp_enc_label'))}</span>
            <select id="cfgSmtpEnc" style="${inputStyle}">
              <option value="tls" ${smtpEnc === 'tls' ? 'selected' : ''}>STARTTLS (587)</option>
              <option value="ssl" ${smtpEnc === 'ssl' ? 'selected' : ''}>SSL/TLS (465)</option>
              <option value="none" ${smtpEnc === 'none' ? 'selected' : ''}>None (25)</option>
            </select>
          </label>
          <label style="${labelStyle}">
            <span>${esc(t('users.smtp_user_label'))}</span>
            <input type="text" id="cfgSmtpUser" value="${esc(authCfg.smtp_username || '')}" style="${inputStyle}" />
          </label>
          <label style="${labelStyle}">
            <span>${esc(t('users.smtp_pass_label'))} ${authCfg.smtp_password_set ? '✅' : ''}</span>
            <input type="password" id="cfgSmtpPass" placeholder="${authCfg.smtp_password_set ? '••••••••' : ''}" autocomplete="new-password" style="${inputStyle}" />
          </label>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <input type="email" id="cfgTestEmailTo" placeholder="${esc(t('users.test_email_placeholder'))}" style="${inputStyle};min-width:210px;" />
            <button type="button" id="cfgSendTestEmailBtn" class="sysmon-action-btn" style="padding:7px 12px;font-size:0.8rem;">
              📨 ${esc(t('users.send_test_email_btn'))}
            </button>
          </div>
          <button type="submit" class="sysmon-action-btn" style="padding:7px 16px;background:var(--accent-primary, #6366f1);color:#fff;font-weight:600;">
            💾 ${esc(t('users.save_mail_btn'))}
          </button>
        </div>
      </form>
    `;

    const outboxHtml = outbox.length === 0
      ? `<div style="font-size:0.83rem;color:var(--text-muted);">${esc(t('users.outbox_empty'))}</div>`
      : `<div style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto;">
          ${outbox.map(m => `
            <div style="padding:8px 10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);font-size:0.78rem;">
              <div style="display:flex;justify-content:space-between;gap:8px;font-weight:600;">
                <span>${esc(m.subject)} → ${esc(m.to)}</span>
                <span style="color:var(--text-muted);">${esc(formatTs(m.created_at))}</span>
              </div>
              <pre style="margin:6px 0 0;white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:0.73rem;color:var(--text-muted);">${esc(m.text || '')}</pre>
            </div>
          `).join('')}
        </div>`;

    container.innerHTML = `
      ${window.sys.ui.card({ title: 'users.section_mail', icon: '✉️', content: mailSectionHtml })}
      ${window.sys.ui.card({ title: 'users.outbox_title', icon: '📬', content: outboxHtml })}
    `;

    const rerender = () => renderMailSection(container, settingsApp);

    const mailDrvSel = container.querySelector('#cfgMailDriver');
    const smtpFieldsBox = container.querySelector('#cfgSmtpFields');
    if (mailDrvSel && smtpFieldsBox) {
      mailDrvSel.addEventListener('change', () => {
        smtpFieldsBox.style.display = mailDrvSel.value === 'smtp' ? 'grid' : 'none';
      });
    }

    container.querySelector('#authMailForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        mail_driver: container.querySelector('#cfgMailDriver')?.value || 'outbox_log',
        mail_from_email: container.querySelector('#cfgMailFromEmail')?.value.trim() || 'noreply@localhost',
        mail_from_name: container.querySelector('#cfgMailFromName')?.value.trim() || 'Atelier by GallusTech',
        public_base_url: container.querySelector('#cfgPublicBaseUrl')?.value.trim() || '',
        smtp_host: container.querySelector('#cfgSmtpHost')?.value.trim() || '',
        smtp_port: parseInt(container.querySelector('#cfgSmtpPort')?.value || '587', 10),
        smtp_encryption: container.querySelector('#cfgSmtpEnc')?.value || 'tls',
        smtp_username: container.querySelector('#cfgSmtpUser')?.value.trim() || ''
      };
      const pwdVal = container.querySelector('#cfgSmtpPass')?.value || '';
      if (pwdVal !== '') payload.smtp_password = pwdVal;

      const res = await settingsApp.api.post('save_auth_settings', { settings: payload });
      if (res && res.success) { settingsApp.toast.success(t('users.mail_saved_toast')); rerender(); }
      else { settingsApp.toast.error((res && res.error) || t('users.action_error')); }
    });

    container.querySelector('#cfgSendTestEmailBtn')?.addEventListener('click', async () => {
      const to = container.querySelector('#cfgTestEmailTo')?.value.trim() || '';
      if (!to) { settingsApp.toast.error(t('users.test_email_placeholder')); return; }
      const res = await settingsApp.api.post('send_test_email', { email: to });
      if (res && res.success) { settingsApp.toast.success(t('users.test_email_sent_toast')); rerender(); }
      else { settingsApp.toast.error((res && res.error) || t('users.action_error')); }
    });
  }

  // ---------------------------------------------------------------------------
  // SECTION 4: SHARES, SIGNED LINKS (`/s/<token>`) & AUDIT LOG (`shares`)
  // ---------------------------------------------------------------------------
  async function renderSharesAndAuditSection(container, settingsApp) {
    const t = (k, p) => settingsApp.t(k, p);
    if (!settingsApp.isAdmin) {
      return renderAdminRequired(container, settingsApp, 'settings.tab_shares_audit', '💽');
    }

    container.innerHTML = `<div style="padding:18px;color:var(--text-muted);font-size:0.9rem;">${esc(t('common.loading'))}</div>`;

    const [sharesRes, linksRes, auditRes] = await Promise.all([
      settingsApp.api.get('list_user_shares', { all: '1' }),
      settingsApp.api.get('list_share_links'),
      settingsApp.api.get('get_audit_logs', { limit: 40 })
    ]);

    const shares = (sharesRes && sharesRes.success && Array.isArray(sharesRes.shares)) ? sharesRes.shares : [];
    const links = ((linksRes && linksRes.success && Array.isArray(linksRes.links)) ? linksRes.links : []).filter(l => !l.revoked_at);
    const logs = (auditRes && auditRes.success && Array.isArray(auditRes.logs)) ? auditRes.logs : [];
    const baseOrigin = (window.location ? window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '') : '').replace(/\/+$/, '');

    const sharesHtml = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${shares.length === 0
          ? `<div style="font-size:0.84rem;color:var(--text-muted);">${esc(t('users.empty_shares'))}</div>`
          : shares.map(s => `
            <div style="${rowStyle}">
              <div style="font-size:0.83rem;color:var(--text-main);">
                ${esc(s.mount_icon || '💽')} <strong>${esc(s.mount_name)}</strong>
                <span style="color:var(--text-muted);font-family:monospace;"> (/${esc(s.source_path)})</span>
                → <strong>${esc(s.target_label)}</strong>
                <span style="margin-left:4px;font-size:0.72rem;padding:1px 6px;border-radius:6px;background:rgba(99,102,241,0.16);">${esc(s.permission)}</span>
              </div>
              <button type="button" class="panel-revoke-share-btn" data-id="${s.id}" style="padding:4px 9px;border-radius:6px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.75rem;">
                ${esc(t('shares.revoke_btn'))}
              </button>
            </div>
          `).join('')}
      </div>
    `;

    const linksHtml = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${links.length === 0
          ? `<div style="font-size:0.84rem;color:var(--text-muted);">${esc(t('users.empty_links'))}</div>`
          : links.map(l => {
            const shortUrl = `${baseOrigin}/s/${encodeURIComponent(l.token || '')}`;
            return `
              <div style="${rowStyle}">
                <div style="font-size:0.82rem;color:var(--text-main);">
                  ${l.has_password ? '🔒' : '🔗'} <code>/s/${esc(String(l.token || '').slice(0, 14))}…</code>
                  <span style="color:var(--text-muted);font-family:monospace;"> /${esc(l.target_path)}</span>
                </div>
                <div style="display:flex;gap:6px;">
                  <button type="button" class="panel-copy-link-btn" data-url="${esc(shortUrl)}" style="padding:4px 9px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-main);cursor:pointer;font-size:0.74rem;">
                    📋 ${esc(t('users.copy_link_btn'))}
                  </button>
                  <button type="button" class="panel-revoke-link-btn" data-id="${l.id}" style="padding:4px 9px;border-radius:6px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.75rem;">
                    ${esc(t('shares.revoke_btn'))}
                  </button>
                </div>
              </div>
            `;
          }).join('')}
      </div>
    `;

    const auditHtml = logs.length === 0
      ? `<div style="font-size:0.84rem;color:var(--text-muted);">${esc(t('users.empty_audit'))}</div>`
      : `<div style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:5px;font-size:0.77rem;">
          ${logs.map(log => `
            <div style="display:flex;justify-content:space-between;gap:10px;padding:5px 8px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-card);">
              <span><strong>${esc(log.action)}</strong> · ${esc(log.username || 'guest')} ${log.target_path ? `<code>/${esc(log.target_path)}</code>` : ''}</span>
              <span style="color:var(--text-muted);white-space:nowrap;">${esc(formatTs(log.created_at))}</span>
            </div>
          `).join('')}
        </div>`;

    container.innerHTML = `
      ${window.sys.ui.card({ title: 'users.section_shares', icon: '💽', content: sharesHtml })}
      ${window.sys.ui.card({ title: 'users.section_links', icon: '🔗', content: linksHtml })}
      ${window.sys.ui.card({ title: 'users.section_audit', icon: '📜', content: auditHtml })}
    `;

    const rerender = () => renderSharesAndAuditSection(container, settingsApp);

    container.querySelectorAll('.panel-copy-link-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        copyText(btn.dataset.url || '').then(() => settingsApp.toast.success(t('users.copied_toast')));
      });
    });

    container.querySelectorAll('.panel-revoke-share-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await settingsApp.api.post('revoke_user_share', { share_id: parseInt(btn.dataset.id, 10) });
        if (res && res.success) {
          settingsApp.toast.info(t('shares.revoked_toast'));
          if (window.sys && window.sys.shares) await window.sys.shares.refreshIdentity();
          rerender();
        }
      });
    });

    container.querySelectorAll('.panel-revoke-link-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await settingsApp.api.post('revoke_share_link', { link_id: parseInt(btn.dataset.id, 10) });
        if (res && res.success) { settingsApp.toast.info(t('shares.revoked_toast')); rerender(); }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // SECTION 5: EXTERNAL MOUNTS, TRASH (30d) & SQLITE FILE INDEX (`storage`)
  // ---------------------------------------------------------------------------
  async function renderStorageSection(container, settingsApp) {
    const t = (k, p) => settingsApp.t(k, p);
    const currentUser = (window.sys && window.sys.shares && typeof window.sys.shares.getCurrentUser === 'function')
      ? window.sys.shares.getCurrentUser()
      : window.SG_CURRENT_USER;
    if (!settingsApp.isAdmin && !currentUser) {
      return renderAdminRequired(container, settingsApp, 'settings.tab_storage', '☁️');
    }

    container.innerHTML = `<div style="padding:18px;color:var(--text-muted);font-size:0.9rem;">${esc(t('common.loading'))}</div>`;

    const calls = [
      settingsApp.api.get('list_external_mounts'),
      settingsApp.api.get('list_trash', settingsApp.isAdmin ? { all: '1' } : {})
    ];
    if (settingsApp.isAdmin) {
      calls.push(settingsApp.api.get('get_file_index_stats'));
    }
    const [mountsRes, trashRes, idxRes] = await Promise.all(calls);
    const mounts = (mountsRes && mountsRes.success && Array.isArray(mountsRes.mounts)) ? mountsRes.mounts : [];
    const trashItems = (trashRes && trashRes.success && Array.isArray(trashRes.items)) ? trashRes.items : [];
    const idxStats = (idxRes && idxRes.success && idxRes.stats) ? idxRes.stats : null;

    const mountsListHtml = mounts.length === 0
      ? `<div style="font-size:0.82rem;color:var(--text-muted);padding:6px 0;">${esc(t('storage.empty_mounts'))}</div>`
      : `<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">
          ${mounts.map(m => `
            <div style="${rowStyle}">
              <div style="display:flex;flex-direction:column;gap:2px;font-size:0.82rem;">
                <div style="font-weight:600;color:var(--text-main);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  <span>${esc(m.mount_icon || '☁️')} ${esc(m.mount_name)}</span>
                  <span style="padding:1px 7px;border-radius:99px;font-size:0.68rem;background:rgba(99,102,241,0.16);color:var(--accent-primary,#6366f1);font-weight:700;">${esc(String(m.driver || '').toUpperCase())}</span>
                  <span style="padding:1px 7px;border-radius:99px;font-size:0.68rem;background:rgba(34,197,94,0.16);color:#22c55e;font-weight:700;">${esc(m.permission === 'write' ? 'RW' : 'R')}</span>
                </div>
                <div style="font-size:0.74rem;color:var(--text-muted);font-family:monospace;">
                  ${esc(m.path)} ${m.config && m.config.endpoint ? '· ' + esc(m.config.endpoint) : (m.config && m.config.bucket ? '· s3://' + esc(m.config.bucket) : '')}
                </div>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button type="button" class="ext-mount-open-btn" data-path="${esc(m.path)}" style="padding:4px 9px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--accent-primary,#6366f1);cursor:pointer;font-size:0.74rem;font-weight:600;">
                  📂 ${esc(t('storage.open_btn'))}
                </button>
                <button type="button" class="ext-mount-test-btn" data-id="${m.id}" style="padding:4px 9px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-main);cursor:pointer;font-size:0.74rem;">
                  🔌 ${esc(t('storage.test_btn'))}
                </button>
                <button type="button" class="ext-mount-del-btn" data-id="${m.id}" style="padding:4px 9px;border-radius:6px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.74rem;">
                  🗑️
                </button>
              </div>
            </div>
          `).join('')}
        </div>`;

    const mountsCardHtml = window.sys.ui.card({
      title: 'storage.section_mounts',
      icon: '☁️',
      content: `
        <p style="font-size:0.8rem;color:var(--text-muted);margin:0 0 10px;">
          ${esc(t('storage.mounts_desc'))}
        </p>
        <form id="extMountCreateForm" style="display:flex;flex-direction:column;gap:8px;">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;">
            <select id="extMountDriver" style="${inputStyle}">
              <option value="webdav">WebDAV (Nextcloud / NAS)</option>
              <option value="s3">S3 / R2 / MinIO</option>
              <option value="gdrive">Google Drive (OAuth2)</option>
              ${settingsApp.isAdmin ? '<option value="local">Local Server Folder</option>' : ''}
            </select>
            <input type="text" id="extMountName" required placeholder="${esc(t('storage.mount_name_placeholder'))}" style="${inputStyle}" />
            <select id="extMountPerm" style="${inputStyle}">
              <option value="write">RW (${esc(t('shares.perm_write'))})</option>
              <option value="read">R (${esc(t('shares.perm_read'))})</option>
            </select>
            ${settingsApp.isAdmin ? `
              <select id="extMountTarget" style="${inputStyle}">
                <option value="user">${esc(t('storage.scope_personal'))}</option>
                <option value="global">${esc(t('storage.scope_global'))}</option>
              </select>
            ` : ''}
          </div>
          <div id="extMountDriverFields" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.8rem;color:var(--text-muted);cursor:pointer;">
              <input type="checkbox" id="extMountShowDesktop" checked />
              <span>${esc(t('shares.show_on_desktop'))}</span>
            </label>
            <button type="submit" class="sysmon-action-btn" style="padding:7px 14px;background:var(--accent-primary,#6366f1);color:#fff;font-weight:600;">
              ➕ ${esc(t('storage.add_mount_btn'))}
            </button>
          </div>
        </form>
        ${mountsListHtml}
      `
    });

    const trashCardHtml = window.sys.ui.card({
      title: 'storage.section_trash',
      icon: '🗑️',
      content: `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
          <span style="font-size:0.8rem;color:var(--text-muted);">${esc(t('storage.trash_desc'))}</span>
          ${trashItems.length > 0 ? `
            <button type="button" id="storageEmptyTrashBtn" class="sysmon-action-btn" style="padding:5px 11px;font-size:0.76rem;border:1px solid rgba(239,68,68,0.45);background:rgba(239,68,68,0.12);color:#ef4444;">
              🧹 ${esc(t('storage.empty_trash_btn'))}
            </button>
          ` : ''}
        </div>
        ${trashItems.length === 0
          ? `<div style="font-size:0.82rem;color:var(--text-muted);">${esc(t('storage.empty_trash'))}</div>`
          : `<div style="display:flex;flex-direction:column;gap:6px;">
              ${trashItems.map(it => `
                <div style="${rowStyle}">
                  <div style="display:flex;flex-direction:column;gap:2px;font-size:0.8rem;">
                    <div style="font-weight:600;color:var(--text-main);">
                      ${it.is_dir ? '📁' : '📄'} ${esc(it.name)} <span style="font-weight:400;color:var(--text-muted);">(${esc(formatBytesSize(it.size_bytes))})</span>
                    </div>
                    <div style="font-size:0.73rem;color:var(--text-muted);">
                      <code>/${esc(it.original_path)}</code> · ${esc(formatTs(it.deleted_at))}
                    </div>
                  </div>
                  <div style="display:flex;gap:6px;">
                    <button type="button" class="trash-restore-btn" data-id="${esc(it.id)}" style="padding:4px 9px;border-radius:6px;border:none;background:#16a34a;color:#fff;cursor:pointer;font-size:0.74rem;font-weight:600;">
                      ♻️ ${esc(t('storage.restore_btn'))}
                    </button>
                    <button type="button" class="trash-purge-btn" data-id="${esc(it.id)}" style="padding:4px 9px;border-radius:6px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.74rem;">
                      🗑️
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>`}
      `
    });

    const indexCardHtml = settingsApp.isAdmin ? window.sys.ui.card({
      title: 'storage.section_index',
      icon: '⚡',
      content: `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
          <div style="font-size:0.82rem;color:var(--text-muted);">
            ${esc(t('storage.index_summary', {
              count: idxStats ? Number(idxStats.total_files) || 0 : 0,
              last: idxStats && idxStats.last_indexed ? formatTs(idxStats.last_indexed) : '—'
            }))}
          </div>
          <button type="button" id="storageRebuildIndexBtn" class="sysmon-action-btn" style="padding:6px 14px;background:var(--accent-primary,#6366f1);color:#fff;font-weight:600;font-size:0.8rem;">
            ⚡ ${esc(t('storage.rebuild_index_btn'))}
          </button>
        </div>
      `
    }) : '';

    container.innerHTML = `${mountsCardHtml}${trashCardHtml}${indexCardHtml}`;

    const rerender = () => renderStorageSection(container, settingsApp);

    const fieldsBox = container.querySelector('#extMountDriverFields');
    const driverSel = container.querySelector('#extMountDriver');
    const renderDriverFields = () => {
      if (!fieldsBox || !driverSel) return;
      const d = driverSel.value;
      if (d === 'webdav') {
        fieldsBox.innerHTML = `
          <input type="url" id="extCfgEndpoint" required placeholder="https://cloud.example.com/remote.php/dav/files/user/" style="${inputStyle}" />
          <input type="text" id="extCfgUsername" placeholder="${esc(t('users.username_placeholder'))}" style="${inputStyle}" />
          <input type="password" id="extCfgPassword" placeholder="${esc(t('users.password_placeholder'))}" style="${inputStyle}" />
          ${settingsApp.isAdmin ? `<label style="display:inline-flex;align-items:center;gap:6px;font-size:0.78rem;color:var(--text-muted);"><input type="checkbox" id="extCfgAllowLan" /><span>LAN / NAS</span></label>` : ''}
        `;
      } else if (d === 's3') {
        fieldsBox.innerHTML = `
          <input type="url" id="extCfgEndpoint" placeholder="https://<account>.r2.cloudflarestorage.com" style="${inputStyle}" />
          <input type="text" id="extCfgBucket" required placeholder="Bucket" style="${inputStyle}" />
          <input type="text" id="extCfgRegion" value="auto" placeholder="Region (auto / eu-west-3)" style="${inputStyle}" />
          <input type="text" id="extCfgPrefix" placeholder="Prefix (optional)" style="${inputStyle}" />
          <input type="text" id="extCfgAccessKey" required placeholder="Access Key ID" style="${inputStyle}" />
          <input type="password" id="extCfgSecretKey" required placeholder="Secret Access Key" style="${inputStyle}" />
        `;
      } else if (d === 'gdrive') {
        fieldsBox.innerHTML = `
          <input type="password" id="extCfgAccessToken" placeholder="OAuth2 Access Token" style="${inputStyle}" />
          <input type="password" id="extCfgRefreshToken" placeholder="OAuth2 Refresh Token" style="${inputStyle}" />
          <input type="text" id="extCfgClientId" placeholder="Google Client ID" style="${inputStyle}" />
          <input type="password" id="extCfgClientSecret" placeholder="Google Client Secret" style="${inputStyle}" />
          <input type="text" id="extCfgRootFolder" value="root" placeholder="Root Folder ID (root)" style="${inputStyle}" />
        `;
      } else {
        fieldsBox.innerHTML = `
          <input type="text" id="extCfgRootDir" required placeholder="/mnt/nas/photos" style="${inputStyle}" />
        `;
      }
    };
    renderDriverFields();
    driverSel?.addEventListener('change', renderDriverFields);

    container.querySelector('#extMountCreateForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const driver = driverSel?.value || 'webdav';
      const mount_name = container.querySelector('#extMountName')?.value.trim() || '';
      const permission = container.querySelector('#extMountPerm')?.value || 'write';
      const target_type = container.querySelector('#extMountTarget')?.value || 'user';
      const show_on_desktop = Boolean(container.querySelector('#extMountShowDesktop')?.checked);
      const config = {};
      if (driver === 'webdav') {
        config.endpoint = container.querySelector('#extCfgEndpoint')?.value.trim() || '';
        config.username = container.querySelector('#extCfgUsername')?.value.trim() || '';
        config.password = container.querySelector('#extCfgPassword')?.value || '';
        if (container.querySelector('#extCfgAllowLan')?.checked) config.allow_private_lan = true;
      } else if (driver === 's3') {
        config.endpoint = container.querySelector('#extCfgEndpoint')?.value.trim() || '';
        config.bucket = container.querySelector('#extCfgBucket')?.value.trim() || '';
        config.region = container.querySelector('#extCfgRegion')?.value.trim() || 'auto';
        config.prefix = container.querySelector('#extCfgPrefix')?.value.trim() || '';
        config.access_key = container.querySelector('#extCfgAccessKey')?.value.trim() || '';
        config.secret_key = container.querySelector('#extCfgSecretKey')?.value || '';
      } else if (driver === 'gdrive') {
        config.access_token = container.querySelector('#extCfgAccessToken')?.value.trim() || '';
        config.refresh_token = container.querySelector('#extCfgRefreshToken')?.value.trim() || '';
        config.client_id = container.querySelector('#extCfgClientId')?.value.trim() || '';
        config.client_secret = container.querySelector('#extCfgClientSecret')?.value || '';
        config.root_folder_id = container.querySelector('#extCfgRootFolder')?.value.trim() || 'root';
      } else {
        config.root_dir = container.querySelector('#extCfgRootDir')?.value.trim() || '';
      }

      const res = await settingsApp.api.post('create_external_mount', {
        driver, mount_name, permission, target_type, show_on_desktop, config
      });
      if (res && res.success) {
        settingsApp.toast.success(t('storage.mount_created_toast'));
        if (window.sys && window.sys.shares) await window.sys.shares.refreshIdentity();
        rerender();
      } else {
        settingsApp.toast.error((res && res.error) || t('users.action_error'));
      }
    });

    container.querySelectorAll('.ext-mount-open-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.explorerApp && typeof window.explorerApp.open === 'function') {
          window.explorerApp.open({ dir: btn.dataset.path });
        }
      });
    });

    container.querySelectorAll('.ext-mount-test-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await settingsApp.api.post('test_external_mount', { mount_id: parseInt(btn.dataset.id, 10) });
        if (res && res.success) settingsApp.toast.success(res.message || t('storage.test_ok_toast'));
        else settingsApp.toast.error((res && res.message) || (res && res.error) || t('users.action_error'));
      });
    });

    container.querySelectorAll('.ext-mount-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await settingsApp.api.post('delete_external_mount', { mount_id: parseInt(btn.dataset.id, 10) });
        if (res && res.success) {
          settingsApp.toast.info(t('storage.mount_deleted_toast'));
          if (window.sys && window.sys.shares) await window.sys.shares.refreshIdentity();
          rerender();
        }
      });
    });

    container.querySelectorAll('.trash-restore-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await settingsApp.api.post('restore_trash_item', { trash_id: btn.dataset.id });
        if (res && res.success) {
          settingsApp.toast.success(t('storage.trash_restored_toast'));
          if (window.EventBus) window.EventBus.emit('fs:changed');
          rerender();
        } else {
          settingsApp.toast.error((res && res.error) || t('users.action_error'));
        }
      });
    });

    container.querySelectorAll('.trash-purge-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await settingsApp.api.post('purge_trash_item', { trash_id: btn.dataset.id });
        if (res && res.success) {
          settingsApp.toast.info(t('storage.trash_purged_toast'));
          rerender();
        }
      });
    });

    container.querySelector('#storageEmptyTrashBtn')?.addEventListener('click', async () => {
      const res = await settingsApp.api.post('empty_trash', {});
      if (res && res.success) {
        settingsApp.toast.info(t('storage.trash_purged_toast'));
        rerender();
      }
    });

    container.querySelector('#storageRebuildIndexBtn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const res = await settingsApp.api.post('rebuild_file_index', {});
      btn.disabled = false;
      if (res && res.success) {
        settingsApp.toast.success(t('storage.index_rebuilt_toast', { count: res.total || 0 }));
        rerender();
      } else {
        settingsApp.toast.error((res && res.error) || t('users.action_error'));
      }
    });
  }

  function renderSection(sectionId, container, settingsApp) {
    switch (sectionId) {
      case 'registration': return renderRegistrationSection(container, settingsApp);
      case 'mail':         return renderMailSection(container, settingsApp);
      case 'shares':       return renderSharesAndAuditSection(container, settingsApp);
      case 'storage':      return renderStorageSection(container, settingsApp);
      case 'users':
      default:             return renderUsersAndGroupsSection(container, settingsApp);
    }
  }

  function registerUsersSection() {
    const section = {
      id: 'users',
      title: 'settings.tab_users',
      icon: '👥',
      render: (container, settingsApp) => renderSection('users', container, settingsApp)
    };
    if (window.SettingsApp && typeof window.SettingsApp.registerSection === 'function') {
      window.SettingsApp.registerSection(section);
    } else if (window.EventBus && typeof window.EventBus.emit === 'function') {
      window.EventBus.emit('settings:register_section', section);
    }
  }

  function formatBytesSize(bytes) {
    const b = Number(bytes) || 0;
    if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + ' Go';
    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(2) + ' Mo';
    if (b >= 1024) return (b / 1024).toFixed(1) + ' Ko';
    return b + ' o';
  }

  function showPostDeletionExportModal(exp, settingsApp) {
    if (!exp || typeof document === 'undefined') return;
    const t = (k, p) => settingsApp.t(k, p);
    const old = document.getElementById('atelierPostDeleteExportModal');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'atelierPostDeleteExportModal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100250;background:rgba(15,23,42,0.82);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:18px;';

    const box = document.createElement('div');
    box.style.cssText = 'width:560px;max-width:96vw;max-height:90vh;overflow-y:auto;background:var(--window-bg,#0f172a);color:var(--text-main,#f8fafc);border:1px solid var(--border-color,rgba(255,255,255,0.14));border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.55);padding:22px;display:flex;flex-direction:column;gap:14px;';

    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-weight:700;font-size:1.05rem;">📦 ${esc(t('account.deleted_export_modal_title'))}</div>
        <button type="button" id="postDelCloseBtn" style="background:none;border:none;color:var(--text-muted);font-size:1.2rem;cursor:pointer;">✕</button>
      </div>
      <p style="margin:0;font-size:0.86rem;color:var(--text-muted);line-height:1.5;">
        ${esc(t('account.deleted_export_modal_desc'))}
      </p>
      <div style="padding:12px;border-radius:10px;border:1px solid var(--border-color);background:var(--bg-card);display:flex;flex-direction:column;gap:6px;font-size:0.82rem;">
        <div><strong>${esc(t('account.export_file_label'))}:</strong> ${esc(exp.filename)} (${esc(formatBytesSize(exp.size_bytes))} · ${Number(exp.file_count) || 0})</div>
        <div><strong>${esc(t('account.export_expires_label'))}:</strong> ${esc(formatTs(exp.expires_at))}</div>
        <div><strong>SHA-256:</strong> <code style="font-size:0.74rem;word-break:break-all;">${esc(exp.sha256 || '')}</code></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <a href="${esc(exp.download_url)}" class="sysmon-action-btn" style="flex:1;justify-content:center;padding:9px 14px;background:var(--accent-primary,#6366f1);color:#fff;font-weight:600;text-decoration:none;">
          ⬇️ ${esc(t('account.export_download_btn'))}
        </a>
        <button type="button" id="postDelCopyPortalBtn" class="sysmon-action-btn" style="padding:9px 12px;">
          📋 ${esc(t('account.export_copy_link_btn'))}
        </button>
        <a href="${esc(exp.portal_url)}" target="_blank" rel="noopener" class="sysmon-action-btn" style="padding:9px 12px;text-decoration:none;">
          🔗 ${esc(t('account.export_open_portal_btn'))}
        </a>
      </div>
      <div id="postDelReceiptZone" style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--border-color);padding-top:12px;">
        <button type="button" id="postDelConfirmReceiptBtn" class="sysmon-action-btn" style="justify-content:center;padding:9px 14px;background:#16a34a;color:#fff;font-weight:600;">
          ✅ ${esc(t('account.export_confirm_receipt_btn'))}
        </button>
        <div id="postDelReceiptStatus" style="font-size:0.8rem;color:var(--text-muted);"></div>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    box.querySelector('#postDelCloseBtn')?.addEventListener('click', () => overlay.remove());
    box.querySelector('#postDelCopyPortalBtn')?.addEventListener('click', () => {
      copyText(exp.portal_url || exp.download_url || '').then(() => settingsApp.toast.success(t('users.copied_toast')));
    });
    box.querySelector('#postDelConfirmReceiptBtn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const statusEl = box.querySelector('#postDelReceiptStatus');
      btn.disabled = true;
      const r = await settingsApp.api.post('confirm_account_export_receipt', { token: exp.token });
      if (r && r.success) {
        if (statusEl) {
          statusEl.style.color = '#22c55e';
          statusEl.textContent = '✅ ' + t('account.export_receipt_confirmed_toast');
        }
        settingsApp.toast.success(t('account.export_receipt_confirmed_toast'));
      } else {
        btn.disabled = false;
        if (statusEl) {
          statusEl.style.color = '#f87171';
          statusEl.textContent = '⚠️ ' + ((r && r.error) || t('users.action_error'));
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // ACCOUNT DATA EXPORT (SIGNED ZIP) & SELF-DELETION DANGER ZONE
  // ---------------------------------------------------------------------------
  async function renderAccountDangerZoneCard(container, settingsApp) {
    if (!container || !settingsApp) return;
    const t = (k, p) => settingsApp.t(k, p);
    const currentUser = (window.sys && window.sys.shares && typeof window.sys.shares.getCurrentUser === 'function')
      ? window.sys.shares.getCurrentUser()
      : window.SG_CURRENT_USER;
    if (!currentUser || !currentUser.id) {
      container.innerHTML = '';
      return;
    }

    const listRes = await settingsApp.api.get('list_account_exports');
    const exportsList = (listRes && listRes.success && Array.isArray(listRes.exports)) ? listRes.exports : [];
    const lastCreated = settingsApp.state && settingsApp.state.lastAccountExport ? settingsApp.state.lastAccountExport : null;

    const latestExportHtml = lastCreated ? `
      <div style="margin-top:10px;padding:12px;border-radius:10px;border:1px solid rgba(99,102,241,0.45);background:rgba(99,102,241,0.08);display:flex;flex-direction:column;gap:8px;font-size:0.82rem;">
        <div style="font-weight:700;color:var(--text-main);">📦 ${esc(lastCreated.filename)} (${esc(formatBytesSize(lastCreated.size_bytes))} · ${Number(lastCreated.file_count) || 0})</div>
        <div style="color:var(--text-muted);font-size:0.76rem;">
          ${esc(t('account.export_expires_label'))}: <strong>${esc(formatTs(lastCreated.expires_at))}</strong>
        </div>
        <div style="font-size:0.74rem;color:var(--text-muted);">
          SHA-256: <code style="word-break:break-all;">${esc(lastCreated.sha256 || '')}</code>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <a href="${esc(lastCreated.download_url)}" class="sysmon-action-btn" id="acctExportDownloadLink" style="padding:6px 12px;background:var(--accent-primary,#6366f1);color:#fff;font-weight:600;text-decoration:none;font-size:0.78rem;">
            ⬇️ ${esc(t('account.export_download_btn'))}
          </a>
          <button type="button" id="acctExportCopyPortalBtn" class="sysmon-action-btn" style="padding:6px 10px;font-size:0.78rem;">
            📋 ${esc(t('account.export_copy_link_btn'))}
          </button>
          <a href="${esc(lastCreated.portal_url)}" target="_blank" rel="noopener" class="sysmon-action-btn" style="padding:6px 10px;text-decoration:none;font-size:0.78rem;">
            🔗 ${esc(t('account.export_open_portal_btn'))}
          </a>
          <button type="button" id="acctExportConfirmTokenBtn" class="sysmon-action-btn" style="padding:6px 12px;background:#16a34a;color:#fff;font-weight:600;font-size:0.78rem;">
            ✅ ${esc(t('account.export_confirm_receipt_btn'))}
          </button>
        </div>
      </div>
    ` : '';

    const activeExportsHtml = exportsList.length > 0 ? `
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">
        ${exportsList.map(ex => {
          const completed = Boolean(ex.download_completed_at);
          return `
            <div style="${rowStyle}">
              <div style="display:flex;flex-direction:column;gap:2px;font-size:0.79rem;">
                <div style="font-weight:600;color:var(--text-main);">
                  📦 ${esc(ex.filename)} <span style="font-weight:400;color:var(--text-muted);">(${esc(formatBytesSize(ex.size_bytes))})</span>
                  <span style="margin-left:6px;padding:1px 7px;border-radius:99px;font-size:0.68rem;background:${completed ? 'rgba(34,197,94,0.16)' : 'rgba(245,158,11,0.16)'};color:${completed ? '#22c55e' : '#f59e0b'};font-weight:700;">
                    ${esc(completed ? t('account.export_status_downloaded') : t('account.export_status_pending'))}
                  </span>
                </div>
                <div style="font-size:0.72rem;color:var(--text-muted);">
                  ${esc(t('account.export_expires_label'))}: ${esc(formatTs(ex.expires_at))} · SHA-256: <code>${esc((ex.sha256 || '').slice(0, 16))}…</code>
                </div>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${completed ? `
                  <button type="button" class="acct-export-confirm-id-btn" data-id="${ex.id}" style="padding:4px 9px;border-radius:6px;border:none;background:#16a34a;color:#fff;cursor:pointer;font-size:0.74rem;font-weight:600;">
                    ✅ ${esc(t('account.export_confirm_receipt_short'))}
                  </button>
                ` : ''}
                <button type="button" class="acct-export-discard-id-btn" data-id="${ex.id}" style="padding:4px 9px;border-radius:6px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.74rem;">
                  🗑️ ${esc(t('account.export_purge_btn'))}
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    ` : '';

    const exportCardHtml = window.sys.ui.card({
      title: 'account.export_title',
      icon: '📦',
      content: `
        <p style="font-size:0.8rem;color:var(--text-muted);margin:0 0 10px;">
          ${esc(t('account.export_desc'))}
        </p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <select id="acctExportTtlSelect" style="${inputStyle}">
            <option value="6">6 h</option>
            <option value="24" selected>24 h</option>
            <option value="72">72 h</option>
          </select>
          <button type="button" id="acctGenerateExportBtn" class="sysmon-action-btn" style="padding:7px 14px;background:var(--accent-primary,#6366f1);color:#fff;font-weight:600;">
            📦 ${esc(t('account.export_generate_btn'))}
          </button>
        </div>
        ${latestExportHtml}
        ${activeExportsHtml}
      `
    });

    const deleteCardHtml = window.sys.ui.card({
      title: 'account.delete_title',
      icon: '⚠️',
      content: `
        <div style="padding:10px 12px;border-radius:9px;border:1px solid rgba(239,68,68,0.45);background:rgba(239,68,68,0.1);color:#fca5a5;font-size:0.8rem;line-height:1.5;margin-bottom:12px;">
          ⚠️ ${esc(t('account.delete_warning'))}
        </div>
        <form id="acctSelfDeleteForm" style="display:flex;flex-direction:column;gap:10px;">
          <label style="display:inline-flex;align-items:center;gap:8px;font-size:0.82rem;color:var(--text-main);cursor:pointer;">
            <input type="checkbox" id="acctDeleteWithExport" checked />
            <span>📦 ${esc(t('account.delete_with_export_label'))}</span>
          </label>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">
            <input type="password" id="acctDeletePassword" required autocomplete="current-password" placeholder="${esc(t('account.delete_password_placeholder'))}" style="${inputStyle}" />
            <input type="text" id="acctDeleteConfirmUsername" required autocomplete="off" placeholder="${esc(t('account.delete_username_placeholder', { username: currentUser.username }))}" style="${inputStyle}" />
            ${currentUser.has_2fa ? `<input type="text" id="acctDeleteTotp" required inputmode="numeric" autocomplete="one-time-code" placeholder="${esc(t('account.delete_totp_placeholder'))}" style="${inputStyle}" />` : ''}
          </div>
          <label style="display:inline-flex;align-items:center;gap:8px;font-size:0.8rem;color:var(--text-muted);cursor:pointer;">
            <input type="checkbox" id="acctDeleteConfirmCheck" required />
            <span>${esc(t('account.delete_irreversible_check'))}</span>
          </label>
          <div id="acctSelfDeleteError" style="display:none;color:#f87171;font-size:0.82rem;"></div>
          <div>
            <button type="submit" id="acctSelfDeleteSubmitBtn" class="sysmon-action-btn" style="padding:8px 16px;background:rgba(239,68,68,0.22);color:#f87171;border:1px solid rgba(239,68,68,0.5);font-weight:700;">
              🗑️ ${esc(t('account.delete_submit_btn'))}
            </button>
          </div>
        </form>
      `
    });

    container.innerHTML = `${exportCardHtml}${deleteCardHtml}`;

    const rerender = () => renderAccountDangerZoneCard(container, settingsApp);

    container.querySelector('#acctGenerateExportBtn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const ttlHours = parseInt(container.querySelector('#acctExportTtlSelect')?.value || '24', 10) || 24;
      btn.disabled = true;
      const res = await settingsApp.api.post('create_account_export', { ttl_hours: ttlHours });
      btn.disabled = false;
      if (res && res.success && res.export) {
        settingsApp.state.lastAccountExport = res.export;
        settingsApp.toast.success(t('account.export_ready_toast'));
        rerender();
      } else {
        settingsApp.toast.error((res && res.error) || t('users.action_error'));
      }
    });

    container.querySelector('#acctExportCopyPortalBtn')?.addEventListener('click', () => {
      if (lastCreated) {
        copyText(lastCreated.portal_url || lastCreated.download_url || '').then(() => settingsApp.toast.success(t('users.copied_toast')));
      }
    });

    container.querySelector('#acctExportDownloadLink')?.addEventListener('click', () => {
      setTimeout(rerender, 2500);
    });

    container.querySelector('#acctExportConfirmTokenBtn')?.addEventListener('click', async () => {
      if (!lastCreated || !lastCreated.token) return;
      const res = await settingsApp.api.post('confirm_account_export_receipt', { token: lastCreated.token });
      if (res && res.success) {
        settingsApp.state.lastAccountExport = null;
        settingsApp.toast.success(t('account.export_receipt_confirmed_toast'));
        rerender();
      } else {
        settingsApp.toast.warning((res && res.error) || t('users.action_error'));
      }
    });

    container.querySelectorAll('.acct-export-confirm-id-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await settingsApp.api.post('confirm_account_export_receipt', { export_id: parseInt(btn.dataset.id, 10) });
        if (res && res.success) {
          if (settingsApp.state.lastAccountExport && Number(settingsApp.state.lastAccountExport.id) === parseInt(btn.dataset.id, 10)) {
            settingsApp.state.lastAccountExport = null;
          }
          settingsApp.toast.success(t('account.export_receipt_confirmed_toast'));
          rerender();
        } else {
          settingsApp.toast.warning((res && res.error) || t('users.action_error'));
        }
      });
    });

    container.querySelectorAll('.acct-export-discard-id-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await settingsApp.api.post('confirm_account_export_receipt', {
          export_id: parseInt(btn.dataset.id, 10),
          discard_without_download: true
        });
        if (res && res.success) {
          if (settingsApp.state.lastAccountExport && Number(settingsApp.state.lastAccountExport.id) === parseInt(btn.dataset.id, 10)) {
            settingsApp.state.lastAccountExport = null;
          }
          settingsApp.toast.info(t('account.export_purged_toast'));
          rerender();
        } else {
          settingsApp.toast.error((res && res.error) || t('users.action_error'));
        }
      });
    });

    container.querySelector('#acctSelfDeleteForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = container.querySelector('#acctSelfDeleteError');
      const submitBtn = container.querySelector('#acctSelfDeleteSubmitBtn');
      const password = container.querySelector('#acctDeletePassword')?.value || '';
      const confirmUsername = (container.querySelector('#acctDeleteConfirmUsername')?.value || '').trim();
      const totpCode = (container.querySelector('#acctDeleteTotp')?.value || '').trim();
      const confirmIrreversible = Boolean(container.querySelector('#acctDeleteConfirmCheck')?.checked);
      const createExport = Boolean(container.querySelector('#acctDeleteWithExport')?.checked);
      const ttlHours = parseInt(container.querySelector('#acctExportTtlSelect')?.value || '24', 10) || 24;

      if (errEl) errEl.style.display = 'none';

      const finalOk = (window.sys && window.sys.dialog && typeof window.sys.dialog.confirm === 'function')
        ? await window.sys.dialog.confirm(t('account.delete_final_confirm', { username: currentUser.username }))
        : window.confirm(t('account.delete_final_confirm', { username: currentUser.username }));
      if (!finalOk) return;

      if (submitBtn) submitBtn.disabled = true;
      const res = await settingsApp.api.post('delete_own_account', {
        password,
        confirm_username: confirmUsername,
        confirm_irreversible: confirmIrreversible,
        totp_code: totpCode,
        create_export: createExport,
        ttl_hours: ttlHours
      });
      if (submitBtn) submitBtn.disabled = false;

      if (res && res.success) {
        if (window.sys && window.sys.storage && typeof window.sys.storage.clearUserScope === 'function') {
          window.sys.storage.clearUserScope();
        }
        window.IS_ADMIN = false;
        window.SG_CURRENT_USER = null;
        window.SG_MOUNTED_VOLUMES = [];
        window.SG_USER_PREFERENCES = {};
        if (window.desktop) window.desktop.state.isAdmin = false;
        if (window.sys && window.sys.shares && typeof window.sys.shares.refreshIdentity === 'function') {
          await window.sys.shares.refreshIdentity();
        }
        if (window.EventBus && typeof window.EventBus.emit === 'function') {
          window.EventBus.emit('fs:changed');
        }
        settingsApp.toast.info(t('account.deleted_success_toast'));
        if (typeof settingsApp.render === 'function') settingsApp.render();
        if (res.export) {
          showPostDeletionExportModal(res.export, settingsApp);
        }
      } else if (errEl) {
        errEl.textContent = '❌ ' + ((res && res.error) || t('users.action_error'));
        errEl.style.display = 'block';
      }
    });
  }

  window.AtelierUsersPanel = {
    render: (c, s) => renderSection('users', c, s),
    renderSection,
    renderSessionsCard,
    renderAccountDangerZoneCard,
    register: registerUsersSection
  };

  if (window.SettingsApp && typeof window.SettingsApp.registerSection === 'function') {
    registerUsersSection();
  } else if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerUsersSection);
  } else {
    setTimeout(registerUsersSection, 0);
  }
})(window);
