<?php
/**
 * Atelier by GallusTech - Multi-User & Group Management Service
 * Manages users, groups, group memberships, Argon2id/BCRYPT password hashing,
 * isolated personal home directories (`users/<username>`), and quotas.
 */

namespace SimpleGallery\Kernel\Auth;

use SimpleGallery\Kernel\Config\ConfigStore;
use SimpleGallery\Kernel\Data\AtelierStore;
use SimpleGallery\Kernel\FS\CacheManager;
use SimpleGallery\Kernel\Security\PathValidator;

class UserManager {

    public const VALID_ROLES = ['superadmin', 'admin', 'user', 'guest'];

    public static function hashPassword(string $password): string {
        $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
        return password_hash($password, $algo);
    }

    public static function sanitizeUsername(string $raw): string {
        $slug = strtolower(trim($raw));
        $slug = preg_replace('/[^a-z0-9._-]/', '', $slug);
        $slug = trim((string)$slug, '.-_');
        return (string)$slug;
    }

    public static function sanitizeUserForOutput(?array $user): ?array {
        if (!$user) return null;
        $hasConfirmed2fa = !empty($user['totp_secret']) && !empty($user['totp_confirmed_at']);
        return [
            'id'                => (int)$user['id'],
            'username'          => (string)$user['username'],
            'display_name'      => (string)($user['display_name'] ?? $user['username']),
            'email'             => (string)($user['email'] ?? ''),
            'email_verified'    => !empty($user['email_verified_at']),
            'email_verified_at' => isset($user['email_verified_at']) && $user['email_verified_at'] !== null ? (int)$user['email_verified_at'] : null,
            'approval_status'   => (string)($user['approval_status'] ?? 'approved'),
            'role'              => (string)($user['role'] ?? 'user'),
            'home_dir'          => (string)($user['home_dir'] ?? ('users/' . $user['username'])),
            'quota_bytes'       => (int)($user['quota_bytes'] ?? 0),
            'is_active'         => !empty($user['is_active']),
            'has_2fa'              => $hasConfirmed2fa,
            'totp_pending'         => !empty($user['totp_secret']) && empty($user['totp_confirmed_at']),
            'has_e2ee_key'         => !empty($user['public_key']),
            'permission_overrides' => \SimpleGallery\Kernel\FS\PermissionsManager::decodeOverrides($user['permissions_json'] ?? null),
            'created_at'           => (int)($user['created_at'] ?? 0),
            'last_login_at'        => isset($user['last_login_at']) ? (int)$user['last_login_at'] : null
        ];
    }

    /**
     * Ensures dedicated `storage/users/` root and `storage/users/<username>/` home directory
     * exist (cleanly separated from public `storage/media/`) and are private by default.
     */
    public static function ensureUserHomeDir(string $mediaDir, string $username, string $displayName = ''): string {
        $relHome = 'users/' . $username;
        $realBase = rtrim(str_replace('\\', '/', $mediaDir), '/');
        if ($realBase === '') {
            return $relHome;
        }

        $usersRoot = PathValidator::getUsersRoot($realBase);
        if (!is_dir($usersRoot)) {
            @mkdir($usersRoot, 0755, true);
        }
        if (!file_exists($usersRoot . '/.htaccess')) {
            @file_put_contents($usersRoot . '/.htaccess', "Deny from all\n", LOCK_EX);
        }
        if (!file_exists($usersRoot . '/.private')) {
            @file_put_contents($usersRoot . '/.private', "1\n", LOCK_EX);
        }
        if (!file_exists($usersRoot . '/.title')) {
            @file_put_contents($usersRoot . '/.title', "Users\n", LOCK_EX);
        }

        $homeAbs = $usersRoot . '/' . $username;
        if (!is_dir($homeAbs)) {
            @mkdir($homeAbs, 0755, true);
        }
        if (!file_exists($homeAbs . '/.private')) {
            @file_put_contents($homeAbs . '/.private', "1\n", LOCK_EX);
        }
        if (!file_exists($homeAbs . '/.title')) {
            $title = $displayName !== '' ? $displayName : ucfirst($username);
            @file_put_contents($homeAbs . '/.title', $title . "\n", LOCK_EX);
        }

        // Invalidate Explorer directory cache for users/ and the new home so it appears immediately
        if (class_exists(CacheManager::class)) {
            $thumbDir = isset($GLOBALS['thumbnail_dir']) ? (string)$GLOBALS['thumbnail_dir'] : '.thumbnails';
            CacheManager::invalidateDirCache($usersRoot, $realBase, $thumbDir);
            CacheManager::invalidateDirCache($homeAbs, $realBase, $thumbDir);
        }

        return $relHome;
    }

    /**
     * Recursively calculates total bytes used inside a directory (excluding `.thumbnails`).
     */
    public static function computeDirectorySize(string $absDir): int {
        if (!is_dir($absDir)) {
            return 0;
        }
        $total = 0;
        $normBase = rtrim(str_replace('\\', '/', realpath($absDir) ?: $absDir), '/');
        try {
            $iter = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($absDir, \FilesystemIterator::SKIP_DOTS)
            );
            foreach ($iter as $file) {
                $p = str_replace('\\', '/', $file->getPathname());
                $rel = (strpos($p, $normBase) === 0) ? substr($p, strlen($normBase)) : $p;
                if (strpos($rel, '/.thumbnails/') !== false) {
                    continue;
                }
                if ($file->isFile()) {
                    $total += (int)$file->getSize();
                }
            }
        } catch (\Throwable $e) {}
        return $total;
    }

    /**
     * Computes disk quota usage metrics for a given user account.
     */
    public static function getUserQuotaInfo(string $projectRoot, string $mediaDir, array $user): array {
        $username = (string)($user['username'] ?? '');
        $quotaBytes = max(0, (int)($user['quota_bytes'] ?? 0));
        $usersRoot = PathValidator::getUsersRoot($mediaDir);
        $homeAbs = $username !== '' ? ($usersRoot . '/' . $username) : '';
        $usedBytes = ($homeAbs !== '' && is_dir($homeAbs)) ? self::computeDirectorySize($homeAbs) : 0;
        $percent = $quotaBytes > 0 ? min(100, round(($usedBytes / $quotaBytes) * 100, 1)) : 0;
        return [
            'used_bytes'      => $usedBytes,
            'quota_bytes'     => $quotaBytes,
            'remaining_bytes' => $quotaBytes > 0 ? max(0, $quotaBytes - $usedBytes) : null,
            'percent'         => $percent,
            'is_limited'      => $quotaBytes > 0
        ];
    }

    public static function listUsers(string $baseOrRoot): array {
        $store = AtelierStore::forRoot($baseOrRoot);
        $rows = $store->select('users', [], ['username' => 'ASC']);
        return array_values(array_map([self::class, 'sanitizeUserForOutput'], $rows));
    }

    public static function findById(string $baseOrRoot, int $id): ?array {
        $store = AtelierStore::forRoot($baseOrRoot);
        return $store->selectOne('users', ['id' => $id]);
    }

    public static function findByUsername(string $baseOrRoot, string $username): ?array {
        $slug = self::sanitizeUsername($username);
        if ($slug === '') return null;
        $store = AtelierStore::forRoot($baseOrRoot);
        return $store->selectOne('users', ['username' => $slug]);
    }

    public static function findByEmail(string $baseOrRoot, string $email): ?array {
        $needle = strtolower(trim($email));
        if ($needle === '' || strpos($needle, '@') === false) {
            return null;
        }
        $store = AtelierStore::forRoot($baseOrRoot);
        $rows = $store->select('users');
        foreach ($rows as $row) {
            if (strtolower(trim((string)($row['email'] ?? ''))) === $needle) {
                return $row;
            }
        }
        return null;
    }

    public static function createUser(string $projectRoot, string $mediaDir, array $input): array {
        $username = self::sanitizeUsername((string)($input['username'] ?? ''));
        $password = (string)($input['password'] ?? '');
        $displayName = trim((string)($input['display_name'] ?? $username));
        $email = strtolower(trim((string)($input['email'] ?? '')));
        $role = strtolower(trim((string)($input['role'] ?? 'user')));
        $quotaBytes = max(0, (int)($input['quota_bytes'] ?? 0));
        $isActive = array_key_exists('is_active', $input) ? (!empty($input['is_active']) ? 1 : 0) : 1;
        $approvalStatus = in_array($input['approval_status'] ?? 'approved', ['approved', 'pending', 'rejected'], true)
            ? (string)($input['approval_status'] ?? 'approved')
            : 'approved';
        $emailVerifiedAt = array_key_exists('email_verified_at', $input)
            ? ($input['email_verified_at'] !== null ? (int)$input['email_verified_at'] : null)
            : ($email !== '' && $isActive === 1 ? time() : null);
        $createHome = array_key_exists('create_home', $input) ? (bool)$input['create_home'] : ($isActive === 1);

        if ($username === '' || strlen($username) < 2 || strlen($username) > 40) {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid username (2-40 chars, a-z0-9._-).'];
        }
        if (in_array($username, ['shared', 'public', 'private', 'system', 'storage'], true)) {
            return ['success' => false, 'status' => 400, 'error' => 'Reserved username.'];
        }
        if (strlen($password) < 6) {
            return ['success' => false, 'status' => 400, 'error' => 'Password must be at least 6 characters.'];
        }
        if (!in_array($role, self::VALID_ROLES, true)) {
            $role = 'user';
        }

        $store = AtelierStore::forRoot($projectRoot);
        if ($store->selectOne('users', ['username' => $username]) !== null) {
            return ['success' => false, 'status' => 409, 'error' => 'Username already exists.'];
        }

        $now = time();
        $homeDir = $createHome
            ? self::ensureUserHomeDir($mediaDir, $username, $displayName)
            : ('users/' . $username);

        $id = $store->insert('users', [
            'username'                 => $username,
            'display_name'             => $displayName !== '' ? $displayName : $username,
            'email'                    => $email,
            'email_verified_at'        => $emailVerifiedAt,
            'approval_status'          => $approvalStatus,
            'password_hash'            => self::hashPassword($password),
            'role'                     => $role,
            'home_dir'                 => $homeDir,
            'quota_bytes'              => $quotaBytes,
            'is_active'                => $isActive,
            'totp_secret'              => null,
            'totp_confirmed_at'        => null,
            'totp_recovery_codes_json' => null,
            'totp_last_step'           => null,
            'public_key'               => null,
            'key_salt'                 => null,
            'preferences_json'         => '{}',
            'permissions_json'         => '{}',
            'created_at'               => $now,
            'updated_at'               => $now,
            'last_login_at'            => null
        ]);

        $created = self::findById($projectRoot, (int)$id);
        AuditLogger::log($projectRoot, 'user_create', $homeDir, 'ok', ['username' => $username, 'role' => $role]);

        return [
            'success' => true,
            'status'  => 200,
            'user'    => self::sanitizeUserForOutput($created)
        ];
    }

    public static function updateUser(string $projectRoot, int $userId, array $input): array {
        $store = AtelierStore::forRoot($projectRoot);
        $existing = $store->selectOne('users', ['id' => $userId]);
        if (!$existing) {
            return ['success' => false, 'status' => 404, 'error' => 'User not found.'];
        }

        $patch = ['updated_at' => time()];
        if (isset($input['display_name'])) {
            $dn = trim((string)$input['display_name']);
            if ($dn !== '') $patch['display_name'] = $dn;
        }
        if (isset($input['email'])) {
            $patch['email'] = trim((string)$input['email']);
        }
        if (isset($input['role'])) {
            $role = strtolower(trim((string)$input['role']));
            if (in_array($role, self::VALID_ROLES, true)) {
                $patch['role'] = $role;
            }
        }
        if (isset($input['quota_bytes'])) {
            $patch['quota_bytes'] = max(0, (int)$input['quota_bytes']);
        }
        if (isset($input['is_active'])) {
            $patch['is_active'] = !empty($input['is_active']) ? 1 : 0;
        }
        if (array_key_exists('permission_overrides', $input)) {
            $cleanOv = \SimpleGallery\Kernel\FS\PermissionsManager::sanitizeOverrides($input['permission_overrides']);
            $patch['permissions_json'] = json_encode($cleanOv, JSON_UNESCAPED_SLASHES);
        }
        if (!empty($input['password'])) {
            $pwd = (string)$input['password'];
            if (strlen($pwd) < 6) {
                return ['success' => false, 'status' => 400, 'error' => 'Password must be at least 6 characters.'];
            }
            $patch['password_hash'] = self::hashPassword($pwd);
        }

        $store->update('users', $patch, ['id' => $userId]);
        AuditLogger::log($projectRoot, 'user_update', (string)$existing['home_dir'], 'ok', ['user_id' => $userId]);

        return [
            'success' => true,
            'status'  => 200,
            'user'    => self::sanitizeUserForOutput(self::findById($projectRoot, $userId))
        ];
    }

    public static function deleteUser(string $projectRoot, int $userId): array {
        $store = AtelierStore::forRoot($projectRoot);
        $existing = $store->selectOne('users', ['id' => $userId]);
        if (!$existing) {
            return ['success' => false, 'status' => 404, 'error' => 'User not found.'];
        }

        // Clean up memberships, shares, links & tokens owned/targeting this user
        $store->delete('group_members', ['user_id' => $userId]);
        $store->delete('user_shares', ['owner_user_id' => $userId]);
        $store->delete('user_shares', ['target_type' => 'user', 'target_id' => $userId]);
        $store->delete('share_links', ['owner_user_id' => $userId]);
        $store->delete('auth_tokens', ['user_id' => $userId]);
        $store->delete('users', ['id' => $userId]);

        AuditLogger::log($projectRoot, 'user_delete', (string)$existing['home_dir'], 'ok', ['username' => $existing['username']]);
        return ['success' => true, 'status' => 200];
    }

    /**
     * Authenticates a user by username (or email) + password and returns sanitized user array on success, or null.
     * Also returns raw status via `authenticateDetailed()` for 2FA/pending-verification flows.
     */
    public static function authenticateDetailed(string $projectRoot, string $identifier, string $password): array {
        $rawId = trim($identifier);
        $user = self::findByUsername($projectRoot, $rawId);
        if (!$user && strpos($rawId, '@') !== false) {
            $user = self::findByEmail($projectRoot, $rawId);
        }
        if (!$user) {
            return ['ok' => false, 'reason' => 'invalid_credentials'];
        }
        if (!password_verify($password, (string)$user['password_hash'])) {
            return ['ok' => false, 'reason' => 'invalid_credentials'];
        }
        if (empty($user['is_active'])) {
            $approval = (string)($user['approval_status'] ?? 'approved');
            if ($approval === 'rejected') {
                return ['ok' => false, 'reason' => 'account_rejected'];
            }
            if (empty($user['email_verified_at']) && !empty($user['email'])) {
                return ['ok' => false, 'reason' => 'email_unverified', 'email' => (string)$user['email']];
            }
            if ($approval === 'pending') {
                return ['ok' => false, 'reason' => 'pending_approval'];
            }
            return ['ok' => false, 'reason' => 'account_disabled'];
        }

        return [
            'ok'   => true,
            'raw'  => $user,
            'user' => self::sanitizeUserForOutput($user)
        ];
    }

    public static function authenticate(string $projectRoot, string $username, string $password): ?array {
        $res = self::authenticateDetailed($projectRoot, $username, $password);
        if (empty($res['ok'])) {
            return null;
        }
        $user = $res['raw'];
        $store = AtelierStore::forRoot($projectRoot);
        $now = time();
        $store->update('users', ['last_login_at' => $now], ['id' => (int)$user['id']]);
        $user['last_login_at'] = $now;

        return self::sanitizeUserForOutput($user);
    }

    // -------------------------------------------------------------------------
    // Groups & Memberships
    // -------------------------------------------------------------------------

    public static function listGroups(string $projectRoot): array {
        $store = AtelierStore::forRoot($projectRoot);
        $groups = $store->select('groups', [], ['name' => 'ASC']);
        $members = $store->select('group_members');
        $byGroup = [];
        foreach ($members as $m) {
            $gid = (int)$m['group_id'];
            $byGroup[$gid][] = (int)$m['user_id'];
        }
        foreach ($groups as &$g) {
            $gid = (int)$g['id'];
            $g['id'] = $gid;
            $g['member_ids'] = $byGroup[$gid] ?? [];
            $g['permission_overrides'] = \SimpleGallery\Kernel\FS\PermissionsManager::decodeOverrides($g['permissions_json'] ?? null);
        }
        return $groups;
    }

    public static function getUserGroupIds(string $projectRoot, int $userId): array {
        $store = AtelierStore::forRoot($projectRoot);
        $rows = $store->select('group_members', ['user_id' => $userId]);
        $ids = [];
        foreach ($rows as $r) {
            $ids[] = (int)$r['group_id'];
        }
        return array_values(array_unique($ids));
    }

    public static function createGroup(string $projectRoot, array $input): array {
        $name = self::sanitizeUsername((string)($input['name'] ?? ''));
        $displayName = trim((string)($input['display_name'] ?? $name));
        $description = trim((string)($input['description'] ?? ''));

        if ($name === '' || strlen($name) < 2 || strlen($name) > 40) {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid group name.'];
        }

        $store = AtelierStore::forRoot($projectRoot);
        if ($store->selectOne('groups', ['name' => $name]) !== null) {
            return ['success' => false, 'status' => 409, 'error' => 'Group already exists.'];
        }

        $id = $store->insert('groups', [
            'name'             => $name,
            'display_name'     => $displayName !== '' ? $displayName : $name,
            'description'      => $description,
            'permissions_json' => '{}',
            'created_at'       => time()
        ]);

        AuditLogger::log($projectRoot, 'group_create', 'group:' . $name, 'ok', ['group_id' => $id]);
        return [
            'success' => true,
            'status'  => 200,
            'group'   => [
                'id'                   => (int)$id,
                'name'                 => $name,
                'display_name'         => $displayName !== '' ? $displayName : $name,
                'description'          => $description,
                'member_ids'           => [],
                'permission_overrides' => []
            ]
        ];
    }

    public static function setGroupPermissions(string $projectRoot, int $groupId, $overrides): array {
        $store = AtelierStore::forRoot($projectRoot);
        $group = $store->selectOne('groups', ['id' => $groupId]);
        if (!$group) {
            return ['success' => false, 'status' => 404, 'error' => 'Group not found.'];
        }
        $clean = \SimpleGallery\Kernel\FS\PermissionsManager::sanitizeOverrides($overrides);
        $store->update('groups', [
            'permissions_json' => json_encode($clean, JSON_UNESCAPED_SLASHES)
        ], ['id' => $groupId]);
        AuditLogger::log($projectRoot, 'group_permissions_update', 'group:' . $group['name'], 'ok', ['overrides' => $clean]);
        return [
            'success'              => true,
            'status'               => 200,
            'group_id'             => $groupId,
            'permission_overrides' => $clean
        ];
    }

    public static function setUserPermissions(string $projectRoot, int $userId, $overrides): array {
        $store = AtelierStore::forRoot($projectRoot);
        $user = $store->selectOne('users', ['id' => $userId]);
        if (!$user) {
            return ['success' => false, 'status' => 404, 'error' => 'User not found.'];
        }
        $clean = \SimpleGallery\Kernel\FS\PermissionsManager::sanitizeOverrides($overrides);
        $store->update('users', [
            'permissions_json' => json_encode($clean, JSON_UNESCAPED_SLASHES),
            'updated_at'       => time()
        ], ['id' => $userId]);
        AuditLogger::log($projectRoot, 'user_permissions_update', (string)($user['home_dir'] ?? $user['username']), 'ok', ['user_id' => $userId, 'overrides' => $clean]);
        return [
            'success'              => true,
            'status'               => 200,
            'user_id'              => $userId,
            'permission_overrides' => $clean
        ];
    }

    public static function setGroupMembers(string $projectRoot, int $groupId, array $userIds): array {
        $store = AtelierStore::forRoot($projectRoot);
        $group = $store->selectOne('groups', ['id' => $groupId]);
        if (!$group) {
            return ['success' => false, 'status' => 404, 'error' => 'Group not found.'];
        }

        $store->delete('group_members', ['group_id' => $groupId]);
        $cleanIds = array_values(array_unique(array_filter(array_map('intval', $userIds), function ($v) { return $v > 0; })));
        $now = time();
        foreach ($cleanIds as $uid) {
            if ($store->selectOne('users', ['id' => $uid]) !== null) {
                $store->insert('group_members', [
                    'group_id' => $groupId,
                    'user_id'  => $uid,
                    'role'     => 'member',
                    'added_at' => $now
                ]);
            }
        }

        AuditLogger::log($projectRoot, 'group_members_update', 'group:' . $group['name'], 'ok', ['member_ids' => $cleanIds]);
        return ['success' => true, 'status' => 200, 'member_ids' => $cleanIds];
    }

    public static function deleteGroup(string $projectRoot, int $groupId): array {
        $store = AtelierStore::forRoot($projectRoot);
        $group = $store->selectOne('groups', ['id' => $groupId]);
        if (!$group) {
            return ['success' => false, 'status' => 404, 'error' => 'Group not found.'];
        }
        $store->delete('group_members', ['group_id' => $groupId]);
        $store->delete('user_shares', ['target_type' => 'group', 'target_id' => $groupId]);
        $store->delete('groups', ['id' => $groupId]);

        AuditLogger::log($projectRoot, 'group_delete', 'group:' . $group['name'], 'ok');
        return ['success' => true, 'status' => 200];
    }

    // -------------------------------------------------------------------------
    // Per-User Preferences & Isolated Personal Desktop (`users.preferences_json`)
    // -------------------------------------------------------------------------

    public static function sanitizeDesktopShortcuts(array $shortcuts): ?array {
        if (count($shortcuts) > 100) {
            return null;
        }
        $sanitized = [];
        foreach ($shortcuts as $item) {
            if (!is_array($item)) {
                return null;
            }
            foreach (['url', 'icon', 'icon_url', 'target', 'path'] as $field) {
                if (isset($item[$field]) && is_string($item[$field])) {
                    $val = trim($item[$field]);
                    if (preg_match('/^\s*(javascript|vbscript|data\s*:\s*text\/html)\s*:/i', $val) || strpos($val, '..') !== false) {
                        return null;
                    }
                }
            }
            $sanitized[] = $item;
        }
        return $sanitized;
    }

    public static function getUserPreferences(string $projectRoot, int $userId): array {
        $row = self::findById($projectRoot, $userId);
        if (!$row || empty($row['preferences_json'])) {
            return [];
        }
        $decoded = @json_decode((string)$row['preferences_json'], true);
        return is_array($decoded) ? $decoded : [];
    }

    public static function saveUserPreferences(string $projectRoot, int $userId, array $patch): array {
        $store = AtelierStore::forRoot($projectRoot);
        $row = $store->selectOne('users', ['id' => $userId]);
        if (!$row) {
            return ['success' => false, 'status' => 404, 'error' => 'User not found.'];
        }

        $current = [];
        if (!empty($row['preferences_json'])) {
            $decoded = @json_decode((string)$row['preferences_json'], true);
            if (is_array($decoded)) {
                $current = $decoded;
            }
        }

        $allowedScalarKeys = ['theme', 'wallpaper', 'window_style', 'locale', 'explorer_view_mode'];
        foreach ($allowedScalarKeys as $k) {
            if (array_key_exists($k, $patch)) {
                if ($patch[$k] === null || $patch[$k] === '') {
                    unset($current[$k]);
                } elseif (is_string($patch[$k])) {
                    $val = trim($patch[$k]);
                    if (strlen($val) <= 512 && !preg_match('/^\s*javascript\s*:/i', $val)) {
                        $current[$k] = $val;
                    }
                }
            }
        }

        if (isset($patch['desktop']) && is_array($patch['desktop'])) {
            if (isset($patch['desktop']['shortcuts']) && is_array($patch['desktop']['shortcuts'])) {
                $clean = self::sanitizeDesktopShortcuts($patch['desktop']['shortcuts']);
                if ($clean === null) {
                    return ['success' => false, 'status' => 400, 'error' => 'Invalid desktop shortcuts payload.'];
                }
                $current['desktop'] = ['shortcuts' => $clean];
            }
        }

        if (isset($patch['default_apps']) && is_array($patch['default_apps'])) {
            $cleanDefaults = [];
            foreach ($patch['default_apps'] as $rawExt => $rawAppId) {
                if (count($cleanDefaults) >= 64) break;
                $ext = strtolower(ltrim(trim((string)$rawExt), '.'));
                if (!preg_match('/^[a-z0-9]{1,12}$/', $ext)) continue;
                if ($rawAppId === null || $rawAppId === '') continue;
                $appId = trim((string)$rawAppId);
                if (!preg_match('/^[a-zA-Z0-9._-]{1,64}$/', $appId)) continue;
                $cleanDefaults[$ext] = $appId;
            }
            if (empty($cleanDefaults)) {
                unset($current['default_apps']);
            } else {
                $current['default_apps'] = $cleanDefaults;
            }
        }

        if (isset($patch['app_data']) && is_array($patch['app_data'])) {
            $appData = is_array($current['app_data'] ?? null) ? $current['app_data'] : [];
            foreach ($patch['app_data'] as $appKey => $val) {
                $cleanKey = preg_replace('/[^a-zA-Z0-9._-]/', '', (string)$appKey);
                if ($cleanKey === '' || strlen($cleanKey) > 64) continue;
                if ($val === null) {
                    unset($appData[$cleanKey]);
                } else {
                    $appData[$cleanKey] = $val;
                }
            }
            $current['app_data'] = $appData;
        }

        $encoded = json_encode($current, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($encoded === false || strlen($encoded) > 131072) {
            return ['success' => false, 'status' => 413, 'error' => 'User preferences exceed 128 KB limit.'];
        }

        $store->update('users', [
            'preferences_json' => $encoded,
            'updated_at'       => time()
        ], ['id' => $userId]);

        return [
            'success'     => true,
            'status'      => 200,
            'preferences' => $current
        ];
    }

    /**
     * Returns the instance-wide default desktop template (`storage/desktop.json`) used by guests
     * and as the initial layout for new accounts.
     */
    public static function getGlobalDesktopTemplate(string $projectRoot): array {
        $global = ConfigStore::get('desktop', ['shortcuts' => []], $projectRoot);
        $shortcuts = (is_array($global) && isset($global['shortcuts']) && is_array($global['shortcuts']))
            ? $global['shortcuts']
            : (is_array($global) ? $global : []);
        return [
            'shortcuts' => $shortcuts,
            'scope'     => 'global'
        ];
    }

    /**
     * Returns the effective desktop shortcuts config for the current session:
     *  - Multi-user account (`$user['id']`): personal desktop (`users.preferences_json`) or global template fallback
     *  - Legacy root admin (`!$user && $isAdmin`): isolated `storage/desktop_admin.json` or global template fallback
     *  - Anonymous guest: strictly `storage/desktop.json` (never sees admin or user shortcuts)
     */
    public static function getEffectiveDesktopConfig(string $projectRoot, ?array $user = null, ?bool $isAdmin = null): array {
        if ($user && !empty($user['id'])) {
            $prefs = self::getUserPreferences($projectRoot, (int)$user['id']);
            if (isset($prefs['desktop']['shortcuts']) && is_array($prefs['desktop']['shortcuts'])) {
                return [
                    'shortcuts' => $prefs['desktop']['shortcuts'],
                    'scope'     => 'user'
                ];
            }
            return self::getGlobalDesktopTemplate($projectRoot);
        }

        $resolvedAdmin = ($isAdmin !== null) ? $isAdmin : AuthManager::isAdminLoggedIn();
        if ($resolvedAdmin) {
            $adminDesk = ConfigStore::get('desktop_admin', null, $projectRoot);
            if (is_array($adminDesk) && isset($adminDesk['shortcuts']) && is_array($adminDesk['shortcuts'])) {
                return [
                    'shortcuts' => $adminDesk['shortcuts'],
                    'scope'     => 'admin'
                ];
            }
        }

        return self::getGlobalDesktopTemplate($projectRoot);
    }
}
