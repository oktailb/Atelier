<?php
/**
 * Atelier by GallusTech - Native Zero-Dependency WebDAV Storage Driver (Phase B)
 * Compatible with Nextcloud, ownCloud, Synology DSM, kDrive, Infomaniak, Apache/Nginx WebDAV.
 */

namespace SimpleGallery\Kernel\Storage;

use SimpleGallery\Kernel\Security\UrlValidator;

class WebDavStorageDriver implements StorageDriverInterface {

    /** @var string */
    private $baseUrl;
    /** @var string */
    private $username;
    /** @var string */
    private $password;
    /** @var string */
    private $bearerToken;
    /** @var bool */
    private $allowPrivateLan;

    public function __construct(array $config) {
        $this->baseUrl = rtrim(trim((string)($config['endpoint'] ?? $config['url'] ?? '')), '/');
        $this->username = (string)($config['username'] ?? '');
        $this->password = (string)($config['password'] ?? '');
        $this->bearerToken = (string)($config['bearer_token'] ?? '');
        $this->allowPrivateLan = !empty($config['allow_private_lan']);
    }

    public function getDriverName(): string {
        return 'webdav';
    }

    private function normalizeRel(string $relPath): string {
        $clean = trim(str_replace('\\', '/', $relPath), '/');
        if ($clean === '' || $clean === '.') return '';
        $parts = array_filter(explode('/', $clean), function ($p) { return $p !== '' && $p !== '.'; });
        foreach ($parts as $p) {
            if ($p === '..' || strpos($p, "\0") !== false) {
                throw new \InvalidArgumentException('Invalid WebDAV path.');
            }
        }
        return implode('/', $parts);
    }

    private function buildUrl(string $relPath = '', bool $trailingSlash = false): string {
        $rel = $this->normalizeRel($relPath);
        if ($rel === '') {
            return $this->baseUrl . ($trailingSlash ? '/' : '');
        }
        $encoded = implode('/', array_map('rawurlencode', explode('/', $rel)));
        return $this->baseUrl . '/' . $encoded . ($trailingSlash ? '/' : '');
    }

    private function assertSafeEndpoint(string $url): ?array {
        if ($this->baseUrl === '' || !preg_match('#^https?://#i', $url)) {
            throw new \RuntimeException('Invalid WebDAV URL.');
        }
        if (!$this->allowPrivateLan) {
            $validated = UrlValidator::resolveAndValidateUrl($url);
            if ($validated === null) {
                throw new \RuntimeException('WebDAV URL blocked by SSRF policy (enable allow_private_lan for LAN NAS).');
            }
            return $validated;
        }
        return null;
    }

    private function request(string $method, string $url, array $headers = [], ?string $body = null): array {
        $validated = $this->assertSafeEndpoint($url);
        if (!function_exists('curl_init')) {
            return ['status' => 0, 'body' => '', 'error' => 'cURL extension required.'];
        }

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
        curl_setopt($ch, CURLOPT_TIMEOUT, 45);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
        if (defined('CURLPROTO_HTTP') && defined('CURLPROTO_HTTPS')) {
            curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
        }
        if (is_array($validated) && !empty($validated['ips'][0]) && !filter_var($validated['host'], FILTER_VALIDATE_IP) && defined('CURLOPT_RESOLVE')) {
            $rip = (strpos($validated['ips'][0], ':') !== false) ? "[{$validated['ips'][0]}]" : $validated['ips'][0];
            curl_setopt($ch, CURLOPT_RESOLVE, ["{$validated['host']}:{$validated['port']}:{$rip}"]);
        }

        if ($this->bearerToken !== '') {
            $headers[] = 'Authorization: Bearer ' . $this->bearerToken;
        } elseif ($this->username !== '' || $this->password !== '') {
            curl_setopt($ch, CURLOPT_USERPWD, $this->username . ':' . $this->password);
        }

        if (!empty($headers)) {
            curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        }
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }

        $resp = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        return ['status' => $status, 'body' => is_string($resp) ? $resp : '', 'error' => $err];
    }

    /**
     * Parses a WebDAV PROPFIND XML multistatus body safely (XXE-disabled via LIBXML_NONET).
     */
    public function parsePropfindXml(string $xmlBody, string $requestedRel = ''): array {
        $dirs = [];
        $files = [];
        if (trim($xmlBody) === '') {
            return ['directories' => $dirs, 'files' => $files];
        }

        $dom = new \DOMDocument();
        $prev = libxml_use_internal_errors(true);
        $loaded = @$dom->loadXML($xmlBody, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);
        if (!$loaded) {
            return ['directories' => $dirs, 'files' => $files];
        }

        $basePath = rtrim((string)(parse_url($this->baseUrl, PHP_URL_PATH) ?? ''), '/');
        $reqNorm = $this->normalizeRel($requestedRel);
        $selfPrefix = $reqNorm === '' ? $basePath : ($basePath . '/' . $reqNorm);

        $xpath = new \DOMXPath($dom);
        $responses = $xpath->query('//*[local-name()="response"]');
        if (!$responses) {
            return ['directories' => $dirs, 'files' => $files];
        }

        foreach ($responses as $respNode) {
            $hrefNode = $xpath->query('./*[local-name()="href"]', $respNode)->item(0);
            if (!$hrefNode) continue;
            $rawHref = trim((string)$hrefNode->textContent);
            $hrefPath = rtrim(rawurldecode((string)(parse_url($rawHref, PHP_URL_PATH) ?? $rawHref)), '/');

            // Skip the directory itself
            if (strcasecmp($hrefPath, $selfPrefix) === 0 || $hrefPath === $basePath) {
                continue;
            }
            if ($basePath !== '' && stripos($hrefPath, $basePath . '/') === 0) {
                $rel = ltrim(substr($hrefPath, strlen($basePath) + 1), '/');
            } else {
                $rel = ltrim($hrefPath, '/');
            }
            if ($rel === '' || strpos($rel, '..') !== false) continue;

            $name = basename($rel);
            if ($name === '' || $name[0] === '.') continue;

            $isCol = $xpath->query('.//*[local-name()="resourcetype"]/*[local-name()="collection"]', $respNode)->length > 0;
            $sizeNode = $xpath->query('.//*[local-name()="getcontentlength"]', $respNode)->item(0);
            $modNode = $xpath->query('.//*[local-name()="getlastmodified"]', $respNode)->item(0);
            $mimeNode = $xpath->query('.//*[local-name()="getcontenttype"]', $respNode)->item(0);

            $mtime = $modNode ? (int)@strtotime((string)$modNode->textContent) : 0;
            if ($isCol) {
                $dirs[] = [
                    'name'  => $name,
                    'path'  => $rel,
                    'mtime' => $mtime
                ];
            } else {
                $files[] = [
                    'name'  => $name,
                    'path'  => $rel,
                    'size'  => $sizeNode ? (int)$sizeNode->textContent : 0,
                    'mtime' => $mtime,
                    'mime'  => $mimeNode ? trim((string)$mimeNode->textContent) : ''
                ];
            }
        }

        return ['directories' => $dirs, 'files' => $files];
    }

    public function listDir(string $relPath = ''): array {
        $url = $this->buildUrl($relPath, true);
        $xml = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/></d:prop></d:propfind>';
        $res = $this->request('PROPFIND', $url, ['Depth: 1', 'Content-Type: application/xml; charset=utf-8'], $xml);
        if ($res['status'] >= 200 && $res['status'] < 300) {
            return $this->parsePropfindXml($res['body'], $relPath);
        }
        return ['directories' => [], 'files' => []];
    }

    public function stat(string $relPath): ?array {
        $rel = $this->normalizeRel($relPath);
        $url = $this->buildUrl($rel, false);
        $xml = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/></d:prop></d:propfind>';
        $res = $this->request('PROPFIND', $url, ['Depth: 0', 'Content-Type: application/xml; charset=utf-8'], $xml);
        if ($res['status'] < 200 || $res['status'] >= 300) {
            return null;
        }
        $isDir = stripos($res['body'], 'collection') !== false;
        $size = 0;
        if (preg_match('/<[^>]*getcontentlength[^>]*>(\d+)</i', $res['body'], $m)) {
            $size = (int)$m[1];
        }
        $mtime = 0;
        if (preg_match('/<[^>]*getlastmodified[^>]*>([^<]+)</i', $res['body'], $m)) {
            $mtime = (int)@strtotime($m[1]);
        }
        return [
            'type'  => $isDir ? 'dir' : 'file',
            'name'  => $rel === '' ? 'WebDAV' : basename($rel),
            'path'  => $rel,
            'size'  => $size,
            'mtime' => $mtime,
            'mime'  => ''
        ];
    }

    public function readContent(string $relPath): ?string {
        $res = $this->request('GET', $this->buildUrl($relPath, false));
        return ($res['status'] >= 200 && $res['status'] < 300) ? $res['body'] : null;
    }

    public function putContent(string $relPath, string $content, string $mime = 'application/octet-stream'): bool {
        $res = $this->request('PUT', $this->buildUrl($relPath, false), ['Content-Type: ' . $mime], $content);
        return ($res['status'] >= 200 && $res['status'] < 300);
    }

    public function putFile(string $relPath, string $localTmpPath, string $mime = 'application/octet-stream'): bool {
        if (!is_file($localTmpPath)) return false;
        $data = @file_get_contents($localTmpPath);
        if ($data === false) return false;
        return $this->putContent($relPath, $data, $mime);
    }

    public function delete(string $relPath): bool {
        $rel = $this->normalizeRel($relPath);
        if ($rel === '') return false;
        $res = $this->request('DELETE', $this->buildUrl($rel, false));
        return ($res['status'] >= 200 && $res['status'] < 300);
    }

    public function mkdir(string $relPath): bool {
        $rel = $this->normalizeRel($relPath);
        if ($rel === '') return false;
        $res = $this->request('MKCOL', $this->buildUrl($rel, true));
        return ($res['status'] >= 200 && $res['status'] < 300) || $res['status'] === 405;
    }

    public function move(string $srcRel, string $dstRel): bool {
        $srcUrl = $this->buildUrl($srcRel, false);
        $dstUrl = $this->buildUrl($dstRel, false);
        $res = $this->request('MOVE', $srcUrl, ['Destination: ' . $dstUrl, 'Overwrite: T']);
        return ($res['status'] >= 200 && $res['status'] < 300);
    }

    public function testConnection(): array {
        try {
            $url = $this->buildUrl('', true);
            $xml = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';
            $res = $this->request('PROPFIND', $url, ['Depth: 0', 'Content-Type: application/xml; charset=utf-8'], $xml);
            if ($res['status'] >= 200 && $res['status'] < 300) {
                return ['success' => true, 'message' => 'WebDAV connection successful (HTTP ' . $res['status'] . ').'];
            }
            return ['success' => false, 'message' => 'WebDAV returned HTTP ' . $res['status'] . ($res['error'] ? ' (' . $res['error'] . ')' : '')];
        } catch (\Throwable $e) {
            return ['success' => false, 'message' => $e->getMessage()];
        }
    }
}
