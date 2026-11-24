<?php
/**
 * Atelier by GallusTech - Authentication, Self-Registration, Email & 2FA Policy Settings
 * Persisted in `<storage>/auth_settings.json` with secure-by-default settings.
 * Sensitive credentials (`smtp_password`) are never leaked to the browser UI.
 */

namespace SimpleGallery\Kernel\Auth;

use SimpleGallery\Kernel\Config\ConfigStore;

class AuthSettings {

    public const VALID_REGISTRATION_MODES = ['disabled', 'invite_only', 'approval', 'open'];
    public const VALID_TOTP_POLICIES      = ['disabled', 'optional', 'required_admins', 'required_all'];
    public const VALID_MAIL_DRIVERS       = ['outbox_log', 'php_mail', 'smtp'];
    public const VALID_SMTP_ENCRYPTIONS   = ['tls', 'ssl', 'none'];

    public static function defaults(): array {
        return [
            'registration_mode'          => 'disabled',
            'require_email_verification' => true,
            'allow_password_reset'       => true,
            'email_verify_ttl_hours'     => 24,
            'password_reset_ttl_minutes' => 60,
            'invite_ttl_days'            => 7,
            'min_password_length'        => 8,
            'allowed_email_domains'      => [],
            'blocked_email_domains'      => [],
            'default_quota_mb'           => 0,
            'default_group_ids'          => [],
            'totp_policy'                => 'optional',
            'totp_issuer'                => 'Atelier by GallusTech',
            'mail_driver'                => 'outbox_log',
            'smtp_host'                  => '',
            'smtp_port'                  => 587,
            'smtp_encryption'            => 'tls',
            'smtp_username'              => '',
            'smtp_password'              => '',
            'mail_from_email'            => 'noreply@localhost',
            'mail_from_name'             => 'Atelier by GallusTech',
            'public_base_url'            => '',
            'oidc_enabled'               => false,
            'oidc_provider_name'         => 'SSO',
            'oidc_issuer_url'            => '',
            'oidc_client_id'             => '',
            'oidc_client_secret'         => '',
            'oidc_scopes'                => 'openid profile email',
            'oidc_auto_create'           => false
        ];
    }

    public static function getFilePath(string $baseOrRoot): string {
        $root = ConfigStore::resolveRoot($baseOrRoot);
        $storageDir = ConfigStore::getStorageDir($root);
        return $storageDir . '/auth_settings.json';
    }

    /**
     * Loads full internal settings (including smtp_password for server-side Mailer use only).
     */
    public static function load(string $baseOrRoot): array {
        $defaults = self::defaults();
        $path = self::getFilePath($baseOrRoot);
        if (!file_exists($path)) {
            return $defaults;
        }
        $raw = @file_get_contents($path);
        $decoded = @json_decode((string)$raw, true);
        if (!is_array($decoded)) {
            return $defaults;
        }
        return array_merge($defaults, $decoded);
    }

    /**
     * Returns settings safe to expose to the Admin Settings UI (masks smtp_password).
     */
    public static function getForAdminUi(string $baseOrRoot): array {
        $cfg = self::load($baseOrRoot);
        $hasPwd = isset($cfg['smtp_password']) && (string)$cfg['smtp_password'] !== '';
        $hasOidcSecret = isset($cfg['oidc_client_secret']) && (string)$cfg['oidc_client_secret'] !== '';
        unset($cfg['smtp_password'], $cfg['oidc_client_secret']);
        $cfg['smtp_password_set'] = $hasPwd;
        $cfg['oidc_client_secret_set'] = $hasOidcSecret;
        return $cfg;
    }

    /**
     * Returns minimal public policy safe to inject into `window.SG_AUTH_POLICY` for guests.
     */
    public static function getPublicPolicy(string $baseOrRoot): array {
        $cfg = self::load($baseOrRoot);
        return [
            'registration_mode'          => (string)$cfg['registration_mode'],
            'registration_enabled'       => $cfg['registration_mode'] !== 'disabled',
            'invite_required'            => $cfg['registration_mode'] === 'invite_only',
            'approval_required'          => $cfg['registration_mode'] === 'approval',
            'require_email_verification' => !empty($cfg['require_email_verification']),
            'allow_password_reset'       => !empty($cfg['allow_password_reset']),
            'min_password_length'        => max(6, (int)$cfg['min_password_length']),
            'totp_policy'                => (string)$cfg['totp_policy'],
            'totp_enabled'               => $cfg['totp_policy'] !== 'disabled',
            'oidc_enabled'               => !empty($cfg['oidc_enabled']) && !empty($cfg['oidc_issuer_url']) && !empty($cfg['oidc_client_id']),
            'oidc_provider_name'         => (string)($cfg['oidc_provider_name'] ?? 'SSO')
        ];
    }

    /**
     * Normalizes a list of domains (from array or comma/newline-separated string).
     */
    public static function normalizeDomainList($raw): array {
        if (is_string($raw)) {
            $raw = preg_split('/[\s,;]+/', $raw) ?: [];
        }
        if (!is_array($raw)) {
            return [];
        }
        $clean = [];
        foreach ($raw as $item) {
            $d = ltrim(strtolower(trim((string)$item)), '@.');
            if ($d !== '' && preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/', $d)) {
                $clean[$d] = true;
            }
        }
        return array_keys($clean);
    }

    /**
     * Validates and atomically persists updated auth settings.
     */
    public static function save(string $baseOrRoot, array $input): array {
        $current = self::load($baseOrRoot);
        $next = $current;

        if (isset($input['registration_mode'])) {
            $mode = strtolower(trim((string)$input['registration_mode']));
            if (in_array($mode, self::VALID_REGISTRATION_MODES, true)) {
                $next['registration_mode'] = $mode;
            }
        }
        if (array_key_exists('require_email_verification', $input)) {
            $next['require_email_verification'] = filter_var($input['require_email_verification'], FILTER_VALIDATE_BOOLEAN);
        }
        if (array_key_exists('allow_password_reset', $input)) {
            $next['allow_password_reset'] = filter_var($input['allow_password_reset'], FILTER_VALIDATE_BOOLEAN);
        }
        if (isset($input['email_verify_ttl_hours'])) {
            $next['email_verify_ttl_hours'] = max(1, min(168, (int)$input['email_verify_ttl_hours']));
        }
        if (isset($input['password_reset_ttl_minutes'])) {
            $next['password_reset_ttl_minutes'] = max(10, min(1440, (int)$input['password_reset_ttl_minutes']));
        }
        if (isset($input['invite_ttl_days'])) {
            $next['invite_ttl_days'] = max(1, min(90, (int)$input['invite_ttl_days']));
        }
        if (isset($input['min_password_length'])) {
            $next['min_password_length'] = max(6, min(64, (int)$input['min_password_length']));
        }
        if (array_key_exists('allowed_email_domains', $input)) {
            $next['allowed_email_domains'] = self::normalizeDomainList($input['allowed_email_domains']);
        }
        if (array_key_exists('blocked_email_domains', $input)) {
            $next['blocked_email_domains'] = self::normalizeDomainList($input['blocked_email_domains']);
        }
        if (isset($input['default_quota_mb'])) {
            $next['default_quota_mb'] = max(0, (int)$input['default_quota_mb']);
        }
        if (isset($input['default_group_ids']) && is_array($input['default_group_ids'])) {
            $next['default_group_ids'] = array_values(array_unique(array_filter(array_map('intval', $input['default_group_ids']), function ($v) {
                return $v > 0;
            })));
        }
        if (isset($input['totp_policy'])) {
            $pol = strtolower(trim((string)$input['totp_policy']));
            if (in_array($pol, self::VALID_TOTP_POLICIES, true)) {
                $next['totp_policy'] = $pol;
            }
        }
        if (isset($input['totp_issuer'])) {
            $issuer = trim(preg_replace('/[\r\n:]+/', ' ', (string)$input['totp_issuer']));
            if ($issuer !== '') {
                $next['totp_issuer'] = substr($issuer, 0, 60);
            }
        }
        if (isset($input['mail_driver'])) {
            $drv = strtolower(trim((string)$input['mail_driver']));
            if (in_array($drv, self::VALID_MAIL_DRIVERS, true)) {
                $next['mail_driver'] = $drv;
            }
        }
        if (isset($input['smtp_host'])) {
            $next['smtp_host'] = trim((string)$input['smtp_host']);
        }
        if (isset($input['smtp_port'])) {
            $next['smtp_port'] = max(1, min(65535, (int)$input['smtp_port']));
        }
        if (isset($input['smtp_encryption'])) {
            $enc = strtolower(trim((string)$input['smtp_encryption']));
            if (in_array($enc, self::VALID_SMTP_ENCRYPTIONS, true)) {
                $next['smtp_encryption'] = $enc;
            }
        }
        if (isset($input['smtp_username'])) {
            $next['smtp_username'] = trim((string)$input['smtp_username']);
        }
        // Preserve existing SMTP password unless explicitly changed or cleared
        if (!empty($input['clear_smtp_password'])) {
            $next['smtp_password'] = '';
        } elseif (isset($input['smtp_password']) && (string)$input['smtp_password'] !== '') {
            $next['smtp_password'] = (string)$input['smtp_password'];
        }
        if (isset($input['mail_from_email'])) {
            $from = trim((string)$input['mail_from_email']);
            if ($from !== '' && filter_var($from, FILTER_VALIDATE_EMAIL)) {
                $next['mail_from_email'] = $from;
            }
        }
        if (isset($input['mail_from_name'])) {
            $name = trim(preg_replace('/[\r\n]+/', ' ', (string)$input['mail_from_name']));
            if ($name !== '') {
                $next['mail_from_name'] = substr($name, 0, 80);
            }
        }
        if (isset($input['public_base_url'])) {
            $url = rtrim(trim((string)$input['public_base_url']), '/');
            if ($url === '' || preg_match('#^https?://[a-zA-Z0-9._:/-]+$#', $url)) {
                $next['public_base_url'] = $url;
            }
        }
        if (array_key_exists('oidc_enabled', $input)) {
            $next['oidc_enabled'] = filter_var($input['oidc_enabled'], FILTER_VALIDATE_BOOLEAN);
        }
        if (isset($input['oidc_provider_name'])) {
            $pn = trim((string)$input['oidc_provider_name']);
            if ($pn !== '') $next['oidc_provider_name'] = substr($pn, 0, 50);
        }
        if (isset($input['oidc_issuer_url'])) {
            $iu = rtrim(trim((string)$input['oidc_issuer_url']), '/');
            if ($iu === '' || preg_match('#^https?://[a-zA-Z0-9._:/-]+$#', $iu)) {
                $next['oidc_issuer_url'] = $iu;
            }
        }
        if (isset($input['oidc_client_id'])) {
            $next['oidc_client_id'] = trim((string)$input['oidc_client_id']);
        }
        if (!empty($input['clear_oidc_secret'])) {
            $next['oidc_client_secret'] = '';
        } elseif (isset($input['oidc_client_secret']) && (string)$input['oidc_client_secret'] !== '') {
            $next['oidc_client_secret'] = (string)$input['oidc_client_secret'];
        }
        if (isset($input['oidc_scopes'])) {
            $sc = trim((string)$input['oidc_scopes']);
            if ($sc !== '') $next['oidc_scopes'] = substr($sc, 0, 120);
        }
        if (array_key_exists('oidc_auto_create', $input)) {
            $next['oidc_auto_create'] = filter_var($input['oidc_auto_create'], FILTER_VALIDATE_BOOLEAN);
        }

        $path = self::getFilePath($baseOrRoot);
        $dir = dirname($path);
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }

        $json = json_encode($next, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $tmp = $path . '.tmp.' . getmypid();
        $ok = (@file_put_contents($tmp, $json, LOCK_EX) !== false) && (@rename($tmp, $path) || @file_put_contents($path, $json, LOCK_EX) !== false);
        if (file_exists($tmp)) {
            @unlink($tmp);
        }
        if (!$ok) {
            return ['success' => false, 'status' => 500, 'error' => 'Failed to persist auth settings.'];
        }
        @chmod($path, 0600);

        AuditLogger::log($baseOrRoot, 'auth_settings_update', 'storage/auth_settings.json', 'ok', [
            'registration_mode' => $next['registration_mode'],
            'totp_policy'       => $next['totp_policy'],
            'mail_driver'       => $next['mail_driver']
        ]);

        return [
            'success'  => true,
            'status'   => 200,
            'settings' => self::getForAdminUi($baseOrRoot),
            'policy'   => self::getPublicPolicy($baseOrRoot)
        ];
    }

    /**
     * Checks whether a given email address is allowed by allowed/blocked domain policies.
     */
    public static function isEmailDomainAllowed(string $email, array $cfg): bool {
        $at = strrpos($email, '@');
        if ($at === false) {
            return false;
        }
        $domain = strtolower(trim(substr($email, $at + 1)));
        if ($domain === '') {
            return false;
        }
        $blocked = is_array($cfg['blocked_email_domains'] ?? null) ? $cfg['blocked_email_domains'] : [];
        foreach ($blocked as $b) {
            $b = strtolower(trim((string)$b));
            if ($b !== '' && ($domain === $b || substr($domain, -(strlen($b) + 1)) === '.' . $b)) {
                return false;
            }
        }
        $allowed = is_array($cfg['allowed_email_domains'] ?? null) ? $cfg['allowed_email_domains'] : [];
        if (!empty($allowed)) {
            foreach ($allowed as $a) {
                $a = strtolower(trim((string)$a));
                if ($a !== '' && ($domain === $a || substr($domain, -(strlen($a) + 1)) === '.' . $a)) {
                    return true;
                }
            }
            return false;
        }
        return true;
    }

    /**
     * Resolves the public URL of this Atelier instance for building verification & reset links.
     */
    public static function resolvePublicBaseUrl(array $cfg): string {
        if (!empty($cfg['public_base_url'])) {
            return rtrim((string)$cfg['public_base_url'], '/');
        }
        $scheme = ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https'))
            ? 'https'
            : 'http';
        $host = $_SERVER['HTTP_X_FORWARDED_HOST'] ?? $_SERVER['HTTP_HOST'] ?? 'localhost';
        $host = preg_replace('/[^a-zA-Z0-9._:\-\[\]]/', '', (string)$host) ?: 'localhost';
        $scriptDir = dirname(str_replace('\\', '/', (string)($_SERVER['SCRIPT_NAME'] ?? '/index.php')));
        // Strip internal `/system/endpoints` suffix when triggered from API endpoint
        $scriptDir = preg_replace('#/system/endpoints/?$#', '', $scriptDir);
        $scriptDir = rtrim((string)$scriptDir, '/');
        return $scheme . '://' . $host . ($scriptDir !== '' && $scriptDir !== '.' ? $scriptDir : '');
    }

    /**
     * Checks whether the 2FA policy mandates 2FA for the given user role.
     */
    public static function isTotpRequiredForRole(string $role, array $cfg): bool {
        $pol = strtolower((string)($cfg['totp_policy'] ?? 'optional'));
        if ($pol === 'required_all') {
            return true;
        }
        if ($pol === 'required_admins') {
            return in_array(strtolower($role), ['admin', 'superadmin'], true);
        }
        return false;
    }
}
