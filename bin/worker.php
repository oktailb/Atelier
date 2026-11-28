#!/usr/bin/env php
<?php
/**
 * Atelier by GallusTech - Asynchronous Background Job Worker (Phase C)
 *
 * Usage:
 *   php bin/worker.php --once             # Process pending jobs once and exit (cron / CI)
 *   php bin/worker.php --daemon --sleep=3 # Continuous supervisor / Docker worker loop
 *   php bin/worker.php --root=/path       # Optional custom project root
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo "CLI only.\n";
    exit(1);
}

$opts = getopt('', ['once', 'daemon', 'sleep::', 'max-jobs::', 'root::']);
$isDaemon = isset($opts['daemon']) && !isset($opts['once']);
$sleepSec = max(1, (int)($opts['sleep'] ?? 3));
$maxJobs = isset($opts['max-jobs']) ? max(1, (int)$opts['max-jobs']) : ($isDaemon ? 0 : 25);

$defaultRoot = rtrim(str_replace('\\', '/', dirname(__DIR__)), '/');
require_once $defaultRoot . '/system/boot/bootstrap.php';

use Atelier\Kernel\Jobs\JobQueueManager;

$projectRoot = !empty($opts['root']) ? rtrim(str_replace('\\', '/', (string)$opts['root']), '/') : $defaultRoot;
$mediaDir = is_dir($projectRoot . '/storage/media') ? ($projectRoot . '/storage/media') : ($real_base_dir ?? $projectRoot);
$mtypes = isset($media_types) && is_array($media_types) ? $media_types : [];

$running = true;
if (function_exists('pcntl_async_signals') && function_exists('pcntl_signal')) {
    pcntl_async_signals(true);
    pcntl_signal(SIGTERM, function () use (&$running) { $running = false; });
    pcntl_signal(SIGINT, function () use (&$running) { $running = false; });
}

$processed = 0;
while ($running) {
    $job = JobQueueManager::runNextJob($projectRoot, $mediaDir, $mtypes);
    if ($job !== null) {
        $processed++;
        echo sprintf(
            "[%s] job#%d (%s) => %s\n",
            gmdate('Y-m-d H:i:s'),
            $job['id'],
            $job['job_type'],
            $job['status']
        );
        if ($maxJobs > 0 && $processed >= $maxJobs) {
            break;
        }
        continue;
    }

    if (!$isDaemon) {
        break;
    }
    sleep($sleepSec);
}

echo "[worker] exited after processing {$processed} job(s).\n";
exit(0);
