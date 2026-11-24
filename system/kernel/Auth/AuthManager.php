<?php
/**
 * SimpleGallery 2026 - Authentication & Access Manager
 */

namespace SimpleGallery\Kernel\Auth;

use SimpleGallery\Kernel\Security\PathValidator;

class AuthManager {
    /**
     * Ensure session is started with secure cookie parameters and optional custom save path
     */
    public static function ensureSessionStarted(?string $session_save_path = null): void {
        if (session_status() === PHP_SESSION_NONE) {
            if ($session_save_path !== null && $session_save_path !== '' && is_dir($session_save_path) && is_writable($session_save_path)) {
                @session_save_path($session_save_path);
            }

            $is_https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
                || (isset($_SERVER['SERVER_PORT']) && $_SERVER['SERVER_PORT'] == 443)
                || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https');

            if (!headers_sent()) {
                session_set_cookie_params([
                    'lifetime' => 0,
                    'path'     => '/',
                    'domain'   => '',
                    'secure'   => $is_https,
                    'httponly' => true,
                    'samesite' => 'Lax'
                ]);
            }
            @session_start();
        }
    }

    /**
     * Check if currently logged in as administrator (legacy admin OR multi-user admin/superadmin)
     */
    public static function isAdminLoggedIn(): bool {
        self::ensureSessionStarted();
        if ((!empty($_SESSION['sg_admin_logged']) && $_SESSION['sg_admin_logged'] === true)
            || (!empty($_SESSION['is_admin']) && $_SESSION['is_admin'] === true)) {
            return true;
        }
        $user = $_SESSION['sg_user'] ?? null;
        if (is_array($user) && in_array($user['role'] ?? '', ['superadmin', 'admin'], true)) {
            return true;
        }
        return false;
    }

    /**
     * Returns the sanitized currently logged-in multi-user account, or null if guest/legacy-only.
     */
    public static function getCurrentUser(): ?array {
        self::ensureSessionStarted();
        $user = $_SESSION['sg_user'] ?? null;
        return (is_array($user) && !empty($user['id']) && !empty($user['username'])) ? $user : null;
    }

    /**
     * Returns true if either a multi-user account or legacy admin is authenticated.
     */
    public static function isLoggedIn(): bool {
        return self::isAdminLoggedIn() || (self::getCurrentUser() !== null);
    }

    /**
     * Stores an authenticated multi-user session (and sets admin flags when role is admin/superadmin).
     */
    public static function loginUserSession(array $sanitizedUser, ?string $projectRoot = null): void {
        self::ensureSessionStarted();
        if (PHP_SAPI !== 'cli' && session_status() === PHP_SESSION_ACTIVE && !headers_sent()) {
            @session_regenerate_id(true);
        }
        $_SESSION['sg_user'] = $sanitizedUser;
        $isAdmin = in_array($sanitizedUser['role'] ?? '', ['superadmin', 'admin'], true);
        $_SESSION['sg_admin_logged'] = $isAdmin;
        $_SESSION['is_admin'] = $isAdmin;
        if ($projectRoot !== null && $projectRoot !== '') {
            SessionRegistry::registerCurrentSession($projectRoot, isset($sanitizedUser['id']) ? (int)$sanitizedUser['id'] : null, (string)($sanitizedUser['username'] ?? 'user'));
        }
    }

    /**
     * Clears both legacy admin, multi-user session state, and any unlocked private folders/share links.
     */
    public static function logoutSession(?string $projectRoot = null): void {
        self::ensureSessionStarted();
        if ($projectRoot !== null && $projectRoot !== '') {
            SessionRegistry::markCurrentRevoked($projectRoot);
        }
        unset(
            $_SESSION['sg_admin_logged'],
            $_SESSION['is_admin'],
            $_SESSION['sg_user'],
            $_SESSION['sg_2fa_pending'],
            $_SESSION['sg_session_token'],
            $_SESSION['sg_session_touched_at'],
            $_SESSION['sg_oidc_state'],
            $_SESSION['sg_unlocked_folders'],
            $_SESSION['unlocked_dirs'],
            $_SESSION['sg_unlocked_shares']
        );
        if (PHP_SAPI !== 'cli' && session_status() === PHP_SESSION_ACTIVE && !headers_sent()) {
            @session_regenerate_id(true);
        }
    }

    /**
     * Re-validates the active session against persistent storage on every request:
     * immediately revokes sessions for disabled, deleted, or remotely revoked sessions and syncs role changes.
     */
    public static function revalidateActiveUser(string $baseOrRoot): void {
        self::ensureSessionStarted();
        if (!empty($_SESSION['sg_session_token']) && !SessionRegistry::validateCurrentSession($baseOrRoot)) {
            self::logoutSession();
            return;
        }
        $sessionUser = $_SESSION['sg_user'] ?? null;
        if (!is_array($sessionUser) || empty($sessionUser['id'])) {
            return;
        }
        try {
            $dbUser = UserManager::findById($baseOrRoot, (int)$sessionUser['id']);
            if (!$dbUser || empty($dbUser['is_active'])) {
                self::logoutSession();
                return;
            }
            $fresh = UserManager::sanitizeUserForOutput($dbUser);
            $_SESSION['sg_user'] = $fresh;
            $isAdmin = in_array($fresh['role'] ?? '', ['superadmin', 'admin'], true);
            $_SESSION['sg_admin_logged'] = $isAdmin;
            $_SESSION['is_admin'] = $isAdmin;
        } catch (\Throwable $e) {
            // Do not crash if storage is temporarily unavailable
        }
    }

    /**
     * Alias for isAdminLoggedIn
     */
    public static function isAdmin(): bool {
        return self::isAdminLoggedIn();
    }

    /**
     * Get administrator password hash from .admin_password_hash or config fallback
     */
    public static function getPasswordHash(string $legacy_hash = '', string $base_dir = ''): string {
        global $project_root, $admin_password_hash;
        $root = $project_root ?? dirname(__DIR__, 3);
        $candidates = array_unique(array_filter([
            $root . '/.admin_password_hash',
            $base_dir ? $base_dir . '/.admin_password_hash' : null,
            $root . '/storage/.admin_password_hash',
            $root . '/storage/media/.admin_password_hash',
            $root . '/config/.admin_password_hash'
        ]));

        foreach ($candidates as $hash_file) {
            if (file_exists($hash_file)) {
                $content = trim((string)@file_get_contents($hash_file));
                if (!empty($content)) {
                    return $content;
                }
            }
        }

        if (!empty($admin_password_hash)) {
            return $admin_password_hash;
        }

        return $legacy_hash;
    }

    /**
     * Update admin password hash in .admin_password_hash
     */
    public static function updatePasswordHash(string $new_password, string $base_dir = ''): bool {
        global $project_root, $admin_password_hash;
        $root = $project_root ?? dirname(__DIR__, 3);
        $hash_file = $root . '/.admin_password_hash';

        $new_hash = password_hash($new_password, PASSWORD_DEFAULT);
        $written = @file_put_contents($hash_file, $new_hash . PHP_EOL, LOCK_EX);

        if ($written !== false) {
            @chmod($hash_file, 0600);
            $admin_password_hash = $new_hash;
            return true;
        }

        return false;
    }


    /**
     * Update admin password in config file or hash storage
     */
    public static function updatePasswordInConfig(string $new_password, string $base_dir = ''): bool {
        return self::updatePasswordHash($new_password, $base_dir);
    }

    /**
     * Determine effective folder access level and state (.private, .password, or public),
     * walking all ancestor directories from $base_dir down to $dir_path.
     */
    public static function getDirAccessInfo(string $dir_path, string $base_dir): array {
        return \SimpleGallery\Kernel\FS\DotfileManager::getEffectiveAccessInfo($dir_path, $base_dir);
    }

    /**
     * Check if a directory (and every one of its ancestor directories) is accessible by the current visitor/session.
     */
    public static function isDirAccessible(string $dir_path, string $base_dir): bool {
        return \SimpleGallery\Kernel\FS\DotfileManager::isDirAccessible($dir_path, $base_dir);
    }
}
