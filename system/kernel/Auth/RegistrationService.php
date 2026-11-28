<?php
/**
 * Atelier by GallusTech - Self-Registration, Email Verification, Invitations & Password Reset Service
 *
 * Security guarantees:
 *  - All verification, reset, and invite tokens are stored hashed with SHA-256 (`auth_tokens.token_hash`).
 *  - Unverified / pending accounts remain `is_active = 0` and their `storage/users/<name>` home
 *    directory is NOT created until the account is actually activated.
 *  - Password reset requests are anti-enumeration (always return uniform success response).
 */

namespace Atelier\Kernel\Auth;

use Atelier\Kernel\Data\AtelierStore;
use Atelier\Kernel\Mail\Mailer;
use Atelier\Kernel\Security\RateLimiter;

class RegistrationService {

    public static function hashToken(string $rawToken): string {
        return hash('sha256', trim($rawToken));
    }

    /**
     * Generates and persists a single-use hashed token in `auth_tokens`.
     */
    public static function issueToken(
        string $projectRoot,
        string $type,
        ?int $userId,
        string $targetEmail,
        int $ttlSeconds,
        array $meta = []
    ): array {
        $store = AtelierStore::forRoot($projectRoot);
        $now = time();

        // Revoke any prior unused tokens of the same type for this user (except multi-invite creation by admin)
        if ($userId !== null && $type !== 'invite') {
            $existing = $store->select('auth_tokens', ['user_id' => $userId, 'type' => $type]);
            foreach ($existing as $row) {
                if (empty($row['used_at'])) {
                    $store->update('auth_tokens', ['used_at' => $now], ['id' => (int)$row['id']]);
                }
            }
        }

        $rawToken = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
        $hash = self::hashToken($rawToken);
        $expiresAt = $now + max(60, $ttlSeconds);

        $id = $store->insert('auth_tokens', [
            'user_id'      => $userId,
            'token_hash'   => $hash,
            'type'         => $type,
            'target_email' => strtolower(trim($targetEmail)),
            'meta_json'    => json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'expires_at'   => $expiresAt,
            'used_at'      => null,
            'created_at'   => $now
        ]);

        return [
            'id'         => (int)$id,
            'token'      => $rawToken,
            'token_hash' => $hash,
            'expires_at' => $expiresAt
        ];
    }

    /**
     * Looks up a valid (unexpired, unused) token record by raw token & expected type.
     */
    public static function findValidToken(string $projectRoot, string $rawToken, string $type): ?array {
        $clean = trim($rawToken);
        if ($clean === '' || strlen($clean) < 16) {
            return null;
        }
        $store = AtelierStore::forRoot($projectRoot);
        $row = $store->selectOne('auth_tokens', [
            'token_hash' => self::hashToken($clean),
            'type'       => $type
        ]);
        if (!$row) {
            return null;
        }
        if (!empty($row['used_at'])) {
            return null;
        }
        if ((int)($row['expires_at'] ?? 0) < time()) {
            return null;
        }
        return $row;
    }

    /**
     * Validates an invite token without consuming it (for UI pre-fill).
     */
    public static function inspectInvite(string $projectRoot, string $rawToken): array {
        $row = self::findValidToken($projectRoot, $rawToken, 'invite');
        if (!$row) {
            return ['success' => false, 'status' => 404, 'error' => 'Invitation invalid or expired.'];
        }
        $meta = @json_decode((string)($row['meta_json'] ?? '{}'), true) ?: [];
        return [
            'success'      => true,
            'status'       => 200,
            'target_email' => (string)($row['target_email'] ?? ''),
            'role'         => (string)($meta['role'] ?? 'user'),
            'expires_at'   => (int)$row['expires_at']
        ];
    }

    /**
     * Autonomous user self-registration honoring Admin policy (`disabled`, `invite_only`, `approval`, `open`).
     */
    public static function registerAccount(string $projectRoot, string $mediaDir, array $input, string $lang = 'fr'): array {
        $cfg = AuthSettings::load($projectRoot);
        $mode = (string)($cfg['registration_mode'] ?? 'disabled');

        // Anti-bot invisible honeypot check
        if (!empty($input['website']) || !empty($input['company_url'])) {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid registration payload.'];
        }

        $inviteToken = trim((string)($input['invite_token'] ?? ''));
        $inviteRow = null;
        $inviteMeta = [];

        if ($mode === 'disabled') {
            return ['success' => false, 'status' => 403, 'error' => 'Self-registration is disabled by the administrator.'];
        }

        if ($mode === 'invite_only') {
            if ($inviteToken === '') {
                return ['success' => false, 'status' => 403, 'error' => 'An invitation link or code is required to register.'];
            }
            $inviteRow = self::findValidToken($projectRoot, $inviteToken, 'invite');
            if (!$inviteRow) {
                return ['success' => false, 'status' => 403, 'error' => 'Invitation link is invalid or expired.'];
            }
            $inviteMeta = @json_decode((string)($inviteRow['meta_json'] ?? '{}'), true) ?: [];
        } elseif ($inviteToken !== '') {
            $inviteRow = self::findValidToken($projectRoot, $inviteToken, 'invite');
            if ($inviteRow) {
                $inviteMeta = @json_decode((string)($inviteRow['meta_json'] ?? '{}'), true) ?: [];
            }
        }

        // Rate limit by IP
        $ipKey = 'register_' . RateLimiter::getClientIp();
        if (!RateLimiter::check($ipKey, 8, 900)) {
            return ['status' => 429, 'success' => false, 'error' => 'Too many registration attempts. Please try again later.'];
        }
        RateLimiter::increment($ipKey);

        $username = UserManager::sanitizeUsername((string)($input['username'] ?? ''));
        $displayName = trim((string)($input['display_name'] ?? $username));
        $email = strtolower(trim((string)($input['email'] ?? '')));
        $password = (string)($input['password'] ?? '');
        $minLen = max(6, (int)($cfg['min_password_length'] ?? 8));

        if ($username === '' || strlen($username) < 2 || strlen($username) > 40) {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid username (2-40 chars, a-z0-9._-).'];
        }
        if (in_array($username, ['admin', 'root', 'superadmin', 'shared', 'public', 'private', 'system', 'storage', 'guest'], true)) {
            return ['success' => false, 'status' => 400, 'error' => 'Reserved username.'];
        }
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return ['success' => false, 'status' => 400, 'error' => 'Valid email address is required.'];
        }

        // If invite was locked to a specific email address, enforce exact match
        if ($inviteRow && !empty($inviteRow['target_email']) && strtolower((string)$inviteRow['target_email']) !== $email) {
            return ['success' => false, 'status' => 403, 'error' => 'This invitation is restricted to another email address.'];
        }

        if (!AuthSettings::isEmailDomainAllowed($email, $cfg)) {
            return ['success' => false, 'status' => 403, 'error' => 'This email domain is not allowed on this server.'];
        }
        if (strlen($password) < $minLen) {
            return ['success' => false, 'status' => 400, 'error' => "Password must be at least {$minLen} characters."];
        }

        if (UserManager::findByUsername($projectRoot, $username) !== null) {
            return ['success' => false, 'status' => 409, 'error' => 'Username already exists.'];
        }
        if (UserManager::findByEmail($projectRoot, $email) !== null) {
            return ['success' => false, 'status' => 409, 'error' => 'An account with this email already exists.'];
        }

        $requireVerify = !empty($cfg['require_email_verification']);
        // Invited user whose email matches target_email can still verify email if require_email_verification is enabled
        $needsApproval = ($mode === 'approval' && $inviteRow === null);
        $activateNow = !$requireVerify && !$needsApproval;
        $role = ($inviteRow && in_array($inviteMeta['role'] ?? 'user', ['user', 'admin'], true))
            ? (string)$inviteMeta['role']
            : 'user';
        $quotaBytes = max(0, (int)($cfg['default_quota_mb'] ?? 0)) * 1024 * 1024;
        if ($inviteRow && isset($inviteMeta['quota_bytes'])) {
            $quotaBytes = max(0, (int)$inviteMeta['quota_bytes']);
        }

        $created = UserManager::createUser($projectRoot, $mediaDir, [
            'username'          => $username,
            'display_name'      => $displayName !== '' ? $displayName : $username,
            'email'             => $email,
            'password'          => $password,
            'role'              => $role,
            'quota_bytes'       => $quotaBytes,
            'is_active'         => $activateNow ? 1 : 0,
            'approval_status'   => $needsApproval ? 'pending' : 'approved',
            'email_verified_at' => $requireVerify ? null : time(),
            'create_home'       => $activateNow
        ]);

        if (empty($created['success'])) {
            return $created;
        }

        $userId = (int)$created['user']['id'];
        $store = AtelierStore::forRoot($projectRoot);

        // Assign default groups configured by admin (or invite group_ids)
        $groupIds = is_array($cfg['default_group_ids'] ?? null) ? $cfg['default_group_ids'] : [];
        if ($inviteRow && !empty($inviteMeta['group_ids']) && is_array($inviteMeta['group_ids'])) {
            $groupIds = array_values(array_unique(array_merge($groupIds, $inviteMeta['group_ids'])));
        }
        $now = time();
        foreach ($groupIds as $gid) {
            $gid = (int)$gid;
            if ($gid > 0 && $store->selectOne('groups', ['id' => $gid]) !== null) {
                try {
                    $store->insert('group_members', [
                        'group_id' => $gid,
                        'user_id'  => $userId,
                        'role'     => 'member',
                        'added_at' => $now
                    ]);
                } catch (\Throwable $e) {}
            }
        }

        // Consume invite token if used
        if ($inviteRow) {
            $store->update('auth_tokens', ['used_at' => $now], ['id' => (int)$inviteRow['id']]);
        }

        $mailResult = null;
        if ($requireVerify) {
            $ttlHours = max(1, (int)($cfg['email_verify_ttl_hours'] ?? 24));
            $issued = self::issueToken($projectRoot, 'email_verify', $userId, $email, $ttlHours * 3600);
            $baseUrl = AuthSettings::resolvePublicBaseUrl($cfg);
            $verifyLink = $baseUrl . '/?verify_email=' . urlencode($issued['token']);
            $mailResult = Mailer::sendTemplate($projectRoot, $email, 'verify_email', [
                'brand'    => (string)($cfg['mail_from_name'] ?? 'Atelier by GallusTech'),
                'username' => $displayName !== '' ? $displayName : $username,
                'link'     => $verifyLink,
                'ttl'      => $ttlHours . 'h'
            ], $lang);
        }

        AuditLogger::log($projectRoot, 'user_register', 'users/' . $username, 'ok', [
            'mode'           => $mode,
            'email'          => $email,
            'require_verify' => $requireVerify,
            'needs_approval' => $needsApproval,
            'activated_now'  => $activateNow
        ]);

        return [
            'success'                    => true,
            'status'                     => 200,
            'user'                       => $created['user'],
            'requires_email_verification'=> $requireVerify,
            'requires_admin_approval'    => $needsApproval,
            'activated'                  => $activateNow,
            'mail_sent'                  => $mailResult ? !empty($mailResult['success']) : true,
            'mail_error'                 => ($mailResult && empty($mailResult['success'])) ? ($mailResult['error'] ?? null) : null
        ];
    }

    /**
     * Verifies an email token, activates the account (or transitions to pending approval),
     * and creates the isolated `storage/users/<username>` home directory upon activation.
     */
    public static function verifyEmailToken(string $projectRoot, string $mediaDir, string $rawToken): array {
        $row = self::findValidToken($projectRoot, $rawToken, 'email_verify');
        if (!$row || empty($row['user_id'])) {
            return ['success' => false, 'status' => 400, 'error' => 'Verification link is invalid or has expired.'];
        }

        $store = AtelierStore::forRoot($projectRoot);
        $userId = (int)$row['user_id'];
        $user = $store->selectOne('users', ['id' => $userId]);
        if (!$user) {
            return ['success' => false, 'status' => 404, 'error' => 'Associated account not found.'];
        }

        $now = time();
        $store->update('auth_tokens', ['used_at' => $now], ['id' => (int)$row['id']]);

        $approval = (string)($user['approval_status'] ?? 'approved');
        $shouldActivate = ($approval === 'approved');
        $patch = [
            'email_verified_at' => $now,
            'updated_at'        => $now
        ];

        if ($shouldActivate) {
            $patch['is_active'] = 1;
            $patch['home_dir'] = UserManager::ensureUserHomeDir($mediaDir, (string)$user['username'], (string)($user['display_name'] ?? ''));
        }

        $store->update('users', $patch, ['id' => $userId]);
        $fresh = UserManager::findById($projectRoot, $userId);

        AuditLogger::log($projectRoot, 'email_verified', (string)$fresh['home_dir'], 'ok', [
            'username'  => $fresh['username'],
            'activated' => $shouldActivate
        ]);

        return [
            'success'                 => true,
            'status'                  => 200,
            'activated'               => $shouldActivate,
            'requires_admin_approval' => !$shouldActivate,
            'user'                    => UserManager::sanitizeUserForOutput($fresh)
        ];
    }

    /**
     * Resends a verification email for an unverified account (rate-limited, anti-enumeration).
     */
    public static function resendVerification(string $projectRoot, string $email, string $lang = 'fr'): array {
        $cleanEmail = strtolower(trim($email));
        if ($cleanEmail === '' || !filter_var($cleanEmail, FILTER_VALIDATE_EMAIL)) {
            return ['success' => false, 'status' => 400, 'error' => 'Valid email address is required.'];
        }

        $rlKey = 'resend_verify_' . md5($cleanEmail . '|' . RateLimiter::getClientIp());
        if (!RateLimiter::check($rlKey, 3, 900)) {
            return ['success' => false, 'status' => 429, 'error' => 'Please wait before requesting another verification email.'];
        }
        RateLimiter::increment($rlKey);

        $user = UserManager::findByEmail($projectRoot, $cleanEmail);
        if ($user && empty($user['email_verified_at']) && (string)($user['approval_status'] ?? 'approved') !== 'rejected') {
            $cfg = AuthSettings::load($projectRoot);
            $ttlHours = max(1, (int)($cfg['email_verify_ttl_hours'] ?? 24));
            $issued = self::issueToken($projectRoot, 'email_verify', (int)$user['id'], $cleanEmail, $ttlHours * 3600);
            $verifyLink = AuthSettings::resolvePublicBaseUrl($cfg) . '/?verify_email=' . urlencode($issued['token']);
            Mailer::sendTemplate($projectRoot, $cleanEmail, 'verify_email', [
                'brand'    => (string)($cfg['mail_from_name'] ?? 'Atelier by GallusTech'),
                'username' => (string)($user['display_name'] ?? $user['username']),
                'link'     => $verifyLink,
                'ttl'      => $ttlHours . 'h'
            ], $lang);
        }

        // Uniform anti-enumeration response
        return ['success' => true, 'status' => 200];
    }

    /**
     * Initiates a password reset email (rate-limited, anti-enumeration).
     */
    public static function requestPasswordReset(string $projectRoot, string $email, string $lang = 'fr'): array {
        $cfg = AuthSettings::load($projectRoot);
        if (empty($cfg['allow_password_reset'])) {
            return ['success' => false, 'status' => 403, 'error' => 'Password reset is disabled by the administrator.'];
        }

        $cleanEmail = strtolower(trim($email));
        if ($cleanEmail === '' || !filter_var($cleanEmail, FILTER_VALIDATE_EMAIL)) {
            return ['success' => false, 'status' => 400, 'error' => 'Valid email address is required.'];
        }

        $rlKey = 'pwd_reset_' . md5($cleanEmail . '|' . RateLimiter::getClientIp());
        if (!RateLimiter::check($rlKey, 4, 900)) {
            return ['success' => false, 'status' => 429, 'error' => 'Too many reset requests. Please try again later.'];
        }
        RateLimiter::increment($rlKey);

        $user = UserManager::findByEmail($projectRoot, $cleanEmail);
        if ($user && !empty($user['is_active'])) {
            $ttlMin = max(10, (int)($cfg['password_reset_ttl_minutes'] ?? 60));
            $issued = self::issueToken($projectRoot, 'password_reset', (int)$user['id'], $cleanEmail, $ttlMin * 60);
            $resetLink = AuthSettings::resolvePublicBaseUrl($cfg) . '/?reset_password=' . urlencode($issued['token']);
            Mailer::sendTemplate($projectRoot, $cleanEmail, 'password_reset', [
                'brand'    => (string)($cfg['mail_from_name'] ?? 'Atelier by GallusTech'),
                'username' => (string)($user['display_name'] ?? $user['username']),
                'link'     => $resetLink,
                'ttl'      => $ttlMin . ' min'
            ], $lang);
            AuditLogger::log($projectRoot, 'password_reset_requested', (string)$user['home_dir'], 'ok', ['username' => $user['username']]);
        }

        // Uniform anti-enumeration response
        return ['success' => true, 'status' => 200];
    }

    /**
     * Confirms a password reset token and updates the account password.
     */
    public static function confirmPasswordReset(string $projectRoot, string $rawToken, string $newPassword): array {
        $cfg = AuthSettings::load($projectRoot);
        $minLen = max(6, (int)($cfg['min_password_length'] ?? 8));
        if (strlen($newPassword) < $minLen) {
            return ['success' => false, 'status' => 400, 'error' => "Password must be at least {$minLen} characters."];
        }

        $row = self::findValidToken($projectRoot, $rawToken, 'password_reset');
        if (!$row || empty($row['user_id'])) {
            return ['success' => false, 'status' => 400, 'error' => 'Password reset link is invalid or has expired.'];
        }

        $store = AtelierStore::forRoot($projectRoot);
        $userId = (int)$row['user_id'];
        $user = $store->selectOne('users', ['id' => $userId]);
        if (!$user) {
            return ['success' => false, 'status' => 404, 'error' => 'Account not found.'];
        }

        $now = time();
        $store->update('auth_tokens', ['used_at' => $now], ['id' => (int)$row['id']]);
        $store->update('users', [
            'password_hash' => UserManager::hashPassword($newPassword),
            'updated_at'    => $now
        ], ['id' => $userId]);

        AuditLogger::log($projectRoot, 'password_reset_completed', (string)$user['home_dir'], 'ok', ['username' => $user['username']]);
        return ['success' => true, 'status' => 200];
    }

    // -------------------------------------------------------------------------
    // Admin Invitations & Pending Account Approvals
    // -------------------------------------------------------------------------

    public static function createInvite(string $projectRoot, array $input, string $lang = 'fr'): array {
        $cfg = AuthSettings::load($projectRoot);
        $email = strtolower(trim((string)($input['email'] ?? '')));
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid email address.'];
        }

        $role = in_array($input['role'] ?? 'user', ['user', 'admin'], true) ? (string)($input['role'] ?? 'user') : 'user';
        $ttlDays = max(1, min(90, (int)($input['ttl_days'] ?? ($cfg['invite_ttl_days'] ?? 7))));
        $sendMail = !empty($input['send_email']) && $email !== '';
        $quotaMb = isset($input['quota_mb']) ? max(0, (int)$input['quota_mb']) : (int)($cfg['default_quota_mb'] ?? 0);
        $groupIds = is_array($input['group_ids'] ?? null)
            ? array_values(array_unique(array_filter(array_map('intval', $input['group_ids']), function ($v) { return $v > 0; })))
            : (is_array($cfg['default_group_ids'] ?? null) ? $cfg['default_group_ids'] : []);

        $cur = AuthManager::getCurrentUser();
        $issued = self::issueToken($projectRoot, 'invite', $cur ? (int)$cur['id'] : null, $email, $ttlDays * 86400, [
            'role'        => $role,
            'quota_bytes' => $quotaMb * 1024 * 1024,
            'group_ids'   => $groupIds,
            'created_by'  => $cur ? (string)$cur['username'] : 'admin'
        ]);

        $inviteUrl = AuthSettings::resolvePublicBaseUrl($cfg) . '/?invite=' . urlencode($issued['token']);
        $mailRes = null;
        if ($sendMail) {
            $mailRes = Mailer::sendTemplate($projectRoot, $email, 'invite', [
                'brand' => (string)($cfg['mail_from_name'] ?? 'Atelier by GallusTech'),
                'link'  => $inviteUrl,
                'ttl'   => $ttlDays . 'd'
            ], $lang);
        }

        AuditLogger::log($projectRoot, 'invite_create', $email ?: 'open-invite', 'ok', ['invite_id' => $issued['id'], 'role' => $role]);

        return [
            'success'    => true,
            'status'     => 200,
            'invite'     => [
                'id'           => $issued['id'],
                'token'        => $issued['token'],
                'url'          => $inviteUrl,
                'target_email' => $email,
                'role'         => $role,
                'expires_at'   => $issued['expires_at']
            ],
            'mail_sent'  => $mailRes ? !empty($mailRes['success']) : false,
            'mail_error' => ($mailRes && empty($mailRes['success'])) ? ($mailRes['error'] ?? null) : null
        ];
    }

    public static function listInvites(string $projectRoot): array {
        $store = AtelierStore::forRoot($projectRoot);
        $rows = $store->select('auth_tokens', ['type' => 'invite'], ['created_at' => 'DESC'], 100);
        $now = time();
        $out = [];
        foreach ($rows as $r) {
            $meta = @json_decode((string)($r['meta_json'] ?? '{}'), true) ?: [];
            $out[] = [
                'id'           => (int)$r['id'],
                'target_email' => (string)($r['target_email'] ?? ''),
                'role'         => (string)($meta['role'] ?? 'user'),
                'created_by'   => (string)($meta['created_by'] ?? 'admin'),
                'created_at'   => (int)($r['created_at'] ?? 0),
                'expires_at'   => (int)($r['expires_at'] ?? 0),
                'used_at'      => isset($r['used_at']) && $r['used_at'] !== null ? (int)$r['used_at'] : null,
                'is_expired'   => (int)($r['expires_at'] ?? 0) < $now,
                'is_active'    => empty($r['used_at']) && (int)($r['expires_at'] ?? 0) >= $now
            ];
        }
        return $out;
    }

    public static function revokeInvite(string $projectRoot, int $inviteId): array {
        $store = AtelierStore::forRoot($projectRoot);
        $row = $store->selectOne('auth_tokens', ['id' => $inviteId, 'type' => 'invite']);
        if (!$row) {
            return ['success' => false, 'status' => 404, 'error' => 'Invite not found.'];
        }
        $store->update('auth_tokens', ['used_at' => time()], ['id' => $inviteId]);
        AuditLogger::log($projectRoot, 'invite_revoke', (string)($row['target_email'] ?? ''), 'ok', ['invite_id' => $inviteId]);
        return ['success' => true, 'status' => 200];
    }

    public static function approveUser(string $projectRoot, string $mediaDir, int $userId, string $lang = 'fr'): array {
        $store = AtelierStore::forRoot($projectRoot);
        $user = $store->selectOne('users', ['id' => $userId]);
        if (!$user) {
            return ['success' => false, 'status' => 404, 'error' => 'User not found.'];
        }

        $now = time();
        $homeDir = UserManager::ensureUserHomeDir($mediaDir, (string)$user['username'], (string)($user['display_name'] ?? ''));
        $patch = [
            'approval_status' => 'approved',
            'is_active'       => 1,
            'home_dir'        => $homeDir,
            'updated_at'      => $now
        ];
        if (empty($user['email_verified_at']) && !empty($user['email'])) {
            $patch['email_verified_at'] = $now;
        }
        $store->update('users', $patch, ['id' => $userId]);

        $cfg = AuthSettings::load($projectRoot);
        if (!empty($user['email'])) {
            Mailer::sendTemplate($projectRoot, (string)$user['email'], 'account_approved', [
                'brand'    => (string)($cfg['mail_from_name'] ?? 'Atelier by GallusTech'),
                'username' => (string)($user['display_name'] ?? $user['username']),
                'link'     => AuthSettings::resolvePublicBaseUrl($cfg) . '/'
            ], $lang);
        }

        AuditLogger::log($projectRoot, 'user_approve', $homeDir, 'ok', ['username' => $user['username']]);
        return [
            'success' => true,
            'status'  => 200,
            'user'    => UserManager::sanitizeUserForOutput(UserManager::findById($projectRoot, $userId))
        ];
    }

    public static function rejectUser(string $projectRoot, int $userId): array {
        $store = AtelierStore::forRoot($projectRoot);
        $user = $store->selectOne('users', ['id' => $userId]);
        if (!$user) {
            return ['success' => false, 'status' => 404, 'error' => 'User not found.'];
        }

        $store->update('users', [
            'approval_status' => 'rejected',
            'is_active'       => 0,
            'updated_at'      => time()
        ], ['id' => $userId]);

        AuditLogger::log($projectRoot, 'user_reject', (string)$user['home_dir'], 'ok', ['username' => $user['username']]);
        return [
            'success' => true,
            'status'  => 200,
            'user'    => UserManager::sanitizeUserForOutput(UserManager::findById($projectRoot, $userId))
        ];
    }
}
