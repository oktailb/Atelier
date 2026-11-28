<?php
namespace Atelier\Kernel\Security;

use Atelier\Kernel\Config\ConfigStore;

/**
 * Kernel Path Validator & Anti-Traversal Shield
 */
class PathValidator {

    /**
     * Resolves the dedicated private user-homes root (`storage/users`), cleanly separated from `storage/media`.
     */
    public static function getUsersRoot(string $base_dir): string {
        $projectRoot = ConfigStore::resolveRoot($base_dir);
        $storageDir = ConfigStore::getStorageDir($projectRoot);
        return rtrim(str_replace('\\', '/', $storageDir), '/') . '/users';
    }

    /**
     * Helper: sandbox-canonicalizes a relative sub-path strictly inside a given root directory.
     */
    private static function canonicalizeWithinRoot(string $sub_path, string $root_dir, bool $must_exist, bool $allow_root): ?string {
        $real_root = realpath($root_dir);
        if ($real_root === false) {
            if ($must_exist) {
                return null;
            }
            $real_root = $root_dir;
        }
        $real_root = rtrim(str_replace('\\', '/', $real_root), '/');

        $clean = ltrim(str_replace('\\', '/', trim($sub_path)), '/');
        if ($clean === '' || $clean === '.') {
            return $allow_root ? $real_root : null;
        }

        $target = $real_root . '/' . $clean;

        if ($must_exist) {
            $resolved = realpath($target);
            if ($resolved === false) {
                return null;
            }
            $resolved_clean = str_replace('\\', '/', $resolved);
            if ($resolved_clean === $real_root) {
                return $allow_root ? $real_root : null;
            }
            if (strpos($resolved_clean, $real_root . '/') === 0) {
                return $resolved_clean;
            }
            return null;
        }

        $parent = dirname($target);
        $resolved_parent = realpath($parent);
        if ($resolved_parent === false) {
            return null;
        }
        $resolved_parent_clean = str_replace('\\', '/', $resolved_parent);
        if ($resolved_parent_clean !== $real_root && strpos($resolved_parent_clean, $real_root . '/') !== 0) {
            return null;
        }
        $filename = basename($target);
        if ($filename === '.' || $filename === '..' || empty($filename)) {
            return null;
        }
        return $resolved_parent_clean . '/' . $filename;
    }

    /**
     * Canonicalizes path and guarantees that the resulting target is strictly inside $base_dir
     * (or inside `storage/users` for virtual `users/...` home paths).
     */
    public static function canonicalize(string $user_path, string $base_dir, bool $must_exist = true, bool $allow_root = true): ?string {
        if (preg_match('/[\x00-\x1f\x7f]/', $user_path)) {
            return null;
        }

        $clean_path = str_replace('\\', '/', trim($user_path));
        $trimmed_left = ltrim($clean_path, '/');

        // Reject any path containing `..` traversal segments early for virtual namespace safety
        if (strcasecmp($trimmed_left, 'users') === 0 || stripos($trimmed_left, 'users/') === 0) {
            $segments = explode('/', $trimmed_left);
            foreach ($segments as $seg) {
                if ($seg === '..') {
                    return null;
                }
            }
            $users_root = self::getUsersRoot($base_dir);
            $sub = (strcasecmp($trimmed_left, 'users') === 0) ? '' : substr($trimmed_left, 6);
            $resolved_user_path = self::canonicalizeWithinRoot($sub, $users_root, $must_exist, $allow_root);
            if ($resolved_user_path !== null) {
                return $resolved_user_path;
            }
            // Legacy fallback if a pre-existing `users/` folder lives inside `$base_dir`
            $real_base = rtrim(str_replace('\\', '/', realpath($base_dir) ?: $base_dir), '/');
            if (is_dir($real_base . '/users')) {
                return self::canonicalizeWithinRoot($trimmed_left, $real_base, $must_exist, $allow_root);
            }
            return null;
        }

        return self::canonicalizeWithinRoot($clean_path, $base_dir, $must_exist, $allow_root);
    }

    public static function canonicalizeAndValidate(string $user_path, string $base_dir, bool $must_exist = true, bool $allow_root = true): ?string {
        return self::canonicalize($user_path, $base_dir, $must_exist, $allow_root);
    }

    public static function sanitizeDirectory(?string $requested_dir, string $base_dir): ?string {
        if ($requested_dir === null) return null;
        $result = self::canonicalize($requested_dir, $base_dir, true, true);
        if ($result !== null && !is_dir($result)) {
            return null;
        }
        return $result;
    }

    public static function sanitizePath(?string $requested_dir, string $base_dir): ?string {
        return self::sanitizeDirectory($requested_dir, $base_dir);
    }

    public static function sanitizeFile(?string $requested_file, string $base_dir): ?string {
        if (empty($requested_file)) return null;
        $result = self::canonicalize($requested_file, $base_dir, true, false);
        if ($result !== null && !is_file($result)) {
            return null;
        }
        return $result;
    }

    public static function sanitizeFilePath(?string $requested_file, string $base_dir): ?string {
        return self::sanitizeFile($requested_file, $base_dir);
    }

    public static function getRelativePath(string $full_path, string $base_dir): string {
        $full_path = str_replace('\\', '/', $full_path);
        $base_dir  = str_replace('\\', '/', $base_dir);
        $real_base = realpath($base_dir);
        if ($real_base !== false) {
            $base_dir = str_replace('\\', '/', $real_base);
        }
        $base_dir = rtrim($base_dir, '/');

        // Map dedicated `storage/users/...` paths back to virtual `users/...` relative paths FIRST
        // (must run before `$base_dir` check in case `$base_dir` is a parent directory like a test sandbox)
        $ci = (PHP_OS_FAMILY === 'Windows' || PHP_OS_FAMILY === 'Darwin');
        $users_root = self::getUsersRoot($base_dir);
        $real_users = realpath($users_root);
        $users_root_norm = rtrim(str_replace('\\', '/', $real_users !== false ? $real_users : $users_root), '/');
        if ($ci ? (strcasecmp($full_path, $users_root_norm) === 0) : ($full_path === $users_root_norm)) {
            return 'users';
        }
        if ($ci ? (stripos($full_path, $users_root_norm . '/') === 0) : (strpos($full_path, $users_root_norm . '/') === 0)) {
            return 'users/' . substr($full_path, strlen($users_root_norm) + 1);
        }

        if ($ci ? (strcasecmp($full_path, $base_dir) === 0) : ($full_path === $base_dir)) {
            return '';
        }
        if ($ci ? (stripos($full_path, $base_dir . '/') === 0) : (strpos($full_path, $base_dir . '/') === 0)) {
            return substr($full_path, strlen($base_dir) + 1);
        }

        return ltrim($full_path, '/');
    }

    public static function isPathIgnored(string $path, string $base_dir, array $ignore_list): bool {
        $rel = self::getRelativePath($path, $base_dir);
        if ($rel === '') return false;
        
        $parts = explode('/', $rel);
        foreach ($parts as $part) {
            if (in_array($part, $ignore_list, true)) {
                return true;
            }
        }
        return false;
    }

    public static function isDirAccessible(string $dir_path, string $base_dir): bool {
        return \Atelier\Kernel\Auth\AuthManager::isDirAccessible($dir_path, $base_dir);
    }
}

