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
    const gdriveRedirectUri = (mountsRes && mountsRes.gdrive_oauth_redirect_uri)
      ? String(mountsRes.gdrive_oauth_redirect_uri)
      : (typeof window !== 'undefined' ? (window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '') + '/api.php?action=gdrive_oauth_callback') : '');
    const gdriveHasServerClient = Boolean(mountsRes && mountsRes.gdrive_has_server_client);
    const trashItems = (trashRes && trashRes.success && Array.isArray(trashRes.items)) ? trashRes.items : [];
    const idxStats = (idxRes && idxRes.success && idxRes.stats) ? idxRes.stats : null;

    const fieldLabelStyle = 'display:block;font-size:0.76rem;font-weight:600;color:var(--text-main);margin-bottom:4px;';
    const fieldHintStyle = 'font-size:0.72rem;color:var(--text-muted);margin-top:3px;line-height:1.35;';
    const sectionHeaderStyle = 'font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--accent-primary,#6366f1);margin-bottom:8px;';
    const guideBoxStyle = 'padding:10px 12px;border-radius:9px;border:1px solid rgba(99,102,241,0.28);background:rgba(99,102,241,0.07);font-size:0.77rem;color:var(--text-main);line-height:1.45;margin-bottom:10px;';
    const presetBtnStyle = 'padding:3px 9px;border-radius:99px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-main);cursor:pointer;font-size:0.72rem;font-weight:500;';

    const pwField = (id, label, placeholder, required = false, hint = '') => `
      <div style="display:flex;flex-direction:column;">
        <label for="${id}" style="${fieldLabelStyle}">${esc(label)}${required ? ' <span style="color:#ef4444;">*</span>' : ''}</label>
        <div style="position:relative;display:flex;align-items:center;">
          <input type="password" id="${id}" ${required ? 'required' : ''} autocomplete="new-password" placeholder="${esc(placeholder)}" style="${inputStyle}width:100%;padding-right:34px;box-sizing:border-box;" />
          <button type="button" class="ext-pw-toggle-btn" data-target="${id}" title="Show/Hide" style="position:absolute;right:6px;background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:0.85rem;padding:2px 4px;">👁️</button>
        </div>
        ${hint ? `<div style="${fieldHintStyle}">${esc(hint)}</div>` : ''}
      </div>
    `;

    const mountsListHtml = `
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border-color);">
        <div style="${sectionHeaderStyle}">${esc(t('storage.mounted_list_title'))} (${mounts.length})</div>
        ${mounts.length === 0
        ? `<div style="font-size:0.82rem;color:var(--text-muted);padding:4px 0;">${esc(t('storage.empty_mounts'))}</div>`
        : `<div style="display:flex;flex-direction:column;gap:8px;">
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
            </div>`}
      </div>`;

    const driverCards = [
      { id: 'webdav', icon: '🌐', title: 'WebDAV', sub: t('storage.driver_webdav_sub') },
      { id: 's3', icon: '🪣', title: 'S3 / R2 / MinIO', sub: t('storage.driver_s3_sub') },
      { id: 'gdrive', icon: '🔺', title: 'Google Drive', sub: t('storage.driver_gdrive_sub') }
    ];
    if (settingsApp.isAdmin) {
      driverCards.push({ id: 'local', icon: '💾', title: t('storage.driver_local_label'), sub: t('storage.driver_local_sub') });
    }

    const mountsCardHtml = window.sys.ui.card({
      title: 'storage.section_mounts',
      icon: '☁️',
      content: `
        <p style="font-size:0.8rem;color:var(--text-muted);margin:0 0 14px;line-height:1.45;">
          ${esc(t('storage.mounts_desc'))}
        </p>
        <form id="extMountCreateForm" style="display:flex;flex-direction:column;gap:14px;">
          <input type="hidden" id="extMountDriver" value="webdav" />

          <div>
            <div style="${sectionHeaderStyle}">${esc(t('storage.step_provider'))}</div>
            <div id="extMountDriverCards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:8px;">
              ${driverCards.map((dc, idx) => `
                <button type="button" class="ext-driver-card" data-driver="${dc.id}" style="text-align:left;padding:10px 12px;border-radius:10px;border:2px solid ${idx === 0 ? 'var(--accent-primary,#6366f1)' : 'var(--border-color)'};background:${idx === 0 ? 'rgba(99,102,241,0.1)' : 'var(--bg-card)'};cursor:pointer;display:flex;flex-direction:column;gap:3px;transition:border-color 0.15s,background 0.15s;">
                  <div style="font-size:0.86rem;font-weight:700;color:var(--text-main);display:flex;align-items:center;gap:6px;">
                    <span>${dc.icon}</span><span>${esc(dc.title)}</span>
                  </div>
                  <div style="font-size:0.71rem;color:var(--text-muted);line-height:1.3;">${esc(dc.sub)}</div>
                </button>
              `).join('')}
            </div>
          </div>

          <div style="padding:12px;border-radius:10px;border:1px solid var(--border-color);background:var(--bg-card);">
            <div style="${sectionHeaderStyle}">${esc(t('storage.step_identity'))}</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;">
              <div style="display:flex;flex-direction:column;">
                <label for="extMountName" style="${fieldLabelStyle}">${esc(t('storage.field_volume_name'))} <span style="color:#ef4444;">*</span></label>
                <input type="text" id="extMountName" required placeholder="${esc(t('storage.mount_name_placeholder'))}" style="${inputStyle}width:100%;box-sizing:border-box;" />
                <div style="${fieldHintStyle}">${esc(t('storage.field_volume_name_hint'))}</div>
              </div>
              <div style="display:flex;flex-direction:column;">
                <label for="extMountPerm" style="${fieldLabelStyle}">${esc(t('storage.field_permission'))}</label>
                <select id="extMountPerm" style="${inputStyle}width:100%;box-sizing:border-box;">
                  <option value="write">${esc(t('shares.perm_write'))}</option>
                  <option value="read">${esc(t('shares.perm_read'))}</option>
                </select>
              </div>
              ${settingsApp.isAdmin ? `
                <div style="display:flex;flex-direction:column;">
                  <label for="extMountTarget" style="${fieldLabelStyle}">${esc(t('storage.field_scope'))}</label>
                  <select id="extMountTarget" style="${inputStyle}width:100%;box-sizing:border-box;">
                    <option value="user">${esc(t('storage.scope_personal'))}</option>
                    <option value="global">${esc(t('storage.scope_global'))}</option>
                  </select>
                </div>
              ` : ''}
            </div>
          </div>

          <div style="padding:12px;border-radius:10px;border:1px solid var(--border-color);background:var(--bg-card);">
            <div style="${sectionHeaderStyle}">${esc(t('storage.step_connection'))}</div>
            <div id="extMountDriverFields" style="display:flex;flex-direction:column;gap:10px;"></div>
          </div>

          <div id="extMountTestFeedback" style="display:none;padding:9px 12px;border-radius:8px;font-size:0.8rem;line-height:1.4;"></div>

          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.8rem;color:var(--text-muted);cursor:pointer;">
              <input type="checkbox" id="extMountShowDesktop" checked />
              <span>${esc(t('shares.show_on_desktop'))}</span>
            </label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button type="button" id="extMountTestConfigBtn" class="sysmon-action-btn" style="padding:7px 13px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-main);font-weight:600;font-size:0.8rem;">
                🔌 ${esc(t('storage.test_before_mount_btn'))}
              </button>
              <button type="submit" id="extMountSubmitBtn" class="sysmon-action-btn" style="padding:7px 15px;background:var(--accent-primary,#6366f1);color:#fff;font-weight:600;font-size:0.82rem;">
                ➕ ${esc(t('storage.add_mount_btn'))}
              </button>
            </div>
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
    const driverInput = container.querySelector('#extMountDriver');
    const feedbackEl = container.querySelector('#extMountTestFeedback');

    const collectMountPayload = () => {
      const driver = driverInput?.value || 'webdav';
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
      return { driver, mount_name, permission, target_type, show_on_desktop, config };
    };

    const bindPasswordToggles = () => {
      fieldsBox?.querySelectorAll('.ext-pw-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const inp = fieldsBox.querySelector('#' + btn.dataset.target);
          if (!inp) return;
          inp.type = inp.type === 'password' ? 'text' : 'password';
          btn.textContent = inp.type === 'password' ? '👁️' : '🙈';
        });
      });
    };

    const renderDriverFields = () => {
      if (!fieldsBox || !driverInput) return;
      if (feedbackEl) { feedbackEl.style.display = 'none'; feedbackEl.textContent = ''; }
      const d = driverInput.value;

      if (d === 'webdav') {
        fieldsBox.innerHTML = `
          <div style="${guideBoxStyle}">
            <div>💡 ${esc(t('storage.webdav_guide'))}</div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;">
              <span style="font-size:0.72rem;font-weight:600;color:var(--text-muted);">${esc(t('storage.presets_label'))}</span>
              <button type="button" class="ext-webdav-preset" data-url="https://cloud.example.com/remote.php/dav/files/USERNAME/" data-name="Nextcloud" style="${presetBtnStyle}">Nextcloud / ownCloud</button>
              <button type="button" class="ext-webdav-preset" data-url="https://nas.example.com:5006/" data-name="Synology NAS" style="${presetBtnStyle}">Synology DSM</button>
              <button type="button" class="ext-webdav-preset" data-url="https://connect.drive.infomaniak.com/" data-name="Infomaniak kDrive" style="${presetBtnStyle}">Infomaniak kDrive</button>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;">
            <label for="extCfgEndpoint" style="${fieldLabelStyle}">${esc(t('storage.webdav_url_label'))} <span style="color:#ef4444;">*</span></label>
            <input type="url" id="extCfgEndpoint" required placeholder="https://cloud.example.com/remote.php/dav/files/user/" style="${inputStyle}width:100%;box-sizing:border-box;" />
            <div style="${fieldHintStyle}">${esc(t('storage.webdav_url_hint'))}</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
            <div style="display:flex;flex-direction:column;">
              <label for="extCfgUsername" style="${fieldLabelStyle}">${esc(t('storage.webdav_user_label'))}</label>
              <input type="text" id="extCfgUsername" autocomplete="username" placeholder="alice" style="${inputStyle}width:100%;box-sizing:border-box;" />
            </div>
            ${pwField('extCfgPassword', t('storage.webdav_pass_label'), '••••••••••••', false)}
          </div>
          ${settingsApp.isAdmin ? `
            <label style="display:inline-flex;align-items:flex-start;gap:8px;font-size:0.78rem;color:var(--text-main);cursor:pointer;margin-top:2px;">
              <input type="checkbox" id="extCfgAllowLan" style="margin-top:2px;" />
              <span><strong>${esc(t('storage.webdav_lan_label'))}</strong><br/><span style="font-size:0.72rem;color:var(--text-muted);">${esc(t('storage.webdav_lan_hint'))}</span></span>
            </label>
          ` : ''}
        `;
        fieldsBox.querySelectorAll('.ext-webdav-preset').forEach(btn => {
          btn.addEventListener('click', () => {
            const ep = fieldsBox.querySelector('#extCfgEndpoint');
            const nameInp = container.querySelector('#extMountName');
            if (ep) { ep.value = btn.dataset.url || ''; ep.focus(); }
            if (nameInp && !nameInp.value.trim()) nameInp.value = btn.dataset.name || '';
          });
        });
      } else if (d === 's3') {
        fieldsBox.innerHTML = `
          <div style="${guideBoxStyle}">
            <div>💡 ${esc(t('storage.s3_guide'))}</div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;">
              <span style="font-size:0.72rem;font-weight:600;color:var(--text-muted);">${esc(t('storage.presets_label'))}</span>
              <button type="button" class="ext-s3-preset" data-endpoint="https://<ACCOUNT_ID>.r2.cloudflarestorage.com" data-region="auto" data-name="Cloudflare R2" style="${presetBtnStyle}">Cloudflare R2</button>
              <button type="button" class="ext-s3-preset" data-endpoint="" data-region="eu-west-3" data-name="AWS S3" style="${presetBtnStyle}">AWS S3</button>
              <button type="button" class="ext-s3-preset" data-endpoint="https://minio.example.com" data-region="us-east-1" data-name="MinIO" style="${presetBtnStyle}">MinIO</button>
              <button type="button" class="ext-s3-preset" data-endpoint="https://s3.fr-par.scw.cloud" data-region="fr-par" data-name="Scaleway" style="${presetBtnStyle}">Scaleway</button>
              <button type="button" class="ext-s3-preset" data-endpoint="https://s3.eu-central-003.backblazeb2.com" data-region="eu-central-003" data-name="Backblaze B2" style="${presetBtnStyle}">Backblaze B2</button>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
            <div style="display:flex;flex-direction:column;">
              <label for="extCfgBucket" style="${fieldLabelStyle}">${esc(t('storage.s3_bucket_label'))} <span style="color:#ef4444;">*</span></label>
              <input type="text" id="extCfgBucket" required placeholder="my-media-bucket" style="${inputStyle}width:100%;box-sizing:border-box;" />
            </div>
            <div style="display:flex;flex-direction:column;">
              <label for="extCfgRegion" style="${fieldLabelStyle}">${esc(t('storage.s3_region_label'))}</label>
              <input type="text" id="extCfgRegion" value="auto" placeholder="auto / eu-west-3" style="${inputStyle}width:100%;box-sizing:border-box;" />
            </div>
            <div style="display:flex;flex-direction:column;">
              <label for="extCfgEndpoint" style="${fieldLabelStyle}">${esc(t('storage.s3_endpoint_label'))}</label>
              <input type="url" id="extCfgEndpoint" placeholder="https://<account>.r2.cloudflarestorage.com" style="${inputStyle}width:100%;box-sizing:border-box;" />
              <div style="${fieldHintStyle}">${esc(t('storage.s3_endpoint_hint'))}</div>
            </div>
            <div style="display:flex;flex-direction:column;">
              <label for="extCfgPrefix" style="${fieldLabelStyle}">${esc(t('storage.s3_prefix_label'))}</label>
              <input type="text" id="extCfgPrefix" placeholder="photos/2026" style="${inputStyle}width:100%;box-sizing:border-box;" />
            </div>
            <div style="display:flex;flex-direction:column;">
              <label for="extCfgAccessKey" style="${fieldLabelStyle}">${esc(t('storage.s3_access_key_label'))} <span style="color:#ef4444;">*</span></label>
              <input type="text" id="extCfgAccessKey" required placeholder="AKIA..." style="${inputStyle}width:100%;box-sizing:border-box;" />
            </div>
            ${pwField('extCfgSecretKey', t('storage.s3_secret_key_label'), '••••••••••••', true)}
          </div>
        `;
        fieldsBox.querySelectorAll('.ext-s3-preset').forEach(btn => {
          btn.addEventListener('click', () => {
            const ep = fieldsBox.querySelector('#extCfgEndpoint');
            const reg = fieldsBox.querySelector('#extCfgRegion');
            const nameInp = container.querySelector('#extMountName');
            if (ep) ep.value = btn.dataset.endpoint || '';
            if (reg) reg.value = btn.dataset.region || 'auto';
            if (nameInp && !nameInp.value.trim()) nameInp.value = btn.dataset.name || '';
          });
        });
      } else if (d === 'gdrive') {
        fieldsBox.innerHTML = `
          <div style="${guideBoxStyle}">
            <div style="font-weight:700;margin-bottom:5px;">🔺 ${esc(t('storage.gdrive_guide_title'))}</div>
            ${gdriveHasServerClient ? `
              <div style="padding:7px 10px;border-radius:7px;background:rgba(34,197,94,0.14);border:1px solid rgba(34,197,94,0.35);color:#16a34a;font-weight:600;margin-bottom:8px;">
                ✅ ${esc(t('storage.gdrive_server_client_ok'))}
              </div>
            ` : `
              <ol style="margin:0 0 8px 18px;padding:0;display:flex;flex-direction:column;gap:4px;">
                <li>${esc(t('storage.gdrive_guide_step1'))}</li>
                <li>${esc(t('storage.gdrive_guide_step2'))}</li>
              </ol>
            `}
            <div style="margin-top:6px;">
              <div style="font-size:0.72rem;font-weight:600;color:var(--text-muted);margin-bottom:3px;">${esc(t('storage.gdrive_redirect_uri_label'))}</div>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <code style="flex:1;min-width:200px;padding:5px 8px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border-color);font-size:0.72rem;word-break:break-all;">${esc(gdriveRedirectUri)}</code>
                <button type="button" id="extGdriveCopyUriBtn" style="${presetBtnStyle}padding:5px 10px;">📋 ${esc(t('storage.gdrive_copy_uri_btn'))}</button>
              </div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;">
            <div style="display:flex;flex-direction:column;">
              <label for="extCfgClientId" style="${fieldLabelStyle}">${esc(t('storage.gdrive_client_id_label'))}${gdriveHasServerClient ? '' : ' <span style="color:#ef4444;">*</span>'}</label>
              <input type="text" id="extCfgClientId" placeholder="1234567890-xxxx.apps.googleusercontent.com" style="${inputStyle}width:100%;box-sizing:border-box;" />
            </div>
            ${pwField('extCfgClientSecret', t('storage.gdrive_client_secret_label'), 'GOCSPX-...', false)}
            <div style="display:flex;flex-direction:column;">
              <label for="extCfgRootFolder" style="${fieldLabelStyle}">${esc(t('storage.gdrive_root_label'))}</label>
              <input type="text" id="extCfgRootFolder" value="root" placeholder="root" style="${inputStyle}width:100%;box-sizing:border-box;" />
              <div style="${fieldHintStyle}">${esc(t('storage.gdrive_root_hint'))}</div>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:2px;">
            <button type="button" id="extGdriveOauthBtn" class="sysmon-action-btn" style="padding:8px 16px;background:#1a73e8;color:#fff;font-weight:700;font-size:0.83rem;border:none;border-radius:8px;cursor:pointer;">
              🔗 ${esc(t('storage.gdrive_connect_btn'))}
            </button>
          </div>

          <details style="margin-top:4px;border:1px solid var(--border-color);border-radius:8px;padding:8px 10px;background:rgba(148,163,184,0.05);">
            <summary style="cursor:pointer;font-size:0.76rem;font-weight:600;color:var(--text-muted);">
              ⚙️ ${esc(t('storage.gdrive_manual_toggle'))}
            </summary>
            <p style="${fieldHintStyle}margin:6px 0 8px;">${esc(t('storage.gdrive_manual_hint'))}</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;">
              ${pwField('extCfgAccessToken', t('storage.gdrive_access_token_label'), 'ya29....', false)}
              ${pwField('extCfgRefreshToken', t('storage.gdrive_refresh_token_label'), '1//0...', false)}
            </div>
          </details>
        `;
        fieldsBox.querySelector('#extGdriveCopyUriBtn')?.addEventListener('click', () => {
          copyText(gdriveRedirectUri).then(() => settingsApp.toast.success(t('users.copied_toast')));
        });
        fieldsBox.querySelector('#extGdriveOauthBtn')?.addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          const payload = collectMountPayload();
          // Pre-open popup synchronously on user gesture so browsers do not block it after await
          const popup = window.open('about:blank', 'atelier_gdrive_oauth', 'width=540,height=660,menubar=no,toolbar=no');
          if (!popup) {
            settingsApp.toast.error(t('storage.gdrive_popup_blocked'));
            return;
          }
          btn.disabled = true;
          const res = await settingsApp.api.post('gdrive_oauth_start', {
            client_id: payload.config.client_id || '',
            client_secret: payload.config.client_secret || '',
            mount_name: payload.mount_name || 'Google Drive',
            permission: payload.permission,
            target_type: payload.target_type,
            show_on_desktop: payload.show_on_desktop,
            root_folder_id: payload.config.root_folder_id || 'root'
          });
          btn.disabled = false;
          if (!res || !res.success || !res.auth_url) {
            try { popup.close(); } catch (_) { }
            settingsApp.toast.error((res && res.error) || t('users.action_error'));
            return;
          }
          popup.location.href = res.auth_url;
          const onMsg = async (ev) => {
            if (ev.origin !== window.location.origin) return;
            if (!ev.data || ev.data.type !== 'atelier_gdrive_oauth_result') return;
            window.removeEventListener('message', onMsg);
            if (ev.data.success) {
              settingsApp.toast.success(t('storage.mount_created_toast'));
              if (window.sys && window.sys.shares) await window.sys.shares.refreshIdentity();
              rerender();
            } else {
              settingsApp.toast.error(ev.data.error || t('users.action_error'));
            }
          };
          window.addEventListener('message', onMsg);
        });
      } else {
        fieldsBox.innerHTML = `
          <div style="${guideBoxStyle}">
            💡 ${esc(t('storage.local_guide'))}
          </div>
          <div style="display:flex;flex-direction:column;">
            <label for="extCfgRootDir" style="${fieldLabelStyle}">${esc(t('storage.local_path_label'))} <span style="color:#ef4444;">*</span></label>
            <input type="text" id="extCfgRootDir" required placeholder="/mnt/nas/photos" style="${inputStyle}width:100%;box-sizing:border-box;" />
            <div style="${fieldHintStyle}">${esc(t('storage.local_path_hint'))}</div>
          </div>
        `;
      }
      bindPasswordToggles();
    };
    renderDriverFields();

    container.querySelectorAll('.ext-driver-card').forEach(card => {
      card.addEventListener('click', () => {
        const next = card.dataset.driver || 'webdav';
        if (driverInput) driverInput.value = next;
        container.querySelectorAll('.ext-driver-card').forEach(c => {
          const active = c.dataset.driver === next;
          c.style.borderColor = active ? 'var(--accent-primary,#6366f1)' : 'var(--border-color)';
          c.style.background = active ? 'rgba(99,102,241,0.1)' : 'var(--bg-card)';
        });
        renderDriverFields();
      });
    });

    container.querySelector('#extMountTestConfigBtn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const payload = collectMountPayload();
      btn.disabled = true;
      if (feedbackEl) {
        feedbackEl.style.display = 'block';
        feedbackEl.style.background = 'rgba(99,102,241,0.1)';
        feedbackEl.style.border = '1px solid rgba(99,102,241,0.35)';
        feedbackEl.style.color = 'var(--text-main)';
        feedbackEl.textContent = '⏳ ' + t('storage.testing_status');
      }
      const res = await settingsApp.api.post('test_external_mount_config', payload);
      btn.disabled = false;
      if (res && res.success) {
        if (feedbackEl) {
          feedbackEl.style.background = 'rgba(34,197,94,0.12)';
          feedbackEl.style.border = '1px solid rgba(34,197,94,0.4)';
          feedbackEl.style.color = '#16a34a';
          feedbackEl.textContent = '✅ ' + (res.message || t('storage.test_ok_toast'));
        }
        settingsApp.toast.success(res.message || t('storage.test_ok_toast'));
      } else {
        const msg = (res && (res.message || res.error)) || t('users.action_error');
        if (feedbackEl) {
          feedbackEl.style.background = 'rgba(239,68,68,0.12)';
          feedbackEl.style.border = '1px solid rgba(239,68,68,0.4)';
          feedbackEl.style.color = '#ef4444';
          feedbackEl.textContent = '❌ ' + msg;
        }
        settingsApp.toast.error(msg);
      }
    });

    container.querySelector('#extMountCreateForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = collectMountPayload();
      const res = await settingsApp.api.post('create_external_mount', payload);
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
      case 'mail': return renderMailSection(container, settingsApp);
      case 'shares': return renderSharesAndAuditSection(container, settingsApp);
      case 'storage': return renderStorageSection(container, settingsApp);
      case 'users':
      default: return renderUsersAndGroupsSection(container, settingsApp);
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

  // ---------------------------------------------------------------------------
  // EXTERNAL WEB APPS MANAGER & DEFAULT FILE ASSOCIATIONS (Lot 2 — Plugins Tab)
  // ---------------------------------------------------------------------------
  function formatAppBytes(bytes) {
    const b = Number(bytes) || 0;
    if (b <= 0) return '0 B';
    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
    if (b >= 1024) return Math.round(b / 1024) + ' KB';
    return b + ' B';
  }

  function renderAppIconHtml(icon) {
    const raw = String(icon || '🌐').trim();
    if (/^(apps\/|assets\/|icons\/|system\/)/i.test(raw) || /\.(svg|png|jpe?g|webp|ico)$/i.test(raw)) {
      return `<img src="${esc(raw)}" alt="" style="width:24px;height:24px;object-fit:contain;border-radius:4px;vertical-align:middle;" />`;
    }
    return `<span style="font-size:1.25rem;line-height:1;">${esc(raw)}</span>`;
  }

  async function renderExternalAppsSection(container, settingsApp, opts = {}) {
    if (!container || !settingsApp) return;
    const t = (k, p) => settingsApp.t(k, p);
    const appMgr = (window.sys && window.sys.appManager) ? window.sys.appManager : null;
    const needsReload = Boolean(opts.needsReload);

    // 1. Personal Default File Associations card (visible to every user)
    const userDefaults = (appMgr && typeof appMgr.getUserDefaultApps === 'function')
      ? appMgr.getUserDefaultApps()
      : {};
    const defaultEntries = Object.entries(userDefaults).sort((a, b) => a[0].localeCompare(b[0]));

    const defaultsHtml = defaultEntries.length === 0
      ? `<p style="margin:0;font-size:0.82rem;color:var(--text-muted);">${esc(t('ext_apps.defaults_empty'))}</p>`
      : `<div style="display:flex;flex-direction:column;gap:6px;">
          ${defaultEntries.map(([ext, appId]) => {
            const title = (appMgr && typeof appMgr.getAppTitle === 'function') ? appMgr.getAppTitle(appId) : appId;
            return `
              <div style="${rowStyle}">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <code style="padding:2px 7px;border-radius:6px;background:rgba(99,102,241,0.14);color:var(--accent-primary,#6366f1);font-weight:700;font-size:0.78rem;">.${esc(ext)}</code>
                  <span style="font-size:0.84rem;font-weight:600;">${esc(title)}</span>
                  <span style="font-size:0.74rem;color:var(--text-muted);">(${esc(appId)})</span>
                </div>
                <button type="button" class="ext-app-reset-default-btn" data-ext="${esc(ext)}" style="padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-main);color:var(--text-main);cursor:pointer;font-size:0.75rem;">
                  ↺ ${esc(t('ext_apps.defaults_reset_btn'))}
                </button>
              </div>
            `;
          }).join('')}
        </div>`;

    const defaultsCard = window.sys.ui.card({
      title: 'ext_apps.defaults_title',
      icon: '⭐',
      content: `
        <p style="margin:0 0 10px 0;font-size:0.82rem;color:var(--text-muted);">${esc(t('ext_apps.defaults_desc'))}</p>
        ${defaultsHtml}
      `
    });

    // 2. Admin External Apps Manager card (strictly admin-only)
    let adminCard = '';
    let extApps = [];
    if (settingsApp.isAdmin) {
      const listRes = await settingsApp.api.get('list_external_apps');
      if (listRes && listRes.success && Array.isArray(listRes.apps)) {
        extApps = listRes.apps;
      }

      const categoryOptions = ['productivity', 'media', 'games', 'communication', 'utilities', 'development', 'education'];
      const reloadBanner = needsReload ? `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;margin-bottom:12px;border-radius:8px;border:1px solid rgba(34,197,94,0.45);background:rgba(34,197,94,0.1);flex-wrap:wrap;">
          <span style="font-size:0.8rem;color:var(--text-main);">✅ ${esc(t('ext_apps.reload_hint'))}</span>
          <button type="button" id="extAppsReloadBtn" style="padding:5px 12px;border-radius:6px;border:none;background:#16a34a;color:#fff;cursor:pointer;font-size:0.78rem;font-weight:600;">
            🔄 ${esc(t('ext_apps.reload_btn'))}
          </button>
        </div>
      ` : '';

      const appsListHtml = extApps.length === 0
        ? `<p style="margin:8px 0 0 0;font-size:0.82rem;color:var(--text-muted);">${esc(t('ext_apps.empty_list'))}</p>`
        : `<div style="display:flex;flex-direction:column;gap:10px;margin-top:12px;">
            ${extApps.map(app => {
              const healthOk = app.health && app.health.ok !== false;
              const healthBadge = healthOk
                ? `<span style="padding:2px 7px;border-radius:99px;font-size:0.7rem;background:rgba(34,197,94,0.16);color:#22c55e;font-weight:700;">✅ ${esc(t('ext_apps.health_ok'))}</span>`
                : `<span style="padding:2px 7px;border-radius:99px;font-size:0.7rem;background:rgba(239,68,68,0.16);color:#ef4444;font-weight:700;">⚠️ ${esc(t('ext_apps.health_broken'))}</span>`;
              const protoBadge = app.protocol === 'host-parent'
                ? `<span style="padding:2px 7px;border-radius:99px;font-size:0.7rem;background:rgba(99,102,241,0.16);color:var(--accent-primary,#6366f1);font-weight:600;">⚡ ${esc(t('ext_apps.protocol_host'))}</span>`
                : `<span style="padding:2px 7px;border-radius:99px;font-size:0.7rem;background:rgba(148,163,184,0.18);color:var(--text-muted);font-weight:600;">🔗 ${esc(t('ext_apps.protocol_vfs'))}</span>`;
              const originBadge = app.managed
                ? `<span style="padding:2px 7px;border-radius:99px;font-size:0.68rem;border:1px solid var(--border-color);color:var(--text-muted);">${esc(t('ext_apps.managed_badge'))}</span>`
                : `<span style="padding:2px 7px;border-radius:99px;font-size:0.68rem;border:1px solid var(--border-color);color:var(--text-muted);">${esc(t('ext_apps.manual_badge'))}</span>`;
              const exts = Array.isArray(app.extensions) ? app.extensions : [];
              const extsHtml = exts.length > 0
                ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">${exts.slice(0, 12).map(e => `<code style="font-size:0.69rem;padding:1px 5px;border-radius:4px;background:var(--bg-main);border:1px solid var(--border-color);">.${esc(e)}</code>`).join('')}${exts.length > 12 ? `<span style="font-size:0.69rem;color:var(--text-muted);">+${exts.length - 12}</span>` : ''}</div>`
                : '';

              const pending = app.pending_update;
              const pendingBanner = pending ? `
                <div style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;margin-top:6px;border-radius:7px;border:1px solid rgba(245,158,11,0.5);background:rgba(245,158,11,0.12);flex-wrap:wrap;">
                  <div style="font-size:0.79rem;font-weight:600;color:var(--text-main);">
                    🆕 ${esc(t('ext_apps.pending_update_banner', { version: pending.version || '' }))}
                    ${pending.asset_name ? `<span style="font-weight:400;color:var(--text-muted);margin-left:6px;">(${esc(pending.asset_name)})</span>` : ''}
                  </div>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button type="button" class="ext-app-approve-update-btn" data-app-id="${esc(app.id)}" data-app-name="${esc(app.name)}" data-version="${esc(pending.version || '')}" style="padding:4px 10px;border-radius:6px;border:none;background:#16a34a;color:#fff;cursor:pointer;font-size:0.75rem;font-weight:600;">
                      ✅ ${esc(t('ext_apps.approve_update_btn'))}
                    </button>
                    <button type="button" class="ext-app-dismiss-update-btn" data-app-id="${esc(app.id)}" style="padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-main);color:var(--text-main);cursor:pointer;font-size:0.75rem;">
                      ✕ ${esc(t('ext_apps.dismiss_update_btn'))}
                    </button>
                  </div>
                </div>
              ` : '';

              const ov = (app.override && typeof app.override === 'object') ? app.override : {};
              const curCat = ov.category || app.category || 'utilities';
              const curIcon = ov.icon || app.icon || '';
              const curExts = Array.isArray(ov.extensions) ? ov.extensions.join(', ') : exts.join(', ');
              const curRepo = ov.github_repo || app.github_repo || '';
              const curPattern = ov.asset_pattern || app.asset_pattern || '';
              const curVfs = ov.vfsBridge !== false;

              return `
                <div style="${rowStyle};flex-direction:column;align-items:stretch;">
                  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                    <div style="display:flex;align-items:flex-start;gap:10px;min-width:220px;flex:1;">
                      <div style="margin-top:2px;">${renderAppIconHtml(app.icon)}</div>
                      <div>
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                          <strong style="font-size:0.88rem;">${esc(app.name)}</strong>
                          <span style="font-size:0.73rem;color:var(--text-muted);">v${esc(app.version || '1.0.0')}</span>
                          ${healthBadge}
                          ${protoBadge}
                          ${originBadge}
                        </div>
                        <div style="font-size:0.74rem;color:var(--text-muted);margin-top:2px;">
                          <code>${esc(app.rel_path || app.id)}</code> · ${esc(formatAppBytes(app.size_bytes))}
                          ${app.github_repo ? ` · GitHub: <code>${esc(app.github_repo)}</code>` : ''}
                        </div>
                        ${extsHtml}
                      </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                      <button type="button" class="ext-app-uninstall-btn" data-app-id="${esc(app.id)}" data-app-name="${esc(app.name)}" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.75rem;font-weight:600;">
                        🗑️ ${esc(t('ext_apps.uninstall_btn'))}
                      </button>
                    </div>
                  </div>
                  ${pendingBanner}
                  <details style="margin-top:6px;border-top:1px dashed var(--border-color);padding-top:6px;">
                    <summary style="cursor:pointer;font-size:0.76rem;color:var(--text-muted);user-select:none;">⚙️ ${esc(t('ext_apps.configure_btn'))}</summary>
                    <form class="ext-app-override-form" data-app-id="${esc(app.id)}" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-top:8px;">
                      <label style="${labelStyle}">
                        <span>${esc(t('ext_apps.override_icon_label'))}</span>
                        <input type="text" name="icon" value="${esc(curIcon)}" style="${inputStyle}" />
                      </label>
                      <label style="${labelStyle}">
                        <span>${esc(t('ext_apps.override_category_label'))}</span>
                        <select name="category" style="${inputStyle}">
                          ${categoryOptions.map(c => `<option value="${c}" ${curCat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                        </select>
                      </label>
                      <label style="${labelStyle}">
                        <span>${esc(t('ext_apps.override_extensions_label'))}</span>
                        <input type="text" name="extensions" value="${esc(curExts)}" style="${inputStyle}" />
                      </label>
                      <label style="${labelStyle}">
                        <span>${esc(t('ext_apps.github_repo_label'))}</span>
                        <input type="text" name="github_repo" value="${esc(curRepo)}" placeholder="${esc(t('ext_apps.github_repo_placeholder'))}" style="${inputStyle}" />
                      </label>
                      <label style="${labelStyle}">
                        <span>${esc(t('ext_apps.override_asset_pattern_label'))}</span>
                        <input type="text" name="asset_pattern" value="${esc(curPattern)}" style="${inputStyle}" />
                      </label>
                      <label style="display:flex;align-items:center;gap:8px;font-size:0.78rem;color:var(--text-main);align-self:end;padding-bottom:6px;">
                        <input type="checkbox" name="vfsBridge" ${curVfs ? 'checked' : ''} />
                        <span>${esc(t('ext_apps.override_vfs_bridge_label'))}</span>
                      </label>
                      <div style="grid-column:1 / -1;display:flex;justify-content:flex-end;">
                        <button type="submit" style="padding:5px 14px;border-radius:6px;border:none;background:var(--accent-primary,#6366f1);color:#fff;cursor:pointer;font-size:0.77rem;font-weight:600;">
                          💾 ${esc(t('ext_apps.override_save_btn'))}
                        </button>
                      </div>
                    </form>
                  </details>
                </div>
              `;
            }).join('')}
          </div>`;

      adminCard = window.sys.ui.card({
        title: 'ext_apps.manager_title',
        icon: '📦',
        content: `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
            <p style="margin:0;font-size:0.82rem;color:var(--text-muted);flex:1;min-width:240px;">${esc(t('ext_apps.manager_desc'))}</p>
            <button type="button" id="extAppsCheckUpdatesBtn" class="sysmon-action-btn" style="padding:6px 12px;font-size:0.78rem;">
              🔄 ${esc(t('ext_apps.check_updates_btn'))}
            </button>
          </div>
          ${reloadBanner}
          <div id="extAppsStatusMsg" style="display:none;margin-bottom:10px;padding:7px 10px;border-radius:7px;font-size:0.8rem;border:1px solid var(--border-color);background:var(--bg-main);"></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px;">
            <form id="extAppsZipForm" style="display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-main);">
              <strong style="font-size:0.82rem;">🗜️ ${esc(t('ext_apps.deploy_zip_title'))}</strong>
              <label style="${labelStyle}">
                <span>${esc(t('ext_apps.zip_file_label'))}</span>
                <input type="file" id="extAppsZipInput" name="archive" accept=".zip,application/zip" style="${inputStyle}" />
              </label>
              <label style="${labelStyle}">
                <span>${esc(t('ext_apps.github_repo_label'))}</span>
                <input type="text" id="extAppsZipRepo" name="github_repo" placeholder="${esc(t('ext_apps.github_repo_placeholder'))}" style="${inputStyle}" />
              </label>
              <button type="submit" style="margin-top:auto;padding:7px 12px;border-radius:7px;border:none;background:var(--accent-primary,#6366f1);color:#fff;cursor:pointer;font-size:0.8rem;font-weight:600;">
                ⬆️ ${esc(t('ext_apps.install_zip_btn'))}
              </button>
            </form>
            <form id="extAppsUrlForm" style="display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-main);">
              <strong style="font-size:0.82rem;">🌐 ${esc(t('ext_apps.deploy_url_title'))}</strong>
              <label style="${labelStyle}">
                <span>${esc(t('ext_apps.url_label'))}</span>
                <input type="url" id="extAppsUrlInput" name="url" placeholder="${esc(t('ext_apps.url_placeholder'))}" style="${inputStyle}" />
              </label>
              <label style="${labelStyle}">
                <span>${esc(t('ext_apps.github_repo_label'))}</span>
                <input type="text" id="extAppsUrlRepo" name="github_repo" placeholder="${esc(t('ext_apps.github_repo_placeholder'))}" style="${inputStyle}" />
              </label>
              <button type="submit" style="margin-top:auto;padding:7px 12px;border-radius:7px;border:none;background:var(--accent-primary,#6366f1);color:#fff;cursor:pointer;font-size:0.8rem;font-weight:600;">
                ⬇️ ${esc(t('ext_apps.install_url_btn'))}
              </button>
            </form>
          </div>
          ${appsListHtml}
        `
      });
    }

    container.innerHTML = defaultsCard + adminCard;

    // Bind personal default app reset buttons
    container.querySelectorAll('.ext-app-reset-default-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ext = btn.dataset.ext;
        if (ext && appMgr && typeof appMgr.setDefaultAppForExtension === 'function') {
          appMgr.setDefaultAppForExtension(ext, null);
          settingsApp.toast.success(t('ext_apps.defaults_reset_toast', { ext }));
          renderExternalAppsSection(container, settingsApp, { needsReload });
        }
      });
    });

    if (!settingsApp.isAdmin) return;

    const statusEl = container.querySelector('#extAppsStatusMsg');
    const setStatus = (msg, isError = false) => {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.style.display = msg ? 'block' : 'none';
      statusEl.style.color = isError ? '#ef4444' : 'var(--text-main)';
      statusEl.style.borderColor = isError ? 'rgba(239,68,68,0.45)' : 'var(--border-color)';
    };

    const reloadBtn = container.querySelector('#extAppsReloadBtn');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => window.location.reload());
    }

    // Bind ZIP install
    const zipForm = container.querySelector('#extAppsZipForm');
    if (zipForm) {
      zipForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fileInput = container.querySelector('#extAppsZipInput');
        const repoInput = container.querySelector('#extAppsZipRepo');
        const file = fileInput && fileInput.files && fileInput.files[0];
        if (!file) {
          setStatus('⚠️ ' + t('ext_apps.select_zip_error'), true);
          return;
        }
        setStatus('⏳ ' + t('ext_apps.installing_status'));
        const fd = new FormData();
        fd.append('archive', file, file.name);
        if (repoInput && repoInput.value.trim()) {
          fd.append('github_repo', repoInput.value.trim());
        }
        const res = await settingsApp.api.upload('install_external_app_zip', fd);
        if (res && res.success) {
          settingsApp.toast.success(t('ext_apps.installed_toast', { name: (res.app && res.app.name) || file.name }));
          renderExternalAppsSection(container, settingsApp, { needsReload: true });
        } else {
          setStatus('❌ ' + ((res && res.error) || t('ext_apps.error_generic')), true);
        }
      });
    }

    // Bind Direct URL install
    const urlForm = container.querySelector('#extAppsUrlForm');
    if (urlForm) {
      urlForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const urlInput = container.querySelector('#extAppsUrlInput');
        const repoInput = container.querySelector('#extAppsUrlRepo');
        const url = urlInput ? urlInput.value.trim() : '';
        if (!url) {
          setStatus('⚠️ ' + t('ext_apps.enter_url_error'), true);
          return;
        }
        setStatus('⏳ ' + t('ext_apps.installing_status'));
        const res = await settingsApp.api.post('install_external_app_url', {
          url,
          github_repo: repoInput ? repoInput.value.trim() : ''
        });
        if (res && res.success) {
          settingsApp.toast.success(t('ext_apps.installed_toast', { name: (res.app && res.app.name) || url }));
          renderExternalAppsSection(container, settingsApp, { needsReload: true });
        } else {
          setStatus('❌ ' + ((res && res.error) || t('ext_apps.error_generic')), true);
        }
      });
    }

    // Bind Check Updates button
    const checkBtn = container.querySelector('#extAppsCheckUpdatesBtn');
    if (checkBtn) {
      checkBtn.addEventListener('click', async () => {
        checkBtn.disabled = true;
        setStatus('⏳ ' + t('ext_apps.checking_updates_status'));
        const res = await settingsApp.api.post('check_external_app_updates', {});
        checkBtn.disabled = false;
        if (res && res.success) {
          settingsApp.toast.info(t('ext_apps.updates_checked_toast', {
            checked: res.checked || 0,
            updates: res.updates_found || 0
          }));
          renderExternalAppsSection(container, settingsApp, { needsReload });
        } else {
          setStatus('❌ ' + ((res && res.error) || t('ext_apps.error_generic')), true);
        }
      });
    }

    // Bind Approve Update buttons (admin validation required)
    container.querySelectorAll('.ext-app-approve-update-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const appId = btn.dataset.appId;
        const appName = btn.dataset.appName || appId;
        const ver = btn.dataset.version || '';
        btn.disabled = true;
        setStatus('⏳ ' + t('ext_apps.installing_status'));
        const res = await settingsApp.api.post('approve_external_app_update', { app_id: appId });
        if (res && res.success) {
          settingsApp.toast.success(t('ext_apps.update_approved_toast', { name: appName, version: ver }));
          renderExternalAppsSection(container, settingsApp, { needsReload: true });
        } else {
          btn.disabled = false;
          setStatus('❌ ' + ((res && res.error) || t('ext_apps.error_generic')), true);
        }
      });
    });

    // Bind Dismiss Update buttons
    container.querySelectorAll('.ext-app-dismiss-update-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const appId = btn.dataset.appId;
        const res = await settingsApp.api.post('dismiss_external_app_update', { app_id: appId });
        if (res && res.success) {
          settingsApp.toast.info(t('ext_apps.update_dismissed_toast'));
          renderExternalAppsSection(container, settingsApp, { needsReload });
        } else {
          setStatus('❌ ' + ((res && res.error) || t('ext_apps.error_generic')), true);
        }
      });
    });

    // Bind Override forms
    container.querySelectorAll('.ext-app-override-form').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const appId = form.dataset.appId;
        const fd = new FormData(form);
        const rawExts = String(fd.get('extensions') || '').split(',').map(s => s.trim()).filter(Boolean);
        const res = await settingsApp.api.post('save_external_app_override', {
          app_id: appId,
          override: {
            icon: String(fd.get('icon') || '').trim(),
            category: String(fd.get('category') || '').trim(),
            extensions: rawExts,
            github_repo: String(fd.get('github_repo') || '').trim(),
            asset_pattern: String(fd.get('asset_pattern') || '').trim(),
            vfsBridge: Boolean(form.querySelector('[name="vfsBridge"]')?.checked)
          }
        });
        if (res && res.success) {
          settingsApp.toast.success(t('ext_apps.override_saved_toast'));
          renderExternalAppsSection(container, settingsApp, { needsReload: true });
        } else {
          setStatus('❌ ' + ((res && res.error) || t('ext_apps.error_generic')), true);
        }
      });
    });

    // Bind Uninstall buttons
    container.querySelectorAll('.ext-app-uninstall-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const appId = btn.dataset.appId;
        const appName = btn.dataset.appName || appId;
        if (!window.confirm(t('ext_apps.uninstall_confirm', { name: appName }))) return;
        const res = await settingsApp.api.post('uninstall_external_app', { app_id: appId });
        if (res && res.success) {
          settingsApp.toast.success(t('ext_apps.uninstalled_toast'));
          renderExternalAppsSection(container, settingsApp, { needsReload: true });
        } else {
          setStatus('❌ ' + ((res && res.error) || t('ext_apps.error_generic')), true);
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // PHASE C: WEBDAV APP PASSWORDS CARD (Embedded in Security tab for multi-user accounts)
  // ---------------------------------------------------------------------------
  async function renderAppPasswordsCard(container, settingsApp, opts = {}) {
    if (!container || !settingsApp) return;
    const t = (k, p) => settingsApp.t(k, p);
    const res = await settingsApp.api.get('list_app_passwords');
    if (!res || !res.success) {
      container.innerHTML = '';
      return;
    }
    const davUrl = res.dav_url || (window.location.origin + '/dav/');
    const username = res.username || '';
    const passwords = Array.isArray(res.app_passwords) ? res.app_passwords : [];
    const createdSecret = opts.createdSecret || null;

    const secretBanner = createdSecret ? `
      <div style="padding:10px 12px;margin-bottom:12px;border-radius:8px;border:1px solid rgba(34,197,94,0.5);background:rgba(34,197,94,0.12);">
        <div style="font-weight:700;font-size:0.82rem;margin-bottom:4px;color:#22c55e;">🔑 ${esc(t('dav.secret_once_notice'))}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <code style="flex:1;padding:6px 10px;border-radius:6px;background:var(--bg-main);border:1px solid var(--border-color);font-size:0.82rem;word-break:break-all;">${esc(createdSecret)}</code>
          <button type="button" id="davCopySecretBtn" style="padding:5px 11px;border-radius:6px;border:none;background:#16a34a;color:#fff;cursor:pointer;font-size:0.76rem;font-weight:600;">📋 ${esc(t('dav.copy_btn'))}</button>
        </div>
      </div>
    ` : '';

    const listHtml = passwords.length === 0
      ? `<p style="margin:8px 0 0 0;font-size:0.8rem;color:var(--text-muted);">${esc(t('dav.empty_passwords'))}</p>`
      : `<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">
          ${passwords.map(p => `
            <div style="${rowStyle}">
              <div>
                <div style="font-weight:600;font-size:0.83rem;">
                  ${esc(p.label)}
                  <code style="margin-left:6px;font-size:0.73rem;color:var(--text-muted);">${esc(p.token_prefix)}…</code>
                  <span style="margin-left:6px;padding:1px 7px;border-radius:99px;font-size:0.68rem;background:rgba(99,102,241,0.16);color:var(--accent-primary,#6366f1);font-weight:600;">${esc(p.scope === 'read' ? t('dav.scope_read') : t('dav.scope_write'))}</span>
                </div>
                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">
                  ${esc(t('dav.created_at'))}: ${esc(formatTs(p.created_at))}
                  ${p.last_used_at ? ` · ${esc(t('dav.last_used'))}: ${esc(formatTs(p.last_used_at))}` : ''}
                </div>
              </div>
              <button type="button" class="dav-revoke-btn" data-id="${p.id}" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.75rem;font-weight:600;">
                🗑️ ${esc(t('dav.revoke_btn'))}
              </button>
            </div>
          `).join('')}
        </div>`;

    container.innerHTML = window.sys.ui.card({
      title: 'dav.title',
      icon: '🖥️',
      content: `
        <p style="margin:0 0 10px 0;font-size:0.82rem;color:var(--text-muted);">${esc(t('dav.desc'))}</p>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;margin-bottom:10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-main);">
          <span style="font-size:0.76rem;color:var(--text-muted);">${esc(t('dav.endpoint_label'))}</span>
          <code style="flex:1;font-size:0.8rem;word-break:break-all;">${esc(davUrl)}</code>
          <span style="font-size:0.74rem;color:var(--text-muted);">${esc(t('dav.username_label'))}: <strong>${esc(username)}</strong></span>
          <button type="button" id="davCopyUrlBtn" style="padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-main);cursor:pointer;font-size:0.74rem;">📋 ${esc(t('dav.copy_btn'))}</button>
        </div>
        ${secretBanner}
        <form id="davCreatePasswordForm" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <input type="text" id="davLabelInput" placeholder="${esc(t('dav.label_placeholder'))}" style="${inputStyle};flex:1;min-width:180px;" required maxlength="80" />
          <select id="davScopeSelect" style="${inputStyle}">
            <option value="write">${esc(t('dav.scope_write'))}</option>
            <option value="read">${esc(t('dav.scope_read'))}</option>
          </select>
          <button type="submit" style="padding:7px 14px;border-radius:7px;border:none;background:var(--accent-primary,#6366f1);color:#fff;cursor:pointer;font-size:0.8rem;font-weight:600;">
            ➕ ${esc(t('dav.create_btn'))}
          </button>
        </form>
        ${listHtml}
      `
    });

    const copyUrlBtn = container.querySelector('#davCopyUrlBtn');
    if (copyUrlBtn) {
      copyUrlBtn.addEventListener('click', () => {
        copyText(davUrl);
        settingsApp.toast.success(t('dav.copied_toast'));
      });
    }
    const copySecBtn = container.querySelector('#davCopySecretBtn');
    if (copySecBtn && createdSecret) {
      copySecBtn.addEventListener('click', () => {
        copyText(createdSecret);
        settingsApp.toast.success(t('dav.copied_toast'));
      });
    }

    const createForm = container.querySelector('#davCreatePasswordForm');
    if (createForm) {
      createForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const label = container.querySelector('#davLabelInput')?.value?.trim() || 'WebDAV Client';
        const scope = container.querySelector('#davScopeSelect')?.value || 'write';
        const cRes = await settingsApp.api.post('create_app_password', { label, scope });
        if (cRes && cRes.success && cRes.app_password) {
          settingsApp.toast.success(t('dav.created_toast'));
          renderAppPasswordsCard(container, settingsApp, { createdSecret: cRes.app_password.secret });
        } else {
          settingsApp.toast.error((cRes && cRes.error) || t('users.action_error'));
        }
      });
    }

    container.querySelectorAll('.dav-revoke-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        const rRes = await settingsApp.api.post('revoke_app_password', { id });
        if (rRes && rRes.success) {
          settingsApp.toast.info(t('dav.revoked_toast'));
          renderAppPasswordsCard(container, settingsApp);
        } else {
          settingsApp.toast.error((rRes && rRes.error) || t('users.action_error'));
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // PHASE C: ASYNC JOBS QUEUE & AUTOMATED INSTANCE BACKUPS (System Tab — Admin)
  // ---------------------------------------------------------------------------
  async function renderJobsAndBackupsSection(container, settingsApp) {
    if (!container || !settingsApp || !settingsApp.isAdmin) {
      if (container) container.innerHTML = '';
      return;
    }
    const t = (k, p) => settingsApp.t(k, p);
    const [jobsRes, backupsRes] = await Promise.all([
      settingsApp.api.get('list_jobs'),
      settingsApp.api.get('list_instance_backups')
    ]);

    const stats = (jobsRes && jobsRes.stats) || { pending: 0, running: 0, completed: 0, failed: 0 };
    const jobs = (jobsRes && Array.isArray(jobsRes.jobs)) ? jobsRes.jobs : [];
    const backups = (backupsRes && Array.isArray(backupsRes.backups)) ? backupsRes.backups : [];

    const jobsCard = window.sys.ui.card({
      title: 'jobs.title',
      icon: '⚙️',
      content: `
        <p style="margin:0 0 10px 0;font-size:0.82rem;color:var(--text-muted);">${esc(t('jobs.desc'))}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;font-size:0.78rem;">
          <span style="padding:3px 9px;border-radius:99px;background:rgba(245,158,11,0.16);color:#f59e0b;font-weight:700;">⏳ ${esc(t('jobs.stat_pending'))}: ${stats.pending || 0}</span>
          <span style="padding:3px 9px;border-radius:99px;background:rgba(99,102,241,0.16);color:var(--accent-primary,#6366f1);font-weight:700;">⚡ ${esc(t('jobs.stat_running'))}: ${stats.running || 0}</span>
          <span style="padding:3px 9px;border-radius:99px;background:rgba(34,197,94,0.16);color:#22c55e;font-weight:700;">✅ ${esc(t('jobs.stat_completed'))}: ${stats.completed || 0}</span>
          <span style="padding:3px 9px;border-radius:99px;background:rgba(239,68,68,0.16);color:#ef4444;font-weight:700;">❌ ${esc(t('jobs.stat_failed'))}: ${stats.failed || 0}</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <button type="button" class="sysmon-action-btn job-enqueue-btn" data-job-type="generate_thumbnails" style="padding:5px 11px;font-size:0.77rem;">🖼️ ${esc(t('jobs.enqueue_thumbs_btn'))}</button>
          <button type="button" class="sysmon-action-btn job-enqueue-btn" data-job-type="rebuild_file_index" style="padding:5px 11px;font-size:0.77rem;">🔍 ${esc(t('jobs.enqueue_index_btn'))}</button>
          <button type="button" class="sysmon-action-btn job-enqueue-btn" data-job-type="clamav_scan" style="padding:5px 11px;font-size:0.77rem;">🛡️ ${esc(t('jobs.enqueue_clamav_btn'))}</button>
          <button type="button" id="jobRunNextBtn" style="margin-left:auto;padding:5px 12px;border-radius:7px;border:none;background:var(--accent-primary,#6366f1);color:#fff;cursor:pointer;font-size:0.77rem;font-weight:600;">▶ ${esc(t('jobs.run_next_btn'))}</button>
        </div>
        ${jobs.length === 0
          ? `<p style="margin:0;font-size:0.8rem;color:var(--text-muted);">${esc(t('jobs.empty'))}</p>`
          : `<div style="display:flex;flex-direction:column;gap:6px;">
              ${jobs.slice(0, 12).map(j => `
                <div style="${rowStyle}">
                  <div>
                    <strong style="font-size:0.81rem;">#${j.id} · ${esc(j.job_type)}</strong>
                    <span style="margin-left:6px;font-size:0.73rem;color:var(--text-muted);">[${esc(j.status)} · ${j.progress}%]</span>
                    ${j.last_error ? `<div style="font-size:0.72rem;color:#ef4444;margin-top:2px;">${esc(j.last_error)}</div>` : ''}
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-size:0.72rem;color:var(--text-muted);">${esc(formatTs(j.created_at))}</span>
                    ${j.status === 'pending' ? `<button type="button" class="job-cancel-btn" data-job-id="${j.id}" style="padding:3px 8px;border-radius:5px;border:1px solid var(--border-color);background:var(--bg-main);color:var(--text-main);cursor:pointer;font-size:0.72rem;">✕</button>` : ''}
                  </div>
                </div>
              `).join('')}
            </div>`
        }
      `
    });

    const backupsCard = window.sys.ui.card({
      title: 'backups.title',
      icon: '🗄️',
      content: `
        <p style="margin:0 0 10px 0;font-size:0.82rem;color:var(--text-muted);">${esc(t('backups.desc'))}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <button type="button" id="backupCreateMetaBtn" style="padding:6px 12px;border-radius:7px;border:none;background:var(--accent-primary,#6366f1);color:#fff;cursor:pointer;font-size:0.78rem;font-weight:600;">💾 ${esc(t('backups.create_meta_btn'))}</button>
          <button type="button" id="backupCreateFullBtn" class="sysmon-action-btn" style="padding:6px 12px;font-size:0.78rem;">📦 ${esc(t('backups.create_full_btn'))}</button>
        </div>
        ${backups.length === 0
          ? `<p style="margin:0;font-size:0.8rem;color:var(--text-muted);">${esc(t('backups.empty'))}</p>`
          : `<div style="display:flex;flex-direction:column;gap:6px;">
              ${backups.map(b => `
                <div style="${rowStyle}">
                  <div>
                    <code style="font-size:0.78rem;font-weight:600;">${esc(b.filename)}</code>
                    <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">${esc(formatAppBytes(b.size_bytes))} · ${esc(formatTs(b.created_at))}</div>
                  </div>
                  <button type="button" class="backup-delete-btn" data-filename="${esc(b.filename)}" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.74rem;font-weight:600;">
                    🗑️ ${esc(t('backups.delete_btn'))}
                  </button>
                </div>
              `).join('')}
            </div>`
        }
      `
    });

    container.innerHTML = jobsCard + backupsCard;

    container.querySelectorAll('.job-enqueue-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const jobType = btn.dataset.jobType;
        const r = await settingsApp.api.post('enqueue_job', { job_type: jobType });
        if (r && r.success) {
          settingsApp.toast.success(t('jobs.enqueued_toast', { type: jobType }));
          renderJobsAndBackupsSection(container, settingsApp);
        } else {
          settingsApp.toast.error((r && r.error) || t('users.action_error'));
        }
      });
    });

    const runBtn = container.querySelector('#jobRunNextBtn');
    if (runBtn) {
      runBtn.addEventListener('click', async () => {
        runBtn.disabled = true;
        const r = await settingsApp.api.post('run_next_job', {});
        runBtn.disabled = false;
        if (r && r.success) {
          settingsApp.toast.info(r.processed ? t('jobs.ran_toast', { type: r.job.job_type, status: r.job.status }) : t('jobs.queue_empty_toast'));
          renderJobsAndBackupsSection(container, settingsApp);
        } else {
          settingsApp.toast.error((r && r.error) || t('users.action_error'));
        }
      });
    }

    container.querySelectorAll('.job-cancel-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const r = await settingsApp.api.post('cancel_job', { job_id: Number(btn.dataset.jobId) });
        if (r && r.success) {
          renderJobsAndBackupsSection(container, settingsApp);
        }
      });
    });

    const createBackup = async (includeMedia) => {
      const r = await settingsApp.api.post('create_instance_backup', { include_media: includeMedia });
      if (r && r.success) {
        settingsApp.toast.success(t('backups.created_toast', { name: r.backup.filename }));
        renderJobsAndBackupsSection(container, settingsApp);
      } else {
        settingsApp.toast.error((r && r.error) || t('users.action_error'));
      }
    };
    const metaBtn = container.querySelector('#backupCreateMetaBtn');
    if (metaBtn) metaBtn.addEventListener('click', () => createBackup(false));
    const fullBtn = container.querySelector('#backupCreateFullBtn');
    if (fullBtn) fullBtn.addEventListener('click', () => createBackup(true));

    container.querySelectorAll('.backup-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const filename = btn.dataset.filename;
        const r = await settingsApp.api.post('delete_instance_backup', { filename });
        if (r && r.success) {
          settingsApp.toast.info(t('backups.deleted_toast'));
          renderJobsAndBackupsSection(container, settingsApp);
        }
      });
    });
  }

  window.AtelierUsersPanel = {
    render: (c, s) => renderSection('users', c, s),
    renderSection,
    renderSessionsCard,
    renderAccountDangerZoneCard,
    renderExternalAppsSection,
    renderAppPasswordsCard,
    renderJobsAndBackupsSection,
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
