<?php
/**
 * Atelier by GallusTech - Asynchronous Background Job Queue Engine (Phase C)
 *
 * Persists background jobs in `background_jobs` (SQLite WAL or JSON fallback)
 * and executes them via `bin/worker.php` (daemon/cron) or on-demand admin tick:
 *   - `generate_thumbnails` : Pre-warms thumbnail cache for a directory tree
 *   - `rebuild_file_index`  : Incremental SQLite `FileIndexManager` rebuild
 *   - `build_zip_archive`   : Asynchronous massive ZIP archive builder
 *   - `video_preview`       : Optional FFmpeg web preview transcoding (if ffmpeg installed)
 *   - `clamav_scan`         : Optional ClamAV antivirus scan (if clamdscan/clamscan installed)
 *   - `instance_backup`     : Admin automated instance snapshot (`InstanceBackupService`)
 */

namespace Atelier\Kernel\Jobs;

use Atelier\Kernel\Auth\AuditLogger;
use Atelier\Kernel\Backup\InstanceBackupService;
use Atelier\Kernel\Config\ConfigStore;
use Atelier\Kernel\Data\AtelierStore;
use Atelier\Kernel\FS\FileIndexManager;
use Atelier\Kernel\Security\PathValidator;

class JobQueueManager {

    public const VALID_TYPES = [
        'generate_thumbnails',
        'rebuild_file_index',
        'build_zip_archive',
        'video_preview',
        'clamav_scan',
        'instance_backup'
    ];

    public const ADMIN_ONLY_TYPES = [
        'rebuild_file_index',
        'clamav_scan',
        'instance_backup'
    ];

    /**
     * Enqueues a new asynchronous background job.
     */
    public static function enqueue(
        string $projectRoot,
        string $jobType,
        array $payload = [],
        ?int $ownerUserId = null,
        int $priority = 50,
        int $maxAttempts = 3
    ): array {
        $type = strtolower(trim($jobType));
        if (!in_array($type, self::VALID_TYPES, true)) {
            return ['success' => false, 'status' => 400, 'error' => 'Unsupported background job type.'];
        }

        $store = AtelierStore::forRoot($projectRoot);
        $now = time();
        $id = $store->insert('background_jobs', [
            'job_type'      => $type,
            'owner_user_id' => $ownerUserId,
            'status'        => 'pending',
            'priority'      => max(1, min(100, $priority)),
            'payload_json'  => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '{}',
            'result_json'   => null,
            'progress'      => 0,
            'attempts'      => 0,
            'max_attempts'  => max(1, min(10, $maxAttempts)),
            'last_error'    => '',
            'created_at'    => $now,
            'started_at'    => null,
            'completed_at'  => null
        ]);

        $row = $store->selectOne('background_jobs', ['id' => (int)$id]);
        return [
            'success' => true,
            'status'  => 200,
            'job'     => self::formatJob($row ?: ['id' => (int)$id, 'job_type' => $type, 'status' => 'pending', 'created_at' => $now])
        ];
    }

    /**
     * Lists jobs (all for admin, or strictly owned by `$ownerUserId` for regular users).
     */
    public static function listJobs(string $projectRoot, ?int $ownerUserId = null, bool $allForAdmin = false, int $limit = 50): array {
        $store = AtelierStore::forRoot($projectRoot);
        $where = (!$allForAdmin && $ownerUserId !== null) ? ['owner_user_id' => $ownerUserId] : [];
        $rows = $store->select('background_jobs', $where, ['created_at' => 'DESC'], $limit);
        return array_map([self::class, 'formatJob'], $rows);
    }

    public static function getStats(string $projectRoot, ?int $ownerUserId = null, bool $allForAdmin = true): array {
        $store = AtelierStore::forRoot($projectRoot);
        $baseWhere = (!$allForAdmin && $ownerUserId !== null) ? ['owner_user_id' => $ownerUserId] : [];
        return [
            'pending'   => $store->count('background_jobs', array_merge($baseWhere, ['status' => 'pending'])),
            'running'   => $store->count('background_jobs', array_merge($baseWhere, ['status' => 'running'])),
            'completed' => $store->count('background_jobs', array_merge($baseWhere, ['status' => 'completed'])),
            'failed'    => $store->count('background_jobs', array_merge($baseWhere, ['status' => 'failed']))
        ];
    }

    public static function cancelJob(string $projectRoot, int $jobId, ?int $actingUserId, bool $isAdmin = false): array {
        $store = AtelierStore::forRoot($projectRoot);
        $row = $store->selectOne('background_jobs', ['id' => $jobId]);
        if (!$row) {
            return ['success' => false, 'status' => 404, 'error' => 'Job not found.'];
        }
        if (!$isAdmin && ($actingUserId === null || (int)($row['owner_user_id'] ?? 0) !== $actingUserId)) {
            return ['success' => false, 'status' => 403, 'error' => 'Permission denied.'];
        }
        if (($row['status'] ?? '') !== 'pending') {
            return ['success' => false, 'status' => 409, 'error' => 'Only pending jobs can be cancelled.'];
        }
        $store->update('background_jobs', [
            'status'       => 'cancelled',
            'completed_at' => time()
        ], ['id' => $jobId]);
        return ['success' => true, 'status' => 200];
    }

    /**
     * Claims the highest-priority pending job and transitions it to `running`.
     */
    public static function claimNextPending(string $projectRoot): ?array {
        $store = AtelierStore::forRoot($projectRoot);
        $pending = $store->select('background_jobs', ['status' => 'pending'], ['priority' => 'ASC', 'created_at' => 'ASC'], 1);
        if (empty($pending)) {
            return null;
        }
        $job = $pending[0];
        $jobId = (int)$job['id'];
        $attempts = (int)($job['attempts'] ?? 0) + 1;
        $now = time();

        $store->update('background_jobs', [
            'status'     => 'running',
            'attempts'   => $attempts,
            'started_at' => $now,
            'progress'   => 5
        ], ['id' => $jobId]);

        $job['status'] = 'running';
        $job['attempts'] = $attempts;
        $job['started_at'] = $now;
        return $job;
    }

    /**
     * Claims and executes the next pending job in queue.
     * Returns `null` if queue is empty, or the formatted completed/failed job array.
     */
    public static function runNextJob(string $projectRoot, string $mediaDir, array $mediaTypes = []): ?array {
        $job = self::claimNextPending($projectRoot);
        if (!$job) {
            return null;
        }

        $store = AtelierStore::forRoot($projectRoot);
        $jobId = (int)$job['id'];
        $type = (string)$job['job_type'];
        $payload = @json_decode((string)($job['payload_json'] ?? '{}'), true);
        if (!is_array($payload)) $payload = [];

        try {
            $ownerUid = isset($job['owner_user_id']) && $job['owner_user_id'] !== null ? (int)$job['owner_user_id'] : null;
            $result = self::executeJob($projectRoot, $mediaDir, $mediaTypes, $jobId, $type, $payload, $ownerUid);
            $store->update('background_jobs', [
                'status'       => 'completed',
                'progress'     => 100,
                'result_json'  => json_encode($result, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '{}',
                'last_error'   => '',
                'completed_at' => time()
            ], ['id' => $jobId]);
        } catch (\Throwable $e) {
            $attempts = (int)($job['attempts'] ?? 1);
            $maxAttempts = max(1, (int)($job['max_attempts'] ?? 3));
            $nextStatus = ($attempts < $maxAttempts) ? 'pending' : 'failed';
            $store->update('background_jobs', [
                'status'       => $nextStatus,
                'last_error'   => substr($e->getMessage(), 0, 500),
                'completed_at' => $nextStatus === 'failed' ? time() : null
            ], ['id' => $jobId]);
        }

        $updated = $store->selectOne('background_jobs', ['id' => $jobId]);
        return self::formatJob($updated ?: $job);
    }

    private static function buildSafeTreeIterator(string $targetAbs, bool $skipRestrictedDirs): \RecursiveIteratorIterator {
        $dirIter = new \RecursiveDirectoryIterator(
            $targetAbs,
            \FilesystemIterator::SKIP_DOTS
        );
        $filter = new \RecursiveCallbackFilterIterator(
            $dirIter,
            function (\SplFileInfo $current) use ($skipRestrictedDirs): bool {
                if ($current->isLink()) {
                    return false;
                }
                $bn = $current->getFilename();
                if ($bn === '' || $bn[0] === '.') {
                    return false;
                }
                if ($current->isDir() && $skipRestrictedDirs) {
                    $p = $current->getPathname();
                    if (file_exists($p . '/.private') || file_exists($p . '/.password') || strcasecmp($bn, 'private') === 0 || strcasecmp($bn, 'users') === 0) {
                        return false;
                    }
                }
                return true;
            }
        );
        return new \RecursiveIteratorIterator($filter, \RecursiveIteratorIterator::LEAVES_ONLY);
    }

    private static function executeJob(string $projectRoot, string $mediaDir, array $mediaTypes, int $jobId, string $type, array $payload, ?int $ownerUserId = null): array {
        $store = AtelierStore::forRoot($projectRoot);
        $ownerIsAdmin = ($ownerUserId === null) || !empty($payload['_owner_is_admin']);

        switch ($type) {
            case 'rebuild_file_index':
                $stats = FileIndexManager::rebuildIndex($projectRoot, $mediaDir, $mediaTypes);
                return array_merge(['job_type' => $type], $stats);

            case 'instance_backup':
                $includeMedia = !empty($payload['include_media']);
                $label = (string)($payload['label'] ?? '');
                $res = InstanceBackupService::createBackup($projectRoot, $includeMedia, $label);
                if (empty($res['success'])) {
                    throw new \RuntimeException((string)($res['error'] ?? 'Backup failed'));
                }
                return $res['backup'];

            case 'generate_thumbnails':
                $relDir = trim((string)($payload['dir'] ?? ''), '/');
                $targetAbs = $relDir === '' ? realpath($mediaDir) : PathValidator::sanitizeDirectory($relDir, $mediaDir);
                if (!$targetAbs || !is_dir($targetAbs)) {
                    throw new \RuntimeException('Target directory not found.');
                }
                $scanned = 0;
                $generated = 0;
                $hasGd = extension_loaded('gd') && function_exists('imagecreatefromstring');
                $thumbCache = ConfigStore::getStorageDir($projectRoot) . '/.thumbnails';
                if (!is_dir($thumbCache)) @mkdir($thumbCache, 0755, true);

                $iter = self::buildSafeTreeIterator($targetAbs, !$ownerIsAdmin);
                foreach ($iter as $fInfo) {
                    if (!$fInfo->isFile() || $fInfo->isLink()) continue;
                    $bn = $fInfo->getFilename();
                    if ($bn[0] === '.') continue;
                    $ext = strtolower($fInfo->getExtension());
                    if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'gif'], true)) continue;
                    $scanned++;
                    if (!$hasGd) continue;
                    $abs = str_replace('\\', '/', $fInfo->getPathname());
                    $hash = md5($abs . '|' . $fInfo->getMTime() . '|' . $fInfo->getSize());
                    $outThumb = $thumbCache . '/job_' . $hash . '.jpg';
                    if (is_file($outThumb)) continue;

                    $raw = @file_get_contents($abs);
                    if ($raw === false) continue;
                    $src = @imagecreatefromstring($raw);
                    if (!$src) continue;
                    $w = imagesx($src);
                    $h = imagesy($src);
                    if ($w > 0 && $h > 0) {
                        $max = 400;
                        $ratio = min(1.0, $max / max($w, $h));
                        $nw = max(1, (int)round($w * $ratio));
                        $nh = max(1, (int)round($h * $ratio));
                        $dst = imagecreatetruecolor($nw, $nh);
                        imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
                        if (@imagejpeg($dst, $outThumb, 82)) {
                            $generated++;
                        }
                        imagedestroy($dst);
                    }
                    imagedestroy($src);
                    if ($scanned % 20 === 0) {
                        $store->update('background_jobs', ['progress' => min(95, 10 + $scanned)], ['id' => $jobId]);
                    }
                }
                return ['dir' => $relDir, 'scanned' => $scanned, 'generated' => $generated, 'gd_available' => $hasGd];

            case 'build_zip_archive':
                if (!class_exists('\ZipArchive')) {
                    throw new \RuntimeException('ZipArchive extension not available.');
                }
                $relDir = trim((string)($payload['dir'] ?? ''), '/');
                $targetAbs = $relDir === '' ? realpath($mediaDir) : PathValidator::sanitizeDirectory($relDir, $mediaDir);
                if (!$targetAbs || !is_dir($targetAbs)) {
                    throw new \RuntimeException('Source directory not found.');
                }
                $outDir = ConfigStore::getStorageDir($projectRoot) . '/exports/jobs';
                if (!is_dir($outDir)) @mkdir($outDir, 0755, true);
                $ht = $outDir . '/.htaccess';
                if (!file_exists($ht)) @file_put_contents($ht, "Deny from all\n", LOCK_EX);

                $zipName = 'archive_job_' . $jobId . '_' . gmdate('Ymd_His') . '.zip';
                $zipPath = $outDir . '/' . $zipName;
                $zip = new \ZipArchive();
                if ($zip->open($zipPath, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
                    throw new \RuntimeException('Unable to open output ZIP archive.');
                }
                $count = 0;
                $totalSourceBytes = 0;
                $maxFiles = 10000;
                $maxSourceBytes = 2147483648; // 2 GB cap per async ZIP job
                $normRoot = rtrim(str_replace('\\', '/', $targetAbs), '/');
                $iter = self::buildSafeTreeIterator($targetAbs, !$ownerIsAdmin);
                foreach ($iter as $fInfo) {
                    if (!$fInfo->isFile() || $fInfo->isLink()) continue;
                    $p = str_replace('\\', '/', $fInfo->getPathname());
                    $rel = ltrim(substr($p, strlen($normRoot)), '/');
                    if ($rel === '' || strpos('/' . $rel, '/.') !== false) continue;
                    $fSize = (int)$fInfo->getSize();
                    if ($count >= $maxFiles || ($totalSourceBytes + $fSize) > $maxSourceBytes) {
                        break;
                    }
                    $zip->addFile($p, $rel);
                    $count++;
                    $totalSourceBytes += $fSize;
                }
                $zip->close();
                return [
                    'filename'    => $zipName,
                    'rel_path'    => 'storage/exports/jobs/' . $zipName,
                    'files_count' => $count,
                    'size_bytes'  => (int)@filesize($zipPath)
                ];

            case 'video_preview':
                $relFile = trim((string)($payload['file'] ?? ''), '/');
                $abs = PathValidator::sanitizeFile($relFile, $mediaDir);
                if (!$abs || !is_file($abs)) {
                    throw new \RuntimeException('Video file not found.');
                }
                $hasFfmpeg = false;
                if (function_exists('exec')) {
                    @exec('ffmpeg -version 2>&1', $ffOut, $ffCode);
                    $hasFfmpeg = ($ffCode === 0);
                }
                if (!$hasFfmpeg) {
                    return ['file' => $relFile, 'skipped' => true, 'reason' => 'ffmpeg_unavailable'];
                }
                $outDir = ConfigStore::getStorageDir($projectRoot) . '/.thumbnails/previews';
                if (!is_dir($outDir)) @mkdir($outDir, 0755, true);
                $outFile = $outDir . '/' . md5($abs) . '_preview.mp4';
                $cmd = 'ffmpeg -y -i ' . escapeshellarg($abs)
                    . ' -vf "scale=\'min(854,iw)\':-2" -c:v libx264 -preset fast -crf 28 -movflags +faststart -an '
                    . escapeshellarg($outFile) . ' 2>&1';
                @exec($cmd, $outLines, $exitCode);
                if ($exitCode !== 0 || !is_file($outFile)) {
                    throw new \RuntimeException('FFmpeg transcoding failed (exit ' . $exitCode . ').');
                }
                return ['file' => $relFile, 'preview' => basename($outFile), 'size_bytes' => (int)@filesize($outFile)];

            case 'clamav_scan':
                $relTarget = trim((string)($payload['dir'] ?? ''), '/');
                $abs = $relTarget === '' ? realpath($mediaDir) : PathValidator::sanitizeDirectory($relTarget, $mediaDir);
                if (!$abs || !is_dir($abs)) {
                    throw new \RuntimeException('Scan target directory not found.');
                }
                $bin = null;
                if (function_exists('exec')) {
                    foreach (['clamdscan', 'clamscan'] as $cand) {
                        @exec($cand . ' --version 2>&1', $co, $cc);
                        if ($cc === 0) {
                            $bin = $cand;
                            break;
                        }
                    }
                }
                if ($bin === null) {
                    return ['dir' => $relTarget, 'skipped' => true, 'reason' => 'clamav_unavailable'];
                }
                $cmd = $bin . ' --no-summary -i -r ' . escapeshellarg($abs) . ' 2>&1';
                @exec($cmd, $scanLines, $scanCode);
                return [
                    'dir'      => $relTarget,
                    'scanner'  => $bin,
                    'clean'    => ($scanCode === 0),
                    'infected' => ($scanCode === 1),
                    'output'   => implode("\n", array_slice($scanLines, 0, 20))
                ];

            default:
                throw new \RuntimeException('Unknown job type: ' . $type);
        }
    }

    public static function formatJob(array $row): array {
        $payload = @json_decode((string)($row['payload_json'] ?? '{}'), true);
        $result = isset($row['result_json']) && $row['result_json'] !== null
            ? @json_decode((string)$row['result_json'], true)
            : null;
        return [
            'id'            => (int)($row['id'] ?? 0),
            'job_type'      => (string)($row['job_type'] ?? ''),
            'owner_user_id' => isset($row['owner_user_id']) && $row['owner_user_id'] !== null ? (int)$row['owner_user_id'] : null,
            'status'        => (string)($row['status'] ?? 'pending'),
            'priority'      => (int)($row['priority'] ?? 50),
            'progress'      => (int)($row['progress'] ?? 0),
            'attempts'      => (int)($row['attempts'] ?? 0),
            'max_attempts'  => (int)($row['max_attempts'] ?? 3),
            'payload'       => is_array($payload) ? $payload : [],
            'result'        => is_array($result) ? $result : null,
            'last_error'    => (string)($row['last_error'] ?? ''),
            'created_at'    => (int)($row['created_at'] ?? 0),
            'started_at'    => isset($row['started_at']) && $row['started_at'] !== null ? (int)$row['started_at'] : null,
            'completed_at'  => isset($row['completed_at']) && $row['completed_at'] !== null ? (int)$row['completed_at'] : null
        ];
    }
}
