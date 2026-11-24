<?php
/**
 * Atelier by GallusTech - Active Sessions Tracking & Remote Revocation (`SessionRegistry`)
 * Tracks per-login session tokens (SHA-256 hashed in `user_sessions`), supports remote
 * revocation by the account owner or administrator, and enforces immediate revocation
 * via `AuthManager::revalidateActiveUser()`.
 */

namespace SimpleGallery\Kernel\Auth;

use SimpleGallery\Kernel\Data\AtelierStore;
use SimpleGallery\Kernel\Security\RateLimiter;

class SessionRegistry {

    public static function hashToken(string $raw): string {
        return hash('sha256', trim($raw));
    }

    /**
     * Registers the current PHP session in `user_sessions` and stores its random token in `$_SESSION`.
     */
    public static function registerCurrentSession(string $projectRoot, ?int $userId, string $username): string {
        AuthManager::ensureSessionStarted();
        $rawToken = bin2hex(random_bytes(24));
        $hash = self::hashToken($rawToken);
        $now = time();
        $ua = substr(trim((string)($_SERVER['HTTP_USER_AGENT'] ?? 'CLI / Browser')), 0, 240);
        $ip = RateLimiter::getClientIp();

        try {
            $store = AtelierStore::forRoot($projectRoot);
            $store->insert('user_sessions', [
                'session_token_hash' => $hash,
                'user_id'            => $userId,
                'username'           => $username,
                'ip_address'         => $ip,
                'user_agent'         => $ua,
                'created_at'         => $now,
                'last_seen_at'       => $now,
                'revoked_at'         => null
            ]);
            $_SESSION['sg_session_token'] = $rawToken;
            $_SESSION['sg_session_touched_at'] = $now;
        } catch (\Throwable $e) {
            // Do not break login if storage fails transiently
        }
        return $rawToken;
    }

    /**
     * Checks whether the current tracked session has been revoked, and updates `last_seen_at`
     * at most once per 60 seconds. Returns false if explicitly revoked.
     */
    public static function validateCurrentSession(string $projectRoot): bool {
        AuthManager::ensureSessionStarted();
        $raw = $_SESSION['sg_session_token'] ?? '';
        if (!is_string($raw) || $raw === '') {
            return true; // Backward-compatible with pre-existing/test sessions without token
        }
        try {
            $store = AtelierStore::forRoot($projectRoot);
            $row = $store->selectOne('user_sessions', ['session_token_hash' => self::hashToken($raw)]);
            if (!$row) {
                return false;
            }
            if (!empty($row['revoked_at'])) {
                return false;
            }
            $now = time();
            $lastTouched = (int)($_SESSION['sg_session_touched_at'] ?? 0);
            if ($now - $lastTouched >= 60) {
                $store->update('user_sessions', ['last_seen_at' => $now], ['id' => (int)$row['id']]);
                $_SESSION['sg_session_touched_at'] = $now;
            }
            return true;
        } catch (\Throwable $e) {
            return true;
        }
    }

    /**
     * Marks the current session as revoked upon logout.
     */
    public static function markCurrentRevoked(string $projectRoot): void {
        AuthManager::ensureSessionStarted();
        $raw = $_SESSION['sg_session_token'] ?? '';
        if (!is_string($raw) || $raw === '') {
            return;
        }
        try {
            $store = AtelierStore::forRoot($projectRoot);
            $row = $store->selectOne('user_sessions', ['session_token_hash' => self::hashToken($raw)]);
            if ($row && empty($row['revoked_at'])) {
                $store->update('user_sessions', ['revoked_at' => time()], ['id' => (int)$row['id']]);
            }
        } catch (\Throwable $e) {}
    }

    /**
     * Lists active (non-revoked) sessions for a specific user or all users (admin view).
     */
    public static function listSessions(string $projectRoot, ?int $userId = null, bool $includeAll = false): array {
        AuthManager::ensureSessionStarted();
        $curHash = !empty($_SESSION['sg_session_token']) ? self::hashToken((string)$_SESSION['sg_session_token']) : '';
        $store = AtelierStore::forRoot($projectRoot);
        $where = $includeAll ? [] : ['user_id' => $userId];
        $rows = $store->select('user_sessions', $where, ['last_seen_at' => 'DESC'], 100);

        $out = [];
        foreach ($rows as $r) {
            if (!empty($r['revoked_at'])) continue;
            $out[] = [
                'id'           => (int)$r['id'],
                'user_id'      => isset($r['user_id']) && $r['user_id'] !== null ? (int)$r['user_id'] : null,
                'username'     => (string)($r['username'] ?? 'admin'),
                'ip_address'   => (string)($r['ip_address'] ?? ''),
                'user_agent'   => (string)($r['user_agent'] ?? ''),
                'device_label' => self::summarizeUserAgent((string)($r['user_agent'] ?? '')),
                'created_at'   => (int)($r['created_at'] ?? 0),
                'last_seen_at' => (int)($r['last_seen_at'] ?? 0),
                'is_current'   => ($curHash !== '' && hash_equals($curHash, (string)($r['session_token_hash'] ?? '')))
            ];
        }
        return $out;
    }

    /**
     * Revokes a specific session by ID (owner or admin only).
     */
    public static function revokeSession(string $projectRoot, int $sessionId, ?int $actorUserId, bool $isAdmin): array {
        $store = AtelierStore::forRoot($projectRoot);
        $row = $store->selectOne('user_sessions', ['id' => $sessionId]);
        if (!$row) {
            return ['success' => false, 'status' => 404, 'error' => 'Session not found.'];
        }
        $ownerId = isset($row['user_id']) && $row['user_id'] !== null ? (int)$row['user_id'] : null;
        if (!$isAdmin && ($actorUserId === null || $ownerId !== $actorUserId)) {
            return ['success' => false, 'status' => 403, 'error' => 'Access denied.'];
        }
        $store->update('user_sessions', ['revoked_at' => time()], ['id' => $sessionId]);
        AuditLogger::log($projectRoot, 'session_revoke', (string)($row['username'] ?? ''), 'ok', ['session_id' => $sessionId]);
        return ['success' => true, 'status' => 200];
    }

    /**
     * Revokes all other active sessions for a user except the current browser session.
     */
    public static function revokeOtherSessions(string $projectRoot, ?int $userId): array {
        AuthManager::ensureSessionStarted();
        $curHash = !empty($_SESSION['sg_session_token']) ? self::hashToken((string)$_SESSION['sg_session_token']) : '';
        $store = AtelierStore::forRoot($projectRoot);
        $rows = $store->select('user_sessions', ['user_id' => $userId]);
        $now = time();
        $count = 0;
        foreach ($rows as $r) {
            if (!empty($r['revoked_at'])) continue;
            if ($curHash !== '' && hash_equals($curHash, (string)($r['session_token_hash'] ?? ''))) continue;
            $store->update('user_sessions', ['revoked_at' => $now], ['id' => (int)$r['id']]);
            $count++;
        }
        AuditLogger::log($projectRoot, 'sessions_revoke_others', '', 'ok', ['revoked_count' => $count]);
        return ['success' => true, 'status' => 200, 'revoked_count' => $count];
    }

    private static function summarizeUserAgent(string $ua): string {
        $browser = 'Browser';
        if (stripos($ua, 'Edg/') !== false) $browser = 'Edge';
        elseif (stripos($ua, 'Firefox/') !== false) $browser = 'Firefox';
        elseif (stripos($ua, 'Chrome/') !== false) $browser = 'Chrome';
        elseif (stripos($ua, 'Safari/') !== false) $browser = 'Safari';
        elseif (stripos($ua, 'CLI') !== false) $browser = 'CLI';

        $os = '';
        if (stripos($ua, 'Windows') !== false) $os = 'Windows';
        elseif (stripos($ua, 'Mac OS') !== false || stripos($ua, 'Macintosh') !== false) $os = 'macOS';
        elseif (stripos($ua, 'Android') !== false) $os = 'Android';
        elseif (stripos($ua, 'iPhone') !== false || stripos($ua, 'iPad') !== false) $os = 'iOS';
        elseif (stripos($ua, 'Linux') !== false) $os = 'Linux';

        return $os !== '' ? "{$browser} · {$os}" : $browser;
    }
}
