<?php
namespace SimpleGallery\Apps\Browser\Backend;

use SimpleGallery\Kernel\Auth\AuthManager;
use SimpleGallery\Kernel\FS\PermissionsManager;
use SimpleGallery\Kernel\Security\RateLimiter;
use SimpleGallery\Kernel\Security\UrlValidator;

class BrowserProxyAction {

    /**
     * Check if a URL is safe for public proxying (Anti-SSRF).
     */
    public static function isSafePublicUrl(string $url): bool {
        return UrlValidator::isSafePublicUrl($url);
    }

    /**
     * Security headers enforced on all proxied responses.
     * CSP sandbox without allow-same-origin forces an opaque origin ('null'),
     * preventing proxied scripts from accessing SimpleGallery cookies, storage,
     * CSRF tokens, or DOM even if opened directly as a top-level document.
     */
    public static function getProxySecurityHeaders(): array {
        return [
            'Content-Security-Policy' => 'sandbox allow-scripts allow-forms allow-popups;',
            'X-Frame-Options'         => 'SAMEORIGIN',
            'X-Content-Type-Options'  => 'nosniff',
            'Referrer-Policy'         => 'no-referrer'
        ];
    }

    /**
     * Sanitize and restrict proxied Content-Type to safe web MIME types.
     */
    public static function sanitizeContentType(string $raw_content_type): string {
        $clean = preg_replace('/[\r\n\0]/', '', trim($raw_content_type));
        $parts = explode(';', $clean);
        $mime = strtolower(trim($parts[0] ?? ''));
        $charset = '';
        for ($i = 1; $i < count($parts); $i++) {
            if (preg_match('/^\s*charset\s*=\s*([a-zA-Z0-9._-]+)\s*$/i', $parts[$i], $m)) {
                $charset = '; charset=' . $m[1];
                break;
            }
        }

        $allowed_mimes = [
            'text/html',
            'application/xhtml+xml',
            'text/plain',
            'text/css',
            'application/json',
            'image/png',
            'image/jpeg',
            'image/gif',
            'image/webp',
            'image/avif',
            'application/pdf'
        ];

        if (!in_array($mime, $allowed_mimes, true)) {
            return 'text/plain; charset=utf-8';
        }

        if (in_array($mime, ['text/html', 'application/xhtml+xml', 'text/plain'], true) && $charset === '') {
            $charset = '; charset=utf-8';
        }

        return $mime . $charset;
    }

    /**
     * Rewrite HTML to inject <base> and proxy navigation script.
     */
    public static function processHtml(string $html, string $source_url): string {
        $parsed = parse_url($source_url);
        $scheme = $parsed['scheme'] ?? 'https';
        $host = $parsed['host'] ?? '';
        $port = isset($parsed['port']) ? ':' . $parsed['port'] : '';
        $path = isset($parsed['path']) ? dirname($parsed['path']) : '';
        if ($path === '\\' || $path === '.') $path = '';

        $base_url = rtrim($scheme . '://' . $host . $port . $path, '/') . '/';
        $encoded_source_url = json_encode($source_url, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);

        // Script to intercept links and delegate navigation safely via postMessage to WebOS BrowserApp
        $proxy_client_script = '<script id="webos-browser-proxy-helper">'
            . '(function(){'
            . '  document.addEventListener("click", function(e){'
            . '    var a = e.target && e.target.closest ? e.target.closest("a") : null;'
            . '    if(a && a.href && (a.href.startsWith("http://") || a.href.startsWith("https://"))){'
            . '      if(!a.href.includes("action=browser_proxy")){'
            . '        e.preventDefault();'
            . '        if(window.parent && window.parent !== window){'
            . '          window.parent.postMessage({ type: "webos-browser-navigate-request", url: a.href }, "*");'
            . '        }'
            . '      }'
            . '    }'
            . '  }, true);'
            . '  if(window.parent && window.parent !== window){'
            . '    window.parent.postMessage({ type: "webos-browser-navigated", url: ' . $encoded_source_url . ' }, "*");'
            . '  }'
            . '})();'
            . '</script>';

        // Inject <base> tag if not present
        if (!preg_match('/<base\s[^>]*href=/i', $html)) {
            $base_tag = '<base href="' . htmlspecialchars($base_url, ENT_QUOTES, 'UTF-8') . '" />' . "\n" . $proxy_client_script;
            if (stripos($html, '<head>') !== false) {
                $html = preg_replace('/<head>/i', "<head>\n" . $base_tag, $html, 1);
            } elseif (stripos($html, '<html') !== false) {
                $html = preg_replace('/(<html[^>]*>)/i', "$1\n<head>" . $base_tag . "</head>", $html, 1);
            } else {
                $html = "<head>" . $base_tag . "</head>\n" . $html;
            }
        } else {
            // Append helper script after existing base or head
            if (stripos($html, '</head>') !== false) {
                $html = str_ireplace('</head>', $proxy_client_script . "\n</head>", $html);
            } else {
                $html = $proxy_client_script . "\n" . $html;
            }
        }

        return $html;
    }

    /**
     * Render a styled HTML error response for browser iframe / web requests.
     */
    private static function sendWebError(int $status, string $title, string $message, string $detail = ''): void {
        @session_write_close();
        http_response_code($status);
        foreach (self::getProxySecurityHeaders() as $k => $v) {
            header("{$k}: {$v}");
        }
        header('Content-Type: text/html; charset=utf-8');
        echo '<div style="font-family:sans-serif;padding:30px;background:#0f172a;color:#f8fafc;min-height:100vh;">'
           . '<h2 style="color:#ef4444;">' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</h2>'
           . '<p>' . htmlspecialchars($message, ENT_QUOTES, 'UTF-8') . '</p>';
        if ($detail !== '') {
            echo '<p style="color:#94a3b8;font-size:0.9rem;">Détails : ' . htmlspecialchars($detail, ENT_QUOTES, 'UTF-8') . '</p>';
        }
        echo '</div>';
        exit;
    }

    /**
     * Dispatcher handle entry point.
     */
    public static function handle(string $action, array $params, array $context): ?array {
        if ($action !== 'browser_proxy') {
            return null;
        }

        // Strict CLI-only test mode: never trust test_mode / mock_body / enforce_* from HTTP $_GET/$_POST params
        $is_cli_runtime = (PHP_SAPI === 'cli') && empty($context['simulate_web']);
        $is_test = $is_cli_runtime && !empty($context['test_mode']);
        $base_dir = (string)($context['base_dir'] ?? dirname(dirname(dirname(__DIR__))));
        $project_root = dirname(dirname(dirname(__DIR__)));

        // 1. Authentication / Permission Gate (prevents anonymous open-proxy abuse)
        if (!$is_test || !empty($context['enforce_auth'])) {
            $is_authorized = AuthManager::isAdminLoggedIn()
                || PermissionsManager::hasPermission('can_use_browser_proxy', $project_root)
                || PermissionsManager::hasPermission('can_use_browser_proxy', $base_dir);

            if (!$is_authorized) {
                $err = 'Accès refusé : le proxy navigateur WebOS nécessite une connexion administrateur ou une autorisation explicite.';
                if ($is_test || $is_cli_runtime) {
                    return [
                        'status' => 403,
                        'data'   => ['success' => false, 'error' => $err]
                    ];
                }
                self::sendWebError(403, '🔒 Accès Proxy Refusé (403)', $err);
            }
        }

        // 2. IP Rate Limiting
        if (!$is_test || !empty($context['enforce_rate_limit'])) {
            global $rate_limits;
            $max_attempts = (int)($rate_limits['browser_proxy']['max_attempts'] ?? 30);
            $decay_seconds = (int)($rate_limits['browser_proxy']['decay_seconds'] ?? 60);

            if (!RateLimiter::check('browser_proxy', $max_attempts, $decay_seconds)) {
                $err = 'Trop de requêtes proxy. Veuillez patienter avant de réessayer.';
                if ($is_test || $is_cli_runtime) {
                    return [
                        'status' => 429,
                        'data'   => ['success' => false, 'error' => $err]
                    ];
                }
                self::sendWebError(429, '⏱️ Limite de Débit Atteinte (429)', $err);
            }
            RateLimiter::increment('browser_proxy');
        }

        $url = trim((string)($params['url'] ?? $_GET['url'] ?? ''));
        if (empty($url) || !filter_var($url, FILTER_VALIDATE_URL)) {
            return [
                'status' => 400,
                'data'   => ['success' => false, 'error' => 'URL invalide ou absente.']
            ];
        }

        $scheme = strtolower((string)(parse_url($url, PHP_URL_SCHEME) ?? ''));
        if (!in_array($scheme, ['http', 'https'], true)) {
            return [
                'status' => 400,
                'data'   => ['success' => false, 'error' => 'Seuls les protocoles HTTP et HTTPS sont autorisés.']
            ];
        }

        if (!self::isSafePublicUrl($url)) {
            $err = 'Accès refusé : adresse IP ou réseau privé non autorisé (anti-SSRF).';
            if ($is_test || $is_cli_runtime) {
                return [
                    'status' => 403,
                    'data'   => ['success' => false, 'error' => $err]
                ];
            }
            self::sendWebError(403, '🛡️ Requête Bloquée (Anti-SSRF)', $err, $url);
        }

        // Check if running in mock/CLI test mode (strictly from $context, never HTTP params)
        if ($is_test && !empty($context['mock_body'])) {
            $processed = self::processHtml((string)$context['mock_body'], $url);
            return [
                'status' => 200,
                'data'   => [
                    'success'      => true,
                    'url'          => $url,
                    'content_type' => 'text/html; charset=utf-8',
                    'headers'      => self::getProxySecurityHeaders(),
                    'content'      => $processed
                ]
            ];
        }

        // Perform SSRF-hardened cURL fetch (manual per-hop redirect validation, DNS IP pinning, size limit)
        $fetch = UrlValidator::safeCurlFetch($url, [
            'method'           => 'GET',
            'connect_timeout'  => 4,
            'timeout'          => 8,
            'follow_redirects' => true,
            'max_redirects'    => 5,
            'max_bytes'        => 5 * 1024 * 1024,
            'user_agent'       => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SimpleGallery-WebOSBrowser/1.0',
            'headers'          => [
                'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language: fr,fr-FR;q=0.9,en;q=0.8',
                'Cache-Control: no-cache'
            ]
        ]);

        if (!empty($fetch['ssrf_blocked'])) {
            if ($is_test || $is_cli_runtime) {
                return [
                    'status' => 403,
                    'data'   => ['success' => false, 'error' => $fetch['error']]
                ];
            }
            self::sendWebError(403, '🛡️ Redirection Bloquée (Anti-SSRF)', $fetch['error'], $fetch['final_url'] ?? $url);
        }

        if (!$fetch['success'] && empty($fetch['body'])) {
            $status = (int)($fetch['status_code'] ?: 502);
            $err_msg = $fetch['error'] ?: 'Impossible de contacter le serveur distant.';
            if ($is_test || $is_cli_runtime) {
                return [
                    'status' => $status,
                    'data'   => ['success' => false, 'error' => $err_msg]
                ];
            }
            self::sendWebError($status, "❌ Erreur Proxy WebOS ({$status})", "Le serveur WebOS n'a pas pu joindre la destination distante.", $err_msg);
        }

        $final_url = $fetch['final_url'] ?: $url;
        $status_code = (int)($fetch['status_code'] ?: 200);
        $raw_content_type = (string)($fetch['content_type'] ?? '');
        $safe_content_type = self::sanitizeContentType($raw_content_type);
        $body = (string)($fetch['body'] ?? '');

        // Process HTML content
        $is_html = (stripos($safe_content_type, 'text/html') !== false || stripos($safe_content_type, 'application/xhtml+xml') !== false);
        if ($is_html) {
            $body = self::processHtml($body, $final_url);
        }

        if ($is_test || $is_cli_runtime) {
            return [
                'status' => $status_code,
                'data'   => [
                    'success'      => true,
                    'url'          => $final_url,
                    'content_type' => $safe_content_type,
                    'headers'      => self::getProxySecurityHeaders(),
                    'content'      => $body
                ]
            ];
        }

        // Web Request output with strict origin isolation
        @session_write_close();
        http_response_code($status_code);
        header("Content-Type: {$safe_content_type}");
        foreach (self::getProxySecurityHeaders() as $header_name => $header_val) {
            header("{$header_name}: {$header_val}");
        }

        echo $body;
        exit;
    }
}
