<?php
/**
 * Atelier by GallusTech - User-to-User Folder Shares, Mounted Volumes, Signed Share Links,
 * ACL Resolution, and Extensible Tagging / Classification / E2EE Crypto Metadata Engine.
 */

namespace Atelier\Kernel\Auth;

use Atelier\Kernel\Config\ConfigStore;
use Atelier\Kernel\Data\AtelierStore;
use Atelier\Kernel\Security\PathValidator;

class ShareManager {

    public const PERMISSION_LEVELS = [
        'none'  => 0,
        'read'  => 1,
        'drop'  => 2,
        'write' => 3,
        'admin' => 4
    ];

    public const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'secret'];

    public static function normalizeRelPath(string $path): string {
        $clean = str_replace('\\', '/', trim($path));
        $clean = trim($clean, '/');
        if ($clean === '.' || $clean === '') return '';
        if (strpos($clean, '..') !== false || strpos($clean, "\0") !== false) {
            return '';
        }
        return $clean;
    }

    /**
     * Checks whether $targetRel is equal to or a descendant of $ancestorRel.
     * Case-insensitive on Windows/macOS to prevent NTFS/APFS case-bypass tricks.
     */
    public static function isPathWithin(string $targetRel, string $ancestorRel): bool {
        $t = self::normalizeRelPath($targetRel);
        $a = self::normalizeRelPath($ancestorRel);
        if ($a === '') return true;
        if (PHP_OS_FAMILY === 'Windows' || PHP_OS_FAMILY === 'Darwin') {
            $t = strtolower($t);
            $a = strtolower($a);
        }
        return ($t === $a) || (strpos($t, $a . '/') === 0);
    }

    /**
     * Resolves the highest permission level ('none'|'read'|'write'|'admin') granted to the
     * current logged-in user (or active share-link session) on $relPath.
     */
    public static function resolveEffectivePathPermission(string $relPath, string $baseDir): string {
        if (AuthManager::isAdminLoggedIn()) {
            return 'admin';
        }

        $rel = self::normalizeRelPath($relPath);
        $projectRoot = ConfigStore::resolveRoot($baseDir);
        $best = 'none';
        $promote = function (string $perm) use (&$best) {
            if ((self::PERMISSION_LEVELS[$perm] ?? 0) > (self::PERMISSION_LEVELS[$best] ?? 0)) {
                $best = $perm;
            }
        };

        $user = AuthManager::getCurrentUser();
        $now = time();

        if ($user) {
            // 1. Personal home directory ownership (full read/write/admin on own space)
            $homeDir = self::normalizeRelPath((string)($user['home_dir'] ?? ('users/' . $user['username'])));
            if ($homeDir !== '' && self::isPathWithin($rel, $homeDir)) {
                return 'admin';
            }

            // 2. Direct & group user_shares (folder mounts)
            $store = AtelierStore::forRoot($projectRoot);
            $userId = (int)$user['id'];
            $groupIds = UserManager::getUserGroupIds($projectRoot, $userId);

            $shares = $store->select('user_shares');
            foreach ($shares as $s) {
                if (!empty($s['expires_at']) && (int)$s['expires_at'] < $now) {
                    continue;
                }
                $matchesTarget =
                    ($s['target_type'] === 'user' && (int)$s['target_id'] === $userId) ||
                    ($s['target_type'] === 'group' && in_array((int)$s['target_id'], $groupIds, true));

                if ($matchesTarget && self::isPathWithin($rel, (string)$s['source_path'])) {
                    $promote((string)($s['permission'] ?? 'read'));
                }
            }

            // 3. Explicit ACL rules
            $acls = $store->select('acl_rules');
            foreach ($acls as $rule) {
                $rulePath = self::normalizeRelPath((string)$rule['path']);
                $matchesPath = !empty($rule['inherit'])
                    ? self::isPathWithin($rel, $rulePath)
                    : ($rel === $rulePath);
                if (!$matchesPath) continue;

                $matchesSubject =
                    ($rule['subject_type'] === 'user' && (int)$rule['subject_id'] === $userId) ||
                    ($rule['subject_type'] === 'group' && in_array((int)$rule['subject_id'], $groupIds, true));
                if ($matchesSubject) {
                    $promote((string)($rule['permission'] ?? 'none'));
                }
            }
        }

        // 4. Active signed share link unlocked in session (supports guests and logged-in users)
        AuthManager::ensureSessionStarted();
        $unlockedLinks = $_SESSION['atelier_unlocked_shares'] ?? [];
        if (is_array($unlockedLinks) && !empty($unlockedLinks)) {
            $store = AtelierStore::forRoot($projectRoot);
            foreach ($unlockedLinks as $token => $grantedAt) {
                $link = $store->selectOne('share_links', ['token' => (string)$token]);
                if (!$link || !empty($link['revoked_at'])) continue;
                if (!empty($link['expires_at']) && (int)$link['expires_at'] < $now) continue;
                if (self::isPathWithin($rel, (string)$link['target_path'])) {
                    // File-drop links grant upload-only ('drop'), NEVER delete/move ('write')
                    $linkPerm = ($link['mode'] === 'drop') ? 'drop' : 'read';
                    $promote($linkPerm);
                }
            }
        }

        return $best;
    }

    public static function canReadPath(string $relPath, string $baseDir): bool {
        $perm = self::resolveEffectivePathPermission($relPath, $baseDir);
        return (self::PERMISSION_LEVELS[$perm] ?? 0) >= self::PERMISSION_LEVELS['read'];
    }

    public static function canUploadPath(string $relPath, string $baseDir): bool {
        $perm = self::resolveEffectivePathPermission($relPath, $baseDir);
        return (self::PERMISSION_LEVELS[$perm] ?? 0) >= self::PERMISSION_LEVELS['drop'];
    }

    public static function canWritePath(string $relPath, string $baseDir): bool {
        $perm = self::resolveEffectivePathPermission($relPath, $baseDir);
        return (self::PERMISSION_LEVELS[$perm] ?? 0) >= self::PERMISSION_LEVELS['write'];
    }

    public static function canManagePath(string $relPath, string $baseDir): bool {
        $perm = self::resolveEffectivePathPermission($relPath, $baseDir);
        return (self::PERMISSION_LEVELS[$perm] ?? 0) >= self::PERMISSION_LEVELS['admin'];
    }

    // -------------------------------------------------------------------------
    // User-to-User Folder Shares & Mounted Volumes (Desktop Disks + Explorer)
    // -------------------------------------------------------------------------

    /**
     * Returns all mounted volumes visible to the current logged-in user
     * (personal home drive + shared folder drives mounted from other users/groups).
     */
    public static function getMountedVolumesForCurrentUser(string $baseDir): array {
        $user = AuthManager::getCurrentUser();
        $projectRoot = ConfigStore::resolveRoot($baseDir);
        $volumes = [];

        if (!$user) {
            // For legacy root admin, expose `users/` shortcut in Explorer bar when user homes exist
            if (AuthManager::isAdminLoggedIn() && is_dir(PathValidator::getUsersRoot($baseDir))) {
                $volumes[] = [
                    'id'              => 'vol-admin-users',
                    'kind'            => 'users_root',
                    'mount_name'      => 'Users',
                    'mount_icon'      => '👥',
                    'path'            => 'users',
                    'permission'      => 'admin',
                    'owner_username'  => 'admin',
                    'owner_name'      => 'Admin',
                    'show_on_desktop' => false,
                    'is_encrypted'    => false
                ];
            }
            if (AuthManager::isAdminLoggedIn()) {
                try {
                    foreach (\Atelier\Kernel\Storage\ExternalMountManager::listAccessibleMounts($projectRoot) as $em) {
                        $volumes[] = [
                            'id'              => 'vol-ext-' . (int)$em['id'],
                            'mount_id'        => (int)$em['id'],
                            'kind'            => 'external',
                            'driver'          => (string)$em['driver'],
                            'mount_name'      => (string)$em['mount_name'],
                            'mount_icon'      => (string)($em['mount_icon'] ?: '☁️'),
                            'path'            => 'ext://' . (int)$em['id'],
                            'permission'      => (string)($em['permission'] ?? 'write'),
                            'owner_username'  => (string)$em['driver'],
                            'owner_name'      => strtoupper((string)$em['driver']),
                            'show_on_desktop' => !empty($em['show_on_desktop']),
                            'is_encrypted'    => false
                        ];
                    }
                } catch (\Throwable $e) {}
            }
            return $volumes;
        }

        $userId = (int)$user['id'];
        $homeDir = self::normalizeRelPath((string)($user['home_dir'] ?? ('users/' . $user['username'])));

        // 1. Personal Home Volume
        $volumes[] = [
            'id'              => 'vol-home-' . $userId,
            'kind'            => 'home',
            'mount_name'      => $user['display_name'] ?: $user['username'],
            'mount_icon'      => '🏠',
            'path'            => $homeDir,
            'permission'      => 'admin',
            'owner_username'  => $user['username'],
            'owner_name'      => $user['display_name'] ?: $user['username'],
            'show_on_desktop' => true,
            'is_encrypted'    => false
        ];

        // 2. Shared Folder Mounts (direct + via groups)
        $store = AtelierStore::forRoot($projectRoot);
        $groupIds = UserManager::getUserGroupIds($projectRoot, $userId);
        $usersMap = [];
        foreach ($store->select('users') as $u) {
            $usersMap[(int)$u['id']] = $u;
        }
        $metaMap = [];
        foreach ($store->select('item_metadata') as $m) {
            $metaMap[(string)$m['item_path']] = $m;
        }

        $now = time();
        $seenPaths = [];
        foreach ($store->select('user_shares', [], ['created_at' => 'DESC']) as $s) {
            if (!empty($s['expires_at']) && (int)$s['expires_at'] < $now) continue;
            $matches =
                ($s['target_type'] === 'user' && (int)$s['target_id'] === $userId) ||
                ($s['target_type'] === 'group' && in_array((int)$s['target_id'], $groupIds, true));
            if (!$matches) continue;

            $src = self::normalizeRelPath((string)$s['source_path']);
            if ($src === '') continue;

            // Keep highest permission if shared both directly and via a group
            if (isset($seenPaths[$src])) {
                $existingIdx = $seenPaths[$src];
                $curLvl = self::PERMISSION_LEVELS[$volumes[$existingIdx]['permission']] ?? 0;
                $newLvl = self::PERMISSION_LEVELS[$s['permission']] ?? 0;
                if ($newLvl > $curLvl) {
                    $volumes[$existingIdx]['permission'] = (string)$s['permission'];
                }
                continue;
            }

            $owner = $usersMap[(int)$s['owner_user_id']] ?? null;
            $meta = $metaMap[$src] ?? null;

            $seenPaths[$src] = count($volumes);
            $volumes[] = [
                'id'              => 'vol-share-' . (int)$s['id'],
                'share_id'        => (int)$s['id'],
                'kind'            => 'shared',
                'target_type'     => (string)$s['target_type'],
                'mount_name'      => (string)($s['mount_name'] ?: basename($src)),
                'mount_icon'      => (string)($s['mount_icon'] ?: '💽'),
                'path'            => $src,
                'permission'      => (string)($s['permission'] ?? 'read'),
                'owner_username'  => $owner ? (string)$owner['username'] : 'admin',
                'owner_name'      => $owner ? (string)($owner['display_name'] ?: $owner['username']) : 'Admin',
                'show_on_desktop' => !empty($s['show_on_desktop']),
                'is_encrypted'    => !empty($meta['is_encrypted']) || !empty($s['crypto_wrapped_key']),
                'classification'  => $meta ? (string)($meta['classification'] ?? 'internal') : 'internal',
                'expires_at'      => isset($s['expires_at']) ? (int)$s['expires_at'] : null
            ];
        }

        // 3. External Cloud & Storage Mounts (`ext://<id>`)
        try {
            $extMounts = \Atelier\Kernel\Storage\ExternalMountManager::listAccessibleMounts($projectRoot);
            foreach ($extMounts as $em) {
                $volumes[] = [
                    'id'              => 'vol-ext-' . (int)$em['id'],
                    'mount_id'        => (int)$em['id'],
                    'kind'            => 'external',
                    'driver'          => (string)$em['driver'],
                    'mount_name'      => (string)$em['mount_name'],
                    'mount_icon'      => (string)($em['mount_icon'] ?: '☁️'),
                    'path'            => 'ext://' . (int)$em['id'],
                    'permission'      => (string)($em['permission'] ?? 'read'),
                    'owner_username'  => (string)$em['driver'],
                    'owner_name'      => strtoupper((string)$em['driver']),
                    'show_on_desktop' => !empty($em['show_on_desktop']),
                    'is_encrypted'    => false
                ];
            }
        } catch (\Throwable $e) {}

        return $volumes;
    }

    public static function createUserShare(string $projectRoot, string $mediaDir, array $input): array {
        $isAdmin = AuthManager::isAdminLoggedIn();
        $currentUser = AuthManager::getCurrentUser();
        if (!$isAdmin && !$currentUser) {
            return ['success' => false, 'status' => 403, 'error' => 'Authentication required.'];
        }

        $sourceRel = self::normalizeRelPath((string)($input['source_path'] ?? ''));
        if ($sourceRel === '') {
            return ['success' => false, 'status' => 400, 'error' => 'A valid folder path is required.'];
        }

        $absTarget = PathValidator::sanitizeDirectory($sourceRel, $mediaDir);
        if ($absTarget === null || !is_dir($absTarget)) {
            return ['success' => false, 'status' => 404, 'error' => 'Target folder does not exist.'];
        }

        // Only Admin or owner of the path can share it
        if (!$isAdmin && !self::canManagePath($sourceRel, $mediaDir)) {
            return ['success' => false, 'status' => 403, 'error' => 'You can only share folders you own.'];
        }

        $targetType = strtolower(trim((string)($input['target_type'] ?? 'user')));
        if (!in_array($targetType, ['user', 'group'], true)) {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid target_type (user or group).'];
        }

        $store = AtelierStore::forRoot($projectRoot);
        $targetId = (int)($input['target_id'] ?? 0);
        if ($targetId <= 0 && !empty($input['target_username']) && $targetType === 'user') {
            $u = UserManager::findByUsername($projectRoot, (string)$input['target_username']);
            $targetId = $u ? (int)$u['id'] : 0;
        }
        if ($targetId <= 0) {
            return ['success' => false, 'status' => 400, 'error' => 'Target user or group not found.'];
        }
        if ($targetType === 'user' && !$store->selectOne('users', ['id' => $targetId])) {
            return ['success' => false, 'status' => 404, 'error' => 'Target user not found.'];
        }
        if ($targetType === 'group' && !$store->selectOne('groups', ['id' => $targetId])) {
            return ['success' => false, 'status' => 404, 'error' => 'Target group not found.'];
        }

        $permission = strtolower(trim((string)($input['permission'] ?? 'read')));
        if (!in_array($permission, ['read', 'write', 'admin'], true)) {
            $permission = 'read';
        }

        $mountName = trim((string)($input['mount_name'] ?? ''));
        if ($mountName === '') {
            $mountName = basename($sourceRel);
        }
        $mountIcon = trim((string)($input['mount_icon'] ?? '💽'));
        if ($mountIcon === '') $mountIcon = '💽';
        $showOnDesktop = isset($input['show_on_desktop']) ? (!empty($input['show_on_desktop']) ? 1 : 0) : 1;
        $expiresAt = !empty($input['expires_at']) ? (int)$input['expires_at'] : null;
        $ownerId = $currentUser ? (int)$currentUser['id'] : 0;

        $id = $store->insert('user_shares', [
            'owner_user_id'      => $ownerId,
            'source_path'        => $sourceRel,
            'mount_name'         => $mountName,
            'mount_icon'         => $mountIcon,
            'target_type'        => $targetType,
            'target_id'          => $targetId,
            'permission'         => $permission,
            'show_on_desktop'    => $showOnDesktop,
            'crypto_wrapped_key' => isset($input['crypto_wrapped_key']) ? (string)$input['crypto_wrapped_key'] : null,
            'created_at'         => time(),
            'expires_at'         => $expiresAt
        ]);

        AuditLogger::log($projectRoot, 'share_create', $sourceRel, 'ok', [
            'share_id'    => $id,
            'target_type' => $targetType,
            'target_id'   => $targetId,
            'permission'  => $permission
        ]);

        return [
            'success' => true,
            'status'  => 200,
            'share'   => $store->selectOne('user_shares', ['id' => (int)$id])
        ];
    }

    public static function listUserShares(string $projectRoot, bool $allForAdmin = false): array {
        $store = AtelierStore::forRoot($projectRoot);
        $currentUser = AuthManager::getCurrentUser();
        $isAdmin = AuthManager::isAdminLoggedIn();

        if ($isAdmin && $allForAdmin) {
            $rows = $store->select('user_shares', [], ['created_at' => 'DESC']);
        } elseif ($currentUser) {
            $rows = $store->select('user_shares', ['owner_user_id' => (int)$currentUser['id']], ['created_at' => 'DESC']);
        } elseif ($isAdmin) {
            $rows = $store->select('user_shares', [], ['created_at' => 'DESC']);
        } else {
            return [];
        }

        $usersMap = [];
        foreach ($store->select('users') as $u) {
            $usersMap[(int)$u['id']] = $u;
        }
        $groupsMap = [];
        foreach ($store->select('groups') as $g) {
            $groupsMap[(int)$g['id']] = $g;
        }

        foreach ($rows as &$r) {
            $owner = $usersMap[(int)$r['owner_user_id']] ?? null;
            $r['owner_name'] = $owner ? ($owner['display_name'] ?: $owner['username']) : 'Admin';
            if ($r['target_type'] === 'user') {
                $t = $usersMap[(int)$r['target_id']] ?? null;
                $r['target_label'] = $t ? ($t['display_name'] ?: $t['username']) : ('#' . $r['target_id']);
            } else {
                $g = $groupsMap[(int)$r['target_id']] ?? null;
                $r['target_label'] = $g ? ($g['display_name'] ?: $g['name']) : ('#' . $r['target_id']);
            }
        }
        return $rows;
    }

    public static function revokeUserShare(string $projectRoot, int $shareId): array {
        $store = AtelierStore::forRoot($projectRoot);
        $share = $store->selectOne('user_shares', ['id' => $shareId]);
        if (!$share) {
            return ['success' => false, 'status' => 404, 'error' => 'Share not found.'];
        }

        $isAdmin = AuthManager::isAdminLoggedIn();
        $user = AuthManager::getCurrentUser();
        if (!$isAdmin && (!$user || (int)$share['owner_user_id'] !== (int)$user['id'])) {
            return ['success' => false, 'status' => 403, 'error' => 'Not authorized to revoke this share.'];
        }

        $store->delete('user_shares', ['id' => $shareId]);
        AuditLogger::log($projectRoot, 'share_revoke', (string)$share['source_path'], 'ok', ['share_id' => $shareId]);
        return ['success' => true, 'status' => 200];
    }

    // -------------------------------------------------------------------------
    // Signed External Share Links (`share_links`)
    // -------------------------------------------------------------------------

    public static function createShareLink(string $projectRoot, string $mediaDir, array $input): array {
        $isAdmin = AuthManager::isAdminLoggedIn();
        $user = AuthManager::getCurrentUser();
        if (!$isAdmin && !$user) {
            return ['success' => false, 'status' => 403, 'error' => 'Authentication required.'];
        }

        $targetRel = self::normalizeRelPath((string)($input['target_path'] ?? ''));
        if ($targetRel === '') {
            return ['success' => false, 'status' => 400, 'error' => 'Target path required.'];
        }

        $abs = PathValidator::sanitizeDirectory($targetRel, $mediaDir);
        if ($abs === null || !is_dir($abs)) {
            $abs = PathValidator::sanitizeFile($targetRel, $mediaDir);
        }
        if ($abs === null || !file_exists($abs)) {
            return ['success' => false, 'status' => 404, 'error' => 'Target path not found.'];
        }
        if (!$isAdmin && !self::canManagePath($targetRel, $mediaDir)) {
            return ['success' => false, 'status' => 403, 'error' => 'Permission denied to share this path.'];
        }

        $mode = strtolower(trim((string)($input['mode'] ?? 'read')));
        if (!in_array($mode, ['read', 'drop', 'gallery'], true)) {
            $mode = 'read';
        }
        $password = (string)($input['password'] ?? '');
        $passwordHash = ($password !== '') ? UserManager::hashPassword($password) : null;
        $expiresAt = !empty($input['expires_at']) ? (int)$input['expires_at'] : null;
        $maxDownloads = !empty($input['max_downloads']) ? max(1, (int)$input['max_downloads']) : null;
        $label = trim((string)($input['label'] ?? basename($targetRel)));
        $token = bin2hex(random_bytes(16));

        $store = AtelierStore::forRoot($projectRoot);
        $id = $store->insert('share_links', [
            'token'          => $token,
            'owner_user_id'  => $user ? (int)$user['id'] : 0,
            'target_path'    => $targetRel,
            'label'          => $label,
            'mode'           => $mode,
            'password_hash'  => $passwordHash,
            'expires_at'     => $expiresAt,
            'max_downloads'  => $maxDownloads,
            'download_count' => 0,
            'allow_zip'      => isset($input['allow_zip']) ? (!empty($input['allow_zip']) ? 1 : 0) : 1,
            'watermark_text' => isset($input['watermark_text']) ? trim((string)$input['watermark_text']) : null,
            'created_at'     => time(),
            'revoked_at'     => null
        ]);

        AuditLogger::log($projectRoot, 'share_link_create', $targetRel, 'ok', ['link_id' => $id, 'mode' => $mode]);
        $row = $store->selectOne('share_links', ['id' => (int)$id]);
        unset($row['password_hash']);
        $row['has_password'] = ($passwordHash !== null);
        return ['success' => true, 'status' => 200, 'link' => $row];
    }

    public static function listShareLinks(string $projectRoot): array {
        $store = AtelierStore::forRoot($projectRoot);
        $isAdmin = AuthManager::isAdminLoggedIn();
        $user = AuthManager::getCurrentUser();
        if (!$isAdmin && !$user) return [];

        $rows = $isAdmin
            ? $store->select('share_links', [], ['created_at' => 'DESC'])
            : $store->select('share_links', ['owner_user_id' => (int)$user['id']], ['created_at' => 'DESC']);

        foreach ($rows as &$r) {
            $r['has_password'] = !empty($r['password_hash']);
            unset($r['password_hash']);
        }
        return $rows;
    }

    public static function revokeShareLink(string $projectRoot, int $linkId): array {
        $store = AtelierStore::forRoot($projectRoot);
        $link = $store->selectOne('share_links', ['id' => $linkId]);
        if (!$link) {
            return ['success' => false, 'status' => 404, 'error' => 'Share link not found.'];
        }
        $isAdmin = AuthManager::isAdminLoggedIn();
        $user = AuthManager::getCurrentUser();
        if (!$isAdmin && (!$user || (int)$link['owner_user_id'] !== (int)$user['id'])) {
            return ['success' => false, 'status' => 403, 'error' => 'Not authorized.'];
        }
        $store->update('share_links', ['revoked_at' => time()], ['id' => $linkId]);
        AuditLogger::log($projectRoot, 'share_link_revoke', (string)$link['target_path'], 'ok', ['link_id' => $linkId]);
        return ['success' => true, 'status' => 200];
    }

    public static function accessShareLink(string $projectRoot, string $token, string $password = ''): array {
        $cleanToken = preg_replace('/[^a-fA-F0-9]/', '', trim($token));
        if ($cleanToken === '') {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid share token.'];
        }
        $store = AtelierStore::forRoot($projectRoot);
        $link = $store->selectOne('share_links', ['token' => $cleanToken]);
        if (!$link || !empty($link['revoked_at'])) {
            return ['success' => false, 'status' => 404, 'error' => 'Share link not found or revoked.'];
        }
        if (!empty($link['expires_at']) && (int)$link['expires_at'] < time()) {
            return ['success' => false, 'status' => 410, 'error' => 'Share link has expired.'];
        }
        if (!empty($link['max_downloads']) && (int)$link['download_count'] >= (int)$link['max_downloads']) {
            return ['success' => false, 'status' => 410, 'error' => 'Share link download limit reached.'];
        }
        if (!empty($link['password_hash'])) {
            if ($password === '' || !password_verify($password, (string)$link['password_hash'])) {
                return ['success' => false, 'status' => 401, 'requires_password' => true, 'error' => 'Password required or invalid.'];
            }
        }

        AuthManager::ensureSessionStarted();
        if (!isset($_SESSION['atelier_unlocked_shares']) || !is_array($_SESSION['atelier_unlocked_shares'])) {
            $_SESSION['atelier_unlocked_shares'] = [];
        }
        $_SESSION['atelier_unlocked_shares'][$cleanToken] = time();

        AuditLogger::log($projectRoot, 'share_link_access', (string)$link['target_path'], 'ok', ['link_id' => (int)$link['id']]);
        return [
            'success'     => true,
            'status'      => 200,
            'target_path' => (string)$link['target_path'],
            'label'       => (string)$link['label'],
            'mode'        => (string)$link['mode']
        ];
    }

    // -------------------------------------------------------------------------
    // Future-Proof Foundation: Tagging, Classification & E2EE Crypto Metadata
    // -------------------------------------------------------------------------

    public static function listTags(string $projectRoot, ?string $namespace = null): array {
        $store = AtelierStore::forRoot($projectRoot);
        $where = ($namespace !== null && $namespace !== '') ? ['namespace' => $namespace] : [];
        return $store->select('tags', $where, ['label' => 'ASC']);
    }

    public static function ensureTag(string $projectRoot, string $label, string $color = '#6366f1', string $namespace = 'general'): array {
        $cleanLabel = trim($label);
        if ($cleanLabel === '') {
            throw new \InvalidArgumentException('Invalid tag label');
        }
        $slug = strtolower(trim((string)preg_replace('/[^a-zA-Z0-9]+/', '-', $cleanLabel), '-'));
        if ($slug === '') {
            $slug = 'tag-' . substr(sha1(mb_strtolower($cleanLabel, 'UTF-8')), 0, 10);
        }
        $store = AtelierStore::forRoot($projectRoot);
        $existing = $store->selectOne('tags', ['slug' => $slug]);
        if ($existing) return $existing;

        $user = AuthManager::getCurrentUser();
        $id = $store->insert('tags', [
            'slug'          => $slug,
            'label'         => $cleanLabel,
            'color'         => $color,
            'namespace'     => $namespace,
            'owner_user_id' => $user ? (int)$user['id'] : null,
            'created_at'    => time()
        ]);
        return $store->selectOne('tags', ['id' => (int)$id]);
    }

    public static function setItemTags(string $projectRoot, string $itemPath, array $tagLabels): array {
        $rel = self::normalizeRelPath($itemPath);
        if ($rel === '') return [];
        $store = AtelierStore::forRoot($projectRoot);
        $store->delete('item_tags', ['item_path' => $rel]);

        $user = AuthManager::getCurrentUser();
        $attached = [];
        foreach ($tagLabels as $lbl) {
            $lbl = trim((string)$lbl);
            if ($lbl === '') continue;
            $tag = self::ensureTag($projectRoot, $lbl);
            $store->insert('item_tags', [
                'item_path'        => $rel,
                'tag_id'           => (int)$tag['id'],
                'added_by_user_id' => $user ? (int)$user['id'] : null,
                'confidence'       => 1.0,
                'created_at'       => time()
            ]);
            $attached[] = $tag;
        }
        return $attached;
    }

    public static function getItemTags(string $projectRoot, string $itemPath): array {
        $rel = self::normalizeRelPath($itemPath);
        if ($rel === '') return [];
        $store = AtelierStore::forRoot($projectRoot);
        $links = $store->select('item_tags', ['item_path' => $rel]);
        if (empty($links)) return [];
        $tags = [];
        foreach ($links as $l) {
            $t = $store->selectOne('tags', ['id' => (int)$l['tag_id']]);
            if ($t) $tags[] = $t;
        }
        return $tags;
    }

    public static function setItemMetadata(string $projectRoot, string $itemPath, array $meta): bool {
        $rel = self::normalizeRelPath($itemPath);
        if ($rel === '') return false;
        $store = AtelierStore::forRoot($projectRoot);
        $existing = $store->selectOne('item_metadata', ['item_path' => $rel]) ?: [];
        $classification = (string)($meta['classification'] ?? $existing['classification'] ?? 'internal');
        if (!in_array($classification, self::CLASSIFICATIONS, true)) {
            $classification = 'internal';
        }
        return $store->upsert('item_metadata', 'item_path', [
            'item_path'        => $rel,
            'classification'   => $classification,
            'is_encrypted'     => isset($meta['is_encrypted']) ? (!empty($meta['is_encrypted']) ? 1 : 0) : (int)($existing['is_encrypted'] ?? 0),
            'crypto_algo'      => $meta['crypto_algo'] ?? ($existing['crypto_algo'] ?? null),
            'crypto_key_id'    => $meta['crypto_key_id'] ?? ($existing['crypto_key_id'] ?? null),
            'crypto_iv'        => $meta['crypto_iv'] ?? ($existing['crypto_iv'] ?? null),
            'crypto_meta_json' => isset($meta['crypto_meta']) ? json_encode($meta['crypto_meta']) : ($existing['crypto_meta_json'] ?? null),
            'custom_json'      => isset($meta['custom']) ? json_encode($meta['custom']) : ($existing['custom_json'] ?? '{}'),
            'updated_at'       => time()
        ]);
    }

    public static function getItemMetadata(string $projectRoot, string $itemPath): ?array {
        $rel = self::normalizeRelPath($itemPath);
        if ($rel === '') return null;
        $store = AtelierStore::forRoot($projectRoot);
        return $store->selectOne('item_metadata', ['item_path' => $rel]);
    }
}
