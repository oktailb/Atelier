<?php
/**
 * Atelier by GallusTech - Security & GDPR Audit Logger
 */

namespace Atelier\Kernel\Auth;

use Atelier\Kernel\Data\AtelierStore;
use Atelier\Kernel\Security\RateLimiter;

class AuditLogger {

    public static function log(
        string $baseOrRoot,
        string $action,
        string $targetPath = '',
        string $status = 'ok',
        array $details = []
    ): void {
        try {
            $store = AtelierStore::forRoot($baseOrRoot);
            $user = AuthManager::getCurrentUser();
            $store->insert('audit_logs', [
                'user_id'      => $user ? (int)$user['id'] : null,
                'username'     => $user ? (string)$user['username'] : (AuthManager::isAdminLoggedIn() ? 'admin' : 'guest'),
                'action'       => $action,
                'target_path'  => $targetPath,
                'ip_address'   => RateLimiter::getClientIp(),
                'status'       => $status,
                'details_json' => json_encode($details, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '{}',
                'created_at'   => time()
            ]);
        } catch (\Throwable $e) {
            // Never break user flow if audit logging fails
        }
    }

    public static function recent(string $baseOrRoot, int $limit = 50): array {
        $store = AtelierStore::forRoot($baseOrRoot);
        return $store->select('audit_logs', [], ['created_at' => 'DESC', 'id' => 'DESC'], max(1, min($limit, 200)));
    }
}
