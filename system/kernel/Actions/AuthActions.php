<?php
namespace SimpleGallery\Kernel\Actions;

use SimpleGallery\Kernel\Auth\AuditLogger;
use SimpleGallery\Kernel\Auth\AuthManager;
use SimpleGallery\Kernel\Auth\AuthSettings;
use SimpleGallery\Kernel\Auth\OidcProvider;
use SimpleGallery\Kernel\Auth\RegistrationService;
use SimpleGallery\Kernel\Auth\SessionRegistry;
use SimpleGallery\Kernel\Auth\ShareManager;
use SimpleGallery\Kernel\Auth\TotpManager;
use SimpleGallery\Kernel\Auth\UserManager;
use SimpleGallery\Kernel\Config\ConfigStore;
use SimpleGallery\Kernel\Data\AtelierStore;
use SimpleGallery\Kernel\FS\PermissionsManager;
use SimpleGallery\Kernel\Mail\Mailer;
use SimpleGallery\Kernel\Security\RateLimiter;

class AuthActions {

    public static function handle(string $action, array $params, $context): ?array {
        $base_dir = is_array($context) ? ($context['base_dir'] ?? '') : (string)$context;
        $project_root = (is_array($context) && !empty($context['project_root']))
            ? (string)$context['project_root']
            : ConfigStore::resolveRoot($base_dir);
        $raw_body = is_array($context) ? ($context['raw_body'] ?? $params) : $params;
        $in = array_merge($_GET, $_POST, is_array($raw_body) ? $raw_body : []);
        $lang = strtolower(trim((string)($in['lang'] ?? $_COOKIE['sg_lang'] ?? 'fr')));
        if (!in_array($lang, ['fr', 'en', 'ja'], true)) {
            $lang = 'fr';
        }

        if ($action === 'login') {
            $username = trim((string)($in['username'] ?? ''));
            $password = (string)($in['password'] ?? '');
            $totpCode = trim((string)($in['totp_code'] ?? ''));
            $ip_key = 'login_' . RateLimiter::getClientIp();

            if (!RateLimiter::check($ip_key, 5, 900)) {
                return ['status' => 429, 'data' => ['success' => false, 'error' => __t('api.err_rate_limit')]];
            }

            // 1. Multi-user account authentication when a username (or email) is supplied
            if ($username !== '') {
                $detail = UserManager::authenticateDetailed($project_root, $username, $password);

                if (!empty($detail['ok'])) {
                    $rawUser = $detail['raw'];
                    $authUser = $detail['user'];
                    $cfg = AuthSettings::load($project_root);
                    $has2fa = !empty($rawUser['totp_secret']) && !empty($rawUser['totp_confirmed_at']);
                    $totpRequired = AuthSettings::isTotpRequiredForRole((string)($rawUser['role'] ?? 'user'), $cfg);

                    // Case A: Account has 2FA enabled
                    if ($has2fa) {
                        if ($totpCode !== '') {
                            $v = TotpManager::verifyUserLoginCode($project_root, $rawUser, $totpCode);
                            if (empty($v['ok'])) {
                                RateLimiter::increment($ip_key);
                                AuditLogger::log($project_root, 'user_login_2fa', (string)$rawUser['home_dir'], 'failed', ['username' => $rawUser['username']]);
                                return ['status' => 401, 'data' => [
                                    'success'      => false,
                                    'requires_2fa' => true,
                                    'error'        => $v['error'] ?? 'Invalid 2FA code.'
                                ]];
                            }
                            RateLimiter::reset($ip_key);
                            unset($_SESSION['sg_2fa_pending']);
                            $freshUser = UserManager::sanitizeUserForOutput(UserManager::findById($project_root, (int)$rawUser['id']));
                            AuthManager::loginUserSession($freshUser, $project_root);
                            AuditLogger::log($project_root, 'user_login', $freshUser['home_dir'], 'ok', ['username' => $freshUser['username'], '2fa' => true]);
                            return ['status' => 200, 'data' => [
                                'success'                  => true,
                                'message'                  => __t('api.msg_auth_success'),
                                'user'                     => $freshUser,
                                'is_admin'                 => AuthManager::isAdminLoggedIn(),
                                'mounted_volumes'          => ShareManager::getMountedVolumesForCurrentUser($base_dir),
                                'used_recovery_code'       => !empty($v['used_recovery']),
                                'remaining_recovery_codes' => $v['remaining_recovery_codes'] ?? null,
                                'csrf_token'               => get_csrf_token()
                            ]];
                        }

                        // Step 1 complete: create pending 2FA challenge ONLY (do NOT elevate session yet!)
                        AuthManager::ensureSessionStarted();
                        $_SESSION['sg_2fa_pending'] = [
                            'user_id'    => (int)$rawUser['id'],
                            'mode'       => 'verify',
                            'expires_at' => time() + 300
                        ];
                        return ['status' => 200, 'data' => [
                            'success'      => false,
                            'requires_2fa' => true,
                            'username'     => $authUser['username']
                        ]];
                    }

                    // Case B: Admin policy mandates 2FA enrollment for this role before granting full access
                    if ($totpRequired && ($cfg['totp_policy'] ?? 'optional') !== 'disabled') {
                        AuthManager::ensureSessionStarted();
                        $_SESSION['sg_2fa_pending'] = [
                            'user_id'    => (int)$rawUser['id'],
                            'mode'       => 'setup',
                            'expires_at' => time() + 600
                        ];
                        $setup = TotpManager::beginSetup($project_root, (int)$rawUser['id']);
                        return ['status' => 200, 'data' => [
                            'success'            => false,
                            'requires_2fa_setup' => true,
                            'username'           => $authUser['username'],
                            'setup'              => $setup
                        ]];
                    }

                    // Case C: Standard login complete
                    RateLimiter::reset($ip_key);
                    $store = AtelierStore::forRoot($project_root);
                    $now = time();
                    $store->update('users', ['last_login_at' => $now], ['id' => (int)$rawUser['id']]);
                    $authUser['last_login_at'] = $now;
                    unset($_SESSION['sg_2fa_pending']);
                    AuthManager::loginUserSession($authUser, $project_root);
                    AuditLogger::log($project_root, 'user_login', $authUser['home_dir'], 'ok', ['username' => $authUser['username']]);
                    return ['status' => 200, 'data' => [
                        'success'         => true,
                        'message'         => __t('api.msg_auth_success'),
                        'user'            => $authUser,
                        'is_admin'        => AuthManager::isAdminLoggedIn(),
                        'mounted_volumes' => ShareManager::getMountedVolumesForCurrentUser($base_dir),
                        'csrf_token'      => get_csrf_token()
                    ]];
                }

                // Clear contextual status when password matched an inactive/unverified/pending account
                $reason = (string)($detail['reason'] ?? 'invalid_credentials');
                if ($reason === 'email_unverified') {
                    return ['status' => 403, 'data' => [
                        'success' => false,
                        'code'    => 'email_unverified',
                        'email'   => (string)($detail['email'] ?? ''),
                        'error'   => 'Please verify your email address before signing in.'
                    ]];
                }
                if ($reason === 'pending_approval') {
                    return ['status' => 403, 'data' => [
                        'success' => false,
                        'code'    => 'pending_approval',
                        'error'   => 'Your account is pending administrator approval.'
                    ]];
                }
                if ($reason === 'account_rejected') {
                    return ['status' => 403, 'data' => [
                        'success' => false,
                        'code'    => 'account_rejected',
                        'error'   => 'This account registration was declined by the administrator.'
                    ]];
                }

                // Allow 'admin' username to fall through to legacy .admin_password_hash if no SQLite 'admin' user exists
                if (strtolower($username) !== 'admin' || UserManager::findByUsername($project_root, 'admin') !== null) {
                    RateLimiter::increment($ip_key);
                    AuditLogger::log($project_root, 'user_login', '', 'failed', ['username' => $username]);
                    return ['status' => 401, 'data' => ['success' => false, 'error' => __t('api.err_invalid_password')]];
                }
            }

            // 2. Legacy single-admin authentication (.admin_password_hash)
            $admin_hash = AuthManager::getPasswordHash('', $base_dir);

            if (!empty($admin_hash) && password_verify($password, $admin_hash)) {
                RateLimiter::reset($ip_key);
                AuthManager::ensureSessionStarted();
                if (PHP_SAPI !== 'cli' && session_status() === PHP_SESSION_ACTIVE && !headers_sent()) {
                    @session_regenerate_id(true);
                }
                unset($_SESSION['sg_user'], $_SESSION['sg_2fa_pending']);
                $_SESSION['sg_admin_logged'] = true;
                $_SESSION['is_admin'] = true;
                SessionRegistry::registerCurrentSession($project_root, null, 'admin');
                AuditLogger::log($project_root, 'admin_login', '', 'ok');

                return ['status' => 200, 'data' => [
                    'success'    => true,
                    'message'    => __t('api.msg_auth_success'),
                    'user'       => null,
                    'is_admin'   => true,
                    'csrf_token' => get_csrf_token()
                ]];
            }

            RateLimiter::increment($ip_key);
            return ['status' => 401, 'data' => ['success' => false, 'error' => __t('api.err_invalid_password')]];
        }

        if ($action === 'verify_2fa_login') {
            AuthManager::ensureSessionStarted();
            $pending = $_SESSION['sg_2fa_pending'] ?? null;
            if (!is_array($pending) || empty($pending['user_id']) || (int)($pending['expires_at'] ?? 0) < time()) {
                unset($_SESSION['sg_2fa_pending']);
                return ['status' => 401, 'data' => ['success' => false, 'error' => '2FA session expired. Please sign in again.']];
            }

            $ip_key = '2fa_' . RateLimiter::getClientIp();
            if (!RateLimiter::check($ip_key, 6, 900)) {
                return ['status' => 429, 'data' => ['success' => false, 'error' => __t('api.err_rate_limit')]];
            }

            $code = trim((string)($in['totp_code'] ?? $in['code'] ?? ''));
            $userId = (int)$pending['user_id'];
            $mode = (string)($pending['mode'] ?? 'verify');
            $rawUser = UserManager::findById($project_root, $userId);
            if (!$rawUser || empty($rawUser['is_active'])) {
                unset($_SESSION['sg_2fa_pending']);
                return ['status' => 401, 'data' => ['success' => false, 'error' => 'Account unavailable.']];
            }

            if ($mode === 'setup') {
                $res = TotpManager::confirmSetup($project_root, $userId, $code);
                if (empty($res['success'])) {
                    RateLimiter::increment($ip_key);
                    return ['status' => $res['status'] ?? 400, 'data' => $res];
                }
                RateLimiter::reset($ip_key);
                unset($_SESSION['sg_2fa_pending']);
                $store = AtelierStore::forRoot($project_root);
                $store->update('users', ['last_login_at' => time()], ['id' => $userId]);
                $freshUser = UserManager::sanitizeUserForOutput(UserManager::findById($project_root, $userId));
                AuthManager::loginUserSession($freshUser, $project_root);
                AuditLogger::log($project_root, 'user_login', $freshUser['home_dir'], 'ok', ['username' => $freshUser['username'], '2fa_enrolled' => true]);
                return ['status' => 200, 'data' => [
                    'success'         => true,
                    'message'         => __t('api.msg_auth_success'),
                    'user'            => $freshUser,
                    'is_admin'        => AuthManager::isAdminLoggedIn(),
                    'mounted_volumes' => ShareManager::getMountedVolumesForCurrentUser($base_dir),
                    'recovery_codes'  => $res['recovery_codes'] ?? [],
                    'csrf_token'      => get_csrf_token()
                ]];
            }

            $v = TotpManager::verifyUserLoginCode($project_root, $rawUser, $code);
            if (empty($v['ok'])) {
                RateLimiter::increment($ip_key);
                AuditLogger::log($project_root, 'user_login_2fa', (string)$rawUser['home_dir'], 'failed', ['username' => $rawUser['username']]);
                return ['status' => 401, 'data' => ['success' => false, 'error' => $v['error'] ?? 'Invalid 2FA code.']];
            }

            RateLimiter::reset($ip_key);
            unset($_SESSION['sg_2fa_pending']);
            $freshUser = UserManager::sanitizeUserForOutput(UserManager::findById($project_root, $userId));
            AuthManager::loginUserSession($freshUser, $project_root);
            AuditLogger::log($project_root, 'user_login', $freshUser['home_dir'], 'ok', ['username' => $freshUser['username'], '2fa' => true]);
            return ['status' => 200, 'data' => [
                'success'                  => true,
                'message'                  => __t('api.msg_auth_success'),
                'user'                     => $freshUser,
                'is_admin'                 => AuthManager::isAdminLoggedIn(),
                'mounted_volumes'          => ShareManager::getMountedVolumesForCurrentUser($base_dir),
                'used_recovery_code'       => !empty($v['used_recovery']),
                'remaining_recovery_codes' => $v['remaining_recovery_codes'] ?? null,
                'csrf_token'               => get_csrf_token()
            ]];
        }

        if ($action === 'logout') {
            AuditLogger::log($project_root, 'logout', '', 'ok');
            AuthManager::logoutSession($project_root);
            return ['status' => 200, 'data' => ['success' => true, 'message' => __t('api.msg_logged_out')]];
        }

        // ---------------------------------------------------------------------
        // Phase A.2 — Active Sessions Management & Remote Revocation
        // ---------------------------------------------------------------------

        if ($action === 'list_sessions') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $cur = AuthManager::getCurrentUser();
            $isAdmin = AuthManager::isAdminLoggedIn();
            $includeAll = $isAdmin && (!empty($in['all']) || !$cur);
            $sessions = SessionRegistry::listSessions($project_root, $cur ? (int)$cur['id'] : null, $includeAll);
            return ['status' => 200, 'data' => ['success' => true, 'sessions' => $sessions]];
        }

        if ($action === 'revoke_session') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $cur = AuthManager::getCurrentUser();
            $sid = (int)($in['session_id'] ?? $in['id'] ?? 0);
            $res = SessionRegistry::revokeSession($project_root, $sid, $cur ? (int)$cur['id'] : null, AuthManager::isAdminLoggedIn());
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'revoke_other_sessions') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $cur = AuthManager::getCurrentUser();
            $res = SessionRegistry::revokeOtherSessions($project_root, $cur ? (int)$cur['id'] : null);
            return ['status' => $res['status'], 'data' => $res];
        }

        // ---------------------------------------------------------------------
        // Phase A.2 — OpenID Connect (OIDC) SSO Login
        // ---------------------------------------------------------------------

        if ($action === 'oidc_start') {
            $res = OidcProvider::beginLogin($project_root);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'oidc_complete') {
            $code = (string)($in['code'] ?? '');
            $state = (string)($in['state'] ?? '');
            $res = OidcProvider::completeCallback($project_root, $base_dir, $code, $state);
            return ['status' => $res['status'], 'data' => $res];
        }

        // ---------------------------------------------------------------------
        // Phase A.2 — Public Self-Registration, Email Verification & Password Reset
        // ---------------------------------------------------------------------

        if ($action === 'get_auth_policy') {
            return ['status' => 200, 'data' => [
                'success' => true,
                'policy'  => AuthSettings::getPublicPolicy($project_root)
            ]];
        }

        if ($action === 'inspect_invite') {
            $token = (string)($in['token'] ?? $in['invite'] ?? '');
            $res = RegistrationService::inspectInvite($project_root, $token);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'register_account') {
            $res = RegistrationService::registerAccount($project_root, $base_dir, $in, $lang);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'verify_email') {
            $token = (string)($in['token'] ?? '');
            $res = RegistrationService::verifyEmailToken($project_root, $base_dir, $token);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'resend_verification') {
            $email = (string)($in['email'] ?? '');
            $res = RegistrationService::resendVerification($project_root, $email, $lang);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'request_password_reset') {
            $email = (string)($in['email'] ?? '');
            $res = RegistrationService::requestPasswordReset($project_root, $email, $lang);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'confirm_password_reset') {
            $token = (string)($in['token'] ?? '');
            $newPwd = (string)($in['password'] ?? $in['new_password'] ?? '');
            $res = RegistrationService::confirmPasswordReset($project_root, $token, $newPwd);
            return ['status' => $res['status'], 'data' => $res];
        }

        // ---------------------------------------------------------------------
        // Phase A.2 — Self-Service 2FA Management (Authenticated Multi-User)
        // ---------------------------------------------------------------------

        if ($action === 'begin_2fa_setup') {
            $cur = AuthManager::getCurrentUser();
            if (!$cur) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => 'A multi-user account session is required to configure 2FA.']];
            }
            $res = TotpManager::beginSetup($project_root, (int)$cur['id']);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'confirm_2fa_setup') {
            $cur = AuthManager::getCurrentUser();
            if (!$cur) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => 'A multi-user account session is required to confirm 2FA.']];
            }
            $code = trim((string)($in['totp_code'] ?? $in['code'] ?? ''));
            $res = TotpManager::confirmSetup($project_root, (int)$cur['id'], $code);
            if (!empty($res['success']) && !empty($res['user'])) {
                $_SESSION['sg_user'] = $res['user'];
            }
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'disable_2fa') {
            $cur = AuthManager::getCurrentUser();
            $targetId = isset($in['user_id']) ? (int)$in['user_id'] : ($cur ? (int)$cur['id'] : 0);
            $isAdmin = AuthManager::isAdminLoggedIn();
            if ($targetId <= 0) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $adminBypass = $isAdmin && (!$cur || (int)$cur['id'] !== $targetId);
            if (!$adminBypass && (!$cur || (int)$cur['id'] !== $targetId)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $pwd = isset($in['password']) ? (string)$in['password'] : null;
            $res = TotpManager::disable($project_root, $targetId, $pwd, $adminBypass);
            if (!empty($res['success']) && $cur && (int)$cur['id'] === $targetId && !empty($res['user'])) {
                $_SESSION['sg_user'] = $res['user'];
            }
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'regenerate_recovery_codes') {
            $cur = AuthManager::getCurrentUser();
            if (!$cur) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $pwd = (string)($in['password'] ?? '');
            $res = TotpManager::regenerateRecoveryCodes($project_root, (int)$cur['id'], $pwd);
            return ['status' => $res['status'], 'data' => $res];
        }

        // ---------------------------------------------------------------------
        // Phase A.2 — Admin Auth Policy, Email/SMTP, Invites & Approvals
        // ---------------------------------------------------------------------

        if ($action === 'get_auth_settings') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $allUsers = UserManager::listUsers($project_root);
            $pendingUsers = array_values(array_filter($allUsers, function ($u) {
                return ($u['approval_status'] ?? 'approved') === 'pending' || (empty($u['is_active']) && ($u['approval_status'] ?? '') !== 'rejected');
            }));
            return ['status' => 200, 'data' => [
                'success'       => true,
                'settings'      => AuthSettings::getForAdminUi($project_root),
                'policy'        => AuthSettings::getPublicPolicy($project_root),
                'invites'       => RegistrationService::listInvites($project_root),
                'pending_users' => $pendingUsers,
                'outbox'        => Mailer::listOutbox($project_root, 15)
            ]];
        }

        if ($action === 'save_auth_settings') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $payload = $in['settings'] ?? $in;
            if (is_string($payload)) {
                $payload = @json_decode($payload, true) ?: [];
            }
            $res = AuthSettings::save($project_root, is_array($payload) ? $payload : []);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'send_test_email') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $to = trim((string)($in['email'] ?? $in['to'] ?? ''));
            $cfg = AuthSettings::load($project_root);
            $res = Mailer::sendTemplate($project_root, $to, 'test', [
                'brand' => (string)($cfg['mail_from_name'] ?? 'Atelier by GallusTech'),
                'link'  => AuthSettings::resolvePublicBaseUrl($cfg) . '/'
            ], $lang);
            return ['status' => !empty($res['success']) ? 200 : 400, 'data' => array_merge($res, [
                'outbox' => Mailer::listOutbox($project_root, 15)
            ])];
        }

        if ($action === 'list_invites') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            return ['status' => 200, 'data' => [
                'success' => true,
                'invites' => RegistrationService::listInvites($project_root)
            ]];
        }

        if ($action === 'create_invite') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $res = RegistrationService::createInvite($project_root, $in, $lang);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'revoke_invite') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $id = (int)($in['invite_id'] ?? $in['id'] ?? 0);
            $res = RegistrationService::revokeInvite($project_root, $id);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'approve_user') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $uid = (int)($in['user_id'] ?? $in['id'] ?? 0);
            $res = RegistrationService::approveUser($project_root, $base_dir, $uid, $lang);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'reject_user') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $uid = (int)($in['user_id'] ?? $in['id'] ?? 0);
            $res = RegistrationService::rejectUser($project_root, $uid);
            return ['status' => $res['status'], 'data' => $res];
        }

        // ---------------------------------------------------------------------
        // Existing Password, Permissions & Autostart Administration
        // ---------------------------------------------------------------------

        if ($action === 'change_password') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }

            $current_pass = $_POST['current_password'] ?? $raw_body['current_password'] ?? '';
            $new_pass     = $_POST['new_password'] ?? $raw_body['new_password'] ?? '';

            if (empty($new_pass) || strlen($new_pass) < 6) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_pwd_short')]];
            }

            $admin_hash = AuthManager::getPasswordHash('', $base_dir);
            if (!empty($admin_hash) && !password_verify($current_pass, $admin_hash)) {
                return ['status' => 401, 'data' => ['success' => false, 'error' => __t('api.err_current_pwd_invalid')]];
            }

            if (AuthManager::updatePasswordHash($new_pass, $base_dir)) {
                return ['status' => 200, 'data' => ['success' => true, 'message' => __t('api.msg_pwd_updated')]];
            }

            return ['status' => 500, 'data' => ['success' => false, 'error' => __t('api.err_pwd_save')]];
        }

        if ($action === 'get_permissions') {
            $perms = PermissionsManager::loadPermissions($project_root);
            return ['status' => 200, 'data' => [
                'success'     => true,
                'permissions' => $perms,
                'is_admin'    => AuthManager::isAdminLoggedIn()
            ]];
        }

        if ($action === 'save_permissions') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }

            $new_perms = $raw_body['permissions'] ?? $_POST['permissions'] ?? [];
            if (is_string($new_perms)) {
                $new_perms = json_decode($new_perms, true);
            }
            if (!is_array($new_perms)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_invalid_data')]];
            }

            if (PermissionsManager::savePermissions($project_root, $new_perms)) {
                return ['status' => 200, 'data' => [
                    'success'     => true,
                    'message'     => __t('api.msg_permissions_saved'),
                    'permissions' => PermissionsManager::loadPermissions($project_root)
                ]];
            }

            return ['status' => 500, 'data' => ['success' => false, 'error' => __t('api.err_permissions_save')]];
        }

        if ($action === 'get_autostart_settings') {
            $config = get_autostart_config($project_root);
            return ['status' => 200, 'data' => ['success' => true, 'autostart' => $config]];
        }

        if ($action === 'save_autostart_settings') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }

            $raw_autostart = $raw_body['autostart'] ?? $raw_body['config'] ?? $_POST['autostart'] ?? $_POST['config'] ?? null;
            if (is_string($raw_autostart)) {
                $raw_autostart = json_decode($raw_autostart, true);
            }

            if (!is_array($raw_autostart)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_invalid_data')]];
            }

            $saved = ConfigStore::set('autostart', $raw_autostart, $project_root);
            if ($saved) {
                return ['status' => 200, 'data' => ['success' => true, 'autostart' => $raw_autostart, 'message' => __t('settings.autostart_saved')]];
            }

            return ['status' => 500, 'data' => ['success' => false, 'error' => __t('settings.autostart_save_error')]];
        }

        return null;
    }
}
