<?php
/**
 * SimpleGallery 2026 - Guest Permissions Matrix Manager
 */

namespace SimpleGallery\Kernel\FS;

use SimpleGallery\Kernel\Auth\AuthManager;

class PermissionsManager {
    public const DEFAULT_PERMISSIONS = [
        'can_upload'            => false,
        'can_delete'            => false,
        'can_move'              => false,
        'can_comment'           => false,
        'can_create_folder'     => false,
        'can_download_archive'  => false,
        'can_download_item'     => false,
        'can_use_browser_proxy' => false
    ];

    /**
     * Get path to runtime permissions matrix JSON file (`storage/permissions.json` under resolved root)
     */
    public static function getPermissionsFilePath(string $base_dir): string {
        return \SimpleGallery\Kernel\Config\ConfigStore::getStorageDir($base_dir) . '/permissions.json';
    }

    /**
     * Get default permissions matrix array (honoring config/security.php $default_guest_permissions)
     */
    public static function getDefaultPermissions(): array {
        global $default_guest_permissions;
        if (isset($default_guest_permissions) && is_array($default_guest_permissions)) {
            $filtered = [];
            foreach (self::DEFAULT_PERMISSIONS as $key => $fallback) {
                $filtered[$key] = isset($default_guest_permissions[$key])
                    ? (bool)$default_guest_permissions[$key]
                    : $fallback;
            }
            return $filtered;
        }
        return self::DEFAULT_PERMISSIONS;
    }

    /**
     * Load permissions from runtime storage/permissions.json (with fallback to legacy config/permissions.json)
     */
    public static function loadPermissions(string $base_dir): array {
        $defaults = self::getDefaultPermissions();
        $root = \SimpleGallery\Kernel\Config\ConfigStore::resolveRoot($base_dir);
        $candidates = [
            $root . '/storage/permissions.json',
            $root . '/config/permissions.json'
        ];
        foreach ($candidates as $file) {
            if (file_exists($file)) {
                $json = @file_get_contents($file);
                $perms = json_decode((string)$json, true);
                if (is_array($perms)) {
                    return array_merge($defaults, $perms);
                }
            }
        }
        return $defaults;
    }

    /**
     * Save updated permissions matrix to runtime storage/permissions.json
     */
    public static function savePermissions(string $base_dir, array $permissions): bool {
        $file = self::getPermissionsFilePath($base_dir);
        $dir = dirname($file);
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        $clean = array_merge(self::getDefaultPermissions(), $permissions);
        $payload = json_encode($clean, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        return @file_put_contents($file, $payload, LOCK_EX) !== false;
    }

    /**
     * Check if a given permission is granted to the current user (Admin always returns true).
     * When $target_rel_path is provided, also honors multi-user home ownership & user/group shares.
     */
    public static function hasPermission(string $permission_key, string $base_dir, ?string $target_rel_path = null): bool {
        if (AuthManager::isAdminLoggedIn()) {
            return true;
        }

        if ($target_rel_path !== null) {
            $norm = trim(str_replace('\\', '/', $target_rel_path), '/');
            $is_users_ns = (strcasecmp($norm, 'users') === 0 || stripos($norm, 'users/') === 0);
            $share_perm = \SimpleGallery\Kernel\Auth\ShareManager::resolveEffectivePathPermission($norm, $base_dir);
            $is_acl_governed = $is_users_ns || ($share_perm !== 'none');

            if ($permission_key === 'can_upload') {
                $can_upload = \SimpleGallery\Kernel\Auth\ShareManager::canUploadPath($norm, $base_dir);
                if ($is_acl_governed) {
                    return $can_upload;
                }
                if ($can_upload) {
                    return true;
                }
            } elseif (in_array($permission_key, ['can_delete', 'can_move', 'can_comment', 'can_create_folder'], true)) {
                $can_write = \SimpleGallery\Kernel\Auth\ShareManager::canWritePath($norm, $base_dir);
                if ($is_acl_governed) {
                    // Strict isolation: user homes & shared folders NEVER fall back to the public guest matrix
                    return $can_write;
                }
                if ($can_write) {
                    return true;
                }
            } elseif (in_array($permission_key, ['can_download_item', 'can_download_archive'], true)) {
                $can_read = \SimpleGallery\Kernel\Auth\ShareManager::canReadPath($norm, $base_dir);
                if ($is_acl_governed) {
                    return $can_read;
                }
                if ($can_read) {
                    return true;
                }
            }
        }

        $perms = self::loadPermissions($base_dir);
        return !empty($perms[$permission_key]);
    }
}
