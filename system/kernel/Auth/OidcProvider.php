<?php
/**
 * Atelier by GallusTech - Zero-Dependency OpenID Connect (OIDC) SSO Client (`OidcProvider`)
 * Supports standard OIDC Discovery (`/.well-known/openid-configuration`), Authorization Code + PKCE (S256),
 * `state` & `nonce` validation, ID Token / UserInfo claims extraction, and optional JIT account provisioning.
 * Compatible with Authentik, Keycloak, Authelia, Google, Okta, Azure AD / Entra ID, Zitadel, etc.
 */

namespace SimpleGallery\Kernel\Auth;

use SimpleGallery\Kernel\Data\AtelierStore;

class OidcProvider {

    /**
     * Generates a PKCE-protected OIDC authorization redirect URL and stores state/verifier/nonce in session.
     */
    public static function beginLogin(string $projectRoot): array {
        $cfg = AuthSettings::load($projectRoot);
        if (empty($cfg['oidc_enabled'])) {
            return ['success' => false, 'status' => 403, 'error' => 'SSO / OIDC is disabled by the administrator.'];
        }

        $issuer = rtrim(trim((string)($cfg['oidc_issuer_url'] ?? '')), '/');
        $clientId = trim((string)($cfg['oidc_client_id'] ?? ''));
        if ($issuer === '' || $clientId === '') {
            return ['success' => false, 'status' => 400, 'error' => 'OIDC issuer URL and Client ID must be configured.'];
        }

        $discovery = self::fetchDiscovery($issuer);
        if (empty($discovery['authorization_endpoint'])) {
            return ['success' => false, 'status' => 502, 'error' => 'Unable to load OIDC discovery document from issuer.'];
        }

        AuthManager::ensureSessionStarted();
        $state = bin2hex(random_bytes(16));
        $nonce = bin2hex(random_bytes(16));
        $verifier = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        $redirectUri = AuthSettings::resolvePublicBaseUrl($cfg) . '/?oidc_callback=1';
        $scopes = trim((string)($cfg['oidc_scopes'] ?? 'openid profile email')) ?: 'openid profile email';

        $_SESSION['sg_oidc_state'] = [
            'state'          => $state,
            'nonce'          => $nonce,
            'code_verifier'  => $verifier,
            'redirect_uri'   => $redirectUri,
            'token_endpoint' => (string)($discovery['token_endpoint'] ?? ''),
            'userinfo_ep'    => (string)($discovery['userinfo_endpoint'] ?? ''),
            'expires_at'     => time() + 600
        ];

        $authUrl = (string)$discovery['authorization_endpoint'] . '?' . http_build_query([
            'response_type'         => 'code',
            'client_id'             => $clientId,
            'redirect_uri'          => $redirectUri,
            'scope'                 => $scopes,
            'state'                 => $state,
            'nonce'                 => $nonce,
            'code_challenge'        => $challenge,
            'code_challenge_method' => 'S256'
        ]);

        return [
            'success'  => true,
            'status'   => 200,
            'auth_url' => $authUrl
        ];
    }

    /**
     * Completes an OIDC callback (`code` + `state`), exchanges token with PKCE verifier,
     * resolves user identity, and authenticates (or JIT-provisions) the Atelier account.
     */
    public static function completeCallback(string $projectRoot, string $mediaDir, string $code, string $state): array {
        AuthManager::ensureSessionStarted();
        $saved = $_SESSION['sg_oidc_state'] ?? null;
        unset($_SESSION['sg_oidc_state']);

        if (!is_array($saved) || (int)($saved['expires_at'] ?? 0) < time()) {
            return ['success' => false, 'status' => 400, 'error' => 'SSO login session expired. Please try again.'];
        }
        if ($code === '' || $state === '' || !hash_equals((string)($saved['state'] ?? ''), $state)) {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid OIDC state parameter.'];
        }

        $cfg = AuthSettings::load($projectRoot);
        $tokenEp = (string)($saved['token_endpoint'] ?? '');
        if ($tokenEp === '') {
            return ['success' => false, 'status' => 502, 'error' => 'OIDC token endpoint unavailable.'];
        }

        $postFields = [
            'grant_type'    => 'authorization_code',
            'code'          => $code,
            'redirect_uri'  => (string)$saved['redirect_uri'],
            'client_id'     => (string)($cfg['oidc_client_id'] ?? ''),
            'code_verifier' => (string)$saved['code_verifier']
        ];
        if (!empty($cfg['oidc_client_secret'])) {
            $postFields['client_secret'] = (string)$cfg['oidc_client_secret'];
        }

        $tokenResp = self::httpJsonPost($tokenEp, $postFields);
        if (!is_array($tokenResp) || (empty($tokenResp['id_token']) && empty($tokenResp['access_token']))) {
            return ['success' => false, 'status' => 401, 'error' => 'OIDC token exchange failed.'];
        }

        $claims = [];
        if (!empty($tokenResp['id_token'])) {
            $claims = self::decodeJwtPayload((string)$tokenResp['id_token']);
            if (!empty($claims['exp']) && time() > ((int)$claims['exp'] + 60)) {
                return ['success' => false, 'status' => 401, 'error' => 'OIDC ID token has expired.'];
            }
            if (isset($claims['aud'])) {
                $expectedClient = (string)($cfg['oidc_client_id'] ?? '');
                $audList = is_array($claims['aud']) ? $claims['aud'] : [(string)$claims['aud']];
                if ($expectedClient !== '' && !in_array($expectedClient, $audList, true)) {
                    return ['success' => false, 'status' => 401, 'error' => 'OIDC token audience mismatch.'];
                }
            }
            if (!empty($claims['nonce']) && !hash_equals((string)$saved['nonce'], (string)$claims['nonce'])) {
                return ['success' => false, 'status' => 401, 'error' => 'OIDC nonce mismatch.'];
            }
        }
        if (!empty($tokenResp['access_token']) && !empty($saved['userinfo_ep'])) {
            $ui = self::httpJsonGet((string)$saved['userinfo_ep'], ['Authorization: Bearer ' . $tokenResp['access_token']]);
            if (is_array($ui)) {
                $claims = array_merge($claims, $ui);
            }
        }

        $email = strtolower(trim((string)($claims['email'] ?? '')));
        // Reject linking by unverified email when IdP explicitly marks email_verified = false
        $emailVerified = !array_key_exists('email_verified', $claims) || !empty($claims['email_verified']);
        $preferred = (string)($claims['preferred_username'] ?? $claims['nickname'] ?? '');
        if ($preferred === '' && $email !== '') {
            $preferred = explode('@', $email)[0];
        }
        $displayName = trim((string)($claims['name'] ?? $preferred));

        $user = ($email !== '' && $emailVerified) ? UserManager::findByEmail($projectRoot, $email) : null;
        if (!$user && $email === '' && $preferred !== '') {
            // Only fall back to username matching when IdP provided no email claim, and never auto-hijack an admin with a different email
            $candidate = UserManager::findByUsername($projectRoot, $preferred);
            if ($candidate && empty($candidate['email'])) {
                $user = $candidate;
            }
        }

        if (!$user) {
            if (empty($cfg['oidc_auto_create'])) {
                return ['success' => false, 'status' => 403, 'error' => 'No matching local account found and SSO auto-provisioning is disabled.'];
            }
            if ($email !== '' && !AuthSettings::isEmailDomainAllowed($email, $cfg)) {
                return ['success' => false, 'status' => 403, 'error' => 'Your SSO email domain is not allowed on this server.'];
            }
            $slug = UserManager::sanitizeUsername($preferred ?: ('sso_' . substr(hash('sha256', (string)($claims['sub'] ?? random_bytes(8))), 0, 8)));
            if (UserManager::findByUsername($projectRoot, $slug) !== null) {
                $slug .= '_' . random_int(100, 999);
            }
            $created = UserManager::createUser($projectRoot, $mediaDir, [
                'username'          => $slug,
                'display_name'      => $displayName !== '' ? $displayName : $slug,
                'email'             => $email,
                'password'          => bin2hex(random_bytes(24)),
                'role'              => 'user',
                'quota_bytes'       => max(0, (int)($cfg['default_quota_mb'] ?? 0)) * 1024 * 1024,
                'is_active'         => 1,
                'approval_status'   => 'approved',
                'email_verified_at' => time(),
                'create_home'       => true
            ]);
            if (empty($created['success'])) {
                return $created;
            }
            $user = UserManager::findById($projectRoot, (int)$created['user']['id']);
        }

        if (empty($user['is_active'])) {
            return ['success' => false, 'status' => 403, 'error' => 'Account is disabled.'];
        }

        $store = AtelierStore::forRoot($projectRoot);
        $now = time();
        $store->update('users', ['last_login_at' => $now], ['id' => (int)$user['id']]);
        $user['last_login_at'] = $now;

        $sanitized = UserManager::sanitizeUserForOutput($user);
        AuthManager::loginUserSession($sanitized, $projectRoot);
        AuditLogger::log($projectRoot, 'oidc_login', $sanitized['home_dir'], 'ok', ['username' => $sanitized['username']]);

        return [
            'success'         => true,
            'status'          => 200,
            'user'            => $sanitized,
            'is_admin'        => AuthManager::isAdminLoggedIn(),
            'mounted_volumes' => ShareManager::getMountedVolumesForCurrentUser($mediaDir),
            'csrf_token'      => get_csrf_token()
        ];
    }

    public static function decodeJwtPayload(string $jwt): array {
        $parts = explode('.', $jwt);
        if (count($parts) < 2) {
            return [];
        }
        $payload = strtr($parts[1], '-_', '+/');
        $pad = strlen($payload) % 4;
        if ($pad > 0) {
            $payload .= str_repeat('=', 4 - $pad);
        }
        $decoded = @json_decode((string)base64_decode($payload), true);
        return is_array($decoded) ? $decoded : [];
    }

    private static function fetchDiscovery(string $issuer): array {
        $url = rtrim($issuer, '/') . '/.well-known/openid-configuration';
        $data = self::httpJsonGet($url);
        return is_array($data) ? $data : [];
    }

    private static function isValidHttpUrl(string $url): bool {
        if ($url === '' || preg_match('/[\x00-\x1f\x7f]/', $url)) {
            return false;
        }
        if (!preg_match('#^https?://#i', $url)) {
            return false;
        }
        return filter_var($url, FILTER_VALIDATE_URL) !== false;
    }

    private static function httpJsonGet(string $url, array $headers = []): ?array {
        if (!self::isValidHttpUrl($url)) {
            return null;
        }
        $ctx = stream_context_create([
            'http' => [
                'method'          => 'GET',
                'timeout'         => 10,
                'follow_location' => 0,
                'header'          => implode("\r\n", array_merge(['Accept: application/json'], $headers))
            ],
            'ssl' => [
                'verify_peer'      => true,
                'verify_peer_name' => true
            ]
        ]);
        $raw = @file_get_contents($url, false, $ctx);
        if ($raw === false) return null;
        $decoded = @json_decode($raw, true);
        return is_array($decoded) ? $decoded : null;
    }

    private static function httpJsonPost(string $url, array $fields): ?array {
        if (!self::isValidHttpUrl($url)) {
            return null;
        }
        $ctx = stream_context_create([
            'http' => [
                'method'          => 'POST',
                'timeout'         => 10,
                'follow_location' => 0,
                'header'          => "Content-Type: application/x-www-form-urlencoded\r\nAccept: application/json",
                'content'         => http_build_query($fields)
            ],
            'ssl' => [
                'verify_peer'      => true,
                'verify_peer_name' => true
            ]
        ]);
        $raw = @file_get_contents($url, false, $ctx);
        if ($raw === false) return null;
        $decoded = @json_decode($raw, true);
        return is_array($decoded) ? $decoded : null;
    }
}
