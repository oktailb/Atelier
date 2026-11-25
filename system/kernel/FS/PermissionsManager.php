<?php
/**
 * SimpleGallery 2026 / Atelier - 3-Tier Cascading Permissions Matrix Manager
 * Cascade order (for public gallery & global capabilities):
 *   1. Role matrix (`anonymous`, `guest`, `user`) stored in `storage/permissions.json`
 *   2. Group overrides (`groups.permissions_json`, where explicit `deny` beats `allow` across groups)
 *   3. User overrides (`users.permissions_json`, highest precedence: `allow` | `deny`)
 * Administrators (`admin`, `superadmin`, legacy admin) always have full access.
 * User homes (`users/<login>/...`) and shares remain strictly governed by ShareManager ACLs.
 */

namespace SimpleGallery\Kernel\FS;

use SimpleGallery\Kernel\Auth\AuthManager;
use SimpleGallery\Kernel\Config\ConfigStore;
use SimpleGallery\Kernel\Data\AtelierStore;

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

    public const MATRIX_ROLES = ['anonymous', 'guest', 'user'];

    /**
     * Get path to runtime permissions matrix JSON file (`storage/permissions.json` under resolved root)
     */
    public static function getPermissionsFilePath(string $base_dir): string {
        return ConfigStore::getStorageDir($base_dir) . '/permissions.json';
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
     * Sanitizes a boolean permission map against DEFAULT_PERMISSIONS keys.
     */
    private static function sanitizeBooleanMap(array $input, array $fallback): array {
        $out = $fallback;
        foreach (self::DEFAULT_PERMISSIONS as $key => $defaultVal) {
            if (array_key_exists($key, $input)) {
                $out[$key] = (bool)$input[$key];
            }
        }
        return $out;
    }

    /**
     * Sanitizes sparse user/group permission overrides (`allow` | `deny`; `inherit`/empty omitted).
     */
    public static function sanitizeOverrides($raw): array {
        if (is_string($raw)) {
            $decoded = @json_decode($raw, true);
            $raw = is_array($decoded) ? $decoded : [];
        }
        if (!is_array($raw)) {
            return [];
        }
        $clean = [];
        foreach (self::DEFAULT_PERMISSIONS as $key => $_) {
            if (!array_key_exists($key, $raw)) {
                continue;
            }
            $val = $raw[$key];
            if ($val === true || $val === 'allow' || $val === '1' || $val === 1) {
                $clean[$key] = 'allow';
            } elseif ($val === false || $val === 'deny' || $val === '0' || $val === 0) {
                $clean[$key] = 'deny';
            }
            // 'inherit', null, '' -> omitted so lower tier applies
        }
        return $clean;
    }

    public static function decodeOverrides($raw): array {
        return self::sanitizeOverrides($raw);
    }

    /**
     * Reads raw decoded storage/permissions.json (or legacy config/permissions.json).
     */
    private static function readRawConfig(string $base_dir): array {
        $root = ConfigStore::resolveRoot($base_dir);
        $candidates = [
            $root . '/storage/permissions.json',
            $root . '/config/permissions.json'
        ];
        foreach ($candidates as $file) {
            if (file_exists($file)) {
                $json = @file_get_contents($file);
                $decoded = json_decode((string)$json, true);
                if (is_array($decoded)) {
                    return $decoded;
                }
            }
        }
        return [];
    }

    /**
     * Loads the 3-role permission matrices (`anonymous`, `guest`, `user`).
     * Legacy flat files seamlessly hydrate `anonymous`, and `guest`/`user` inherit from `anonymous`
     * unless explicitly customized.
     */
    public static function loadRoleMatrices(string $base_dir): array {
        $defaults = self::getDefaultPermissions();
        $raw = self::readRawConfig($base_dir);

        $topLevel = self::sanitizeBooleanMap($raw, $defaults);
        $rawRoles = (isset($raw['roles']) && is_array($raw['roles'])) ? $raw['roles'] : [];

        $anonymous = isset($rawRoles['anonymous']) && is_array($rawRoles['anonymous'])
            ? self::sanitizeBooleanMap($rawRoles['anonymous'], $topLevel)
            : $topLevel;
        $guest = isset($rawRoles['guest']) && is_array($rawRoles['guest'])
            ? self::sanitizeBooleanMap($rawRoles['guest'], $anonymous)
            : $anonymous;
        $user = isset($rawRoles['user']) && is_array($rawRoles['user'])
            ? self::sanitizeBooleanMap($rawRoles['user'], $anonymous)
            : $anonymous;

        return [
            'anonymous' => $anonymous,
            'guest'     => $guest,
            'user'      => $user
        ];
    }

    /**
     * Backwards-compatible flat loader returning the anonymous/public guest matrix.
     */
    public static function loadPermissions(string $base_dir): array {
        $matrices = self::loadRoleMatrices($base_dir);
        return $matrices['anonymous'];
    }

    /**
     * Saves updated permissions matrix (supports both flat legacy payloads and v2 `roles` payloads).
     */
    public static function savePermissions(string $base_dir, array $permissions): bool {
        $file = self::getPermissionsFilePath($base_dir);
        $dir = dirname($file);
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }

        $existingRaw = self::readRawConfig($base_dir);
        $existingRoles = self::loadRoleMatrices($base_dir);

        if (isset($permissions['roles']) && is_array($permissions['roles'])) {
            $rolesIn = $permissions['roles'];
            $anon = isset($rolesIn['anonymous']) && is_array($rolesIn['anonymous'])
                ? self::sanitizeBooleanMap($rolesIn['anonymous'], $existingRoles['anonymous'])
                : $existingRoles['anonymous'];
            $guest = isset($rolesIn['guest']) && is_array($rolesIn['guest'])
                ? self::sanitizeBooleanMap($rolesIn['guest'], $existingRoles['guest'])
                : $existingRoles['guest'];
            $user = isset($rolesIn['user']) && is_array($rolesIn['user'])
                ? self::sanitizeBooleanMap($rolesIn['user'], $existingRoles['user'])
                : $existingRoles['user'];
        } else {
            // Flat legacy save: update anonymous (and propagate to guest/user only if they weren't separately configured)
            $anon = self::sanitizeBooleanMap($permissions, self::getDefaultPermissions());
            $hadExplicitRoles = isset($existingRaw['roles']) && is_array($existingRaw['roles']);
            $guest = $hadExplicitRoles ? $existingRoles['guest'] : $anon;
            $user = $hadExplicitRoles ? $existingRoles['user'] : $anon;
        }

        // Mirror anonymous keys at top level for 100% legacy compatibility
        $payloadArr = array_merge($anon, [
            'roles' => [
                'anonymous' => $anon,
                'guest'     => $guest,
                'user'      => $user
            ]
        ]);

        $payload = json_encode($payloadArr, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        return @file_put_contents($file, $payload, LOCK_EX) !== false;
    }

    /**
     * Resolves the effective permissions matrix for the given (or active) user via 3-tier cascade:
     *   Admin => all true
     *   Level 1: Role matrix (`anonymous` | `guest` | `user`)
     *   Level 2: Group overrides (explicit `deny` wins over `allow` across multiple groups)
     *   Level 3: User explicit overrides (`allow` | `deny`)
     */
    public static function resolveEffectivePermissions(string $base_dir, ?array $user = null, ?bool $isAdmin = null): array {
        if ($user === null && $isAdmin === null) {
            $user = AuthManager::getCurrentUser();
            $isAdmin = AuthManager::isAdminLoggedIn();
        } elseif ($isAdmin === null) {
            $isAdmin = is_array($user) && in_array($user['role'] ?? '', ['superadmin', 'admin'], true);
        }

        if ($isAdmin || (is_array($user) && in_array($user['role'] ?? '', ['superadmin', 'admin'], true))) {
            $all = [];
            foreach (self::DEFAULT_PERMISSIONS as $k => $_) {
                $all[$k] = true;
            }
            return $all;
        }

        $matrices = self::loadRoleMatrices($base_dir);
        if (!$user || empty($user['id'])) {
            return $matrices['anonymous'];
        }

        $role = strtolower((string)($user['role'] ?? 'user'));
        $effective = ($role === 'guest') ? $matrices['guest'] : $matrices['user'];

        $root = ConfigStore::resolveRoot($base_dir);
        $userId = (int)$user['id'];

        try {
            $store = AtelierStore::forRoot($root);

            // Level 2: Group overrides (deny beats allow if user belongs to multiple groups)
            $memberships = $store->select('group_members', ['user_id' => $userId]);
            if (!empty($memberships)) {
                $groupAgg = [];
                foreach ($memberships as $m) {
                    $gid = (int)($m['group_id'] ?? 0);
                    if ($gid <= 0) continue;
                    $grp = $store->selectOne('groups', ['id' => $gid]);
                    if (!$grp || empty($grp['permissions_json'])) continue;
                    $gOverrides = self::decodeOverrides($grp['permissions_json']);
                    foreach ($gOverrides as $k => $decision) {
                        if ($decision === 'deny') {
                            $groupAgg[$k] = 'deny';
                        } elseif ($decision === 'allow' && ($groupAgg[$k] ?? '') !== 'deny') {
                            $groupAgg[$k] = 'allow';
                        }
                    }
                }
                foreach ($groupAgg as $k => $decision) {
                    $effective[$k] = ($decision === 'allow');
                }
            }

            // Level 3: User explicit overrides (highest precedence — always read fresh from store for live enforcement)
            $userOverrides = [];
            $dbUser = $store->selectOne('users', ['id' => $userId]);
            if ($dbUser && !empty($dbUser['permissions_json'])) {
                $userOverrides = self::decodeOverrides($dbUser['permissions_json']);
            } elseif (isset($user['permission_overrides']) && is_array($user['permission_overrides'])) {
                $userOverrides = self::sanitizeOverrides($user['permission_overrides']);
            }
            foreach ($userOverrides as $k => $decision) {
                $effective[$k] = ($decision === 'allow');
            }
        } catch (\Throwable $e) {
            // Fall back safely to role matrix if store is unavailable
        }

        return $effective;
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
                    // Strict isolation: user homes & shared folders NEVER fall back to the public/role matrix
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

        $effective = self::resolveEffectivePermissions($base_dir);
        return !empty($effective[$permission_key]);
    }
}
