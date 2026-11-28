<?php
require_once __DIR__ . '/system/boot/bootstrap.php';
require_once __DIR__ . '/system/kernel/functions.php';

// Set HTTP Security Headers
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: strict-origin-when-cross-origin');

// Automatically enforce trailing slash for directory access to prevent relative fetch 404 errors
$request_uri = $_SERVER['REQUEST_URI'] ?? '';
$path = parse_url($request_uri, PHP_URL_PATH);
if ($path && substr($path, -1) !== '/' && !pathinfo($path, PATHINFO_EXTENSION)) {
    $query = parse_url($request_uri, PHP_URL_QUERY);
    $redirect = $path . '/' . ($query ? '?' . $query : '');
    header('Location: ' . $redirect, true, 301);
    exit;
}

// i18n Locales Discovery & Detection
$available_locales = get_available_locales($real_base_dir);
$default_locale = detect_browser_locale($available_locales, 'fr');
$initial_translations = load_locale_translations($real_base_dir, $default_locale);
?>
<!DOCTYPE html>
<html lang="<?php echo htmlspecialchars($default_locale, ENT_QUOTES, 'UTF-8'); ?>">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="csrf-token" content="<?php echo get_csrf_token(); ?>">
  <meta name="cookie-consent-enabled" content="<?php echo !empty($enable_cookie_consent) ? '1' : '0'; ?>">
  <meta name="default-locale" content="<?php echo htmlspecialchars($default_locale, ENT_QUOTES, 'UTF-8'); ?>">
  <meta name="description" content="Atelier by GallusTech — Sovereign Web Desktop, Media Cloud & Creative Studio">
  <meta name="theme-color" content="#4f46e5">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="apple-touch-icon" href="docs/assets/atelier-icon.svg">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%25' stop-color='%234f46e5'/><stop offset='100%25' stop-color='%232563eb'/></linearGradient></defs><rect width='64' height='64' rx='16' fill='url(%23g)'/><path d='M32 14L48 50H40.5L37 41.5H27L23.5 50H16L32 14ZM32 24.5L29.2 35.5H34.8L32 24.5Z' fill='%23ffffff'/></svg>">
  <title><?php echo htmlspecialchars($gallery_title . (!empty($gallery_brand_subtitle) ? ' ' . $gallery_brand_subtitle : ''), ENT_QUOTES, 'UTF-8'); ?></title>


  <!-- Initial i18n Locales Configuration Payload -->
  <script id="initialLocalesConfig" type="application/json">
    <?php echo json_encode([
      'locales'      => $available_locales,
      'default'      => $default_locale,
      'translations' => $initial_translations
    ], JSON_HEX_TAG | JSON_HEX_AMP); ?>
  </script>

  <!-- Native System Typography (Zero external font CDN requests — GDPR & offline friendly) -->
  <link rel="stylesheet" href="themes/base.css?v=<?php echo filemtime(__DIR__ . '/themes/base.css'); ?>">
  <link rel="stylesheet" id="activeThemeStylesheet" href="themes/<?php echo htmlspecialchars($theme_preset, ENT_QUOTES, 'UTF-8'); ?>/theme.css?v=<?php echo file_exists(__DIR__ . '/themes/' . $theme_preset . '/theme.css') ? filemtime(__DIR__ . '/themes/' . $theme_preset . '/theme.css') : '1'; ?>">
  <link rel="stylesheet" href="css/gallery.css?v=<?php echo filemtime(__DIR__ . '/css/gallery.css'); ?>">
  <link rel="stylesheet" href="css/gallery-features.css?v=<?php echo file_exists(__DIR__ . '/css/gallery-features.css') ? filemtime(__DIR__ . '/css/gallery-features.css') : '1'; ?>">
  <link rel="stylesheet" href="css/gallery-overlays.css?v=<?php echo file_exists(__DIR__ . '/css/gallery-overlays.css') ? filemtime(__DIR__ . '/css/gallery-overlays.css') : '1'; ?>">
  <link rel="stylesheet" href="css/window-manager.css?v=<?php echo file_exists(__DIR__ . '/css/window-manager.css') ? filemtime(__DIR__ . '/css/window-manager.css') : '1'; ?>">
  <link rel="stylesheet" href="system/userland/ui/styles/toolkit.css?v=<?php echo file_exists(__DIR__ . '/system/userland/ui/styles/toolkit.css') ? filemtime(__DIR__ . '/system/userland/ui/styles/toolkit.css') : '1'; ?>">

  <!-- Leaflet 1.9.4 (BSD-2-Clause) & MarkerCluster 1.5.3 (MIT) — Locally vendored (zero external CDN) -->
  <link rel="stylesheet" href="assets/vendor/leaflet/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous"/>
  <link rel="stylesheet" href="assets/vendor/leaflet/MarkerCluster.css" integrity="sha384-pmjIAcz2bAn0xukfxADbZIb3t8oRT9Sv0rvO+BR5Csr6Dhqq+nZs59P0pPKQJkEV" crossorigin="anonymous"/>
  <link rel="stylesheet" href="assets/vendor/leaflet/MarkerCluster.Default.css" integrity="sha384-wgw+aLYNQ7dlhK47ZPK7FRACiq7ROZwgFNg0m04avm4CaXS+Z9Y7nMu8yNjBKYC+" crossorigin="anonymous"/>
  <script src="assets/vendor/leaflet/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous"></script>
  <script src="assets/vendor/leaflet/leaflet.markercluster.js" integrity="sha384-eXVCORTRlv4FUUgS/xmOyr66XBVraen8ATNLMESp92FKXLAMiKkerixTiBvXriZr" crossorigin="anonymous"></script>

  <!-- Userland System Runtime (Core OS Bus, WindowManager, MenuBar, Registries, Syscalls, AppManager, I18n, WebOSToolkit) -->
  <script src="system/userland/core/IconHelper.js?v=<?php echo filemtime(__DIR__ . '/system/userland/core/IconHelper.js'); ?>" defer></script>
  <script src="system/userland/core/EventBus.js" defer></script>
  <script src="system/userland/core/SyscallClient.js?v=<?php echo filemtime(__DIR__ . '/system/userland/core/SyscallClient.js'); ?>" defer></script>
  <script src="system/userland/core/MenuBarManager.js?v=<?php echo filemtime(__DIR__ . '/system/userland/core/MenuBarManager.js'); ?>" defer></script>
  <script src="system/userland/core/WindowManager.js?v=<?php echo filemtime(__DIR__ . '/system/userland/core/WindowManager.js'); ?>" defer></script>
  <script src="system/userland/core/GalleryViewRegistry.js" defer></script>
  <script src="system/userland/core/MediaViewerRegistry.js?v=<?php echo filemtime(__DIR__ . '/system/userland/core/MediaViewerRegistry.js'); ?>" defer></script>
  <script src="system/userland/core/AppManager.js?v=<?php echo filemtime(__DIR__ . '/system/userland/core/AppManager.js'); ?>" defer></script>
  <script src="system/userland/i18n/I18nEngine.js?v=<?php echo filemtime(__DIR__ . '/system/userland/i18n/I18nEngine.js'); ?>" defer></script>
  <script src="system/userland/theme/ThemeEngine.js" defer></script>
  <script src="system/userland/ui/WebOSToolkit.js" defer></script>
  <script src="system/userland/services/WebOSServices.js?v=<?php echo filemtime(__DIR__ . '/system/userland/services/WebOSServices.js'); ?>" defer></script>
  <script src="system/userland/services/ClipboardService.js" defer></script>
  <script src="system/userland/core/ShortcutManager.js" defer></script>
  <script src="system/userland/services/FilePickerService.js?v=<?php echo filemtime(__DIR__ . '/system/userland/services/FilePickerService.js'); ?>" defer></script>
  <script src="system/userland/services/ShareVolumesService.js?v=<?php echo filemtime(__DIR__ . '/system/userland/services/ShareVolumesService.js'); ?>" defer></script>
  <script src="system/userland/services/AuthModalService.js?v=<?php echo filemtime(__DIR__ . '/system/userland/services/AuthModalService.js'); ?>" defer></script>
  <script src="system/userland/services/TaskbarService.js?v=<?php echo filemtime(__DIR__ . '/system/userland/services/TaskbarService.js'); ?>" defer></script>
  <script src="system/userland/desktop/WallpaperManager.js?v=<?php echo filemtime(__DIR__ . '/system/userland/desktop/WallpaperManager.js'); ?>" defer></script>
  <script src="system/userland/desktop/TaskbarClock.js" defer></script>
  <script src="system/userland/desktop/DesktopShortcuts.js?v=<?php echo filemtime(__DIR__ . '/system/userland/desktop/DesktopShortcuts.js'); ?>" defer></script>
  <script src="system/userland/core/WebOSApp.js?v=<?php echo filemtime(__DIR__ . '/system/userland/core/WebOSApp.js'); ?>" defer></script>
  <script src="system/userland/core/WebAppVfsBridge.js?v=<?php echo filemtime(__DIR__ . '/system/userland/core/WebAppVfsBridge.js'); ?>" defer></script>
  <script src="system/userland/core/WebAppHost.js?v=<?php echo filemtime(__DIR__ . '/system/userland/core/WebAppHost.js'); ?>" defer></script>
  <script src="system/userland/services/AgentToolRegistry.js?v=<?php echo filemtime(__DIR__ . '/system/userland/services/AgentToolRegistry.js'); ?>" defer></script>
  <script src="system/userland/core/WebAppAgentBridge.js?v=<?php echo filemtime(__DIR__ . '/system/userland/core/WebAppAgentBridge.js'); ?>" defer></script>
  <script src="system/userland/services/AiCopilotService.js?v=<?php echo filemtime(__DIR__ . '/system/userland/services/AiCopilotService.js'); ?>" defer></script>


  <script src="system/userland/ui/MetadataInspector.js" defer></script>

  <!-- Synchronous theme restore and initial disabled apps payload -->
  <script>
    (function() {
      try {
        var t = localStorage.getItem('atelier_active_theme') || (document.cookie.match(/(?:^|;\s*)atelier_theme=([^;]+)/) || [])[1];
        if (t) {
          document.documentElement.setAttribute('data-theme', t);
        }
      } catch(e) {}
    })();
    window.ATELIER_DISABLED_APPS = <?php echo json_encode(\Atelier\Kernel\PluginDiscovery::getDisabledAppIds(__DIR__)); ?>;
  </script>

  <!-- Dynamic Theme Injection from config/themes.php -->
  <style id="dynamic-theme-vars">
    :root, :root[data-theme="<?php echo $theme_preset; ?>"], body[data-theme="<?php echo $theme_preset; ?>"] {
      --bg-main: <?php echo $active_theme['bg_main']; ?>;
      --window-bg: <?php echo $active_theme['window_bg'] ?? $active_theme['bg_main']; ?>;
      --bg-panel: <?php echo $active_theme['window_bg'] ?? $active_theme['bg_main']; ?>;
      --header-bg: <?php echo $active_theme['header_bg'] ?? $active_theme['card_bg']; ?>;
      --menu-bar-bg: <?php echo $active_theme['menu_bar_bg'] ?? $active_theme['bg_main']; ?>;
      --sidebar-bg: <?php echo $active_theme['sidebar_bg'] ?? 'rgba(0, 0, 0, 0.25)'; ?>;
      --polaroid-bg: <?php echo $active_theme['polaroid_bg']; ?>;
      --polaroid-text: <?php echo $active_theme['polaroid_text']; ?>;
      --polaroid-sub: <?php echo $active_theme['polaroid_sub']; ?>;
      --accent-primary: <?php echo $active_theme['accent']; ?>;
      --accent: <?php echo $active_theme['accent']; ?>;
      --bg-card: <?php echo $active_theme['card_bg']; ?>;
      --card-bg: <?php echo $active_theme['card_bg']; ?>;
      --border-color: <?php echo $active_theme['border_color'] ?? 'rgba(255, 255, 255, 0.08)'; ?>;
      --border-color-hover: <?php echo $active_theme['border_color_hover'] ?? 'rgba(99, 102, 241, 0.4)'; ?>;
      --text-main: <?php echo $active_theme['text_main']; ?>;
      --text-muted: <?php echo $active_theme['text_muted']; ?>;
    }
  </style>

  <?php
  use Atelier\Kernel\PluginDiscovery;
  use Atelier\Kernel\Media\FormatRegistry;
  $discovered_apps = PluginDiscovery::getDiscoveredApps(__DIR__, false);
  $all_apps_manifests = PluginDiscovery::getDiscoveredApps(__DIR__, true);
  $discovered_views = PluginDiscovery::getDiscoveredViews(__DIR__);
  $discovered_wm_styles = PluginDiscovery::getDiscoveredWindowStyles(__DIR__);
  $atelier_format_registry = FormatRegistry::resolve(__DIR__, $media_types ?? [], $discovered_apps);
  ?>
  <script>
    window.ATELIER_DISCOVERED_WM_STYLES = <?php echo json_encode($discovered_wm_styles); ?>;
    window.ATELIER_MIME_MAP = <?php echo json_encode($atelier_format_registry['mime_to_extensions'], JSON_UNESCAPED_SLASHES); ?>;
    window.ATELIER_ALLOWED_UPLOAD_EXTENSIONS = <?php echo json_encode($atelier_format_registry['allowed_upload_extensions']); ?>;
  </script>

  <!-- Auto-Discovered Explorer Views (apps/explorer/views/<name>/manifest.json) -->
  <?php foreach ($discovered_views as $view_info): ?>
    <?php if (!empty($view_info['css_entry'])): ?>
      <link rel="stylesheet" href="<?php echo htmlspecialchars($view_info['css_entry'], ENT_QUOTES, 'UTF-8'); ?>?v=<?php echo filemtime(__DIR__ . '/' . $view_info['css_entry']); ?>">
    <?php endif; ?>
    <?php if (!empty($view_info['js_entry'])): ?>
      <script src="<?php echo htmlspecialchars($view_info['js_entry'], ENT_QUOTES, 'UTF-8'); ?>?v=<?php echo filemtime(__DIR__ . '/' . $view_info['js_entry']); ?>" defer></script>
    <?php endif; ?>
  <?php endforeach; ?>

  <!-- Auto-Discovered Window Manager Skins (wm-styles/<name>/style.json) -->
  <?php foreach ($discovered_wm_styles as $style_info): ?>
    <?php if (!empty($style_info['css_entry'])): ?>
      <link rel="stylesheet" href="<?php echo htmlspecialchars($style_info['css_entry'], ENT_QUOTES, 'UTF-8'); ?>?v=<?php echo filemtime(__DIR__ . '/' . $style_info['css_entry']); ?>">
    <?php endif; ?>
  <?php endforeach; ?>

  <!-- Auto-Discovered Modular Applications (apps/<name>/manifest.json) -->
  <?php foreach ($discovered_apps as $app_info): ?>
    <?php if (!empty($app_info['css_entry'])): ?>
      <link rel="stylesheet" href="<?php echo htmlspecialchars($app_info['css_entry'], ENT_QUOTES, 'UTF-8'); ?>?v=<?php echo filemtime(__DIR__ . '/' . $app_info['css_entry']); ?>">
    <?php endif; ?>
    <?php if (!empty($app_info['scripts'])): ?>
      <?php foreach ($app_info['scripts'] as $aux_script): ?>
        <script src="<?php echo htmlspecialchars($aux_script, ENT_QUOTES, 'UTF-8'); ?>?v=<?php echo filemtime(__DIR__ . '/' . $aux_script); ?>" defer></script>
      <?php endforeach; ?>
    <?php endif; ?>
    <?php if (!empty($app_info['js_entry'])): ?>
      <script src="<?php echo htmlspecialchars($app_info['js_entry'], ENT_QUOTES, 'UTF-8'); ?>?v=<?php echo filemtime(__DIR__ . '/' . $app_info['js_entry']); ?>" defer></script>
    <?php endif; ?>
  <?php endforeach; ?>

  <?php
  \Atelier\Kernel\Auth\AuthManager::revalidateActiveUser(__DIR__);
  $atelier_boot_user = \Atelier\Kernel\Auth\AuthManager::getCurrentUser();
  $atelier_boot_quota = $atelier_boot_user ? \Atelier\Kernel\Auth\UserManager::getUserQuotaInfo(__DIR__, $real_base_dir, $atelier_boot_user) : null;
  $atelier_boot_prefs = $atelier_boot_user ? \Atelier\Kernel\Auth\UserManager::getUserPreferences(__DIR__, (int)$atelier_boot_user['id']) : [];
  $desktop_config = \Atelier\Kernel\Auth\UserManager::getEffectiveDesktopConfig(__DIR__, $atelier_boot_user, is_admin_logged_in());
  ?>
  <script>
    window.ATELIER_DISCOVERED_APPS = <?php echo json_encode($discovered_apps, JSON_HEX_TAG | JSON_HEX_AMP); ?>;
    window.ATELIER_I18N_CONFIG = <?php echo json_encode([
      'locales'      => $available_locales,
      'default'      => $default_locale,
      'translations' => $initial_translations
    ], JSON_HEX_TAG | JSON_HEX_AMP); ?>;
    window.ATELIER_DESKTOP_CONFIG = <?php echo json_encode($desktop_config, JSON_HEX_TAG | JSON_HEX_AMP); ?>;
    window.ATELIER_AUTOSTART_CONFIG = <?php echo json_encode(get_autostart_config(__DIR__), JSON_HEX_TAG | JSON_HEX_AMP); ?>;
    window.CSRF_TOKEN = <?php echo json_encode(get_csrf_token()); ?>;
    window.ATELIER_CSRF_TOKEN = window.CSRF_TOKEN;
    window.IS_ADMIN = <?php echo is_admin_logged_in() ? 'true' : 'false'; ?>;
    window.ATELIER_CURRENT_USER = <?php echo json_encode($atelier_boot_user, JSON_HEX_TAG | JSON_HEX_AMP); ?>;
    window.ATELIER_USER_QUOTA = <?php echo json_encode($atelier_boot_quota, JSON_HEX_TAG | JSON_HEX_AMP); ?>;
    window.ATELIER_USER_PREFERENCES = <?php echo json_encode($atelier_boot_prefs, JSON_HEX_TAG | JSON_HEX_AMP); ?>;
    window.ATELIER_MOUNTED_VOLUMES = <?php echo json_encode(\Atelier\Kernel\Auth\ShareManager::getMountedVolumesForCurrentUser($real_base_dir), JSON_HEX_TAG | JSON_HEX_AMP); ?>;
    window.ATELIER_AUTH_POLICY = <?php echo json_encode(\Atelier\Kernel\Auth\AuthSettings::getPublicPolicy(__DIR__), JSON_HEX_TAG | JSON_HEX_AMP); ?>;
  </script>

  <!-- WebOS Desktop Host Environment -->
  <script src="js/desktop.js?v=<?php echo filemtime(__DIR__ . '/js/desktop.js'); ?>" defer></script>

</head>
<body data-theme="<?php echo htmlspecialchars($theme_preset, ENT_QUOTES, 'UTF-8'); ?>">

  <!-- WebOS Top System & Application Bar (macOS Style) -->
  <header class="app-header">
    <div class="header-container">
      <!-- 1. OS Brand Section (Apple-menu style Application Launcher) -->
      <div class="brand-section" id="brandSection">
        <button type="button" id="appLauncherBtn" class="app-launcher-btn" title="Menu des Applications" data-i18n-title="nav.apps_menu">
          <span class="brand-logo" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;background:linear-gradient(135deg,#4f46e5,#2563eb);color:#fff;font-weight:800;font-size:0.85rem;letter-spacing:-0.02em;flex-shrink:0;">A</span>
          <h1 class="brand-title"><?php echo htmlspecialchars($gallery_title, ENT_QUOTES, 'UTF-8'); ?></h1>
          <?php if (!empty($gallery_brand_subtitle)): ?>
            <span class="brand-subtitle" style="font-size:0.72rem;font-weight:500;opacity:0.68;margin-left:2px;white-space:nowrap;"><?php echo htmlspecialchars($gallery_brand_subtitle, ENT_QUOTES, 'UTF-8'); ?></span>
          <?php endif; ?>
          <span class="brand-arrow">▾</span>
        </button>
        <div id="appLauncherMenu" class="app-launcher-menu" style="display: none;">
          <div class="app-launcher-header">
            <span class="app-launcher-title" data-i18n="nav.apps_menu">Applications</span>
          </div>
          <div id="appLauncherList" class="app-launcher-list"></div>
        </div>
      </div>

      <!-- 2. Dynamic Contextual Application Zone (Colonized by Active App via MenuBarManager) -->
      <div id="appHeaderZone" class="app-header-zone"></div>

      <!-- 3. OS System Tray (Universal Settings, Language, Admin) -->
      <div class="system-tray-section">
        <!-- Language Selector Dropdown -->
        <div class="lang-selector-container" id="langSelectorContainer">
          <button type="button" id="langSelectorBtn" class="btn-toggle lang-btn" title="Changer la langue" data-i18n-title="nav.switch_lang">
            <span id="currentLangFlag"><?php echo get_locale_flag_html($available_locales[$default_locale] ?? []); ?></span>
            <span id="currentLangCode"><?php echo strtoupper(htmlspecialchars($default_locale, ENT_QUOTES, 'UTF-8')); ?></span>
            <span class="lang-dropdown-arrow">▾</span>
          </button>
          <div id="langDropdownMenu" class="lang-dropdown-menu" style="display: none;">
            <?php foreach ($available_locales as $code => $info): ?>
              <button type="button" class="lang-option-btn <?php echo ($code === $default_locale) ? 'active' : ''; ?>" data-lang="<?php echo htmlspecialchars($code, ENT_QUOTES, 'UTF-8'); ?>">
                <span class="lang-flag"><?php echo get_locale_flag_html($info); ?></span>
                <span class="lang-name"><?php echo htmlspecialchars($info['name'], ENT_QUOTES, 'UTF-8'); ?></span>
                <span class="lang-code"><?php echo strtoupper(htmlspecialchars($code, ENT_QUOTES, 'UTF-8')); ?></span>
              </button>
            <?php endforeach; ?>
          </div>
        </div>

        <?php
          $hdr_user = \Atelier\Kernel\Auth\AuthManager::getCurrentUser();
          $hdr_is_admin = is_admin_logged_in();
          $hdr_icon = $hdr_user ? ($hdr_is_admin ? '🛡️' : '👤') : '🔑';
          $hdr_label = $hdr_user
            ? ($hdr_user['display_name'] ?: $hdr_user['username'])
            : ($hdr_is_admin ? __t('nav.admin') : __t('auth.sign_in_short'));
          $hdr_active = ($hdr_user || $hdr_is_admin) ? ' active' : '';
        ?>
        <button id="adminBtn" class="btn-toggle<?php echo $hdr_active; ?>" title="<?php echo htmlspecialchars($hdr_label, ENT_QUOTES, 'UTF-8'); ?>">
          <span id="adminBtnIcon"><?php echo $hdr_icon; ?></span> <span id="adminBtnText"><?php echo htmlspecialchars($hdr_label, ENT_QUOTES, 'UTF-8'); ?></span>
        </button>
      </div>
    </div>
  </header>

  <!-- WebOS Desktop & Workspace Container -->
  <div id="webosDesktop" class="webos-desktop">

    <!-- Permanent Desktop Surface & Shortcuts Grid (Non-closable WebOS Base Layer) -->
    <div id="desktopSurface" class="desktop-surface">
      <div id="desktopShortcuts" class="desktop-shortcuts-grid"></div>
    </div>

  <!-- Lightbox Modal -->
  <div id="lightbox" class="lightbox-modal" role="dialog" aria-hidden="true">
    <div class="lightbox-header">
      <div>
        <div id="lightboxTitle" class="lightbox-title" data-i18n="lightbox.preview_title">Aperçu média</div>
        <div id="lightboxMeta" style="font-size:0.8rem;color:var(--text-muted);"></div>
        <div id="lightboxComment" class="lightbox-comment" style="display:none;"></div>
      </div>

      <!-- Generic Application Actions Container (Populated by active App Viewer) -->
      <div class="lightbox-actions">
        <div id="lightboxAppActions" class="lightbox-app-actions" style="display: flex; gap: 0.4rem;"></div>
        <button id="lightboxExifBtn" class="lightbox-btn" title="Détails EXIF (I)" data-i18n-title="lightbox.exif" style="display: none;">
          ℹ️
        </button>
        <button id="lightboxEditCommentBtn" class="lightbox-btn" title="Éditer la légende (.comment)" data-i18n-title="lightbox.edit_comment" style="display: none;">
          ✏️
        </button>
        <button id="lightboxDeleteBtn" class="lightbox-btn" title="Supprimer le média (Mode Admin)" data-i18n-title="lightbox.delete" style="display: none; color: #f87171;">
          🗑️
        </button>
        <button id="lightboxFavBtn" class="lightbox-btn" title="Ajouter aux favoris" data-i18n-title="lightbox.favorite_add">
          🤍
        </button>
        <button id="lightboxFullscreenBtn" class="lightbox-btn" title="Plein écran (F)" data-i18n-title="lightbox.fullscreen">
          ⛶
        </button>
        <a id="lightboxDownloadBtn" href="#" class="lightbox-btn" title="Télécharger le fichier" data-i18n-title="lightbox.download" download>
          ⬇️
        </a>
        <button id="lightboxCloseBtn" class="lightbox-btn" title="Fermer (Échap)" data-i18n-title="lightbox.close">
          ✕
        </button>
      </div>
    </div>

    <div class="lightbox-body">
      <button id="lightboxPrevBtn" class="lightbox-nav-btn lightbox-nav-prev" title="Précédent" data-i18n-title="lightbox.prev">
        &lsaquo;
      </button>

      <div id="lightboxContent" class="lightbox-content-wrapper"></div>

      <button id="lightboxNextBtn" class="lightbox-nav-btn lightbox-nav-next" title="Suivant" data-i18n-title="lightbox.next">
        &rsaquo;
      </button>
    </div>

    <!-- Lightbox EXIF Drawer Panel -->
    <div id="lightboxExifPanel" class="lightbox-exif-panel" style="display: none;">
      <div class="exif-panel-header">
        <h4 data-i18n="lightbox.exif_panel_title">ℹ️ Propriétés du fichier</h4>
        <button id="closeExifPanelBtn" class="lightbox-btn" style="padding:0.2rem 0.5rem;" title="Fermer" data-i18n-title="common.close">✕</button>
      </div>
      <div id="exifPanelBody" class="exif-panel-body"></div>
    </div>

    <div class="lightbox-footer">
      <div data-i18n="lightbox.shortcuts_hint">
        Navigation: <kbd>&larr;</kbd> <kbd>&rarr;</kbd> / Swipe | Zoom: <kbd>+</kbd> <kbd>-</kbd> | Drag/Pan: <kbd>Mouse drag</kbd> | Reset: <kbd>0</kbd> / <kbd>R</kbd> | Fullscreen: <kbd>F</kbd> | Exit: <kbd>Esc</kbd>
      </div>
    </div>
  </div>

  </div><!-- /#webosDesktop -->

  <!-- Auto-Discovered Modular Application UI Templates & Shell Components (apps/<name>/template.php) -->
  <?php foreach ($discovered_apps as $app_info): ?>
    <?php if (!empty($app_info['template_entry']) && file_exists(__DIR__ . '/' . $app_info['template_entry'])): ?>
      <?php include __DIR__ . '/' . $app_info['template_entry']; ?>
    <?php endif; ?>
  <?php endforeach; ?>
  <script>
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      window.addEventListener('load', function() {
        navigator.serviceWorker.register('sw.js').catch(function() {});
      });
    }
  </script>
</body>
</html>
