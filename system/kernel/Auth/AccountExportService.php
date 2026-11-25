<?php
/**
 * Atelier by GallusTech - Self-Service Account Data Export (Signed Time-Limited ZIP) & Account Deletion Service
 *
 * Security & GDPR guarantees:
 *  - Export ZIPs are written inside `storage/exports/` (protected by `.htaccess` Deny from all).
 *  - Access tokens are stored ONLY as SHA-256 hashes in `auth_tokens` (`type = 'account_export'`).
 *  - Streamed downloads verify exact byte count sent before marking `download_completed_at`.
 *  - Explicit receipt confirmation (`confirmReceipt`) verifies transfer completion and immediately purges the ZIP from disk.
 *  - Expired or confirmed ZIP archives are automatically garbage-collected on every operation.
 *  - Self-account deletion requires current password verification (+ TOTP if 2FA enabled), username confirmation,
 *    and aborts cleanly if pre-deletion export generation fails so users never lose data unexpectedly.
 */

namespace SimpleGallery\Kernel\Auth;

use SimpleGallery\Kernel\Config\ConfigStore;
use SimpleGallery\Kernel\Data\AtelierStore;
use SimpleGallery\Kernel\Mail\Mailer;
use SimpleGallery\Kernel\Security\PathValidator;
use SimpleGallery\Kernel\Security\RateLimiter;

class AccountExportService {

    public const TOKEN_TYPE = 'account_export';
    public const DEFAULT_TTL_HOURS = 24;
    public const MIN_TTL_HOURS = 1;
    public const MAX_TTL_HOURS = 72;

    /**
     * Returns the protected `storage/exports` directory path, ensuring `.htaccess` is present.
     */
    public static function getExportsDir(string $projectRoot): string {
        $dir = rtrim(str_replace('\\', '/', ConfigStore::getStorageDir($projectRoot)), '/') . '/exports';
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        $htaccess = $dir . '/.htaccess';
        if (!file_exists($htaccess)) {
            @file_put_contents($htaccess, "Deny from all\n", LOCK_EX);
        }
        return $dir;
    }

    /**
     * Builds the public base URL (without trailing slash) for export links.
     */
    private static function getBaseUrl(string $projectRoot): string {
        $cfg = AuthSettings::load($projectRoot);
        $configured = rtrim(trim((string)($cfg['public_base_url'] ?? '')), '/');
        if ($configured !== '') {
            return $configured;
        }
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host = $_SERVER['HTTP_HOST'] ?? '';
        if ($host === '') {
            return '';
        }
        $script = str_replace('\\', '/', (string)($_SERVER['SCRIPT_NAME'] ?? ''));
        $basePath = preg_replace('#/(system/endpoints/.*|index\.php)$#', '', $script);
        return $scheme . '://' . $host . rtrim((string)$basePath, '/');
    }

    /**
     * Builds relative & full URLs for a signed export token.
     */
    public static function buildExportUrls(string $projectRoot, string $rawToken): array {
        $enc = rawurlencode($rawToken);
        $relPortal = 'system/endpoints/export.php?token=' . $enc;
        $relDownload = 'system/endpoints/export.php?token=' . $enc . '&download=1';
        $relShort = 'e/' . $enc;
        $base = self::getBaseUrl($projectRoot);

        return [
            'portal_url'   => $base !== '' ? ($base . '/' . $relPortal) : $relPortal,
            'download_url' => $base !== '' ? ($base . '/' . $relDownload) : $relDownload,
            'short_url'    => $base !== '' ? ($base . '/' . $relShort) : $relShort
        ];
    }

    /**
     * Opportunistically deletes expired or already-confirmed export ZIP files from disk.
     */
    public static function purgeExpiredExports(string $projectRoot): int {
        $exportsDir = self::getExportsDir($projectRoot);
        $store = AtelierStore::forRoot($projectRoot);
        $now = time();
        $purged = 0;

        $rows = $store->select('auth_tokens', ['type' => self::TOKEN_TYPE]);
        $activeBasenames = [];

        foreach ($rows as $row) {
            $meta = @json_decode((string)($row['meta_json'] ?? '{}'), true);
            $meta = is_array($meta) ? $meta : [];
            $basename = basename((string)($meta['file_basename'] ?? ''));
            $isExpired = (int)($row['expires_at'] ?? 0) <= $now;
            $isUsed = !empty($row['used_at']);

            if ($isExpired || $isUsed) {
                if ($basename !== '') {
                    $abs = $exportsDir . '/' . $basename;
                    if (is_file($abs) && @unlink($abs)) {
                        $purged++;
                    }
                }
                // Remove old rows after 7 days to keep DB tidy
                if ($isExpired && ($now - (int)($row['expires_at'] ?? 0)) > 604800) {
                    $store->delete('auth_tokens', ['id' => (int)$row['id']]);
                }
            } elseif ($basename !== '') {
                $activeBasenames[$basename] = true;
            }
        }

        // Sweep any orphan .zip older than 72h not tracked by an active token
        if (is_dir($exportsDir)) {
            $files = @scandir($exportsDir) ?: [];
            foreach ($files as $f) {
                if ($f === '.' || $f === '..' || $f === '.htaccess') continue;
                if (!str_ends_with(strtolower($f), '.zip')) continue;
                if (isset($activeBasenames[$f])) continue;
                $abs = $exportsDir . '/' . $f;
                if (is_file($abs) && ($now - (int)@filemtime($abs)) > (self::MAX_TTL_HOURS * 3600)) {
                    if (@unlink($abs)) {
                        $purged++;
                    }
                }
            }
        }

        return $purged;
    }

    /**
     * Generates a ZIP archive of the user's home files + account JSON metadata and issues a signed time-limited token.
     */
    public static function createExport(
        string $projectRoot,
        string $mediaDir,
        array $user,
        int $ttlHours = self::DEFAULT_TTL_HOURS,
        bool $forDeletion = false
    ): array {
        if (!class_exists('\ZipArchive')) {
            return ['success' => false, 'status' => 500, 'error' => 'ZipArchive extension is required to create data exports.'];
        }

        $userId = (int)($user['id'] ?? 0);
        $username = (string)($user['username'] ?? '');
        if ($userId <= 0 || $username === '') {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid user account.'];
        }

        self::purgeExpiredExports($projectRoot);

        $ttl = max(self::MIN_TTL_HOURS, min(self::MAX_TTL_HOURS, $ttlHours));
        $exportsDir = self::getExportsDir($projectRoot);
        $randomSuffix = bin2hex(random_bytes(8));
        $safeUser = preg_replace('/[^a-zA-Z0-9._-]/', '_', $username);
        $fileBasename = 'exp_' . $userId . '_' . date('Ymd_His') . '_' . $randomSuffix . '.zip';
        $zipAbsPath = $exportsDir . '/' . $fileBasename;
        $downloadFilename = 'atelier_export_' . $safeUser . '_' . date('Ymd_His') . '.zip';

        $zip = new \ZipArchive();
        if ($zip->open($zipAbsPath, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            return ['success' => false, 'status' => 500, 'error' => 'Unable to initialize export archive.'];
        }

        $store = AtelierStore::forRoot($projectRoot);
        $dbUser = $store->selectOne('users', ['id' => $userId]) ?: $user;
        $sanitizedProfile = UserManager::sanitizeUserForOutput($dbUser);
        $prefs = UserManager::getUserPreferences($projectRoot, $userId);
        $groupIds = UserManager::getUserGroupIds($projectRoot, $userId);
        $allGroups = UserManager::listGroups($projectRoot);
        $userGroups = [];
        foreach ($allGroups as $g) {
            if (in_array((int)$g['id'], $groupIds, true)) {
                $userGroups[] = [
                    'id'           => (int)$g['id'],
                    'name'         => (string)$g['name'],
                    'display_name' => (string)$g['display_name']
                ];
            }
        }
        $ownedShares = $store->select('user_shares', ['owner_user_id' => $userId]);
        $ownedLinksRaw = $store->select('share_links', ['owner_user_id' => $userId]);
        $ownedLinks = array_map(function ($l) {
            unset($l['password_hash']);
            return $l;
        }, $ownedLinksRaw);

        $accountPayload = [
            'format_version' => 1,
            'exported_at'    => gmdate('c'),
            'profile'        => $sanitizedProfile,
            'preferences'    => $prefs,
            'groups'         => $userGroups,
            'owned_shares'   => $ownedShares,
            'share_links'    => $ownedLinks
        ];

        $zip->addFromString('account_export.json', json_encode($accountPayload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

        // Add user's personal home directory files (excluding internal dotfiles and .thumbnails)
        $usersRoot = PathValidator::getUsersRoot($mediaDir);
        $homeAbs = rtrim(str_replace('\\', '/', $usersRoot), '/') . '/' . $username;
        $fileCount = 0;

        if (is_dir($homeAbs)) {
            $normHome = rtrim(str_replace('\\', '/', realpath($homeAbs) ?: $homeAbs), '/');
            try {
                $iter = new \RecursiveIteratorIterator(
                    new \RecursiveDirectoryIterator($homeAbs, \FilesystemIterator::SKIP_DOTS),
                    \RecursiveIteratorIterator::SELF_FIRST
                );
                foreach ($iter as $item) {
                    $abs = str_replace('\\', '/', $item->getPathname());
                    $rel = (strpos($abs, $normHome . '/') === 0) ? substr($abs, strlen($normHome) + 1) : '';
                    if ($rel === '') continue;

                    // Exclude internal system dotfiles & thumbnail cache
                    $segments = explode('/', $rel);
                    $skip = false;
                    foreach ($segments as $seg) {
                        if ($seg === '.thumbnails' || $seg === '.htaccess' || $seg === '.private' || $seg === '.password') {
                            $skip = true;
                            break;
                        }
                    }
                    if ($skip) continue;

                    if ($item->isDir()) {
                        $zip->addEmptyDir('files/' . $rel);
                    } elseif ($item->isFile() && is_readable($abs)) {
                        $zip->addFile($abs, 'files/' . $rel);
                        $fileCount++;
                    }
                }
            } catch (\Throwable $e) {
                $zip->close();
                @unlink($zipAbsPath);
                return ['success' => false, 'status' => 500, 'error' => 'Failed to pack user files into archive.'];
            }
        }

        $readme = "Atelier by GallusTech — Personal Data Export\n"
            . "============================================\n"
            . "Account   : {$username}\n"
            . "Exported  : " . gmdate('Y-m-d H:i:s') . " UTC\n"
            . "Files     : {$fileCount}\n\n"
            . "Contents:\n"
            . " - account_export.json : Profile, preferences, group memberships & share metadata\n"
            . " - files/              : Complete copy of your personal home directory\n";
        $zip->addFromString('README.txt', $readme);

        if (!$zip->close() || !is_file($zipAbsPath)) {
            @unlink($zipAbsPath);
            return ['success' => false, 'status' => 500, 'error' => 'Failed to finalize export ZIP archive.'];
        }

        $sizeBytes = (int)@filesize($zipAbsPath);
        $sha256 = (string)@hash_file('sha256', $zipAbsPath);
        $now = time();
        $expiresAt = $now + ($ttl * 3600);
        $rawToken = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
        $tokenHash = RegistrationService::hashToken($rawToken);

        $meta = [
            'owner_user_id'            => $userId,
            'username'                 => $username,
            'file_basename'            => $fileBasename,
            'download_filename'        => $downloadFilename,
            'size_bytes'               => $sizeBytes,
            'file_count'               => $fileCount,
            'sha256'                   => $sha256,
            'download_count'           => 0,
            'last_download_started_at' => null,
            'download_completed_at'    => null,
            'receipt_confirmed_at'     => null,
            'created_for_deletion'     => $forDeletion
        ];

        $tokenId = $store->insert('auth_tokens', [
            'user_id'      => $forDeletion ? null : $userId,
            'token_hash'   => $tokenHash,
            'type'         => self::TOKEN_TYPE,
            'target_email' => strtolower(trim((string)($dbUser['email'] ?? ''))),
            'meta_json'    => json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'expires_at'   => $expiresAt,
            'used_at'      => null,
            'created_at'   => $now
        ]);

        $urls = self::buildExportUrls($projectRoot, $rawToken);
        AuditLogger::log($projectRoot, 'account_export_create', 'users/' . $username, 'ok', [
            'export_id'     => (int)$tokenId,
            'size_bytes'    => $sizeBytes,
            'file_count'    => $fileCount,
            'ttl_hours'     => $ttl,
            'for_deletion'  => $forDeletion
        ]);

        return [
            'success' => true,
            'status'  => 200,
            'export'  => [
                'id'                    => (int)$tokenId,
                'token'                 => $rawToken,
                'filename'              => $downloadFilename,
                'size_bytes'            => $sizeBytes,
                'file_count'            => $fileCount,
                'sha256'                => $sha256,
                'created_at'            => $now,
                'expires_at'            => $expiresAt,
                'ttl_hours'             => $ttl,
                'download_count'        => 0,
                'download_completed_at' => null,
                'receipt_confirmed_at'  => null,
                'portal_url'            => $urls['portal_url'],
                'download_url'          => $urls['download_url'],
                'short_url'             => $urls['short_url']
            ]
        ];
    }

    /**
     * Lists active (unexpired, unconfirmed) exports for a logged-in user (never exposes token hashes).
     */
    public static function listUserExports(string $projectRoot, int $userId): array {
        self::purgeExpiredExports($projectRoot);
        $store = AtelierStore::forRoot($projectRoot);
        $exportsDir = self::getExportsDir($projectRoot);
        $rows = $store->select('auth_tokens', ['user_id' => $userId, 'type' => self::TOKEN_TYPE], ['created_at' => 'DESC']);
        $now = time();
        $out = [];

        foreach ($rows as $row) {
            if (!empty($row['used_at']) || (int)($row['expires_at'] ?? 0) <= $now) {
                continue;
            }
            $meta = @json_decode((string)($row['meta_json'] ?? '{}'), true);
            $meta = is_array($meta) ? $meta : [];
            $basename = basename((string)($meta['file_basename'] ?? ''));
            if ($basename === '' || !is_file($exportsDir . '/' . $basename)) {
                continue;
            }
            $out[] = [
                'id'                    => (int)$row['id'],
                'filename'              => (string)($meta['download_filename'] ?? $basename),
                'size_bytes'            => (int)($meta['size_bytes'] ?? 0),
                'file_count'            => (int)($meta['file_count'] ?? 0),
                'sha256'                => (string)($meta['sha256'] ?? ''),
                'created_at'            => (int)($row['created_at'] ?? 0),
                'expires_at'            => (int)($row['expires_at'] ?? 0),
                'download_count'        => (int)($meta['download_count'] ?? 0),
                'download_completed_at' => $meta['download_completed_at'] ?? null,
                'receipt_confirmed_at'  => $meta['receipt_confirmed_at'] ?? null
            ];
        }

        return $out;
    }

    /**
     * Resolves and validates a signed export token for inspection or download.
     */
    public static function inspectByToken(string $projectRoot, string $rawToken): array {
        self::purgeExpiredExports($projectRoot);
        $clean = trim($rawToken);
        if ($clean === '' || strlen($clean) < 16) {
            return ['success' => false, 'status' => 404, 'error' => 'Export link not found.'];
        }

        $store = AtelierStore::forRoot($projectRoot);
        $hash = RegistrationService::hashToken($clean);
        $row = $store->selectOne('auth_tokens', ['token_hash' => $hash, 'type' => self::TOKEN_TYPE]);
        if (!$row) {
            return ['success' => false, 'status' => 404, 'error' => 'Export link not found or revoked.'];
        }

        $meta = @json_decode((string)($row['meta_json'] ?? '{}'), true);
        $meta = is_array($meta) ? $meta : [];

        if (!empty($row['used_at'])) {
            return [
                'success'     => false,
                'status'      => 410,
                'reason'      => 'confirmed_and_purged',
                'confirmed_at'=> (int)$row['used_at'],
                'error'       => 'This export archive was already confirmed as received and permanently removed from the server.'
            ];
        }

        if ((int)($row['expires_at'] ?? 0) <= time()) {
            return [
                'success' => false,
                'status'  => 410,
                'reason'  => 'expired',
                'error'   => 'This export link has expired and its archive has been purged.'
            ];
        }

        $basename = basename((string)($meta['file_basename'] ?? ''));
        $absPath = self::getExportsDir($projectRoot) . '/' . $basename;
        if ($basename === '' || !is_file($absPath)) {
            return [
                'success' => false,
                'status'  => 410,
                'reason'  => 'missing',
                'error'   => 'This export archive is no longer available on disk.'
            ];
        }

        return [
            'success'  => true,
            'status'   => 200,
            'token_id' => (int)$row['id'],
            'abs_path' => $absPath,
            'export'   => [
                'id'                    => (int)$row['id'],
                'username'              => (string)($meta['username'] ?? ''),
                'filename'              => (string)($meta['download_filename'] ?? $basename),
                'size_bytes'            => (int)($meta['size_bytes'] ?? @filesize($absPath)),
                'file_count'            => (int)($meta['file_count'] ?? 0),
                'sha256'                => (string)($meta['sha256'] ?? ''),
                'created_at'            => (int)($row['created_at'] ?? 0),
                'expires_at'            => (int)($row['expires_at'] ?? 0),
                'download_count'        => (int)($meta['download_count'] ?? 0),
                'download_completed_at' => $meta['download_completed_at'] ?? null,
                'receipt_confirmed_at'  => $meta['receipt_confirmed_at'] ?? null
            ]
        ];
    }

    /**
     * Records a completed full-length download transfer for the given export token.
     */
    public static function markDownloadCompleted(string $projectRoot, int $tokenId, int $bytesSent): bool {
        $store = AtelierStore::forRoot($projectRoot);
        $row = $store->selectOne('auth_tokens', ['id' => $tokenId, 'type' => self::TOKEN_TYPE]);
        if (!$row || !empty($row['used_at'])) {
            return false;
        }
        $meta = @json_decode((string)($row['meta_json'] ?? '{}'), true);
        $meta = is_array($meta) ? $meta : [];
        $expected = (int)($meta['size_bytes'] ?? 0);

        $now = time();
        $meta['last_download_started_at'] = $now;
        if ($expected > 0 && $bytesSent >= $expected) {
            $meta['download_count'] = (int)($meta['download_count'] ?? 0) + 1;
            $meta['download_completed_at'] = $now;
        }

        $store->update('auth_tokens', [
            'meta_json' => json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
        ], ['id' => $tokenId]);

        AuditLogger::log($projectRoot, 'account_export_download', 'export:' . $tokenId, 'ok', [
            'username'   => (string)($meta['username'] ?? ''),
            'bytes_sent' => $bytesSent,
            'expected'   => $expected,
            'complete'   => ($expected > 0 && $bytesSent >= $expected)
        ]);

        return ($expected > 0 && $bytesSent >= $expected);
    }

    /**
     * Confirms complete receipt of an export archive (via signed token OR authenticated user + export_id)
     * and immediately purges the temporary ZIP file from disk.
     * By default requires at least one completed download transfer (`download_completed_at`),
     * unless `$discardWithoutDownload` is explicitly set to true.
     */
    public static function confirmReceipt(
        string $projectRoot,
        ?string $rawToken = null,
        ?int $exportId = null,
        ?int $sessionUserId = null,
        bool $discardWithoutDownload = false
    ): array {
        $store = AtelierStore::forRoot($projectRoot);
        $row = null;

        if ($rawToken !== null && trim($rawToken) !== '') {
            $hash = RegistrationService::hashToken($rawToken);
            $row = $store->selectOne('auth_tokens', ['token_hash' => $hash, 'type' => self::TOKEN_TYPE]);
        } elseif ($exportId !== null && $exportId > 0 && $sessionUserId !== null && $sessionUserId > 0) {
            $candidate = $store->selectOne('auth_tokens', ['id' => $exportId, 'type' => self::TOKEN_TYPE]);
            if ($candidate && (int)($candidate['user_id'] ?? 0) === $sessionUserId) {
                $row = $candidate;
            }
        }

        if (!$row) {
            return ['success' => false, 'status' => 404, 'error' => 'Export archive not found.'];
        }

        if (!empty($row['used_at'])) {
            return ['success' => true, 'status' => 200, 'already_confirmed' => true, 'purged' => true];
        }

        $meta = @json_decode((string)($row['meta_json'] ?? '{}'), true);
        $meta = is_array($meta) ? $meta : [];

        if (!$discardWithoutDownload && empty($meta['download_completed_at'])) {
            return [
                'success' => false,
                'status'  => 409,
                'error'   => 'Please complete the archive download before confirming full receipt.'
            ];
        }

        $now = time();
        $meta['receipt_confirmed_at'] = $now;
        $meta['discarded_without_download'] = $discardWithoutDownload;

        $basename = basename((string)($meta['file_basename'] ?? ''));
        $absPath = self::getExportsDir($projectRoot) . '/' . $basename;
        $purged = false;
        if ($basename !== '' && is_file($absPath)) {
            $purged = @unlink($absPath);
        }

        $store->update('auth_tokens', [
            'used_at'   => $now,
            'meta_json' => json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
        ], ['id' => (int)$row['id']]);

        AuditLogger::log($projectRoot, 'account_export_confirmed', 'export:' . (int)$row['id'], 'ok', [
            'username'  => (string)($meta['username'] ?? ''),
            'purged'    => $purged,
            'discarded' => $discardWithoutDownload
        ]);

        return [
            'success'      => true,
            'status'       => 200,
            'confirmed_at' => $now,
            'purged'       => $purged
        ];
    }

    /**
     * Recursively removes a directory strictly inside the validated users root.
     */
    private static function recursiveDeleteDir(string $absDir): bool {
        if (!is_dir($absDir)) {
            return true;
        }
        $items = @scandir($absDir) ?: [];
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            $path = $absDir . '/' . $item;
            if (is_link($path) || is_file($path)) {
                @unlink($path);
            } elseif (is_dir($path)) {
                self::recursiveDeleteDir($path);
            }
        }
        return @rmdir($absDir);
    }

    /**
     * Permanently deletes the currently authenticated user's own account:
     *  - Verifies password (+ 2FA TOTP or recovery code if enabled) + explicit username confirmation
     *  - Prevents deleting the sole active administrator when no legacy admin hash exists
     *  - Optionally generates a signed 24h ZIP export (and emails the link if configured) BEFORE deleting data
     *  - Deletes personal home directory, DB records, active sessions, and logs out
     */
    public static function deleteSelfAccount(
        string $projectRoot,
        string $mediaDir,
        array $sessionUser,
        array $input
    ): array {
        $userId = (int)($sessionUser['id'] ?? 0);
        if ($userId <= 0) {
            return ['success' => false, 'status' => 403, 'error' => 'Authenticated user account required.'];
        }

        $rlKey = 'self_delete_' . $userId . '_' . RateLimiter::getClientIp();
        if (!RateLimiter::check($rlKey, 5, 900)) {
            return ['success' => false, 'status' => 429, 'error' => 'Too many deletion attempts. Please try again later.'];
        }

        $store = AtelierStore::forRoot($projectRoot);
        $dbUser = $store->selectOne('users', ['id' => $userId]);
        if (!$dbUser) {
            return ['success' => false, 'status' => 404, 'error' => 'Account not found.'];
        }

        $username = (string)$dbUser['username'];
        $password = (string)($input['password'] ?? '');
        $confirmUsername = trim((string)($input['confirm_username'] ?? ''));
        $confirmIrreversible = filter_var($input['confirm_irreversible'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $createExport = array_key_exists('create_export', $input)
            ? filter_var($input['create_export'], FILTER_VALIDATE_BOOLEAN)
            : true;
        $ttlHours = (int)($input['ttl_hours'] ?? self::DEFAULT_TTL_HOURS);

        if (!$confirmIrreversible || strcasecmp($confirmUsername, $username) !== 0) {
            return [
                'success' => false,
                'status'  => 400,
                'error'   => 'Please confirm irreversibility and enter your exact username.'
            ];
        }

        if ($password === '' || !password_verify($password, (string)$dbUser['password_hash'])) {
            RateLimiter::increment($rlKey);
            AuditLogger::log($projectRoot, 'account_self_delete', 'users/' . $username, 'failed', ['reason' => 'wrong_password']);
            return ['success' => false, 'status' => 401, 'error' => 'Invalid current password.'];
        }

        // If 2FA is enabled on this account, require a valid TOTP or recovery code
        $has2fa = !empty($dbUser['totp_secret']) && !empty($dbUser['totp_confirmed_at']);
        if ($has2fa) {
            $totpCode = trim((string)($input['totp_code'] ?? ''));
            if ($totpCode === '') {
                return ['success' => false, 'status' => 401, 'requires_2fa' => true, 'error' => '2FA verification code required.'];
            }
            $v = TotpManager::verifyUserSecondFactor($projectRoot, $dbUser, $totpCode);
            if (empty($v['success'])) {
                RateLimiter::increment($rlKey);
                return ['success' => false, 'status' => 401, 'requires_2fa' => true, 'error' => $v['error'] ?? 'Invalid 2FA code.'];
            }
        }

        // Prevent locking out the instance if this is the sole active admin and no legacy admin hash exists
        $role = strtolower((string)($dbUser['role'] ?? 'user'));
        if (in_array($role, ['admin', 'superadmin'], true)) {
            $allUsers = $store->select('users');
            $otherAdmins = 0;
            foreach ($allUsers as $u) {
                if ((int)$u['id'] === $userId) continue;
                if (!empty($u['is_active']) && in_array(strtolower((string)($u['role'] ?? '')), ['admin', 'superadmin'], true)) {
                    $otherAdmins++;
                }
            }
            $hasLegacyAdmin = AuthManager::getPasswordHash('', $mediaDir) !== '';
            if ($otherAdmins === 0 && !$hasLegacyAdmin) {
                return [
                    'success' => false,
                    'status'  => 409,
                    'error'   => 'Cannot delete the sole active administrator account.'
                ];
            }
        }

        RateLimiter::reset($rlKey);

        // 1. Optional pre-deletion ZIP export (aborts deletion if packing fails!)
        $exportData = null;
        if ($createExport) {
            $expRes = self::createExport($projectRoot, $mediaDir, $dbUser, $ttlHours, true);
            if (empty($expRes['success'])) {
                return [
                    'success' => false,
                    'status'  => $expRes['status'] ?? 500,
                    'error'   => 'Account deletion aborted because data export failed: ' . ($expRes['error'] ?? 'Unknown error')
                ];
            }
            $exportData = $expRes['export'];

            // Email the signed download link to the user if an email address is on file
            $userEmail = trim((string)($dbUser['email'] ?? ''));
            if ($userEmail !== '' && filter_var($userEmail, FILTER_VALIDATE_EMAIL)) {
                $expDate = gmdate('Y-m-d H:i', (int)$exportData['expires_at']) . ' UTC';
                $textBody = "Bonjour {$username},\n\n"
                    . "Votre compte Atelier by GallusTech a été supprimé.\n"
                    . "Votre archive de sauvegarde ZIP est disponible jusqu'au {$expDate} :\n"
                    . "Portail de téléchargement & confirmation : {$exportData['portal_url']}\n"
                    . "Téléchargement direct : {$exportData['download_url']}\n"
                    . "Empreinte SHA-256 : {$exportData['sha256']}\n\n"
                    . "Une fois l'archive téléchargée et vérifiée, cliquez sur le bouton de confirmation de réception complète pour purger immédiatement le fichier du serveur.\n";
                Mailer::send($projectRoot, $userEmail, 'Atelier — Archive de sauvegarde de votre compte supprimé', $textBody);
            }
        }

        // 2. Detach any previously created active export tokens so they remain downloadable until TTL/confirmation
        $activeExports = $store->select('auth_tokens', ['user_id' => $userId, 'type' => self::TOKEN_TYPE]);
        foreach ($activeExports as $exRow) {
            if (empty($exRow['used_at']) && (int)($exRow['expires_at'] ?? 0) > time()) {
                $store->update('auth_tokens', ['user_id' => null], ['id' => (int)$exRow['id']]);
            }
        }

        // 3. Remove physical home directory `storage/users/<username>/` safely
        $usersRoot = rtrim(str_replace('\\', '/', PathValidator::getUsersRoot($mediaDir)), '/');
        $safeSlug = UserManager::sanitizeUsername($username);
        if ($safeSlug !== '' && $safeSlug === $username) {
            $homeAbs = $usersRoot . '/' . $safeSlug;
            $realUsersRoot = realpath($usersRoot);
            $realHome = realpath($homeAbs);
            if ($realUsersRoot !== false && $realHome !== false) {
                $normRoot = rtrim(str_replace('\\', '/', $realUsersRoot), '/');
                $normHome = rtrim(str_replace('\\', '/', $realHome), '/');
                if (strpos($normHome, $normRoot . '/') === 0 && $normHome !== $normRoot) {
                    self::recursiveDeleteDir($normHome);
                }
            }
        }

        // 4. Purge active sessions & user database records
        $store->delete('user_sessions', ['user_id' => $userId]);
        UserManager::deleteUser($projectRoot, $userId);
        AuditLogger::log($projectRoot, 'account_self_delete', 'users/' . $username, 'ok', [
            'user_id'       => $userId,
            'export_issued' => $exportData !== null
        ]);

        // 5. Terminate session
        AuthManager::logoutSession($projectRoot);

        return [
            'success'  => true,
            'status'   => 200,
            'deleted'  => true,
            'username' => $username,
            'export'   => $exportData
        ];
    }
}
