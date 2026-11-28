<?php
/**
 * Atelier by GallusTech - Native Zero-Dependency S3 / Cloudflare R2 / MinIO / Scaleway Driver (AWS SigV4)
 * Supports path-style and virtual-hosted endpoints, ListObjectsV2, GetObject, PutObject, DeleteObject,
 * CopyObject, and presigned GET URLs without requiring AWS SDK / Composer.
 */

namespace Atelier\Kernel\Storage;

use Atelier\Kernel\Security\UrlValidator;

class S3StorageDriver implements StorageDriverInterface {

    /** @var string */
    private $endpoint;
    /** @var string */
    private $region;
    /** @var string */
    private $bucket;
    /** @var string */
    private $prefix;
    /** @var string */
    private $accessKey;
    /** @var string */
    private $secretKey;
    /** @var bool */
    private $pathStyle;
    /** @var bool */
    private $allowPrivateLan;

    public function __construct(array $config) {
        $this->endpoint = rtrim(trim((string)($config['endpoint'] ?? '')), '/');
        $this->region = trim((string)($config['region'] ?? 'auto')) ?: 'us-east-1';
        $this->bucket = trim((string)($config['bucket'] ?? ''));
        $this->prefix = trim(str_replace('\\', '/', (string)($config['prefix'] ?? '')), '/');
        $this->accessKey = (string)($config['access_key'] ?? '');
        $this->secretKey = (string)($config['secret_key'] ?? '');
        $this->pathStyle = !isset($config['path_style']) || !empty($config['path_style']);
        $this->allowPrivateLan = !empty($config['allow_private_lan']);
    }

    public function getDriverName(): string {
        return 's3';
    }

    private function normalizeRel(string $relPath): string {
        $clean = trim(str_replace('\\', '/', $relPath), '/');
        if ($clean === '' || $clean === '.') return '';
        $parts = array_filter(explode('/', $clean), function ($p) { return $p !== '' && $p !== '.'; });
        foreach ($parts as $p) {
            if ($p === '..' || strpos($p, "\0") !== false) {
                throw new \InvalidArgumentException('Invalid S3 object key.');
            }
        }
        return implode('/', $parts);
    }

    private function fullKey(string $relPath): string {
        $rel = $this->normalizeRel($relPath);
        if ($this->prefix === '') return $rel;
        return $rel === '' ? $this->prefix : ($this->prefix . '/' . $rel);
    }

    private function encodeKeyPath(string $key): string {
        if ($key === '') return '/';
        return '/' . implode('/', array_map('rawurlencode', explode('/', ltrim($key, '/'))));
    }

    private function buildTarget(string $key): array {
        $base = $this->endpoint !== ''
            ? $this->endpoint
            : ('https://s3.' . $this->region . '.amazonaws.com');
        $parts = parse_url($base);
        $scheme = strtolower($parts['scheme'] ?? 'https');
        $host = (string)($parts['host'] ?? '');
        $port = isset($parts['port']) ? (int)$parts['port'] : null;
        $hostHeader = $port ? ($host . ':' . $port) : $host;

        if ($this->pathStyle) {
            $uri = '/' . rawurlencode($this->bucket) . ($key !== '' ? $this->encodeKeyPath($key) : '/');
            if ($key === '' && substr($uri, -1) === '/') {
                $uri = rtrim($uri, '/');
            }
        } else {
            $hostHeader = $this->bucket . '.' . $hostHeader;
            $uri = $key !== '' ? $this->encodeKeyPath($key) : '/';
        }

        return [
            'scheme' => $scheme,
            'host'   => $hostHeader,
            'uri'    => $uri
        ];
    }

    /**
     * Generates AWS Signature Version 4 headers for an HTTP request.
     */
    public function signRequest(
        string $method,
        string $host,
        string $canonicalUri,
        array $queryParams,
        string $payloadHash,
        array $extraHeaders = [],
        ?int $timestamp = null
    ): array {
        $ts = $timestamp ?? time();
        $amzDate = gmdate('Ymd\THis\Z', $ts);
        $dateStamp = gmdate('Ymd', $ts);

        ksort($queryParams);
        $canonQueryParts = [];
        foreach ($queryParams as $k => $v) {
            $canonQueryParts[] = rawurlencode((string)$k) . '=' . rawurlencode((string)$v);
        }
        $canonicalQuery = implode('&', $canonQueryParts);

        $headers = [
            'host'                 => strtolower($host),
            'x-amz-content-sha256' => $payloadHash,
            'x-amz-date'           => $amzDate
        ];
        foreach ($extraHeaders as $hk => $hv) {
            $headers[strtolower(trim($hk))] = trim((string)$hv);
        }
        ksort($headers);

        $canonicalHeaders = '';
        $signedHeadersArr = [];
        foreach ($headers as $k => $v) {
            $canonicalHeaders .= $k . ':' . $v . "\n";
            $signedHeadersArr[] = $k;
        }
        $signedHeaders = implode(';', $signedHeadersArr);

        $canonicalRequest = implode("\n", [
            strtoupper($method),
            $canonicalUri,
            $canonicalQuery,
            $canonicalHeaders,
            $signedHeaders,
            $payloadHash
        ]);

        $scope = "{$dateStamp}/{$this->region}/s3/aws4_request";
        $stringToSign = implode("\n", [
            'AWS4-HMAC-SHA256',
            $amzDate,
            $scope,
            hash('sha256', $canonicalRequest)
        ]);

        $kDate = hash_hmac('sha256', $dateStamp, 'AWS4' . $this->secretKey, true);
        $kRegion = hash_hmac('sha256', $this->region, $kDate, true);
        $kService = hash_hmac('sha256', 's3', $kRegion, true);
        $kSigning = hash_hmac('sha256', 'aws4_request', $kService, true);
        $signature = hash_hmac('sha256', $stringToSign, $kSigning);

        $authHeader = "AWS4-HMAC-SHA256 Credential={$this->accessKey}/{$scope}, SignedHeaders={$signedHeaders}, Signature={$signature}";

        $out = [];
        foreach ($headers as $k => $v) {
            if ($k === 'host') continue;
            $out[] = $k . ': ' . $v;
        }
        $out[] = 'Authorization: ' . $authHeader;

        return [
            'headers'         => $out,
            'canonical_query' => $canonicalQuery,
            'signature'       => $signature,
            'amz_date'        => $amzDate
        ];
    }

    /**
     * Generates a SigV4 presigned GET URL valid for `$ttlSeconds` (max 7 days).
     */
    public function buildPresignedGetUrl(string $relPath, int $ttlSeconds = 900, ?int $timestamp = null): string {
        $key = $this->fullKey($relPath);
        $target = $this->buildTarget($key);
        $ts = $timestamp ?? time();
        $amzDate = gmdate('Ymd\THis\Z', $ts);
        $dateStamp = gmdate('Ymd', $ts);
        $scope = "{$dateStamp}/{$this->region}/s3/aws4_request";
        $expires = max(60, min(604800, $ttlSeconds));

        $query = [
            'X-Amz-Algorithm'     => 'AWS4-HMAC-SHA256',
            'X-Amz-Credential'    => "{$this->accessKey}/{$scope}",
            'X-Amz-Date'          => $amzDate,
            'X-Amz-Expires'       => (string)$expires,
            'X-Amz-SignedHeaders' => 'host'
        ];
        ksort($query);
        $qParts = [];
        foreach ($query as $k => $v) {
            $qParts[] = rawurlencode($k) . '=' . rawurlencode($v);
        }
        $canonQuery = implode('&', $qParts);
        $canonReq = "GET\n{$target['uri']}\n{$canonQuery}\nhost:" . strtolower($target['host']) . "\n\nhost\nUNSIGNED-PAYLOAD";
        $strToSign = "AWS4-HMAC-SHA256\n{$amzDate}\n{$scope}\n" . hash('sha256', $canonReq);

        $kDate = hash_hmac('sha256', $dateStamp, 'AWS4' . $this->secretKey, true);
        $kRegion = hash_hmac('sha256', $this->region, $kDate, true);
        $kService = hash_hmac('sha256', 's3', $kRegion, true);
        $kSigning = hash_hmac('sha256', 'aws4_request', $kService, true);
        $sig = hash_hmac('sha256', $strToSign, $kSigning);

        return "{$target['scheme']}://{$target['host']}{$target['uri']}?{$canonQuery}&X-Amz-Signature={$sig}";
    }

    private function send(string $method, string $key, array $query = [], string $body = '', array $extraHeaders = []): array {
        $target = $this->buildTarget($key);
        $payloadHash = hash('sha256', $body);
        $signed = $this->signRequest($method, $target['host'], $target['uri'], $query, $payloadHash, $extraHeaders);
        $url = "{$target['scheme']}://{$target['host']}{$target['uri']}" . ($signed['canonical_query'] !== '' ? ('?' . $signed['canonical_query']) : '');

        $validated = null;
        if (!$this->allowPrivateLan) {
            $validated = UrlValidator::resolveAndValidateUrl($url);
            if ($validated === null) {
                throw new \RuntimeException('S3 endpoint blocked by SSRF policy (enable allow_private_lan for LAN MinIO).');
            }
        }
        if (!function_exists('curl_init')) {
            return ['status' => 0, 'body' => '', 'error' => 'cURL extension required.'];
        }

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
        curl_setopt($ch, CURLOPT_TIMEOUT, 60);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
        if (defined('CURLPROTO_HTTP') && defined('CURLPROTO_HTTPS')) {
            curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
        }
        if (is_array($validated) && !empty($validated['ips'][0]) && !filter_var($validated['host'], FILTER_VALIDATE_IP) && defined('CURLOPT_RESOLVE')) {
            $rip = (strpos($validated['ips'][0], ':') !== false) ? "[{$validated['ips'][0]}]" : $validated['ips'][0];
            curl_setopt($ch, CURLOPT_RESOLVE, ["{$validated['host']}:{$validated['port']}:{$rip}"]);
        }
        curl_setopt($ch, CURLOPT_HTTPHEADER, $signed['headers']);
        if ($method === 'HEAD') {
            curl_setopt($ch, CURLOPT_NOBODY, true);
        } elseif ($body !== '') {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }

        $resp = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        return ['status' => $status, 'body' => is_string($resp) ? $resp : '', 'error' => $err];
    }

    public function listDir(string $relPath = ''): array {
        $rel = $this->normalizeRel($relPath);
        $fullPref = $this->fullKey($rel);
        $s3Prefix = $fullPref !== '' ? ($fullPref . '/') : '';

        $res = $this->send('GET', '', [
            'list-type' => '2',
            'delimiter' => '/',
            'prefix'    => $s3Prefix
        ]);
        if ($res['status'] < 200 || $res['status'] >= 300 || trim($res['body']) === '') {
            return ['directories' => [], 'files' => []];
        }

        $dom = new \DOMDocument();
        $prev = libxml_use_internal_errors(true);
        $ok = @$dom->loadXML($res['body'], LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);
        if (!$ok) return ['directories' => [], 'files' => []];

        $xpath = new \DOMXPath($dom);
        $rootStrip = $this->prefix !== '' ? ($this->prefix . '/') : '';
        $dirs = [];
        $files = [];

        foreach ($xpath->query('//*[local-name()="CommonPrefixes"]/*[local-name()="Prefix"]') ?: [] as $node) {
            $p = trim((string)$node->textContent, '/');
            if ($rootStrip !== '' && strpos($p . '/', $rootStrip) === 0) {
                $p = substr($p, strlen($rootStrip));
            }
            if ($p === '') continue;
            $dirs[] = ['name' => basename($p), 'path' => $p, 'mtime' => 0];
        }

        foreach ($xpath->query('//*[local-name()="Contents"]') ?: [] as $cNode) {
            $kNode = $xpath->query('./*[local-name()="Key"]', $cNode)->item(0);
            if (!$kNode) continue;
            $k = (string)$kNode->textContent;
            if ($k === $s3Prefix || substr($k, -1) === '/') continue;

            $relItem = $k;
            if ($rootStrip !== '' && strpos($relItem, $rootStrip) === 0) {
                $relItem = substr($relItem, strlen($rootStrip));
            }
            $sNode = $xpath->query('./*[local-name()="Size"]', $cNode)->item(0);
            $mNode = $xpath->query('./*[local-name()="LastModified"]', $cNode)->item(0);
            $files[] = [
                'name'  => basename($relItem),
                'path'  => $relItem,
                'size'  => $sNode ? (int)$sNode->textContent : 0,
                'mtime' => $mNode ? (int)@strtotime((string)$mNode->textContent) : 0,
                'mime'  => ''
            ];
        }

        return ['directories' => $dirs, 'files' => $files];
    }

    public function stat(string $relPath): ?array {
        $rel = $this->normalizeRel($relPath);
        if ($rel === '') {
            return ['type' => 'dir', 'name' => $this->bucket, 'path' => '', 'size' => 0, 'mtime' => 0, 'mime' => ''];
        }
        $res = $this->send('HEAD', $this->fullKey($rel));
        if ($res['status'] >= 200 && $res['status'] < 300) {
            return ['type' => 'file', 'name' => basename($rel), 'path' => $rel, 'size' => 0, 'mtime' => 0, 'mime' => ''];
        }
        return null;
    }

    public function readContent(string $relPath): ?string {
        $res = $this->send('GET', $this->fullKey($relPath));
        return ($res['status'] >= 200 && $res['status'] < 300) ? $res['body'] : null;
    }

    public function putContent(string $relPath, string $content, string $mime = 'application/octet-stream'): bool {
        $res = $this->send('PUT', $this->fullKey($relPath), [], $content, ['Content-Type' => $mime]);
        return ($res['status'] >= 200 && $res['status'] < 300);
    }

    public function putFile(string $relPath, string $localTmpPath, string $mime = 'application/octet-stream'): bool {
        if (!is_file($localTmpPath)) return false;
        $data = @file_get_contents($localTmpPath);
        return $data !== false && $this->putContent($relPath, $data, $mime);
    }

    public function delete(string $relPath): bool {
        $rel = $this->normalizeRel($relPath);
        if ($rel === '') return false;
        $res = $this->send('DELETE', $this->fullKey($rel));
        return ($res['status'] >= 200 && $res['status'] < 300);
    }

    public function mkdir(string $relPath): bool {
        $rel = $this->normalizeRel($relPath);
        if ($rel === '') return false;
        $res = $this->send('PUT', $this->fullKey($rel) . '/', [], '', ['Content-Type' => 'application/x-directory']);
        return ($res['status'] >= 200 && $res['status'] < 300);
    }

    public function move(string $srcRel, string $dstRel): bool {
        $srcKey = $this->fullKey($srcRel);
        $dstKey = $this->fullKey($dstRel);
        $copySource = '/' . rawurlencode($this->bucket) . $this->encodeKeyPath($srcKey);
        $copyRes = $this->send('PUT', $dstKey, [], '', ['x-amz-copy-source' => $copySource]);
        if ($copyRes['status'] >= 200 && $copyRes['status'] < 300) {
            return $this->delete($srcRel);
        }
        return false;
    }

    public function testConnection(): array {
        if ($this->bucket === '' || $this->accessKey === '' || $this->secretKey === '') {
            return ['success' => false, 'message' => 'Bucket, Access Key, and Secret Key are required.'];
        }
        try {
            $res = $this->send('GET', '', ['list-type' => '2', 'max-keys' => '1']);
            if ($res['status'] >= 200 && $res['status'] < 300) {
                return ['success' => true, 'message' => 'S3 bucket reachable (HTTP ' . $res['status'] . ').'];
            }
            return ['success' => false, 'message' => 'S3 returned HTTP ' . $res['status'] . ($res['error'] ? ' (' . $res['error'] . ')' : '')];
        } catch (\Throwable $e) {
            return ['success' => false, 'message' => $e->getMessage()];
        }
    }
}
