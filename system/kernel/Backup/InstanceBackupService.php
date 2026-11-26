<?php
/**
 * Atelier by GallusTech - Automated Instance Backup & Snapshot Service (Phase C)
 *
 * Creates admin-only ZIP backups inside `storage/backups/` (protected by `.htaccess` Deny from all)
 * containing:
 *   - Relational database (`storage/atelier.sqlite` or `storage/atelier_db/*.json`)
 *   - Core JSON settings (`storage/*.json`, `config/*.json`)
 *   - Integrity manifest (`backup_manifest.json` with SHA-256 checksums)
 *   - Optionally user & media storage (`include_media = true`, excluding `.thumbnails/` & `backups/`)
 */

namespace SimpleGallery\Kernel\Backup;

use SimpleGallery\Kernel\Auth\AuditLogger;
use SimpleGallery\Kernel\Config\ConfigStore;

class InstanceBackupService {

    public static function getBackupsDir(string $projectRoot): string {
        $dir = ConfigStore::getStorageDir($projectRoot) . '/backups';
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        $ht = $dir . '/.htaccess';
        if (!file_exists($ht)) {
            @file_put_contents($ht, "Deny from all\n", LOCK_EX);
        }
        return $dir;
    }

    /**
     * Generates a timestamped backup ZIP snapshot of the Atelier instance.
     */
    public static function createBackup(string $projectRoot, bool $includeMedia = false, string $label = ''): array {
        if (!class_exists('\ZipArchive')) {
            return ['success' => false, 'status' => 500, 'error' => 'PHP ZipArchive extension is required for instance backups.'];
        }

        $root = rtrim(str_replace('\\', '/', $projectRoot), '/');
        $storageDir = ConfigStore::getStorageDir($root);
        $backupsDir = self::getBackupsDir($root);

        $safeLabel = preg_replace('/[^a-zA-Z0-9_-]+/', '-', trim($label));
        $safeLabel = trim((string)preg_replace('/-+/', '-', $safeLabel), '-');
        $stamp = gmdate('Ymd_His');
        $suffix = $safeLabel !== '' ? ('_' . substr($safeLabel, 0, 24)) : '';
        $filename = "atelier_backup_{$stamp}{$suffix}_" . bin2hex(random_bytes(3)) . '.zip';
        $zipPath = $backupsDir . '/' . $filename;

        $zip = new \ZipArchive();
        if ($zip->open($zipPath, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            return ['success' => false, 'status' => 500, 'error' => 'Failed to create backup archive.'];
        }

        $fileCount = 0;
        $manifestEntries = [];

        $addFile = function (string $absPath, string $arcPath) use ($zip, &$fileCount, &$manifestEntries): void {
            if (!is_file($absPath) || !is_readable($absPath)) return;
            $zip->addFile($absPath, $arcPath);
            $fileCount++;
            $manifestEntries[] = [
                'path'   => $arcPath,
                'size'   => (int)@filesize($absPath),
                'sha256' => @hash_file('sha256', $absPath) ?: ''
            ];
        };

        // 1. SQLite database or JSON store directory
        $sqlitePath = $storageDir . '/atelier.sqlite';
        if (is_file($sqlitePath)) {
            $addFile($sqlitePath, 'storage/atelier.sqlite');
        }
        $jsonDbDir = $storageDir . '/atelier_db';
        if (is_dir($jsonDbDir)) {
            foreach ((@scandir($jsonDbDir) ?: []) as $f) {
                if ($f[0] === '.' || substr($f, -5) !== '.json') continue;
                $addFile($jsonDbDir . '/' . $f, 'storage/atelier_db/' . $f);
            }
        }

        // 2. Top-level JSON configuration files in storage/ and config/
        foreach ([$storageDir => 'storage', $root . '/config' => 'config'] as $dir => $prefix) {
            if (!is_dir($dir)) continue;
            foreach ((@scandir($dir) ?: []) as $f) {
                if ($f[0] === '.' || substr($f, -5) !== '.json') continue;
                $addFile($dir . '/' . $f, $prefix . '/' . $f);
            }
        }

        // 3. Optional media & user homes (skipping cache/thumbnails/backups/chunks/exports)
        if ($includeMedia) {
            $skipDirs = ['.thumbnails', 'backups', 'chunks', 'exports', 'session', 'trash', 'versions'];
            foreach (['media', 'users'] as $sub) {
                $subDir = $storageDir . '/' . $sub;
                if (!is_dir($subDir)) continue;
                self::addDirectoryRecursive($subDir, 'storage/' . $sub, $skipDirs, $addFile);
            }
        }

        $manifest = [
            'format'        => 'atelier-instance-backup-v1',
            'created_at'    => gmdate('c'),
            'php_version'   => PHP_VERSION,
            'include_media' => $includeMedia,
            'files_count'   => $fileCount,
            'files'         => $manifestEntries
        ];
        $zip->addFromString('backup_manifest.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        $zip->close();

        $size = is_file($zipPath) ? (int)@filesize($zipPath) : 0;
        $sha = is_file($zipPath) ? (@hash_file('sha256', $zipPath) ?: '') : '';

        AuditLogger::log($root, 'instance_backup_create', 'storage/backups/' . $filename, 'ok', [
            'size_bytes'    => $size,
            'files_count'   => $fileCount,
            'include_media' => $includeMedia
        ]);

        return [
            'success' => true,
            'status'  => 200,
            'backup'  => [
                'filename'      => $filename,
                'size_bytes'    => $size,
                'sha256'        => $sha,
                'files_count'   => $fileCount,
                'include_media' => $includeMedia,
                'created_at'    => time()
            ]
        ];
    }

    /**
     * Lists existing instance backup ZIPs inside `storage/backups/`.
     */
    public static function listBackups(string $projectRoot): array {
        $dir = self::getBackupsDir($projectRoot);
        $files = @scandir($dir) ?: [];
        $list = [];
        foreach ($files as $f) {
            if ($f[0] === '.' || substr(strtolower($f), -4) !== '.zip') continue;
            $abs = $dir . '/' . $f;
            if (!is_file($abs)) continue;
            $list[] = [
                'filename'   => $f,
                'size_bytes' => (int)@filesize($abs),
                'created_at' => (int)@filemtime($abs)
            ];
        }
        usort($list, function ($a, $b) {
            return $b['created_at'] <=> $a['created_at'];
        });
        return $list;
    }

    public static function resolveBackupFile(string $projectRoot, string $filename): ?string {
        $clean = basename(trim($filename));
        if ($clean === '' || !preg_match('/^[a-zA-Z0-9._-]+\.zip$/', $clean)) {
            return null;
        }
        $dir = realpath(self::getBackupsDir($projectRoot));
        if (!$dir) return null;
        $abs = realpath($dir . '/' . $clean);
        if (!$abs || !is_file($abs)) return null;
        $normDir = rtrim(str_replace('\\', '/', $dir), '/');
        $normAbs = str_replace('\\', '/', $abs);
        if (strpos($normAbs, $normDir . '/') !== 0) {
            return null;
        }
        return $abs;
    }

    public static function deleteBackup(string $projectRoot, string $filename): array {
        $abs = self::resolveBackupFile($projectRoot, $filename);
        if ($abs === null) {
            return ['success' => false, 'status' => 404, 'error' => 'Backup archive not found.'];
        }
        if (!@unlink($abs)) {
            return ['success' => false, 'status' => 500, 'error' => 'Unable to delete backup archive.'];
        }
        AuditLogger::log($projectRoot, 'instance_backup_delete', 'storage/backups/' . basename($abs), 'ok');
        return ['success' => true, 'status' => 200];
    }

    private static function addDirectoryRecursive(string $dir, string $arcPrefix, array $skipDirs, callable $addFile): void {
        foreach ((@scandir($dir) ?: []) as $item) {
            if ($item === '.' || $item === '..') continue;
            if (in_array($item, $skipDirs, true)) continue;
            $abs = $dir . '/' . $item;
            $arc = $arcPrefix . '/' . $item;
            if (is_dir($abs)) {
                self::addDirectoryRecursive($abs, $arc, $skipDirs, $addFile);
            } elseif (is_file($abs)) {
                $addFile($abs, $arc);
            }
        }
    }
}
