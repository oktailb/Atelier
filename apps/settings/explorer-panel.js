/**
 * Atelier by GallusTech - Explorer Settings Panel (apps/settings/explorer-panel.js)
 * Dedicated Control Panel section (`explorer`) managing per-user Explorer preferences:
 *  - Single-click vs Double-click opening mode
 *  - Default view profile & sidebar behavior
 *  - Pro List options (unified folders first, selection checkboxes)
 *  - Thumbnail zoom, Inspector auto-open, Navigation cache, per-folder view overrides & recents
 *  - Keyboard shortcuts cheat sheet
 */
(function (window) {
  'use strict';

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getPrefsApi() {
    if (window.ExplorerStateManager && typeof window.ExplorerStateManager.getPrefsForCurrentUser === 'function') {
      return window.ExplorerStateManager;
    }
    const scope = (() => {
      const u = (window.sys && window.sys.shares && typeof window.sys.shares.getCurrentUser === 'function')
        ? window.sys.shares.getCurrentUser()
        : window.ATELIER_CURRENT_USER;
      if (u && u.username) return `user_${u.username}`;
      return window.IS_ADMIN ? 'admin' : 'guest';
    })();
    const defaults = {
      openMode: 'double',
      defaultViewMode: 'list',
      sidebarMode: 'auto',
      unifiedFoldersInList: true,
      showCheckboxesInList: true,
      defaultThumbZoom: 210,
      openInspectorOnStart: false,
      enableNavCache: true
    };
    return {
      getPrefsForCurrentUser() {
        try {
          const raw = localStorage.getItem(`atelier_explorer_prefs_${scope}`);
          return { ...defaults, ...(raw ? JSON.parse(raw) : {}) };
        } catch (e) {
          return { ...defaults };
        }
      },
      savePrefsForCurrentUser(patch) {
        const next = { ...this.getPrefsForCurrentUser(), ...patch };
        try {
          localStorage.setItem(`atelier_explorer_prefs_${scope}`, JSON.stringify(next));
        } catch (e) { }
        if (window.EventBus) window.EventBus.emit('explorer:prefs_changed', next);
        return next;
      },
      resetPrefsForCurrentUser() {
        try { localStorage.removeItem(`atelier_explorer_prefs_${scope}`); } catch (e) { }
        if (window.EventBus) window.EventBus.emit('explorer:prefs_changed', { ...defaults });
        return { ...defaults };
      },
      getFolderOverridesCountForCurrentUser() {
        try {
          const raw = localStorage.getItem(`atelier_folder_views_${scope}`);
          const parsed = raw ? JSON.parse(raw) : {};
          return (parsed && typeof parsed === 'object') ? Object.keys(parsed).length : 0;
        } catch (e) { return 0; }
      },
      clearAllFolderViewOverridesForCurrentUser() {
        try { localStorage.removeItem(`atelier_folder_views_${scope}`); } catch (e) { }
        if (window.EventBus) window.EventBus.emit('explorer:prefs_changed', this.getPrefsForCurrentUser());
      },
      clearRecentFoldersForCurrentUser() {
        try { localStorage.removeItem(`atelier_explorer_recents_${scope}`); } catch (e) { }
        if (window.EventBus) window.EventBus.emit('explorer:prefs_changed', this.getPrefsForCurrentUser());
      }
    };
  }

  function renderExplorerPanel(container, settingsApp) {
    if (!container || !settingsApp) return;
    const t = (k, p) => settingsApp.t(k, p);
    const api = getPrefsApi();
    const prefs = api.getPrefsForCurrentUser();
    const overridesCount = api.getFolderOverridesCountForCurrentUser();

    const selectStyle = 'padding:8px 10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-main);color:var(--text-main);font-size:0.84rem;width:100%;box-sizing:border-box;';
    const toggleRowStyle = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:9px;border:1px solid var(--border-color);background:var(--bg-main);cursor:pointer;';
    const clickChoiceStyle = (active) => `display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:10px;border:2px solid ${active ? 'var(--accent-primary, #6366f1)' : 'var(--border-color)'};background:${active ? 'rgba(99,102,241,0.1)' : 'var(--bg-main)'};cursor:pointer;text-align:left;transition:all 0.15s ease;`;

    // Card 1: Single vs Double Click Opening Mode
    const clickCardHtml = window.sys.ui.card({
      title: 'explorer_settings.click_card_title',
      icon: '🖱️',
      content: `
        <p style="margin:0 0 12px 0;font-size:0.83rem;color:var(--text-muted);">${esc(t('explorer_settings.click_card_desc'))}</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;">
          <label style="${clickChoiceStyle(prefs.openMode === 'double')}">
            <input type="radio" name="expOpenMode" value="double" ${prefs.openMode === 'double' ? 'checked' : ''} style="margin-top:3px;accent-color:var(--accent-primary,#6366f1);" />
            <div>
              <div style="font-weight:700;font-size:0.88rem;color:var(--text-main);">🖱️ ${esc(t('explorer_settings.click_double_title'))}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);margin-top:3px;line-height:1.4;">${esc(t('explorer_settings.click_double_desc'))}</div>
            </div>
          </label>
          <label style="${clickChoiceStyle(prefs.openMode === 'single')}">
            <input type="radio" name="expOpenMode" value="single" ${prefs.openMode === 'single' ? 'checked' : ''} style="margin-top:3px;accent-color:var(--accent-primary,#6366f1);" />
            <div>
              <div style="font-weight:700;font-size:0.88rem;color:var(--text-main);">👆 ${esc(t('explorer_settings.click_single_title'))}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);margin-top:3px;line-height:1.4;">${esc(t('explorer_settings.click_single_desc'))}</div>
            </div>
          </label>
        </div>
      `
    });

    // Card 2: Display Profile, Sidebar & Pro List Options
    const displayCardHtml = window.sys.ui.card({
      title: 'explorer_settings.display_card_title',
      icon: '🗂️',
      content: `
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;">
            <label style="display:flex;flex-direction:column;gap:5px;font-size:0.8rem;color:var(--text-muted);">
              <span>${esc(t('explorer_settings.default_view_label'))}</span>
              <select id="expPrefDefaultView" style="${selectStyle}">
                <option value="list" ${prefs.defaultViewMode === 'list' ? 'selected' : ''}>☰ ${esc(t('explorer_settings.view_pro'))}</option>
                <option value="grid" ${prefs.defaultViewMode === 'grid' ? 'selected' : ''}>▦ ${esc(t('explorer_settings.view_grid'))}</option>
                <option value="mosaic" ${prefs.defaultViewMode === 'mosaic' ? 'selected' : ''}>☷ ${esc(t('explorer_settings.view_mosaic'))}</option>
                <option value="polaroid" ${prefs.defaultViewMode === 'polaroid' ? 'selected' : ''}>🖼️ ${esc(t('explorer_settings.view_multimedia'))}</option>
              </select>
            </label>
            <label style="display:flex;flex-direction:column;gap:5px;font-size:0.8rem;color:var(--text-muted);">
              <span>${esc(t('explorer_settings.sidebar_mode_label'))}</span>
              <select id="expPrefSidebarMode" style="${selectStyle}">
                <option value="auto" ${prefs.sidebarMode === 'auto' ? 'selected' : ''}>${esc(t('explorer_settings.sidebar_auto'))}</option>
                <option value="always" ${prefs.sidebarMode === 'always' ? 'selected' : ''}>${esc(t('explorer_settings.sidebar_always'))}</option>
                <option value="hidden" ${prefs.sidebarMode === 'hidden' ? 'selected' : ''}>${esc(t('explorer_settings.sidebar_hidden'))}</option>
              </select>
            </label>
          </div>

          <label style="${toggleRowStyle}">
            <span style="font-size:0.84rem;color:var(--text-main);">${esc(t('explorer_settings.unified_folders_label'))}</span>
            <input type="checkbox" id="expPrefUnifiedFolders" ${prefs.unifiedFoldersInList ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent-primary,#6366f1);" />
          </label>

          <label style="${toggleRowStyle}">
            <span style="font-size:0.84rem;color:var(--text-main);">${esc(t('explorer_settings.show_checkboxes_label'))}</span>
            <input type="checkbox" id="expPrefShowCheckboxes" ${prefs.showCheckboxesInList ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent-primary,#6366f1);" />
          </label>

          <label style="${toggleRowStyle}">
            <span style="font-size:0.84rem;color:var(--text-main);">${esc(t('explorer_settings.open_inspector_label'))}</span>
            <input type="checkbox" id="expPrefOpenInspector" ${prefs.openInspectorOnStart ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent-primary,#6366f1);" />
          </label>

          <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 12px;border-radius:9px;border:1px solid var(--border-color);background:var(--bg-main);flex-wrap:wrap;">
            <span style="font-size:0.84rem;color:var(--text-main);">${esc(t('explorer_settings.thumb_zoom_label'))}</span>
            <div style="display:flex;align-items:center;gap:10px;min-width:200px;">
              <input type="range" id="expPrefThumbZoom" min="120" max="320" step="10" value="${prefs.defaultThumbZoom}" style="flex:1;accent-color:var(--accent-primary,#6366f1);" />
              <span id="expPrefThumbZoomVal" style="font-size:0.8rem;font-weight:600;min-width:44px;text-align:right;color:var(--text-muted);">${prefs.defaultThumbZoom} px</span>
            </div>
          </div>
        </div>
      `
    });

    // Card 3: Per-Folder View Memory, Cache & Maintenance
    const perfCardHtml = window.sys.ui.card({
      title: 'explorer_settings.perf_card_title',
      icon: '⚡',
      content: `
        <div style="display:flex;flex-direction:column;gap:12px;">
          <label style="${toggleRowStyle}">
            <span style="font-size:0.84rem;color:var(--text-main);">${esc(t('explorer_settings.nav_cache_label'))}</span>
            <input type="checkbox" id="expPrefNavCache" ${prefs.enableNavCache ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent-primary,#6366f1);" />
          </label>

          <div style="font-size:0.82rem;color:var(--text-muted);">
            📌 ${esc(t('explorer_settings.folder_overrides_info', { count: overridesCount }))}
          </div>

          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            <button type="button" id="expPrefResetViewsBtn" class="sysmon-action-btn" style="padding:7px 13px;font-size:0.82rem;">
              ↺ ${esc(t('explorer_settings.reset_views_btn'))}
            </button>
            <button type="button" id="expPrefClearRecentsBtn" class="sysmon-action-btn" style="padding:7px 13px;font-size:0.82rem;">
              🧹 ${esc(t('explorer_settings.clear_recents_btn'))}
            </button>
            <button type="button" id="expPrefResetAllBtn" class="sysmon-action-btn" style="padding:7px 13px;font-size:0.82rem;background:rgba(239,68,68,0.14);color:#ef4444;border:1px solid rgba(239,68,68,0.35);">
              ⚠️ ${esc(t('explorer_settings.reset_all_btn'))}
            </button>
          </div>
        </div>
      `
    });

    // Card 4: Keyboard Shortcuts Reference
    const shortcuts = [
      ['F2', 'explorer_settings.sc_rename'],
      ['F3', 'explorer_settings.sc_split'],
      ['F5', 'explorer_settings.sc_refresh'],
      ['Space', 'explorer_settings.sc_quicklook'],
      ['Ctrl + L', 'explorer_settings.sc_address'],
      ['Ctrl + F', 'explorer_settings.sc_search'],
      ['Ctrl + T / W', 'explorer_settings.sc_tabs'],
      ['Ctrl + Shift + N', 'explorer_settings.sc_new_folder'],
      ['Alt + ← / → / ↑', 'explorer_settings.sc_history'],
      ['↑ ↓ ← →', 'explorer_settings.sc_arrows']
    ];
    const shortcutsCardHtml = window.sys.ui.card({
      title: 'explorer_settings.shortcuts_card_title',
      icon: '⌨️',
      content: `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;">
          ${shortcuts.map(([kbd, key]) => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-radius:7px;background:var(--bg-main);border:1px solid var(--border-color);font-size:0.79rem;">
              <span style="color:var(--text-muted);">${esc(t(key))}</span>
              <kbd style="padding:2px 7px;border-radius:5px;background:var(--bg-card);border:1px solid var(--border-color);font-family:monospace;font-size:0.74rem;font-weight:700;color:var(--text-main);white-space:nowrap;">${esc(kbd)}</kbd>
            </div>
          `).join('')}
        </div>
      `
    });

    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:14px;">${clickCardHtml}${displayCardHtml}${perfCardHtml}${shortcutsCardHtml}</div>`;

    const applyPatch = (patch, reRender = false) => {
      api.savePrefsForCurrentUser(patch);
      settingsApp.toast.success(t('explorer_settings.saved_toast'));
      if (reRender) renderExplorerPanel(container, settingsApp);
    };

    container.querySelectorAll('input[name="expOpenMode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.checked) applyPatch({ openMode: radio.value }, true);
      });
    });

    const defViewSel = container.querySelector('#expPrefDefaultView');
    if (defViewSel) defViewSel.addEventListener('change', () => applyPatch({ defaultViewMode: defViewSel.value }));

    const sbSel = container.querySelector('#expPrefSidebarMode');
    if (sbSel) sbSel.addEventListener('change', () => applyPatch({ sidebarMode: sbSel.value }));

    const unifiedCb = container.querySelector('#expPrefUnifiedFolders');
    if (unifiedCb) unifiedCb.addEventListener('change', () => applyPatch({ unifiedFoldersInList: unifiedCb.checked }));

    const checkboxesCb = container.querySelector('#expPrefShowCheckboxes');
    if (checkboxesCb) checkboxesCb.addEventListener('change', () => applyPatch({ showCheckboxesInList: checkboxesCb.checked }));

    const inspectorCb = container.querySelector('#expPrefOpenInspector');
    if (inspectorCb) inspectorCb.addEventListener('change', () => applyPatch({ openInspectorOnStart: inspectorCb.checked }));

    const navCacheCb = container.querySelector('#expPrefNavCache');
    if (navCacheCb) navCacheCb.addEventListener('change', () => applyPatch({ enableNavCache: navCacheCb.checked }));

    const zoomSlider = container.querySelector('#expPrefThumbZoom');
    const zoomVal = container.querySelector('#expPrefThumbZoomVal');
    if (zoomSlider) {
      zoomSlider.addEventListener('input', () => {
        if (zoomVal) zoomVal.textContent = `${zoomSlider.value} px`;
      });
      zoomSlider.addEventListener('change', () => {
        applyPatch({ defaultThumbZoom: parseInt(zoomSlider.value, 10) });
      });
    }

    const resetViewsBtn = container.querySelector('#expPrefResetViewsBtn');
    if (resetViewsBtn) {
      resetViewsBtn.addEventListener('click', () => {
        api.clearAllFolderViewOverridesForCurrentUser();
        settingsApp.toast.info(t('explorer_settings.reset_views_done'));
        renderExplorerPanel(container, settingsApp);
      });
    }

    const clearRecentsBtn = container.querySelector('#expPrefClearRecentsBtn');
    if (clearRecentsBtn) {
      clearRecentsBtn.addEventListener('click', () => {
        api.clearRecentFoldersForCurrentUser();
        settingsApp.toast.info(t('explorer_settings.clear_recents_done'));
      });
    }

    const resetAllBtn = container.querySelector('#expPrefResetAllBtn');
    if (resetAllBtn) {
      resetAllBtn.addEventListener('click', () => {
        api.resetPrefsForCurrentUser();
        settingsApp.toast.info(t('explorer_settings.reset_all_done'));
        renderExplorerPanel(container, settingsApp);
      });
    }
  }

  window.AtelierExplorerPanel = {
    render: renderExplorerPanel
  };
})(window);
