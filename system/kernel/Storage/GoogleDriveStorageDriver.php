<?php
/**
 * Atelier by GallusTech - Native Zero-Dependency Google Drive REST API v3 Driver (Phase B Lot 2)
 * Uses OAuth2 access_token / refresh_token with automatic silent renewal.
 */

namespace SimpleGallery\Kernel\Storage;

class GoogleDriveStorageDriver implements StorageDriverInterface {

    private const API_BASE = 'https://www.googleapis.com/drive/v3';
    private const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
    private const TOKEN_URL = 'https://oauth2.googleapis.com/token';
    private const FOLDER_MIME = 'application/vnd.google-apps.folder';

    /** @var string */
    private $accessToken;
    /** @var string */
    private $refreshToken;
    /** @var string */
    private $clientId;
    /** @var string */
    private $clientSecret;
    /** @var int */
    private $expiresAt;
    /** @var string */
    private $rootFolderId;
    /** @var callable|null */
    private $onTokenRefresh;

    public function __construct(array $config, ?callable $onTokenRefresh = null) {
        $this->accessToken = (string)($config['access_token'] ?? '');
        $this->refreshToken = (string)($config['refresh_token'] ?? '');
        $this->clientId = (string)($config['client_id'] ?? '');
        $this->clientSecret = (string)($config['client_secret'] ?? '');
        $this->expiresAt = (int)($config['expires_at'] ?? 0);
        $this->rootFolderId = trim((string)($config['root_folder_id'] ?? 'root')) ?: 'root';
        $this->onTokenRefresh = $onTokenRefresh;
    }

    public function getDriverName(): string {
        return 'gdrive';
    }

    private function ensureValidToken(): bool {
        if ($this->accessToken !== '' && ($this->expiresAt === 0 || $this->expiresAt > (time() + 60))) {
            return true;
        }
        if ($this->refreshToken === '' || $this->clientId === '' || !function_exists('curl_init')) {
            return $this->accessToken !== '';
        }
        $ch = curl_init(self::TOKEN_URL);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([
            'client_id'     => $this->clientId,
            'client_secret' => $this->clientSecret,
            'refresh_token' => $this->refreshToken,
            'grant_type'    => 'refresh_token'
        ]));
        $resp = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($code === 200 && is_string($resp)) {
            $json = @json_decode($resp, true);
            if (!empty($json['access_token'])) {
                $this->accessToken = (string)$json['access_token'];
                $this->expiresAt = time() + max(300, (int)($json['expires_in'] ?? 3600));
                if (is_callable($this->onTokenRefresh)) {
                    ($this->onTokenRefresh)($this->accessToken, $this->expiresAt);
                }
                return true;
            }
        }
        return $this->accessToken !== '';
    }

    private function apiRequest(string $method, string $url, array $headers = [], ?string $body = null): array {
        $this->ensureValidToken();
        if ($this->accessToken === '' || !function_exists('curl_init')) {
            return ['status' => 401, 'body' => ''];
        }
        $headers[] = 'Authorization: Bearer ' . $this->accessToken;
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 45);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $resp = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ['status' => $status, 'body' => is_string($resp) ? $resp : ''];
    }

    private function resolveItemByPath(string $relPath): ?array {
        $clean = trim(str_replace('\\', '/', $relPath), '/');
        if ($clean === '' || $clean === '.') {
            return ['id' => $this->rootFolderId, 'name' => 'Google Drive', 'mimeType' => self::FOLDER_MIME, 'size' => 0, 'modifiedTime' => ''];
        }
        $parts = array_values(array_filter(explode('/', $clean), function ($p) { return $p !== '' && $p !== '.'; }));
        $parentId = $this->rootFolderId;
        $current = null;
        foreach ($parts as $seg) {
            $escaped = str_replace(["\\", "'"], ["\\\\", "\\'"], $seg);
            $q = "'{$parentId}' in parents and name = '{$escaped}' and trashed = false";
            $url = self::API_BASE . '/files?' . http_build_query([
                'q'        => $q,
                'fields'   => 'files(id,name,mimeType,size,modifiedTime)',
                'pageSize' => 1
            ]);
            $res = $this->apiRequest('GET', $url);
            $json = @json_decode($res['body'], true);
            $item = $json['files'][0] ?? null;
            if (!$item) return null;
            $current = $item;
            $parentId = (string)$item['id'];
        }
        return $current;
    }

    public function listDir(string $relPath = ''): array {
        $rel = trim(str_replace('\\', '/', $relPath), '/');
        $folder = $this->resolveItemByPath($rel);
        if (!$folder || ($folder['mimeType'] ?? '') !== self::FOLDER_MIME) {
            return ['directories' => [], 'files' => []];
        }
        $parentId = (string)$folder['id'];
        $url = self::API_BASE . '/files?' . http_build_query([
            'q'        => "'{$parentId}' in parents and trashed = false",
            'fields'   => 'files(id,name,mimeType,size,modifiedTime)',
            'pageSize' => 200,
            'orderBy'  => 'folder,name'
        ]);
        $res = $this->apiRequest('GET', $url);
        $json = @json_decode($res['body'], true);
        $items = is_array($json['files'] ?? null) ? $json['files'] : [];

        $dirs = [];
        $files = [];
        foreach ($items as $it) {
            $name = (string)($it['name'] ?? '');
            if ($name === '') continue;
            $childPath = $rel === '' ? $name : ($rel . '/' . $name);
            $mtime = !empty($it['modifiedTime']) ? (int)@strtotime((string)$it['modifiedTime']) : 0;
            if (($it['mimeType'] ?? '') === self::FOLDER_MIME) {
                $dirs[] = ['name' => $name, 'path' => $childPath, 'mtime' => $mtime];
            } else {
                $files[] = [
                    'name'  => $name,
                    'path'  => $childPath,
                    'size'  => (int)($it['size'] ?? 0),
                    'mtime' => $mtime,
                    'mime'  => (string)($it['mimeType'] ?? '')
                ];
            }
        }
        return ['directories' => $dirs, 'files' => $files];
    }

    public function stat(string $relPath): ?array {
        $item = $this->resolveItemByPath($relPath);
        if (!$item) return null;
        $isDir = ($item['mimeType'] ?? '') === self::FOLDER_MIME;
        return [
            'type'  => $isDir ? 'dir' : 'file',
            'name'  => (string)$item['name'],
            'path'  => trim(str_replace('\\', '/', $relPath), '/'),
            'size'  => (int)($item['size'] ?? 0),
            'mtime' => !empty($item['modifiedTime']) ? (int)@strtotime((string)$item['modifiedTime']) : 0,
            'mime'  => (string)($item['mimeType'] ?? '')
        ];
    }

    public function readContent(string $relPath): ?string {
        $item = $this->resolveItemByPath($relPath);
        if (!$item || ($item['mimeType'] ?? '') === self::FOLDER_MIME) return null;
        $url = self::API_BASE . '/files/' . rawurlencode((string)$item['id']) . '?alt=media';
        $res = $this->apiRequest('GET', $url);
        return ($res['status'] >= 200 && $res['status'] < 300) ? $res['body'] : null;
    }

    public function putContent(string $relPath, string $content, string $mime = 'application/octet-stream'): bool {
        $clean = trim(str_replace('\\', '/', $relPath), '/');
        if ($clean === '') return false;
        $existing = $this->resolveItemByPath($clean);
        if ($existing && ($existing['mimeType'] ?? '') !== self::FOLDER_MIME) {
            $url = self::UPLOAD_BASE . '/files/' . rawurlencode((string)$existing['id']) . '?uploadType=media';
            $res = $this->apiRequest('PATCH', $url, ['Content-Type: ' . $mime], $content);
            return ($res['status'] >= 200 && $res['status'] < 300);
        }
        $parentPath = strpos($clean, '/') !== false ? dirname($clean) : '';
        $parent = $this->resolveItemByPath($parentPath);
        if (!$parent) return false;
        $boundary = 'atelier_' . bin2hex(random_bytes(8));
        $metaJson = json_encode(['name' => basename($clean), 'parents' => [(string)$parent['id']]]);
        $multipart = "--{$boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{$metaJson}\r\n"
            . "--{$boundary}\r\nContent-Type: {$mime}\r\n\r\n{$content}\r\n--{$boundary}--";
        $url = self::UPLOAD_BASE . '/files?uploadType=multipart';
        $res = $this->apiRequest('POST', $url, ['Content-Type: multipart/related; boundary=' . $boundary], $multipart);
        return ($res['status'] >= 200 && $res['status'] < 300);
    }

    public function putFile(string $relPath, string $localTmpPath, string $mime = 'application/octet-stream'): bool {
        if (!is_file($localTmpPath)) return false;
        $data = @file_get_contents($localTmpPath);
        return $data !== false && $this->putContent($relPath, $data, $mime);
    }

    public function delete(string $relPath): bool {
        $item = $this->resolveItemByPath($relPath);
        if (!$item || (string)$item['id'] === $this->rootFolderId) return false;
        $res = $this->apiRequest('DELETE', self::API_BASE . '/files/' . rawurlencode((string)$item['id']));
        return ($res['status'] >= 200 && $res['status'] < 300);
    }

    public function mkdir(string $relPath): bool {
        $clean = trim(str_replace('\\', '/', $relPath), '/');
        if ($clean === '') return false;
        $parentPath = strpos($clean, '/') !== false ? dirname($clean) : '';
        $parent = $this->resolveItemByPath($parentPath);
        if (!$parent) return false;
        $body = json_encode([
            'name'     => basename($clean),
            'mimeType' => self::FOLDER_MIME,
            'parents'  => [(string)$parent['id']]
        ]);
        $res = $this->apiRequest('POST', self::API_BASE . '/files', ['Content-Type: application/json'], $body);
        return ($res['status'] >= 200 && $res['status'] < 300);
    }

    public function move(string $srcRel, string $dstRel): bool {
        $item = $this->resolveItemByPath($srcRel);
        if (!$item) return false;
        $dstClean = trim(str_replace('\\', '/', $dstRel), '/');
        $dstParentPath = strpos($dstClean, '/') !== false ? dirname($dstClean) : '';
        $dstParent = $this->resolveItemByPath($dstParentPath);
        if (!$dstParent) return false;
        $body = json_encode(['name' => basename($dstClean)]);
        $url = self::API_BASE . '/files/' . rawurlencode((string)$item['id']) . '?addParents=' . rawurlencode((string)$dstParent['id']);
        $res = $this->apiRequest('PATCH', $url, ['Content-Type: application/json'], $body);
        return ($res['status'] >= 200 && $res['status'] < 300);
    }

    public function testConnection(): array {
        if ($this->accessToken === '' && $this->refreshToken === '') {
            return ['success' => false, 'message' => 'OAuth2 access_token or refresh_token required.'];
        }
        $res = $this->apiRequest('GET', self::API_BASE . '/about?fields=user(emailAddress,displayName)');
        if ($res['status'] === 200) {
            $json = @json_decode($res['body'], true);
            $email = $json['user']['emailAddress'] ?? 'Google Drive';
            return ['success' => true, 'message' => 'Connected to Google Drive (' . $email . ').'];
        }
        return ['success' => false, 'message' => 'Google Drive API returned HTTP ' . $res['status']];
    }
}
