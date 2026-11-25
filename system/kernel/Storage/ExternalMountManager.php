<?php
/**
 * Atelier by GallusTech - External Cloud & Storage Mount Manager (Phase B)
 * Manages encrypted external storage volumes (`ext://<mount_id>/...`) for:
 *   - WebDAV (Nextcloud, ownCloud, Synology, kDrive)
 *   - S3 / Cloudflare R2 / MinIO / Scaleway / Backblaze B2 (native SigV4)
 *   - Google Drive (OAuth2 REST v3 with silent refresh)
 *   - Local folder mounts (admin-only, sandboxed)
 */

namespace SimpleGallery\Kernel\Storage;

use SimpleGallery\Kernel\Auth\AuditLogger;
use SimpleGallery\Kernel\Auth\AuthManager;
use SimpleGallery\Kernel\Auth\UserManager;
use SimpleGallery\Kernel\Data\AtelierStore;

class ExternalMountManager {

    public const VALID_DRIVERS = ['local', 'webdav', 's3', 'gdrive'];

    private const SECRET_FIELDS = ['password', 'bearer_token', 'secret_key', 'access_token', 'refresh_token', 'client_secret'];

    /**
     * Parses a virtual external path (`ext://<id>` or `ext://<id>/sub/path`).
     * Returns ['mount_id' => int, 'rel_path' => string] or null if not an external mount path.
     */
    public static function parseExternalPath(string $path): ?array {
        $trimmed = trim(str_replace('\\', '/', $path));
        if (stripos($trimmed, 'ext://') !== 0) {
            return null;
        }
        $rest = substr($trimmed, 6);
        $rest = ltrim($rest, '/');
        if ($rest === '') {
            return null;
        }
        $slashPos = strpos($rest, '/');
        if ($slashPos === false) {
            $idStr = $rest;
            $rel = '';
        } else {
            $idStr = substr($rest, 0, $slashPos);
            $rel = trim(substr($rest, $slashPos + 1), '/');
        }
        if (!ctype_digit($idStr) || (int)$idStr <= 0) {
            return null;
        }
        if (strpos($rel, '..') !== false || strpos($rel, "\0") !== false) {
            return null;
        }
        return [
            'mount_id' => (int)$idStr,
            'rel_path' => $rel
        ];
    }

    public static function isExternalPath(string $path): bool {
        return self::parseExternalPath($path) !== null;
    }

    /**
     * Sanitizes mount metadata for API responses (never exposes plaintext secrets).
     */
    public static function sanitizeMountForOutput(string $projectRoot, array $row): array {
        $cfg = CredentialVault::decryptJson($projectRoot, (string)($row['config_enc'] ?? ''));
        $publicCfg = [];
        $hasSecret = false;
        foreach ($cfg as $k => $v) {
            if (in_array($k, self::SECRET_FIELDS, true)) {
                if ($v !== '' && $v !== null) $hasSecret = true;
            } else {
                $publicCfg[$k] = $v;
            }
        }
        return [
            'id'              => (int)$row['id'],
            'owner_user_id'   => isset($row['owner_user_id']) && $row['owner_user_id'] !== null ? (int)$row['owner_user_id'] : null,
            'target_type'     => (string)($row['target_type'] ?? 'user'),
            'target_id'       => (int)($row['target_id'] ?? 0),
            'driver'          => (string)$row['driver'],
            'mount_name'      => (string)$row['mount_name'],
            'mount_icon'      => (string)($row['mount_icon'] ?? '☁️'),
            'permission'      => (string)($row['permission'] ?? 'read'),
            'show_on_desktop' => !empty($row['show_on_desktop']),
            'is_active'       => !empty($row['is_active']),
            'path'            => 'ext://' . (int)$row['id'],
            'config'          => $publicCfg,
            'has_secret'      => $hasSecret,
            'created_at'      => (int)($row['created_at'] ?? 0),
            'updated_at'      => (int)($row['updated_at'] ?? 0)
        ];
    }

    /**
     * Instantiates the StorageDriverInterface for an external mount row.
     */
    public static function buildDriver(string $projectRoot, array $row): ?StorageDriverInterface {
        $driver = strtolower((string)($row['driver'] ?? ''));
        $cfg = CredentialVault::decryptJson($projectRoot, (string)($row['config_enc'] ?? ''));

        switch ($driver) {
            case 'local':
                $root = trim((string)($cfg['root_dir'] ?? ''));
                return $root !== '' ? new LocalFilesystemDriver($root) : null;
            case 'webdav':
                return new WebDavStorageDriver($cfg);
            case 's3':
                return new S3StorageDriver($cfg);
            case 'gdrive':
                $mountId = (int)($row['id'] ?? 0);
                return new GoogleDriveStorageDriver($cfg, function (string $newAccessToken, int $newExpiresAt) use ($projectRoot, $mountId, $cfg) {
                    if ($mountId <= 0) return;
                    $cfg['access_token'] = $newAccessToken;
                    $cfg['expires_at'] = $newExpiresAt;
                    $store = AtelierStore::forRoot($projectRoot);
                    $store->update('external_mounts', [
                        'config_enc' => CredentialVault::encryptJson($projectRoot, $cfg),
                        'updated_at' => time()
                    ], ['id' => $mountId]);
                });
            default:
                return null;
        }
    }

    /**
     * Resolves an external mount if the current user is authorized to access it.
     * Returns ['mount' => array, 'driver' => StorageDriverInterface, 'can_write' => bool] or null.
     */
    public static function resolveMountForCurrentUser(string $projectRoot, int $mountId): ?array {
        $store = AtelierStore::forRoot($projectRoot);
        $row = $store->selectOne('external_mounts', ['id' => $mountId]);
        if (!$row || empty($row['is_active'])) {
            return null;
        }

        $isAdmin = AuthManager::isAdminLoggedIn();
        $user = AuthManager::getCurrentUser();
        $authorized = false;
        $canWrite = false;

        if ($isAdmin) {
            $authorized = true;
            $canWrite = true;
        } elseif ($user && !empty($user['id'])) {
            $uid = (int)$user['id'];
            $ownerId = isset($row['owner_user_id']) && $row['owner_user_id'] !== null ? (int)$row['owner_user_id'] : null;
            $tType = (string)($row['target_type'] ?? 'user');
            $tId = (int)($row['target_id'] ?? 0);

            if ($ownerId === $uid) {
                $authorized = true;
                $canWrite = ((string)($row['permission'] ?? 'write')) === 'write';
            } elseif ($tType === 'global') {
                $authorized = true;
                $canWrite = ((string)($row['permission'] ?? 'read')) === 'write';
            } elseif ($tType === 'user' && $tId === $uid) {
                $authorized = true;
                $canWrite = ((string)($row['permission'] ?? 'read')) === 'write';
            } elseif ($tType === 'group' && $tId > 0) {
                $groupIds = UserManager::getUserGroupIds($projectRoot, $uid);
                if (in_array($tId, $groupIds, true)) {
                    $authorized = true;
                    $canWrite = ((string)($row['permission'] ?? 'read')) === 'write';
                }
            }
        }

        if (!$authorized) {
            return null;
        }

        $driver = self::buildDriver($projectRoot, $row);
        if (!$driver) {
            return null;
        }

        return [
            'mount'     => self::sanitizeMountForOutput($projectRoot, $row),
            'raw'       => $row,
            'driver'    => $driver,
            'can_write' => $canWrite
        ];
    }

    /**
     * Lists all active external mounts visible to the currently authenticated user.
     */
    public static function listAccessibleMounts(string $projectRoot): array {
        $isAdmin = AuthManager::isAdminLoggedIn();
        $user = AuthManager::getCurrentUser();
        if (!$isAdmin && !$user) {
            return [];
        }

        $store = AtelierStore::forRoot($projectRoot);
        $rows = $store->select('external_mounts', [], ['mount_name' => 'ASC']);
        $uid = ($user && !empty($user['id'])) ? (int)$user['id'] : 0;
        $groupIds = $uid > 0 ? UserManager::getUserGroupIds($projectRoot, $uid) : [];
        $out = [];

        foreach ($rows as $row) {
            if (empty($row['is_active'])) continue;
            $ownerId = isset($row['owner_user_id']) && $row['owner_user_id'] !== null ? (int)$row['owner_user_id'] : null;
            $tType = (string)($row['target_type'] ?? 'user');
            $tId = (int)($row['target_id'] ?? 0);

            $visible = $isAdmin
                || ($uid > 0 && $ownerId === $uid)
                || ($tType === 'global')
                || ($tType === 'user' && $uid > 0 && $tId === $uid)
                || ($tType === 'group' && in_array($tId, $groupIds, true));

            if ($visible) {
                $out[] = self::sanitizeMountForOutput($projectRoot, $row);
            }
        }
        return $out;
    }

    /**
     * Creates a new external mount (users can create their own cloud mounts; only admins can create `local` or `global`/`group` mounts).
     */
    public static function createMount(string $projectRoot, array $input): array {
        $isAdmin = AuthManager::isAdminLoggedIn();
        $user = AuthManager::getCurrentUser();
        if (!$isAdmin && !$user) {
            return ['success' => false, 'status' => 403, 'error' => 'Authentication required.'];
        }

        $driver = strtolower(trim((string)($input['driver'] ?? '')));
        if (!in_array($driver, self::VALID_DRIVERS, true)) {
            return ['success' => false, 'status' => 400, 'error' => 'Unsupported storage driver.'];
        }
        if ($driver === 'local' && !$isAdmin) {
            return ['success' => false, 'status' => 403, 'error' => 'Only administrators can create local filesystem mounts.'];
        }

        $mountName = trim((string)($input['mount_name'] ?? ''));
        if ($mountName === '' || strlen($mountName) > 80) {
            return ['success' => false, 'status' => 400, 'error' => 'Valid mount name is required.'];
        }

        $permission = strtolower(trim((string)($input['permission'] ?? 'write')));
        if (!in_array($permission, ['read', 'write'], true)) {
            $permission = 'read';
        }

        $targetType = strtolower(trim((string)($input['target_type'] ?? 'user')));
        $targetId = (int)($input['target_id'] ?? 0);
        if (!$isAdmin) {
            $targetType = 'user';
            $targetId = (int)$user['id'];
        } elseif (!in_array($targetType, ['user', 'group', 'global'], true)) {
            $targetType = 'global';
            $targetId = 0;
        }

        $defaultIcons = ['webdav' => '🌐', 's3' => '🪣', 'gdrive' => '🔺', 'local' => '💾'];
        $icon = trim((string)($input['mount_icon'] ?? ($defaultIcons[$driver] ?? '☁️')));
        $cfg = is_array($input['config'] ?? null) ? $input['config'] : [];

        // Non-admins cannot bypass SSRF protection for private LAN targets
        if (!$isAdmin) {
            unset($cfg['allow_private_lan']);
        }

        $now = time();
        $store = AtelierStore::forRoot($projectRoot);
        $id = $store->insert('external_mounts', [
            'owner_user_id'   => $user ? (int)$user['id'] : null,
            'target_type'     => $targetType,
            'target_id'       => $targetId,
            'driver'          => $driver,
            'mount_name'      => $mountName,
            'mount_icon'      => $icon !== '' ? $icon : '☁️',
            'permission'      => $permission,
            'show_on_desktop' => !array_key_exists('show_on_desktop', $input) || !empty($input['show_on_desktop']) ? 1 : 0,
            'config_enc'      => CredentialVault::encryptJson($projectRoot, $cfg),
            'is_active'       => 1,
            'created_at'      => $now,
            'updated_at'      => $now
        ]);

        $created = $store->selectOne('external_mounts', ['id' => (int)$id]);
        AuditLogger::log($projectRoot, 'external_mount_create', 'ext://' . $id, 'ok', ['driver' => $driver, 'mount_name' => $mountName]);

        return [
            'success' => true,
            'status'  => 200,
            'mount'   => self::sanitizeMountForOutput($projectRoot, $created)
        ];
    }

    public static function deleteMount(string $projectRoot, int $mountId): array {
        $isAdmin = AuthManager::isAdminLoggedIn();
        $user = AuthManager::getCurrentUser();
        $store = AtelierStore::forRoot($projectRoot);
        $row = $store->selectOne('external_mounts', ['id' => $mountId]);
        if (!$row) {
            return ['success' => false, 'status' => 404, 'error' => 'External mount not found.'];
        }
        $ownerId = isset($row['owner_user_id']) && $row['owner_user_id'] !== null ? (int)$row['owner_user_id'] : null;
        if (!$isAdmin && (!$user || (int)$user['id'] !== $ownerId)) {
            return ['success' => false, 'status' => 403, 'error' => 'Permission denied.'];
        }

        $store->delete('external_mounts', ['id' => $mountId]);
        AuditLogger::log($projectRoot, 'external_mount_delete', 'ext://' . $mountId, 'ok', ['mount_name' => $row['mount_name']]);
        return ['success' => true, 'status' => 200];
    }

    public static function testMount(string $projectRoot, int $mountId): array {
        $resolved = self::resolveMountForCurrentUser($projectRoot, $mountId);
        if (!$resolved) {
            return ['success' => false, 'status' => 404, 'error' => 'External mount not found or access denied.'];
        }
        $res = $resolved['driver']->testConnection();
        return [
            'success' => !empty($res['success']),
            'status'  => !empty($res['success']) ? 200 : 502,
            'message' => (string)($res['message'] ?? '')
        ];
    }

    /**
     * Tests an unsaved external mount configuration before persisting it.
     */
    public static function testRawConfig(string $projectRoot, array $input): array {
        $isAdmin = AuthManager::isAdminLoggedIn();
        $user = AuthManager::getCurrentUser();
        if (!$isAdmin && !$user) {
            return ['success' => false, 'status' => 403, 'error' => 'Authentication required.'];
        }
        $driver = strtolower(trim((string)($input['driver'] ?? '')));
        if (!in_array($driver, self::VALID_DRIVERS, true)) {
            return ['success' => false, 'status' => 400, 'error' => 'Unsupported storage driver.'];
        }
        if ($driver === 'local' && !$isAdmin) {
            return ['success' => false, 'status' => 403, 'error' => 'Only administrators can test local filesystem mounts.'];
        }
        $cfg = is_array($input['config'] ?? null) ? $input['config'] : [];
        if (!$isAdmin) {
            unset($cfg['allow_private_lan']);
        }
        $fakeRow = [
            'id'         => 0,
            'driver'     => $driver,
            'config_enc' => CredentialVault::encryptJson($projectRoot, $cfg)
        ];
        $instance = self::buildDriver($projectRoot, $fakeRow);
        if (!$instance) {
            return ['success' => false, 'status' => 400, 'error' => 'Incomplete driver configuration.'];
        }
        $res = $instance->testConnection();
        return [
            'success' => !empty($res['success']),
            'status'  => !empty($res['success']) ? 200 : 502,
            'message' => (string)($res['message'] ?? '')
        ];
    }
}
