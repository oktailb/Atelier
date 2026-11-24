/**
 * Atelier by GallusTech - Dedicated Centered Authentication & Account Overlay
 * Frosted-glass centered login/account dialog with heavy desktop backdrop blur,
 * brand header, username/password login, future-ready 2FA/TOTP & QR pairing slots,
 * ergonomic post-login options, and active session quick actions.
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

  function getBrandInfo() {
    const titleEl = document.querySelector('.brand-title');
    const subEl = document.querySelector('.brand-subtitle');
    return {
      title: (titleEl && titleEl.textContent.trim()) || 'Atelier',
      subtitle: (subEl && subEl.textContent.trim()) || 'by GallusTech'
    };
  }

  class AuthModalService {
    constructor() {
      this.overlayEl = null;
      this.activeMode = 'password'; // 'password' | 'qr'
      this.showTotpField = false;
      this._onKeyDown = null;
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
      if (options.mode === 'qr' || options.mode === 'password') {
        this.activeMode = options.mode;
      } else {
        this.activeMode = 'password';
      }
      this.showTotpField = Boolean(options.requireTotp);

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
      // Crisp decorative QR frame signaling upcoming Phase A.2 Mobile / Passkey QR pairing
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

      const heading = loggedIn ? t('auth_modal.account_title') : t('auth_modal.title');
      const subtitle = loggedIn ? t('auth_modal.account_subtitle') : t('auth_modal.subtitle');

      let bodyHtml = '';

      if (loggedIn) {
        const displayName = user ? (user.display_name || user.username) : t('nav.admin');
        const roleLabel = user ? `@${user.username} · ${user.role}` : t('auth_modal.role_root_admin');
        const avatarIcon = user ? (isAdmin ? '🛡️' : '👤') : '🔑';
        const volumes = (window.sys && window.sys.shares && typeof window.sys.shares.getVolumes === 'function')
          ? window.sys.shares.getVolumes()
          : (Array.isArray(window.SG_MOUNTED_VOLUMES) ? window.SG_MOUNTED_VOLUMES : []);

        bodyHtml = `
          <div class="atelier-auth-account-card">
            <div class="atelier-auth-avatar">${avatarIcon}</div>
            <div class="atelier-auth-identity">
              <div class="atelier-auth-displayname">${esc(displayName)}</div>
              <div class="atelier-auth-rolebadge">${esc(roleLabel)}</div>
            </div>
          </div>

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
      } else {
        const isQr = (this.activeMode === 'qr');
        bodyHtml = `
          <div class="atelier-auth-mode-tabs" role="tablist">
            <button type="button" class="atelier-auth-mode-tab ${!isQr ? 'active' : ''}" data-auth-mode="password" role="tab" aria-selected="${!isQr}">
              🔑 ${esc(t('auth_modal.tab_password'))}
            </button>
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
          ` : `
            <form id="atelierAuthForm" class="atelier-auth-form" autocomplete="on">
              <div class="atelier-auth-field">
                <label for="authModalUsername">${esc(t('auth_modal.username_label'))}</label>
                <div class="atelier-auth-input-wrap">
                  <span class="atelier-auth-input-icon">👤</span>
                  <input type="text" id="authModalUsername" name="username" value="${esc(savedUser)}" placeholder="${esc(t('auth_modal.username_placeholder'))}" autocomplete="username" />
                </div>
              </div>

              <div class="atelier-auth-field">
                <label for="authModalPassword">${esc(t('auth_modal.password_label'))}</label>
                <div class="atelier-auth-input-wrap">
                  <span class="atelier-auth-input-icon">🔒</span>
                  <input type="password" id="authModalPassword" name="password" placeholder="${esc(t('auth_modal.password_placeholder'))}" required autocomplete="current-password" />
                  <button type="button" class="atelier-auth-eye-btn" id="authModalTogglePwd" title="${esc(t('auth_modal.toggle_password'))}" aria-label="${esc(t('auth_modal.toggle_password'))}">👁️</button>
                </div>
              </div>

              <div class="atelier-auth-totp-slot ${this.showTotpField ? 'expanded' : ''}" id="authModalTotpSlot">
                <button type="button" class="atelier-auth-totp-toggle" id="authModalTotpToggle">
                  <span>🛡️ ${esc(t('auth_modal.totp_label'))}</span>
                  <span class="atelier-auth-soon-pill">${esc(t('auth_modal.totp_soon_badge'))}</span>
                </button>
                <div class="atelier-auth-totp-body" style="${this.showTotpField ? '' : 'display:none;'}">
                  <div class="atelier-auth-input-wrap">
                    <span class="atelier-auth-input-icon">🔢</span>
                    <input type="text" id="authModalTotp" name="totp_code" inputmode="numeric" maxlength="8" placeholder="${esc(t('auth_modal.totp_placeholder'))}" autocomplete="one-time-code" />
                  </div>
                </div>
              </div>

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

              <button type="submit" id="authModalSubmitBtn" class="atelier-auth-submit-btn">
                <span>🔑</span><span>${esc(t('auth_modal.submit_btn'))}</span>
              </button>

              <div class="atelier-auth-hint">${esc(t('auth_modal.root_admin_hint'))}</div>
            </form>
          `}
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

    bindEvents() {
      if (!this.overlayEl) return;
      const root = this.overlayEl;

      root.addEventListener('click', (e) => {
        if (e.target === root) this.close();
      });

      root.querySelector('#authModalCloseBtn')?.addEventListener('click', () => this.close());

      // Mode switch (Password / QR)
      root.querySelectorAll('[data-auth-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.activeMode = btn.dataset.authMode || 'password';
          this.render();
        });
      });

      // Show/hide password toggle
      const pwdInput = root.querySelector('#authModalPassword');
      root.querySelector('#authModalTogglePwd')?.addEventListener('click', () => {
        if (!pwdInput) return;
        pwdInput.type = (pwdInput.type === 'password') ? 'text' : 'password';
        pwdInput.focus();
      });

      // Expand/collapse future-ready 2FA/TOTP slot
      root.querySelector('#authModalTotpToggle')?.addEventListener('click', () => {
        this.showTotpField = !this.showTotpField;
        const slot = root.querySelector('#authModalTotpSlot');
        const body = root.querySelector('.atelier-auth-totp-body');
        if (slot) slot.classList.toggle('expanded', this.showTotpField);
        if (body) body.style.display = this.showTotpField ? '' : 'none';
        if (this.showTotpField) root.querySelector('#authModalTotp')?.focus();
      });

      // Focus first empty input cleanly
      if (!this.isLoggedIn() && this.activeMode === 'password') {
        const uInput = root.querySelector('#authModalUsername');
        const targetFocus = (uInput && !uInput.value) ? uInput : pwdInput;
        if (targetFocus) setTimeout(() => targetFocus.focus(), 40);
      }

      // Login form submission
      root.querySelector('#atelierAuthForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleLoginSubmit();
      });

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

      root.querySelector('#authModalLogoutBtn')?.addEventListener('click', () => {
        this.handleLogout();
      });
    }

    async handleLoginSubmit() {
      if (!this.overlayEl || !window.sys || !window.sys.api) return;
      const username = (this.overlayEl.querySelector('#authModalUsername')?.value || '').trim();
      const password = this.overlayEl.querySelector('#authModalPassword')?.value || '';
      const totpCode = (this.overlayEl.querySelector('#authModalTotp')?.value || '').trim();
      const openHome = Boolean(this.overlayEl.querySelector('#authModalOptOpenHome')?.checked);
      const rememberUser = Boolean(this.overlayEl.querySelector('#authModalOptRememberUser')?.checked);
      const errEl = this.overlayEl.querySelector('#authModalError');
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

      if (errEl) {
        errEl.style.display = 'none';
        errEl.textContent = '';
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>⏳</span><span>${esc(t('auth_modal.signing_in'))}</span>`;
      }

      try {
        const payload = { username, password };
        if (totpCode) payload.totp_code = totpCode;

        const json = await window.sys.api.post('login', payload);
        if (json && json.requires_2fa) {
          this.showTotpField = true;
          this.render();
          const newErr = this.overlayEl?.querySelector('#authModalError');
          if (newErr) {
            newErr.textContent = json.error || t('auth_modal.totp_placeholder');
            newErr.style.display = 'block';
          }
          return;
        }

        if (json && json.success) {
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

          this.close();

          if (openHome && json.user && json.user.home_dir && window.explorerApp && typeof window.explorerApp.open === 'function') {
            window.explorerApp.open({ dir: json.user.home_dir });
          }
        } else {
          if (errEl) {
            errEl.textContent = '❌ ' + ((json && json.error) || t('admin.wrong_password'));
            errEl.style.display = 'block';
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<span>🔑</span><span>${esc(t('auth_modal.submit_btn'))}</span>`;
          }
        }
      } catch (err) {
        if (errEl) {
          errEl.textContent = '❌ ' + (err && err.message ? err.message : t('shares.action_error'));
          errEl.style.display = 'block';
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `<span>🔑</span><span>${esc(t('auth_modal.submit_btn'))}</span>`;
        }
      }
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
})(window, document);
