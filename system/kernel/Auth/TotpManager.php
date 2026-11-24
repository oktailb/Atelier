<?php
/**
 * Atelier by GallusTech - RFC 6238 TOTP (2FA) & Recovery Codes Manager
 * 100% pure PHP (zero external dependencies):
 *  - RFC 4648 Base32 encoding/decoding
 *  - RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30-second period, ±1 step clock drift tolerance)
 *  - Anti-replay protection (`totp_last_step` monotonically increasing)
 *  - 8 single-use backup recovery codes stored hashed
 */

namespace SimpleGallery\Kernel\Auth;

use SimpleGallery\Kernel\Data\AtelierStore;

class TotpManager {

    private const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    public const PERIOD = 30;
    public const DIGITS = 6;

    /**
     * Generates a cryptographically secure 160-bit Base32 TOTP secret (32 Base32 chars).
     */
    public static function generateSecret(int $byteLength = 20): string {
        return self::base32Encode(random_bytes(max(16, $byteLength)));
    }

    public static function base32Encode(string $binary): string {
        $bits = '';
        $len = strlen($binary);
        for ($i = 0; $i < $len; $i++) {
            $bits .= str_pad(decbin(ord($binary[$i])), 8, '0', STR_PAD_LEFT);
        }
        $out = '';
        $chunks = str_split($bits, 5);
        foreach ($chunks as $chunk) {
            if (strlen($chunk) < 5) {
                $chunk = str_pad($chunk, 5, '0', STR_PAD_RIGHT);
            }
            $out .= self::BASE32_ALPHABET[bindec($chunk)];
        }
        return $out;
    }

    public static function base32Decode(string $encoded): string {
        $clean = strtoupper(preg_replace('/[^A-Z2-7]/i', '', $encoded));
        if ($clean === '') {
            return '';
        }
        $bits = '';
        $len = strlen($clean);
        for ($i = 0; $i < $len; $i++) {
            $pos = strpos(self::BASE32_ALPHABET, $clean[$i]);
            if ($pos === false) continue;
            $bits .= str_pad(decbin($pos), 5, '0', STR_PAD_LEFT);
        }
        $out = '';
        $byteChunks = str_split($bits, 8);
        foreach ($byteChunks as $chunk) {
            if (strlen($chunk) === 8) {
                $out .= chr(bindec($chunk));
            }
        }
        return $out;
    }

    /**
     * Computes a 6-digit RFC 6238 TOTP code for a given Base32 secret and Unix timestamp (or time step).
     */
    public static function getCodeForStep(string $base32Secret, int $timeStep): string {
        $key = self::base32Decode($base32Secret);
        if ($key === '') {
            return '';
        }
        // 64-bit big-endian unsigned counter
        $high = ($timeStep >> 32) & 0xFFFFFFFF;
        $low  = $timeStep & 0xFFFFFFFF;
        $counter = pack('NN', $high, $low);

        $hash = hash_hmac('sha1', $counter, $key, true);
        $offset = ord($hash[19]) & 0x0F;
        $binary = ((ord($hash[$offset]) & 0x7F) << 24)
            | ((ord($hash[$offset + 1]) & 0xFF) << 16)
            | ((ord($hash[$offset + 2]) & 0xFF) << 8)
            | (ord($hash[$offset + 3]) & 0xFF);

        $otp = $binary % (10 ** self::DIGITS);
        return str_pad((string)$otp, self::DIGITS, '0', STR_PAD_LEFT);
    }

    public static function getCode(string $base32Secret, ?int $timestamp = null): string {
        $ts = $timestamp ?? time();
        return self::getCodeForStep($base32Secret, (int)floor($ts / self::PERIOD));
    }

    /**
     * Verifies a 6-digit TOTP code with ±$window clock drift tolerance and anti-replay check.
     * Returns matched time step (int) on success, or null on failure.
     */
    public static function verifyCode(
        string $base32Secret,
        string $code,
        ?int $lastStep = null,
        int $window = 1,
        ?int $timestamp = null
    ): ?int {
        $clean = preg_replace('/[\s-]+/', '', trim($code));
        if (!preg_match('/^\d{6}$/', $clean)) {
            return null;
        }

        $ts = $timestamp ?? time();
        $currentStep = (int)floor($ts / self::PERIOD);

        for ($offset = -$window; $offset <= $window; $offset++) {
            $step = $currentStep + $offset;
            if ($lastStep !== null && $step <= $lastStep) {
                continue; // Anti-replay: reject codes from already-used or older time steps
            }
            $expected = self::getCodeForStep($base32Secret, $step);
            if ($expected !== '' && hash_equals($expected, $clean)) {
                return $step;
            }
        }
        return null;
    }

    /**
     * Builds the standard `otpauth://totp/...` provisioning URI.
     */
    public static function buildProvisioningUri(string $issuer, string $accountName, string $secret): string {
        $cleanIssuer = trim(preg_replace('/[:\r\n]+/', ' ', $issuer)) ?: 'Atelier';
        $cleanAccount = trim(preg_replace('/[:\r\n]+/', '', $accountName)) ?: 'user';
        $label = rawurlencode($cleanIssuer) . ':' . rawurlencode($cleanAccount);
        return 'otpauth://totp/' . $label
            . '?secret=' . rawurlencode($secret)
            . '&issuer=' . rawurlencode($cleanIssuer)
            . '&algorithm=SHA1&digits=' . self::DIGITS . '&period=' . self::PERIOD;
    }

    /**
     * Generates 8 single-use human-readable recovery codes (`XXXX-XXXX`) and their salted hashes.
     */
    public static function generateRecoveryCodes(int $count = 8): array {
        $plain = [];
        $hashed = [];
        $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $max = strlen($chars) - 1;
        for ($i = 0; $i < $count; $i++) {
            $part1 = '';
            $part2 = '';
            for ($j = 0; $j < 4; $j++) {
                $part1 .= $chars[random_int(0, $max)];
                $part2 .= $chars[random_int(0, $max)];
            }
            $code = $part1 . '-' . $part2;
            $plain[] = $code;
            $hashed[] = password_hash(strtoupper(str_replace('-', '', $code)), PASSWORD_BCRYPT);
        }
        return ['plain' => $plain, 'hashed' => $hashed];
    }

    /**
     * Begins 2FA enrollment for a user (stores unconfirmed secret; does NOT enforce until confirmed).
     */
    public static function beginSetup(string $projectRoot, int $userId): array {
        $store = AtelierStore::forRoot($projectRoot);
        $user = $store->selectOne('users', ['id' => $userId]);
        if (!$user) {
            return ['success' => false, 'status' => 404, 'error' => 'User not found.'];
        }

        $cfg = AuthSettings::load($projectRoot);
        if (($cfg['totp_policy'] ?? 'optional') === 'disabled') {
            return ['success' => false, 'status' => 403, 'error' => '2FA is disabled by the administrator.'];
        }

        $secret = self::generateSecret();
        $store->update('users', [
            'totp_secret'       => $secret,
            'totp_confirmed_at' => null,
            'totp_last_step'    => null,
            'updated_at'        => time()
        ], ['id' => $userId]);

        $issuer = (string)($cfg['totp_issuer'] ?? 'Atelier by GallusTech');
        $account = !empty($user['email']) ? (string)$user['email'] : (string)$user['username'];
        $uri = self::buildProvisioningUri($issuer, $account, $secret);
        $qrSvg = QrCodeSvg::render($uri, 4);

        return [
            'success' => true,
            'status'  => 200,
            'secret'  => $secret,
            'uri'     => $uri,
            'qr_svg'  => $qrSvg,
            'issuer'  => $issuer,
            'account' => $account
        ];
    }

    /**
     * Confirms 2FA enrollment with a valid 6-digit TOTP code and returns one-time recovery codes.
     */
    public static function confirmSetup(string $projectRoot, int $userId, string $code): array {
        $store = AtelierStore::forRoot($projectRoot);
        $user = $store->selectOne('users', ['id' => $userId]);
        if (!$user || empty($user['totp_secret'])) {
            return ['success' => false, 'status' => 400, 'error' => 'No pending 2FA setup found.'];
        }

        $step = self::verifyCode((string)$user['totp_secret'], $code, null, 1);
        if ($step === null) {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid 6-digit verification code.'];
        }

        $codes = self::generateRecoveryCodes(8);
        $now = time();
        $store->update('users', [
            'totp_confirmed_at'        => $now,
            'totp_last_step'           => $step,
            'totp_recovery_codes_json' => json_encode($codes['hashed']),
            'updated_at'               => $now
        ], ['id' => $userId]);

        AuditLogger::log($projectRoot, 'totp_enabled', (string)$user['home_dir'], 'ok', ['username' => $user['username']]);

        return [
            'success'        => true,
            'status'         => 200,
            'recovery_codes' => $codes['plain'],
            'user'           => UserManager::sanitizeUserForOutput(UserManager::findById($projectRoot, $userId))
        ];
    }

    /**
     * Verifies a login 2FA code (either 6-digit TOTP or single-use recovery code).
     */
    public static function verifyUserLoginCode(string $projectRoot, array $rawUser, string $code): array {
        if (empty($rawUser['totp_secret']) || empty($rawUser['totp_confirmed_at'])) {
            return ['ok' => false, 'error' => '2FA is not enabled on this account.'];
        }

        $store = AtelierStore::forRoot($projectRoot);
        $userId = (int)$rawUser['id'];
        $lastStep = isset($rawUser['totp_last_step']) && $rawUser['totp_last_step'] !== null ? (int)$rawUser['totp_last_step'] : null;

        // 1. Try 6-digit TOTP first
        $matchedStep = self::verifyCode((string)$rawUser['totp_secret'], $code, $lastStep, 1);
        if ($matchedStep !== null) {
            $store->update('users', [
                'totp_last_step' => $matchedStep,
                'last_login_at'  => time()
            ], ['id' => $userId]);
            return ['ok' => true, 'used_recovery' => false];
        }

        // 2. Try single-use backup recovery code (`XXXX-XXXX` or `XXXXXXXX`)
        $normRecovery = strtoupper(preg_replace('/[^A-Z0-9]/i', '', trim($code)));
        if (strlen($normRecovery) === 8 && !empty($rawUser['totp_recovery_codes_json'])) {
            $hashes = @json_decode((string)$rawUser['totp_recovery_codes_json'], true);
            if (is_array($hashes)) {
                foreach ($hashes as $idx => $h) {
                    if (is_string($h) && password_verify($normRecovery, $h)) {
                        unset($hashes[$idx]);
                        $remaining = array_values($hashes);
                        $store->update('users', [
                            'totp_recovery_codes_json' => json_encode($remaining),
                            'last_login_at'            => time()
                        ], ['id' => $userId]);
                        AuditLogger::log($projectRoot, 'totp_recovery_used', (string)$rawUser['home_dir'], 'ok', [
                            'username'  => $rawUser['username'],
                            'remaining' => count($remaining)
                        ]);
                        return ['ok' => true, 'used_recovery' => true, 'remaining_recovery_codes' => count($remaining)];
                    }
                }
            }
        }

        return ['ok' => false, 'error' => 'Invalid 2FA or recovery code.'];
    }

    /**
     * Disables 2FA on a user account (requires password confirmation unless forced by admin).
     */
    public static function disable(string $projectRoot, int $userId, ?string $password = null, bool $adminBypass = false): array {
        $store = AtelierStore::forRoot($projectRoot);
        $user = $store->selectOne('users', ['id' => $userId]);
        if (!$user) {
            return ['success' => false, 'status' => 404, 'error' => 'User not found.'];
        }

        if (!$adminBypass) {
            $cfg = AuthSettings::load($projectRoot);
            if (AuthSettings::isTotpRequiredForRole((string)($user['role'] ?? 'user'), $cfg)) {
                return ['success' => false, 'status' => 403, 'error' => '2FA is mandatory for your role and cannot be disabled.'];
            }
            if ($password === null || !password_verify($password, (string)$user['password_hash'])) {
                return ['success' => false, 'status' => 401, 'error' => 'Invalid current password.'];
            }
        }

        $store->update('users', [
            'totp_secret'              => null,
            'totp_confirmed_at'        => null,
            'totp_recovery_codes_json' => null,
            'totp_last_step'           => null,
            'updated_at'               => time()
        ], ['id' => $userId]);

        AuditLogger::log($projectRoot, 'totp_disabled', (string)$user['home_dir'], 'ok', [
            'username' => $user['username'],
            'by_admin' => $adminBypass
        ]);

        return [
            'success' => true,
            'status'  => 200,
            'user'    => UserManager::sanitizeUserForOutput(UserManager::findById($projectRoot, $userId))
        ];
    }

    /**
     * Regenerates backup recovery codes for a user with confirmed 2FA.
     */
    public static function regenerateRecoveryCodes(string $projectRoot, int $userId, string $password): array {
        $store = AtelierStore::forRoot($projectRoot);
        $user = $store->selectOne('users', ['id' => $userId]);
        if (!$user || empty($user['totp_secret']) || empty($user['totp_confirmed_at'])) {
            return ['success' => false, 'status' => 400, 'error' => '2FA is not active on this account.'];
        }
        if (!password_verify($password, (string)$user['password_hash'])) {
            return ['success' => false, 'status' => 401, 'error' => 'Invalid current password.'];
        }

        $codes = self::generateRecoveryCodes(8);
        $store->update('users', [
            'totp_recovery_codes_json' => json_encode($codes['hashed']),
            'updated_at'               => time()
        ], ['id' => $userId]);

        AuditLogger::log($projectRoot, 'totp_recovery_regenerated', (string)$user['home_dir'], 'ok', ['username' => $user['username']]);
        return [
            'success'        => true,
            'status'         => 200,
            'recovery_codes' => $codes['plain']
        ];
    }
}
