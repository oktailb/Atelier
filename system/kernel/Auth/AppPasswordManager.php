<?php
/**
 * Atelier by GallusTech - Dedicated App Passwords Manager (Phase C — WebDAV / OS Clients)
 *
 * Allows authenticated multi-user accounts (including 2FA-protected accounts) to mint
 * revocable, scoped (`read` or `write`) App Passwords for native OS WebDAV mounts
 * (Windows Explorer, macOS Finder, Nautilus/Dolphin, mobile clients).
 * Plaintext secrets are returned ONCE at creation time and stored strictly hashed (`password_hash`).
 */

namespace SimpleGallery\Kernel\Auth;

use SimpleGallery\Kernel\Data\AtelierStore;
use SimpleGallery\Kernel\Security\RateLimiter;

class AppPasswordManager {

    private const MAX_ACTIVE_PER_USER = 20;

    /**
     * Generates a new App Password for a user. Returns plaintext secret ONCE.
     */
    public static function createForUser(string $projectRoot, int $userId, string $label, string $scope = 'write'): array {
        $store = AtelierStore::forRoot($projectRoot);
        $user = $store->selectOne('users', ['id' => $userId]);
        if (!$user || empty($user['is_active'])) {
            return ['success' => false, 'status' => 404, 'error' => 'Active user account required.'];
        }

        $cleanLabel = trim(preg_replace('/\s+/', ' ', $label));
        if ($cleanLabel === '') {
            $cleanLabel = 'WebDAV Client';
        }
        $cleanLabel = mb_substr($cleanLabel, 0, 80);

        $cleanScope = strtolower(trim($scope)) === 'read' ? 'read' : 'write';

        $existing = $store->select('app_passwords', ['user_id' => $userId]);
        $activeCount = 0;
        foreach ($existing as $row) {
            if (empty($row['revoked_at'])) {
                $activeCount++;
            }
        }
        if ($activeCount >= self::MAX_ACTIVE_PER_USER) {
            return ['success' => false, 'status' => 400, 'error' => 'Maximum active app passwords limit reached (20).'];
        }

        // Format: atlp_<8 hex prefix>_<32 hex secret> (high entropy, easy to copy-paste in OS dialogs)
        $prefix = bin2hex(random_bytes(4));
        $secretBody = bin2hex(random_bytes(16));
        $plainSecret = "atlp_{$prefix}_{$secretBody}";
        $hash = password_hash($plainSecret, PASSWORD_DEFAULT);

        $now = time();
        $id = $store->insert('app_passwords', [
            'user_id'      => $userId,
            'label'        => $cleanLabel,
            'token_prefix' => 'atlp_' . $prefix,
            'secret_hash'  => $hash,
            'scope'        => $cleanScope,
            'created_at'   => $now,
            'last_used_at' => null,
            'revoked_at'   => null
        ]);

        AuditLogger::log($projectRoot, 'app_password_create', 'dav', 'ok', [
            'app_password_id' => $id,
            'label'           => $cleanLabel,
            'scope'           => $cleanScope
        ]);

        return [
            'success'      => true,
            'status'       => 200,
            'app_password' => [
                'id'           => (int)$id,
                'label'        => $cleanLabel,
                'token_prefix' => 'atlp_' . $prefix,
                'scope'        => $cleanScope,
                'created_at'   => $now,
                'last_used_at' => null,
                'secret'       => $plainSecret
            ]
        ];
    }

    /**
     * Lists active (non-revoked) App Passwords for a user (never returns hashes or secrets).
     */
    public static function listForUser(string $projectRoot, int $userId): array {
        $store = AtelierStore::forRoot($projectRoot);
        $rows = $store->select('app_passwords', ['user_id' => $userId], ['created_at' => 'DESC']);
        $out = [];
        foreach ($rows as $row) {
            if (!empty($row['revoked_at'])) continue;
            $out[] = [
                'id'           => (int)$row['id'],
                'label'        => (string)$row['label'],
                'token_prefix' => (string)$row['token_prefix'],
                'scope'        => (string)($row['scope'] ?? 'write'),
                'created_at'   => (int)($row['created_at'] ?? 0),
                'last_used_at' => isset($row['last_used_at']) && $row['last_used_at'] !== null ? (int)$row['last_used_at'] : null
            ];
        }
        return $out;
    }

    /**
     * Revokes an App Password (owner or admin only).
     */
    public static function revoke(string $projectRoot, int $passwordId, ?int $actingUserId, bool $isAdmin = false): array {
        $store = AtelierStore::forRoot($projectRoot);
        $row = $store->selectOne('app_passwords', ['id' => $passwordId]);
        if (!$row || !empty($row['revoked_at'])) {
            return ['success' => false, 'status' => 404, 'error' => 'App password not found.'];
        }
        if (!$isAdmin && ($actingUserId === null || (int)$row['user_id'] !== $actingUserId)) {
            return ['success' => false, 'status' => 403, 'error' => 'Permission denied.'];
        }

        $store->update('app_passwords', ['revoked_at' => time()], ['id' => $passwordId]);
        AuditLogger::log($projectRoot, 'app_password_revoke', 'dav', 'ok', ['app_password_id' => $passwordId]);
        return ['success' => true, 'status' => 200];
    }

    /**
     * Authenticates a Basic Auth (username + app password) pair for WebDAV.
     * Enforces active user account status, revocation check, and per-IP brute-force rate limiting.
     *
     * @return array|null ['user' => array, 'scope' => 'read'|'write', 'app_password_id' => int] or null
     */
    public static function authenticate(string $projectRoot, string $username, string $secret, string $clientIp = ''): ?array {
        $cleanUser = strtolower(trim($username));
        $cleanSecret = trim($secret);
        if ($cleanUser === '' || $cleanSecret === '') {
            return null;
        }

        $rateKey = 'dav_auth_' . md5(($clientIp !== '' ? $clientIp : 'unknown') . '|' . $cleanUser);
        if (!RateLimiter::check($rateKey, 15, 300)) {
            return null;
        }

        $user = UserManager::findByUsername($projectRoot, $cleanUser);
        if (!$user || empty($user['is_active'])) {
            RateLimiter::increment($rateKey);
            return null;
        }

        $store = AtelierStore::forRoot($projectRoot);
        $candidates = $store->select('app_passwords', ['user_id' => (int)$user['id']]);
        foreach ($candidates as $row) {
            if (!empty($row['revoked_at'])) continue;
            $prefix = (string)($row['token_prefix'] ?? '');
            if ($prefix !== '' && strpos($cleanSecret, $prefix . '_') !== 0) {
                continue;
            }
            if (password_verify($cleanSecret, (string)($row['secret_hash'] ?? ''))) {
                $now = time();
                $lastUsed = (int)($row['last_used_at'] ?? 0);
                // Throttle DB write for last_used_at to once per minute
                if ($now - $lastUsed >= 60) {
                    $store->update('app_passwords', ['last_used_at' => $now], ['id' => (int)$row['id']]);
                }
                RateLimiter::reset($rateKey);
                return [
                    'user'            => UserManager::sanitizeUserForOutput($user),
                    'scope'           => (string)($row['scope'] ?? 'write'),
                    'app_password_id' => (int)$row['id']
                ];
            }
        }

        RateLimiter::increment($rateKey);
        return null;
    }
}
