<?php
/**
 * Atelier by GallusTech - Admin External Web App Deployment, Update Manager & Override Controller (Lot 2)
 *
 * Security invariants:
 * - Strictly restricted to authenticated administrators (`AuthManager::isAdminLoggedIn()`).
 * - Direct URL installs validated against SSRF via `UrlValidator::resolveAndValidateUrl()`.
 * - ZIP archives checked against Zip-Slip traversal, symlinks, and executable server extensions (`.php`, `.phar`, `.sh`, etc.).
 * - Staging extraction & health validation (`index.html` + `.wasm` > 0 bytes) before atomic promotion into `apps/external/`.
 * - Upstream updates (GitHub Releases SemVer check) are NEVER auto-installed: they are queued as `pending_update`
 *   for explicit administrator validation (`approveUpdate()`).
 */

namespace SimpleGallery\Kernel;

use SimpleGallery\Kernel\Auth\AuditLogger;
use SimpleGallery\Kernel\Auth\AuthManager;
use SimpleGallery\Kernel\Config\ConfigStore;
use SimpleGallery\Kernel\Media\FormatRegistry;
use SimpleGallery\Kernel\Security\UrlValidator;

class ExternalAppManager {

    private const MAX_ZIP_BYTES = 262144000; // 250 MB safety cap (compressed)
    private const MAX_UNCOMPRESSED_BYTES = 536870912; // 512 MB safety cap (anti-Zip-Bomb)
    private const MAX_SINGLE_ENTRY_BYTES = 134217728; // 128 MB max per extracted entry
    private const MAX_ZIP_ENTRIES = 5000;

    /** Server-side executable extensions strictly forbidden inside extracted web app bundles */
    private const FORBIDDEN_BUNDLE_EXTS = [
        'php', 'phtml', 'php3', 'php4', 'php5', 'php7', 'php8', 'phps', 'phar', 'inc',
        'cgi', 'pl', 'py', 'rb', 'sh', 'bash', 'zsh', 'exe', 'dll', 'bat', 'cmd', 'com', 'ps1', 'vbs', 'msi'
    ];

    private static function getRegistryPath(string $projectRoot): string {
        return ConfigStore::getStorageDir($projectRoot) . '/external_apps_registry.json';
    }

    private static function getOverridesPath(string $projectRoot): string {
        return rtrim(str_replace('\\', '/', $projectRoot), '/') . '/config/external_apps.json';
    }

    public static function loadRegistry(string $projectRoot): array {
        $path = self::getRegistryPath($projectRoot);
        if (!is_file($path)) {
            return [];
        }
        $decoded = @json_decode((string)@file_get_contents($path), true);
        return is_array($decoded) ? $decoded : [];
    }

    private static function saveRegistry(string $projectRoot, array $data): bool {
        $path = self::getRegistryPath($projectRoot);
        $dir = dirname($path);
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        return @file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX) !== false;
    }

    public static function loadOverrides(string $projectRoot): array {
        $path = self::getOverridesPath($projectRoot);
        if (!is_file($path)) {
            return [];
        }
        $decoded = @json_decode((string)@file_get_contents($path), true);
        return is_array($decoded) ? $decoded : [];
    }

    private static function saveOverrides(string $projectRoot, array $data): bool {
        $path = self::getOverridesPath($projectRoot);
        $dir = dirname($path);
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        return @file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX) !== false;
    }

    /**
     * Auto-detects an upstream GitHub repository (`owner/repo`) from an app's README.md if present.
     */
    public static function detectGithubRepoFromAppDir(string $appDir, string $appId = ''): string {
        $readme = is_file($appDir . '/README.md') ? (@file_get_contents($appDir . '/README.md') ?: '') : '';
        if ($readme === '') {
            return '';
        }
        if (preg_match_all('#https?://github\.com/([a-zA-Z0-9_.-]+)/([a-zA-Z0-9_.-]+)#i', $readme, $matches, PREG_SET_ORDER)) {
            $fallback = '';
            $slug = strtolower($appId);
            foreach ($matches as $m) {
                $owner = $m[1];
                $repo = preg_replace('/\.git$/i', '', rtrim($m[2], '/'));
                if (in_array(strtolower($owner), ['features', 'topics', 'sponsors', 'orgs'], true)) {
                    continue;
                }
                $candidate = $owner . '/' . $repo;
                if ($slug !== '' && stripos($repo, $slug) !== false) {
                    return $candidate;
                }
                if ($fallback === '') {
                    $fallback = $candidate;
                }
            }
            return $fallback;
        }
        return '';
    }

    /**
     * Computes directory disk size safely (bounded).
     */
    private static function computeDirSize(string $dir): int {
        if (!is_dir($dir)) return 0;
        $total = 0;
        try {
            $it = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS)
            );
            foreach ($it as $fi) {
                if ($fi->isFile()) $total += (int)$fi->getSize();
            }
        } catch (\Throwable $e) {
            return $total;
        }
        return $total;
    }

    private static function rrmdir(string $dir): bool {
        if (!is_dir($dir)) return true;
        try {
            $it = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
                \RecursiveIteratorIterator::CHILD_FIRST
            );
            foreach ($it as $fi) {
                $p = $fi->getPathname();
                if ($fi->isDir() && !$fi->isLink()) {
                    @rmdir($p);
                } else {
                    @unlink($p);
                }
            }
            return @rmdir($dir);
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Lists all discovered standalone external web apps (including unhealthy deployments) with metadata,
     * admin overrides, disk size, and any pending upstream updates.
     */
    public static function listExternalApps(string $projectRoot): array {
        if (!AuthManager::isAdminLoggedIn()) {
            return ['success' => false, 'status' => 403, 'error' => __t('api.err_admin_required')];
        }

        $root = rtrim(str_replace('\\', '/', $projectRoot), '/');
        $discovered = PluginDiscovery::getDiscoveredApps($root, true);
        $registry = self::loadRegistry($root);
        $overrides = self::loadOverrides($root);
        $list = [];

        foreach ($discovered as $id => $info) {
            $m = $info['manifest'] ?? [];
            $isStandalone = (($info['distribution'] ?? '') === 'standalone-web')
                || (($m['distribution'] ?? '') === 'standalone-web')
                || (($m['runtime'] ?? '') === 'iframe');
            if (!$isStandalone) {
                continue;
            }
            $htmlEntry = (string)($info['html_entry'] ?? ($m['entry']['html'] ?? ''));
            $relDir = $htmlEntry !== '' ? str_replace('\\', '/', dirname($htmlEntry)) : '';
            $absDir = $relDir !== '' ? ($root . '/' . ltrim($relDir, '/')) : '';
            $regEntry = is_array($registry[$id] ?? null) ? $registry[$id] : [];
            $githubRepo = (string)($regEntry['github_repo'] ?? '');
            if ($githubRepo === '' && $absDir !== '' && is_dir($absDir)) {
                $githubRepo = self::detectGithubRepoFromAppDir($absDir, (string)$id);
            }
            $override = is_array($overrides[$id] ?? null) ? $overrides[$id] : [];

            $list[] = [
                'id'                 => (string)$id,
                'name'               => (string)($info['name'] ?? $id),
                'version'            => (string)($info['version'] ?? '1.0.0'),
                'category'           => (string)($info['category'] ?? ''),
                'icon'               => (string)($info['icon'] ?? '🌐'),
                'icon_url'           => $info['icon_url'] ?? null,
                'enabled'            => !empty($info['enabled']),
                'health'             => $m['health'] ?? ['ok' => true, 'reason' => 'ok'],
                'extensions'         => array_values((array)($m['extensions'] ?? [])),
                'host_bridge'        => $m['hostBridge'] ?? null,
                'protocol'           => !empty($m['hostBridge']) ? 'host-parent' : 'vfs-bridge',
                'open_file_param'    => $m['openFileParam'] ?? null,
                'rel_dir'            => $relDir,
                'rel_path'           => $relDir,
                'folder'             => (string)($m['source_folder'] ?? basename($relDir)),
                'is_in_external_dir' => stripos($relDir, 'apps/external/') === 0,
                'managed'            => stripos($relDir, 'apps/external/') === 0,
                'size_bytes'         => $absDir !== '' ? self::computeDirSize($absDir) : 0,
                'github_repo'        => $githubRepo,
                'source_url'         => (string)($regEntry['source_url'] ?? ''),
                'asset_pattern'      => (string)($regEntry['asset_pattern'] ?? ''),
                'pending_update'     => is_array($regEntry['pending_update'] ?? null) ? $regEntry['pending_update'] : null,
                'last_checked_at'    => (int)($regEntry['last_checked_at'] ?? 0),
                'override'           => $override
            ];
        }

        usort($list, function ($a, $b) {
            return strcasecmp($a['name'], $b['name']);
        });

        return [
            'success'      => true,
            'status'       => 200,
            'zip_enabled'  => class_exists('\ZipArchive'),
            'curl_enabled' => function_exists('curl_init'),
            'apps'         => $list
        ];
    }

    /**
     * Installs or upgrades a standalone web app from a local `.zip` file (admin-only).
     */
    public static function installFromZipFile(string $projectRoot, string $zipFilePath, string $archiveName = 'app.zip', array $meta = []): array {
        if (!AuthManager::isAdminLoggedIn()) {
            return ['success' => false, 'status' => 403, 'error' => __t('api.err_admin_required')];
        }
        if (!class_exists('\ZipArchive')) {
            return ['success' => false, 'status' => 500, 'error' => 'PHP ZipArchive extension is required to extract app archives.'];
        }
        if (!is_file($zipFilePath) || !is_readable($zipFilePath)) {
            return ['success' => false, 'status' => 400, 'error' => 'Archive file not found or unreadable.'];
        }
        $zipSize = (int)@filesize($zipFilePath);
        if ($zipSize <= 0 || $zipSize > self::MAX_ZIP_BYTES) {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid ZIP archive size (max 250 MB).'];
        }

        $root = rtrim(str_replace('\\', '/', $projectRoot), '/');
        $externalDir = $root . '/apps/external';
        if (!is_dir($externalDir) && !@mkdir($externalDir, 0755, true)) {
            return ['success' => false, 'status' => 500, 'error' => 'Unable to create apps/external directory.'];
        }

        $zip = new \ZipArchive();
        if ($zip->open($zipFilePath) !== true) {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid or corrupted ZIP archive.'];
        }

        $numFiles = $zip->numFiles;
        if ($numFiles <= 0 || $numFiles > self::MAX_ZIP_ENTRIES) {
            $zip->close();
            return ['success' => false, 'status' => 400, 'error' => 'Archive entry count out of allowed bounds.'];
        }

        // Security audit of all ZIP entries before extracting a single byte
        $topSegments = [];
        $declaredUncompressed = 0;
        for ($i = 0; $i < $numFiles; $i++) {
            $stat = $zip->statIndex($i);
            if (!is_array($stat)) continue;
            $entrySize = max(0, (int)($stat['size'] ?? 0));
            if ($entrySize > self::MAX_SINGLE_ENTRY_BYTES) {
                $zip->close();
                return ['success' => false, 'status' => 400, 'error' => 'Archive entry exceeds maximum allowed uncompressed size (Zip-Bomb blocked).'];
            }
            $declaredUncompressed += $entrySize;
            if ($declaredUncompressed > self::MAX_UNCOMPRESSED_BYTES) {
                $zip->close();
                return ['success' => false, 'status' => 400, 'error' => 'Archive uncompressed size exceeds 512 MB safety limit (Zip-Bomb blocked).'];
            }
            $name = str_replace('\\', '/', (string)($stat['name'] ?? ''));
            if ($name === '' || strpos($name, "\0") !== false) {
                $zip->close();
                return ['success' => false, 'status' => 400, 'error' => 'Unsafe archive entry detected.'];
            }
            if ($name[0] === '/' || preg_match('#^[a-zA-Z]:/#', $name)) {
                $zip->close();
                return ['success' => false, 'status' => 400, 'error' => 'Archive contains absolute paths (blocked).'];
            }
            $parts = explode('/', trim($name, '/'));
            foreach ($parts as $seg) {
                if ($seg === '..') {
                    $zip->close();
                    return ['success' => false, 'status' => 400, 'error' => 'Archive contains path traversal (Zip-Slip blocked).'];
                }
            }
            // Reject symlinks (Unix mode 0120000 in upper 16 bits of external_attributes)
            $extAttr = (int)($stat['external_attributes'] ?? 0);
            $unixMode = ($extAttr >> 16) & 0170000;
            if ($unixMode === 0120000) {
                $zip->close();
                return ['success' => false, 'status' => 400, 'error' => 'Archive contains symlinks (blocked for security).'];
            }

            if (substr($name, -1) !== '/') {
                $bn = strtolower(basename($name));
                if (in_array($bn, ['.user.ini', '.htaccess', '.htpasswd'], true)) {
                    $zip->close();
                    return ['success' => false, 'status' => 400, 'error' => "Forbidden web server configuration file ({$bn}) inside archive."];
                }
                $ext = strtolower(pathinfo($bn, PATHINFO_EXTENSION));
                if (in_array($ext, self::FORBIDDEN_BUNDLE_EXTS, true)) {
                    $zip->close();
                    return ['success' => false, 'status' => 400, 'error' => "Forbidden server-executable file (.{$ext}) inside archive: {$bn}"];
                }
            }

            $first = $parts[0] ?? '';
            if ($first !== '' && $first !== '__MACOSX') {
                $topSegments[$first] = true;
            }
        }

        $stagingDir = ConfigStore::getStorageDir($root) . '/.app_staging_' . bin2hex(random_bytes(6));
        if (!@mkdir($stagingDir, 0755, true)) {
            $zip->close();
            return ['success' => false, 'status' => 500, 'error' => 'Failed to create temporary staging directory.'];
        }

        // Extract safely entry by entry with real-time decompressed byte accounting (never trust ZIP header sizes alone)
        $totalExtractedBytes = 0;
        for ($i = 0; $i < $numFiles; $i++) {
            $name = str_replace('\\', '/', (string)$zip->getNameIndex($i));
            if ($name === '' || strpos($name, '__MACOSX/') === 0) continue;
            $destPath = $stagingDir . '/' . ltrim($name, '/');
            if (substr($name, -1) === '/') {
                @mkdir($destPath, 0755, true);
                continue;
            }
            $parent = dirname($destPath);
            if (!is_dir($parent)) @mkdir($parent, 0755, true);
            $stream = $zip->getStream($zip->getNameIndex($i));
            if ($stream === false) continue;
            $outFp = @fopen($destPath, 'wb');
            if (!$outFp) {
                fclose($stream);
                continue;
            }
            $entryBytes = 0;
            $bombDetected = false;
            while (!feof($stream)) {
                $chunk = fread($stream, 65536);
                if ($chunk === false || $chunk === '') break;
                $len = strlen($chunk);
                $entryBytes += $len;
                $totalExtractedBytes += $len;
                if ($entryBytes > self::MAX_SINGLE_ENTRY_BYTES || $totalExtractedBytes > self::MAX_UNCOMPRESSED_BYTES) {
                    $bombDetected = true;
                    break;
                }
                fwrite($outFp, $chunk);
            }
            fclose($outFp);
            fclose($stream);
            if ($bombDetected) {
                $zip->close();
                self::rrmdir($stagingDir);
                return ['success' => false, 'status' => 400, 'error' => 'Archive exceeded maximum allowed uncompressed size during extraction (Zip-Bomb blocked).'];
            }
        }
        $zip->close();

        // Unwrap single top-level directory (e.g. `gridcraft-web-0.20.0/index.html`)
        $sourceDir = $stagingDir;
        $suggestedFolder = preg_replace('/\.zip$/i', '', basename($archiveName));
        if (count($topSegments) === 1) {
            $onlyTop = array_key_first($topSegments);
            if (is_dir($stagingDir . '/' . $onlyTop)) {
                $sourceDir = $stagingDir . '/' . $onlyTop;
                $suggestedFolder = $onlyTop;
            }
        }

        // Verify valid standalone HTML entry exists and is healthy
        $htmlEntry = StandaloneWebAppManifestSynthesizer::detectHtmlEntryFile($sourceDir);
        if ($htmlEntry === null || (int)@filesize($sourceDir . '/' . $htmlEntry) <= 0) {
            self::rrmdir($stagingDir);
            return ['success' => false, 'status' => 400, 'error' => 'Archive does not contain a valid non-empty index.html entrypoint.'];
        }

        $safeFolder = preg_replace('/[^a-zA-Z0-9._-]+/', '-', (string)$suggestedFolder);
        $safeFolder = trim((string)preg_replace('/-+/', '-', $safeFolder), '.-_');
        if ($safeFolder === '') {
            $safeFolder = 'webapp-' . date('YmdHis');
        }

        // Synthesize manifest from staged directory to validate health & derive app ID/version
        $synth = StandaloneWebAppManifestSynthesizer::synthesize($sourceDir, 'external/' . $safeFolder, $root);
        if (empty($synth['health']['ok'])) {
            $reason = (string)($synth['health']['reason'] ?? 'unhealthy');
            self::rrmdir($stagingDir);
            return ['success' => false, 'status' => 400, 'error' => "Extracted app failed health check ({$reason})."];
        }

        $appId = (string)$synth['id'];
        $newVersion = (string)($synth['version'] ?? '1.0.0');
        $targetDir = $externalDir . '/' . $safeFolder;

        // If replacing exact same folder, clear old folder first
        if (is_dir($targetDir)) {
            self::rrmdir($targetDir);
        }

        // Move staged folder into apps/external/<safeFolder>
        $moved = @rename($sourceDir, $targetDir);
        if (!$moved) {
            // Cross-device fallback copy
            self::copyDir($sourceDir, $targetDir);
        }
        self::rrmdir($stagingDir);

        if (!is_dir($targetDir) || !is_file($targetDir . '/' . $htmlEntry)) {
            return ['success' => false, 'status' => 500, 'error' => 'Failed to install app into apps/external/.'];
        }

        // Clean up older versions of the same app inside apps/external/ (never touches root apps/)
        $registry = self::loadRegistry($root);
        $prevFolder = (string)($registry[$appId]['folder'] ?? '');
        if ($prevFolder !== '' && $prevFolder !== $safeFolder
            && strpos($prevFolder, '/') === false && strpos($prevFolder, '\\') === false && strpos($prevFolder, '..') === false
            && is_dir($externalDir . '/' . $prevFolder)) {
            self::rrmdir($externalDir . '/' . $prevFolder);
        }

        $detectedRepo = trim((string)($meta['github_repo'] ?? ''));
        if ($detectedRepo === '') {
            $detectedRepo = (string)($registry[$appId]['github_repo'] ?? '');
        }
        if ($detectedRepo === '') {
            $detectedRepo = self::detectGithubRepoFromAppDir($targetDir, $appId);
        }

        $registry[$appId] = array_merge($registry[$appId] ?? [], [
            'id'                => $appId,
            'folder'            => $safeFolder,
            'installed_version' => $newVersion,
            'installed_at'      => time(),
            'source_url'        => trim((string)($meta['source_url'] ?? ($registry[$appId]['source_url'] ?? ''))),
            'github_repo'       => self::sanitizeGithubRepo($detectedRepo),
            'asset_pattern'     => trim((string)($meta['asset_pattern'] ?? ($registry[$appId]['asset_pattern'] ?? ''))),
            'pending_update'    => null
        ]);
        self::saveRegistry($root, $registry);
        FormatRegistry::clearCache();

        AuditLogger::log($root, 'external_app_install', 'apps/external/' . $safeFolder, 'ok', [
            'app_id'  => $appId,
            'version' => $newVersion,
            'source'  => !empty($meta['source_url']) ? 'url' : 'zip_upload'
        ]);

        return [
            'success' => true,
            'status'  => 200,
            'app'     => [
                'id'      => $appId,
                'name'    => (string)($synth['name'] ?? $appId),
                'version' => $newVersion,
                'folder'  => $safeFolder,
                'rel_dir' => 'apps/external/' . $safeFolder
            ]
        ];
    }

    /**
     * Downloads a `.zip` bundle from a validated public HTTPS/HTTP URL (anti-SSRF) and installs it (admin-only).
     */
    public static function installFromUrl(string $projectRoot, string $url, array $meta = []): array {
        if (!AuthManager::isAdminLoggedIn()) {
            return ['success' => false, 'status' => 403, 'error' => __t('api.err_admin_required')];
        }
        $cleanUrl = trim($url);
        if ($cleanUrl === '' || !preg_match('#^https?://#i', $cleanUrl)) {
            return ['success' => false, 'status' => 400, 'error' => 'A valid http:// or https:// ZIP URL is required.'];
        }
        if (UrlValidator::resolveAndValidateUrl($cleanUrl) === null) {
            return ['success' => false, 'status' => 403, 'error' => 'Download URL blocked by SSRF security policy.'];
        }
        if (!function_exists('curl_init')) {
            return ['success' => false, 'status' => 500, 'error' => 'PHP cURL extension is required for direct URL downloads.'];
        }

        $root = rtrim(str_replace('\\', '/', $projectRoot), '/');
        $tmpZip = ConfigStore::getStorageDir($root) . '/.app_dl_' . bin2hex(random_bytes(6)) . '.zip';

        $currentUrl = $cleanUrl;
        $downloaded = false;
        $httpErr = '';
        for ($hop = 0; $hop < 6; $hop++) {
            $validated = UrlValidator::resolveAndValidateUrl($currentUrl);
            if ($validated === null) {
                @unlink($tmpZip);
                return ['success' => false, 'status' => 403, 'error' => 'Redirect target blocked by SSRF policy.'];
            }
            $fp = @fopen($tmpZip, 'wb');
            if (!$fp) {
                return ['success' => false, 'status' => 500, 'error' => 'Unable to open temporary download file.'];
            }
            $locationHeader = '';
            $downloadedBytes = 0;
            $sizeLimitExceeded = false;
            $ch = curl_init($currentUrl);
            curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
            curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15);
            curl_setopt($ch, CURLOPT_TIMEOUT, 180);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
            curl_setopt($ch, CURLOPT_USERAGENT, 'Atelier-WebOS/1.0');
            if (defined('CURLPROTO_HTTP') && defined('CURLPROTO_HTTPS')) {
                curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
            }
            // Pin hostname -> validated public IP to defeat DNS-rebinding TOCTOU
            $host = (string)$validated['host'];
            $port = (int)$validated['port'];
            $pinnedIp = (string)$validated['ips'][0];
            if (!filter_var($host, FILTER_VALIDATE_IP) && defined('CURLOPT_RESOLVE')) {
                $resolveIp = (strpos($pinnedIp, ':') !== false) ? "[{$pinnedIp}]" : $pinnedIp;
                curl_setopt($ch, CURLOPT_RESOLVE, ["{$host}:{$port}:{$resolveIp}"]);
            }
            curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, $line) use (&$locationHeader) {
                if (stripos($line, 'Location:') === 0) {
                    $locationHeader = trim(substr($line, 9));
                }
                return strlen($line);
            });
            curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $chunk) use ($fp, &$downloadedBytes, &$sizeLimitExceeded) {
                $len = strlen($chunk);
                $downloadedBytes += $len;
                if ($downloadedBytes > self::MAX_ZIP_BYTES) {
                    $sizeLimitExceeded = true;
                    return 0;
                }
                return (int)fwrite($fp, $chunk);
            });
            $ok = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $cerr = (string)curl_error($ch);
            curl_close($ch);
            fclose($fp);

            if ($sizeLimitExceeded) {
                @unlink($tmpZip);
                return ['success' => false, 'status' => 413, 'error' => 'Remote archive exceeds 250 MB safety cap.'];
            }

            if ($code >= 300 && $code < 400 && $locationHeader !== '') {
                $nextUrl = UrlValidator::resolveRedirectUrl($currentUrl, $locationHeader);
                if ($nextUrl === null) {
                    @unlink($tmpZip);
                    return ['success' => false, 'status' => 403, 'error' => 'Invalid redirect URL.'];
                }
                $currentUrl = $nextUrl;
                continue;
            }
            if ($ok && $code >= 200 && $code < 300 && is_file($tmpZip) && filesize($tmpZip) > 0) {
                $downloaded = true;
            } else {
                $httpErr = $cerr !== '' ? $cerr : "HTTP {$code}";
            }
            break;
        }

        if (!$downloaded) {
            @unlink($tmpZip);
            return ['success' => false, 'status' => 502, 'error' => 'Failed to download archive: ' . ($httpErr ?: 'unknown error')];
        }

        $urlPath = (string)(parse_url($currentUrl, PHP_URL_PATH) ?: '');
        $archiveName = basename($urlPath) ?: 'external-app.zip';
        if (stripos($archiveName, '.zip') === false) {
            $archiveName .= '.zip';
        }

        $meta['source_url'] = $cleanUrl;
        if (empty($meta['github_repo']) && preg_match('#^https?://github\.com/([a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+)/#i', $cleanUrl, $gm)) {
            $meta['github_repo'] = $gm[1];
        }

        $res = self::installFromZipFile($root, $tmpZip, $archiveName, $meta);
        @unlink($tmpZip);
        return $res;
    }

    /**
     * Checks GitHub Releases API for newer versions of installed external apps.
     * NEVER auto-installs: stores detected updates as `pending_update` awaiting admin approval.
     */
    public static function checkUpdates(string $projectRoot, ?string $onlyAppId = null, ?callable $httpFetcher = null): array {
        if (!AuthManager::isAdminLoggedIn()) {
            return ['success' => false, 'status' => 403, 'error' => __t('api.err_admin_required')];
        }

        $listRes = self::listExternalApps($projectRoot);
        if (empty($listRes['success'])) {
            return $listRes;
        }

        $root = rtrim(str_replace('\\', '/', $projectRoot), '/');
        $registry = self::loadRegistry($root);
        $checked = 0;
        $updatesFound = [];
        $errors = [];

        foreach ($listRes['apps'] as $app) {
            $appId = (string)$app['id'];
            if ($onlyAppId !== null && $onlyAppId !== '' && $appId !== $onlyAppId) {
                continue;
            }
            $repo = self::sanitizeGithubRepo((string)($app['github_repo'] ?? ''));
            if ($repo === '') {
                continue;
            }

            $checked++;
            $apiUrl = "https://api.github.com/repos/{$repo}/releases/latest";
            $release = is_callable($httpFetcher) ? $httpFetcher($apiUrl, $app) : self::fetchGithubReleaseJson($apiUrl);
            if (!is_array($release) || empty($release['tag_name'])) {
                $errors[$appId] = 'Unable to query latest release for ' . $repo;
                continue;
            }

            $latestVer = ltrim(trim((string)$release['tag_name']), 'vV');
            $installedVer = ltrim(trim((string)($app['version'] ?? '0.0.0')), 'vV');

            $asset = self::selectWebZipAsset(
                is_array($release['assets'] ?? null) ? $release['assets'] : [],
                $appId,
                (string)($app['asset_pattern'] ?? '')
            );

            $now = time();
            $entry = is_array($registry[$appId] ?? null) ? $registry[$appId] : ['id' => $appId, 'folder' => $app['folder']];
            $entry['github_repo'] = $repo;
            $entry['last_checked_at'] = $now;

            if ($latestVer !== '' && version_compare($latestVer, $installedVer, '>')) {
                $pending = [
                    'version'      => $latestVer,
                    'tag_name'     => (string)$release['tag_name'],
                    'download_url' => $asset ? (string)$asset['browser_download_url'] : '',
                    'asset_name'   => $asset ? (string)$asset['name'] : '',
                    'asset_size'   => $asset ? (int)($asset['size'] ?? 0) : 0,
                    'notes_url'    => (string)($release['html_url'] ?? "https://github.com/{$repo}/releases/latest"),
                    'published_at' => (string)($release['published_at'] ?? ''),
                    'checked_at'   => $now
                ];
                $entry['pending_update'] = $pending;
                $updatesFound[] = array_merge(['app_id' => $appId, 'current_version' => $installedVer], $pending);
            } else {
                $entry['pending_update'] = null;
            }
            $registry[$appId] = $entry;
        }

        self::saveRegistry($root, $registry);

        return [
            'success'       => true,
            'status'        => 200,
            'checked'       => $checked,
            'checked_count' => $checked,
            'updates_found' => count($updatesFound),
            'updates'       => $updatesFound,
            'errors'        => $errors
        ];
    }

    /**
     * Explicit administrator validation & installation of a pending upstream update.
     */
    public static function approveUpdate(string $projectRoot, string $appId): array {
        if (!AuthManager::isAdminLoggedIn()) {
            return ['success' => false, 'status' => 403, 'error' => __t('api.err_admin_required')];
        }
        $cleanId = trim($appId);
        $registry = self::loadRegistry($projectRoot);
        $entry = is_array($registry[$cleanId] ?? null) ? $registry[$cleanId] : null;
        $pending = ($entry && is_array($entry['pending_update'] ?? null)) ? $entry['pending_update'] : null;
        if (!$pending || empty($pending['download_url'])) {
            return ['success' => false, 'status' => 404, 'error' => 'No downloadable pending update found for this application.'];
        }
        return self::installFromUrl($projectRoot, (string)$pending['download_url'], [
            'github_repo'   => (string)($entry['github_repo'] ?? ''),
            'asset_pattern' => (string)($entry['asset_pattern'] ?? '')
        ]);
    }

    public static function dismissUpdate(string $projectRoot, string $appId): array {
        if (!AuthManager::isAdminLoggedIn()) {
            return ['success' => false, 'status' => 403, 'error' => __t('api.err_admin_required')];
        }
        $cleanId = trim($appId);
        $registry = self::loadRegistry($projectRoot);
        if (isset($registry[$cleanId]) && is_array($registry[$cleanId])) {
            $registry[$cleanId]['pending_update'] = null;
            self::saveRegistry($projectRoot, $registry);
        }
        return ['success' => true, 'status' => 200];
    }

    /**
     * Saves admin overrides (`config/external_apps.json`) and optional upstream update repo metadata.
     */
    public static function saveOverride(string $projectRoot, string $appId, array $input): array {
        if (!AuthManager::isAdminLoggedIn()) {
            return ['success' => false, 'status' => 403, 'error' => __t('api.err_admin_required')];
        }
        $cleanId = preg_replace('/[^a-zA-Z0-9_-]+/', '', trim($appId));
        if ($cleanId === '') {
            return ['success' => false, 'status' => 400, 'error' => 'Valid app_id required.'];
        }

        $root = rtrim(str_replace('\\', '/', $projectRoot), '/');
        $overrides = self::loadOverrides($root);
        $patch = is_array($input['override'] ?? null) ? $input['override'] : $input;
        $sanitized = [];

        if (isset($patch['icon']) && trim((string)$patch['icon']) !== '') {
            $iconVal = trim((string)$patch['icon']);
            if (strpos($iconVal, '..') === false && !preg_match('/^\s*(javascript|data)\s*:/i', $iconVal)) {
                $sanitized['icon'] = mb_substr($iconVal, 0, 128);
            }
        }
        if (isset($patch['category']) && trim((string)$patch['category']) !== '') {
            $cat = strtolower(preg_replace('/[^a-z0-9_-]/i', '', trim((string)$patch['category'])));
            if ($cat !== '') $sanitized['category'] = $cat;
        }
        if (array_key_exists('extensions', $patch)) {
            $rawExts = is_array($patch['extensions'])
                ? $patch['extensions']
                : preg_split('/[\s,;]+/', (string)$patch['extensions']);
            $cleanExts = [];
            foreach ((array)$rawExts as $e) {
                $ce = ltrim(strtolower(trim((string)$e)), '.');
                if ($ce !== '' && preg_match('/^[a-z0-9]{1,12}$/', $ce) && !FormatRegistry::isForbiddenExtension($ce)) {
                    $cleanExts[$ce] = true;
                }
            }
            if (!empty($cleanExts)) {
                $sanitized['extensions'] = array_keys($cleanExts);
            }
        }
        if (array_key_exists('vfsBridge', $patch)) {
            $sanitized['vfsBridge'] = (bool)$patch['vfsBridge'];
        }

        if (empty($sanitized)) {
            unset($overrides[$cleanId]);
        } else {
            $overrides[$cleanId] = $sanitized;
        }
        self::saveOverrides($root, $overrides);

        // Update optional upstream GitHub repo / asset pattern in registry
        $hasRepo = array_key_exists('github_repo', $input) || array_key_exists('github_repo', $patch);
        $hasPat = array_key_exists('asset_pattern', $input) || array_key_exists('asset_pattern', $patch);
        if ($hasRepo || $hasPat) {
            $registry = self::loadRegistry($root);
            $entry = is_array($registry[$cleanId] ?? null) ? $registry[$cleanId] : ['id' => $cleanId];
            if ($hasRepo) {
                $repoVal = array_key_exists('github_repo', $patch) ? $patch['github_repo'] : $input['github_repo'];
                $entry['github_repo'] = self::sanitizeGithubRepo((string)$repoVal);
            }
            if ($hasPat) {
                $patVal = array_key_exists('asset_pattern', $patch) ? $patch['asset_pattern'] : $input['asset_pattern'];
                $entry['asset_pattern'] = substr(trim((string)$patVal), 0, 80);
            }
            $registry[$cleanId] = $entry;
            self::saveRegistry($root, $registry);
        }

        FormatRegistry::clearCache();
        AuditLogger::log($root, 'external_app_override', $cleanId, 'ok');

        return [
            'success'  => true,
            'status'   => 200,
            'app_id'   => $cleanId,
            'override' => $sanitized
        ];
    }

    /**
     * Uninstalls a standalone external web app (strictly blocks native Atelier core apps).
     */
    public static function uninstallApp(string $projectRoot, string $appId): array {
        if (!AuthManager::isAdminLoggedIn()) {
            return ['success' => false, 'status' => 403, 'error' => __t('api.err_admin_required')];
        }
        $cleanId = trim($appId);
        $root = rtrim(str_replace('\\', '/', $projectRoot), '/');
        $discovered = PluginDiscovery::getDiscoveredApps($root, true);
        if (!isset($discovered[$cleanId])) {
            return ['success' => false, 'status' => 404, 'error' => 'External app not found.'];
        }
        $info = $discovered[$cleanId];
        $m = $info['manifest'] ?? [];
        if (($info['distribution'] ?? '') !== 'standalone-web' && ($m['distribution'] ?? '') !== 'standalone-web') {
            return ['success' => false, 'status' => 403, 'error' => 'Core native applications cannot be uninstalled.'];
        }
        $htmlEntry = (string)($info['html_entry'] ?? ($m['entry']['html'] ?? ''));
        $relDir = $htmlEntry !== '' ? str_replace('\\', '/', dirname($htmlEntry)) : '';
        if ($relDir === '' || strpos($relDir, 'apps/') !== 0 || strpos($relDir, '..') !== false) {
            return ['success' => false, 'status' => 400, 'error' => 'Invalid external app path.'];
        }
        $absDir = realpath($root . '/' . $relDir);
        $appsRoot = realpath($root . '/apps');
        if (!$absDir || !$appsRoot || strpos(str_replace('\\', '/', $absDir), str_replace('\\', '/', $appsRoot) . '/') !== 0) {
            return ['success' => false, 'status' => 403, 'error' => 'Refused to delete path outside apps/.'];
        }

        self::rrmdir($absDir);
        $registry = self::loadRegistry($root);
        unset($registry[$cleanId]);
        self::saveRegistry($root, $registry);
        FormatRegistry::clearCache();
        AuditLogger::log($root, 'external_app_uninstall', $relDir, 'ok', ['app_id' => $cleanId]);

        return ['success' => true, 'status' => 200, 'app_id' => $cleanId];
    }

    public static function selectWebZipAsset(array $assets, string $appId, string $customPattern = ''): ?array {
        $zips = [];
        foreach ($assets as $a) {
            if (!is_array($a) || empty($a['name']) || empty($a['browser_download_url'])) continue;
            $name = (string)$a['name'];
            if (substr(strtolower($name), -4) !== '.zip') continue;
            $zips[] = $a;
        }
        if (empty($zips)) return null;

        if ($customPattern !== '') {
            foreach ($zips as $a) {
                if (fnmatch(strtolower($customPattern), strtolower((string)$a['name']))) {
                    return $a;
                }
            }
        }
        // Prefer `*-web-*.zip` / `*web*.zip` / `*wasm*.zip` over desktop OS bundles
        foreach ($zips as $a) {
            $ln = strtolower((string)$a['name']);
            if (strpos($ln, 'web') !== false || strpos($ln, 'wasm') !== false) {
                return $a;
            }
        }
        foreach ($zips as $a) {
            $ln = strtolower((string)$a['name']);
            if (!preg_match('/(windows|win64|macos|darwin|linux|arm64|x86_64|amd64|deb|rpm|msi)/i', $ln)) {
                return $a;
            }
        }
        return $zips[0];
    }

    private static function sanitizeGithubRepo(string $raw): string {
        $v = trim($raw);
        if (preg_match('#^https?://github\.com/([a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+)#i', $v, $m)) {
            $v = $m[1];
        }
        $v = preg_replace('/\.git$/i', '', trim($v, '/'));
        return preg_match('/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/', $v) ? $v : '';
    }

    private static function fetchGithubReleaseJson(string $apiUrl): ?array {
        if (!function_exists('curl_init')) return null;
        $ch = curl_init($apiUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 12);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'User-Agent: Atelier-WebOS/1.0',
            'Accept: application/vnd.github+json'
        ]);
        $resp = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($code !== 200 || !is_string($resp)) return null;
        $json = @json_decode($resp, true);
        return is_array($json) ? $json : null;
    }

    private static function copyDir(string $src, string $dst): void {
        @mkdir($dst, 0755, true);
        $it = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($src, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST
        );
        foreach ($it as $fi) {
            $rel = substr($fi->getPathname(), strlen($src));
            $target = $dst . $rel;
            if ($fi->isDir()) {
                @mkdir($target, 0755, true);
            } else {
                @copy($fi->getPathname(), $target);
            }
        }
    }
}
