/**
 * Atelier by GallusTech - Phase E (Lot 1): AI Agent & LLM Configuration Panel (apps/settings/ai-panel.js)
 *
 * Modular Control Panel section (`ai_agent`):
 *   - User LLM profiles (OpenAI, Anthropic, Gemini, OpenRouter, Mistral, Ollama / LM Studio / vLLM)
 *     with server-side AES-256-GCM encryption (keys are never sent back to the browser)
 *   - Live provider connectivity test & automatic model discovery
 *   - Default autonomy level, system prompt, vision toggle & per-app permissions matrix
 *   - Admin policy card (global toggle, private LAN opt-in, allowed domains, rate limits, shared provider)
 */
(function (window) {
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const inputStyle = 'padding:7px 10px;border-radius:7px;border:1px solid var(--border-color);background:var(--bg-main);color:var(--text-main);font-size:0.82rem;box-sizing:border-box;width:100%;';
  const labelStyle = 'display:flex;flex-direction:column;gap:4px;font-size:0.78rem;color:var(--text-muted);';
  const rowStyle = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 11px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-main);flex-wrap:wrap;';

  async function renderAiPanel(container, settingsApp, opts = {}) {
    if (!container || !settingsApp) return;
    const t = (k, p) => settingsApp.t(k, p);

    container.innerHTML = `<div style="padding:18px;color:var(--text-muted);font-size:0.9rem;">${esc(t('common.loading'))}</div>`;

    const res = await settingsApp.api.get('ai_get_config');
    if (!res || !res.success) {
      container.innerHTML = window.sys.ui.card({
        title: 'ai.panel_title',
        icon: '✨',
        content: `<p style="margin:0;color:var(--text-muted);font-size:0.86rem;">${esc(t('ai.login_required'))}</p>`
      });
      return;
    }

    const canUse = Boolean(res.can_use);
    const presets = res.presets || {};
    const pubPolicy = res.public_policy || {};
    const adminPolicy = res.admin_policy || null;
    const cfg = res.config || {
      profiles: [],
      active_profile_id: '',
      active_model: '',
      autonomy_level: 'assisted',
      system_prompt: '',
      max_tool_steps: 8,
      vision_enabled: true,
      disabled_apps: []
    };

    const profiles = Array.isArray(cfg.profiles) ? cfg.profiles : [];
    const editingId = opts.editingProfileId || null;
    const editingProfile = editingId ? profiles.find(p => p.id === editingId) : null;
    const disabledSet = new Set(Array.isArray(cfg.disabled_apps) ? cfg.disabled_apps : []);

    // Build all selectable profile options (user profiles + optional shared instance provider)
    const selectableProfiles = [...profiles];
    if (pubPolicy.shared_provider_enabled) {
      selectableProfiles.unshift({
        id: '__shared__',
        label: `${pubPolicy.shared_provider_label || t('ai.shared_provider_default_label')} (${t('ai.shared_badge')})`,
        type: 'shared',
        default_model: pubPolicy.shared_provider_model || '',
        models: Array.isArray(pubPolicy.shared_provider_models) ? pubPolicy.shared_provider_models : []
      });
    }

    const activeProfileId = cfg.active_profile_id || (selectableProfiles[0] ? selectableProfiles[0].id : '');
    const activeProfileObj = selectableProfiles.find(p => p.id === activeProfileId) || selectableProfiles[0] || null;
    const activeModelsList = activeProfileObj
      ? Array.from(new Set([activeProfileObj.default_model, ...(activeProfileObj.models || [])].filter(Boolean)))
      : [];
    const activeModel = cfg.active_model || (activeProfileObj ? activeProfileObj.default_model : '');

    // -------------------------------------------------------------------------
    // CARD 1: USER LLM PROFILES & API KEYS
    // -------------------------------------------------------------------------
    let profilesCardHtml = '';
    if (!canUse && !settingsApp.isAdmin) {
      profilesCardHtml = window.sys.ui.card({
        title: 'ai.panel_title',
        icon: '✨',
        content: `<p style="margin:0;color:var(--text-muted);font-size:0.86rem;">${esc(t('ai.disabled_by_admin'))}</p>`
      });
    } else {
      const presetOptions = Object.keys(presets).map(k =>
        `<option value="${esc(k)}">${esc(presets[k].label || k)}</option>`
      ).join('');

      const profilesListHtml = profiles.length === 0
        ? `<p style="margin:10px 0 0 0;font-size:0.8rem;color:var(--text-muted);">${esc(t('ai.no_profiles'))}</p>`
        : `<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;">
            ${profiles.map(p => {
              const isDefault = p.id === activeProfileId;
              const keyBadge = p.has_api_key
                ? `<span style="padding:1px 7px;border-radius:99px;font-size:0.68rem;background:rgba(34,197,94,0.16);color:#22c55e;font-weight:600;">🔒 ${esc(t('ai.key_stored'))}</span>`
                : `<span style="padding:1px 7px;border-radius:99px;font-size:0.68rem;background:rgba(148,163,184,0.16);color:var(--text-muted);font-weight:600;">${esc(t('ai.key_none'))}</span>`;
              const activeBadge = isDefault
                ? `<span style="padding:1px 7px;border-radius:99px;font-size:0.68rem;background:rgba(99,102,241,0.18);color:var(--accent-primary,#6366f1);font-weight:700;">★ ${esc(t('ai.active_badge'))}</span>`
                : '';
              const modelCount = Array.isArray(p.models) ? p.models.length : 0;
              return `
                <div style="${rowStyle}">
                  <div style="min-width:200px;flex:1;">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                      <strong style="font-size:0.84rem;">${esc(p.label)}</strong>
                      <code style="font-size:0.72rem;color:var(--text-muted);">${esc(p.type)}</code>
                      ${keyBadge}
                      ${activeBadge}
                    </div>
                    <div style="font-size:0.73rem;color:var(--text-muted);margin-top:2px;">
                      ${esc(p.base_url || 'default')} · <strong>${esc(p.default_model || '—')}</strong>${modelCount > 0 ? ` · ${esc(t('ai.models_count', { count: modelCount }))}` : ''}
                    </div>
                  </div>
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <button type="button" class="ai-test-saved-btn sysmon-action-btn" data-id="${esc(p.id)}" style="padding:4px 9px;font-size:0.74rem;">🔍 ${esc(t('ai.test_btn'))}</button>
                    <button type="button" class="ai-edit-profile-btn sysmon-action-btn" data-id="${esc(p.id)}" style="padding:4px 9px;font-size:0.74rem;">✏️ ${esc(t('ai.edit_btn'))}</button>
                    <button type="button" class="ai-delete-profile-btn" data-id="${esc(p.id)}" style="padding:4px 9px;border-radius:6px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;cursor:pointer;font-size:0.74rem;font-weight:600;">🗑️</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>`;

      const lanNotice = pubPolicy.allow_private_lan
        ? `<div style="padding:7px 10px;margin-bottom:10px;border-radius:7px;font-size:0.77rem;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.35);color:#22c55e;">🏠 ${esc(t('ai.lan_enabled_notice'))}</div>`
        : `<div style="padding:7px 10px;margin-bottom:10px;border-radius:7px;font-size:0.77rem;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#f59e0b;">🛡️ ${esc(t('ai.lan_disabled_notice'))}</div>`;

      const formTitle = editingProfile ? t('ai.edit_profile_title') : t('ai.add_profile_title');
      const curType = editingProfile ? editingProfile.type : 'openai_compat';
      const curModelsStr = editingProfile && Array.isArray(editingProfile.models) ? editingProfile.models.join(', ') : '';

      profilesCardHtml = window.sys.ui.card({
        title: 'ai.profiles_title',
        icon: '🤖',
        content: `
          <p style="margin:0 0 10px 0;font-size:0.82rem;color:var(--text-muted);">${esc(t('ai.profiles_desc'))}</p>
          ${lanNotice}
          <div id="aiProfileStatusMsg" style="display:none;margin-bottom:10px;padding:7px 10px;border-radius:7px;font-size:0.8rem;border:1px solid var(--border-color);background:var(--bg-main);"></div>
          <form id="aiProfileForm" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;padding:12px;border-radius:9px;border:1px solid var(--border-color);background:var(--bg-main);">
            <div style="grid-column:1 / -1;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
              <strong style="font-size:0.83rem;">${esc(formTitle)}</strong>
              ${editingProfile ? `<button type="button" id="aiCancelEditBtn" class="sysmon-action-btn" style="padding:3px 9px;font-size:0.73rem;">✕ ${esc(t('ai.cancel_edit_btn'))}</button>` : `
                <label style="display:flex;align-items:center;gap:6px;font-size:0.76rem;color:var(--text-muted);">
                  <span>${esc(t('ai.preset_label'))}</span>
                  <select id="aiPresetSelect" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-main);font-size:0.77rem;">
                    <option value="">— ${esc(t('ai.preset_choose'))} —</option>
                    ${presetOptions}
                  </select>
                </label>
              `}
            </div>
            <input type="hidden" id="aiProfId" value="${esc(editingProfile ? editingProfile.id : '')}" />
            <label style="${labelStyle}">
              <span>${esc(t('ai.label_field'))}</span>
              <input type="text" id="aiProfLabel" value="${esc(editingProfile ? editingProfile.label : '')}" placeholder="${esc(t('ai.label_placeholder'))}" required maxlength="80" style="${inputStyle}" />
            </label>
            <label style="${labelStyle}">
              <span>${esc(t('ai.type_field'))}</span>
              <select id="aiProfType" style="${inputStyle}">
                <option value="openai_compat" ${curType === 'openai_compat' ? 'selected' : ''}>OpenAI-Compatible (OpenAI / OpenRouter / Mistral / vLLM)</option>
                <option value="anthropic" ${curType === 'anthropic' ? 'selected' : ''}>Anthropic Claude</option>
                <option value="gemini" ${curType === 'gemini' ? 'selected' : ''}>Google Gemini</option>
                <option value="ollama" ${curType === 'ollama' ? 'selected' : ''}>Ollama (Local / LAN)</option>
              </select>
            </label>
            <label style="${labelStyle}">
              <span>${esc(t('ai.base_url_field'))}</span>
              <input type="url" id="aiProfBaseUrl" value="${esc(editingProfile ? editingProfile.base_url : 'https://api.openai.com/v1')}" placeholder="https://api.openai.com/v1" style="${inputStyle}" />
            </label>
            <label style="${labelStyle}">
              <span>${esc(t('ai.api_key_field'))}${editingProfile && editingProfile.has_api_key ? ` (${esc(t('ai.key_keep_hint'))})` : ''}</span>
              <input type="password" id="aiProfApiKey" value="" autocomplete="off" placeholder="${esc(editingProfile && editingProfile.has_api_key ? '••••••••••••••••' : t('ai.api_key_placeholder'))}" style="${inputStyle}" />
            </label>
            <label style="${labelStyle}">
              <span>${esc(t('ai.default_model_field'))}</span>
              <input type="text" id="aiProfDefaultModel" value="${esc(editingProfile ? editingProfile.default_model : 'gpt-4o-mini')}" placeholder="gpt-4o-mini / claude-sonnet-4 / llama3.2" style="${inputStyle}" />
            </label>
            <label style="${labelStyle}">
              <span>${esc(t('ai.models_list_field'))}</span>
              <input type="text" id="aiProfModels" value="${esc(curModelsStr)}" placeholder="model-a, model-b" style="${inputStyle}" />
            </label>
            <div style="grid-column:1 / -1;display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;">
              ${editingProfile && editingProfile.has_api_key ? `
                <label style="margin-right:auto;display:flex;align-items:center;gap:6px;font-size:0.76rem;color:#ef4444;">
                  <input type="checkbox" id="aiProfClearKey" />
                  <span>${esc(t('ai.clear_key_label'))}</span>
                </label>
              ` : ''}
              <button type="button" id="aiTestDraftBtn" class="sysmon-action-btn" style="padding:6px 12px;font-size:0.78rem;">🔍 ${esc(t('ai.test_discover_btn'))}</button>
              <button type="submit" style="padding:6px 14px;border-radius:7px;border:none;background:var(--accent-primary,#6366f1);color:#fff;cursor:pointer;font-size:0.78rem;font-weight:600;">💾 ${esc(t('ai.save_profile_btn'))}</button>
            </div>
          </form>
          ${profilesListHtml}
        `
      });
    }

    // -------------------------------------------------------------------------
    // CARD 2: BEHAVIOR, AUTONOMY LEVEL & PER-APP PERMISSIONS MATRIX
    // -------------------------------------------------------------------------
    let behaviorCardHtml = '';
    if (canUse || settingsApp.isAdmin) {
      const discovered = window.SG_DISCOVERED_APPS || {};
      const allApps = Object.keys(discovered).map(id => {
        const info = discovered[id] || {};
        const m = info.manifest || {};
        const isExt = info.distribution === 'standalone-web' || m.distribution === 'standalone-web' || m.runtime === 'iframe';
        const isGame = String(info.category || m.category || '').toLowerCase() === 'games';
        return {
          id,
          name: info.name || m.name || id,
          icon: info.icon || m.icon || '📦',
          kind: isExt ? 'external' : (isGame ? 'game' : 'native')
        };
      }).sort((a, b) => a.name.localeCompare(b.name));

      const appsGridHtml = allApps.length === 0
        ? ''
        : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px;max-height:210px;overflow-y:auto;padding:8px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-main);">
            ${allApps.map(a => {
              const allowed = !disabledSet.has(a.id);
              const badge = a.kind === 'external' ? 'WASM' : (a.kind === 'game' ? '🎮' : 'OS');
              return `
                <label style="display:flex;align-items:center;gap:6px;font-size:0.77rem;color:var(--text-main);cursor:pointer;padding:3px 4px;border-radius:5px;">
                  <input type="checkbox" class="ai-app-allow-chk" data-app-id="${esc(a.id)}" ${allowed ? 'checked' : ''} />
                  <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.name)}</span>
                  <span style="font-size:0.65rem;opacity:0.65;padding:1px 4px;border-radius:4px;border:1px solid var(--border-color);">${esc(badge)}</span>
                </label>
              `;
            }).join('')}
          </div>`;

      const profileSelectOpts = selectableProfiles.length === 0
        ? `<option value="">— ${esc(t('ai.no_profiles_short'))} —</option>`
        : selectableProfiles.map(p =>
            `<option value="${esc(p.id)}" ${p.id === activeProfileId ? 'selected' : ''}>${esc(p.label)}</option>`
          ).join('');

      const modelDataList = activeModelsList.map(m => `<option value="${esc(m)}"></option>`).join('');

      behaviorCardHtml = window.sys.ui.card({
        title: 'ai.behavior_title',
        icon: '🎛️',
        content: `
          <form id="aiBehaviorForm" style="display:flex;flex-direction:column;gap:12px;">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
              <label style="${labelStyle}">
                <span>${esc(t('ai.active_profile_label'))}</span>
                <select id="aiActiveProfile" style="${inputStyle}">${profileSelectOpts}</select>
              </label>
              <label style="${labelStyle}">
                <span>${esc(t('ai.active_model_label'))}</span>
                <input type="text" id="aiActiveModel" list="aiActiveModelsDatalist" value="${esc(activeModel)}" placeholder="gpt-4o-mini" style="${inputStyle}" />
                <datalist id="aiActiveModelsDatalist">${modelDataList}</datalist>
              </label>
              <label style="${labelStyle}">
                <span>${esc(t('ai.autonomy_label'))}</span>
                <select id="aiAutonomyLevel" style="${inputStyle}">
                  <option value="read_only" ${cfg.autonomy_level === 'read_only' ? 'selected' : ''}>💬 ${esc(t('ai.autonomy_read_only'))}</option>
                  <option value="assisted" ${cfg.autonomy_level === 'assisted' ? 'selected' : ''}>🛡️ ${esc(t('ai.autonomy_assisted'))}</option>
                  <option value="autonomous_app" ${cfg.autonomy_level === 'autonomous_app' ? 'selected' : ''}>⚡ ${esc(t('ai.autonomy_autonomous_app'))}</option>
                </select>
              </label>
              <label style="${labelStyle}">
                <span>${esc(t('ai.max_steps_label'))} (max ${esc(pubPolicy.max_tool_steps || 10)})</span>
                <input type="number" id="aiMaxSteps" min="1" max="${esc(pubPolicy.max_tool_steps || 10)}" value="${esc(cfg.max_tool_steps || 8)}" style="${inputStyle}" />
              </label>
            </div>
            <label style="display:flex;align-items:center;gap:8px;font-size:0.8rem;color:var(--text-main);">
              <input type="checkbox" id="aiVisionEnabled" ${cfg.vision_enabled ? 'checked' : ''} />
              <span>👁️ ${esc(t('ai.vision_label'))}</span>
            </label>
            <label style="${labelStyle}">
              <span>${esc(t('ai.system_prompt_label'))}</span>
              <textarea id="aiSystemPrompt" rows="3" maxlength="4000" placeholder="${esc(t('ai.system_prompt_placeholder'))}" style="${inputStyle};resize:vertical;font-family:inherit;">${esc(cfg.system_prompt || '')}</textarea>
            </label>
            <div>
              <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px;">🧩 ${esc(t('ai.apps_scope_label'))}</div>
              ${appsGridHtml}
            </div>
            <div style="display:flex;justify-content:flex-end;">
              <button type="submit" style="padding:7px 16px;border-radius:7px;border:none;background:var(--accent-primary,#6366f1);color:#fff;cursor:pointer;font-size:0.8rem;font-weight:600;">💾 ${esc(t('ai.save_behavior_btn'))}</button>
            </div>
          </form>
        `
      });
    }

    // -------------------------------------------------------------------------
    // CARD 3: ADMIN POLICY & SHARED INSTANCE PROVIDER (Admin Only)
    // -------------------------------------------------------------------------
    let adminCardHtml = '';
    if (settingsApp.isAdmin && adminPolicy) {
      const sp = adminPolicy.shared_provider || {};
      const spType = sp.type || 'openai_compat';
      const domainsStr = Array.isArray(adminPolicy.allowed_domains) ? adminPolicy.allowed_domains.join(', ') : '';
      const spModelsStr = Array.isArray(sp.models) ? sp.models.join(', ') : '';

      adminCardHtml = window.sys.ui.card({
        title: 'ai.admin_policy_title',
        icon: '🛡️',
        content: `
          <p style="margin:0 0 12px 0;font-size:0.82rem;color:var(--text-muted);">${esc(t('ai.admin_policy_desc'))}</p>
          <div id="aiAdminStatusMsg" style="display:none;margin-bottom:10px;padding:7px 10px;border-radius:7px;font-size:0.8rem;border:1px solid var(--border-color);background:var(--bg-main);"></div>
          <form id="aiAdminPolicyForm" style="display:flex;flex-direction:column;gap:12px;">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;">
              <label style="display:flex;align-items:center;gap:8px;font-size:0.8rem;color:var(--text-main);">
                <input type="checkbox" id="aiAdmEnabled" ${adminPolicy.enabled ? 'checked' : ''} />
                <span>${esc(t('ai.admin_enabled_label'))}</span>
              </label>
              <label style="display:flex;align-items:center;gap:8px;font-size:0.8rem;color:var(--text-main);">
                <input type="checkbox" id="aiAdmAllowUsers" ${adminPolicy.allow_authenticated_users ? 'checked' : ''} />
                <span>${esc(t('ai.admin_allow_users_label'))}</span>
              </label>
              <label style="display:flex;align-items:center;gap:8px;font-size:0.8rem;color:var(--text-main);">
                <input type="checkbox" id="aiAdmAllowLan" ${adminPolicy.allow_private_lan ? 'checked' : ''} />
                <span>🏠 ${esc(t('ai.admin_allow_lan_label'))}</span>
              </label>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
              <label style="${labelStyle}">
                <span>${esc(t('ai.admin_allowed_domains_label'))}</span>
                <input type="text" id="aiAdmDomains" value="${esc(domainsStr)}" placeholder="api.openai.com, api.anthropic.com, generativelanguage.googleapis.com" style="${inputStyle}" />
              </label>
              <label style="${labelStyle}">
                <span>${esc(t('ai.admin_rate_limit_label'))}</span>
                <input type="number" id="aiAdmRateLimit" min="1" max="300" value="${esc(adminPolicy.rate_limit_per_minute || 30)}" style="${inputStyle}" />
              </label>
              <label style="${labelStyle}">
                <span>${esc(t('ai.admin_max_steps_label'))}</span>
                <input type="number" id="aiAdmMaxSteps" min="1" max="25" value="${esc(adminPolicy.max_tool_steps || 10)}" style="${inputStyle}" />
              </label>
            </div>

            <div style="padding:11px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-main);display:flex;flex-direction:column;gap:10px;">
              <label style="display:flex;align-items:center;gap:8px;font-size:0.82rem;font-weight:600;color:var(--text-main);">
                <input type="checkbox" id="aiAdmSharedEnabled" ${adminPolicy.shared_provider_enabled ? 'checked' : ''} />
                <span>🏢 ${esc(t('ai.admin_shared_enable_label'))}</span>
              </label>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
                <label style="${labelStyle}">
                  <span>${esc(t('ai.label_field'))}</span>
                  <input type="text" id="aiAdmSharedLabel" value="${esc(sp.label || 'Instance Default LLM')}" style="${inputStyle}" />
                </label>
                <label style="${labelStyle}">
                  <span>${esc(t('ai.type_field'))}</span>
                  <select id="aiAdmSharedType" style="${inputStyle}">
                    <option value="openai_compat" ${spType === 'openai_compat' ? 'selected' : ''}>OpenAI-Compatible</option>
                    <option value="anthropic" ${spType === 'anthropic' ? 'selected' : ''}>Anthropic Claude</option>
                    <option value="gemini" ${spType === 'gemini' ? 'selected' : ''}>Google Gemini</option>
                    <option value="ollama" ${spType === 'ollama' ? 'selected' : ''}>Ollama (Local / LAN)</option>
                  </select>
                </label>
                <label style="${labelStyle}">
                  <span>${esc(t('ai.base_url_field'))}</span>
                  <input type="url" id="aiAdmSharedUrl" value="${esc(sp.base_url || '')}" style="${inputStyle}" />
                </label>
                <label style="${labelStyle}">
                  <span>${esc(t('ai.api_key_field'))}${sp.has_api_key ? ` (${esc(t('ai.key_stored'))})` : ''}</span>
                  <input type="password" id="aiAdmSharedKey" value="" autocomplete="off" placeholder="${esc(sp.has_api_key ? '••••••••••••••••' : t('ai.api_key_placeholder'))}" style="${inputStyle}" />
                </label>
                <label style="${labelStyle}">
                  <span>${esc(t('ai.default_model_field'))}</span>
                  <input type="text" id="aiAdmSharedModel" value="${esc(sp.default_model || '')}" style="${inputStyle}" />
                </label>
                <label style="${labelStyle}">
                  <span>${esc(t('ai.models_list_field'))}</span>
                  <input type="text" id="aiAdmSharedModels" value="${esc(spModelsStr)}" style="${inputStyle}" />
                </label>
              </div>
              <div style="display:flex;justify-content:flex-end;gap:8px;">
                <button type="button" id="aiAdmTestSharedBtn" class="sysmon-action-btn" style="padding:5px 11px;font-size:0.76rem;">🔍 ${esc(t('ai.test_discover_btn'))}</button>
              </div>
            </div>

            <div style="display:flex;justify-content:flex-end;">
              <button type="submit" style="padding:7px 16px;border-radius:7px;border:none;background:var(--accent-primary,#6366f1);color:#fff;cursor:pointer;font-size:0.8rem;font-weight:600;">💾 ${esc(t('ai.admin_save_btn'))}</button>
            </div>
          </form>
        `
      });
    }

    container.innerHTML = profilesCardHtml + behaviorCardHtml + adminCardHtml;

    // -------------------------------------------------------------------------
    // EVENT BINDINGS
    // -------------------------------------------------------------------------
    const profStatusEl = container.querySelector('#aiProfileStatusMsg');
    const setProfStatus = (msg, isError = false) => {
      if (!profStatusEl) return;
      profStatusEl.textContent = msg;
      profStatusEl.style.display = msg ? 'block' : 'none';
      profStatusEl.style.color = isError ? '#ef4444' : '#22c55e';
      profStatusEl.style.borderColor = isError ? 'rgba(239,68,68,0.45)' : 'rgba(34,197,94,0.45)';
    };

    const presetSel = container.querySelector('#aiPresetSelect');
    if (presetSel) {
      presetSel.addEventListener('change', () => {
        const key = presetSel.value;
        const p = presets[key];
        if (!p) return;
        const lbl = container.querySelector('#aiProfLabel');
        const typ = container.querySelector('#aiProfType');
        const url = container.querySelector('#aiProfBaseUrl');
        const mdl = container.querySelector('#aiProfDefaultModel');
        if (lbl) lbl.value = p.label || '';
        if (typ) typ.value = p.type || 'openai_compat';
        if (url) url.value = p.base_url || '';
        if (mdl) mdl.value = p.default_model || '';
      });
    }

    const cancelEditBtn = container.querySelector('#aiCancelEditBtn');
    if (cancelEditBtn) {
      cancelEditBtn.addEventListener('click', () => renderAiPanel(container, settingsApp));
    }

    // Test draft profile & auto-populate discovered models
    const testDraftBtn = container.querySelector('#aiTestDraftBtn');
    if (testDraftBtn) {
      testDraftBtn.addEventListener('click', async () => {
        const profId = container.querySelector('#aiProfId')?.value || '';
        const type = container.querySelector('#aiProfType')?.value || 'openai_compat';
        const base_url = container.querySelector('#aiProfBaseUrl')?.value.trim() || '';
        const api_key = container.querySelector('#aiProfApiKey')?.value.trim() || '';
        testDraftBtn.disabled = true;
        setProfStatus('⏳ ' + t('ai.testing_status'), false);
        const r = await settingsApp.api.post('ai_test_profile', {
          profile_id: profId,
          profile: { type, base_url, api_key }
        });
        testDraftBtn.disabled = false;
        if (r && r.success) {
          const found = Array.isArray(r.models) ? r.models : [];
          if (found.length > 0) {
            const modelsInput = container.querySelector('#aiProfModels');
            const defInput = container.querySelector('#aiProfDefaultModel');
            if (modelsInput) modelsInput.value = found.slice(0, 30).join(', ');
            if (defInput && !defInput.value.trim()) defInput.value = found[0];
          }
          setProfStatus('✅ ' + (r.message || t('ai.test_ok')), false);
        } else {
          setProfStatus('❌ ' + ((r && r.error) || t('ai.test_failed')), true);
        }
      });
    }

    // Save (add or update) user profile
    const profForm = container.querySelector('#aiProfileForm');
    if (profForm) {
      profForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pid = container.querySelector('#aiProfId')?.value.trim() || '';
        const label = container.querySelector('#aiProfLabel')?.value.trim() || 'LLM Profile';
        const type = container.querySelector('#aiProfType')?.value || 'openai_compat';
        const base_url = container.querySelector('#aiProfBaseUrl')?.value.trim() || '';
        const api_key = container.querySelector('#aiProfApiKey')?.value.trim() || '';
        const clear_api_key = Boolean(container.querySelector('#aiProfClearKey')?.checked);
        const default_model = container.querySelector('#aiProfDefaultModel')?.value.trim() || '';
        const rawModels = container.querySelector('#aiProfModels')?.value || '';
        const models = rawModels.split(',').map(s => s.trim()).filter(Boolean);

        const nextProfiles = profiles.map(p => ({ ...p }));
        const entry = { id: pid, label, type, base_url, default_model, models, clear_api_key };
        if (api_key) entry.api_key = api_key;

        if (pid) {
          const idx = nextProfiles.findIndex(p => p.id === pid);
          if (idx >= 0) nextProfiles[idx] = entry;
          else nextProfiles.push(entry);
        } else {
          nextProfiles.push(entry);
        }

        const r = await settingsApp.api.post('ai_save_user_config', {
          config: {
            profiles: nextProfiles,
            active_profile_id: cfg.active_profile_id || (nextProfiles.length === 1 ? (pid || '') : cfg.active_profile_id)
          }
        });
        if (r && r.success) {
          settingsApp.toast.success(t('ai.saved_toast'));
          if (window.EventBus) window.EventBus.emit('ai:config:changed', r.config || {});
          renderAiPanel(container, settingsApp);
        } else {
          setProfStatus('❌ ' + ((r && r.error) || t('users.action_error')), true);
        }
      });
    }

    // Edit / Test / Delete saved profiles
    container.querySelectorAll('.ai-edit-profile-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        renderAiPanel(container, settingsApp, { editingProfileId: btn.dataset.id });
      });
    });

    container.querySelectorAll('.ai-test-saved-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pid = btn.dataset.id;
        btn.disabled = true;
        setProfStatus('⏳ ' + t('ai.testing_status'), false);
        const r = await settingsApp.api.post('ai_test_profile', { profile_id: pid });
        btn.disabled = false;
        if (r && r.success) {
          setProfStatus('✅ ' + (r.message || t('ai.test_ok')), false);
          if (Array.isArray(r.models) && r.models.length > 0) {
            const nextProfiles = profiles.map(p => p.id === pid ? { ...p, models: r.models.slice(0, 40) } : { ...p });
            await settingsApp.api.post('ai_save_user_config', { config: { profiles: nextProfiles } });
            renderAiPanel(container, settingsApp);
          }
        } else {
          setProfStatus('❌ ' + ((r && r.error) || t('ai.test_failed')), true);
        }
      });
    });

    container.querySelectorAll('.ai-delete-profile-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pid = btn.dataset.id;
        const nextProfiles = profiles.filter(p => p.id !== pid);
        const nextActive = cfg.active_profile_id === pid ? (nextProfiles[0] ? nextProfiles[0].id : '') : cfg.active_profile_id;
        const r = await settingsApp.api.post('ai_save_user_config', {
          config: { profiles: nextProfiles, active_profile_id: nextActive }
        });
        if (r && r.success) {
          settingsApp.toast.info(t('ai.deleted_toast'));
          if (window.EventBus) window.EventBus.emit('ai:config:changed', r.config || {});
          renderAiPanel(container, settingsApp);
        }
      });
    });

    // Save behavior, active model, autonomy & per-app permissions
    const behaviorForm = container.querySelector('#aiBehaviorForm');
    if (behaviorForm) {
      behaviorForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const disabledApps = [];
        container.querySelectorAll('.ai-app-allow-chk').forEach(chk => {
          if (!chk.checked && chk.dataset.appId) disabledApps.push(chk.dataset.appId);
        });
        const r = await settingsApp.api.post('ai_save_user_config', {
          config: {
            active_profile_id: container.querySelector('#aiActiveProfile')?.value || '',
            active_model: container.querySelector('#aiActiveModel')?.value.trim() || '',
            autonomy_level: container.querySelector('#aiAutonomyLevel')?.value || 'assisted',
            max_tool_steps: Number(container.querySelector('#aiMaxSteps')?.value || 8),
            vision_enabled: Boolean(container.querySelector('#aiVisionEnabled')?.checked),
            system_prompt: container.querySelector('#aiSystemPrompt')?.value || '',
            disabled_apps: disabledApps
          }
        });
        if (r && r.success) {
          settingsApp.toast.success(t('ai.saved_toast'));
          if (window.EventBus) window.EventBus.emit('ai:config:changed', r.config || {});
          renderAiPanel(container, settingsApp);
        } else {
          settingsApp.toast.error((r && r.error) || t('users.action_error'));
        }
      });
    }

    // Admin policy form & shared provider test
    const admStatusEl = container.querySelector('#aiAdminStatusMsg');
    const setAdmStatus = (msg, isError = false) => {
      if (!admStatusEl) return;
      admStatusEl.textContent = msg;
      admStatusEl.style.display = msg ? 'block' : 'none';
      admStatusEl.style.color = isError ? '#ef4444' : '#22c55e';
      admStatusEl.style.borderColor = isError ? 'rgba(239,68,68,0.45)' : 'rgba(34,197,94,0.45)';
    };

    const testSharedBtn = container.querySelector('#aiAdmTestSharedBtn');
    if (testSharedBtn) {
      testSharedBtn.addEventListener('click', async () => {
        testSharedBtn.disabled = true;
        setAdmStatus('⏳ ' + t('ai.testing_status'), false);
        const r = await settingsApp.api.post('ai_test_profile', {
          is_shared: true,
          profile: {
            type: container.querySelector('#aiAdmSharedType')?.value || 'openai_compat',
            base_url: container.querySelector('#aiAdmSharedUrl')?.value.trim() || '',
            api_key: container.querySelector('#aiAdmSharedKey')?.value.trim() || ''
          }
        });
        testSharedBtn.disabled = false;
        if (r && r.success) {
          if (Array.isArray(r.models) && r.models.length > 0) {
            const mEl = container.querySelector('#aiAdmSharedModels');
            if (mEl) mEl.value = r.models.slice(0, 30).join(', ');
          }
          setAdmStatus('✅ ' + (r.message || t('ai.test_ok')), false);
        } else {
          setAdmStatus('❌ ' + ((r && r.error) || t('ai.test_failed')), true);
        }
      });
    }

    const admForm = container.querySelector('#aiAdminPolicyForm');
    if (admForm) {
      admForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const sharedKey = container.querySelector('#aiAdmSharedKey')?.value.trim() || '';
        const sharedPayload = {
          label: container.querySelector('#aiAdmSharedLabel')?.value.trim() || 'Instance Default LLM',
          type: container.querySelector('#aiAdmSharedType')?.value || 'openai_compat',
          base_url: container.querySelector('#aiAdmSharedUrl')?.value.trim() || '',
          default_model: container.querySelector('#aiAdmSharedModel')?.value.trim() || '',
          models: (container.querySelector('#aiAdmSharedModels')?.value || '').split(',').map(s => s.trim()).filter(Boolean)
        };
        if (sharedKey) sharedPayload.api_key = sharedKey;

        const r = await settingsApp.api.post('ai_save_admin_policy', {
          policy: {
            enabled: Boolean(container.querySelector('#aiAdmEnabled')?.checked),
            allow_authenticated_users: Boolean(container.querySelector('#aiAdmAllowUsers')?.checked),
            allow_private_lan: Boolean(container.querySelector('#aiAdmAllowLan')?.checked),
            allowed_domains: container.querySelector('#aiAdmDomains')?.value || '',
            rate_limit_per_minute: Number(container.querySelector('#aiAdmRateLimit')?.value || 30),
            max_tool_steps: Number(container.querySelector('#aiAdmMaxSteps')?.value || 10),
            shared_provider_enabled: Boolean(container.querySelector('#aiAdmSharedEnabled')?.checked),
            shared_provider: sharedPayload
          }
        });
        if (r && r.success) {
          settingsApp.toast.success(t('ai.admin_saved_toast'));
          if (window.EventBus) window.EventBus.emit('ai:config:changed', {});
          renderAiPanel(container, settingsApp);
        } else {
          setAdmStatus('❌ ' + ((r && r.error) || t('users.action_error')), true);
        }
      });
    }
  }

  window.AtelierAiPanel = {
    render: renderAiPanel
  };
})(window);
