<?php
/**
 * Atelier by GallusTech - Soft-Delete Trash (30-day retention) & Lightweight File Versioning Engine (Phase B)
 *  - Trash: user-scoped `storage/trash/<scope>/<id>/` with 1-click restore & automatic 30-day expiry purge
 *  - Versioning: automatic pre-overwrite snapshots (`storage/versions/<hash>/`) keeping last N revisions
 */

namespace SimpleGallery\Kernel\FS;

use SimpleGallery\Kernel\Auth\AuditLogger;
use SimpleGallery\Kernel\Auth\AuthManager;
use SimpleGallery\Kernel\Config\ConfigStore;
use SimpleGallery\Kernel\Security\PathValidator;

class TrashAndVersioningManager {

    public const TRASH_RETENTION_DAYS = 30;
    public const MAX_VERSIONS_PER_FILE = 5;
    public const MAX_VERSION_FILE_BYTES = 52428800; // 50 MB cap per versioned snapshot

    private static function ensureProtectedDir(string $dir): string {
        $norm = rtrim(str_replace('\\', '/', $dir), '/');
        if (!is_dir($norm)) {
            @mkdir($norm, 0755, true);
        }
        $ht = $norm . '/.htaccess';
        if (!file_exists($ht)) {
            @file_put_contents($ht, "Deny from all\n", LOCK_EX);
        }
        return $norm;
    }

    public static function getTrashRoot(string $projectRoot): string {
        return self::ensureProtectedDir(ConfigStore::getStorageDir($projectRoot) . '/trash');
    }

    public static function getVersionsRoot(string $projectRoot): string {
        return self::ensureProtectedDir(ConfigStore::getStorageDir($projectRoot) . '/versions');
    }

    public static function getCurrentTrashScope(): string {
        $user = AuthManager::getCurrentUser();
        if ($user && !empty($user['id'])) {
            return 'u_' . (int)$user['id'];
        }
        return AuthManager::isAdminLoggedIn() ? 'admin' : 'public';
    }

    private static function rrmdir(string $dir): bool {
        if (!is_dir($dir)) return true;
        $items = @scandir($dir) ?: [];
        foreach ($items as $it) {
            if ($it === '.' || $it === '..') continue;
            $p = $dir . '/' . $it;
            if (is_dir($p) && !is_link($p)) {
                self::rrmdir($p);
            } else {
                @unlink($p);
            }
        }
        return @rmdir($dir);
    }

    private static function computeSize(string $path): int {
        if (is_file($path)) {
            return (int)@filesize($path);
        }
        if (!is_dir($path)) return 0;
        $total = 0;
        try {
            $iter = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($path, \FilesystemIterator::SKIP_DOTS)
            );
            foreach ($iter as $f) {
                if ($f->isFile()) $total += (int)$f->getSize();
            }
        } catch (\Throwable $e) {}
        return $total;
    }

    /**
     * Moves a local file or directory into the user's isolated Trash bin instead of hard-deleting.
     */
    public static function moveToTrash(
        string $projectRoot,
        string $absTargetPath,
        string $relOriginalPath,
        ?string $scope = null
    ): array {
        if (!file_exists($absTargetPath)) {
            return ['success' => false, 'error' => 'Target path does not exist.'];
        }
        self::purgeExpired($projectRoot);

        $scopeKey = preg_replace('/[^a-zA-Z0-9_-]/', '', $scope ?: self::getCurrentTrashScope()) ?: 'public';
        $trashId = 'tr_' . date('Ymd_His') . '_' . bin2hex(random_bytes(5));
        $entryDir = self::ensureProtectedDir(self::getTrashRoot($projectRoot) . '/' . $scopeKey . '/' . $trashId);
        $isDir = is_dir($absTargetPath);
        $sizeBytes = self::computeSize($absTargetPath);
        $name = basename($absTargetPath);
        $payloadPath = $entryDir . '/payload';

        if (!@rename($absTargetPath, $payloadPath)) {
            self::rrmdir($entryDir);
            return ['success' => false, 'error' => 'Failed to move item to trash.'];
        }

        $now = time();
        $user = AuthManager::getCurrentUser();
        $meta = [
            'id'            => $trashId,
            'scope'         => $scopeKey,
            'original_path' => trim(str_replace('\\', '/', $relOriginalPath), '/'),
            'name'          => $name,
            'is_dir'        => $isDir,
            'size_bytes'    => $sizeBytes,
            'deleted_by'    => $user ? (string)$user['username'] : (AuthManager::isAdminLoggedIn() ? 'admin' : 'guest'),
            'deleted_at'    => $now,
            'expires_at'    => $now + (self::TRASH_RETENTION_DAYS * 86400)
        ];
        @file_put_contents($entryDir . '/meta.json', json_encode($meta, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);

        AuditLogger::log($projectRoot, 'trash_move', $meta['original_path'], 'ok', ['trash_id' => $trashId]);
        return ['success' => true, 'item' => $meta];
    }

    /**
     * Purges any trash entries whose retention period (30 days) has elapsed.
     */
    public static function purgeExpired(string $projectRoot): int {
        $root = self::getTrashRoot($projectRoot);
        $now = time();
        $purged = 0;

        foreach (@scandir($root) ?: [] as $scopeDir) {
            if ($scopeDir === '.' || $scopeDir === '..' || $scopeDir === '.htaccess') continue;
            $scopeAbs = $root . '/' . $scopeDir;
            if (!is_dir($scopeAbs)) continue;
            foreach (@scandir($scopeAbs) ?: [] as $entry) {
                if ($entry === '.' || $entry === '..' || $entry === '.htaccess') continue;
                $entryAbs = $scopeAbs . '/' . $entry;
                $metaPath = $entryAbs . '/meta.json';
                $meta = is_file($metaPath) ? @json_decode((string)@file_get_contents($metaPath), true) : null;
                $expires = is_array($meta) ? (int)($meta['expires_at'] ?? 0) : 0;
                if ($expires > 0 && $expires <= $now) {
                    self::rrmdir($entryAbs);
                    $purged++;
                }
            }
        }
        return $purged;
    }

    public static function listTrash(string $projectRoot, ?string $scope = null, bool $allScopes = false): array {
        self::purgeExpired($projectRoot);
        $root = self::getTrashRoot($projectRoot);
        $targetScope = $scope ?: self::getCurrentTrashScope();
        $scopesToRead = [];

        if ($allScopes && AuthManager::isAdminLoggedIn()) {
            foreach (@scandir($root) ?: [] as $s) {
                if ($s !== '.' && $s !== '..' && $s !== '.htaccess' && is_dir($root . '/' . $s)) {
                    $scopesToRead[] = $s;
                }
            }
        } else {
            $clean = preg_replace('/[^a-zA-Z0-9_-]/', '', $targetScope);
            if ($clean !== '' && is_dir($root . '/' . $clean)) {
                $scopesToRead[] = $clean;
            }
        }

        $items = [];
        foreach ($scopesToRead as $s) {
            $sAbs = $root . '/' . $s;
            foreach (@scandir($sAbs) ?: [] as $entry) {
                if ($entry === '.' || $entry === '..' || $entry === '.htaccess') continue;
                $metaPath = $sAbs . '/' . $entry . '/meta.json';
                if (!is_file($metaPath)) continue;
                $meta = @json_decode((string)@file_get_contents($metaPath), true);
                if (is_array($meta)) {
                    $items[] = $meta;
                }
            }
        }

        usort($items, function ($a, $b) {
            return (int)($b['deleted_at'] ?? 0) <=> (int)($a['deleted_at'] ?? 0);
        });
        return $items;
    }

    private static function findTrashEntryDir(string $projectRoot, string $trashId, ?string $scope, bool $isAdmin): ?array {
        $cleanId = preg_replace('/[^a-zA-Z0-9_-]/', '', $trashId);
        if ($cleanId === '') return null;
        $root = self::getTrashRoot($projectRoot);
        $candidates = [];
        if ($isAdmin) {
            foreach (@scandir($root) ?: [] as $s) {
                if ($s !== '.' && $s !== '..' && $s !== '.htaccess' && is_dir($root . '/' . $s)) {
                    $candidates[] = $s;
                }
            }
        } else {
            $candidates[] = preg_replace('/[^a-zA-Z0-9_-]/', '', $scope ?: self::getCurrentTrashScope());
        }

        foreach ($candidates as $s) {
            $entryAbs = $root . '/' . $s . '/' . $cleanId;
            $metaPath = $entryAbs . '/meta.json';
            if (is_dir($entryAbs) && is_file($metaPath)) {
                $meta = @json_decode((string)@file_get_contents($metaPath), true);
                if (is_array($meta)) {
                    return ['dir' => $entryAbs, 'meta' => $meta];
                }
            }
        }
        return null;
    }

    public static function restoreItem(string $projectRoot, string $mediaDir, string $trashId, ?string $scope = null): array {
        $isAdmin = AuthManager::isAdminLoggedIn();
        $found = self::findTrashEntryDir($projectRoot, $trashId, $scope, $isAdmin);
        if (!$found) {
            return ['success' => false, 'status' => 404, 'error' => 'Trash item not found.'];
        }

        $meta = $found['meta'];
        $payloadPath = $found['dir'] . '/payload';
        if (!file_exists($payloadPath)) {
            self::rrmdir($found['dir']);
            return ['success' => false, 'status' => 404, 'error' => 'Trash payload missing.'];
        }

        $origRel = trim(str_replace('\\', '/', (string)($meta['original_path'] ?? '')), '/');
        if ($origRel === '' || strpos($origRel, '..') !== false) {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid restore destination.'];
        }

        $parentRel = strpos($origRel, '/') !== false ? dirname($origRel) : '';
        $parentAbs = PathValidator::sanitizePath($parentRel, $mediaDir, false);
        if (!$parentAbs) {
            return ['success' => false, 'status' => 403, 'error' => 'Restore destination outside sandbox.'];
        }
        if (!is_dir($parentAbs)) {
            @mkdir($parentAbs, 0755, true);
        }

        $baseName = basename($origRel);
        $destAbs = $parentAbs . '/' . $baseName;
        if (file_exists($destAbs)) {
            $ext = pathinfo($baseName, PATHINFO_EXTENSION);
            $stem = pathinfo($baseName, PATHINFO_FILENAME);
            $suffix = '_restored_' . date('His');
            $destAbs = $parentAbs . '/' . ($ext !== '' && empty($meta['is_dir']) ? "{$stem}{$suffix}.{$ext}" : "{$baseName}{$suffix}");
        }

        if (!@rename($payloadPath, $destAbs)) {
            return ['success' => false, 'status' => 500, 'error' => 'Unable to restore item from trash.'];
        }

        self::rrmdir($found['dir']);
        $restoredRel = PathValidator::getRelativePath($destAbs, $mediaDir);
        AuditLogger::log($projectRoot, 'trash_restore', $restoredRel, 'ok', ['trash_id' => $trashId]);

        return [
            'success'       => true,
            'status'        => 200,
            'restored_path' => $restoredRel
        ];
    }

    public static function purgeItem(string $projectRoot, string $trashId, ?string $scope = null): array {
        $isAdmin = AuthManager::isAdminLoggedIn();
        $found = self::findTrashEntryDir($projectRoot, $trashId, $scope, $isAdmin);
        if (!$found) {
            return ['success' => false, 'status' => 404, 'error' => 'Trash item not found.'];
        }
        self::rrmdir($found['dir']);
        AuditLogger::log($projectRoot, 'trash_purge', (string)($found['meta']['original_path'] ?? ''), 'ok', ['trash_id' => $trashId]);
        return ['success' => true, 'status' => 200];
    }

    public static function emptyTrash(string $projectRoot, ?string $scope = null): array {
        $scopeKey = preg_replace('/[^a-zA-Z0-9_-]/', '', $scope ?: self::getCurrentTrashScope());
        $sAbs = self::getTrashRoot($projectRoot) . '/' . $scopeKey;
        $count = 0;
        if (is_dir($sAbs)) {
            foreach (@scandir($sAbs) ?: [] as $entry) {
                if ($entry === '.' || $entry === '..' || $entry === '.htaccess') continue;
                self::rrmdir($sAbs . '/' . $entry);
                $count++;
            }
        }
        AuditLogger::log($projectRoot, 'trash_empty', $scopeKey, 'ok', ['count' => $count]);
        return ['success' => true, 'status' => 200, 'purged' => $count];
    }

    // -------------------------------------------------------------------------
    // LIGHTWEIGHT FILE VERSIONING (Automatic Snapshot on Overwrite)
    // -------------------------------------------------------------------------

    private static function getVersionBucketDir(string $projectRoot, string $relPath): string {
        $norm = trim(str_replace('\\', '/', $relPath), '/');
        $hash = sha1(strtolower($norm));
        return self::ensureProtectedDir(self::getVersionsRoot($projectRoot) . '/' . $hash);
    }

    /**
     * Snapshots an existing file before overwriting it, retaining the last MAX_VERSIONS_PER_FILE revisions.
     */
    public static function snapshotBeforeOverwrite(
        string $projectRoot,
        string $absFilePath,
        string $relPath,
        ?string $actor = null
    ): ?array {
        if (!is_file($absFilePath) || !is_readable($absFilePath)) {
            return null;
        }
        $size = (int)@filesize($absFilePath);
        if ($size > self::MAX_VERSION_FILE_BYTES) {
            return null;
        }

        $bucketDir = self::getVersionBucketDir($projectRoot, $relPath);
        $indexPath = $bucketDir . '/index.json';
        $history = is_file($indexPath) ? (@json_decode((string)@file_get_contents($indexPath), true) ?: []) : [];
        if (!is_array($history)) $history = [];

        $sha256 = (string)@hash_file('sha256', $absFilePath);
        // Avoid duplicating identical consecutive snapshot
        if (!empty($history) && ($history[0]['sha256'] ?? '') === $sha256) {
            return $history[0];
        }

        $now = time();
        $vid = 'v_' . $now . '_' . bin2hex(random_bytes(3));
        $bakName = $vid . '.bak';
        if (!@copy($absFilePath, $bucketDir . '/' . $bakName)) {
            return null;
        }

        $user = AuthManager::getCurrentUser();
        $actorName = $actor ?: ($user ? (string)$user['username'] : (AuthManager::isAdminLoggedIn() ? 'admin' : 'guest'));
        $entry = [
            'version_id' => $vid,
            'file_path'  => trim(str_replace('\\', '/', $relPath), '/'),
            'bak_file'   => $bakName,
            'size_bytes' => $size,
            'sha256'     => $sha256,
            'actor'      => $actorName,
            'created_at' => $now
        ];

        array_unshift($history, $entry);
        while (count($history) > self::MAX_VERSIONS_PER_FILE) {
            $old = array_pop($history);
            if (!empty($old['bak_file'])) {
                @unlink($bucketDir . '/' . basename((string)$old['bak_file']));
            }
        }

        @file_put_contents($indexPath, json_encode($history, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);
        return $entry;
    }

    public static function listVersions(string $projectRoot, string $relPath): array {
        $norm = trim(str_replace('\\', '/', $relPath), '/');
        if ($norm === '') return [];
        $bucketDir = self::getVersionsRoot($projectRoot) . '/' . sha1(strtolower($norm));
        $indexPath = $bucketDir . '/index.json';
        if (!is_file($indexPath)) return [];
        $history = @json_decode((string)@file_get_contents($indexPath), true);
        if (!is_array($history)) return [];
        return array_values(array_map(function ($v) {
            unset($v['bak_file']);
            return $v;
        }, $history));
    }

    public static function restoreVersion(string $projectRoot, string $mediaDir, string $relPath, string $versionId): array {
        $norm = trim(str_replace('\\', '/', $relPath), '/');
        $absTarget = PathValidator::sanitizeFile($norm, $mediaDir);
        if (!$absTarget) {
            return ['success' => false, 'status' => 404, 'error' => 'Target file not found.'];
        }
        $bucketDir = self::getVersionsRoot($projectRoot) . '/' . sha1(strtolower($norm));
        $indexPath = $bucketDir . '/index.json';
        if (!is_file($indexPath)) {
            return ['success' => false, 'status' => 404, 'error' => 'No version history found.'];
        }
        $history = @json_decode((string)@file_get_contents($indexPath), true) ?: [];
        $match = null;
        foreach ($history as $v) {
            if (($v['version_id'] ?? '') === $versionId) {
                $match = $v;
                break;
            }
        }
        if (!$match || empty($match['bak_file'])) {
            return ['success' => false, 'status' => 404, 'error' => 'Requested version not found.'];
        }
        $bakPath = $bucketDir . '/' . basename((string)$match['bak_file']);
        if (!is_file($bakPath)) {
            return ['success' => false, 'status' => 404, 'error' => 'Version backup missing on disk.'];
        }

        // Non-destructive: snapshot current state before restoring older revision
        self::snapshotBeforeOverwrite($projectRoot, $absTarget, $norm);
        if (!@copy($bakPath, $absTarget)) {
            return ['success' => false, 'status' => 500, 'error' => 'Failed to restore file version.'];
        }

        AuditLogger::log($projectRoot, 'version_restore', $norm, 'ok', ['version_id' => $versionId]);
        return ['success' => true, 'status' => 200, 'version_id' => $versionId];
    }
}
