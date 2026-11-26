<?php
/**
 * Atelier by GallusTech - WebDAV HTTP Endpoint (`system/endpoints/dav.php` -> `/dav/`)
 */

require_once __DIR__ . '/../boot/bootstrap.php';

use SimpleGallery\Kernel\Dav\WebDavServer;

$projectRoot = rtrim(str_replace('\\', '/', dirname(__DIR__, 2)), '/');
$mediaDir = $real_base_dir ?? ($projectRoot . '/storage/media');

$scriptName = str_replace('\\', '/', (string)($_SERVER['SCRIPT_NAME'] ?? '/system/endpoints/dav.php'));
$siteBase = rtrim((string)preg_replace('#/system/endpoints/dav\.php$#i', '', $scriptName), '/');
$davBaseUrl = ($siteBase !== '' ? $siteBase : '') . '/dav';

$davPath = isset($_GET['dav_path']) ? (string)$_GET['dav_path'] : '';
if ($davPath === '' && !empty($_SERVER['PATH_INFO'])) {
    $davPath = ltrim((string)$_SERVER['PATH_INFO'], '/');
}

$authHeader = $_SERVER['HTTP_AUTHORIZATION']
    ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
    ?? '';
if ($authHeader === '' && function_exists('apache_request_headers')) {
    $hdrs = @apache_request_headers() ?: [];
    foreach ($hdrs as $k => $v) {
        if (strtolower((string)$k) === 'authorization') {
            $authHeader = (string)$v;
            break;
        }
    }
}

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$body = ($method === 'PUT') ? ((string)@file_get_contents('php://input')) : '';

$req = [
    'method'        => $method,
    'dav_path'      => $davPath,
    'dav_base_url'  => $davBaseUrl,
    'authorization' => $authHeader,
    'auth_user'     => $_SERVER['PHP_AUTH_USER'] ?? null,
    'auth_pass'     => $_SERVER['PHP_AUTH_PW'] ?? null,
    'depth'         => $_SERVER['HTTP_DEPTH'] ?? '1',
    'destination'   => $_SERVER['HTTP_DESTINATION'] ?? '',
    'overwrite'     => $_SERVER['HTTP_OVERWRITE'] ?? 'T',
    'client_ip'     => $_SERVER['REMOTE_ADDR'] ?? '',
    'body'          => $body
];

if ($req['auth_user'] === null) {
    unset($req['auth_user'], $req['auth_pass']);
}

$resp = WebDavServer::handleRequest($projectRoot, $mediaDir, $req);

http_response_code((int)($resp['status'] ?? 200));
foreach (($resp['headers'] ?? []) as $hName => $hVal) {
    header("{$hName}: {$hVal}");
}

if (!empty($resp['file_path']) && is_file((string)$resp['file_path'])) {
    if (function_exists('ob_get_level')) {
        while (ob_get_level() > 0) @ob_end_clean();
    }
    readfile((string)$resp['file_path']);
} else {
    echo (string)($resp['body'] ?? '');
}
