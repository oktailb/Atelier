<?php
namespace SimpleGallery\Kernel\Config;

/**
 * SimpleGallery WebOS - Centralized System Configuration Store
 * Handles persistence for system preferences, OS settings, autostart, permissions, and shortcuts into `config/`.
 */
class ConfigStore {

    /**
     * Resolves the proper application root directory for system/runtime configuration.
     * Distinguishes between a media directory ($real_base_dir, e.g. storage/media or external /var/photos)
     * and the project root (or an isolated unit-test temporary directory).
     */
    public static function resolveRoot(string $base_dir = ''): string {
        $project_root = rtrim(str_replace('\\', '/', dirname(dirname(dirname(__DIR__)))), '/');
        if ($base_dir === '') {
            return $project_root;
        }

        $norm_base = rtrim(str_replace('\\', '/', realpath($base_dir) ?: $base_dir), '/');
        if ($norm_base === $project_root) {
            return $project_root;
        }

        // Default media directory inside project_root
        if ($norm_base === $project_root . '/storage/media') {
            return $project_root;
        }

        // Configured external media directory ($real_base_dir) must never receive project config/storage files
        global $real_base_dir;
        if (!empty($real_base_dir)) {
            $norm_media = rtrim(str_replace('\\', '/', realpath($real_base_dir) ?: $real_base_dir), '/');
            if ($norm_base === $norm_media && !is_dir($norm_base . '/system')) {
                return $project_root;
            }
        }

        // Otherwise preserve custom directory (e.g. isolated unit test sandbox)
        return $norm_base;
    }

    /**
     * Get the absolute path to the runtime storage directory (`storage/`)
     */
    public static function getStorageDir(string $base_dir = ''): string {
        $dir = self::resolveRoot($base_dir) . '/storage';
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        return $dir;
    }

    /**
     * Get the absolute path to the static system configuration directory (`config/`)
     */
    public static function getConfigDir(string $base_dir = ''): string {
        $dir = self::resolveRoot($base_dir) . '/config';
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        return $dir;
    }

    /**
     * Get the runtime storage path for a specific configuration file (`storage/<key>.json`)
     */
    public static function getFilePath(string $key, string $base_dir = ''): string {
        $clean_key = preg_replace('/[^a-zA-Z0-9_\.-]/', '', $key);
        if (!str_ends_with($clean_key, '.json')) {
            $clean_key .= '.json';
        }
        return self::getStorageDir($base_dir) . '/' . $clean_key;
    }

    /**
     * Get the static admin default path for a configuration file (`config/<key>.json`)
     */
    public static function getStaticConfigFilePath(string $key, string $base_dir = ''): string {
        $clean_key = preg_replace('/[^a-zA-Z0-9_\.-]/', '', $key);
        if (!str_ends_with($clean_key, '.json')) {
            $clean_key .= '.json';
        }
        return self::resolveRoot($base_dir) . '/config/' . $clean_key;
    }

    /**
     * Retrieve configuration data by key: checks runtime `storage/<key>.json` first,
     * then falls back to static admin `config/<key>.json`.
     *
     * @param string $key Config key name (e.g. 'autostart', 'desktop', 'permissions')
     * @param mixed $default Fallback value if configuration file does not exist
     * @param string $base_dir Optional custom base directory
     * @return mixed Decoded configuration data
     */
    public static function get(string $key, $default = null, string $base_dir = '') {
        // 1. Check runtime override in storage/
        $storage_path = self::getFilePath($key, $base_dir);
        if (file_exists($storage_path) && is_readable($storage_path)) {
            $content = @file_get_contents($storage_path);
            if ($content !== false && trim($content) !== '') {
                $decoded = json_decode($content, true);
                if ($decoded !== null || $content === 'null') {
                    return $decoded;
                }
            }
        }

        // 2. Fallback to static default in config/
        $config_path = self::getStaticConfigFilePath($key, $base_dir);
        if (file_exists($config_path) && is_readable($config_path)) {
            $content = @file_get_contents($config_path);
            if ($content !== false && trim($content) !== '') {
                $decoded = json_decode($content, true);
                if ($decoded !== null || $content === 'null') {
                    return $decoded;
                }
            }
        }

        return $default;
    }

    /**
     * Save runtime configuration data by key with atomic file lock in `storage/`
     * (Never mutates static `config/` directory at runtime).
     *
     * @param string $key Config key name
     * @param mixed $value Data to encode as JSON
     * @param string $base_dir Optional custom base directory
     * @return bool Success status
     */
    public static function set(string $key, $value, string $base_dir = ''): bool {
        $path = self::getFilePath($key, $base_dir);
        $encoded = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        if ($encoded === false) {
            return false;
        }

        $res = @file_put_contents($path, $encoded, LOCK_EX);
        return ($res !== false);
    }

    /**
     * Delete a runtime configuration file
     */
    public static function delete(string $key, string $base_dir = ''): bool {
        $path = self::getFilePath($key, $base_dir);
        if (file_exists($path)) {
            return @unlink($path);
        }
        return true;
    }

    /**
     * Check if a configuration exists in storage/ or config/
     */
    public static function has(string $key, string $base_dir = ''): bool {
        return file_exists(self::getFilePath($key, $base_dir))
            || file_exists(self::getStaticConfigFilePath($key, $base_dir));
    }
}
