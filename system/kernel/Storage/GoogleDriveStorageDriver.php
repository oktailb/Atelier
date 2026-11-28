<?php
/**
 * Atelier by GallusTech - Native Zero-Dependency Google Drive REST API v3 Driver (Phase B Lot 2)
 * Uses OAuth2 access_token / refresh_token with automatic silent renewal.
 */

namespace Atelier\Kernel\Storage;

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
        $this->rootFolderId = self::normalizeFolderId((string)($config['root_folder_id'] ?? 'root'));
        $this->onTokenRefresh = $onTokenRefresh;
    }

    /**
     * Infers a normalized lowercase file extension from a MIME type (including Google Workspace native MIME types).
     */
    public static function inferExtensionFromMime(string $mime): string {
        $m = strtolower(trim(explode(';', $mime)[0]));
        if ($m === '') return '';
        static $map = [
            'application/vnd.google-apps.document'                                      => 'pdf',
            'application/vnd.google-apps.spreadsheet'                                   => 'xlsx',
            'application/vnd.google-apps.presentation'                                  => 'pdf',
            'application/vnd.google-apps.drawing'                                       => 'png',
            'application/pdf'                                                           => 'pdf',
            'application/vnd.ms-excel'                                                  => 'xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'         => 'xlsx',
            'application/vnd.oasis.opendocument.spreadsheet'                            => 'ods',
            'application/msword'                                                        => 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'   => 'docx',
            'application/vnd.oasis.opendocument.text'                                   => 'odt',
            'application/vnd.ms-powerpoint'                                             => 'ppt',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation' => 'pptx',
            'application/vnd.oasis.opendocument.presentation'                           => 'odp',
            'application/rtf'                                                           => 'rtf',
            'text/csv'                                                                  => 'csv',
            'text/tab-separated-values'                                                 => 'tsv',
            'text/plain'                                                                => 'txt',
            'text/markdown'                                                             => 'md',
            'text/html'                                                                 => 'html',
            'application/json'                                                          => 'json',
            'application/xml'                                                           => 'xml',
            'text/xml'                                                                  => 'xml',
            'application/zip'                                                           => 'zip',
            'image/jpeg'                                                                => 'jpg',
            'image/png'                                                                 => 'png',
            'image/gif'                                                                 => 'gif',
            'image/webp'                                                                => 'webp',
            'image/svg+xml'                                                             => 'svg',
            'image/bmp'                                                                 => 'bmp',
            'image/avif'                                                                => 'avif',
            'video/mp4'                                                                 => 'mp4',
            'video/webm'                                                                => 'webm',
            'video/quicktime'                                                           => 'mov',
            'audio/mpeg'                                                                => 'mp3',
            'audio/wav'                                                                 => 'wav',
            'audio/ogg'                                                                 => 'ogg',
            'audio/flac'                                                                => 'flac'
        ];
        return $map[$m] ?? '';
    }

    /**
     * Accepts 'root', a raw Google Drive folder ID, or a full Drive folder URL (`.../folders/<ID>`).
     */
    public static function normalizeFolderId(string $raw): string {
        $val = trim($raw);
        if ($val === '' || strtolower($val) === 'root') {
            return 'root';
        }
        if (preg_match('#/folders/([a-zA-Z0-9_-]+)#', $val, $m)) {
            return $m[1];
        }
        if (preg_match('#[?&]id=([a-zA-Z0-9_-]+)#', $val, $m)) {
            return $m[1];
        }
        // Strictly validate folder ID charset to prevent Google Drive `q=` query injection
        if (!preg_match('/^[a-zA-Z0-9_-]{1,128}$/', $val)) {
            return 'root';
        }
        return $val;
    }

    private static function formatApiError(array $res): string {
        $status = (int)($res['status'] ?? 0);
        $curlErr = trim((string)($res['curl_error'] ?? ''));
        if ($status === 0 && $curlErr !== '') {
            return 'Google Drive network/SSL error: ' . $curlErr;
        }
        $json = @json_decode((string)($res['body'] ?? ''), true);
        $msg = (string)($json['error']['message'] ?? '');
        $reason = (string)($json['error']['errors'][0]['reason'] ?? '');
        if ($reason === 'accessNotConfigured' || stripos($msg, 'has not been used in project') !== false || stripos($msg, 'is disabled') !== false) {
            return 'Google Drive API is disabled in your Google Cloud project. Enable "Google Drive API" in Google Cloud Console → APIs & Services → Library. (' . $msg . ')';
        }
        if ($reason === 'insufficientPermissions' || stripos($msg, 'Insufficient Permission') !== false) {
            return 'Google Drive permission denied (insufficient scope). Unmount and reconnect while checking the Google Drive access box on the Google consent screen.';
        }
        if ($status === 401) {
            return 'Google Drive token expired or revoked (HTTP 401). ' . ($msg !== '' ? $msg : 'Please reconnect Google Drive.');
        }
        if ($msg !== '') {
            return 'Google Drive API (HTTP ' . $status . '): ' . $msg;
        }
        return 'Google Drive API returned HTTP ' . $status;
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
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
        if (defined('CURLPROTO_HTTPS')) {
            curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
        }
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
            return ['status' => 401, 'body' => '', 'curl_error' => !function_exists('curl_init') ? 'PHP cURL extension is not enabled.' : 'Missing OAuth2 access token.'];
        }
        $headers[] = 'Authorization: Bearer ' . $this->accessToken;
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 45);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
        if (defined('CURLPROTO_HTTPS')) {
            curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
        }
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $resp = curl_exec($ch);
        $curlErr = $resp === false ? (string)curl_error($ch) : '';
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ['status' => $status, 'body' => is_string($resp) ? $resp : '', 'curl_error' => $curlErr];
    }

    private function resolveItemByPath(string $relPath, ?string &$errorOut = null): ?array {
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
                'q'                         => $q,
                'fields'                    => 'files(id,name,mimeType,size,modifiedTime,thumbnailLink,shortcutDetails)',
                'pageSize'                  => 1,
                'supportsAllDrives'         => 'true',
                'includeItemsFromAllDrives' => 'true'
            ]);
            $res = $this->apiRequest('GET', $url);
            if ($res['status'] < 200 || $res['status'] >= 300) {
                $errorOut = self::formatApiError($res);
                return null;
            }
            $json = @json_decode($res['body'], true);
            $item = $json['files'][0] ?? null;
            if (!$item) return null;
            if (($item['mimeType'] ?? '') === 'application/vnd.google-apps.shortcut' && !empty($item['shortcutDetails']['targetId'])) {
                $item['id'] = (string)$item['shortcutDetails']['targetId'];
                $item['mimeType'] = (string)($item['shortcutDetails']['targetMimeType'] ?? $item['mimeType']);
            }
            $current = $item;
            $parentId = (string)$item['id'];
        }
        return $current;
    }

    public function listDir(string $relPath = ''): array {
        $rel = trim(str_replace('\\', '/', $relPath), '/');
        $resolveErr = null;
        $folder = $this->resolveItemByPath($rel, $resolveErr);
        if ($resolveErr !== null) {
            return ['directories' => [], 'files' => [], 'error' => $resolveErr];
        }
        if (!$folder || ($folder['mimeType'] ?? '') !== self::FOLDER_MIME) {
            return ['directories' => [], 'files' => []];
        }
        $parentId = (string)$folder['id'];
        $url = self::API_BASE . '/files?' . http_build_query([
            'q'                         => "'{$parentId}' in parents and trashed = false",
            'fields'                    => 'files(id,name,mimeType,size,modifiedTime,shortcutDetails)',
            'pageSize'                  => 500,
            'orderBy'                   => 'folder,name',
            'supportsAllDrives'         => 'true',
            'includeItemsFromAllDrives' => 'true'
        ]);
        $res = $this->apiRequest('GET', $url);
        if ($res['status'] < 200 || $res['status'] >= 300) {
            return ['directories' => [], 'files' => [], 'error' => self::formatApiError($res)];
        }
        $json = @json_decode($res['body'], true);
        $items = is_array($json['files'] ?? null) ? $json['files'] : [];

        $dirs = [];
        $files = [];
        foreach ($items as $it) {
            $name = (string)($it['name'] ?? '');
            if ($name === '') continue;
            $mime = (string)($it['mimeType'] ?? '');
            if ($mime === 'application/vnd.google-apps.shortcut' && !empty($it['shortcutDetails']['targetMimeType'])) {
                $mime = (string)$it['shortcutDetails']['targetMimeType'];
            }
            $childPath = $rel === '' ? $name : ($rel . '/' . $name);
            $mtime = !empty($it['modifiedTime']) ? (int)@strtotime((string)$it['modifiedTime']) : 0;
            if ($mime === self::FOLDER_MIME) {
                $dirs[] = ['name' => $name, 'path' => $childPath, 'mtime' => $mtime];
            } else {
                $files[] = [
                    'name'  => $name,
                    'path'  => $childPath,
                    'size'  => (int)($it['size'] ?? 0),
                    'mtime' => $mtime,
                    'mime'  => $mime
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
        $meta = $this->readContentWithMeta($relPath);
        return $meta !== null ? $meta['content'] : null;
    }

    /**
     * Downloads file content alongside accurate exported MIME type and extension
     * (handles native Google Docs / Sheets / Slides / Drawings automatically).
     */
    public function readContentWithMeta(string $relPath): ?array {
        $item = $this->resolveItemByPath($relPath);
        if (!$item || ($item['mimeType'] ?? '') === self::FOLDER_MIME) return null;
        $mime = (string)($item['mimeType'] ?? '');
        $name = (string)($item['name'] ?? basename($relPath));
        $exportMap = [
            'application/vnd.google-apps.document'     => ['mime' => 'application/pdf', 'ext' => 'pdf'],
            'application/vnd.google-apps.spreadsheet'  => ['mime' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'ext' => 'xlsx'],
            'application/vnd.google-apps.presentation' => ['mime' => 'application/pdf', 'ext' => 'pdf'],
            'application/vnd.google-apps.drawing'      => ['mime' => 'image/png', 'ext' => 'png']
        ];
        if (isset($exportMap[$mime])) {
            $outMime = $exportMap[$mime]['mime'];
            $outExt = $exportMap[$mime]['ext'];
            $url = self::API_BASE . '/files/' . rawurlencode((string)$item['id']) . '/export?mimeType=' . rawurlencode($outMime);
            $outName = pathinfo($name, PATHINFO_EXTENSION) !== '' ? $name : ($name . '.' . $outExt);
        } else {
            $outMime = $mime !== '' ? $mime : 'application/octet-stream';
            $outExt = strtolower(pathinfo($name, PATHINFO_EXTENSION)) ?: self::inferExtensionFromMime($mime);
            $outName = $name;
            $url = self::API_BASE . '/files/' . rawurlencode((string)$item['id']) . '?alt=media&supportsAllDrives=true';
        }
        $res = $this->apiRequest('GET', $url);
        if ($res['status'] < 200 || $res['status'] >= 300) {
            return null;
        }
        return [
            'content'   => $res['body'],
            'mime'      => $outMime,
            'extension' => $outExt,
            'filename'  => $outName
        ];
    }

    /**
     * Fetches Google Drive's pre-rendered thumbnail (`thumbnailLink`) for images, PDFs, Office docs,
     * Google Docs/Sheets/Slides, and videos without downloading the full file.
     */
    public function fetchThumbnail(string $relPath, int $maxSize = 400): ?array {
        $item = $this->resolveItemByPath($relPath);
        if (!$item || empty($item['thumbnailLink']) || !function_exists('curl_init')) {
            return null;
        }
        $thumbUrl = (string)$item['thumbnailLink'];
        // Restrict thumbnail fetches strictly to HTTPS Google static/thumbnail origins (prevents SSRF & Bearer token leak)
        $thumbParts = parse_url($thumbUrl);
        $thumbScheme = strtolower((string)($thumbParts['scheme'] ?? ''));
        $thumbHost = strtolower((string)($thumbParts['host'] ?? ''));
        if ($thumbScheme !== 'https' || !preg_match('/(^|\.)(googleusercontent\.com|google\.com|gstatic\.com)$/i', $thumbHost)) {
            return null;
        }
        $size = max(120, min(800, $maxSize));
        $thumbUrl = preg_replace('/=s\d+$/', '=s' . $size, $thumbUrl);

        $this->ensureValidToken();
        $fetch = function (bool $withAuth) use ($thumbUrl): array {
            $ch = curl_init($thumbUrl);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
            curl_setopt($ch, CURLOPT_TIMEOUT, 15);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
            if (defined('CURLPROTO_HTTPS')) {
                curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
            }
            if ($withAuth && $this->accessToken !== '') {
                curl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer ' . $this->accessToken]);
            }
            $data = curl_exec($ch);
            $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $ctype = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
            curl_close($ch);
            return ['status' => $status, 'data' => is_string($data) ? $data : '', 'mime' => $ctype];
        };

        $res = $fetch(true);
        if ($res['status'] !== 200 || stripos($res['mime'], 'image/') !== 0 || strlen($res['data']) < 64) {
            $res = $fetch(false);
        }
        if ($res['status'] === 200 && stripos($res['mime'], 'image/') === 0 && strlen($res['data']) >= 64) {
            $cleanMime = strtolower(trim(explode(';', $res['mime'])[0]));
            return ['data' => $res['data'], 'mime' => $cleanMime];
        }
        return null;
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
        $aboutRes = $this->apiRequest('GET', self::API_BASE . '/about?fields=user(emailAddress,displayName)');
        if ($aboutRes['status'] !== 200) {
            return ['success' => false, 'message' => self::formatApiError($aboutRes)];
        }
        $listUrl = self::API_BASE . '/files?' . http_build_query([
            'q'                         => "'" . $this->rootFolderId . "' in parents and trashed = false",
            'fields'                    => 'files(id,name)',
            'pageSize'                  => 5,
            'supportsAllDrives'         => 'true',
            'includeItemsFromAllDrives' => 'true'
        ]);
        $listRes = $this->apiRequest('GET', $listUrl);
        if ($listRes['status'] !== 200) {
            return ['success' => false, 'message' => self::formatApiError($listRes)];
        }
        $aboutJson = @json_decode($aboutRes['body'], true);
        $listJson = @json_decode($listRes['body'], true);
        $email = $aboutJson['user']['emailAddress'] ?? 'Google Drive';
        $sampleCount = is_array($listJson['files'] ?? null) ? count($listJson['files']) : 0;
        return [
            'success' => true,
            'message' => 'Connected to Google Drive (' . $email . ', root="' . $this->rootFolderId . '", ' . $sampleCount . '+ item(s) visible).'
        ];
    }
}
