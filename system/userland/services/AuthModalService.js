/**
 * Atelier by GallusTech - Dedicated Centered Authentication, Registration & 2FA Overlay
 * Frosted-glass centered login/registration/2FA/account dialog with heavy desktop backdrop blur,
 * brand header, autonomous account signup, email verification & password reset flows,
 * local RFC 6238 TOTP 2FA enrollment (SVG QR + recovery codes), and active session quick actions.
 */
(function (window, document) {
  'use strict';

  window.sys = window.sys || {};

  function esc(str) {
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

  function toast(level, msg) {
    const svc = (window.sys && window.sys.toast) || (window.sys && window.sys.ui && window.sys.ui.toast);
    if (svc && typeof svc[level] === 'function') {
      svc[level](msg);
    }
  }

  function getLang() {
    if (window.I18nEngine && window.I18nEngine.currentLocale) {
      return window.I18nEngine.currentLocale;
    }
    return (window.SG_I18N_CONFIG && window.SG_I18N_CONFIG.default) || 'fr';
  }

  function getBrandInfo() {
    const titleEl = document.querySelector('.brand-title');
    const subEl = document.querySelector('.brand-subtitle');
    return {
      title: (titleEl && titleEl.textContent.trim()) || 'Atelier',
      subtitle: (subEl && subEl.textContent.trim()) || 'by GallusTech'
    };
  }

  function cleanUrlParams(keys) {
    try {
      if (!window.location || !window.history || typeof window.history.replaceState !== 'function') return;
      const url = new URL(window.location.href);
      let changed = false;
      keys.forEach((k) => {
        if (url.searchParams.has(k)) {
          url.searchParams.delete(k);
          changed = true;
        }
      });
      if (changed) {
        window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : '') + url.hash);
      }
    } catch (e) {}
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text);
    }
    return Promise.resolve();
  }

  function downloadTextFile(filename, content) {
    try {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 500);
    } catch (e) {}
  }

  class AuthModalService {
    constructor() {
      this.overlayEl = null;
      this.activeMode = 'password'; // 'password' | 'register' | 'qr' | 'totp_challenge' | 'totp_setup' | 'totp_codes' | 'forgot_password' | 'reset_password' | 'verify_email' | 'register_done'
      this.showTotpField = false;
      this.pendingContext = {};
      this._onKeyDown = null;
    }

    getAuthPolicy() {
      const p = window.SG_AUTH_POLICY;
      if (p && typeof p === 'object') return p;
      return {
        registration_mode: 'disabled',
        registration_enabled: false,
        invite_required: false,
        approval_required: false,
        require_email_verification: true,
        allow_password_reset: true,
        min_password_length: 8,
        totp_policy: 'optional',
        totp_enabled: true
      };
    }

    isOpen() {
      return Boolean(this.overlayEl && this.overlayEl.parentNode);
    }

    getCurrentUser() {
      if (window.sys && window.sys.shares && typeof window.sys.shares.getCurrentUser === 'function') {
        return window.sys.shares.getCurrentUser();
      }
      return window.SG_CURRENT_USER || null;
    }

    isLoggedIn() {
      return Boolean(window.IS_ADMIN || this.getCurrentUser());
    }

    setDesktopBlur(active) {
      const desktop = document.getElementById('webosDesktop');
      const header = document.querySelector('.app-header');
      if (desktop) desktop.classList.toggle('atelier-auth-blur-active', active);
      if (header) header.classList.toggle('atelier-auth-blur-active', active);
    }

    open(options = {}) {
      const allowedModes = [
        'password', 'register', 'qr', 'totp_challenge', 'totp_setup',
        'totp_codes', 'forgot_password', 'reset_password', 'verify_email', 'register_done'
      ];
      this.activeMode = allowedModes.includes(options.mode) ? options.mode : 'password';
      this.showTotpField = Boolean(options.requireTotp);
      this.pendingContext = options.context ? Object.assign({}, options.context) : {};

      if (this.overlayEl) {
        this.close(true);
      }

      const overlay = document.createElement('div');
      overlay.id = 'atelierAuthOverlay';
      overlay.className = 'atelier-auth-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'atelierAuthHeading');

      this.overlayEl = overlay;
      document.body.appendChild(overlay);
      this.render();
      this.setDesktopBlur(true);

      const raf = (typeof window.requestAnimationFrame === 'function')
        ? window.requestAnimationFrame.bind(window)
        : (fn) => setTimeout(fn, 0);
      raf(() => {
        if (this.overlayEl) this.overlayEl.classList.add('open');
      });

      this._onKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
        }
      };
      document.addEventListener('keydown', this._onKeyDown);
    }

    close(immediate = false) {
      if (this._onKeyDown) {
        document.removeEventListener('keydown', this._onKeyDown);
        this._onKeyDown = null;
      }
      this.setDesktopBlur(false);

      const el = this.overlayEl;
      this.overlayEl = null;
      if (!el) return;

      if (immediate) {
        el.remove();
        return;
      }
      el.classList.remove('open');
      setTimeout(() => {
        if (el.parentNode) el.remove();
      }, 200);
    }

    buildQrSvgPlaceholder() {
      return `
        <svg viewBox="0 0 120 120" width="116" height="116" aria-hidden="true" class="atelier-auth-qr-svg">
          <rect x="6" y="6" width="32" height="32" rx="5" fill="none" stroke="currentColor" stroke-width="6"/>
          <rect x="16" y="16" width="12" height="12" rx="2" fill="currentColor"/>
          <rect x="82" y="6" width="32" height="32" rx="5" fill="none" stroke="currentColor" stroke-width="6"/>
          <rect x="92" y="16" width="12" height="12" rx="2" fill="currentColor"/>
          <rect x="6" y="82" width="32" height="32" rx="5" fill="none" stroke="currentColor" stroke-width="6"/>
          <rect x="16" y="92" width="12" height="12" rx="2" fill="currentColor"/>
          <rect x="50" y="12" width="8" height="8" rx="1.5" fill="currentColor" opacity="0.65"/>
          <rect x="62" y="12" width="8" height="8" rx="1.5" fill="currentColor" opacity="0.35"/>
          <rect x="50" y="26" width="20" height="8" rx="1.5" fill="currentColor" opacity="0.5"/>
          <rect x="14" y="50" width="8" height="20" rx="1.5" fill="currentColor" opacity="0.55"/>
          <rect x="28" y="50" width="14" height="8" rx="1.5" fill="currentColor" opacity="0.4"/>
          <rect x="50" y="48" width="20" height="24" rx="4" fill="var(--accent-primary, #6366f1)" opacity="0.88"/>
          <rect x="78" y="50" width="10" height="10" rx="1.5" fill="currentColor" opacity="0.5"/>
          <rect x="96" y="50" width="14" height="8" rx="1.5" fill="currentColor" opacity="0.65"/>
          <rect x="82" y="66" width="28" height="8" rx="1.5" fill="currentColor" opacity="0.4"/>
          <rect x="50" y="82" width="12" height="12" rx="2" fill="currentColor" opacity="0.6"/>
          <rect x="68" y="82" width="16" height="8" rx="1.5" fill="currentColor" opacity="0.4"/>
          <rect x="92" y="82" width="18" height="18" rx="3" fill="currentColor" opacity="0.55"/>
          <rect x="50" y="102" width="34" height="8" rx="1.5" fill="currentColor" opacity="0.45"/>
        </svg>
      `;
    }

    render() {
      if (!this.overlayEl) return;
      const brand = getBrandInfo();
      const loggedIn = this.isLoggedIn();
      const user = this.getCurrentUser();
      const isAdmin = Boolean(window.IS_ADMIN);
      const policy = this.getAuthPolicy();

      const savedUser = (() => {
        try { return localStorage.getItem('sg_auth_last_username') || ''; } catch (e) { return ''; }
      })();
      const openHomePref = (() => {
        try {
          const v = localStorage.getItem('sg_auth_open_home');
          return v === null ? true : (v === '1');
        } catch (e) { return true; }
      })();
      const rememberPref = Boolean(savedUser);

      // Special modal views that work both pre-login & post-login
      let heading = loggedIn ? t('auth_modal.account_title') : t('auth_modal.title');
      let subtitle = loggedIn ? t('auth_modal.account_subtitle') : t('auth_modal.subtitle');
      let bodyHtml = '';

      if (this.activeMode === 'totp_setup') {
        heading = t('auth_modal.totp_setup_title');
        subtitle = this.pendingContext.mandatory
          ? t('auth_modal.totp_setup_mandatory_desc')
          : t('auth_modal.totp_setup_desc');
        bodyHtml = this.renderTotpSetupView();
      } else if (this.activeMode === 'totp_codes') {
        heading = t('auth_modal.recovery_codes_title');
        subtitle = t('auth_modal.recovery_codes_desc');
        bodyHtml = this.renderRecoveryCodesView();
      } else if (this.activeMode === 'totp_challenge') {
        heading = t('auth_modal.totp_challenge_title');
        subtitle = t('auth_modal.totp_challenge_desc');
        bodyHtml = this.renderTotpChallengeView();
      } else if (this.activeMode === 'verify_email') {
        heading = t('auth_modal.verify_email_title');
        subtitle = t('auth_modal.verify_email_subtitle');
        bodyHtml = this.renderVerifyEmailView();
      } else if (this.activeMode === 'register_done') {
        heading = t('auth_modal.register_done_title');
        subtitle = t('auth_modal.register_done_subtitle');
        bodyHtml = this.renderRegisterDoneView();
      } else if (this.activeMode === 'forgot_password') {
        heading = t('auth_modal.forgot_title');
        subtitle = t('auth_modal.forgot_subtitle');
        bodyHtml = this.renderForgotPasswordView();
      } else if (this.activeMode === 'reset_password') {
        heading = t('auth_modal.reset_title');
        subtitle = t('auth_modal.reset_subtitle');
        bodyHtml = this.renderResetPasswordView();
      } else if (loggedIn) {
        bodyHtml = this.renderLoggedInView(user, isAdmin, policy);
      } else {
        const showRegisterTab = Boolean(policy.registration_enabled || this.pendingContext.inviteToken);
        const isQr = (this.activeMode === 'qr');
        const isReg = (this.activeMode === 'register');
        if (isReg) {
          heading = t('auth_modal.register_title');
          subtitle = t('auth_modal.register_subtitle');
        }

        const tabsCols = showRegisterTab ? 'grid-template-columns: repeat(3, 1fr);' : '';
        bodyHtml = `
          <div class="atelier-auth-mode-tabs" role="tablist" style="${tabsCols}">
            <button type="button" class="atelier-auth-mode-tab ${!isQr && !isReg ? 'active' : ''}" data-auth-mode="password" role="tab" aria-selected="${!isQr && !isReg}">
              🔑 ${esc(t('auth_modal.tab_password'))}
            </button>
            ${showRegisterTab ? `
              <button type="button" class="atelier-auth-mode-tab ${isReg ? 'active' : ''}" data-auth-mode="register" role="tab" aria-selected="${isReg}">
                ✨ ${esc(t('auth_modal.tab_register'))}
              </button>
            ` : ''}
            <button type="button" class="atelier-auth-mode-tab ${isQr ? 'active' : ''}" data-auth-mode="qr" role="tab" aria-selected="${isQr}">
              📱 ${esc(t('auth_modal.tab_qr'))}
            </button>
          </div>

          ${isQr ? `
            <div class="atelier-auth-qr-panel">
              <div class="atelier-auth-qr-frame">
                ${this.buildQrSvgPlaceholder()}
                <span class="atelier-auth-soon-pill">${esc(t('auth_modal.qr_soon_badge'))}</span>
              </div>
              <div class="atelier-auth-qr-title">${esc(t('auth_modal.qr_title'))}</div>
              <p class="atelier-auth-qr-desc">${esc(t('auth_modal.qr_desc'))}</p>
            </div>
          ` : (isReg ? this.renderRegisterForm(policy) : this.renderLoginForm(savedUser, openHomePref, rememberPref, policy))}
        `;
      }

      this.overlayEl.innerHTML = `
        <div class="atelier-auth-box">
          <button type="button" class="atelier-auth-close" id="authModalCloseBtn" title="${esc(t('common.close'))}" aria-label="${esc(t('common.close'))}">✕</button>
          <div class="atelier-auth-brand">
            <div class="atelier-auth-logo" aria-hidden="true">A</div>
            <div class="atelier-auth-brand-text">
              <div class="atelier-auth-brand-row">
                <span class="atelier-auth-brand-name">${esc(brand.title)}</span>
                <span class="atelier-auth-brand-sub">${esc(brand.subtitle)}</span>
              </div>
              <h2 id="atelierAuthHeading" class="atelier-auth-heading">${esc(heading)}</h2>
              <p class="atelier-auth-subtitle">${esc(subtitle)}</p>
            </div>
          </div>
          <div class="atelier-auth-body">
            ${bodyHtml}
          </div>
        </div>
      `;

      this.bindEvents();
    }

    renderLoggedInView(user, isAdmin, policy) {
      const displayName = user ? (user.display_name || user.username) : t('nav.admin');
      const roleLabel = user ? `@${user.username} · ${user.role}` : t('auth_modal.role_root_admin');
      const avatarIcon = user ? (isAdmin ? '🛡️' : '👤') : '🔑';
      const volumes = (window.sys && window.sys.shares && typeof window.sys.shares.getVolumes === 'function')
        ? window.sys.shares.getVolumes()
        : (Array.isArray(window.SG_MOUNTED_VOLUMES) ? window.SG_MOUNTED_VOLUMES : []);

      const totpCardHtml = (user && policy.totp_enabled) ? `
        <div class="atelier-auth-security-card">
          <div class="atelier-auth-security-row">
            <div>
              <div class="atelier-auth-security-title">🛡️ ${esc(t('auth_modal.totp_label'))}</div>
              <div class="atelier-auth-security-sub">
                ${user.has_2fa
                  ? `<span class="atelier-auth-badge-ok">✅ ${esc(t('auth_modal.totp_status_enabled'))}</span>`
                  : `<span class="atelier-auth-badge-muted">${esc(t('auth_modal.totp_status_disabled'))}</span>`}
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${user.has_2fa ? `
                <button type="button" class="atelier-auth-mini-btn" id="authModalRegenCodesBtn">🔑 ${esc(t('auth_modal.totp_regen_codes_btn'))}</button>
                <button type="button" class="atelier-auth-mini-btn danger" id="authModalDisable2faBtn">${esc(t('auth_modal.totp_disable_btn'))}</button>
              ` : `
                <button type="button" class="atelier-auth-mini-btn primary" id="authModalEnable2faBtn">🛡️ ${esc(t('auth_modal.totp_enable_btn'))}</button>
              `}
            </div>
          </div>
        </div>
      ` : '';

      return `
        <div class="atelier-auth-account-card">
          <div class="atelier-auth-avatar">${avatarIcon}</div>
          <div class="atelier-auth-identity">
            <div class="atelier-auth-displayname">${esc(displayName)}</div>
            <div class="atelier-auth-rolebadge">${esc(roleLabel)}</div>
            ${user && user.email ? `<div class="atelier-auth-email-line">✉️ ${esc(user.email)}</div>` : ''}
          </div>
        </div>

        ${totpCardHtml}

        <div class="atelier-auth-quick-actions">
          ${user && user.home_dir ? `
            <button type="button" class="atelier-auth-action-btn primary" id="authModalOpenHomeBtn">
              <span>🏠</span><span>${esc(t('auth_modal.open_home_btn'))}</span>
            </button>
          ` : ''}
          ${isAdmin ? `
            <button type="button" class="atelier-auth-action-btn" id="authModalManageUsersBtn">
              <span>👥</span><span>${esc(t('auth_modal.manage_users_btn'))}</span>
            </button>
          ` : ''}
          <button type="button" class="atelier-auth-action-btn" id="authModalOpenSettingsBtn">
            <span>⚙️</span><span>${esc(t('auth_modal.open_settings_btn'))}</span>
          </button>
        </div>

        ${volumes.length > 0 ? `
          <div class="atelier-auth-volumes-section">
            <div class="atelier-auth-section-label">${esc(t('auth_modal.volumes_title'))}</div>
            <div class="atelier-auth-volumes-list">
              ${volumes.map(v => `
                <button type="button" class="atelier-auth-vol-chip" data-open-vol="${esc(v.path)}">
                  <span>${esc(v.mount_icon || (v.kind === 'home' ? '🏠' : '💽'))}</span>
                  <span>${esc(v.mount_name)}</span>
                  ${v.kind === 'shared' ? `<span class="atelier-auth-perm-tag">${v.permission === 'read' ? 'R' : 'RW'}</span>` : ''}
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="atelier-auth-footer-actions">
          <button type="button" class="atelier-auth-logout-btn" id="authModalLogoutBtn">
            <span>🚪</span><span>${esc(t('auth_modal.sign_out_btn'))}</span>
          </button>
        </div>
      `;
    }

    renderLoginForm(savedUser, openHomePref, rememberPref, policy) {
      return `
        <form id="atelierAuthForm" class="atelier-auth-form" autocomplete="on">
          <div class="atelier-auth-field">
            <label for="authModalUsername">${esc(t('auth_modal.username_label'))}</label>
            <div class="atelier-auth-input-wrap">
              <span class="atelier-auth-input-icon">👤</span>
              <input type="text" id="authModalUsername" name="username" value="${esc(savedUser)}" placeholder="${esc(t('auth_modal.username_placeholder'))}" autocomplete="username" />
            </div>
          </div>

          <div class="atelier-auth-field">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <label for="authModalPassword">${esc(t('auth_modal.password_label'))}</label>
              ${policy.allow_password_reset ? `<button type="button" class="atelier-auth-link-btn" id="authModalForgotBtn">${esc(t('auth_modal.forgot_link'))}</button>` : ''}
            </div>
            <div class="atelier-auth-input-wrap">
              <span class="atelier-auth-input-icon">🔒</span>
              <input type="password" id="authModalPassword" name="password" placeholder="${esc(t('auth_modal.password_placeholder'))}" required autocomplete="current-password" />
              <button type="button" class="atelier-auth-eye-btn" id="authModalTogglePwd" title="${esc(t('auth_modal.toggle_password'))}" aria-label="${esc(t('auth_modal.toggle_password'))}">👁️</button>
            </div>
          </div>

          ${policy.totp_enabled ? `
            <div class="atelier-auth-totp-slot ${this.showTotpField ? 'expanded' : ''}" id="authModalTotpSlot">
              <button type="button" class="atelier-auth-totp-toggle" id="authModalTotpToggle">
                <span>🛡️ ${esc(t('auth_modal.totp_label'))}</span>
                <span class="atelier-auth-soon-pill">${esc(t('auth_modal.totp_optional_badge'))}</span>
              </button>
              <div class="atelier-auth-totp-body" style="${this.showTotpField ? '' : 'display:none;'}">
                <div class="atelier-auth-input-wrap">
                  <span class="atelier-auth-input-icon">🔢</span>
                  <input type="text" id="authModalTotp" name="totp_code" inputmode="text" maxlength="12" placeholder="${esc(t('auth_modal.totp_placeholder'))}" autocomplete="one-time-code" />
                </div>
              </div>
            </div>
          ` : ''}

          <div class="atelier-auth-options">
            <label class="atelier-auth-checkbox">
              <input type="checkbox" id="authModalOptOpenHome" ${openHomePref ? 'checked' : ''} />
              <span>${esc(t('auth_modal.opt_open_home'))}</span>
            </label>
            <label class="atelier-auth-checkbox">
              <input type="checkbox" id="authModalOptRememberUser" ${rememberPref ? 'checked' : ''} />
              <span>${esc(t('auth_modal.opt_remember_user'))}</span>
            </label>
          </div>

          <div id="authModalError" class="atelier-auth-error" style="display:none;" role="alert"></div>
          <div id="authModalResendWrap" style="display:none;text-align:center;">
            <button type="button" class="atelier-auth-link-btn" id="authModalInlineResendBtn">✉️ ${esc(t('auth_modal.resend_verify_btn'))}</button>
          </div>

          <button type="submit" id="authModalSubmitBtn" class="atelier-auth-submit-btn">
            <span>🔑</span><span>${esc(t('auth_modal.submit_btn'))}</span>
          </button>

          <div class="atelier-auth-hint">${esc(t('auth_modal.root_admin_hint'))}</div>
        </form>
      `;
    }

    renderRegisterForm(policy) {
      const inviteToken = this.pendingContext.inviteToken || '';
      const lockedEmail = this.pendingContext.inviteEmail || '';
      const minLen = Number(policy.min_password_length) || 8;
      const showInviteInput = Boolean(policy.invite_required || inviteToken);

      return `
        <form id="atelierRegisterForm" class="atelier-auth-form" autocomplete="on">
          <input type="text" name="website" id="authRegHoneypot" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;" aria-hidden="true" />

          ${showInviteInput ? `
            <div class="atelier-auth-field">
              <label for="authRegInvite">${esc(t('auth_modal.invite_code_label'))}</label>
              <div class="atelier-auth-input-wrap">
                <span class="atelier-auth-input-icon">🎟️</span>
                <input type="text" id="authRegInvite" name="invite_token" value="${esc(inviteToken)}" placeholder="${esc(t('auth_modal.invite_code_placeholder'))}" ${policy.invite_required ? 'required' : ''} />
              </div>
            </div>
          ` : ''}

          <div class="atelier-auth-grid-2">
            <div class="atelier-auth-field">
              <label for="authRegUsername">${esc(t('auth_modal.reg_username_label'))}</label>
              <div class="atelier-auth-input-wrap">
                <span class="atelier-auth-input-icon">@</span>
                <input type="text" id="authRegUsername" name="username" required pattern="[a-zA-Z0-9._-]{2,40}" placeholder="${esc(t('auth_modal.reg_username_placeholder'))}" autocomplete="username" />
              </div>
            </div>
            <div class="atelier-auth-field">
              <label for="authRegDisplayName">${esc(t('auth_modal.reg_display_name_label'))}</label>
              <div class="atelier-auth-input-wrap">
                <span class="atelier-auth-input-icon">👤</span>
                <input type="text" id="authRegDisplayName" name="display_name" placeholder="${esc(t('auth_modal.reg_display_name_placeholder'))}" />
              </div>
            </div>
          </div>

          <div class="atelier-auth-field">
            <label for="authRegEmail">${esc(t('auth_modal.email_label'))}</label>
            <div class="atelier-auth-input-wrap">
              <span class="atelier-auth-input-icon">✉️</span>
              <input type="email" id="authRegEmail" name="email" value="${esc(lockedEmail)}" ${lockedEmail ? 'readonly' : ''} required placeholder="${esc(t('auth_modal.email_placeholder'))}" autocomplete="email" />
            </div>
          </div>

          <div class="atelier-auth-field">
            <label for="authRegPassword">${esc(t('auth_modal.password_label'))}</label>
            <div class="atelier-auth-input-wrap">
              <span class="atelier-auth-input-icon">🔒</span>
              <input type="password" id="authRegPassword" name="password" required minlength="${minLen}" placeholder="${esc(t('auth_modal.reg_password_placeholder', { min: minLen }))}" autocomplete="new-password" />
            </div>
            <div class="atelier-auth-strength-track"><div id="authRegStrengthFill" class="atelier-auth-strength-fill"></div></div>
          </div>

          <div class="atelier-auth-field">
            <label for="authRegPasswordConfirm">${esc(t('auth_modal.password_confirm_label'))}</label>
            <div class="atelier-auth-input-wrap">
              <span class="atelier-auth-input-icon">🔒</span>
              <input type="password" id="authRegPasswordConfirm" name="password_confirm" required minlength="${minLen}" placeholder="${esc(t('auth_modal.password_confirm_placeholder'))}" autocomplete="new-password" />
            </div>
          </div>

          <div id="authModalError" class="atelier-auth-error" style="display:none;" role="alert"></div>

          <button type="submit" id="authRegSubmitBtn" class="atelier-auth-submit-btn">
            <span>✨</span><span>${esc(t('auth_modal.register_submit_btn'))}</span>
          </button>

          ${policy.approval_required ? `<div class="atelier-auth-hint">ℹ️ ${esc(t('auth_modal.approval_notice'))}</div>` : ''}
        </form>
      `;
    }

    renderRegisterDoneView() {
      const ctx = this.pendingContext || {};
      const email = ctx.email || '';
      let icon = '✅';
      let msg = t('auth_modal.register_active_msg');
      if (ctx.requiresVerify) {
        icon = '✉️';
        msg = t('auth_modal.register_check_email_msg', { email });
      } else if (ctx.requiresApproval) {
        icon = '⏳';
        msg = t('auth_modal.register_pending_approval_msg');
      }

      return `
        <div class="atelier-auth-status-box">
          <div class="atelier-auth-status-icon">${icon}</div>
          <p class="atelier-auth-status-text">${esc(msg)}</p>
          ${ctx.mailError ? `<div class="atelier-auth-error" style="display:block;">⚠️ ${esc(ctx.mailError)}</div>` : ''}
          <div style="display:flex;flex-direction:column;gap:8px;width:100%;margin-top:8px;">
            ${ctx.requiresVerify && email ? `
              <button type="button" class="atelier-auth-action-btn" id="authModalResendVerifyBtn" data-email="${esc(email)}">
                <span>🔄</span><span>${esc(t('auth_modal.resend_verify_btn'))}</span>
              </button>
            ` : ''}
            <button type="button" class="atelier-auth-submit-btn" id="authModalBackToLoginBtn">
              <span>🔑</span><span>${esc(t('auth_modal.back_to_login_btn'))}</span>
            </button>
          </div>
        </div>
      `;
    }

    renderVerifyEmailView() {
      const ctx = this.pendingContext || {};
      if (ctx.loading) {
        return `<div class="atelier-auth-status-box"><div class="atelier-auth-status-icon">⏳</div><p class="atelier-auth-status-text">${esc(t('common.loading'))}</p></div>`;
      }
      if (ctx.error) {
        return `
          <div class="atelier-auth-status-box">
            <div class="atelier-auth-status-icon">❌</div>
            <p class="atelier-auth-status-text">${esc(ctx.error)}</p>
            <button type="button" class="atelier-auth-submit-btn" id="authModalBackToLoginBtn">
              <span>🔑</span><span>${esc(t('auth_modal.back_to_login_btn'))}</span>
            </button>
          </div>
        `;
      }
      const msg = ctx.requiresApproval
        ? t('auth_modal.verify_email_pending_approval')
        : t('auth_modal.verify_email_success');
      return `
        <div class="atelier-auth-status-box">
          <div class="atelier-auth-status-icon">${ctx.requiresApproval ? '⏳' : '🎉'}</div>
          <p class="atelier-auth-status-text">${esc(msg)}</p>
          <button type="button" class="atelier-auth-submit-btn" id="authModalBackToLoginBtn">
            <span>🔑</span><span>${esc(t('auth_modal.back_to_login_btn'))}</span>
          </button>
        </div>
      `;
    }

    renderForgotPasswordView() {
      const sent = Boolean(this.pendingContext && this.pendingContext.sent);
      if (sent) {
        return `
          <div class="atelier-auth-status-box">
            <div class="atelier-auth-status-icon">✉️</div>
            <p class="atelier-auth-status-text">${esc(t('auth_modal.forgot_sent_msg'))}</p>
            <button type="button" class="atelier-auth-submit-btn" id="authModalBackToLoginBtn">
              <span>🔑</span><span>${esc(t('auth_modal.back_to_login_btn'))}</span>
            </button>
          </div>
        `;
      }
      return `
        <form id="atelierForgotForm" class="atelier-auth-form">
          <div class="atelier-auth-field">
            <label for="authForgotEmail">${esc(t('auth_modal.email_label'))}</label>
            <div class="atelier-auth-input-wrap">
              <span class="atelier-auth-input-icon">✉️</span>
              <input type="email" id="authForgotEmail" required placeholder="${esc(t('auth_modal.email_placeholder'))}" autocomplete="email" />
            </div>
          </div>
          <div id="authModalError" class="atelier-auth-error" style="display:none;" role="alert"></div>
          <button type="submit" class="atelier-auth-submit-btn">
            <span>✉️</span><span>${esc(t('auth_modal.forgot_submit_btn'))}</span>
          </button>
          <button type="button" class="atelier-auth-link-btn" id="authModalBackToLoginBtn" style="align-self:center;">
            ← ${esc(t('auth_modal.back_to_login_btn'))}
          </button>
        </form>
      `;
    }

    renderResetPasswordView() {
      const policy = this.getAuthPolicy();
      const minLen = Number(policy.min_password_length) || 8;
      if (this.pendingContext && this.pendingContext.done) {
        return `
          <div class="atelier-auth-status-box">
            <div class="atelier-auth-status-icon">✅</div>
            <p class="atelier-auth-status-text">${esc(t('auth_modal.reset_done_msg'))}</p>
            <button type="button" class="atelier-auth-submit-btn" id="authModalBackToLoginBtn">
              <span>🔑</span><span>${esc(t('auth_modal.back_to_login_btn'))}</span>
            </button>
          </div>
        `;
      }
      return `
        <form id="atelierResetForm" class="atelier-auth-form">
          <div class="atelier-auth-field">
            <label for="authResetPwd">${esc(t('auth_modal.reset_new_pwd_label'))}</label>
            <div class="atelier-auth-input-wrap">
              <span class="atelier-auth-input-icon">🔒</span>
              <input type="password" id="authResetPwd" required minlength="${minLen}" placeholder="${esc(t('auth_modal.reg_password_placeholder', { min: minLen }))}" autocomplete="new-password" />
            </div>
          </div>
          <div class="atelier-auth-field">
            <label for="authResetPwdConfirm">${esc(t('auth_modal.password_confirm_label'))}</label>
            <div class="atelier-auth-input-wrap">
              <span class="atelier-auth-input-icon">🔒</span>
              <input type="password" id="authResetPwdConfirm" required minlength="${minLen}" placeholder="${esc(t('auth_modal.password_confirm_placeholder'))}" autocomplete="new-password" />
            </div>
          </div>
          <div id="authModalError" class="atelier-auth-error" style="display:none;" role="alert"></div>
          <button type="submit" class="atelier-auth-submit-btn">
            <span>🔐</span><span>${esc(t('auth_modal.reset_submit_btn'))}</span>
          </button>
        </form>
      `;
    }

    renderTotpChallengeView() {
      const uname = (this.pendingContext && this.pendingContext.username) || '';
      return `
        <form id="atelierTotpChallengeForm" class="atelier-auth-form">
          ${uname ? `<div class="atelier-auth-hint" style="text-align:left;">👤 <strong>@${esc(uname)}</strong></div>` : ''}
          <div class="atelier-auth-field">
            <label for="authChallengeCode">${esc(t('auth_modal.totp_challenge_label'))}</label>
            <div class="atelier-auth-input-wrap">
              <span class="atelier-auth-input-icon">🛡️</span>
              <input type="text" id="authChallengeCode" required maxlength="12" placeholder="${esc(t('auth_modal.totp_placeholder'))}" autocomplete="one-time-code" />
            </div>
          </div>
          <div id="authModalError" class="atelier-auth-error" style="display:none;" role="alert"></div>
          <button type="submit" id="authChallengeSubmitBtn" class="atelier-auth-submit-btn">
            <span>🔓</span><span>${esc(t('auth_modal.totp_verify_btn'))}</span>
          </button>
          <button type="button" class="atelier-auth-link-btn" id="authModalBackToLoginBtn" style="align-self:center;">
            ← ${esc(t('auth_modal.back_to_login_btn'))}
          </button>
        </form>
      `;
    }

    renderTotpSetupView() {
      const setup = (this.pendingContext && this.pendingContext.setup) || null;
      if (!setup) {
        return `<div class="atelier-auth-status-box"><div class="atelier-auth-status-icon">⏳</div><p class="atelier-auth-status-text">${esc(t('common.loading'))}</p></div>`;
      }
      return `
        <div class="atelier-auth-totp-setup">
          <div class="atelier-auth-qr-live-box">${setup.qr_svg || ''}</div>
          <div class="atelier-auth-secret-row">
            <code class="atelier-auth-secret-code">${esc(setup.secret || '')}</code>
            <button type="button" class="atelier-auth-mini-btn" id="authCopySecretBtn">📋 ${esc(t('auth_modal.copy_btn'))}</button>
          </div>
          <form id="atelierTotpConfirmForm" class="atelier-auth-form" style="width:100%;">
            <div class="atelier-auth-field">
              <label for="authSetupTotpCode">${esc(t('auth_modal.totp_confirm_code_label'))}</label>
              <div class="atelier-auth-input-wrap">
                <span class="atelier-auth-input-icon">🔢</span>
                <input type="text" id="authSetupTotpCode" required inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="123456" autocomplete="one-time-code" />
              </div>
            </div>
            <div id="authModalError" class="atelier-auth-error" style="display:none;" role="alert"></div>
            <button type="submit" id="authSetupConfirmBtn" class="atelier-auth-submit-btn">
              <span>🛡️</span><span>${esc(t('auth_modal.totp_confirm_btn'))}</span>
            </button>
          </form>
        </div>
      `;
    }

    renderRecoveryCodesView() {
      const codes = Array.isArray(this.pendingContext && this.pendingContext.codes) ? this.pendingContext.codes : [];
      return `
        <div class="atelier-auth-status-box" style="align-items:stretch;">
          <div class="atelier-auth-recovery-grid">
            ${codes.map((c) => `<code class="atelier-auth-recovery-chip">${esc(c)}</code>`).join('')}
          </div>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button type="button" class="atelier-auth-action-btn" id="authCopyRecoveryBtn" style="flex:1;">
              <span>📋</span><span>${esc(t('auth_modal.copy_btn'))}</span>
            </button>
            <button type="button" class="atelier-auth-action-btn" id="authDownloadRecoveryBtn" style="flex:1;">
              <span>💾</span><span>${esc(t('auth_modal.download_codes_btn'))}</span>
            </button>
          </div>
          <button type="button" class="atelier-auth-submit-btn" id="authDoneRecoveryBtn" style="margin-top:6px;">
            <span>✅</span><span>${esc(t('auth_modal.recovery_saved_btn'))}</span>
          </button>
        </div>
      `;
    }

    bindEvents() {
      if (!this.overlayEl) return;
      const root = this.overlayEl;

      root.addEventListener('click', (e) => {
        if (e.target === root) this.close();
      });

      root.querySelector('#authModalCloseBtn')?.addEventListener('click', () => this.close());

      // Mode switch (Password / Register / QR)
      root.querySelectorAll('[data-auth-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.activeMode = btn.dataset.authMode || 'password';
          this.render();
        });
      });

      root.querySelector('#authModalBackToLoginBtn')?.addEventListener('click', () => {
        this.activeMode = 'password';
        this.pendingContext = {};
        this.render();
      });

      root.querySelector('#authModalForgotBtn')?.addEventListener('click', () => {
        this.activeMode = 'forgot_password';
        this.pendingContext = {};
        this.render();
      });

      // Show/hide password toggle
      const pwdInput = root.querySelector('#authModalPassword');
      root.querySelector('#authModalTogglePwd')?.addEventListener('click', () => {
        if (!pwdInput) return;
        pwdInput.type = (pwdInput.type === 'password') ? 'text' : 'password';
        pwdInput.focus();
      });

      // Expand/collapse optional 2FA input on login form
      root.querySelector('#authModalTotpToggle')?.addEventListener('click', () => {
        this.showTotpField = !this.showTotpField;
        const slot = root.querySelector('#authModalTotpSlot');
        const body = root.querySelector('.atelier-auth-totp-body');
        if (slot) slot.classList.toggle('expanded', this.showTotpField);
        if (body) body.style.display = this.showTotpField ? '' : 'none';
        if (this.showTotpField) root.querySelector('#authModalTotp')?.focus();
      });

      // Password strength bar on registration form
      const regPwd = root.querySelector('#authRegPassword');
      const strengthFill = root.querySelector('#authRegStrengthFill');
      if (regPwd && strengthFill) {
        regPwd.addEventListener('input', () => {
          const val = regPwd.value || '';
          let score = 0;
          if (val.length >= 8) score++;
          if (val.length >= 12) score++;
          if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
          if (/[0-9]/.test(val) && /[^A-Za-z0-9]/.test(val)) score++;
          const pct = Math.min(100, score * 25);
          strengthFill.style.width = pct + '%';
          strengthFill.style.background = score <= 1 ? '#ef4444' : (score === 2 ? '#f59e0b' : '#22c55e');
        });
      }

      // Focus first input cleanly
      if (!this.isLoggedIn() && this.activeMode === 'password') {
        const uInput = root.querySelector('#authModalUsername');
        const targetFocus = (uInput && !uInput.value) ? uInput : pwdInput;
        if (targetFocus) setTimeout(() => targetFocus.focus(), 40);
      } else if (this.activeMode === 'totp_challenge') {
        setTimeout(() => root.querySelector('#authChallengeCode')?.focus(), 40);
      } else if (this.activeMode === 'totp_setup') {
        setTimeout(() => root.querySelector('#authSetupTotpCode')?.focus(), 40);
      }

      // Form submissions
      root.querySelector('#atelierAuthForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleLoginSubmit();
      });
      root.querySelector('#atelierRegisterForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleRegisterSubmit();
      });
      root.querySelector('#atelierTotpChallengeForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleTotpChallengeSubmit();
      });
      root.querySelector('#atelierTotpConfirmForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleTotpSetupConfirm();
      });
      root.querySelector('#atelierForgotForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleForgotSubmit();
      });
      root.querySelector('#atelierResetForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleResetSubmit();
      });

      // Resend verification email button (register_done & inline login error)
      const bindResend = (btn) => {
        if (!btn) return;
        btn.addEventListener('click', async () => {
          const email = btn.dataset.email || (this.pendingContext && this.pendingContext.email) || '';
          if (!email || !window.sys || !window.sys.api) return;
          btn.disabled = true;
          const res = await window.sys.api.post('resend_verification', { email, lang: getLang() });
          btn.disabled = false;
          if (res && res.success) {
            toast('success', t('auth_modal.resend_verify_sent'));
          } else {
            toast('error', (res && res.error) || t('shares.action_error'));
          }
        });
      };
      bindResend(root.querySelector('#authModalResendVerifyBtn'));
      bindResend(root.querySelector('#authModalInlineResendBtn'));

      // Copy / Download 2FA secret & recovery codes
      root.querySelector('#authCopySecretBtn')?.addEventListener('click', () => {
        const secret = this.pendingContext?.setup?.secret || '';
        if (secret) {
          copyToClipboard(secret).then(() => toast('success', t('auth_modal.copied_toast')));
        }
      });
      root.querySelector('#authCopyRecoveryBtn')?.addEventListener('click', () => {
        const codes = (this.pendingContext && this.pendingContext.codes) || [];
        if (codes.length) {
          copyToClipboard(codes.join('\n')).then(() => toast('success', t('auth_modal.copied_toast')));
        }
      });
      root.querySelector('#authDownloadRecoveryBtn')?.addEventListener('click', () => {
        const codes = (this.pendingContext && this.pendingContext.codes) || [];
        if (codes.length) {
          downloadTextFile('atelier-2fa-recovery-codes.txt', 'Atelier by GallusTech — 2FA Recovery Codes\n\n' + codes.join('\n') + '\n');
        }
      });
      root.querySelector('#authDoneRecoveryBtn')?.addEventListener('click', () => {
        const openHome = Boolean(this.pendingContext && this.pendingContext.openHomeAfter);
        this.pendingContext = {};
        if (openHome) {
          const u = this.getCurrentUser();
          this.close();
          if (u && u.home_dir && window.explorerApp && typeof window.explorerApp.open === 'function') {
            window.explorerApp.open({ dir: u.home_dir });
          }
        } else {
          this.activeMode = 'password';
          this.render();
        }
      });

      // Self-service 2FA management in logged-in account view
      root.querySelector('#authModalEnable2faBtn')?.addEventListener('click', () => this.startSelf2faSetup());
      root.querySelector('#authModalDisable2faBtn')?.addEventListener('click', () => this.handleDisable2fa());
      root.querySelector('#authModalRegenCodesBtn')?.addEventListener('click', () => this.handleRegenCodes());

      // Account quick actions
      root.querySelector('#authModalOpenHomeBtn')?.addEventListener('click', () => {
        const u = this.getCurrentUser();
        this.close();
        if (u && u.home_dir && window.explorerApp && typeof window.explorerApp.open === 'function') {
          window.explorerApp.open({ dir: u.home_dir });
        }
      });
      root.querySelector('#authModalManageUsersBtn')?.addEventListener('click', () => {
        this.close();
        if (window.SettingsApp && typeof window.SettingsApp.open === 'function') {
          window.SettingsApp.open('users');
        }
      });
      root.querySelector('#authModalOpenSettingsBtn')?.addEventListener('click', () => {
        this.close();
        if (window.SettingsApp && typeof window.SettingsApp.open === 'function') {
          window.SettingsApp.open(window.IS_ADMIN ? 'security' : 'appearance');
        }
      });
      root.querySelectorAll('[data-open-vol]').forEach(btn => {
        btn.addEventListener('click', () => {
          const volPath = btn.dataset.openVol || '';
          this.close();
          if (window.explorerApp && typeof window.explorerApp.open === 'function') {
            window.explorerApp.open({ dir: volPath });
          }
        });
      });
      root.querySelector('#authModalLogoutBtn')?.addEventListener('click', () => this.handleLogout());
    }

    async finalizeSuccessfulLogin(json, openHome = false) {
      const isAdmin = json.is_admin !== undefined ? Boolean(json.is_admin) : true;
      window.IS_ADMIN = isAdmin;
      window.SG_CURRENT_USER = json.user || null;
      if (Array.isArray(json.mounted_volumes)) {
        window.SG_MOUNTED_VOLUMES = json.mounted_volumes;
      }
      if (json.csrf_token) {
        window.CSRF_TOKEN = json.csrf_token;
        window.SG_CSRF_TOKEN = json.csrf_token;
      }
      if (window.desktop) {
        window.desktop.state.isAdmin = isAdmin;
        if (json.csrf_token) window.desktop.state.csrfToken = json.csrf_token;
      }
      if (window.sys && window.sys.shares && typeof window.sys.shares.refreshIdentity === 'function') {
        await window.sys.shares.refreshIdentity();
      }
      if (window.SettingsApp && typeof window.SettingsApp.render === 'function' && window.SettingsApp.window) {
        window.SettingsApp.render();
      }
      if (window.EventBus && typeof window.EventBus.emit === 'function') {
        window.EventBus.emit('fs:changed');
      }

      if (json.user && !isAdmin) {
        toast('success', t('auth.user_login_success', { name: json.user.display_name || json.user.username }));
      } else {
        toast('success', t('admin.login_success'));
      }

      if (Array.isArray(json.recovery_codes) && json.recovery_codes.length > 0) {
        this.activeMode = 'totp_codes';
        this.pendingContext = { codes: json.recovery_codes, openHomeAfter: openHome };
        this.render();
        return;
      }

      this.close();
      if (openHome && json.user && json.user.home_dir && window.explorerApp && typeof window.explorerApp.open === 'function') {
        window.explorerApp.open({ dir: json.user.home_dir });
      }
    }

    async handleLoginSubmit() {
      if (!this.overlayEl || !window.sys || !window.sys.api) return;
      const username = (this.overlayEl.querySelector('#authModalUsername')?.value || '').trim();
      const password = this.overlayEl.querySelector('#authModalPassword')?.value || '';
      const totpCode = (this.overlayEl.querySelector('#authModalTotp')?.value || '').trim();
      const openHome = Boolean(this.overlayEl.querySelector('#authModalOptOpenHome')?.checked);
      const rememberUser = Boolean(this.overlayEl.querySelector('#authModalOptRememberUser')?.checked);
      const errEl = this.overlayEl.querySelector('#authModalError');
      const resendWrap = this.overlayEl.querySelector('#authModalResendWrap');
      const resendBtn = this.overlayEl.querySelector('#authModalInlineResendBtn');
      const submitBtn = this.overlayEl.querySelector('#authModalSubmitBtn');

      if (!password) return;

      try {
        localStorage.setItem('sg_auth_open_home', openHome ? '1' : '0');
        if (rememberUser && username) {
          localStorage.setItem('sg_auth_last_username', username);
        } else {
          localStorage.removeItem('sg_auth_last_username');
        }
      } catch (e) {}

      if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
      if (resendWrap) resendWrap.style.display = 'none';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>⏳</span><span>${esc(t('auth_modal.signing_in'))}</span>`;
      }

      try {
        const payload = { username, password };
        if (totpCode) payload.totp_code = totpCode;

        const json = await window.sys.api.post('login', payload);
        if (json && json.requires_2fa) {
          this.activeMode = 'totp_challenge';
          this.pendingContext = { username: json.username || username, openHome };
          this.render();
          if (json.error) {
            const newErr = this.overlayEl?.querySelector('#authModalError');
            if (newErr) { newErr.textContent = '❌ ' + json.error; newErr.style.display = 'block'; }
          }
          return;
        }
        if (json && json.requires_2fa_setup && json.setup) {
          this.activeMode = 'totp_setup';
          this.pendingContext = { mandatory: true, isLoginFlow: true, openHome, setup: json.setup };
          this.render();
          return;
        }

        if (json && json.success) {
          await this.finalizeSuccessfulLogin(json, openHome);
          return;
        }

        if (errEl) {
          errEl.textContent = '❌ ' + ((json && json.error) || t('admin.wrong_password'));
          errEl.style.display = 'block';
        }
        if (json && json.code === 'email_unverified' && json.email && resendWrap && resendBtn) {
          resendBtn.dataset.email = json.email;
          resendWrap.style.display = 'block';
        }
      } catch (err) {
        if (errEl) {
          errEl.textContent = '❌ ' + (err && err.message ? err.message : t('shares.action_error'));
          errEl.style.display = 'block';
        }
      } finally {
        if (submitBtn && submitBtn.isConnected) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `<span>🔑</span><span>${esc(t('auth_modal.submit_btn'))}</span>`;
        }
      }
    }

    async handleTotpChallengeSubmit() {
      if (!this.overlayEl || !window.sys || !window.sys.api) return;
      const code = (this.overlayEl.querySelector('#authChallengeCode')?.value || '').trim();
      const errEl = this.overlayEl.querySelector('#authModalError');
      if (!code) return;
      if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

      const json = await window.sys.api.post('verify_2fa_login', { totp_code: code });
      if (json && json.success) {
        await this.finalizeSuccessfulLogin(json, Boolean(this.pendingContext && this.pendingContext.openHome));
      } else if (errEl) {
        errEl.textContent = '❌ ' + ((json && json.error) || t('auth_modal.totp_invalid_code'));
        errEl.style.display = 'block';
      }
    }

    async startSelf2faSetup() {
      if (!window.sys || !window.sys.api) return;
      this.activeMode = 'totp_setup';
      this.pendingContext = { mandatory: false, isLoginFlow: false, setup: null };
      this.render();

      const res = await window.sys.api.post('begin_2fa_setup', {});
      if (res && res.success) {
        this.pendingContext.setup = res;
        this.render();
      } else {
        toast('error', (res && res.error) || t('shares.action_error'));
        this.activeMode = 'password';
        this.render();
      }
    }

    async handleTotpSetupConfirm() {
      if (!this.overlayEl || !window.sys || !window.sys.api) return;
      const code = (this.overlayEl.querySelector('#authSetupTotpCode')?.value || '').trim();
      const errEl = this.overlayEl.querySelector('#authModalError');
      if (!code) return;
      if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

      const isLoginFlow = Boolean(this.pendingContext && this.pendingContext.isLoginFlow);
      const endpoint = isLoginFlow ? 'verify_2fa_login' : 'confirm_2fa_setup';
      const json = await window.sys.api.post(endpoint, { totp_code: code });

      if (json && json.success) {
        if (isLoginFlow) {
          await this.finalizeSuccessfulLogin(json, Boolean(this.pendingContext && this.pendingContext.openHome));
        } else {
          if (json.user) window.SG_CURRENT_USER = json.user;
          if (window.sys && window.sys.shares && typeof window.sys.shares.refreshIdentity === 'function') {
            await window.sys.shares.refreshIdentity();
          }
          toast('success', t('auth_modal.totp_enabled_toast'));
          this.activeMode = 'totp_codes';
          this.pendingContext = { codes: json.recovery_codes || [], openHomeAfter: false };
          this.render();
        }
      } else if (errEl) {
        errEl.textContent = '❌ ' + ((json && json.error) || t('auth_modal.totp_invalid_code'));
        errEl.style.display = 'block';
      }
    }

    async handleDisable2fa() {
      if (!window.sys || !window.sys.api) return;
      const pwd = window.prompt(t('auth_modal.totp_disable_prompt'));
      if (!pwd) return;
      const res = await window.sys.api.post('disable_2fa', { password: pwd });
      if (res && res.success) {
        if (res.user) window.SG_CURRENT_USER = res.user;
        if (window.sys && window.sys.shares) await window.sys.shares.refreshIdentity();
        toast('info', t('auth_modal.totp_disabled_toast'));
        this.render();
      } else {
        toast('error', (res && res.error) || t('shares.action_error'));
      }
    }

    async handleRegenCodes() {
      if (!window.sys || !window.sys.api) return;
      const pwd = window.prompt(t('auth_modal.totp_regen_prompt'));
      if (!pwd) return;
      const res = await window.sys.api.post('regenerate_recovery_codes', { password: pwd });
      if (res && res.success) {
        this.activeMode = 'totp_codes';
        this.pendingContext = { codes: res.recovery_codes || [], openHomeAfter: false };
        this.render();
      } else {
        toast('error', (res && res.error) || t('shares.action_error'));
      }
    }

    async handleRegisterSubmit() {
      if (!this.overlayEl || !window.sys || !window.sys.api) return;
      const username = (this.overlayEl.querySelector('#authRegUsername')?.value || '').trim();
      const displayName = (this.overlayEl.querySelector('#authRegDisplayName')?.value || '').trim();
      const email = (this.overlayEl.querySelector('#authRegEmail')?.value || '').trim();
      const password = this.overlayEl.querySelector('#authRegPassword')?.value || '';
      const confirm = this.overlayEl.querySelector('#authRegPasswordConfirm')?.value || '';
      const inviteToken = (this.overlayEl.querySelector('#authRegInvite')?.value || '').trim();
      const website = (this.overlayEl.querySelector('#authRegHoneypot')?.value || '').trim();
      const errEl = this.overlayEl.querySelector('#authModalError');
      const submitBtn = this.overlayEl.querySelector('#authRegSubmitBtn');

      if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
      if (password !== confirm) {
        if (errEl) { errEl.textContent = '❌ ' + t('auth_modal.password_mismatch'); errEl.style.display = 'block'; }
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      try {
        const res = await window.sys.api.post('register_account', {
          username,
          display_name: displayName || username,
          email,
          password,
          invite_token: inviteToken,
          website,
          lang: getLang()
        });
        if (res && res.success) {
          cleanUrlParams(['invite']);
          this.activeMode = 'register_done';
          this.pendingContext = {
            email,
            requiresVerify: Boolean(res.requires_email_verification),
            requiresApproval: Boolean(res.requires_admin_approval),
            activated: Boolean(res.activated),
            mailError: res.mail_error || null
          };
          this.render();
        } else if (errEl) {
          errEl.textContent = '❌ ' + ((res && res.error) || t('shares.action_error'));
          errEl.style.display = 'block';
        }
      } finally {
        if (submitBtn && submitBtn.isConnected) submitBtn.disabled = false;
      }
    }

    async handleForgotSubmit() {
      if (!this.overlayEl || !window.sys || !window.sys.api) return;
      const email = (this.overlayEl.querySelector('#authForgotEmail')?.value || '').trim();
      const errEl = this.overlayEl.querySelector('#authModalError');
      if (!email) return;
      const res = await window.sys.api.post('request_password_reset', { email, lang: getLang() });
      if (res && res.success) {
        this.pendingContext = { sent: true };
        this.render();
      } else if (errEl) {
        errEl.textContent = '❌ ' + ((res && res.error) || t('shares.action_error'));
        errEl.style.display = 'block';
      }
    }

    async handleResetSubmit() {
      if (!this.overlayEl || !window.sys || !window.sys.api) return;
      const password = this.overlayEl.querySelector('#authResetPwd')?.value || '';
      const confirm = this.overlayEl.querySelector('#authResetPwdConfirm')?.value || '';
      const errEl = this.overlayEl.querySelector('#authModalError');
      const token = (this.pendingContext && this.pendingContext.token) || '';

      if (password !== confirm) {
        if (errEl) { errEl.textContent = '❌ ' + t('auth_modal.password_mismatch'); errEl.style.display = 'block'; }
        return;
      }

      const res = await window.sys.api.post('confirm_password_reset', { token, password });
      if (res && res.success) {
        cleanUrlParams(['reset_password']);
        this.pendingContext = { done: true };
        this.render();
      } else if (errEl) {
        errEl.textContent = '❌ ' + ((res && res.error) || t('shares.action_error'));
        errEl.style.display = 'block';
      }
    }

    async handleUrlTokenFlow() {
      try {
        if (!window.location || !window.location.search) return;
        const params = new URLSearchParams(window.location.search);

        const verifyToken = params.get('verify_email');
        if (verifyToken) {
          this.open({ mode: 'verify_email', context: { loading: true } });
          if (window.sys && window.sys.api) {
            const res = await window.sys.api.post('verify_email', { token: verifyToken });
            cleanUrlParams(['verify_email']);
            if (res && res.success) {
              this.pendingContext = { loading: false, requiresApproval: Boolean(res.requires_admin_approval) };
            } else {
              this.pendingContext = { loading: false, error: (res && res.error) || t('auth_modal.verify_email_error') };
            }
            this.render();
          }
          return;
        }

        const resetToken = params.get('reset_password');
        if (resetToken) {
          this.open({ mode: 'reset_password', context: { token: resetToken } });
          return;
        }

        const inviteToken = params.get('invite');
        if (inviteToken && !this.isLoggedIn()) {
          let inviteEmail = '';
          if (window.sys && window.sys.api) {
            const info = await window.sys.api.get('inspect_invite', { token: inviteToken });
            if (info && info.success && info.target_email) {
              inviteEmail = info.target_email;
            }
          }
          this.open({ mode: 'register', context: { inviteToken, inviteEmail } });
        }
      } catch (e) {}
    }

    async handleLogout() {
      if (!window.sys || !window.sys.api) return;
      try {
        await window.sys.api.post('logout', {});
      } catch (e) {}

      window.IS_ADMIN = false;
      window.SG_CURRENT_USER = null;
      window.SG_MOUNTED_VOLUMES = [];
      if (window.desktop) {
        window.desktop.state.isAdmin = false;
      }
      if (window.sys && window.sys.shares && typeof window.sys.shares.refreshIdentity === 'function') {
        await window.sys.shares.refreshIdentity();
      }
      if (window.SettingsApp && typeof window.SettingsApp.render === 'function' && window.SettingsApp.window) {
        window.SettingsApp.render();
      }
      if (window.EventBus && typeof window.EventBus.emit === 'function') {
        window.EventBus.emit('fs:changed');
      }
      toast('info', t('auth.logout_success'));
      this.close();
    }
  }

  const service = new AuthModalService();
  window.AuthModalService = AuthModalService;
  window.sys.authModal = service;

  // Auto-handle ?verify_email=, ?reset_password=, ?invite= links on page load
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    const bootUrlCheck = () => setTimeout(() => service.handleUrlTokenFlow(), 80);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootUrlCheck);
    } else if (window.location && window.location.search) {
      bootUrlCheck();
    }
  }
})(window, document);
