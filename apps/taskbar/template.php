<?php
// SimpleGallery WebOS - Taskbar Application Template
// Mounted into the DOM when the taskbar app is enabled.
?>
<footer id="webosTaskbar" class="webos-taskbar app-footer">
  <!-- Left: Compagnon AI Quick Prompt & Cookie Settings -->
  <div class="taskbar-left-zone">
    <div id="taskbarCopilotBar" class="taskbar-copilot-bar">
      <button type="button" id="taskbarCopilotToggleBtn" class="taskbar-copilot-btn" title="Compagnon (Ctrl+K)" data-i18n-title="copilot.toggle_title">
        <span class="taskbar-copilot-spark" aria-hidden="true">✨</span>
      </button>
      <input type="text" id="taskbarCopilotQuickInput" class="taskbar-copilot-quick-input" placeholder="Demander au Compagnon… (Ctrl+K)" autocomplete="off" spellcheck="false" />
    </div>
    <span class="taskbar-separator">•</span>
    <button type="button" id="openCookieSettingsBtn" class="taskbar-cookie-btn" title="Gérer vos préférences de confidentialité et cookies" data-i18n-title="cookie.footer_link" data-i18n="cookie.footer_link">
      🍪 Cookies
    </button>
    <div id="cookieConsentBanner" style="display:none;"></div>
  </div>

  <!-- Center: Running Applications & Pinned Apps -->
  <div class="taskbar-apps-container" id="taskbarAppsContainer"></div>

  <!-- Right: System Tray (Telemetry, Clock, Show Desktop) -->
  <div class="taskbar-tray-container" id="taskbarTrayContainer">
    <button type="button" class="taskbar-tray-btn" id="taskbarSysmonBtn" title="Moniteur Système (Télémétrie)">
      <span class="taskbar-tray-icon">📊</span>
      <span id="taskbarFpsPill" class="taskbar-tray-pill">60 FPS</span>
    </button>

    <button type="button" class="taskbar-clock-btn" id="taskbarCalendarBtn" title="Calendrier &amp; Horloge">
      <span id="taskbarClockTime" class="taskbar-clock-time">--:--</span>
      <span id="taskbarClockDate" class="taskbar-clock-date">--/--</span>
    </button>

    <button type="button" class="taskbar-show-desktop" id="taskbarShowDesktopBtn" title="Afficher le Bureau"></button>
  </div>
</footer>

<!-- Floating Hover Preview Card (Window Peeking) -->
<div id="taskbarPreviewCard" class="taskbar-preview-card" style="display: none;"></div>

<!-- Mini Calendar Popover -->
<div id="taskbarCalendarPopover" class="taskbar-calendar-popover" style="display: none;"></div>

<!-- Bottom-Left Attached Compagnon AI Popover (Phase E Lot 2) -->
<aside id="taskbarCopilotPopup" class="taskbar-copilot-popup" role="dialog" aria-label="Compagnon" style="display: none;"></aside>
