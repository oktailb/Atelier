<?php
namespace SimpleGallery\Kernel\Actions;

use SimpleGallery\Kernel\Config\ConfigStore;
use SimpleGallery\Kernel\PluginDiscovery;

class ActionRouter {

    public const MUTATING_ACTIONS = [
        'change_password',
        'update_dotfile',
        'lock_folder',
        'unlock_folder',
        'logout',
        'login',
        'upload_file',
        'upload_media',
        'create_folder',
        'move_item',
        'copy_item',
        'delete_item',
        'delete_file',
        'delete_folder',
        'save_permissions',
        'edit_image',
        'save_text_file',
        'save_file_content',
        'save_comment',
        'save_folder_settings',
        'save_desktop_shortcuts',
        'save_autostart_settings',
        'set_app_enabled',
        'clear_all_caches',
        // Legacy plugin mutating actions (also auto-discovered dynamically from apps/*/manifest.json)
        'tribune_clear_history',
        'tribune_boards_save',
        'tribune_file_upload',
        'tribune_schedule_post',
        'tribune_schedule_cancel',
        'tribune_post',
        'tribune_proxy_post',
        'tribune_oauth_refresh'
    ];

    /**
     * O(1) Core Kernel Action Map to domain controller classes.
     * Application-specific actions (e.g. tribune_*, browser_proxy) are dynamically discovered
     * from `apps/<id>/manifest.json` (`backend` block) via PluginDiscovery::getDiscoveredBackendActions().
     */
    private const ACTION_MAP = [
        // Gallery & Exploration
        'get_gallery'             => GalleryActions::class,
        'get_metadata'            => GalleryActions::class,
        'get_all_media_flat'      => GalleryActions::class,
        'get_stream_url'          => GalleryActions::class,

        // Auth & System Administration
        'login'                   => AuthActions::class,
        'logout'                  => AuthActions::class,
        'change_password'         => AuthActions::class,
        'get_permissions'         => AuthActions::class,
        'save_permissions'        => AuthActions::class,
        'get_autostart_settings'  => AuthActions::class,
        'save_autostart_settings' => AuthActions::class,

        // System, Telemetry & i18n
        'get_locales'             => SystemActions::class,
        'get_locale'              => SystemActions::class,
        'get_theme'               => SystemActions::class,
        'get_system_info'         => SystemActions::class,
        'clear_all_caches'        => SystemActions::class,
        'save_desktop_shortcuts'  => SystemActions::class,
        'get_desktop_shortcuts'   => SystemActions::class,
        'get_disabled_apps'       => SystemActions::class,
        'set_app_enabled'         => SystemActions::class,
        'get_wm_styles'           => SystemActions::class,

        // Media & Search
        'search'                  => MediaActions::class,
        'search_media'            => MediaActions::class,
        'view_file'               => MediaActions::class,
        'raw_file'                => MediaActions::class,
        'download_archive'        => MediaActions::class,

        // File CRUD & Dotfiles
        'unlock_folder'           => FileActions::class,
        'lock_folder'             => FileActions::class,
        'update_dotfile'          => FileActions::class,
        'save_folder_settings'    => FileActions::class,
        'save_comment'            => FileActions::class,
        'save_text_file'          => FileActions::class,
        'save_file_content'       => FileActions::class,
        'edit_image'              => FileActions::class,
        'delete_item'             => FileActions::class,
        'delete_file'             => FileActions::class,
        'delete_folder'           => FileActions::class,
        'create_folder'           => FileActions::class,
        'upload_file'             => FileActions::class,
        'upload_media'            => FileActions::class,
        'move_item'               => FileActions::class,
        'copy_item'               => FileActions::class
    ];

    /**
     * Returns whether an action requires CSRF validation (checks both Core + plugin-declared mutating actions).
     */
    public static function isMutatingAction(string $action, ?string $project_root = null): bool {
        if (in_array($action, self::MUTATING_ACTIONS, true)) {
            return true;
        }
        $root = $project_root ?: dirname(dirname(dirname(__DIR__)));
        $discovered = PluginDiscovery::getDiscoveredBackendActions($root);
        return in_array($action, $discovered['mutating_actions'] ?? [], true);
    }

    /**
     * Resolves a dynamically discovered plugin backend handler for an action.
     */
    public static function resolvePluginAction(string $action, ?string $project_root = null): ?array {
        $root = $project_root ?: dirname(dirname(dirname(__DIR__)));
        $discovered = PluginDiscovery::getDiscoveredBackendActions($root);
        return $discovered['actions'][$action] ?? null;
    }

    /**
     * Dispatch an incoming API action with O(1) Core & Plugin routing
     */
    public static function dispatch(
        string $action,
        array $raw_body,
        string $base_dir,
        array $ignore_list,
        array $media_types,
        string $gallery_title = 'SimpleGallery',
        string $thumbnail_dir = '.thumbnails',
        string $project_root = ''
    ): ?array {
        $resolved_project_root = ($project_root !== '')
            ? rtrim(str_replace('\\', '/', $project_root), '/')
            : ConfigStore::resolveRoot($base_dir);

        $params = array_merge($_GET, $_POST, $raw_body);
        $context = [
            'project_root'  => $resolved_project_root,
            'base_dir'      => $base_dir,
            'media_dir'     => $base_dir,
            'ignore_list'   => $ignore_list,
            'media_types'   => $media_types,
            'gallery_title' => $gallery_title,
            'thumbnail_dir' => $thumbnail_dir,
            'raw_body'      => $raw_body
        ];

        // 1. Direct O(1) Core Kernel Lookup
        if (isset(self::ACTION_MAP[$action])) {
            $controller = self::ACTION_MAP[$action];
            $res = $controller::handle($action, $params, $context);
            if ($res !== null) {
                return $res;
            }
        }

        // 2. Dynamic Plugin Backend Lookup (declared in apps/<id>/manifest.json)
        $plugin_route = self::resolvePluginAction($action, $resolved_project_root);
        if ($plugin_route !== null) {
            if (!empty($plugin_route['file']) && file_exists($plugin_route['file'])) {
                require_once $plugin_route['file'];
            }
            $controller = $plugin_route['class'];
            if (class_exists($controller) && method_exists($controller, 'handle')) {
                $res = $controller::handle($action, $params, $context);
                if ($res !== null) {
                    return $res;
                }
            }
        }

        // 3. Core Dynamic Fallback Chain
        $controllers = [
            GalleryActions::class,
            AuthActions::class,
            SystemActions::class,
            MediaActions::class,
            FileActions::class
        ];

        foreach ($controllers as $controller) {
            $res = $controller::handle($action, $params, $context);
            if ($res !== null) {
                return $res;
            }
        }

        return null;
    }
}
