<?php
/**
 * Atelier by GallusTech - Native RFC 4918 WebDAV Server Gateway (Phase C — `/dav/`)
 *
 * Exposes a user's authorized volumes to native OS WebDAV clients (Windows Explorer,
 * macOS Finder, Linux Nautilus/Dolphin, Cyberduck, mobile apps):
 *   - `/dav/home/`            : User's personal home (`storage/users/<username>/`), quota-enforced
 *   - `/dav/shared/<mount>/`  : Folders shared with the user (direct or group), ACL-enforced
 *   - `/dav/public/`          : Public gallery (`storage/media/`), PermissionsManager + DotfileManager enforced
 *
 * Authentication strictly requires a dedicated revocable App Password (`AppPasswordManager`)
 * via HTTP Basic Auth (compatible with 2FA-protected accounts and isolated from web sessions).
 */

namespace Atelier\Kernel\Dav;

use Atelier\Kernel\Auth\AppPasswordManager;
use Atelier\Kernel\Auth\AuditLogger;
use Atelier\Kernel\Auth\AuthManager;
use Atelier\Kernel\Auth\ShareManager;
use Atelier\Kernel\Auth\UserManager;
use Atelier\Kernel\FS\CacheManager;
use Atelier\Kernel\FS\DotfileManager;
use Atelier\Kernel\FS\FileIndexManager;
use Atelier\Kernel\FS\PermissionsManager;
use Atelier\Kernel\FS\TrashAndVersioningManager;
use Atelier\Kernel\Media\FormatRegistry;
use Atelier\Kernel\Security\PathValidator;
use Atelier\Kernel\Security\SecurityManager;

class WebDavServer {

    private const ALLOWED_METHODS = 'OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, DELETE, MOVE, COPY';

    /**
     * Handles a single WebDAV request and returns a structured HTTP response array:
     *   ['status' => int, 'headers' => array<string,string>, 'body' => string, 'file_path' => ?string]
     */
    public static function handleRequest(string $projectRoot, string $mediaDir, array $req): array {
        $method = strtoupper(trim((string)($req['method'] ?? 'GET')));
        $davBaseUrl = '/' . trim((string)($req['dav_base_url'] ?? '/dav'), '/');
        if ($davBaseUrl === '/') {
            $davBaseUrl = '/dav';
        }
        $rawDavPath = (string)($req['dav_path'] ?? '');
        $clientIp = (string)($req['client_ip'] ?? '');

        // Extract Basic Auth credentials
        [$username, $secret] = self::extractBasicAuth($req);

        // Allow unauthenticated OPTIONS discovery for clients that probe before prompting
        if ($method === 'OPTIONS' && ($username === '' || $secret === '')) {
            return [
                'status'    => 200,
                'headers'   => [
                    'DAV'           => '1, 2',
                    'Allow'         => self::ALLOWED_METHODS,
                    'MS-Author-Via' => 'DAV',
                    'Content-Length'=> '0'
                ],
                'body'      => '',
                'file_path' => null
            ];
        }

        $auth = AppPasswordManager::authenticate($projectRoot, $username, $secret, $clientIp);
        if (!$auth) {
            return [
                'status'    => 401,
                'headers'   => [
                    'WWW-Authenticate' => 'Basic realm="Atelier WebDAV", charset="UTF-8"',
                    'Content-Type'     => 'text/plain; charset=utf-8'
                ],
                'body'      => 'Authentication required (use your Atelier username and an App Password).',
                'file_path' => null
            ];
        }

        if ($method === 'OPTIONS') {
            return [
                'status'    => 200,
                'headers'   => [
                    'DAV'           => '1, 2',
                    'Allow'         => self::ALLOWED_METHODS,
                    'MS-Author-Via' => 'DAV',
                    'Content-Length'=> '0'
                ],
                'body'      => '',
                'file_path' => null
            ];
        }

        // Temporarily bind authenticated user context for ShareManager / PermissionsManager / DotfileManager checks
        $savedSession = $_SESSION ?? [];
        $user = $auth['user'];
        $isAdmin = in_array($user['role'] ?? '', ['superadmin', 'admin'], true);
        $tokenCanWrite = (($auth['scope'] ?? 'read') === 'write');

        $_SESSION['atelier_user'] = $user;
        $_SESSION['is_admin'] = $isAdmin;
        $_SESSION['atelier_admin_logged'] = $isAdmin;

        try {
            $davPath = self::normalizeDavPath($rawDavPath);
            if ($davPath === null) {
                return self::textResponse(400, 'Invalid WebDAV path.');
            }

            $mounts = self::buildVirtualMounts($projectRoot, $mediaDir, $user, $isAdmin, $tokenCanWrite);

            switch ($method) {
                case 'PROPFIND':
                    $depth = strtolower(trim((string)($req['depth'] ?? '1')));
                    if ($depth !== '0' && $depth !== '1') {
                        $depth = '1'; // Never allow unbounded Depth: infinity DoS
                    }
                    return self::handlePropfind($davPath, $davBaseUrl, $mounts, $mediaDir, $depth);

                case 'GET':
                case 'HEAD':
                    return self::handleGetOrHead($davPath, $mounts, $mediaDir, $method === 'HEAD');

                case 'MKCOL':
                    return self::handleMkcol($projectRoot, $mediaDir, $davPath, $mounts, $user, $isAdmin);

                case 'PUT':
                    $bodyBytes = (string)($req['body'] ?? '');
                    return self::handlePut($projectRoot, $mediaDir, $davPath, $mounts, $user, $isAdmin, $bodyBytes);

                case 'DELETE':
                    return self::handleDelete($projectRoot, $mediaDir, $davPath, $mounts, $user, $isAdmin);

                case 'MOVE':
                case 'COPY':
                    $destHeader = (string)($req['destination'] ?? '');
                    $overwrite = strtoupper(trim((string)($req['overwrite'] ?? 'T'))) !== 'F';
                    return self::handleMoveOrCopy($projectRoot, $mediaDir, $davPath, $destHeader, $davBaseUrl, $mounts, $user, $isAdmin, $method === 'MOVE', $overwrite);

                default:
                    return [
                        'status'    => 405,
                        'headers'   => ['Allow' => self::ALLOWED_METHODS, 'Content-Type' => 'text/plain; charset=utf-8'],
                        'body'      => 'Method Not Allowed.',
                        'file_path' => null
                    ];
            }
        } finally {
            $_SESSION = $savedSession;
        }
    }

    private static function extractBasicAuth(array $req): array {
        if (isset($req['auth_user']) && isset($req['auth_pass'])) {
            return [(string)$req['auth_user'], (string)$req['auth_pass']];
        }
        $header = (string)($req['authorization'] ?? '');
        if ($header !== '' && stripos($header, 'Basic ') === 0) {
            $decoded = base64_decode(trim(substr($header, 6)), true);
            if (is_string($decoded) && strpos($decoded, ':') !== false) {
                $parts = explode(':', $decoded, 2);
                return [$parts[0], $parts[1]];
            }
        }
        return ['', ''];
    }

    private static function normalizeDavPath(string $raw): ?string {
        $decoded = rawurldecode($raw);
        $decoded = str_replace('\\', '/', $decoded);
        if (strpos($decoded, "\0") !== false) {
            return null;
        }
        $trimmed = trim($decoded, '/');
        if ($trimmed === '') {
            return '';
        }
        $segments = explode('/', $trimmed);
        foreach ($segments as $seg) {
            if ($seg === '' || $seg === '.' || $seg === '..') {
                return null;
            }
            // Reject dotfiles / hidden system metadata at every segment
            if ($seg[0] === '.') {
                return null;
            }
        }
        return implode('/', $segments);
    }

    /**
     * Builds the virtual mount map for the authenticated user:
     *   - 'home'         => personal user directory
     *   - 'public'       => public gallery (storage/media)
     *   - 'shared/<key>' => shared folders granted to user or user's groups
     */
    private static function buildVirtualMounts(string $projectRoot, string $mediaDir, array $user, bool $isAdmin, bool $tokenCanWrite): array {
        $mounts = [];
        $homeRel = trim(str_replace('\\', '/', (string)($user['home_dir'] ?? ('users/' . $user['username']))), '/');
        $homeAbs = PathValidator::sanitizeDirectory($homeRel, $mediaDir);
        if ($homeAbs !== null && is_dir($homeAbs)) {
            $mounts['home'] = [
                'name'      => 'home',
                'label'     => 'Home (' . $user['username'] . ')',
                'rel_root'  => $homeRel,
                'abs_root'  => $homeAbs,
                'can_write' => $tokenCanWrite,
                'is_home'   => true,
                'is_public' => false
            ];
        }

        $pubAbs = realpath($mediaDir);
        if ($pubAbs && is_dir($pubAbs)) {
            $canPubWrite = $tokenCanWrite && ($isAdmin || PermissionsManager::hasPermission('can_upload', $mediaDir, ''));
            $mounts['public'] = [
                'name'      => 'public',
                'label'     => 'Public Gallery',
                'rel_root'  => '',
                'abs_root'  => str_replace('\\', '/', $pubAbs),
                'can_write' => $canPubWrite,
                'is_home'   => false,
                'is_public' => true
            ];
        }

        // User & Group shares from ShareManager
        $volumes = ShareManager::getMountedVolumesForCurrentUser($mediaDir);
        $usedSlugs = [];
        foreach ($volumes as $vol) {
            if (($vol['kind'] ?? '') !== 'shared') continue;
            $srcRel = trim(str_replace('\\', '/', (string)($vol['path'] ?? '')), '/');
            if ($srcRel === '') continue;
            $abs = PathValidator::sanitizeDirectory($srcRel, $mediaDir);
            if ($abs === null || !is_dir($abs)) continue;

            $slug = preg_replace('/[^a-zA-Z0-9._-]+/', '-', (string)($vol['mount_name'] ?? basename($srcRel)));
            $slug = trim((string)preg_replace('/-+/', '-', $slug), '.-_');
            if ($slug === '') $slug = 'share-' . (int)($vol['share_id'] ?? count($usedSlugs) + 1);
            if (isset($usedSlugs[$slug])) {
                $slug .= '-' . (int)($vol['share_id'] ?? count($usedSlugs) + 1);
            }
            $usedSlugs[$slug] = true;

            $sharePerm = strtolower((string)($vol['permission'] ?? 'read'));
            $mounts['shared/' . $slug] = [
                'name'      => $slug,
                'label'     => (string)($vol['mount_name'] ?? $slug),
                'rel_root'  => $srcRel,
                'abs_root'  => $abs,
                'can_write' => $tokenCanWrite && in_array($sharePerm, ['write', 'admin'], true),
                'is_home'   => false,
                'is_public' => false
            ];
        }

        return $mounts;
    }

    /**
     * Resolves a normalized WebDAV path to its backing mount and physical path.
     */
    private static function resolveTarget(string $davPath, array $mounts, string $mediaDir): ?array {
        if ($davPath === '') {
            return ['kind' => 'virtual_root', 'dav_path' => ''];
        }
        if ($davPath === 'shared') {
            return ['kind' => 'virtual_shared', 'dav_path' => 'shared'];
        }

        $matchedMount = null;
        $subRel = '';
        foreach ($mounts as $prefix => $m) {
            if ($davPath === $prefix) {
                $matchedMount = $m;
                $subRel = '';
                break;
            }
            if (strpos($davPath, $prefix . '/') === 0) {
                $matchedMount = $m;
                $subRel = substr($davPath, strlen($prefix) + 1);
                break;
            }
        }
        if (!$matchedMount) {
            return null;
        }

        $absRoot = rtrim(str_replace('\\', '/', $matchedMount['abs_root']), '/');
        $absTarget = $subRel === '' ? $absRoot : ($absRoot . '/' . $subRel);
        $relTarget = $matchedMount['rel_root'] === ''
            ? $subRel
            : ($subRel === '' ? $matchedMount['rel_root'] : ($matchedMount['rel_root'] . '/' . $subRel));

        // Verify public gallery folder ACLs (prevent reading locked/private dirs or users/ homes via /dav/public/)
        if (!empty($matchedMount['is_public'])) {
            if (strcasecmp($subRel, 'users') === 0 || stripos($subRel, 'users/') === 0) {
                return ['kind' => 'forbidden', 'dav_path' => $davPath];
            }
            $checkDir = is_dir($absTarget) ? $absTarget : dirname($absTarget);
            if (is_dir($checkDir) && !DotfileManager::isDirAccessible($checkDir, $mediaDir)) {
                return ['kind' => 'forbidden', 'dav_path' => $davPath];
            }
        }

        // Strict containment check
        $realRoot = realpath($absRoot);
        if (!$realRoot) {
            return null;
        }
        $normRealRoot = rtrim(str_replace('\\', '/', $realRoot), '/');
        if (file_exists($absTarget)) {
            $realTarget = realpath($absTarget);
            if (!$realTarget) return null;
            $normRealTarget = str_replace('\\', '/', $realTarget);
            if ($normRealTarget !== $normRealRoot && strpos($normRealTarget, $normRealRoot . '/') !== 0) {
                return null;
            }
        }

        return [
            'kind'       => 'fs',
            'dav_path'   => $davPath,
            'mount'      => $matchedMount,
            'sub_rel'    => $subRel,
            'rel_target' => $relTarget,
            'abs_target' => $absTarget
        ];
    }

    private static function handlePropfind(string $davPath, string $davBaseUrl, array $mounts, string $mediaDir, string $depth): array {
        $resolved = self::resolveTarget($davPath, $mounts, $mediaDir);
        if (!$resolved) {
            return self::textResponse(404, 'Not Found.');
        }
        if ($resolved['kind'] === 'forbidden') {
            return self::textResponse(403, 'Forbidden.');
        }

        $entries = [];
        $now = time();

        if ($resolved['kind'] === 'virtual_root') {
            $entries[] = self::makeDirProp($davBaseUrl . '/', 'Atelier', $now);
            if ($depth === '1') {
                if (isset($mounts['home'])) {
                    $entries[] = self::makeDirProp($davBaseUrl . '/home/', 'home', @filemtime($mounts['home']['abs_root']) ?: $now);
                }
                if (isset($mounts['public'])) {
                    $entries[] = self::makeDirProp($davBaseUrl . '/public/', 'public', @filemtime($mounts['public']['abs_root']) ?: $now);
                }
                $hasShares = false;
                foreach ($mounts as $k => $_) {
                    if (strpos($k, 'shared/') === 0) { $hasShares = true; break; }
                }
                if ($hasShares) {
                    $entries[] = self::makeDirProp($davBaseUrl . '/shared/', 'shared', $now);
                }
            }
        } elseif ($resolved['kind'] === 'virtual_shared') {
            $entries[] = self::makeDirProp($davBaseUrl . '/shared/', 'shared', $now);
            if ($depth === '1') {
                foreach ($mounts as $k => $m) {
                    if (strpos($k, 'shared/') !== 0) continue;
                    $href = $davBaseUrl . '/' . self::encodeDavHref($k) . '/';
                    $entries[] = self::makeDirProp($href, $m['name'], @filemtime($m['abs_root']) ?: $now);
                }
            }
        } else {
            $abs = $resolved['abs_target'];
            if (!file_exists($abs)) {
                return self::textResponse(404, 'Not Found.');
            }
            $href = $davBaseUrl . '/' . self::encodeDavHref($davPath);
            if (is_dir($abs)) {
                $entries[] = self::makeDirProp(rtrim($href, '/') . '/', basename($davPath), @filemtime($abs) ?: $now);
                if ($depth === '1') {
                    $items = @scandir($abs) ?: [];
                    foreach ($items as $item) {
                        if ($item === '.' || $item === '..' || $item[0] === '.') continue;
                        $childAbs = $abs . '/' . $item;
                        if (is_link($childAbs)) continue;
                        // Hide system users/ inside public root if ever present
                        if (!empty($resolved['mount']['is_public']) && $resolved['sub_rel'] === '' && strtolower($item) === 'users') {
                            continue;
                        }
                        if (is_dir($childAbs)) {
                            if (!empty($resolved['mount']['is_public']) && !DotfileManager::isDirAccessible($childAbs, $mediaDir)) {
                                continue;
                            }
                            $childHref = rtrim($href, '/') . '/' . rawurlencode($item) . '/';
                            $entries[] = self::makeDirProp($childHref, $item, @filemtime($childAbs) ?: $now);
                        } elseif (is_file($childAbs)) {
                            $childHref = rtrim($href, '/') . '/' . rawurlencode($item);
                            $entries[] = self::makeFileProp($childHref, $item, $childAbs);
                        }
                    }
                }
            } else {
                $entries[] = self::makeFileProp($href, basename($abs), $abs);
            }
        }

        $xml = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<d:multistatus xmlns:d=\"DAV:\">\n"
            . implode("\n", $entries)
            . "\n</d:multistatus>\n";

        return [
            'status'    => 207,
            'headers'   => [
                'Content-Type'   => 'application/xml; charset=utf-8',
                'Content-Length' => (string)strlen($xml),
                'DAV'            => '1, 2'
            ],
            'body'      => $xml,
            'file_path' => null
        ];
    }

    private static function handleGetOrHead(string $davPath, array $mounts, string $mediaDir, bool $headOnly): array {
        $resolved = self::resolveTarget($davPath, $mounts, $mediaDir);
        if (!$resolved || $resolved['kind'] !== 'fs') {
            return self::textResponse(404, 'Not Found.');
        }
        $abs = $resolved['abs_target'];
        if (!is_file($abs)) {
            return self::textResponse(is_dir($abs) ? 405 : 404, is_dir($abs) ? 'Cannot GET collection.' : 'Not Found.');
        }

        $size = (int)@filesize($abs);
        $mtime = (int)@filemtime($abs);
        $ext = strtolower(pathinfo($abs, PATHINFO_EXTENSION));
        $mime = FormatRegistry::getMimeType($ext) ?: 'application/octet-stream';
        $etag = '"' . md5($abs . '|' . $size . '|' . $mtime) . '"';

        $headers = [
            'Content-Type'           => $mime,
            'Content-Length'         => (string)$size,
            'Last-Modified'          => gmdate('D, d M Y H:i:s', $mtime) . ' GMT',
            'ETag'                   => $etag,
            'X-Content-Type-Options' => 'nosniff'
        ];
        if (preg_match('/(svg|html|xhtml|xml|javascript)/i', $mime) || in_array($ext, ['svg', 'svgz', 'html', 'htm', 'xhtml', 'xml'], true)) {
            $headers['Content-Security-Policy'] = "default-src 'none'; sandbox;";
        }

        return [
            'status'    => 200,
            'headers'   => $headers,
            'body'      => '',
            'file_path' => $headOnly ? null : $abs
        ];
    }

    private static function handleMkcol(string $projectRoot, string $mediaDir, string $davPath, array $mounts, array $user, bool $isAdmin): array {
        $resolved = self::resolveTarget($davPath, $mounts, $mediaDir);
        if (!$resolved || $resolved['kind'] !== 'fs') {
            return self::textResponse(403, 'Cannot create collection at this path.');
        }
        if (empty($resolved['mount']['can_write']) || $resolved['sub_rel'] === '') {
            return self::textResponse(403, 'Write access denied.');
        }
        $abs = $resolved['abs_target'];
        if (file_exists($abs)) {
            return self::textResponse(405, 'Resource already exists.');
        }
        if (!is_dir(dirname($abs))) {
            return self::textResponse(409, 'Parent collection does not exist.');
        }
        if (!@mkdir($abs, 0755, false)) {
            return self::textResponse(500, 'Failed to create collection.');
        }
        CacheManager::invalidateDirCache(dirname($abs), $mediaDir, '.thumbnails');
        AuditLogger::log($projectRoot, 'dav_mkcol', $resolved['rel_target'], 'ok');
        return self::textResponse(201, '');
    }

    private static function handlePut(string $projectRoot, string $mediaDir, string $davPath, array $mounts, array $user, bool $isAdmin, string $bodyBytes): array {
        $resolved = self::resolveTarget($davPath, $mounts, $mediaDir);
        if (!$resolved || $resolved['kind'] !== 'fs') {
            return self::textResponse(403, 'Write target not allowed.');
        }
        if (empty($resolved['mount']['can_write']) || $resolved['sub_rel'] === '') {
            return self::textResponse(403, 'Write access denied.');
        }

        $filename = basename($davPath);
        $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        if ($filename === '' || $filename[0] === '.' || FormatRegistry::isForbiddenExtension($ext) || FormatRegistry::hasForbiddenDoubleExtension($filename)) {
            return self::textResponse(403, 'Forbidden file type.');
        }

        $abs = $resolved['abs_target'];
        if (is_dir($abs)) {
            return self::textResponse(405, 'Cannot PUT onto a collection.');
        }
        if (!is_dir(dirname($abs))) {
            return self::textResponse(409, 'Parent collection does not exist.');
        }

        $incomingBytes = strlen($bodyBytes);
        $existingSize = is_file($abs) ? (int)@filesize($abs) : 0;
        $delta = max(0, $incomingBytes - $existingSize);

        // Enforce user disk quota when writing inside personal home
        if (!empty($resolved['mount']['is_home']) && $delta > 0) {
            $freshUser = UserManager::findById($projectRoot, (int)$user['id']);
            if ($freshUser) {
                $qinfo = UserManager::getUserQuotaInfo($projectRoot, $mediaDir, $freshUser);
                if (!empty($qinfo['is_limited']) && ((int)$qinfo['used_bytes'] + $delta) > (int)$qinfo['quota_bytes']) {
                    return self::textResponse(507, 'Insufficient Storage: user disk quota exceeded.');
                }
            }
        }

        $existed = is_file($abs);
        if ($existed) {
            TrashAndVersioningManager::snapshotBeforeOverwrite($projectRoot, $abs, $resolved['rel_target']);
        }

        if (@file_put_contents($abs, $bodyBytes, LOCK_EX) === false) {
            return self::textResponse(500, 'Failed to write file.');
        }
        if ($ext === 'svg') {
            SecurityManager::sanitizeSvgContent($abs);
        }

        CacheManager::invalidateDirCache(dirname($abs), $mediaDir, '.thumbnails');
        FileIndexManager::upsertFile($projectRoot, $mediaDir, $abs, []);
        AuditLogger::log($projectRoot, 'dav_put', $resolved['rel_target'], 'ok', ['bytes' => $incomingBytes]);

        return self::textResponse($existed ? 204 : 201, '');
    }

    private static function handleDelete(string $projectRoot, string $mediaDir, string $davPath, array $mounts, array $user, bool $isAdmin): array {
        $resolved = self::resolveTarget($davPath, $mounts, $mediaDir);
        if (!$resolved || $resolved['kind'] !== 'fs' || $resolved['sub_rel'] === '') {
            return self::textResponse(403, 'Cannot delete virtual root or mount point.');
        }
        if (empty($resolved['mount']['can_write'])) {
            return self::textResponse(403, 'Delete access denied.');
        }
        $abs = $resolved['abs_target'];
        if (!file_exists($abs)) {
            return self::textResponse(404, 'Not Found.');
        }

        $trashed = TrashAndVersioningManager::moveToTrash($projectRoot, $abs, $resolved['rel_target']);
        if (empty($trashed['success'])) {
            // Fallback direct removal if trash unavailable
            if (is_dir($abs)) {
                self::rrmdir($abs);
            } else {
                @unlink($abs);
            }
        }
        CacheManager::invalidateDirCache(dirname($abs), $mediaDir, '.thumbnails');
        FileIndexManager::removePath($projectRoot, $resolved['rel_target']);
        AuditLogger::log($projectRoot, 'dav_delete', $resolved['rel_target'], 'ok');

        return self::textResponse(204, '');
    }

    private static function handleMoveOrCopy(
        string $projectRoot,
        string $mediaDir,
        string $srcDavPath,
        string $destHeader,
        string $davBaseUrl,
        array $mounts,
        array $user,
        bool $isAdmin,
        bool $isMove,
        bool $overwrite
    ): array {
        $src = self::resolveTarget($srcDavPath, $mounts, $mediaDir);
        if (!$src || $src['kind'] !== 'fs' || $src['sub_rel'] === '' || !file_exists($src['abs_target'])) {
            return self::textResponse(404, 'Source resource not found.');
        }
        if ($isMove && empty($src['mount']['can_write'])) {
            return self::textResponse(403, 'Source is read-only.');
        }

        $destPathRaw = parse_url($destHeader, PHP_URL_PATH);
        if (!is_string($destPathRaw) || $destPathRaw === '') {
            return self::textResponse(400, 'Invalid Destination header.');
        }
        $basePrefix = rtrim($davBaseUrl, '/');
        if (stripos($destPathRaw, $basePrefix) === 0) {
            $destPathRaw = substr($destPathRaw, strlen($basePrefix));
        }
        $destDavPath = self::normalizeDavPath($destPathRaw);
        if ($destDavPath === null || $destDavPath === '') {
            return self::textResponse(400, 'Invalid Destination path.');
        }

        $dst = self::resolveTarget($destDavPath, $mounts, $mediaDir);
        if (!$dst || $dst['kind'] !== 'fs' || $dst['sub_rel'] === '' || empty($dst['mount']['can_write'])) {
            return self::textResponse(403, 'Destination write access denied.');
        }

        $destName = basename($destDavPath);
        $destExt = strtolower(pathinfo($destName, PATHINFO_EXTENSION));
        if (!is_dir($src['abs_target']) && (FormatRegistry::isForbiddenExtension($destExt) || FormatRegistry::hasForbiddenDoubleExtension($destName))) {
            return self::textResponse(403, 'Forbidden destination extension.');
        }

        if (!is_dir(dirname($dst['abs_target']))) {
            return self::textResponse(409, 'Destination parent collection missing.');
        }

        // Prevent moving/copying a collection into itself or a descendant (infinite recursion DoS)
        $normSrcAbs = rtrim(str_replace('\\', '/', $src['abs_target']), '/');
        $normDstAbs = rtrim(str_replace('\\', '/', $dst['abs_target']), '/');
        if (is_dir($src['abs_target']) && ($normDstAbs === $normSrcAbs || strpos($normDstAbs . '/', $normSrcAbs . '/') === 0)) {
            return self::textResponse(409, 'Cannot move or copy a collection into itself.');
        }

        // Enforce user disk quota when COPYing into `/dav/home/` or cross-mount MOVEing into `/dav/home/`
        $needsQuotaCheck = !empty($dst['mount']['is_home']) && (!$isMove || empty($src['mount']['is_home']));
        if ($needsQuotaCheck) {
            $freshUser = UserManager::findById($projectRoot, (int)$user['id']);
            if ($freshUser) {
                $qinfo = UserManager::getUserQuotaInfo($projectRoot, $mediaDir, $freshUser);
                if (!empty($qinfo['is_limited'])) {
                    $srcBytes = self::computeTreeBytes($src['abs_target']);
                    $existingDstBytes = file_exists($dst['abs_target']) ? self::computeTreeBytes($dst['abs_target']) : 0;
                    $delta = max(0, $srcBytes - $existingDstBytes);
                    if (((int)$qinfo['used_bytes'] + $delta) > (int)$qinfo['quota_bytes']) {
                        return self::textResponse(507, 'Insufficient Storage: user disk quota exceeded.');
                    }
                }
            }
        }

        $existed = file_exists($dst['abs_target']);
        if ($existed && !$overwrite) {
            return self::textResponse(412, 'Destination exists and Overwrite is F.');
        }

        if ($existed && is_file($dst['abs_target'])) {
            TrashAndVersioningManager::snapshotBeforeOverwrite($projectRoot, $dst['abs_target'], $dst['rel_target']);
        }

        if ($isMove) {
            if ($existed && is_dir($dst['abs_target'])) {
                self::rrmdir($dst['abs_target']);
            }
            if (!@rename($src['abs_target'], $dst['abs_target'])) {
                return self::textResponse(500, 'Move operation failed.');
            }
            FileIndexManager::removePath($projectRoot, $src['rel_target']);
        } else {
            if (is_dir($src['abs_target'])) {
                self::rcopy($src['abs_target'], $dst['abs_target']);
            } else {
                if (!@copy($src['abs_target'], $dst['abs_target'])) {
                    return self::textResponse(500, 'Copy operation failed.');
                }
            }
        }

        CacheManager::invalidateDirCache(dirname($src['abs_target']), $mediaDir, '.thumbnails');
        CacheManager::invalidateDirCache(dirname($dst['abs_target']), $mediaDir, '.thumbnails');
        if (is_file($dst['abs_target'])) {
            FileIndexManager::upsertFile($projectRoot, $mediaDir, $dst['abs_target'], []);
        }
        AuditLogger::log($projectRoot, $isMove ? 'dav_move' : 'dav_copy', $dst['rel_target'], 'ok', ['from' => $src['rel_target']]);

        return self::textResponse($existed ? 204 : 201, '');
    }

    private static function makeDirProp(string $href, string $displayName, int $mtime): string {
        $h = htmlspecialchars($href, ENT_XML1 | ENT_QUOTES, 'UTF-8');
        $n = htmlspecialchars($displayName, ENT_XML1 | ENT_QUOTES, 'UTF-8');
        $d = gmdate('D, d M Y H:i:s', $mtime) . ' GMT';
        return "  <d:response>\n"
            . "    <d:href>{$h}</d:href>\n"
            . "    <d:propstat>\n"
            . "      <d:prop>\n"
            . "        <d:displayname>{$n}</d:displayname>\n"
            . "        <d:resourcetype><d:collection/></d:resourcetype>\n"
            . "        <d:getlastmodified>{$d}</d:getlastmodified>\n"
            . "      </d:prop>\n"
            . "      <d:status>HTTP/1.1 200 OK</d:status>\n"
            . "    </d:propstat>\n"
            . "  </d:response>";
    }

    private static function makeFileProp(string $href, string $displayName, string $absPath): string {
        $h = htmlspecialchars($href, ENT_XML1 | ENT_QUOTES, 'UTF-8');
        $n = htmlspecialchars($displayName, ENT_XML1 | ENT_QUOTES, 'UTF-8');
        $size = (int)@filesize($absPath);
        $mtime = (int)@filemtime($absPath);
        $d = gmdate('D, d M Y H:i:s', $mtime) . ' GMT';
        $ext = strtolower(pathinfo($absPath, PATHINFO_EXTENSION));
        $mime = htmlspecialchars(FormatRegistry::getMimeType($ext) ?: 'application/octet-stream', ENT_XML1 | ENT_QUOTES, 'UTF-8');
        $etag = '&quot;' . md5($absPath . '|' . $size . '|' . $mtime) . '&quot;';
        return "  <d:response>\n"
            . "    <d:href>{$h}</d:href>\n"
            . "    <d:propstat>\n"
            . "      <d:prop>\n"
            . "        <d:displayname>{$n}</d:displayname>\n"
            . "        <d:resourcetype/>\n"
            . "        <d:getcontentlength>{$size}</d:getcontentlength>\n"
            . "        <d:getcontenttype>{$mime}</d:getcontenttype>\n"
            . "        <d:getlastmodified>{$d}</d:getlastmodified>\n"
            . "        <d:getetag>{$etag}</d:getetag>\n"
            . "      </d:prop>\n"
            . "      <d:status>HTTP/1.1 200 OK</d:status>\n"
            . "    </d:propstat>\n"
            . "  </d:response>";
    }

    private static function encodeDavHref(string $path): string {
        $segs = explode('/', trim($path, '/'));
        return implode('/', array_map('rawurlencode', $segs));
    }

    private static function textResponse(int $status, string $body): array {
        return [
            'status'    => $status,
            'headers'   => [
                'Content-Type'   => 'text/plain; charset=utf-8',
                'Content-Length' => (string)strlen($body)
            ],
            'body'      => $body,
            'file_path' => null
        ];
    }

    private static function rrmdir(string $dir): void {
        if (!is_dir($dir) || is_link($dir)) return;
        foreach ((@scandir($dir) ?: []) as $item) {
            if ($item === '.' || $item === '..') continue;
            $p = $dir . '/' . $item;
            if (is_dir($p) && !is_link($p)) self::rrmdir($p);
            else @unlink($p);
        }
        @rmdir($dir);
    }

    private static function rcopy(string $src, string $dst): void {
        if (is_link($src)) return;
        if (!is_dir($dst)) @mkdir($dst, 0755, true);
        foreach ((@scandir($src) ?: []) as $item) {
            if ($item === '.' || $item === '..' || $item[0] === '.') continue;
            $sp = $src . '/' . $item;
            if (is_link($sp)) continue;
            $dp = $dst . '/' . $item;
            if (is_dir($sp)) self::rcopy($sp, $dp);
            else @copy($sp, $dp);
        }
    }

    private static function computeTreeBytes(string $absPath): int {
        if (is_link($absPath)) return 0;
        if (is_file($absPath)) return max(0, (int)@filesize($absPath));
        if (!is_dir($absPath)) return 0;
        $total = 0;
        foreach ((@scandir($absPath) ?: []) as $item) {
            if ($item === '.' || $item === '..') continue;
            $p = $absPath . '/' . $item;
            if (is_link($p)) continue;
            $total += is_dir($p) ? self::computeTreeBytes($p) : max(0, (int)@filesize($p));
        }
        return $total;
    }
}
