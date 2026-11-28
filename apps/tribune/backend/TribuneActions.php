<?php
namespace Atelier\Apps\Tribune\Backend;

require_once __DIR__ . '/TribuneUploadController.php';
require_once __DIR__ . '/TribuneSchedulerController.php';
require_once __DIR__ . '/TribuneProxyController.php';

use Atelier\Kernel\Auth\AuthManager;
use Atelier\Kernel\Config\ConfigStore;
use Atelier\Kernel\Security\UrlValidator;

/**
 * Atelier WebOS - Tribune Backend Facade & Local Feed / OAuth2 Controller
 * Delegates upload, scheduler, and remote proxy/totoz actions to dedicated controllers.
 */
class TribuneActions {

    public const TRIBUNE_MAX_UPLOAD_BYTES = TribuneUploadController::MAX_UPLOAD_BYTES;

    // -------------------------------------------------------------
    // Backward-compatible static delegators to extracted controllers
    // -------------------------------------------------------------
    public static function validateTribuneUpload(string $orig_name, string $detected_mime, int $size, ?int $max_bytes = null): array {
        return TribuneUploadController::validateUpload($orig_name, $detected_mime, $size, $max_bytes);
    }

    public static function getTribuneFileResponseHeaders(string $ext, string $stored_mime, string $orig_name): array {
        return TribuneUploadController::getFileResponseHeaders($ext, $stored_mime, $orig_name);
    }

    public static function isSafePublicUrl(string $url): bool {
        return UrlValidator::isSafePublicUrl($url);
    }

    public static function isAllowedBoardRemoteUrl(string $url, string $base_dir): bool {
        return TribuneProxyController::isAllowedBoardRemoteUrl($url, $base_dir);
    }

    public static function httpRequestProxy(string $url, string $method = 'GET', array $headers = [], ?string $post_data = null, int $timeout = 6): array {
        return TribuneProxyController::httpRequestProxy($url, $method, $headers, $post_data, $timeout);
    }

    public static function processScheduledPosts(string $base_dir): void {
        TribuneSchedulerController::processScheduledPosts($base_dir);
    }

    public static function sanitizeScheduledItemForOutput(array $item): array {
        return TribuneSchedulerController::sanitizeItemForOutput($item);
    }

    // -------------------------------------------------------------
    // Storage, Boards Config & OAuth2 State Helpers
    // -------------------------------------------------------------
    public static function resolveStorageDir(string $base_dir = ''): string {
        return ConfigStore::getStorageDir($base_dir);
    }

    public static function getBoardsFilePath(string $base_dir): string {
        return self::resolveStorageDir($base_dir) . '/tribune_boards.json';
    }

    public static function getMessagesFilePath(string $base_dir): string {
        return self::resolveStorageDir($base_dir) . '/tribune_messages.json';
    }

    public static function getSecretsConfig(string $base_dir): array {
        $f1 = self::resolveStorageDir($base_dir) . '/tribune_secrets.php';
        if (file_exists($f1)) return include $f1;
        $project_root = dirname(dirname(dirname(__DIR__)));
        $f2 = $project_root . '/storage/tribune_secrets.php';
        if (file_exists($f2)) return include $f2;
        return [];
    }

    public static function getOauthSecret(string $board_id, string $key, string $base_dir): ?string {
        $env_key = 'GB2C_' . strtoupper($board_id) . '_' . strtoupper($key);
        $env_val = getenv($env_key);
        if (!empty($env_val)) return $env_val;

        $env_key2 = strtoupper($board_id) . '_' . strtoupper($key);
        $env_val2 = getenv($env_key2);
        if (!empty($env_val2)) return $env_val2;

        $secrets = self::getSecretsConfig($base_dir);
        if (isset($secrets[$board_id][$key])) {
            return $secrets[$board_id][$key];
        }
        return null;
    }

    public static function verifyOauthState(string $board_id, string $state): bool {
        AuthManager::ensureSessionStarted();
        $key = 'tribune_oauth_state_' . $board_id;
        $expected = (string)($_SESSION[$key] ?? '');
        unset($_SESSION[$key]);
        if ($expected === '' || $state === '') {
            return false;
        }
        return hash_equals($expected, $state);
    }

    public static function getBoardsConfig(string $base_dir): array {
        $storage_file = self::getBoardsFilePath($base_dir);
        if (file_exists($storage_file)) {
            $content = @file_get_contents($storage_file);
            $decoded = @json_decode($content, true);
            if (is_array($decoded) && !empty($decoded)) {
                return $decoded;
            }
        }

        return [
            'local' => [
                'name'        => 'Tribune Interne (Atelier)',
                'description' => 'Tribune de discussion locale intégrée à Atelier by GallusTech',
                'url'         => 'system/endpoints/api.php?action=tribune_get',
                'post_url'    => 'system/endpoints/api.php?action=tribune_post',
                'backend_type'=> 'local',
                'color'       => '#3b82f6',
                'anonymous'   => true
            ],
            'linuxfr' => [
                'name'        => 'LinuxFr.org (Bouchot)',
                'description' => 'Tribune publique historique des libristes francophones',
                'url'         => 'https://linuxfr.org/board/index.xml',
                'post_url'    => 'https://linuxfr.org/board',
                'backend_type'=> 'tsv',
                'color'       => '#10b981',
                'anonymous'   => true,
                'post_param'  => 'board[message]',
                'extra_params'=> ['utf8' => '✓'],
                'extract_csrf'=> true,
                'oauth'       => [
                    'authorize_url' => 'https://linuxfr.org/oauth/authorize',
                    'token_url'     => 'https://linuxfr.org/oauth/token',
                    'client_id'     => '',
                    'scope'         => 'account board'
                ]
            ],
            'dlfp' => [
                'name'        => 'Da Linux French Page',
                'description' => 'Flux alternatif LinuxFr.org',
                'url'         => 'https://linuxfr.org/board/index.xml',
                'post_url'    => 'https://linuxfr.org/board',
                'backend_type'=> 'tsv',
                'color'       => '#6366f1',
                'anonymous'   => true,
                'post_param'  => 'board[message]',
                'extract_csrf'=> true
            ]
        ];
    }

    // -------------------------------------------------------------
    // Main Action Dispatcher
    // -------------------------------------------------------------
    public static function handle(string $action, array $raw_body, $base_dir): ?array {
        if (is_array($base_dir)) {
            $base_dir = (string)($base_dir['project_root'] ?? $base_dir['base_dir'] ?? '');
        } else {
            $base_dir = (string)$base_dir;
        }
        $storage_dir = self::resolveStorageDir($base_dir);

        // Delegated Controllers
        switch ($action) {
            case 'tribune_schedule_post':
                return TribuneSchedulerController::handleSchedulePost($raw_body, $base_dir, $storage_dir);
            case 'tribune_scheduled_list':
                return TribuneSchedulerController::handleScheduledList($base_dir, $storage_dir);
            case 'tribune_schedule_cancel':
                return TribuneSchedulerController::handleScheduleCancel($raw_body, $storage_dir);
            case 'tribune_proxy_fetch':
                return TribuneProxyController::handleProxyFetch($raw_body, $base_dir);
            case 'tribune_proxy_post':
                return TribuneProxyController::handleProxyPost($raw_body, $base_dir);
            case 'tribune_file_upload':
                return TribuneUploadController::handleUpload($base_dir, $storage_dir);
            case 'tribune_file_get':
                TribuneUploadController::handleFileGet($raw_body, $storage_dir);
                return null;
            case 'totoz_proxy':
                TribuneProxyController::handleTotozProxy($raw_body);
                return null;
            case 'totoz_search':
                return TribuneProxyController::handleTotozSearch($raw_body);
            case 'url_preview':
                return TribuneProxyController::handleUrlPreview($raw_body, $storage_dir);
        }

        // Boards Configuration
        if ($action === 'tribune_boards_get') {
            $boards = self::getBoardsConfig($base_dir);
            foreach ($boards as $bid => &$cfg) {
                if (isset($cfg['oauth']['client_secret'])) {
                    unset($cfg['oauth']['client_secret']);
                }
            }
            unset($cfg);
            return ['status' => 200, 'data' => ['success' => true, 'boards' => $boards]];
        }

        if ($action === 'tribune_boards_save') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => 'Action réservée à l\'administrateur.']];
            }

            $new_boards = $_POST['boards'] ?? $raw_body['boards'] ?? null;
            if (!is_array($new_boards)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'Format de configuration invalide.']];
            }

            foreach ($new_boards as $bid => $cfg) {
                if (!is_array($cfg)) {
                    return ['status' => 400, 'data' => ['success' => false, 'error' => 'Configuration de tribune invalide.']];
                }
                $is_local = (($cfg['backend_type'] ?? '') === 'local' || $bid === 'local');
                if (!$is_local) {
                    foreach (['url', 'post_url'] as $url_field) {
                        if (!empty($cfg[$url_field]) && is_string($cfg[$url_field])) {
                            $u = trim($cfg[$url_field]);
                            $sch = strtolower((string)(parse_url($u, PHP_URL_SCHEME) ?? ''));
                            if (!in_array($sch, ['http', 'https'], true) || !self::isSafePublicUrl($u)) {
                                return ['status' => 400, 'data' => ['success' => false, 'error' => "URL distante non autorisée pour la tribune '{$bid}' ({$url_field})."]];
                            }
                        }
                    }
                    if (!empty($cfg['oauth']) && is_array($cfg['oauth'])) {
                        foreach (['authorize_url', 'token_url', 'redirect_uri'] as $oauth_field) {
                            if (!empty($cfg['oauth'][$oauth_field]) && is_string($cfg['oauth'][$oauth_field])) {
                                $ou = trim($cfg['oauth'][$oauth_field]);
                                $osch = strtolower((string)(parse_url($ou, PHP_URL_SCHEME) ?? ''));
                                if (!in_array($osch, ['http', 'https'], true)) {
                                    return ['status' => 400, 'data' => ['success' => false, 'error' => "URL OAuth invalide pour '{$bid}' ({$oauth_field})."]];
                                }
                                if ($oauth_field !== 'redirect_uri' && !self::isSafePublicUrl($ou)) {
                                    return ['status' => 400, 'data' => ['success' => false, 'error' => "URL OAuth distante non autorisée pour '{$bid}' ({$oauth_field})."]];
                                }
                            }
                        }
                    }
                }
            }

            $storage_file = self::getBoardsFilePath($base_dir);
            @file_put_contents($storage_file, json_encode($new_boards, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);

            return ['status' => 200, 'data' => ['success' => true, 'message' => 'Configuration des tribunes sauvegardée.']];
        }

        // OAuth2 Authorization, Callback & Silent Refresh
        if ($action === 'tribune_oauth_authorize') {
            $board_id = trim($_GET['board_id'] ?? $_POST['board_id'] ?? $raw_body['board_id'] ?? '');
            $all_boards = self::getBoardsConfig($base_dir);
            $board_cfg = $all_boards[$board_id] ?? null;
            $oauth_cfg = $board_cfg['oauth'] ?? null;

            if (!$oauth_cfg || empty($oauth_cfg['authorize_url'])) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'Configuration OAuth2 manquante pour cette tribune.']];
            }

            $client_id = !empty($oauth_cfg['client_id']) ? $oauth_cfg['client_id'] : self::getOauthSecret($board_id, 'client_id', $base_dir);
            if (empty($client_id)) $client_id = 'atelier_webos';

            AuthManager::ensureSessionStarted();
            $state = bin2hex(random_bytes(16));
            $_SESSION['tribune_oauth_state_' . $board_id] = $state;

            $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
            $host = $_SERVER['HTTP_HOST'] ?? '127.0.0.1';
            $req_path = strtok($_SERVER['REQUEST_URI'] ?? '', '?');
            $root_api_path = preg_replace('#/(apps/tribune|system/endpoints)/api\.php$#', '/api.php', $req_path);
            if (!str_ends_with($root_api_path, '/api.php')) {
                $root_api_path = rtrim(dirname($req_path), '/') . '/api.php';
            }
            $base_uri = $scheme . '://' . $host . $root_api_path;
            $redirect_uri = !empty($oauth_cfg['redirect_uri']) ? $oauth_cfg['redirect_uri'] : ($base_uri . '?action=tribune_oauth_callback&board_id=' . urlencode($board_id));

            $params = [
                'client_id'     => $client_id,
                'response_type' => 'code',
                'scope'         => $oauth_cfg['scope'] ?? 'account board',
                'redirect_uri'  => $redirect_uri,
                'state'         => $state
            ];

            $authorize_url = $oauth_cfg['authorize_url'] . '?' . http_build_query($params);

            if (isset($_GET['raw_url']) || isset($raw_body['raw_url'])) {
                return ['status' => 200, 'data' => ['success' => true, 'authorize_url' => $authorize_url]];
            }

            header('Location: ' . $authorize_url, true, 302);
            exit;
        }

        if ($action === 'tribune_oauth_callback') {
            $board_id = trim($_GET['board_id'] ?? $raw_body['board_id'] ?? '');
            $code = trim($_GET['code'] ?? $raw_body['code'] ?? '');
            $state = trim($_GET['state'] ?? $raw_body['state'] ?? '');

            $send_oauth_error_html = static function (int $status, string $board, string $message): void {
                http_response_code($status);
                header('Content-Type: text/html; charset=utf-8');
                $err_payload = json_encode([
                    'success'  => false,
                    'type'     => 'tribune_oauth_error',
                    'board_id' => $board,
                    'error'    => $message
                ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
                $safe_msg = htmlspecialchars($message, ENT_QUOTES, 'UTF-8');
                echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Erreur OAuth2</title></head><body style="font-family:sans-serif; background:#0f172a; color:#f8fafc; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0; text-align:center;"><div style="font-size:2.5rem; margin-bottom:10px;">⚠️</div><h2 style="margin:0 0 8px 0; color:#f87171;">Authentification OAuth2 échouée</h2><p style="color:#94a3b8; margin:0;">' . $safe_msg . '</p><script>(function() { var payload = ' . $err_payload . '; var target = (window.opener && !window.opener.closed) ? window.opener : (window.parent && window.parent !== window ? window.parent : null); if (target) { try { target.postMessage(payload, window.location.origin); } catch (e) {} } setTimeout(function() { try { window.close(); } catch (e) {} }, 600); })();</script></body></html>';
                exit;
            };

            if ($board_id === '' || !self::verifyOauthState($board_id, $state)) {
                if (PHP_SAPI === 'cli') {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => 'Paramètre OAuth2 state invalide ou expiré.']];
                }
                $send_oauth_error_html(403, $board_id, 'Erreur de sécurité OAuth2 : jeton state invalide ou expiré.');
            }

            $all_boards = self::getBoardsConfig($base_dir);
            $board_cfg = $all_boards[$board_id] ?? null;
            $oauth_cfg = $board_cfg['oauth'] ?? null;

            if (!$oauth_cfg || empty($oauth_cfg['token_url']) || empty($code)) {
                if (PHP_SAPI === 'cli') {
                    return ['status' => 400, 'data' => ['success' => false, 'error' => 'Code ou configuration OAuth manquant.']];
                }
                $send_oauth_error_html(400, $board_id, 'Code ou configuration OAuth manquant.');
            }

            $client_id = !empty($oauth_cfg['client_id']) ? $oauth_cfg['client_id'] : self::getOauthSecret($board_id, 'client_id', $base_dir);
            $client_secret = self::getOauthSecret($board_id, 'client_secret', $base_dir);

            $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
            $host = $_SERVER['HTTP_HOST'] ?? '127.0.0.1';
            $req_path = strtok($_SERVER['REQUEST_URI'] ?? '', '?');
            $root_api_path = preg_replace('#/(apps/tribune|system/endpoints)/api\.php$#', '/api.php', $req_path);
            if (!str_ends_with($root_api_path, '/api.php')) {
                $root_api_path = rtrim(dirname($req_path), '/') . '/api.php';
            }
            $base_uri = $scheme . '://' . $host . $root_api_path;
            $redirect_uri = !empty($oauth_cfg['redirect_uri']) ? $oauth_cfg['redirect_uri'] : ($base_uri . '?action=tribune_oauth_callback&board_id=' . urlencode($board_id));

            $post_fields = [
                'client_id'     => $client_id,
                'client_secret' => $client_secret,
                'code'          => $code,
                'grant_type'    => 'authorization_code',
                'redirect_uri'  => $redirect_uri
            ];

            $res = self::httpRequestProxy($oauth_cfg['token_url'], 'POST', ["Content-Type: application/x-www-form-urlencoded", "User-Agent: Atelier-WebOS/1.0"], http_build_query($post_fields), 10);
            $data = @json_decode($res['body'], true) ?: [];
            $token = $data['access_token'] ?? '';
            $login = $data['login'] ?? '';

            if (empty($login) && !empty($token)) {
                $me_res = self::httpRequestProxy("https://linuxfr.org/api/v1/me?bearer_token=" . urlencode($token), 'GET', ["User-Agent: Atelier-WebOS/1.0"], null, 5);
                $me_data = @json_decode($me_res['body'], true) ?: [];
                $login = $me_data['login'] ?? $me_data['account']['login'] ?? '';
            }

            $payload_assoc = [
                'success'      => true,
                'type'         => 'tribune_oauth_success',
                'board_id'     => $board_id,
                'access_token' => $token,
                'refresh_token'=> $data['refresh_token'] ?? '',
                'expires_in'   => $data['expires_in'] ?? 0,
                'login'        => $login
            ];

            $json_payload = json_encode($payload_assoc, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
            header('Content-Type: text/html; charset=utf-8');
            echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Authentification Réussie</title></head><body style="font-family:sans-serif; background:#0f172a; color:#f8fafc; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0;"><div style="font-size:3rem; margin-bottom:12px;">🔑</div><h2 style="margin:0 0 8px 0; color:#34d399;">Connexion OAuth2 Réussie !</h2><p style="color:#94a3b8; margin:0;">Fermeture de la fenêtre...</p><script>(function() { var payload = ' . $json_payload . '; var target = (window.opener && !window.opener.closed) ? window.opener : (window.parent && window.parent !== window ? window.parent : null); if (target) { try { target.postMessage(payload, window.location.origin); } catch (e) {} } setTimeout(function() { try { window.close(); } catch (e) {} }, 400); })();</script></body></html>';
            exit;
        }

        if ($action === 'tribune_oauth_refresh') {
            $board_id = trim($_POST['board_id'] ?? $raw_body['board_id'] ?? '');
            $refresh_token = trim($_POST['refresh_token'] ?? $raw_body['refresh_token'] ?? '');

            if ($board_id === '' || $refresh_token === '') {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'Paramètres board_id et refresh_token requis.']];
            }

            $all_boards = self::getBoardsConfig($base_dir);
            $board_cfg = $all_boards[$board_id] ?? null;
            $oauth_cfg = $board_cfg['oauth'] ?? null;

            if (!$oauth_cfg || empty($oauth_cfg['token_url'])) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'Configuration OAuth2 absente pour cette tribune.']];
            }

            $client_id = !empty($oauth_cfg['client_id']) ? $oauth_cfg['client_id'] : self::getOauthSecret($board_id, 'client_id', $base_dir);
            $client_secret = self::getOauthSecret($board_id, 'client_secret', $base_dir);

            $post_fields = [
                'client_id'     => $client_id ?: 'atelier_webos',
                'client_secret' => $client_secret ?? '',
                'refresh_token' => $refresh_token,
                'grant_type'    => 'refresh_token'
            ];

            $res = self::httpRequestProxy($oauth_cfg['token_url'], 'POST', [
                'Content-Type: application/x-www-form-urlencoded',
                'User-Agent: Atelier-WebOS/1.0'
            ], http_build_query($post_fields), 8);

            $data = @json_decode($res['body'] ?? '', true) ?: [];
            $new_token = (string)($data['access_token'] ?? '');
            if (empty($res['success']) || $new_token === '') {
                return ['status' => 401, 'data' => [
                    'success' => false,
                    'error'   => 'Échec du rafraîchissement silencieux du jeton OAuth2.'
                ]];
            }

            return ['status' => 200, 'data' => [
                'success'       => true,
                'board_id'      => $board_id,
                'access_token'  => $new_token,
                'refresh_token' => (string)($data['refresh_token'] ?? $refresh_token),
                'expires_in'    => (int)($data['expires_in'] ?? 0),
                'login'         => (string)($data['login'] ?? '')
            ]];
        }

        // Local Tribune Feed, SSE Stream, Post & Clear History
        if ($action === 'tribune_get') {
            self::processScheduledPosts($base_dir);
            $storage_file = $storage_dir . '/tribune_messages.json';
            $messages = [];
            if (file_exists($storage_file)) {
                $content = @file_get_contents($storage_file);
                $messages = @json_decode($content, true) ?: [];
            } else {
                $messages = [
                    [
                        'id'        => 1,
                        'time'      => date('YmdHis', time() - 3600),
                        'clock'     => date('H:i:s', time() - 3600),
                        'login'     => 'atelier',
                        'info'      => 'Atelier by GallusTech',
                        'message'   => 'Bienvenue sur la Tribune Libre d\'Atelier by GallusTech ! [:totoz] Horloge cliquable, Totoz, Trollomètre et BAK sont activés. 🦆',
                        'is_admin'  => true,
                        'board'     => 'local'
                    ]
                ];
                @file_put_contents($storage_file, json_encode($messages, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
            }

            return ['status' => 200, 'data' => [
                'success'    => true,
                'messages'   => $messages,
                'count'      => count($messages),
                'server_now' => date('H:i:s')
            ]];
        }

        if ($action === 'tribune_stream') {
            @session_write_close();
            if (function_exists('apache_setenv')) @apache_setenv('no-gzip', '1');
            @ini_set('zlib.output_compression', '0');
            @ini_set('implicit_flush', '1');

            header('Content-Type: text/event-stream; charset=utf-8');
            header('Cache-Control: no-cache, no-transform');
            header('Connection: keep-alive');
            header('X-Accel-Buffering: no');

            $storage_file = $storage_dir . '/tribune_messages.json';
            $last_mtime = 0;
            $start_time = time();
            $max_duration = 30;

            while ((time() - $start_time) < $max_duration) {
                if (connection_aborted()) break;
                self::processScheduledPosts($base_dir);

                clearstatcache(true, $storage_file);
                $mtime = file_exists($storage_file) ? filemtime($storage_file) : 0;

                if ($mtime > $last_mtime) {
                    $last_mtime = $mtime;
                    $content = @file_get_contents($storage_file);
                    $messages = @json_decode($content, true) ?: [];

                    echo "event: message\n";
                    echo "data: " . json_encode([
                        'success'  => true,
                        'messages' => $messages,
                        'ts'       => time()
                    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n\n";

                    if (ob_get_level()) @ob_flush();
                    @flush();
                }
                usleep(500000);
            }

            echo "event: ping\ndata: {}\n\n";
            if (ob_get_level()) @ob_flush();
            @flush();
            exit;
        }

        if ($action === 'tribune_post') {
            $msg_text = trim($_POST['message'] ?? $raw_body['message'] ?? '');
            $login    = trim($_POST['login'] ?? $raw_body['login'] ?? 'Anonyme');
            $info     = trim($_POST['info'] ?? $raw_body['info'] ?? ($_SERVER['HTTP_USER_AGENT'] ?? 'Atelier Client'));

            if (empty($msg_text)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'Le message ne peut pas être vide.']];
            }

            if (mb_strlen($msg_text) > 1000) $msg_text = mb_substr($msg_text, 0, 1000);
            if (empty($login)) $login = 'Anonyme';
            if (mb_strlen($login) > 40) $login = mb_substr($login, 0, 40);
            if (mb_strlen($info) > 100) $info = mb_substr($info, 0, 100);

            $storage_file = $storage_dir . '/tribune_messages.json';
            $messages = [];
            if (file_exists($storage_file)) {
                $content = @file_get_contents($storage_file);
                $messages = @json_decode($content, true) ?: [];
            }

            $last_id = 0;
            foreach ($messages as $m) {
                if (isset($m['id']) && $m['id'] > $last_id) $last_id = $m['id'];
            }

            $now_ts   = time();
            $new_post = [
                'id'       => $last_id + 1,
                'time'     => date('YmdHis', $now_ts),
                'clock'    => date('H:i:s', $now_ts),
                'login'    => htmlspecialchars($login, ENT_QUOTES, 'UTF-8'),
                'info'     => htmlspecialchars($info, ENT_QUOTES, 'UTF-8'),
                'message'  => htmlspecialchars($msg_text, ENT_QUOTES, 'UTF-8'),
                'is_admin' => AuthManager::isAdminLoggedIn(),
                'board'    => 'local'
            ];

            $messages[] = $new_post;
            if (count($messages) > 300) {
                $messages = array_slice($messages, -300);
            }

            @file_put_contents($storage_file, json_encode($messages, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);

            return ['status' => 200, 'data' => [
                'success'  => true,
                'post'     => $new_post,
                'messages' => $messages
            ]];
        }

        if ($action === 'tribune_clear_history') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => 'Action réservée à l\'administrateur.']];
            }

            $storage_file = $storage_dir . '/tribune_messages.json';
            @file_put_contents($storage_file, json_encode([], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);

            return ['status' => 200, 'data' => ['success' => true, 'message' => 'Historique de la tribune réinitialisé.']];
        }

        return null;
    }
}
