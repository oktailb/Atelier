<?php
namespace SimpleGallery\Kernel\Security;

/**
 * Kernel URL Validator & SSRF-Safe HTTP Client
 * Validates public URLs/IPs (IPv4, IPv6, IPv4-mapped IPv6, CGNAT) and performs
 * redirect-safe, DNS-rebinding-resistant cURL fetches.
 */
class UrlValidator {

    private const BLOCKED_HOSTS = [
        'localhost',
        'loopback',
        'broadcasthost',
        '127.0.0.1',
        '0.0.0.0',
        '::1',
        '::',
        '169.254.169.254',
        'metadata.google.internal',
        'metadata'
    ];

    /**
     * Validates that a single IPv4 or IPv6 address is strictly publicly routable.
     */
    public static function isSafePublicIp(string $ip): bool {
        $ip = trim($ip, " \t\n\r\0\x0B[]");
        if ($ip === '' || !filter_var($ip, FILTER_VALIDATE_IP)) {
            return false;
        }

        // Check IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1, ::ffff:7f00:1)
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
            $packed = @inet_pton($ip);
            if ($packed === false || strlen($packed) !== 16) {
                return false;
            }
            // ::ffff:0:0/96 prefix (10 zero bytes + 2 0xff bytes)
            if (substr($packed, 0, 12) === "\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\xff\xff") {
                $mapped_v4 = @inet_ntop(substr($packed, 12, 4));
                if ($mapped_v4 === false) {
                    return false;
                }
                return self::isSafePublicIp($mapped_v4);
            }
            // Reject IPv6 loopback (::1), unspecified (::), ULA (fc00::/7), link-local (fe80::/10), multicast (ff00::/8)
            $first_byte = ord($packed[0]);
            $second_byte = ord($packed[1]);
            if (($first_byte & 0xfe) === 0xfc) return false; // fc00::/7
            if ($first_byte === 0xfe && ($second_byte & 0xc0) === 0x80) return false; // fe80::/10
            if ($first_byte === 0xff) return false; // ff00::/8
        }

        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return false;
        }

        // Additional explicit IPv4 checks: loopback, link-local, 0/8, CGNAT 100.64.0.0/10, multicast/reserved
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            $long = ip2long($ip);
            if ($long === false) {
                return false;
            }
            $u = (int)sprintf('%u', $long);
            // 0.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16, 100.64.0.0/10 (CGNAT)
            if (($u & 0xFF000000) === 0x00000000) return false;
            if (($u & 0xFF000000) === 0x7F000000) return false;
            if (($u & 0xFFFF0000) === 0xA9FE0000) return false;
            if (($u & 0xFFC00000) === 0x64400000) return false;
        }

        return true;
    }

    /**
     * Parses, resolves DNS, and validates that a URL points exclusively to safe public HTTP(S) IPs.
     * Returns ['url' => ..., 'scheme' => ..., 'host' => ..., 'port' => ..., 'ips' => [...]] or null if unsafe.
     */
    public static function resolveAndValidateUrl(string $url): ?array {
        if ($url === '' || preg_match('/[\x00-\x1f\x7f]/', $url)) {
            return null;
        }

        if (!filter_var($url, FILTER_VALIDATE_URL)) {
            return null;
        }

        $parts = parse_url($url);
        if (!$parts || empty($parts['host'])) {
            return null;
        }

        $scheme = strtolower($parts['scheme'] ?? '');
        if (!in_array($scheme, ['http', 'https'], true)) {
            return null;
        }

        // Reject embedded credentials (prevents URL parser confusion like http://safe.com@127.0.0.1/)
        if (isset($parts['user']) || isset($parts['pass'])) {
            return null;
        }

        $port = isset($parts['port']) ? (int)$parts['port'] : ($scheme === 'https' ? 443 : 80);
        if ($port < 1 || $port > 65535) {
            return null;
        }

        $raw_host = trim($parts['host'], '[]');
        $host_lower = strtolower($raw_host);
        if ($host_lower === '') {
            return null;
        }

        // Block localhost / loopback / cloud metadata keywords
        if (in_array($host_lower, self::BLOCKED_HOSTS, true)) {
            return null;
        }

        // Block internal/local TLDs
        if (preg_match('/\.(local|internal|lan|home|corp|localdomain)$/i', $host_lower)) {
            return null;
        }

        // Direct IP literal
        if (filter_var($raw_host, FILTER_VALIDATE_IP)) {
            if (!self::isSafePublicIp($raw_host)) {
                return null;
            }
            return [
                'url'    => $url,
                'scheme' => $scheme,
                'host'   => $raw_host,
                'port'   => $port,
                'ips'    => [$raw_host]
            ];
        }

        // Reject non-standard integer/octal/hex IP representations (e.g. 2130706433, 0x7f000001)
        if (preg_match('/^(0x[0-9a-f]+|\d+)$/i', $host_lower)) {
            return null;
        }

        // Resolve DNS A and AAAA records
        $resolved_ips = [];
        $records = @dns_get_record($raw_host, DNS_A + (defined('DNS_AAAA') ? DNS_AAAA : 0));
        if (is_array($records)) {
            foreach ($records as $record) {
                if (!empty($record['ip'])) {
                    $resolved_ips[] = $record['ip'];
                }
                if (!empty($record['ipv6'])) {
                    $resolved_ips[] = $record['ipv6'];
                }
            }
        }

        if (empty($resolved_ips)) {
            $ips_v4 = @gethostbynamel($raw_host);
            if (is_array($ips_v4)) {
                foreach ($ips_v4 as $ip) {
                    $resolved_ips[] = $ip;
                }
            } else {
                $ip = @gethostbyname($raw_host);
                if ($ip && $ip !== $raw_host) {
                    $resolved_ips[] = $ip;
                }
            }
        }

        $resolved_ips = array_values(array_unique($resolved_ips));
        if (empty($resolved_ips)) {
            return null;
        }

        foreach ($resolved_ips as $rip) {
            if (!self::isSafePublicIp($rip)) {
                return null;
            }
        }

        return [
            'url'    => $url,
            'scheme' => $scheme,
            'host'   => $raw_host,
            'port'   => $port,
            'ips'    => $resolved_ips
        ];
    }

    /**
     * Boolean convenience check for SSRF validation.
     */
    public static function isSafePublicUrl(string $url): bool {
        return self::resolveAndValidateUrl($url) !== null;
    }

    /**
     * Resolves a potentially relative HTTP Location header against a base URL.
     */
    public static function resolveRedirectUrl(string $base_url, string $location): ?string {
        $location = trim($location);
        if ($location === '' || preg_match('/[\x00-\x1f\x7f]/', $location)) {
            return null;
        }

        if (preg_match('#^https?://#i', $location)) {
            return $location;
        }

        // Reject other explicit schemes (file:, gopher:, javascript:, etc.)
        if (preg_match('/^[a-zA-Z][a-zA-Z0-9+.-]*:/', $location)) {
            return null;
        }

        $base = parse_url($base_url);
        if (!$base || empty($base['scheme']) || empty($base['host'])) {
            return null;
        }

        $scheme = strtolower($base['scheme']);
        $host = $base['host'];
        $port = isset($base['port']) ? ':' . $base['port'] : '';

        // Protocol-relative URL (//example.com/path)
        if (strpos($location, '//') === 0) {
            return $scheme . ':' . $location;
        }

        $origin = $scheme . '://' . $host . $port;
        if ($location[0] === '/') {
            return $origin . $location;
        }

        $base_path = $base['path'] ?? '/';
        $dir = preg_replace('#/[^/]*$#', '/', $base_path);
        return $origin . $dir . $location;
    }

    /**
     * Performs an SSRF-hardened HTTP request via cURL with:
     * - Per-hop redirect validation (CURLOPT_FOLLOWLOCATION disabled)
     * - DNS IP pinning via CURLOPT_RESOLVE (prevents DNS rebinding)
     * - Protocol restriction (HTTP/HTTPS only)
     * - Maximum response size cap (prevents OOM DoS)
     */
    public static function safeCurlFetch(string $url, array $options = []): array {
        $method = strtoupper($options['method'] ?? 'GET');
        $headers = $options['headers'] ?? [];
        $post_data = $options['post_data'] ?? null;
        $connect_timeout = (int)($options['connect_timeout'] ?? 4);
        $timeout = (int)($options['timeout'] ?? 8);
        $max_redirects = (int)($options['max_redirects'] ?? 5);
        $follow_redirects = (bool)($options['follow_redirects'] ?? true);
        $user_agent = (string)($options['user_agent'] ?? 'Atelier-GallusTech/1.0');
        $max_bytes = (int)($options['max_bytes'] ?? (5 * 1024 * 1024));

        if (!function_exists('curl_init')) {
            return [
                'success'      => false,
                'ssrf_blocked' => false,
                'status_code'  => 502,
                'content_type' => '',
                'headers'      => [],
                'cookies'      => [],
                'location'     => '',
                'final_url'    => $url,
                'body'         => '',
                'error'        => 'Extension PHP cURL indisponible.'
            ];
        }

        $current_url = $url;
        $initial_host = strtolower((string)(parse_url($url, PHP_URL_HOST) ?? ''));
        $hops = 0;

        while (true) {
            $validated = self::resolveAndValidateUrl($current_url);
            if ($validated === null) {
                return [
                    'success'      => false,
                    'ssrf_blocked' => true,
                    'status_code'  => 403,
                    'content_type' => '',
                    'headers'      => [],
                    'cookies'      => [],
                    'location'     => '',
                    'final_url'    => $current_url,
                    'body'         => '',
                    'error'        => 'Accès refusé : adresse IP ou redirection vers un réseau privé non autorisée (anti-SSRF).'
                ];
            }

            $pinned_ip = $validated['ips'][0];
            $host = $validated['host'];
            $port = $validated['port'];

            // Strip sensitive headers if redirected to another host
            $hop_headers = [];
            $is_cross_host = ($hops > 0 && strtolower($host) !== $initial_host);
            foreach ($headers as $h) {
                if (!is_string($h) || trim($h) === '') continue;
                if ($is_cross_host && preg_match('/^(cookie|authorization)\s*:/i', trim($h))) {
                    continue;
                }
                $hop_headers[] = trim($h);
            }

            $resp_headers = [];
            $resp_body = '';
            $size_exceeded = false;

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $current_url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
            curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
            curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, max(1, $connect_timeout));
            curl_setopt($ch, CURLOPT_TIMEOUT, max(2, $timeout));
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
            curl_setopt($ch, CURLOPT_NOSIGNAL, 1);
            curl_setopt($ch, CURLOPT_USERAGENT, $user_agent);

            if (defined('CURLPROTO_HTTP') && defined('CURLPROTO_HTTPS')) {
                curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
            }

            // Pin hostname -> validated IP to defeat DNS rebinding (only for domain names)
            if (!filter_var($host, FILTER_VALIDATE_IP) && defined('CURLOPT_RESOLVE')) {
                $resolve_ip = (strpos($pinned_ip, ':') !== false) ? "[{$pinned_ip}]" : $pinned_ip;
                curl_setopt($ch, CURLOPT_RESOLVE, ["{$host}:{$port}:{$resolve_ip}"]);
            }

            if (!empty($hop_headers)) {
                curl_setopt($ch, CURLOPT_HTTPHEADER, $hop_headers);
            }

            if ($method === 'POST' && $hops === 0) {
                curl_setopt($ch, CURLOPT_POST, true);
                if ($post_data !== null) {
                    curl_setopt($ch, CURLOPT_POSTFIELDS, $post_data);
                }
            } else {
                curl_setopt($ch, CURLOPT_HTTPGET, true);
            }

            curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch_handle, string $header_line) use (&$resp_headers): int {
                $trimmed = trim($header_line);
                if ($trimmed !== '') {
                    $resp_headers[] = $trimmed;
                }
                return strlen($header_line);
            });

            curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch_handle, string $chunk) use (&$resp_body, $max_bytes, &$size_exceeded): int {
                $len = strlen($chunk);
                if (strlen($resp_body) + $len > $max_bytes) {
                    $size_exceeded = true;
                    return 0; // Abort transfer
                }
                $resp_body .= $chunk;
                return $len;
            });

            $ok = @curl_exec($ch);
            $status_code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $content_type = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
            $curl_error = curl_error($ch);
            curl_close($ch);

            if ($size_exceeded) {
                return [
                    'success'      => false,
                    'ssrf_blocked' => false,
                    'status_code'  => 413,
                    'content_type' => $content_type,
                    'headers'      => $resp_headers,
                    'cookies'      => [],
                    'location'     => '',
                    'final_url'    => $current_url,
                    'body'         => '',
                    'error'        => 'Réponse distante trop volumineuse.'
                ];
            }

            if ($ok === false && $status_code === 0) {
                return [
                    'success'      => false,
                    'ssrf_blocked' => false,
                    'status_code'  => 502,
                    'content_type' => '',
                    'headers'      => $resp_headers,
                    'cookies'      => [],
                    'location'     => '',
                    'final_url'    => $current_url,
                    'body'         => '',
                    'error'        => $curl_error ?: 'Impossible de contacter le serveur distant.'
                ];
            }

            $location = '';
            $cookies = [];
            foreach ($resp_headers as $hline) {
                if (stripos($hline, 'Location:') === 0) {
                    $location = trim(substr($hline, 9));
                } elseif (stripos($hline, 'Set-Cookie:') === 0 && preg_match('/^Set-Cookie:\s*([^;]+)/i', $hline, $mc)) {
                    $cookies[] = trim($mc[1]);
                }
            }

            // Follow HTTP redirects manually with re-validation on every hop
            if ($follow_redirects && in_array($status_code, [301, 302, 303, 307, 308], true) && $location !== '') {
                if ($hops >= $max_redirects) {
                    return [
                        'success'      => false,
                        'ssrf_blocked' => false,
                        'status_code'  => 502,
                        'content_type' => '',
                        'headers'      => $resp_headers,
                        'cookies'      => $cookies,
                        'location'     => $location,
                        'final_url'    => $current_url,
                        'body'         => '',
                        'error'        => 'Trop de redirections HTTP.'
                    ];
                }

                $next_url = self::resolveRedirectUrl($current_url, $location);
                if ($next_url === null) {
                    return [
                        'success'      => false,
                        'ssrf_blocked' => true,
                        'status_code'  => 403,
                        'content_type' => '',
                        'headers'      => $resp_headers,
                        'cookies'      => $cookies,
                        'location'     => $location,
                        'final_url'    => $current_url,
                        'body'         => '',
                        'error'        => 'Redirection vers une URL ou un protocole non autorisé (anti-SSRF).'
                    ];
                }

                $current_url = $next_url;
                $hops++;
                if ($status_code === 303) {
                    $method = 'GET';
                    $post_data = null;
                }
                continue;
            }

            $success = ($status_code >= 200 && $status_code < 400);
            return [
                'success'      => $success,
                'ssrf_blocked' => false,
                'status_code'  => $status_code ?: 200,
                'content_type' => $content_type,
                'headers'      => $resp_headers,
                'cookies'      => $cookies,
                'location'     => $location,
                'final_url'    => $current_url,
                'body'         => $resp_body,
                'error'        => $success ? '' : ($curl_error ?: "Code HTTP {$status_code}")
            ];
        }
    }
}
