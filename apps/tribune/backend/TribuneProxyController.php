<?php
namespace SimpleGallery\Apps\Tribune\Backend;

use SimpleGallery\Kernel\Auth\AuthManager;
use SimpleGallery\Kernel\Security\RateLimiter;
use SimpleGallery\Kernel\Security\UrlValidator;

/**
 * Tribune Remote Proxy, Totoz & URL Preview Controller
 * Handles SSRF-hardened remote board fetches/posts, totoz lookups, and URL metadata previews.
 */
class TribuneProxyController {

    public static function isAllowedBoardRemoteUrl(string $url, string $base_dir): bool {
        $target = parse_url($url);
        if (!$target || empty($target['scheme']) || empty($target['host'])) {
            return false;
        }
        $t_scheme = strtolower($target['scheme']);
        if (!in_array($t_scheme, ['http', 'https'], true)) {
            return false;
        }
        $t_host = strtolower(trim($target['host'], '[]'));
        $t_port = isset($target['port']) ? (int)$target['port'] : ($t_scheme === 'https' ? 443 : 80);

        $boards = TribuneActions::getBoardsConfig($base_dir);
        foreach ($boards as $cfg) {
            if (!is_array($cfg)) continue;
            if (($cfg['backend_type'] ?? '') === 'local') continue;
            foreach (['url', 'post_url'] as $field) {
                if (empty($cfg[$field]) || !is_string($cfg[$field])) continue;
                $bp = parse_url($cfg[$field]);
                if (!$bp || empty($bp['scheme']) || empty($bp['host'])) continue;
                $b_scheme = strtolower($bp['scheme']);
                $b_host = strtolower(trim($bp['host'], '[]'));
                $b_port = isset($bp['port']) ? (int)$bp['port'] : ($b_scheme === 'https' ? 443 : 80);
                if ($t_scheme === $b_scheme && $t_host === $b_host && $t_port === $b_port) {
                    return true;
                }
            }
        }
        return false;
    }

    public static function httpRequestProxy(string $url, string $method = 'GET', array $headers = [], ?string $post_data = null, int $timeout = 6): array {
        if (!UrlValidator::isSafePublicUrl($url)) {
            return [
                'success'     => false,
                'status_code' => 403,
                'headers'     => [],
                'body'        => '',
                'location'    => '',
                'cookies'     => [],
                'error'       => 'URL non autorisée (anti-SSRF).'
            ];
        }

        $is_post = (strtoupper($method) === 'POST');
        $header_lines = [];
        foreach ($headers as $h) {
            if (is_string($h) && trim($h) !== '') {
                $header_lines[] = trim($h);
            }
        }

        if (function_exists('curl_init')) {
            $fetch = UrlValidator::safeCurlFetch($url, [
                'method'           => strtoupper($method),
                'headers'          => $header_lines,
                'post_data'        => $post_data,
                'connect_timeout'  => 4,
                'timeout'          => max(2, min($timeout, 6)),
                'follow_redirects' => !$is_post,
                'max_redirects'    => 3,
                'max_bytes'        => 2 * 1024 * 1024
            ]);

            return [
                'success'     => (bool)$fetch['success'],
                'status_code' => (int)$fetch['status_code'],
                'headers'     => $fetch['headers'] ?? [],
                'body'        => (string)($fetch['body'] ?? ''),
                'location'    => (string)($fetch['location'] ?? ''),
                'cookies'     => $fetch['cookies'] ?? [],
                'error'       => (string)($fetch['error'] ?? '')
            ];
        }

        @ini_set('default_socket_timeout', $timeout);
        $header_str = implode("\r\n", $header_lines);
        $opts = [
            'http' => [
                'method'          => strtoupper($method),
                'timeout'         => $timeout,
                'follow_location' => 0,
                'max_redirects'   => 0,
                'ignore_errors'   => true,
                'header'          => $header_str,
                'content'         => $post_data
            ],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true]
        ];

        $context = stream_context_create($opts);
        $body = @file_get_contents($url, false, $context);
        $status_code = 200;
        $location = '';
        $cookies = [];
        $resp_headers = $http_response_header ?? [];

        if (is_array($resp_headers)) {
            foreach ($resp_headers as $line) {
                if (preg_match('/HTTP\/\d\.\d\s+(\d+)/i', $line, $m)) $status_code = (int)$m[1];
                if (stripos($line, 'Location:') === 0) $location = trim(substr($line, 9));
                if (stripos($line, 'Set-Cookie:') === 0 && preg_match('/^Set-Cookie:\s*([^;]+)/i', $line, $mc)) {
                    $cookies[] = trim($mc[1]);
                }
            }
        }

        $success = ($body !== false && $status_code >= 200 && $status_code < 400);
        return [
            'success'     => $success,
            'status_code' => $status_code,
            'headers'     => $resp_headers,
            'body'        => $body ?: '',
            'location'    => $location,
            'cookies'     => $cookies,
            'error'       => $success ? '' : "Code HTTP {$status_code}"
        ];
    }

    public static function handleProxyFetch(array $raw_body, string $base_dir): array {
        global $rate_limits;
        $px_max = (int)($rate_limits['tribune_proxy']['max_attempts'] ?? 60);
        $px_decay = (int)($rate_limits['tribune_proxy']['decay_seconds'] ?? 60);
        $px_rl_key = 'tribune_proxy_' . RateLimiter::getClientIp();
        if (!RateLimiter::check($px_rl_key, $px_max, $px_decay)) {
            return ['status' => 429, 'data' => ['success' => false, 'error' => 'Trop de requêtes proxy tribune. Veuillez patienter.']];
        }
        RateLimiter::increment($px_rl_key);

        $remote_url = trim($_GET['url'] ?? $_POST['url'] ?? $raw_body['url'] ?? '');
        $cookie_hdr = trim($_GET['cookie'] ?? $_POST['cookie'] ?? $raw_body['cookie'] ?? '');
        $user_agent = trim($_GET['user_agent'] ?? $_POST['user_agent'] ?? $raw_body['user_agent'] ?? 'SimpleGallery-TribuneProxy/1.0');

        if (empty($remote_url) || !filter_var($remote_url, FILTER_VALIDATE_URL)) {
            return ['status' => 400, 'data' => ['success' => false, 'error' => 'URL distante invalide.']];
        }

        $scheme = parse_url($remote_url, PHP_URL_SCHEME);
        if (!in_array(strtolower($scheme), ['http', 'https'], true)) {
            return ['status' => 400, 'data' => ['success' => false, 'error' => 'Seuls les protocole HTTP et HTTPS sont autorisés.']];
        }

        if (!UrlValidator::isSafePublicUrl($remote_url)) {
            return ['status' => 403, 'data' => ['success' => false, 'error' => 'Accès refusé : adresse IP ou réseau privé non autorisé (anti-SSRF).']];
        }

        if (!AuthManager::isAdminLoggedIn() && !self::isAllowedBoardRemoteUrl($remote_url, $base_dir)) {
            return ['status' => 403, 'data' => ['success' => false, 'error' => 'Accès refusé : l\'URL distante ne correspond à aucune tribune configurée.']];
        }

        $headers = ["User-Agent: {$user_agent}", "Accept: application/xml, text/xml, text/plain, application/json, */*"];
        if (!empty($cookie_hdr)) $headers[] = "Cookie: {$cookie_hdr}";

        @session_write_close();
        $res = self::httpRequestProxy($remote_url, 'GET', $headers, null, 5);

        if (!$res['success'] || empty($res['body'])) {
            return ['status' => 200, 'data' => [
                'success'     => false,
                'status_code' => $res['status_code'] ?? 0,
                'error'       => 'Impossible d\'obtenir le flux distant (serveur injoignable ou délai dépassé).',
                'details'     => $res['error'] ?? ''
            ]];
        }

        return ['status' => 200, 'data' => ['success' => true, 'content' => $res['body']]];
    }

    public static function handleProxyPost(array $raw_body, string $base_dir): array {
        $board_id        = trim($_POST['board_id'] ?? $raw_body['board_id'] ?? '');
        $remote_url      = trim($_POST['url'] ?? $raw_body['url'] ?? '');
        $custom_post_url = trim($_POST['post_url'] ?? $raw_body['post_url'] ?? '');
        $msg_text        = trim($_POST['message'] ?? $raw_body['message'] ?? '');
        $login           = trim($_POST['login'] ?? $raw_body['login'] ?? 'Anonyme');
        $cookie_hdr      = trim($_POST['cookie'] ?? $raw_body['cookie'] ?? '');
        $user_agent      = trim($_POST['user_agent'] ?? $raw_body['user_agent'] ?? 'Mozilla/5.0 (SimpleGallery Tribune)');

        $all_boards = TribuneActions::getBoardsConfig($base_dir);
        $board_cfg  = $all_boards[$board_id] ?? null;

        if (!$board_cfg) {
            if (!empty($remote_url)) {
                foreach ($all_boards as $bid => $cfg) {
                    if (!empty($cfg['url']) && strtolower(trim($cfg['url'])) === strtolower($remote_url)) {
                        $board_cfg = $cfg;
                        $board_id  = $bid;
                        break;
                    }
                }
            }
            if (!$board_cfg && isset($all_boards['linuxfr'])) {
                $board_cfg = $all_boards['linuxfr'];
                $board_id  = 'linuxfr';
            }
        }

        if (empty($msg_text)) {
            return ['status' => 400, 'data' => ['success' => false, 'error' => 'Le message ne peut pas être vide.']];
        }

        $post_url = '';
        if (!empty($custom_post_url) && filter_var($custom_post_url, FILTER_VALIDATE_URL)) {
            $post_url = $custom_post_url;
        } elseif ($board_cfg && !empty($board_cfg['post_url']) && filter_var($board_cfg['post_url'], FILTER_VALIDATE_URL)) {
            $post_url = $board_cfg['post_url'];
        } elseif (!empty($remote_url) && filter_var($remote_url, FILTER_VALIDATE_URL)) {
            $post_url = preg_replace('/\/index\.xml$/i', '', $remote_url);
            if (strrpos($post_url, '.xml') !== false) {
                $post_url = preg_replace('/\.xml$/i', '', $post_url);
            }
        }

        if (empty($post_url) || !filter_var($post_url, FILTER_VALIDATE_URL)) {
            return ['status' => 400, 'data' => ['success' => false, 'error' => 'URL de soumission distante invalide.']];
        }

        if (!UrlValidator::isSafePublicUrl($post_url)) {
            return ['status' => 403, 'data' => ['success' => false, 'error' => 'Accès refusé : destination réseau privée non autorisée (anti-SSRF).']];
        }

        global $rate_limits;
        $px_max = (int)($rate_limits['tribune_proxy']['max_attempts'] ?? 60);
        $px_decay = (int)($rate_limits['tribune_proxy']['decay_seconds'] ?? 60);
        $px_rl_key = 'tribune_proxy_' . RateLimiter::getClientIp();
        if (!RateLimiter::check($px_rl_key, $px_max, $px_decay)) {
            return ['status' => 429, 'data' => ['success' => false, 'error' => 'Trop de requêtes proxy tribune. Veuillez patienter.']];
        }
        RateLimiter::increment($px_rl_key);

        if (!AuthManager::isAdminLoggedIn() && !self::isAllowedBoardRemoteUrl($post_url, $base_dir)) {
            return ['status' => 403, 'data' => ['success' => false, 'error' => 'Accès refusé : l\'URL de publication ne correspond à aucune tribune configurée.']];
        }

        $parsed_post_url = parse_url($post_url);
        $origin = ($parsed_post_url['scheme'] ?? 'https') . '://' . ($parsed_post_url['host'] ?? '');

        $csrf_token = $_SESSION['tribune_csrf_' . $board_id] ?? '';
        $should_extract_csrf = isset($board_cfg['extract_csrf']) ? (bool)$board_cfg['extract_csrf'] : true;

        $fetch_csrf_token = function() use ($post_url, $user_agent, &$cookie_hdr) {
            $get_headers = [
                "User-Agent: {$user_agent}",
                "Accept: text/html,application/xhtml+xml,*/*"
            ];
            if (!empty($cookie_hdr)) {
                $get_headers[] = "Cookie: {$cookie_hdr}";
            }

            $get_res = self::httpRequestProxy($post_url, 'GET', $get_headers, null, 5);
            $tok = '';
            if (!empty($get_res['body'])) {
                if (preg_match('/input[^>]+name="authenticity_token"[^>]+value="([^"]+)"/i', $get_res['body'], $m_tok)) {
                    $tok = $m_tok[1];
                } elseif (preg_match('/meta[^>]+name="csrf-token"[^>]+content="([^"]+)"/i', $get_res['body'], $m_meta)) {
                    $tok = $m_meta[1];
                }

                if (!empty($get_res['cookies'])) {
                    $existing_keys = [];
                    foreach (explode(';', $cookie_hdr) as $part) {
                        $kv = explode('=', trim($part), 2);
                        if (!empty($kv[0])) {
                            $existing_keys[trim($kv[0])] = true;
                        }
                    }
                    foreach ($get_res['cookies'] as $ck) {
                        $kv = explode('=', trim($ck), 2);
                        $key = trim($kv[0] ?? '');
                        if (!empty($key) && !isset($existing_keys[$key])) {
                            $cookie_hdr = ($cookie_hdr ? $cookie_hdr . '; ' : '') . $ck;
                            $existing_keys[$key] = true;
                        }
                    }
                }
            }
            return $tok;
        };

        if (empty($csrf_token) && $should_extract_csrf) {
            $csrf_token = $fetch_csrf_token();
            if (!empty($csrf_token)) {
                $_SESSION['tribune_csrf_' . $board_id] = $csrf_token;
            }
        }

        $execute_post = function($token) use ($board_cfg, $msg_text, $login, $user_agent, $post_url, $origin, $cookie_hdr) {
            $post_params = [];
            $is_api_endpoint = (strpos($post_url, '/api/') !== false);

            if ($is_api_endpoint) {
                $post_param_name = ($board_cfg && !empty($board_cfg['post_param'])) ? $board_cfg['post_param'] : 'message';
                $post_params[$post_param_name] = $msg_text;
            } else {
                $post_params['utf8'] = '✓';
                $post_params['authenticity_token'] = $token;

                if ($board_cfg && !empty($board_cfg['extra_params']) && is_array($board_cfg['extra_params'])) {
                    foreach ($board_cfg['extra_params'] as $k => $v) {
                        if ($k !== 'utf8' && $k !== 'authenticity_token') {
                            $post_params[$k] = $v;
                        }
                    }
                }

                $post_param_name = ($board_cfg && !empty($board_cfg['post_param'])) ? $board_cfg['post_param'] : 'message';
                $post_params[$post_param_name] = $msg_text;
                $post_params['login'] = $login;
            }

            $post_data = http_build_query($post_params);

            $post_headers = [
                "User-Agent: {$user_agent}",
                "Content-Type: application/x-www-form-urlencoded",
                "Referer: {$post_url}",
                "Origin: {$origin}"
            ];
            if (!empty($token) && !$is_api_endpoint) {
                $post_headers[] = "X-CSRF-Token: {$token}";
            }
            if (!empty($cookie_hdr)) {
                if (stripos($cookie_hdr, 'Bearer ') === 0 || strpos($cookie_hdr, '=') === false) {
                    $token_val = preg_replace('/^Bearer\s+/i', '', trim($cookie_hdr));
                    $post_headers[] = "Authorization: Bearer {$token_val}";
                } else {
                    $post_headers[] = "Cookie: {$cookie_hdr}";
                    if (preg_match('/(?:access_token|bearer|token)=([^;]+)/i', $cookie_hdr, $m_bearer)) {
                        $post_headers[] = "Authorization: Bearer {$m_bearer[1]}";
                    }
                }
            }

            return self::httpRequestProxy($post_url, 'POST', $post_headers, $post_data, 6);
        };

        $post_res = $execute_post($csrf_token);
        $status_code  = $post_res['status_code'];
        $location_hdr = $post_res['location'];

        if (($status_code === 422 || $status_code === 400) && $should_extract_csrf) {
            unset($_SESSION['tribune_csrf_' . $board_id]);
            $csrf_token = $fetch_csrf_token();
            if (!empty($csrf_token)) {
                $_SESSION['tribune_csrf_' . $board_id] = $csrf_token;
                $post_res = $execute_post($csrf_token);
                $status_code  = $post_res['status_code'];
                $location_hdr = $post_res['location'];
            }
        }

        if (strpos($location_hdr, 'connexion') !== false || $status_code === 401 || $status_code === 403) {
            return ['status' => 401, 'data' => [
                'success'     => false,
                'status_code' => $status_code,
                'location'    => $location_hdr,
                'error'       => 'Authentification refusée par le backend distant (jeton OAuth2 ou cookie de session expiré).'
            ]];
        }

        if ($status_code >= 200 && $status_code < 400) {
            return ['status' => 200, 'data' => [
                'success'     => true,
                'status_code' => $status_code,
                'location'    => $location_hdr,
                'csrf_used'   => !empty($csrf_token),
                'message'     => 'Post envoyé au backend distant avec succès.',
                'target'      => $post_url
            ]];
        }

        return ['status' => 400, 'data' => [
            'success'     => false,
            'status_code' => $status_code,
            'error'       => "Le backend distant a répondu avec le code HTTP {$status_code}.",
            'details'     => mb_substr(trim(strip_tags($post_res['body'] ?? '')), 0, 300)
        ]];
    }

    public static function handleTotozProxy(array $raw_body): void {
        @session_write_close();
        $name = trim($_GET['name'] ?? $raw_body['name'] ?? 'totoz');
        $name = preg_replace('/[^a-zA-Z0-9_\.: -]/', '', $name);
        if (empty($name)) $name = 'totoz';

        $remote_url = "https://totoz.eu/img/" . rawurlencode($name);
        $fetch = UrlValidator::safeCurlFetch($remote_url, [
            'method'           => 'GET',
            'connect_timeout'  => 3,
            'timeout'          => 5,
            'follow_redirects' => true,
            'max_redirects'    => 3,
            'max_bytes'        => 1024 * 1024,
            'user_agent'       => 'SimpleGallery-WebOS/1.0'
        ]);
        $img_data = (!empty($fetch['success']) && !empty($fetch['body'])) ? $fetch['body'] : false;

        if ($img_data === false || empty($img_data)) {
            header('Content-Type: image/svg+xml');
            header("Content-Security-Policy: default-src 'none'; script-src 'none';");
            header('X-Content-Type-Options: nosniff');
            echo '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"><text y="18" font-size="16">🦆</text></svg>';
            exit;
        }

        header('Content-Type: image/gif');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: public, max-age=604800');
        echo $img_data;
        exit;
    }

    public static function handleTotozSearch(array $raw_body): array {
        @session_write_close();
        $q = trim($_GET['q'] ?? $raw_body['q'] ?? '');
        $q = preg_replace('/[^a-zA-Z0-9_\.: -]/', '', $q);

        $remote_url = "https://totoz.eu/search.xml?terms=" . urlencode($q);
        $fetch = UrlValidator::safeCurlFetch($remote_url, [
            'method'           => 'GET',
            'connect_timeout'  => 3,
            'timeout'          => 4,
            'follow_redirects' => true,
            'max_redirects'    => 2,
            'max_bytes'        => 256 * 1024,
            'user_agent'       => 'SimpleGallery-WebOS/1.0'
        ]);
        $xml_data = (!empty($fetch['success']) && !empty($fetch['body'])) ? $fetch['body'] : false;

        $results = [];
        if ($xml_data !== false) {
            $xml = @simplexml_load_string($xml_data, 'SimpleXMLElement', LIBXML_NONET | LIBXML_NOCDATA);
            if ($xml && isset($xml->totoz)) {
                foreach ($xml->totoz as $t) {
                    $name = (string)$t->name;
                    $nsfw = isset($t->nsfw) ? ((string)$t->nsfw === 'true' || (string)$t->nsfw === '1') : false;
                    if ($name) $results[] = ['name' => $name, 'nsfw' => $nsfw];
                }
            }
        }

        return ['status' => 200, 'data' => ['success' => true, 'totoz' => array_slice($results, 0, 15)]];
    }

    public static function handleUrlPreview(array $raw_body, string $storage_dir): array {
        @session_write_close();
        $url = trim($_GET['url'] ?? $raw_body['url'] ?? '');
        if (empty($url) || !preg_match('#^https?://#i', $url)) {
            return ['status' => 400, 'data' => ['success' => false, 'error' => 'URL invalide']];
        }

        if (!UrlValidator::isSafePublicUrl($url)) {
            return ['status' => 200, 'data' => ['success' => false, 'error' => 'Accès restreint']];
        }

        $cache_file = $storage_dir . '/url_preview_cache.json';
        $cache = [];
        if (file_exists($cache_file)) {
            $cache = @json_decode(@file_get_contents($cache_file), true) ?: [];
        }

        $url_hash = md5($url);
        if (isset($cache[$url_hash]) && (time() - ($cache[$url_hash]['cached_at'] ?? 0)) < 86400 * 7) {
            return ['status' => 200, 'data' => ['success' => true, 'preview' => $cache[$url_hash]]];
        }

        $parsed_host = (string)(parse_url($url, PHP_URL_HOST) ?? '');
        $title = '';
        $description = '';
        $image = '';
        $site_name = $parsed_host;

        if (preg_match('#\.(jpg|jpeg|png|gif|webp|svg)$#i', parse_url($url, PHP_URL_PATH) ?? '')) {
            $title = basename(parse_url($url, PHP_URL_PATH));
            $image = $url;
            $description = "Image en ligne";
        }

        $preview_data = [
            'url'         => $url,
            'site_name'   => $site_name ?: $parsed_host,
            'title'       => $title ?: $parsed_host,
            'description' => mb_strlen($description) > 140 ? mb_substr($description, 0, 137) . '…' : $description,
            'image'       => $image,
            'cached_at'   => time()
        ];

        $cache[$url_hash] = $preview_data;
        @file_put_contents($cache_file, json_encode($cache, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);

        return ['status' => 200, 'data' => ['success' => true, 'preview' => $preview_data]];
    }
}
