<?php
namespace SimpleGallery\Apps\Tribune\Backend;

class TribuneActions {

    public const TRIBUNE_MAX_UPLOAD_BYTES = 10485760; // 10 MB

    /**
     * Strict whitelist of allowed extensions and their safe MIME types for Tribune temporary uploads.
     * Excludes active web content (.html, .htm, .svg, .xhtml, .xml, .js, .php, etc.) to prevent same-origin Stored XSS.
     */
    private const TRIBUNE_ALLOWED_UPLOAD_MIMES = [
        // Safe raster images (eligible for inline display with strict CSP sandbox)
        'jpg'  => ['image/jpeg'],
        'jpeg' => ['image/jpeg'],
        'png'  => ['image/png'],
        'gif'  => ['image/gif'],
        'webp' => ['image/webp'],
        'avif' => ['image/avif'],
        // Safe media, documents & archives (always served as attachment)
        'mp4'  => ['video/mp4', 'application/octet-stream'],
        'webm' => ['video/webm', 'audio/webm'],
        'mp3'  => ['audio/mpeg', 'application/octet-stream'],
        'wav'  => ['audio/wav', 'audio/x-wav'],
        'ogg'  => ['audio/ogg', 'video/ogg', 'application/ogg'],
        'pdf'  => ['application/pdf'],
        'txt'  => ['text/plain'],
        'md'   => ['text/plain', 'text/markdown'],
        'zip'  => ['application/zip', 'application/x-zip-compressed'],
        'tar'  => ['application/x-tar'],
        'gz'   => ['application/gzip', 'application/x-gzip'],
        '7z'   => ['application/x-7z-compressed']
    ];

    private const TRIBUNE_INLINE_SAFE_MIMES = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/avif'
    ];

    /**
     * Validates a Tribune upload filename, detected MIME type and byte size against strict whitelist rules.
     * @return array{valid: bool, error?: string, ext?: string, safe_mime?: string}
     */
    public static function validateTribuneUpload(string $orig_name, string $detected_mime, int $size, ?int $max_bytes = null): array {
        $limit = $max_bytes ?? self::TRIBUNE_MAX_UPLOAD_BYTES;
        if ($size <= 0 || $size > $limit) {
            $max_mb = round($limit / (1024 * 1024), 1);
            return ['valid' => false, 'error' => "Le fichier dépasse la taille maximale autorisée ({$max_mb} Mo) ou est vide."];
        }

        $clean_name = basename(str_replace('\\', '/', $orig_name));
        if ($clean_name === '' || $clean_name[0] === '.') {
            return ['valid' => false, 'error' => 'Nom de fichier masqué ou invalide interdit.'];
        }

        // Reject suspicious double extensions (executables or active HTML/SVG)
        if (preg_match('/\.(php|phtml|php\d|phps|phar|inc|pl|py|cgi|sh|exe|bat|cmd|html|htm|xhtml|svg|js|mjs)\./i', $clean_name)) {
            return ['valid' => false, 'error' => 'Double extension suspecte interdite pour des raisons de sécurité.'];
        }

        $ext = strtolower(pathinfo($clean_name, PATHINFO_EXTENSION));
        if ($ext === '' || !isset(self::TRIBUNE_ALLOWED_UPLOAD_MIMES[$ext])) {
            return ['valid' => false, 'error' => "Type de fichier '.{$ext}' non autorisé sur la tribune."];
        }

        $mime_base = strtolower(trim(explode(';', $detected_mime)[0] ?? ''));
        // Never allow active HTML/SVG/XML/JS MIME types regardless of file extension
        $dangerous_mimes = ['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml', 'application/xml', 'text/javascript', 'application/javascript', 'application/x-httpd-php', 'text/x-php'];
        if (in_array($mime_base, $dangerous_mimes, true)) {
            return ['valid' => false, 'error' => 'Contenu actif (HTML/SVG/XML/Script) strictement interdit.'];
        }

        $allowed_mimes = self::TRIBUNE_ALLOWED_UPLOAD_MIMES[$ext];
        if (!in_array($mime_base, $allowed_mimes, true)) {
            return ['valid' => false, 'error' => "Incohérence entre l'extension '.{$ext}' et le type MIME détecté ({$mime_base})."];
        }

        return [
            'valid'     => true,
            'ext'       => $ext,
            'safe_mime' => $allowed_mimes[0]
        ];
    }

    /**
     * Computes hardened HTTP response headers for tribune_file_get.
     * Prevents same-origin Stored XSS by enforcing CSP sandbox + nosniff and forcing attachment for non-raster files.
     */
    public static function getTribuneFileResponseHeaders(string $ext, string $stored_mime, string $orig_name): array {
        $ext_lower = strtolower($ext);
        $mime_base = strtolower(trim(explode(';', $stored_mime)[0] ?? ''));

        $allowed_for_ext = self::TRIBUNE_ALLOWED_UPLOAD_MIMES[$ext_lower] ?? null;
        if ($allowed_for_ext !== null && in_array($mime_base, $allowed_for_ext, true)) {
            $safe_mime = $allowed_for_ext[0];
        } else {
            $safe_mime = 'application/octet-stream';
        }

        $is_inline_safe = in_array($safe_mime, self::TRIBUNE_INLINE_SAFE_MIMES, true);
        $disposition = $is_inline_safe ? 'inline' : 'attachment';
        $safe_filename = rawurlencode(basename(str_replace(["\r", "\n", "\0", '\\'], '', $orig_name)));

        return [
            'Content-Type'            => $safe_mime,
            'Content-Disposition'     => "{$disposition}; filename=\"{$safe_filename}\"",
            'X-Content-Type-Options'  => 'nosniff',
            'Content-Security-Policy' => "sandbox; default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none';",
            'Referrer-Policy'         => 'no-referrer',
            'Cache-Control'           => 'private, max-age=86400'
        ];
    }

    /**
     * Prunes temporary Tribune uploads older than $ttl_seconds (default 24h).
     */
    private static function pruneExpiredTribuneUploads(string $upload_dir, int $ttl_seconds = 86400): void {
        if (!is_dir($upload_dir)) return;
        $now = time();
        $entries = @scandir($upload_dir) ?: [];
        foreach ($entries as $entry) {
            if ($entry[0] === '.' || substr($entry, -5) !== '.json') continue;
            $meta_path = $upload_dir . '/' . $entry;
            $mtime = @filemtime($meta_path);
            if ($mtime !== false && ($now - $mtime) > $ttl_seconds) {
                $token = substr($entry, 0, -5);
                @unlink($meta_path);
                @unlink($upload_dir . '/' . $token . '.bin');
            }
        }
    }

    /**
     * Resolves the runtime storage directory (`<project_root>/storage` in production,
     * or `<sandbox>/storage` when an isolated test directory is provided).
     */
    public static function resolveStorageDir(string $base_dir = ''): string {
        return \SimpleGallery\Kernel\Config\ConfigStore::getStorageDir($base_dir);
    }

    public static function getBoardsFilePath(string $base_dir): string {
        $storage_dir = self::resolveStorageDir($base_dir);
        return $storage_dir . '/tribune_boards.json';
    }

    public static function getMessagesFilePath(string $base_dir): string {
        $storage_dir = self::resolveStorageDir($base_dir);
        return $storage_dir . '/tribune_messages.json';
    }

    public static function getSecretsConfig(string $base_dir): array {
        $storage_dir = self::resolveStorageDir($base_dir);
        $f1 = $storage_dir . '/tribune_secrets.php';
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
                'name'        => 'Tribune Interne (SimpleGallery)',
                'description' => 'Tribune de discussion locale intégrée à SimpleGallery WebOS',
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

    public static function isSafePublicUrl(string $url): bool {
        return \SimpleGallery\Kernel\Security\UrlValidator::isSafePublicUrl($url);
    }

    /**
     * Checks whether a remote URL's origin (scheme + host + port) matches a configured remote Tribune board.
     * Prevents unauthenticated open-proxy abuse while keeping configured boards (e.g. LinuxFr) 100% functional.
     */
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

        $boards = self::getBoardsConfig($base_dir);
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

    /**
     * Validates and consumes the per-board OAuth2 CSRF state token stored in session.
     */
    public static function verifyOauthState(string $board_id, string $state): bool {
        \SimpleGallery\Kernel\Auth\AuthManager::ensureSessionStarted();
        $key = 'tribune_oauth_state_' . $board_id;
        $expected = (string)($_SESSION[$key] ?? '');
        unset($_SESSION[$key]);
        if ($expected === '' || $state === '') {
            return false;
        }
        return hash_equals($expected, $state);
    }

    /**
     * Returns a stable hash identifying the current session owner for scheduled posts.
     */
    private static function getCurrentOwnerSessionHash(): string {
        \SimpleGallery\Kernel\Auth\AuthManager::ensureSessionStarted();
        $sid = session_id();
        if ($sid === '') {
            $sid = 'cli_session';
        }
        return hash('sha256', $sid);
    }

    /**
     * Strips sensitive fields (cookies, session ownership hashes) from scheduled post entries before API output.
     */
    public static function sanitizeScheduledItemForOutput(array $item): array {
        unset($item['cookie'], $item['owner_session_hash']);
        return $item;
    }

    public static function httpRequestProxy(string $url, string $method = 'GET', array $headers = [], ?string $post_data = null, int $timeout = 6): array {
        if (!self::isSafePublicUrl($url)) {
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
            $fetch = \SimpleGallery\Kernel\Security\UrlValidator::safeCurlFetch($url, [
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

    public static function processScheduledPosts(string $base_dir): void {
        $storage_dir = self::resolveStorageDir($base_dir);
        $sched_file = $storage_dir . '/tribune_scheduled_posts.json';
        if (!file_exists($sched_file)) return;

        $fp = @fopen($sched_file, 'c+');
        if (!$fp) return;

        if (@flock($fp, LOCK_EX)) {
            $content = '';
            while (!feof($fp)) {
                $content .= fread($fp, 8192);
            }
            $scheduled = @json_decode($content, true) ?: [];
            if (empty($scheduled)) {
                @flock($fp, LOCK_UN);
                @fclose($fp);
                return;
            }

            $now = time();
            $remaining = [];
            $due_posts = [];

            foreach ($scheduled as $item) {
                if (!empty($item['scheduled_at']) && $now >= (int)$item['scheduled_at']) {
                    $due_posts[] = $item;
                } else {
                    $remaining[] = $item;
                }
            }

            if (!empty($due_posts)) {
                ftruncate($fp, 0);
                rewind($fp);
                fwrite($fp, json_encode(array_values($remaining), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
                fflush($fp);
                @flock($fp, LOCK_UN);
                @fclose($fp);

                foreach ($due_posts as $post) {
                    $board = $post['board'] ?? 'local';
                    if ($board === 'local') {
                        $storage_file = $storage_dir . '/tribune_messages.json';
                        $messages = [];
                        if (file_exists($storage_file)) {
                            $messages = @json_decode(@file_get_contents($storage_file), true) ?: [];
                        }

                        $max_id = 0;
                        foreach ($messages as $m) {
                            if (isset($m['id']) && $m['id'] > $max_id) $max_id = (int)$m['id'];
                        }

                        $post_time = $post['scheduled_at'] ?? time();
                        $new_post = [
                            'id'        => $max_id + 1,
                            'time'      => date('YmdHis', $post_time),
                            'clock'     => date('H:i:s', $post_time),
                            'login'     => htmlspecialchars($post['login'] ?? 'Anonyme', ENT_QUOTES, 'UTF-8'),
                            'info'      => htmlspecialchars($post['info'] ?? 'SimpleGallery Scheduled', ENT_QUOTES, 'UTF-8'),
                            'message'   => htmlspecialchars($post['message'] ?? '', ENT_QUOTES, 'UTF-8'),
                            'is_admin'  => !empty($post['is_admin']),
                            'board'     => 'local'
                        ];

                        $messages[] = $new_post;
                        if (count($messages) > 300) {
                            $messages = array_slice($messages, -300);
                        }
                        @file_put_contents($storage_file, json_encode($messages, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
                        @touch($storage_file);
                    } else {
                        if (!empty($post['target_url'])) {
                            $headers = [
                                "User-Agent: " . ($post['user_agent'] ?? 'SimpleGallery-Scheduled/1.0'),
                                "Content-Type: application/x-www-form-urlencoded"
                            ];
                            if (!empty($post['cookie'])) {
                                $headers[] = "Cookie: " . $post['cookie'];
                            }

                            $post_fields = [];
                            $field_name = $post['post_field'] ?? 'message';
                            $post_fields[$field_name] = $post['message'];

                            self::httpRequestProxy($post['target_url'], 'POST', $headers, http_build_query($post_fields), 6);
                        }
                    }
                }
            } else {
                @flock($fp, LOCK_UN);
                @fclose($fp);
            }
        } else {
            @fclose($fp);
        }
    }

    public static function handle(string $action, array $raw_body, $base_dir): ?array {
        if (is_array($base_dir)) {
            $base_dir = (string)($base_dir['project_root'] ?? $base_dir['base_dir'] ?? '');
        } else {
            $base_dir = (string)$base_dir;
        }
        $storage_dir = self::resolveStorageDir($base_dir);
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
            if (!\SimpleGallery\Kernel\Auth\AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => 'Action réservée à l\'administrateur.']];
            }

            $new_boards = $_POST['boards'] ?? $raw_body['boards'] ?? null;
            if (!is_array($new_boards)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'Format de configuration invalide.']];
            }

            // Validate URLs for all configured boards (block javascript:, file:, private SSRF targets)
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

        if ($action === 'tribune_oauth_authorize') {
            $board_id = trim($_GET['board_id'] ?? $_POST['board_id'] ?? $raw_body['board_id'] ?? '');
            $all_boards = self::getBoardsConfig($base_dir);
            $board_cfg = $all_boards[$board_id] ?? null;
            $oauth_cfg = $board_cfg['oauth'] ?? null;

            if (!$oauth_cfg || empty($oauth_cfg['authorize_url'])) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'Configuration OAuth2 manquante pour cette tribune.']];
            }

            $client_id = !empty($oauth_cfg['client_id']) ? $oauth_cfg['client_id'] : self::getOauthSecret($board_id, 'client_id', $base_dir);
            if (empty($client_id)) $client_id = 'simplegallery_webos';

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

            // Enforce strict OAuth2 CSRF state validation
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

            $res = self::httpRequestProxy($oauth_cfg['token_url'], 'POST', ["Content-Type: application/x-www-form-urlencoded", "User-Agent: SimpleGallery-WebOS/1.0"], http_build_query($post_fields), 10);
            $data = @json_decode($res['body'], true) ?: [];
            $token = $data['access_token'] ?? '';
            $login = $data['login'] ?? '';

            if (empty($login) && !empty($token)) {
                $me_res = self::httpRequestProxy("https://linuxfr.org/api/v1/me?bearer_token=" . urlencode($token), 'GET', ["User-Agent: SimpleGallery-WebOS/1.0"], null, 5);
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
                'client_id'     => $client_id ?: 'simplegallery_webos',
                'client_secret' => $client_secret ?? '',
                'refresh_token' => $refresh_token,
                'grant_type'    => 'refresh_token'
            ];

            $res = self::httpRequestProxy($oauth_cfg['token_url'], 'POST', [
                'Content-Type: application/x-www-form-urlencoded',
                'User-Agent: SimpleGallery-WebOS/1.0'
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

        if ($action === 'tribune_schedule_post') {
            global $rate_limits;
            $sched_max = (int)($rate_limits['tribune_schedule']['max_attempts'] ?? 20);
            $sched_decay = (int)($rate_limits['tribune_schedule']['decay_seconds'] ?? 60);
            $sched_rl_key = 'tribune_schedule_' . \SimpleGallery\Kernel\Security\RateLimiter::getClientIp();
            if (!\SimpleGallery\Kernel\Security\RateLimiter::check($sched_rl_key, $sched_max, $sched_decay)) {
                return ['status' => 429, 'data' => ['success' => false, 'error' => 'Trop de programmations récentes. Veuillez patienter.']];
            }
            \SimpleGallery\Kernel\Security\RateLimiter::increment($sched_rl_key);

            $msg_text    = trim($_POST['message'] ?? $raw_body['message'] ?? '');
            $login       = trim($_POST['login'] ?? $raw_body['login'] ?? 'Anonyme');
            $info        = trim($_POST['info'] ?? $raw_body['info'] ?? 'SimpleGallery Client');
            $board       = trim($_POST['board'] ?? $raw_body['board'] ?? 'local');
            $sched_ts    = (int)($_POST['scheduled_at'] ?? $raw_body['scheduled_at'] ?? 0);
            $target_url  = trim($_POST['target_url'] ?? $raw_body['target_url'] ?? '');
            $post_field  = trim($_POST['post_field'] ?? $raw_body['post_field'] ?? 'message');
            $cookie_hdr  = trim($_POST['cookie'] ?? $raw_body['cookie'] ?? '');
            $user_agent  = trim($_POST['user_agent'] ?? $raw_body['user_agent'] ?? 'SimpleGallery Client');

            if (empty($msg_text)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'Le message ne peut pas être vide.']];
            }

            if ($sched_ts <= (time() - 30)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'L\'heure programmée doit être située dans le futur.']];
            }

            if ($board !== 'local' && $target_url !== '') {
                $is_admin = \SimpleGallery\Kernel\Auth\AuthManager::isAdminLoggedIn();
                if (!self::isSafePublicUrl($target_url) || (!$is_admin && !self::isAllowedBoardRemoteUrl($target_url, $base_dir))) {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => 'URL cible distante non autorisée pour l\'envoi programmé.']];
                }
            }

            $sched_file = $storage_dir . '/tribune_scheduled_posts.json';
            $scheduled = [];
            if (file_exists($sched_file)) {
                $scheduled = @json_decode(@file_get_contents($sched_file), true) ?: [];
            }

            $id = bin2hex(random_bytes(10));
            $owner_hash = self::getCurrentOwnerSessionHash();
            $scheduled_item = [
                'id'                 => $id,
                'message'            => $msg_text,
                'login'              => $login,
                'info'               => $info,
                'board'              => $board,
                'scheduled_at'       => $sched_ts,
                'target_url'         => $target_url,
                'post_field'         => $post_field,
                'cookie'             => $cookie_hdr,
                'user_agent'         => $user_agent,
                'is_admin'           => \SimpleGallery\Kernel\Auth\AuthManager::isAdminLoggedIn(),
                'owner_session_hash' => $owner_hash,
                'created_at'         => time()
            ];

            $scheduled[] = $scheduled_item;
            @file_put_contents($sched_file, json_encode(array_values($scheduled), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);

            return ['status' => 200, 'data' => [
                'success'   => true,
                'message'   => 'Message programmé avec succès.',
                'item'      => self::sanitizeScheduledItemForOutput($scheduled_item),
                'count'     => count($scheduled)
            ]];
        }

        if ($action === 'tribune_scheduled_list') {
            self::processScheduledPosts($base_dir);
            $sched_file = $storage_dir . '/tribune_scheduled_posts.json';
            $scheduled = [];
            if (file_exists($sched_file)) {
                $scheduled = @json_decode(@file_get_contents($sched_file), true) ?: [];
            }

            $is_admin = \SimpleGallery\Kernel\Auth\AuthManager::isAdminLoggedIn();
            $owner_hash = self::getCurrentOwnerSessionHash();
            $visible = [];
            foreach ($scheduled as $item) {
                if (!is_array($item)) continue;
                $item_owner = (string)($item['owner_session_hash'] ?? '');
                if ($is_admin || ($item_owner !== '' && hash_equals($item_owner, $owner_hash))) {
                    $visible[] = self::sanitizeScheduledItemForOutput($item);
                }
            }

            return ['status' => 200, 'data' => [
                'success'   => true,
                'scheduled' => $visible,
                'count'     => count($visible),
                'server_ts' => time()
            ]];
        }

        if ($action === 'tribune_schedule_cancel') {
            $id = trim($_POST['id'] ?? $raw_body['id'] ?? '');
            if (empty($id)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'ID de message programmé manquant.']];
            }

            $sched_file = $storage_dir . '/tribune_scheduled_posts.json';
            $scheduled = [];
            if (file_exists($sched_file)) {
                $scheduled = @json_decode(@file_get_contents($sched_file), true) ?: [];
            }

            $is_admin = \SimpleGallery\Kernel\Auth\AuthManager::isAdminLoggedIn();
            $owner_hash = self::getCurrentOwnerSessionHash();
            $found = false;
            $authorized = false;
            $filtered = [];

            foreach ($scheduled as $item) {
                if (($item['id'] ?? '') === $id) {
                    $found = true;
                    $item_owner = (string)($item['owner_session_hash'] ?? '');
                    if ($is_admin || ($item_owner !== '' && hash_equals($item_owner, $owner_hash))) {
                        $authorized = true;
                        continue; // Remove this item
                    }
                }
                $filtered[] = $item;
            }

            if ($found && !$authorized) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => 'Accès refusé : vous ne pouvez annuler que vos propres messages programmés.']];
            }

            @file_put_contents($sched_file, json_encode(array_values($filtered), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);

            return ['status' => 200, 'data' => [
                'success' => true,
                'message' => 'Programmation annulée avec succès.',
                'count'   => count($filtered)
            ]];
        }

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
                        'login'     => 'oktail',
                        'info'      => 'SimpleGallery WebOS',
                        'message'   => 'Bienvenue sur la Tribune Libre de SimpleGallery ! [:totoz] Horloge cliquable, Totoz, Trollomètre et BAK sont activés. 🦆',
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
            $info     = trim($_POST['info'] ?? $raw_body['info'] ?? ($_SERVER['HTTP_USER_AGENT'] ?? 'SimpleGallery Client'));

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
            $time_id  = date('YmdHis', $now_ts);
            $clock    = date('H:i:s', $now_ts);
            $is_admin = !empty($_SESSION['is_admin']);

            $new_post = [
                'id'       => $last_id + 1,
                'time'     => $time_id,
                'clock'    => $clock,
                'login'    => htmlspecialchars($login, ENT_QUOTES, 'UTF-8'),
                'info'     => htmlspecialchars($info, ENT_QUOTES, 'UTF-8'),
                'message'  => htmlspecialchars($msg_text, ENT_QUOTES, 'UTF-8'),
                'is_admin' => $is_admin,
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

        if ($action === 'tribune_proxy_fetch') {
            global $rate_limits;
            $px_max = (int)($rate_limits['tribune_proxy']['max_attempts'] ?? 60);
            $px_decay = (int)($rate_limits['tribune_proxy']['decay_seconds'] ?? 60);
            $px_rl_key = 'tribune_proxy_' . \SimpleGallery\Kernel\Security\RateLimiter::getClientIp();
            if (!\SimpleGallery\Kernel\Security\RateLimiter::check($px_rl_key, $px_max, $px_decay)) {
                return ['status' => 429, 'data' => ['success' => false, 'error' => 'Trop de requêtes proxy tribune. Veuillez patienter.']];
            }
            \SimpleGallery\Kernel\Security\RateLimiter::increment($px_rl_key);

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

            if (!self::isSafePublicUrl($remote_url)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => 'Accès refusé : adresse IP ou réseau privé non autorisé (anti-SSRF).']];
            }

            if (!\SimpleGallery\Kernel\Auth\AuthManager::isAdminLoggedIn() && !self::isAllowedBoardRemoteUrl($remote_url, $base_dir)) {
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

        if ($action === 'tribune_proxy_post') {
            $board_id        = trim($_POST['board_id'] ?? $raw_body['board_id'] ?? '');
            $remote_url      = trim($_POST['url'] ?? $raw_body['url'] ?? '');
            $custom_post_url = trim($_POST['post_url'] ?? $raw_body['post_url'] ?? '');
            $msg_text        = trim($_POST['message'] ?? $raw_body['message'] ?? '');
            $login           = trim($_POST['login'] ?? $raw_body['login'] ?? 'Anonyme');
            $cookie_hdr      = trim($_POST['cookie'] ?? $raw_body['cookie'] ?? '');
            $user_agent      = trim($_POST['user_agent'] ?? $raw_body['user_agent'] ?? 'Mozilla/5.0 (SimpleGallery Tribune)');

            // Look up board configuration dynamically from JSON storage
            $all_boards = self::getBoardsConfig($base_dir);
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

            // Resolve post_url
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

            if (!self::isSafePublicUrl($post_url)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => 'Accès refusé : destination réseau privée non autorisée (anti-SSRF).']];
            }

            global $rate_limits;
            $px_max = (int)($rate_limits['tribune_proxy']['max_attempts'] ?? 60);
            $px_decay = (int)($rate_limits['tribune_proxy']['decay_seconds'] ?? 60);
            $px_rl_key = 'tribune_proxy_' . \SimpleGallery\Kernel\Security\RateLimiter::getClientIp();
            if (!\SimpleGallery\Kernel\Security\RateLimiter::check($px_rl_key, $px_max, $px_decay)) {
                return ['status' => 429, 'data' => ['success' => false, 'error' => 'Trop de requêtes proxy tribune. Veuillez patienter.']];
            }
            \SimpleGallery\Kernel\Security\RateLimiter::increment($px_rl_key);

            if (!\SimpleGallery\Kernel\Auth\AuthManager::isAdminLoggedIn() && !self::isAllowedBoardRemoteUrl($post_url, $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => 'Accès refusé : l\'URL de publication ne correspond à aucune tribune configurée.']];
            }

            $parsed_post_url = parse_url($post_url);
            $origin = ($parsed_post_url['scheme'] ?? 'https') . '://' . ($parsed_post_url['host'] ?? '');

            // Step 1: Resolve CSRF token (use cached session token if available to save latency)
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

            // Step 2: Helper to perform POST
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

            // Retry once if token expired or invalid (HTTP 422 or HTTP 400 with token error)
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
                    'error'       => 'Authentification refusée par le backend distant (cookie de session linuxfr.org manquant ou expiré).'
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
            } else {
                return ['status' => 400, 'data' => [
                    'success'     => false,
                    'status_code' => $status_code,
                    'error'       => "Le backend distant a répondu avec le code HTTP {$status_code}.",
                    'details'     => mb_substr(trim(strip_tags($post_res['body'] ?? '')), 0, 300)
                ]];
            }
        }

        if ($action === 'tribune_clear_history') {
            if (empty($_SESSION['is_admin'])) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => 'Action réservée à l\'administrateur.']];
            }

            $storage_file = $storage_dir . '/tribune_messages.json';
            @file_put_contents($storage_file, json_encode([], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);

            return ['status' => 200, 'data' => ['success' => true, 'message' => 'Historique de la tribune réinitialisé.']];
        }

        if ($action === 'tribune_file_upload') {
            $project_root = dirname(dirname(dirname(__DIR__)));
            $is_authorized = \SimpleGallery\Kernel\Auth\AuthManager::isAdminLoggedIn()
                || \SimpleGallery\Kernel\FS\PermissionsManager::hasPermission('can_upload', $project_root)
                || \SimpleGallery\Kernel\FS\PermissionsManager::hasPermission('can_upload', $base_dir);

            if (!$is_authorized) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => 'Accès refusé : le téléversement de fichiers sur la tribune requiert la permission d\'upload ou une connexion administrateur.']];
            }

            global $rate_limits;
            $max_attempts = (int)($rate_limits['tribune_upload']['max_attempts'] ?? 15);
            $decay_seconds = (int)($rate_limits['tribune_upload']['decay_seconds'] ?? 60);
            $rl_key = 'tribune_upload_' . \SimpleGallery\Kernel\Security\RateLimiter::getClientIp();
            if (!\SimpleGallery\Kernel\Security\RateLimiter::check($rl_key, $max_attempts, $decay_seconds)) {
                return ['status' => 429, 'data' => ['success' => false, 'error' => 'Trop de téléversements récents. Veuillez patienter avant de réessayer.']];
            }
            \SimpleGallery\Kernel\Security\RateLimiter::increment($rl_key);

            if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'Aucun fichier valide n\'a été transmis ou erreur lors du téléversement.']];
            }

            $file = $_FILES['file'];
            $orig_name = basename(str_replace('\\', '/', (string)$file['name']));

            $mime_type = 'application/octet-stream';
            if (function_exists('finfo_open')) {
                $finfo = finfo_open(FILEINFO_MIME_TYPE);
                if ($finfo) {
                    $detected = finfo_file($finfo, $file['tmp_name']);
                    if ($detected) $mime_type = $detected;
                    finfo_close($finfo);
                }
            } elseif (function_exists('mime_content_type')) {
                $detected = @mime_content_type($file['tmp_name']);
                if ($detected) $mime_type = $detected;
            }

            $validation = self::validateTribuneUpload($orig_name, $mime_type, (int)($file['size'] ?? 0));
            if (empty($validation['valid'])) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => $validation['error'] ?? 'Fichier refusé pour des raisons de sécurité.']];
            }

            $ext = $validation['ext'];
            $safe_mime = $validation['safe_mime'];

            $upload_dir = $storage_dir . '/tribune_uploads';
            if (!is_dir($upload_dir)) @mkdir($upload_dir, 0755, true);
            self::pruneExpiredTribuneUploads($upload_dir, 86400);

            $token = bin2hex(random_bytes(16));
            $bin_path = $upload_dir . '/' . $token . '.bin';
            $meta_path = $upload_dir . '/' . $token . '.json';

            if (!move_uploaded_file($file['tmp_name'], $bin_path)) {
                return ['status' => 500, 'data' => ['success' => false, 'error' => 'Échec de l\'enregistrement du fichier temporaire sur le serveur.']];
            }
            @chmod($bin_path, 0644);

            $now = time();
            $meta_data = [
                'token'         => $token,
                'original_name' => $orig_name,
                'mime_type'     => $safe_mime,
                'size'          => (int)$file['size'],
                'uploaded_at'   => $now,
                'ext'           => $ext
            ];

            @file_put_contents($meta_path, json_encode($meta_data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);

            return ['status' => 200, 'data' => [
                'success'       => true,
                'token'         => $token,
                'original_name' => $orig_name,
                'size'          => (int)$file['size'],
                'mime_type'     => $safe_mime,
                'url'           => 'system/endpoints/api.php?action=tribune_file_get&token=' . $token
            ]];
        }

        if ($action === 'tribune_file_get') {
            @session_write_close();
            $token = trim($_GET['token'] ?? $raw_body['token'] ?? '');
            $token = preg_replace('/[^a-f0-9]/i', '', $token);

            if (empty($token) || strlen($token) !== 32) {
                http_response_code(400);
                echo "Jeton de fichier invalide.";
                exit;
            }

            $upload_dir = $storage_dir . '/tribune_uploads';
            $bin_path = $upload_dir . '/' . $token . '.bin';
            $meta_path = $upload_dir . '/' . $token . '.json';

            if (!file_exists($bin_path) || !file_exists($meta_path)) {
                http_response_code(404);
                echo "Fichier temporaire introuvable ou expiré.";
                exit;
            }

            $meta = @json_decode(@file_get_contents($meta_path), true) ?: [];
            $stored_mime = (string)($meta['mime_type'] ?? 'application/octet-stream');
            $orig_name = (string)($meta['original_name'] ?? ('tribune_' . $token . '.bin'));
            $ext = (string)($meta['ext'] ?? pathinfo($orig_name, PATHINFO_EXTENSION));

            $headers = self::getTribuneFileResponseHeaders($ext, $stored_mime, $orig_name);
            foreach ($headers as $h_name => $h_val) {
                header("{$h_name}: {$h_val}");
            }
            header('Content-Length: ' . filesize($bin_path));

            readfile($bin_path);
            exit;
        }

        if ($action === 'totoz_proxy') {
            @session_write_close();
            $name = trim($_GET['name'] ?? $raw_body['name'] ?? 'totoz');
            $name = preg_replace('/[^a-zA-Z0-9_\.: -]/', '', $name);
            if (empty($name)) $name = 'totoz';

            $remote_url = "https://totoz.eu/img/" . rawurlencode($name);
            $fetch = \SimpleGallery\Kernel\Security\UrlValidator::safeCurlFetch($remote_url, [
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

        if ($action === 'totoz_search') {
            @session_write_close();
            $q = trim($_GET['q'] ?? $raw_body['q'] ?? '');
            $q = preg_replace('/[^a-zA-Z0-9_\.: -]/', '', $q);

            $remote_url = "https://totoz.eu/search.xml?terms=" . urlencode($q);
            $fetch = \SimpleGallery\Kernel\Security\UrlValidator::safeCurlFetch($remote_url, [
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

        if ($action === 'url_preview') {
            @session_write_close();
            $url = trim($_GET['url'] ?? $raw_body['url'] ?? '');
            if (empty($url) || !preg_match('#^https?://#i', $url)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'URL invalide']];
            }

            if (!self::isSafePublicUrl($url)) {
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

        return null;
    }
}
