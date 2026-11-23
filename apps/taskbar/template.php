<?php
// SimpleGallery WebOS - Taskbar Application Template
// Mounted into the DOM when the taskbar app is enabled.
?>
<footer id="webosTaskbar" class="webos-taskbar app-footer">
  <!-- Left: Brand info & Cookie Settings -->
  <div class="taskbar-left-zone">
    <span class="taskbar-brand-link" title="Atelier by GallusTech">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:5px;background:linear-gradient(135deg,#4f46e5,#2563eb);color:#fff;font-weight:800;font-size:0.68rem;margin-right:4px;">A</span>
      <strong><?php echo htmlspecialchars($gallery_title ?? 'Atelier', ENT_QUOTES, 'UTF-8'); ?></strong>
      <?php if (!empty($gallery_brand_subtitle)): ?>
        <span style="opacity:0.7;font-size:0.74rem;margin-left:3px;"><?php echo htmlspecialchars($gallery_brand_subtitle, ENT_QUOTES, 'UTF-8'); ?></span>
      <?php endif; ?>
    </span>
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
