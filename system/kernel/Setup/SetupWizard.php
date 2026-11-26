<?php
/**
 * Atelier by GallusTech - First-Run Web Setup Wizard Engine (Phase C)
 *
 * Self-locking initial onboarding engine:
 *   - Active ONLY when NO legacy `.admin_password_hash` exists AND ZERO active admin/superadmin users exist.
 *   - Provides PHP/storage environment diagnostics.
 *   - Creates the first SuperAdmin account + optional public base URL & registration policy.
 *   - Permanently self-locks (HTTP 403) the instant an admin exists.
 */

namespace SimpleGallery\Kernel\Setup;

use SimpleGallery\Kernel\Auth\AuditLogger;
use SimpleGallery\Kernel\Auth\AuthSettings;
use SimpleGallery\Kernel\Auth\UserManager;
use SimpleGallery\Kernel\Config\ConfigStore;
use SimpleGallery\Kernel\Data\AtelierStore;

class SetupWizard {

    /**
     * Returns true ONLY if the instance has no configured administrator yet.
     */
    public static function isSetupRequired(string $projectRoot): bool {
        $root = rtrim(str_replace('\\', '/', $projectRoot), '/');
        $storageDir = ConfigStore::getStorageDir($root);

        if (is_file($root . '/.admin_password_hash') && trim((string)@file_get_contents($root . '/.admin_password_hash')) !== '') {
            return false;
        }
        if (is_file($storageDir . '/.admin_password_hash') && trim((string)@file_get_contents($storageDir . '/.admin_password_hash')) !== '') {
            return false;
        }

        try {
            $store = AtelierStore::forRoot($root);
            $users = $store->select('users', []);
            foreach ($users as $u) {
                if (!empty($u['is_active']) && in_array($u['role'] ?? '', ['superadmin', 'admin'], true)) {
                    return false;
                }
            }
        } catch (\Throwable $e) {
            // If DB cannot be queried yet, still allow diagnostics
        }

        return true;
    }

    /**
     * Collects PHP runtime, extension & directory writeability diagnostics.
     */
    public static function getEnvironmentDiagnostics(string $projectRoot): array {
        $root = rtrim(str_replace('\\', '/', $projectRoot), '/');
        $storageDir = ConfigStore::getStorageDir($root);
        $configDir = $root . '/config';
        $hasFfmpeg = false;
        if (function_exists('exec')) {
            @exec('ffmpeg -version 2>&1', $out, $code);
            $hasFfmpeg = ($code === 0);
        }

        $checks = [
            ['id' => 'php_version', 'label' => 'PHP >= 7.4 (' . PHP_VERSION . ')', 'ok' => version_compare(PHP_VERSION, '7.4.0', '>='), 'required' => true],
            ['id' => 'pdo_sqlite',  'label' => 'PDO SQLite', 'ok' => extension_loaded('pdo_sqlite'), 'required' => false],
            ['id' => 'gd',          'label' => 'GD Image Extension', 'ok' => extension_loaded('gd'), 'required' => false],
            ['id' => 'zip',         'label' => 'ZipArchive', 'ok' => class_exists('\ZipArchive'), 'required' => false],
            ['id' => 'curl',        'label' => 'cURL (Cloud / OAuth / OIDC)', 'ok' => extension_loaded('curl'), 'required' => false],
            ['id' => 'openssl',     'label' => 'OpenSSL (AES-256-GCM Vault)', 'ok' => extension_loaded('openssl'), 'required' => true],
            ['id' => 'exif',        'label' => 'EXIF Metadata', 'ok' => extension_loaded('exif'), 'required' => false],
            ['id' => 'ffmpeg',      'label' => 'FFmpeg CLI (Video Previews)', 'ok' => $hasFfmpeg, 'required' => false],
            ['id' => 'storage_rw',  'label' => 'storage/ writable', 'ok' => is_dir($storageDir) && is_writable($storageDir), 'required' => true],
            ['id' => 'config_rw',   'label' => 'config/ writable', 'ok' => is_dir($configDir) && is_writable($configDir), 'required' => false]
        ];

        $ready = true;
        foreach ($checks as $c) {
            if (!empty($c['required']) && empty($c['ok'])) {
                $ready = false;
            }
        }

        return [
            'ready'        => $ready,
            'php_version'  => PHP_VERSION,
            'store_driver' => extension_loaded('pdo_sqlite') ? 'sqlite' : 'json',
            'checks'       => $checks
        ];
    }

    /**
     * Completes initial instance onboarding by creating the first SuperAdmin account.
     * Strictly refuses execution (HTTP 403) if an admin already exists.
     */
    public static function completeSetup(string $projectRoot, string $mediaDir, array $input): array {
        if (!self::isSetupRequired($projectRoot)) {
            return ['success' => false, 'status' => 403, 'error' => 'Initial setup is already completed and locked.'];
        }

        $username = strtolower(trim((string)($input['username'] ?? 'admin')));
        $password = (string)($input['password'] ?? '');
        $displayName = trim((string)($input['display_name'] ?? 'Administrator'));
        $email = trim((string)($input['email'] ?? ''));
        $publicBaseUrl = trim((string)($input['public_base_url'] ?? ''));

        if (strlen($password) < 10) {
            return ['success' => false, 'status' => 400, 'error' => 'SuperAdmin password must be at least 10 characters.'];
        }

        $created = UserManager::createUser($projectRoot, $mediaDir, [
            'username'     => $username,
            'password'     => $password,
            'display_name' => $displayName !== '' ? $displayName : $username,
            'email'        => $email,
            'role'         => 'superadmin',
            'is_active'    => true
        ]);

        if (empty($created['success'])) {
            return $created;
        }

        if ($publicBaseUrl !== '' && preg_match('#^https?://#i', $publicBaseUrl)) {
            AuthSettings::save($projectRoot, [
                'public_base_url' => rtrim($publicBaseUrl, '/')
            ]);
        }

        AuditLogger::log($projectRoot, 'setup_wizard_complete', 'system', 'ok', [
            'superadmin' => $username
        ]);

        return [
            'success' => true,
            'status'  => 200,
            'user'    => $created['user'] ?? null
        ];
    }
}
