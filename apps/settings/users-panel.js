/**
 * Atelier by GallusTech — Users, Groups, Shares & Audit Control Panel Extension
 * Registers the "Users & Shares" tab into SettingsApp via `settings:register_section`.
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

  async function renderUsersPanel(container, settingsApp) {
    if (!container || !settingsApp) return;
    const t = (key, params) => settingsApp.t(key, params);

    if (!settingsApp.isAdmin) {
      container.innerHTML = window.sys.ui.card({
        title: 'settings.tab_users',
        icon: '👥',
        content: `<p style="font-size:0.88rem;color:var(--text-muted);margin:0;">${esc(t('users.admin_required'))}</p>`
      });
      return;
    }

    container.innerHTML = `<div style="padding:18px;color:var(--text-muted);font-size:0.9rem;">${esc(t('common.loading'))}</div>`;

    const [meRes, usersRes, groupsRes, sharesRes, linksRes, auditRes] = await Promise.all([
      settingsApp.api.get('get_current_user'),
      settingsApp.api.get('list_users'),
      settingsApp.api.get('list_groups'),
      settingsApp.api.get('list_user_shares', { all: '1' }),
      settingsApp.api.get('list_share_links'),
      settingsApp.api.get('get_audit_logs', { limit: 25 })
    ]);

    const driver = (meRes && meRes.store_driver) ? String(meRes.store_driver) : 'json';
    const users = (usersRes && usersRes.success && Array.isArray(usersRes.users)) ? usersRes.users : [];
    const groups = (groupsRes && groupsRes.success && Array.isArray(groupsRes.groups)) ? groupsRes.groups : [];
    const shares = (sharesRes && sharesRes.success && Array.isArray(sharesRes.shares)) ? sharesRes.shares : [];
    const links = ((linksRes && linksRes.success && Array.isArray(linksRes.links)) ? linksRes.links : []).filter(l => !l.revoked_at);
    const logs = (auditRes && auditRes.success && Array.isArray(auditRes.logs)) ? auditRes.logs : [];

    const rowStyle = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);flex-wrap:wrap;';
    const inputStyle = 'padding:7px 10px;border-radius:7px;border:1px solid var(--border-color);background:var(--bg-main);color:var(--text-main);font-size:0.84rem;';

    const usersListHtml = users.length === 0
      ? `<div style="font-size:0.84rem;color:var(--text-muted);padding:6px 0;">${esc(t('users.empty_users'))}</div>`
      : `<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">
          ${users.map(u => {
            const active = Number(u.is_active) === 1;
            const roleColor = (u.role === 'admin' || u.role === 'superadmin') ? '#f59e0b' : '#38bdf8';
            return `
              <div style="${rowStyle}">
                <div style="display:flex;flex-direction:column;gap:2px;">
                  <div style="font-weight:600;font-size:0.88rem;color:var(--text-main);">
                    👤 ${esc(u.display_name || u.username)}
                    <span style="font-weight:400;color:var(--text-muted);">(@${esc(u.username)})</span>
                    <span style="margin-left:6px;padding:1px 7px;border-radius:99px;font-size:0.7rem;background:rgba(56,189,248,0.14);color:${roleColor};font-weight:700;">${esc(u.role)}</span>
                  </div>
                  <div style="font-size:0.75rem;color:var(--text-muted);font-family:monospace;">
                    <button type="button" class="users-open-home-btn" data-home="${esc(u.home_dir)}" style="padding:2px 7px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--accent-primary, #6366f1);cursor:pointer;font-size:0.75rem;font-family:monospace;">
                      📂 /${esc(u.home_dir)}
                    </button>
                  </div>
                </div>
                <div style="display:flex;gap:6px;align-items:center;">
                  <button type="button" class="users-toggle-active-btn" data-id="${u.id}" data-active="${active ? '1' : '0'}" style="padding:4px 10px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:${active ? '#22c55e' : '#ef4444'};cursor:pointer;font-size:0.76rem;font-weight:600;">
                    ${esc(active ? t('users.status_active') : t('users.status_disabled'))}
                  </button>
                  <button type="button" class="users-delete-btn" data-id="${u.id}" data-username="${esc(u.username)}" style="padding:4px 9px;border-radius:6px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.76rem;">
                    🗑️ ${esc(t('common.delete'))}
                  </button>
                </div>
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
        <input type="password" id="newUserPassword" placeholder="${esc(t('users.password_placeholder'))}" required minlength="6" style="${inputStyle}" />
        <select id="newUserRole" style="${inputStyle}">
          <option value="user">${esc(t('users.role_user'))}</option>
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

    const sharesSectionHtml = `
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
        ${links.length === 0
          ? `<div style="font-size:0.84rem;color:var(--text-muted);margin-top:4px;">${esc(t('users.empty_links'))}</div>`
          : links.map(l => `
            <div style="${rowStyle}">
              <div style="font-size:0.82rem;color:var(--text-main);">
                ${l.has_password ? '🔒' : '🔗'} <code>?share=${esc(String(l.token || '').slice(0, 12))}…</code>
                <span style="color:var(--text-muted);font-family:monospace;"> /${esc(l.target_path)}</span>
              </div>
              <button type="button" class="panel-revoke-link-btn" data-id="${l.id}" style="padding:4px 9px;border-radius:6px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.75rem;">
                ${esc(t('shares.revoke_btn'))}
              </button>
            </div>
          `).join('')}
      </div>
    `;

    const auditSectionHtml = logs.length === 0
      ? `<div style="font-size:0.84rem;color:var(--text-muted);">${esc(t('users.empty_audit'))}</div>`
      : `<div style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:5px;font-size:0.77rem;">
          ${logs.map(log => `
            <div style="display:flex;justify-content:space-between;gap:10px;padding:5px 8px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-card);">
              <span><strong>${esc(log.action)}</strong> · ${esc(log.username || 'guest')} ${log.target_path ? `<code>/${esc(log.target_path)}</code>` : ''}</span>
              <span style="color:var(--text-muted);white-space:nowrap;">${esc(formatTs(log.created_at))}</span>
            </div>
          `).join('')}
        </div>`;

    container.innerHTML = `
      ${window.sys.ui.card({ title: 'users.section_users', icon: '👤', content: usersSectionHtml })}
      ${window.sys.ui.card({ title: 'users.section_groups', icon: '👥', content: groupsSectionHtml })}
      ${window.sys.ui.card({ title: 'users.section_shares', icon: '💽', content: sharesSectionHtml })}
      ${window.sys.ui.card({ title: 'users.section_audit', icon: '📜', content: auditSectionHtml })}
    `;

    const rerender = () => renderUsersPanel(container, settingsApp);

    container.querySelector('#usersPanelRefreshBtn')?.addEventListener('click', rerender);

    container.querySelector('#usersCreateForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = container.querySelector('#newUserUsername')?.value.trim() || '';
      const displayName = container.querySelector('#newUserDisplayName')?.value.trim() || '';
      const password = container.querySelector('#newUserPassword')?.value || '';
      const role = container.querySelector('#newUserRole')?.value || 'user';
      const res = await settingsApp.api.post('create_user', { username, display_name: displayName, password, role });
      if (res && res.success) {
        settingsApp.toast.success(t('users.user_created_toast'));
        if (window.sys && window.sys.shares) await window.sys.shares.refreshIdentity();
        if (window.EventBus && typeof window.EventBus.emit === 'function') {
          window.EventBus.emit('fs:changed');
        }
        rerender();
      } else {
        settingsApp.toast.error((res && res.error) || t('users.action_error'));
      }
    });

    container.querySelectorAll('.users-open-home-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const homeDir = btn.dataset.home || '';
        if (!homeDir) return;
        if (window.explorerApp && typeof window.explorerApp.open === 'function') {
          window.explorerApp.open({ dir: homeDir });
        }
      });
    });

    container.querySelectorAll('.users-toggle-active-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        const nextActive = btn.dataset.active === '1' ? 0 : 1;
        const res = await settingsApp.api.post('update_user', { user_id: id, is_active: nextActive });
        if (res && res.success) {
          settingsApp.toast.success(t('users.user_updated_toast'));
          rerender();
        } else {
          settingsApp.toast.error((res && res.error) || t('users.action_error'));
        }
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
        if (res && res.success) {
          settingsApp.toast.info(t('users.user_deleted_toast'));
          rerender();
        } else {
          settingsApp.toast.error((res && res.error) || t('users.action_error'));
        }
      });
    });

    container.querySelector('#groupsCreateForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = container.querySelector('#newGroupName')?.value.trim() || '';
      const displayName = container.querySelector('#newGroupDisplayName')?.value.trim() || '';
      const res = await settingsApp.api.post('create_group', { name, display_name: displayName });
      if (res && res.success) {
        settingsApp.toast.success(t('users.group_created_toast'));
        rerender();
      } else {
        settingsApp.toast.error((res && res.error) || t('users.action_error'));
      }
    });

    container.querySelectorAll('.group-save-members-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const groupId = parseInt(btn.dataset.id, 10);
        const box = container.querySelector(`.group-members-box[data-group-id="${groupId}"]`);
        const userIds = box
          ? Array.from(box.querySelectorAll('.group-member-chk:checked')).map(c => parseInt(c.value, 10))
          : [];
        const res = await settingsApp.api.post('set_group_members', { group_id: groupId, member_ids: userIds });
        if (res && res.success) {
          settingsApp.toast.success(t('users.group_saved_toast'));
          rerender();
        } else {
          settingsApp.toast.error((res && res.error) || t('users.action_error'));
        }
      });
    });

    container.querySelectorAll('.group-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const groupId = parseInt(btn.dataset.id, 10);
        const res = await settingsApp.api.post('delete_group', { group_id: groupId });
        if (res && res.success) {
          settingsApp.toast.info(t('users.group_deleted_toast'));
          rerender();
        } else {
          settingsApp.toast.error((res && res.error) || t('users.action_error'));
        }
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
        if (res && res.success) {
          settingsApp.toast.info(t('shares.revoked_toast'));
          rerender();
        }
      });
    });
  }

  function registerUsersSection() {
    const section = {
      id: 'users',
      title: 'settings.tab_users',
      icon: '👥',
      render: (container, settingsApp) => renderUsersPanel(container, settingsApp)
    };
    if (window.SettingsApp && typeof window.SettingsApp.registerSection === 'function') {
      window.SettingsApp.registerSection(section);
    } else if (window.EventBus && typeof window.EventBus.emit === 'function') {
      window.EventBus.emit('settings:register_section', section);
    }
  }

  window.AtelierUsersPanel = { render: renderUsersPanel, register: registerUsersSection };

  if (window.SettingsApp && typeof window.SettingsApp.registerSection === 'function') {
    registerUsersSection();
  } else if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerUsersSection);
  } else {
    setTimeout(registerUsersSection, 0);
  }
})(window);
