<?php
namespace Atelier\Kernel\Actions;

use Atelier\Kernel\Auth\AuthManager;
use Atelier\Kernel\FS\CacheManager;
use Atelier\Kernel\I18n\I18nEngine;
use Atelier\Kernel\Media\ExifParser;

class SystemActions {

    public static function handle(string $action, array $params, $context): ?array {
        $base_dir = is_array($context) ? ($context['base_dir'] ?? '') : (string)$context;
        $project_root = (is_array($context) && !empty($context['project_root']))
            ? (string)$context['project_root']
            : \Atelier\Kernel\Config\ConfigStore::resolveRoot($base_dir);
        $raw_body = is_array($context) ? ($context['raw_body'] ?? $params) : $params;

        if ($action === 'get_locales') {
            $locales = I18nEngine::getAvailableLocales($base_dir);
            $detected = I18nEngine::detectBrowserLocale($locales, 'fr');
            return ['status' => 200, 'data' => [
                'success'  => true,
                'locales'  => $locales,
                'detected' => $detected
            ]];
        }

        if ($action === 'get_locale') {
            $code = $_GET['code'] ?? $raw_body['code'] ?? 'fr';
            $code = preg_replace('/[^a-zA-Z0-9_-]/', '', $code);
            $translations = I18nEngine::loadLocaleTranslations($base_dir, $code);
            return ['status' => 200, 'data' => [
                'success'      => true,
                'code'         => $code,
                'translations' => $translations
            ]];
        }

        if ($action === 'get_system_info') {
            $has_gd = extension_loaded('gd');
            $gd_info = $has_gd ? gd_info() : [];
            $has_ffmpeg = false;
            if (function_exists('exec')) {
                @exec('ffmpeg -version 2>&1', $ff_out, $ff_code);
                $has_ffmpeg = ($ff_code === 0);
            }

            global $thumbnail_dir;
            $storage_dir = CacheManager::getCacheStorageDir($base_dir, $thumbnail_dir ?? '.thumbnails');
            $cache_count = 0;
            $cache_size = 0;
            $thumbs_count = 0;
            $thumbs_size = 0;

            if (is_dir($storage_dir)) {
                $files = @scandir($storage_dir) ?: [];
                foreach ($files as $f) {
                    if ($f[0] === '.') continue;
                    $f_path = $storage_dir . '/' . $f;
                    if (is_file($f_path)) {
                        $f_size = @filesize($f_path) ?: 0;
                        if (str_starts_with($f, 'cache_') && str_ends_with($f, '.json')) {
                            $cache_count++;
                            $cache_size += $f_size;
                        } else {
                            $thumbs_count++;
                            $thumbs_size += $f_size;
                        }
                    }
                }
            }

            $mem_current = memory_get_usage(true);
            $mem_peak = memory_get_peak_usage(true);
            $disk_total = @disk_total_space($base_dir) ?: 0;
            $disk_free = @disk_free_space($base_dir) ?: 0;
            $disk_used = max(0, $disk_total - $disk_free);
            $disk_percent = $disk_total > 0 ? round(($disk_used / $disk_total) * 100, 1) : 0;
            $load_avg = function_exists('sys_getloadavg') ? @sys_getloadavg() : null;

            return ['status' => 200, 'data' => [
                'success'     => true,
                'system_info' => [
                    'php_version'          => PHP_VERSION,
                    'php_os'               => PHP_OS_FAMILY . ' (' . PHP_OS . ')',
                    'php_sapi'             => PHP_SAPI,
                    'zend_version'         => zend_version(),
                    'server_software'      => $_SERVER['SERVER_SOFTWARE'] ?? 'PHP CLI / Built-in',
                    'gd_available'         => $has_gd,
                    'gd_webp'              => !empty($gd_info['WebP Support']),
                    'gd_avif'              => !empty($gd_info['AVIF Support']),
                    'exif_available'       => extension_loaded('exif'),
                    'zip_available'        => class_exists('ZipArchive'),
                    'intl_available'       => extension_loaded('intl'),
                    'pdo_available'        => extension_loaded('pdo'),
                    'sqlite_available'     => extension_loaded('pdo_sqlite') || extension_loaded('sqlite3'),
                    'curl_available'       => extension_loaded('curl'),
                    'mbstring_available'   => extension_loaded('mbstring'),
                    'opcache_available'    => extension_loaded('Zend OPcache') || extension_loaded('opcache'),
                    'ffmpeg_available'     => $has_ffmpeg,
                    'upload_max_filesize'  => ini_get('upload_max_filesize'),
                    'post_max_size'        => ini_get('post_max_size'),
                    'memory_limit'         => ini_get('memory_limit'),
                    'memory_current'       => $mem_current,
                    'memory_current_fmt'   => ExifParser::formatBytes($mem_current),
                    'memory_peak'          => $mem_peak,
                    'memory_peak_fmt'      => ExifParser::formatBytes($mem_peak),
                    'disk_total'           => $disk_total,
                    'disk_total_fmt'       => ExifParser::formatBytes((int)$disk_total),
                    'disk_free'            => $disk_free,
                    'disk_free_fmt'        => ExifParser::formatBytes((int)$disk_free),
                    'disk_used'            => $disk_used,
                    'disk_used_fmt'        => ExifParser::formatBytes((int)$disk_used),
                    'disk_used_percent'    => $disk_percent,
                    'cache_count'          => $cache_count,
                    'cache_size'           => $cache_size,
                    'cache_size_fmt'       => ExifParser::formatBytes($cache_size),
                    'thumbs_count'         => $thumbs_count,
                    'thumbs_size'          => $thumbs_size,
                    'thumbs_size_fmt'      => ExifParser::formatBytes($thumbs_size),
                    'server_load'          => $load_avg,
                    'is_admin'             => AuthManager::isAdminLoggedIn()
                ]
            ]];
        }

        if ($action === 'clear_all_caches') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }

            global $thumbnail_dir;
            $storage_dir = CacheManager::getCacheStorageDir($base_dir, $thumbnail_dir ?? '.thumbnails');
            $deleted_count = 0;
            $freed_bytes = 0;

            if (is_dir($storage_dir)) {
                $files = @scandir($storage_dir) ?: [];
                foreach ($files as $f) {
                    if ($f[0] === '.') continue;
                    $f_path = $storage_dir . '/' . $f;
                    if (is_file($f_path)) {
                        $freed_bytes += @filesize($f_path) ?: 0;
                        if (@unlink($f_path)) {
                            $deleted_count++;
                        }
                    }
                }
            }

            return ['status' => 200, 'data' => [
                'success'       => true,
                'deleted_count' => $deleted_count,
                'freed_bytes'   => $freed_bytes,
                'freed_fmt'     => ExifParser::formatBytes($freed_bytes)
            ]];
        }

        if ($action === 'save_desktop_shortcuts') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }

            $shortcuts = $raw_body['shortcuts'] ?? $_POST['shortcuts'] ?? null;
            if (!is_array($shortcuts)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_invalid_data')]];
            }
            $sanitized_shortcuts = \Atelier\Kernel\Auth\UserManager::sanitizeDesktopShortcuts($shortcuts);
            if ($sanitized_shortcuts === null) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_invalid_data')]];
            }

            $curUser = AuthManager::getCurrentUser();
            $reqScope = strtolower(trim((string)($raw_body['scope'] ?? $_POST['scope'] ?? '')));

            // Explicit global template edit (admin only -> `storage/desktop.json` served to guests & new users)
            if ($reqScope === 'global') {
                if (!AuthManager::isAdminLoggedIn()) {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
                }
                $saved = \Atelier\Kernel\Config\ConfigStore::set('desktop', ['shortcuts' => $sanitized_shortcuts], $project_root);
                if ($saved) {
                    return ['status' => 200, 'data' => [
                        'success'   => true,
                        'scope'     => 'global',
                        'shortcuts' => $sanitized_shortcuts,
                        'message'   => 'Global desktop template saved'
                    ]];
                }
                return ['status' => 500, 'data' => ['success' => false, 'error' => 'Failed to save global desktop template']];
            }

            // Multi-user accounts persist their OWN isolated desktop in `users.preferences_json`
            if ($curUser) {
                $res = \Atelier\Kernel\Auth\UserManager::saveUserPreferences($project_root, (int)$curUser['id'], [
                    'desktop' => ['shortcuts' => $sanitized_shortcuts]
                ]);
                if (!empty($res['success'])) {
                    return ['status' => 200, 'data' => [
                        'success'   => true,
                        'scope'     => 'user',
                        'shortcuts' => $sanitized_shortcuts,
                        'message'   => 'Personal desktop shortcuts saved'
                    ]];
                }
                return ['status' => $res['status'] ?? 500, 'data' => $res];
            }

            // Legacy root admin (no `users` row) persists its OWN isolated desktop in `storage/desktop_admin.json`
            // so admin shortcuts never leak onto the anonymous guest desktop (`storage/desktop.json`).
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }

            $saved = \Atelier\Kernel\Config\ConfigStore::set('desktop_admin', ['shortcuts' => $sanitized_shortcuts], $project_root);
            if ($saved) {
                return ['status' => 200, 'data' => [
                    'success'   => true,
                    'scope'     => 'admin',
                    'shortcuts' => $sanitized_shortcuts,
                    'message'   => 'Admin desktop shortcuts saved'
                ]];
            }
            return ['status' => 500, 'data' => ['success' => false, 'error' => 'Failed to save shortcuts']];
        }

        if ($action === 'get_desktop_shortcuts') {
            $reqScope = strtolower(trim((string)($_GET['scope'] ?? $raw_body['scope'] ?? '')));
            if ($reqScope === 'global') {
                $effective = \Atelier\Kernel\Auth\UserManager::getGlobalDesktopTemplate($project_root);
            } else {
                $effective = \Atelier\Kernel\Auth\UserManager::getEffectiveDesktopConfig(
                    $project_root,
                    AuthManager::getCurrentUser(),
                    AuthManager::isAdminLoggedIn()
                );
            }
            return ['status' => 200, 'data' => [
                'success'   => true,
                'scope'     => $effective['scope'],
                'shortcuts' => $effective['shortcuts']
            ]];
        }

        if ($action === 'get_disabled_apps') {
            $disabled = \Atelier\Kernel\PluginDiscovery::getDisabledAppIds($project_root);
            return ['status' => 200, 'data' => ['success' => true, 'disabled_apps' => $disabled]];
        }

        if ($action === 'set_app_enabled') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $app_id = trim((string)($raw_body['app_id'] ?? $_POST['app_id'] ?? ''));
            $enabled = filter_var($raw_body['enabled'] ?? $_POST['enabled'] ?? true, FILTER_VALIDATE_BOOLEAN);

            if ($app_id === '') {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'App ID required']];
            }

            $disabled = \Atelier\Kernel\PluginDiscovery::getDisabledAppIds($project_root);
            if ($enabled) {
                $disabled = array_values(array_filter($disabled, function ($id) use ($app_id) {
                    return $id !== $app_id;
                }));
            } else {
                if (!in_array($app_id, $disabled, true)) {
                    $disabled[] = $app_id;
                }
            }

            $storage_dir = \Atelier\Kernel\Config\ConfigStore::getStorageDir($project_root);
            $saved = @file_put_contents($storage_dir . '/disabled_apps.json', json_encode($disabled, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), LOCK_EX) !== false;

            return ['status' => 200, 'data' => [
                'success'       => $saved,
                'app_id'        => $app_id,
                'enabled'       => $enabled,
                'disabled_apps' => $disabled
            ]];
        }

        if ($action === 'get_wm_styles') {
            $styles = \Atelier\Kernel\PluginDiscovery::getDiscoveredWindowStyles($project_root);
            return ['status' => 200, 'data' => ['success' => true, 'styles' => $styles]];
        }

        // -----------------------------------------------------------------
        // External Standalone Web App Manager (Lot 2 — Admin Only)
        // -----------------------------------------------------------------
        if ($action === 'list_external_apps') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $res = \Atelier\Kernel\ExternalAppManager::listExternalApps($project_root);
            return ['status' => (int)($res['status'] ?? 200), 'data' => $res];
        }

        if ($action === 'install_external_app_zip') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $file = $_FILES['archive'] ?? $_FILES['file'] ?? null;
            if (!$file || !is_array($file) || empty($file['tmp_name']) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'Archive ZIP manquante ou invalide.']];
            }
            $meta = [
                'github_repo'   => trim((string)($raw_body['github_repo'] ?? $_POST['github_repo'] ?? '')),
                'asset_pattern' => trim((string)($raw_body['asset_pattern'] ?? $_POST['asset_pattern'] ?? '')),
                'source_type'   => 'zip'
            ];
            $res = \Atelier\Kernel\ExternalAppManager::installFromZipFile(
                $project_root,
                (string)$file['tmp_name'],
                (string)($file['name'] ?? 'app.zip'),
                $meta
            );
            return ['status' => (int)($res['status'] ?? (!empty($res['success']) ? 200 : 400)), 'data' => $res];
        }

        if ($action === 'install_external_app_url') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $url = trim((string)($raw_body['url'] ?? $_POST['url'] ?? ''));
            $meta = [
                'github_repo'   => trim((string)($raw_body['github_repo'] ?? $_POST['github_repo'] ?? '')),
                'asset_pattern' => trim((string)($raw_body['asset_pattern'] ?? $_POST['asset_pattern'] ?? '')),
                'source_type'   => 'url'
            ];
            $res = \Atelier\Kernel\ExternalAppManager::installFromUrl($project_root, $url, $meta);
            return ['status' => (int)($res['status'] ?? (!empty($res['success']) ? 200 : 400)), 'data' => $res];
        }

        if ($action === 'check_external_app_updates') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $onlyAppId = trim((string)($raw_body['app_id'] ?? $_POST['app_id'] ?? ''));
            $res = \Atelier\Kernel\ExternalAppManager::checkUpdates($project_root, $onlyAppId !== '' ? $onlyAppId : null);
            return ['status' => (int)($res['status'] ?? 200), 'data' => $res];
        }

        if ($action === 'approve_external_app_update') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $appId = trim((string)($raw_body['app_id'] ?? $_POST['app_id'] ?? ''));
            $res = \Atelier\Kernel\ExternalAppManager::approveUpdate($project_root, $appId);
            return ['status' => (int)($res['status'] ?? (!empty($res['success']) ? 200 : 400)), 'data' => $res];
        }

        if ($action === 'dismiss_external_app_update') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $appId = trim((string)($raw_body['app_id'] ?? $_POST['app_id'] ?? ''));
            $res = \Atelier\Kernel\ExternalAppManager::dismissUpdate($project_root, $appId);
            return ['status' => (int)($res['status'] ?? (!empty($res['success']) ? 200 : 400)), 'data' => $res];
        }

        if ($action === 'save_external_app_override') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $appId = trim((string)($raw_body['app_id'] ?? $_POST['app_id'] ?? ''));
            $input = is_array($raw_body['override'] ?? null) ? $raw_body['override'] : $raw_body;
            $res = \Atelier\Kernel\ExternalAppManager::saveOverride($project_root, $appId, $input);
            return ['status' => (int)($res['status'] ?? (!empty($res['success']) ? 200 : 400)), 'data' => $res];
        }

        if ($action === 'uninstall_external_app') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $appId = trim((string)($raw_body['app_id'] ?? $_POST['app_id'] ?? ''));
            $res = \Atelier\Kernel\ExternalAppManager::uninstallApp($project_root, $appId);
            return ['status' => (int)($res['status'] ?? (!empty($res['success']) ? 200 : 400)), 'data' => $res];
        }

        return null;
    }
}
