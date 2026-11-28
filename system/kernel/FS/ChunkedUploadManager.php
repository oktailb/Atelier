<?php
/**
 * Atelier by GallusTech - Resumable Chunked Uploads Manager (Phase B)
 * Allows uploading multi-GB files in small chunks, resuming interrupted uploads,
 * enforcing quotas/FormatRegistry rules, and saving to either Local VFS or `ext://` mounts.
 */

namespace Atelier\Kernel\FS;

use Atelier\Kernel\Auth\AuthManager;
use Atelier\Kernel\Auth\UserManager;
use Atelier\Kernel\Config\ConfigStore;
use Atelier\Kernel\Media\FormatRegistry;
use Atelier\Kernel\Security\PathValidator;
use Atelier\Kernel\Security\SecurityManager;
use Atelier\Kernel\Storage\ExternalMountManager;

class ChunkedUploadManager {

    public const STALE_TTL_SECONDS = 86400; // 24h
    public const MAX_CHUNKS = 5000;
    public const MAX_CHUNK_BYTES = 52428800; // 50 MB max per chunk
    public const MAX_SESSION_BYTES = 4294967296; // 4 GB max total session size

    public static function getChunksRoot(string $projectRoot): string {
        $dir = rtrim(str_replace('\\', '/', ConfigStore::getStorageDir($projectRoot)), '/') . '/chunks';
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        $ht = $dir . '/.htaccess';
        if (!file_exists($ht)) {
            @file_put_contents($ht, "Deny from all\n", LOCK_EX);
        }
        return $dir;
    }

    private static function rrmdir(string $dir): void {
        if (!is_dir($dir)) return;
        foreach (@scandir($dir) ?: [] as $it) {
            if ($it === '.' || $it === '..') continue;
            $p = $dir . '/' . $it;
            if (is_dir($p)) self::rrmdir($p);
            else @unlink($p);
        }
        @rmdir($dir);
    }

    public static function purgeStaleSessions(string $projectRoot): int {
        $root = self::getChunksRoot($projectRoot);
        $now = time();
        $purged = 0;
        foreach (@scandir($root) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..' || $entry === '.htaccess') continue;
            $abs = $root . '/' . $entry;
            if (!is_dir($abs)) continue;
            if (($now - (int)@filemtime($abs)) > self::STALE_TTL_SECONDS) {
                self::rrmdir($abs);
                $purged++;
            }
        }
        return $purged;
    }

    private static function getCurrentActorScope(): string {
        $u = AuthManager::getCurrentUser();
        if ($u && !empty($u['id'])) return 'u_' . (int)$u['id'];
        return AuthManager::isAdminLoggedIn() ? 'admin' : 'guest';
    }

    public static function initUpload(
        string $projectRoot,
        string $mediaDir,
        array $mediaTypes,
        array $input
    ): array {
        self::purgeStaleSessions($projectRoot);

        $dirParam = trim((string)($input['dir'] ?? ''));
        $rawName = trim((string)($input['filename'] ?? ''));
        $totalSize = max(0, (int)($input['total_size'] ?? 0));
        $totalChunks = max(1, (int)($input['total_chunks'] ?? 1));
        $overwrite = !array_key_exists('overwrite', $input) || filter_var($input['overwrite'], FILTER_VALIDATE_BOOLEAN);

        if ($rawName === '' || $totalChunks > self::MAX_CHUNKS) {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid upload metadata.'];
        }

        $safeName = preg_replace('/[\/\\\\:*?"<>|\x00-\x1F]/', '_', basename($rawName));
        if ($safeName === '' || $safeName === '.' || $safeName === '..') {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid filename.'];
        }

        $ext = strtolower(pathinfo($safeName, PATHINFO_EXTENSION));
        $allowedExts = FormatRegistry::getAllowedUploadExtensions($projectRoot, $mediaTypes);
        if ($safeName[0] === '.' || $ext === '' || FormatRegistry::hasForbiddenDoubleExtension($safeName) || FormatRegistry::isForbiddenExtension($ext) || !in_array($ext, $allowedExts, true)) {
            return ['success' => false, 'status' => 400, 'error' => 'File format not allowed for upload.'];
        }

        $extParsed = ExternalMountManager::parseExternalPath($dirParam);
        if ($extParsed !== null) {
            $resolved = ExternalMountManager::resolveMountForCurrentUser($projectRoot, $extParsed['mount_id']);
            if (!$resolved || empty($resolved['can_write'])) {
                return ['success' => false, 'status' => 403, 'error' => 'External mount is read-only or inaccessible.'];
            }
        } else {
            if (!PermissionsManager::hasPermission('can_upload', $mediaDir, $dirParam)) {
                return ['success' => false, 'status' => 403, 'error' => 'Upload permission denied.'];
            }
            $targetDir = PathValidator::sanitizeDirectory($dirParam, $mediaDir);
            if (!$targetDir || !is_dir($targetDir)) {
                return ['success' => false, 'status' => 404, 'error' => 'Target directory not found.'];
            }
            if (!DotfileManager::isDirAccessible($targetDir, $mediaDir)) {
                return ['success' => false, 'status' => 403, 'error' => 'Access denied on target directory.'];
            }
            // Enforce user disk quota upfront before accepting chunks (always read fresh quota from store)
            $curUser = AuthManager::getCurrentUser();
            if ($curUser && !AuthManager::isAdminLoggedIn()) {
                $freshUser = !empty($curUser['id']) ? (UserManager::findById($projectRoot, (int)$curUser['id']) ?: $curUser) : $curUser;
                $quota = UserManager::getUserQuotaInfo($projectRoot, $mediaDir, $freshUser);
                if (!empty($quota['is_limited']) && ($quota['used_bytes'] + $totalSize) > $quota['quota_bytes']) {
                    return ['success' => false, 'status' => 413, 'error' => 'Disk quota exceeded.'];
                }
            }
        }

        $uploadId = 'up_' . bin2hex(random_bytes(12));
        $sessionDir = self::getChunksRoot($projectRoot) . '/' . $uploadId;
        @mkdir($sessionDir, 0755, true);

        $meta = [
            'upload_id'    => $uploadId,
            'actor_scope'  => self::getCurrentActorScope(),
            'dir'          => $dirParam,
            'filename'     => $safeName,
            'total_size'   => $totalSize,
            'total_chunks' => $totalChunks,
            'overwrite'    => $overwrite,
            'created_at'   => time()
        ];
        @file_put_contents($sessionDir . '/meta.json', json_encode($meta, JSON_UNESCAPED_SLASHES), LOCK_EX);

        return [
            'success'      => true,
            'status'       => 200,
            'upload_id'    => $uploadId,
            'filename'     => $safeName,
            'total_chunks' => $totalChunks,
            'received'     => []
        ];
    }

    private static function loadSession(string $projectRoot, string $uploadId): ?array {
        $cleanId = preg_replace('/[^a-zA-Z0-9_-]/', '', $uploadId);
        if ($cleanId === '') return null;
        $dir = self::getChunksRoot($projectRoot) . '/' . $cleanId;
        $metaPath = $dir . '/meta.json';
        if (!is_dir($dir) || !is_file($metaPath)) return null;
        $meta = @json_decode((string)@file_get_contents($metaPath), true);
        if (!is_array($meta)) return null;
        if (($meta['actor_scope'] ?? '') !== self::getCurrentActorScope() && !AuthManager::isAdminLoggedIn()) {
            return null;
        }
        return ['dir' => $dir, 'meta' => $meta];
    }

    public static function storeChunk(
        string $projectRoot,
        string $uploadId,
        int $chunkIndex,
        ?string $tmpFilePath = null,
        ?string $rawBinaryData = null,
        string $mediaDir = ''
    ): array {
        $sess = self::loadSession($projectRoot, $uploadId);
        if (!$sess) {
            return ['success' => false, 'status' => 404, 'error' => 'Upload session not found or unauthorized.'];
        }
        $totalChunks = (int)$sess['meta']['total_chunks'];
        if ($chunkIndex < 0 || $chunkIndex >= $totalChunks) {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid chunk index.'];
        }

        $incomingSize = 0;
        if ($tmpFilePath !== null && is_file($tmpFilePath)) {
            $incomingSize = max(0, (int)@filesize($tmpFilePath));
        } elseif ($rawBinaryData !== null) {
            $incomingSize = strlen($rawBinaryData);
        }
        if ($incomingSize > self::MAX_CHUNK_BYTES) {
            return ['success' => false, 'status' => 413, 'error' => 'Chunk exceeds maximum allowed size.'];
        }

        // Compute existing cumulative bytes in this upload session (excluding the chunk being overwritten)
        $existingSessionBytes = 0;
        for ($i = 0; $i < $totalChunks; $i++) {
            if ($i === $chunkIndex) continue;
            $p = $sess['dir'] . '/chunk_' . $i . '.part';
            if (is_file($p)) {
                $existingSessionBytes += max(0, (int)@filesize($p));
            }
        }
        $projectedSessionBytes = $existingSessionBytes + $incomingSize;
        if ($projectedSessionBytes > self::MAX_SESSION_BYTES) {
            return ['success' => false, 'status' => 413, 'error' => 'Upload exceeds maximum allowed session size.'];
        }

        // Enforce live user disk quota on every chunk (prevents lying about `total_size` in initUpload)
        $curUser = AuthManager::getCurrentUser();
        $dirParam = (string)($sess['meta']['dir'] ?? '');
        if ($curUser && !AuthManager::isAdminLoggedIn() && $mediaDir !== '' && ExternalMountManager::parseExternalPath($dirParam) === null) {
            $freshUser = !empty($curUser['id']) ? (UserManager::findById($projectRoot, (int)$curUser['id']) ?: $curUser) : $curUser;
            $quota = UserManager::getUserQuotaInfo($projectRoot, $mediaDir, $freshUser);
            if (!empty($quota['is_limited']) && ((int)$quota['used_bytes'] + $projectedSessionBytes) > (int)$quota['quota_bytes']) {
                return ['success' => false, 'status' => 413, 'error' => 'Disk quota exceeded.'];
            }
        }

        $destPart = $sess['dir'] . '/chunk_' . $chunkIndex . '.part';
        $ok = false;
        if ($tmpFilePath !== null && is_file($tmpFilePath)) {
            $ok = @move_uploaded_file($tmpFilePath, $destPart) || @copy($tmpFilePath, $destPart);
        } elseif ($rawBinaryData !== null) {
            $ok = @file_put_contents($destPart, $rawBinaryData, LOCK_EX) !== false;
        }
        if (!$ok) {
            return ['success' => false, 'status' => 500, 'error' => 'Failed to persist chunk.'];
        }

        $received = [];
        for ($i = 0; $i < $totalChunks; $i++) {
            if (is_file($sess['dir'] . '/chunk_' . $i . '.part')) {
                $received[] = $i;
            }
        }

        return [
            'success'      => true,
            'status'       => 200,
            'chunk_index'  => $chunkIndex,
            'received'     => $received,
            'total_chunks' => $totalChunks
        ];
    }

    public static function completeUpload(
        string $projectRoot,
        string $mediaDir,
        array $mediaTypes,
        string $uploadId,
        string $thumbnailDir = '.thumbnails'
    ): array {
        $sess = self::loadSession($projectRoot, $uploadId);
        if (!$sess) {
            return ['success' => false, 'status' => 404, 'error' => 'Upload session not found or unauthorized.'];
        }

        $meta = $sess['meta'];
        $totalChunks = (int)$meta['total_chunks'];
        for ($i = 0; $i < $totalChunks; $i++) {
            if (!is_file($sess['dir'] . '/chunk_' . $i . '.part')) {
                return ['success' => false, 'status' => 400, 'error' => "Missing chunk #{$i}."];
            }
        }

        $assembledTmp = $sess['dir'] . '/assembled.tmp';
        $out = @fopen($assembledTmp, 'wb');
        if (!$out) {
            return ['success' => false, 'status' => 500, 'error' => 'Unable to assemble chunks.'];
        }
        $totalBytes = 0;
        for ($i = 0; $i < $totalChunks; $i++) {
            $in = @fopen($sess['dir'] . '/chunk_' . $i . '.part', 'rb');
            if ($in) {
                $copied = stream_copy_to_stream($in, $out);
                $totalBytes += (int)$copied;
                fclose($in);
            }
        }
        fclose($out);

        $filename = (string)$meta['filename'];
        $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        if ($ext === 'svg') {
            SecurityManager::sanitizeSvgContent($assembledTmp);
            $totalBytes = (int)@filesize($assembledTmp);
        }

        $dirParam = (string)$meta['dir'];
        $extParsed = ExternalMountManager::parseExternalPath($dirParam);
        if ($extParsed !== null) {
            $resolved = ExternalMountManager::resolveMountForCurrentUser($projectRoot, $extParsed['mount_id']);
            if (!$resolved || empty($resolved['can_write'])) {
                self::rrmdir($sess['dir']);
                return ['success' => false, 'status' => 403, 'error' => 'External mount write denied.'];
            }
            $destRel = $extParsed['rel_path'] === '' ? $filename : ($extParsed['rel_path'] . '/' . $filename);
            $mime = FormatRegistry::getHttpContentType($ext, $projectRoot, $mediaTypes);
            $pushed = $resolved['driver']->putFile($destRel, $assembledTmp, $mime);
            self::rrmdir($sess['dir']);
            if (!$pushed) {
                return ['success' => false, 'status' => 502, 'error' => 'Failed to write assembled file to external mount.'];
            }
            return [
                'success'    => true,
                'status'     => 200,
                'filename'   => $filename,
                'path'       => 'ext://' . $extParsed['mount_id'] . '/' . $destRel,
                'size_bytes' => $totalBytes
            ];
        }

        // Local VFS destination — re-verify permissions & ACLs at completion time (anti-TOCTOU)
        if (!PermissionsManager::hasPermission('can_upload', $mediaDir, $dirParam)) {
            self::rrmdir($sess['dir']);
            return ['success' => false, 'status' => 403, 'error' => 'Upload permission denied.'];
        }
        $targetDir = PathValidator::sanitizeDirectory($dirParam, $mediaDir);
        if (!$targetDir || !is_dir($targetDir)) {
            self::rrmdir($sess['dir']);
            return ['success' => false, 'status' => 404, 'error' => 'Target directory not found.'];
        }
        if (!DotfileManager::isDirAccessible($targetDir, $mediaDir)) {
            self::rrmdir($sess['dir']);
            return ['success' => false, 'status' => 403, 'error' => 'Access denied on target directory.'];
        }
        $curUser = AuthManager::getCurrentUser();
        if ($curUser && !AuthManager::isAdminLoggedIn()) {
            $freshUser = !empty($curUser['id']) ? (UserManager::findById($projectRoot, (int)$curUser['id']) ?: $curUser) : $curUser;
            $quota = UserManager::getUserQuotaInfo($projectRoot, $mediaDir, $freshUser);
            if (!empty($quota['is_limited']) && ($quota['used_bytes'] + $totalBytes) > $quota['quota_bytes']) {
                self::rrmdir($sess['dir']);
                return ['success' => false, 'status' => 413, 'error' => 'Disk quota exceeded.'];
            }
        }

        $destAbs = $targetDir . '/' . $filename;
        if (file_exists($destAbs)) {
            if (!empty($meta['overwrite'])) {
                $relExisting = PathValidator::getRelativePath($destAbs, $mediaDir);
                TrashAndVersioningManager::snapshotBeforeOverwrite($projectRoot, $destAbs, $relExisting);
            } else {
                $stem = pathinfo($filename, PATHINFO_FILENAME);
                $filename = $ext !== '' ? "{$stem}_" . time() . ".{$ext}" : "{$filename}_" . time();
                $destAbs = $targetDir . '/' . $filename;
            }
        }

        $moved = @rename($assembledTmp, $destAbs) || @copy($assembledTmp, $destAbs);
        self::rrmdir($sess['dir']);
        if (!$moved) {
            return ['success' => false, 'status' => 500, 'error' => 'Failed to move assembled file into destination.'];
        }

        CacheManager::invalidateDirCache($targetDir, $mediaDir, $thumbnailDir);
        $relFinal = PathValidator::getRelativePath($destAbs, $mediaDir);
        FileIndexManager::upsertFile($projectRoot, $mediaDir, $destAbs, $mediaTypes);

        return [
            'success'    => true,
            'status'     => 200,
            'filename'   => $filename,
            'path'       => $relFinal,
            'size_bytes' => $totalBytes
        ];
    }
}
