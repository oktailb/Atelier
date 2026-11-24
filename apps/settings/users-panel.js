/**
 * Atelier by GallusTech — Users, Groups, Shares, Registration/2FA/Email & Audit Control Panel Extension
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

  function copyText(str) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(str);
    }
    return Promise.resolve();
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

    const [meRes, usersRes, groupsRes, sharesRes, linksRes, auditRes, authCfgRes] = await Promise.all([
      settingsApp.api.get('get_current_user'),
      settingsApp.api.get('list_users'),
      settingsApp.api.get('list_groups'),
      settingsApp.api.get('list_user_shares', { all: '1' }),
      settingsApp.api.get('list_share_links'),
      settingsApp.api.get('get_audit_logs', { limit: 25 }),
      settingsApp.api.get('get_auth_settings')
    ]);

    const driver = (meRes && meRes.store_driver) ? String(meRes.store_driver) : 'json';
    const users = (usersRes && usersRes.success && Array.isArray(usersRes.users)) ? usersRes.users : [];
    const groups = (groupsRes && groupsRes.success && Array.isArray(groupsRes.groups)) ? groupsRes.groups : [];
    const shares = (sharesRes && sharesRes.success && Array.isArray(sharesRes.shares)) ? sharesRes.shares : [];
    const links = ((linksRes && linksRes.success && Array.isArray(linksRes.links)) ? linksRes.links : []).filter(l => !l.revoked_at);
    const logs = (auditRes && auditRes.success && Array.isArray(auditRes.logs)) ? auditRes.logs : [];
    const authCfg = (authCfgRes && authCfgRes.success && authCfgRes.settings) ? authCfgRes.settings : {};
    const invites = (authCfgRes && authCfgRes.success && Array.isArray(authCfgRes.invites)) ? authCfgRes.invites : [];
    const pendingUsers = (authCfgRes && authCfgRes.success && Array.isArray(authCfgRes.pending_users)) ? authCfgRes.pending_users : [];
    const outbox = (authCfgRes && authCfgRes.success && Array.isArray(authCfgRes.outbox)) ? authCfgRes.outbox : [];

    const rowStyle = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);flex-wrap:wrap;';
    const inputStyle = 'padding:7px 10px;border-radius:7px;border:1px solid var(--border-color);background:var(--bg-main);color:var(--text-main);font-size:0.84rem;';
    const labelStyle = 'display:flex;flex-direction:column;gap:4px;font-size:0.78rem;color:var(--text-muted);';

    // 1. Pending Accounts Approval Queue (only shown when pending/unverified accounts exist)
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

    // 2. Users Management
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

    // 3. Self-Registration & 2FA Policy Card
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

    // 4. Email / SMTP Configuration & Local Outbox Viewer
    const mailDrv = authCfg.mail_driver || 'outbox_log';
    const smtpEnc = authCfg.smtp_encryption || 'tls';
    const mailSectionHtml = `
      <form id="authMailForm" style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">
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
            <input type="email" id="cfgTestEmailTo" placeholder="${esc(t('users.test_email_placeholder'))}" style="${inputStyle};min-width:200px;" />
            <button type="button" id="cfgSendTestEmailBtn" class="sysmon-action-btn" style="padding:7px 12px;font-size:0.8rem;">
              📨 ${esc(t('users.send_test_email_btn'))}
            </button>
          </div>
          <button type="submit" class="sysmon-action-btn" style="padding:7px 16px;background:var(--accent-primary, #6366f1);color:#fff;font-weight:600;">
            💾 ${esc(t('users.save_mail_btn'))}
          </button>
        </div>
      </form>

      ${outbox.length > 0 ? `
        <details style="margin-top:12px;">
          <summary style="cursor:pointer;font-size:0.8rem;color:var(--text-muted);font-weight:600;">
            📬 ${esc(t('users.outbox_title'))} (${outbox.length})
          </summary>
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;max-height:200px;overflow-y:auto;">
            ${outbox.map(m => `
              <div style="padding:7px 9px;border-radius:7px;border:1px solid var(--border-color);background:var(--bg-card);font-size:0.76rem;">
                <div style="display:flex;justify-content:space-between;gap:8px;font-weight:600;">
                  <span>${esc(m.subject)} → ${esc(m.to)}</span>
                  <span style="color:var(--text-muted);">${esc(formatTs(m.created_at))}</span>
                </div>
                <pre style="margin:4px 0 0;white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:0.72rem;color:var(--text-muted);">${esc(m.text || '')}</pre>
              </div>
            `).join('')}
          </div>
        </details>
      ` : ''}
    `;

    // 5. Invitations Manager
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

    // 6. Groups, Shares, Audit (preserved 100%)
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
      ${pendingCardHtml}
      ${window.sys.ui.card({ title: 'users.section_users', icon: '👤', content: usersSectionHtml })}
      ${window.sys.ui.card({ title: 'users.section_registration', icon: '🔐', content: regPolicySectionHtml })}
      ${window.sys.ui.card({ title: 'users.section_mail', icon: '✉️', content: mailSectionHtml })}
      ${window.sys.ui.card({ title: 'users.section_invites', icon: '🎟️', content: invitesSectionHtml })}
      ${window.sys.ui.card({ title: 'users.section_groups', icon: '👥', content: groupsSectionHtml })}
      ${window.sys.ui.card({ title: 'users.section_shares', icon: '💽', content: sharesSectionHtml })}
      ${window.sys.ui.card({ title: 'users.section_audit', icon: '📜', content: auditSectionHtml })}
    `;

    const rerender = () => renderUsersPanel(container, settingsApp);

    container.querySelector('#usersPanelRefreshBtn')?.addEventListener('click', rerender);

    // Approve / Reject pending users
    container.querySelectorAll('.users-approve-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await settingsApp.api.post('approve_user', { user_id: parseInt(btn.dataset.id, 10) });
        if (res && res.success) {
          settingsApp.toast.success(t('users.approved_toast'));
          rerender();
        } else {
          settingsApp.toast.error((res && res.error) || t('users.action_error'));
        }
      });
    });

    container.querySelectorAll('.users-reject-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await settingsApp.api.post('reject_user', { user_id: parseInt(btn.dataset.id, 10) });
        if (res && res.success) {
          settingsApp.toast.info(t('users.rejected_toast'));
          rerender();
        } else {
          settingsApp.toast.error((res && res.error) || t('users.action_error'));
        }
      });
    });

    // Reset 2FA for a user
    container.querySelectorAll('.users-reset-2fa-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id, 10);
        const username = btn.dataset.username || '';
        const confirmed = (window.sys && window.sys.dialog && typeof window.sys.dialog.confirm === 'function')
          ? await window.sys.dialog.confirm(t('users.reset_2fa_confirm', { username }))
          : window.confirm(t('users.reset_2fa_confirm', { username }));
        if (!confirmed) return;
        const res = await settingsApp.api.post('disable_2fa', { user_id: id });
        if (res && res.success) {
          settingsApp.toast.info(t('users.reset_2fa_toast'));
          rerender();
        } else {
          settingsApp.toast.error((res && res.error) || t('users.action_error'));
        }
      });
    });

    // Save Registration & 2FA Policy
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

    // Toggle SMTP fields visibility
    const mailDrvSel = container.querySelector('#cfgMailDriver');
    const smtpFieldsBox = container.querySelector('#cfgSmtpFields');
    if (mailDrvSel && smtpFieldsBox) {
      mailDrvSel.addEventListener('change', () => {
        smtpFieldsBox.style.display = mailDrvSel.value === 'smtp' ? 'grid' : 'none';
      });
    }

    // Save Mail / SMTP config
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
      if (res && res.success) {
        settingsApp.toast.success(t('users.mail_saved_toast'));
        rerender();
      } else {
        settingsApp.toast.error((res && res.error) || t('users.action_error'));
      }
    });

    // Send test email
    container.querySelector('#cfgSendTestEmailBtn')?.addEventListener('click', async () => {
      const to = container.querySelector('#cfgTestEmailTo')?.value.trim() || '';
      if (!to) {
        settingsApp.toast.error(t('users.test_email_placeholder'));
        return;
      }
      const res = await settingsApp.api.post('send_test_email', { email: to });
      if (res && res.success) {
        settingsApp.toast.success(t('users.test_email_sent_toast'));
        rerender();
      } else {
        settingsApp.toast.error((res && res.error) || t('users.action_error'));
      }
    });

    // Create Invite
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
        if (res && res.success) {
          settingsApp.toast.info(t('shares.revoked_toast'));
          rerender();
        }
      });
    });

    container.querySelector('#usersCreateForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = container.querySelector('#newUserUsername')?.value.trim() || '';
      const displayName = container.querySelector('#newUserDisplayName')?.value.trim() || '';
      const email = container.querySelector('#newUserEmail')?.value.trim() || '';
      const password = container.querySelector('#newUserPassword')?.value || '';
      const role = container.querySelector('#newUserRole')?.value || 'user';
      const res = await settingsApp.api.post('create_user', { username, display_name: displayName, email, password, role });
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
