<?php
/**
 * Atelier by GallusTech — Standalone Web App Relocating Launcher (`system/endpoints/webapp.php`)
 *
 * Serves standalone third-party HTML5/WASM apps whose build hardcoded a root-absolute
 * `--public-url` / `base` prefix (e.g. GitHub Pages builds like `/epub-reader-rs/`) by
 * rewriting the HTML entrypoint paths on the fly to the app's real mount URL while
 * keeping all static JS/CSS/WASM files untouched (preserving SRI `integrity` hashes).
 */

require_once __DIR__ . '/../boot/bootstrap.php';

use Atelier\Kernel\PluginDiscovery;
use Atelier\Kernel\StandaloneWebAppManifestSynthesizer;

$projectRoot = rtrim(str_replace('\\', '/', dirname(__DIR__, 2)), '/');
$appId = trim((string)($_GET['app'] ?? ''));

if ($appId === '' || !preg_match('/^[a-zA-Z0-9._-]{1,80}$/', $appId)) {
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Invalid application identifier.';
    exit;
}

$discovered = PluginDiscovery::getDiscoveredApps($projectRoot, false);
$appInfo = $discovered[$appId] ?? null;
if (!is_array($appInfo)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Application not found or disabled.';
    exit;
}

$manifest = is_array($appInfo['manifest'] ?? null) ? $appInfo['manifest'] : [];
$isStandalone = (($appInfo['distribution'] ?? '') === 'standalone-web')
    || (($manifest['distribution'] ?? '') === 'standalone-web')
    || (($manifest['runtime'] ?? '') === 'iframe');
$htmlRel = (string)($appInfo['html_entry'] ?? ($manifest['entry']['html'] ?? ''));

if (!$isStandalone || $htmlRel === '' || strpos($htmlRel, '..') !== false || strpos($htmlRel, 'apps/') !== 0) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Unsupported application entrypoint.';
    exit;
}

$absHtml = realpath($projectRoot . '/' . ltrim($htmlRel, '/'));
$absApps = realpath($projectRoot . '/apps');
if (!$absHtml || !$absApps || !is_file($absHtml)
    || strpos(str_replace('\\', '/', $absHtml), str_replace('\\', '/', $absApps) . '/') !== 0) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Entrypoint file not found.';
    exit;
}

$htmlContent = @file_get_contents($absHtml);
if ($htmlContent === false) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Unable to read application entrypoint.';
    exit;
}

// Compute site base path from SCRIPT_NAME (e.g. `/Atelier/system/endpoints/webapp.php` -> `/Atelier`)
$scriptName = str_replace('\\', '/', (string)($_SERVER['SCRIPT_NAME'] ?? '/system/endpoints/webapp.php'));
$siteBase = preg_replace('#/system/endpoints/webapp\.php$#i', '', $scriptName);
$siteBase = rtrim((string)$siteBase, '/');

$appDirRel = trim(str_replace('\\', '/', dirname($htmlRel)), '/');
$webAppBaseUrl = ($siteBase !== '' ? $siteBase : '') . '/' . $appDirRel . '/';
$publicBase = (string)($manifest['publicBase'] ?? ($manifest['health']['public_base'] ?? ''));

if ($publicBase !== '') {
    $htmlContent = StandaloneWebAppManifestSynthesizer::rewriteHtmlPublicBase($htmlContent, $publicBase, $webAppBaseUrl);
} elseif (stripos($htmlContent, '<base ') === false) {
    $baseTag = '<base href="' . htmlspecialchars($webAppBaseUrl, ENT_QUOTES, 'UTF-8') . '">';
    if (preg_match('/<head\b[^>]*>/i', $htmlContent)) {
        $htmlContent = preg_replace('/(<head\b[^>]*>)/i', '$1' . $baseTag, $htmlContent, 1);
    } else {
        $htmlContent = $baseTag . $htmlContent;
    }
}

header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-cache, must-revalidate');
echo $htmlContent;
