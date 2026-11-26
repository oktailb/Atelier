<?php
/**
 * SimpleGallery 2026 - High Performance Thumbnail Generator
 * Supports GD image resizing, FFmpeg video frame extraction, & instant direct fallback.
 */

// Disable error display in binary output to prevent corrupted image headers
ini_set('display_errors', '0');
error_reporting(0);

$project_root = dirname(dirname(__DIR__));
require_once $project_root . '/system/boot/bootstrap.php';
require_once $project_root . '/system/kernel/functions.php';


function send_cached_file(string $file_path, string $content_type, int $max_age = 31536000, bool $is_restricted = false): void {
    if (!file_exists($file_path)) {
        return;
    }
    $mtime = filemtime($file_path);
    $size = filesize($file_path);
    $etag = '"' . md5($file_path . '-' . $mtime . '-' . $size) . '"';

    header('Content-Type: ' . $content_type);
    if ($is_restricted) {
        header('Cache-Control: private, no-store, max-age=0');
        header('Pragma: no-cache');
    } else {
        header('Cache-Control: public, max-age=' . $max_age);
    }
    header('ETag: ' . $etag);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');

    if (strtolower($content_type) === 'image/svg+xml') {
        header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'none';");
        header("X-Content-Type-Options: nosniff");
    }

    $if_none_match = isset($_SERVER['HTTP_IF_NONE_MATCH']) ? trim($_SERVER['HTTP_IF_NONE_MATCH']) : null;
    $if_modified_since = isset($_SERVER['HTTP_IF_MODIFIED_SINCE']) ? strtotime($_SERVER['HTTP_IF_MODIFIED_SINCE']) : null;

    if (($if_none_match !== null && $if_none_match === $etag) || 
        ($if_modified_since !== null && $if_modified_since >= $mtime)) {
        http_response_code(304);
        exit;
    }

    header('Content-Length: ' . $size);
    readfile($file_path);
    exit;
}

function get_full_mime_type(string $ext): string {
    global $project_root, $media_types;
    $root = is_string($project_root ?? null) ? $project_root : dirname(dirname(__DIR__));
    return \SimpleGallery\Kernel\Media\FormatRegistry::getHttpContentType($ext, $root, is_array($media_types ?? null) ? $media_types : []);
}

function serve_raw_file(string $file_path, string $ext, bool $as_attachment = false, bool $is_restricted = false): void {
    if (!file_exists($file_path) || !is_readable($file_path)) {
        http_response_code(404);
        die("File not found.");
    }

    $size = filesize($file_path);
    $mtime = filemtime($file_path);
    $etag = '"' . md5($file_path . '-' . $mtime . '-' . $size) . '"';
    $content_type = get_full_mime_type($ext);
    $is_text_doc = in_array(strtolower($ext), ['txt', 'md', 'markdown', 'json', 'csv', 'xml', 'html', 'css', 'js', 'log', 'ini', 'sql', 'yaml', 'yml'], true);

    header('Content-Type: ' . $content_type);
    header('Accept-Ranges: bytes');
    
    $disposition = $as_attachment ? 'attachment' : 'inline';
    header('Content-Disposition: ' . $disposition . '; filename="' . rawurlencode(basename($file_path)) . '"');
    if ($is_restricted) {
        header('Cache-Control: private, no-store, max-age=0');
        header('Pragma: no-cache');
        header('Expires: 0');
    } elseif ($is_text_doc) {
        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('Pragma: no-cache');
        header('Expires: 0');
    } else {
        header('Cache-Control: public, max-age=31536000');
    }
    header('ETag: ' . $etag);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');

    if (strtolower($ext) === 'svg') {
        header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'none';");
        header("X-Content-Type-Options: nosniff");
    }

    $if_none_match = isset($_SERVER['HTTP_IF_NONE_MATCH']) ? trim($_SERVER['HTTP_IF_NONE_MATCH']) : null;
    $if_modified_since = isset($_SERVER['HTTP_IF_MODIFIED_SINCE']) ? strtotime($_SERVER['HTTP_IF_MODIFIED_SINCE']) : null;
    if (($if_none_match !== null && $if_none_match === $etag) || ($if_modified_since !== null && $if_modified_since >= $mtime)) {
        http_response_code(304);
        exit;
    }

    if (isset($_SERVER['HTTP_RANGE'])) {
        $range = $_SERVER['HTTP_RANGE'];
        if (preg_match('/bytes=(\d*)-(\d*)/i', $range, $matches)) {
            $start = ($matches[1] !== '') ? (int)$matches[1] : 0;
            $end = ($matches[2] !== '') ? (int)$matches[2] : ($size - 1);

            if ($start < 0 || $start > $end || $start >= $size) {
                http_response_code(416);
                header("Content-Range: bytes */$size");
                exit;
            }

            $end = min($end, $size - 1);
            $length = $end - $start + 1;
            http_response_code(206);
            header("Content-Range: bytes $start-$end/$size");
            header("Content-Length: $length");

            $fp = fopen($file_path, 'rb');
            if ($fp) {
                fseek($fp, $start);
                $buffer_size = 1024 * 64;
                $bytes_sent = 0;
                while (!feof($fp) && ($bytes_sent < $length) && (connection_status() === 0)) {
                    $read_bytes = min($buffer_size, $length - $bytes_sent);
                    $data = fread($fp, $read_bytes);
                    echo $data;
                    flush();
                    $bytes_sent += strlen($data);
                }
                fclose($fp);
            }
            exit;
        }
    }

    header('Content-Length: ' . $size);
    readfile($file_path);
    exit;
}

function serve_direct_file(string $file_path, string $ext, bool $is_restricted = false): void {
    serve_raw_file($file_path, $ext, false, $is_restricted);
}

function render_svg_placeholder(string $category, string $ext, string $filename): void {
    header('Content-Type: image/svg+xml');
    header('Cache-Control: public, max-age=86400');
    header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'none';");
    header("X-Content-Type-Options: nosniff");

    $ext_lower = strtolower($ext);
    
    // Extension specific color mapping (Matching classic OS file icons!)
    $color_map = [
        'pdf'   => ['#e11d48', '#be123c'],
        'doc'   => ['#2563eb', '#1d4ed8'],
        'docx'  => ['#2563eb', '#1d4ed8'],
        'xls'   => ['#16a34a', '#15803d'],
        'xlsx'  => ['#16a34a', '#15803d'],
        'ods'   => ['#16a34a', '#15803d'],
        'csv'   => ['#059669', '#047857'],
        'tsv'   => ['#059669', '#047857'],
        'odt'   => ['#2563eb', '#1d4ed8'],
        'odp'   => ['#ea580c', '#c2410c'],
        'epub'  => ['#7c3aed', '#6d28d9'],
        'ppt'   => ['#ea580c', '#c2410c'],
        'pptx'  => ['#ea580c', '#c2410c'],
        'zip'   => ['#d97706', '#b45309'],
        'rar'   => ['#d97706', '#b45309'],
        '7z'    => ['#d97706', '#b45309'],
        'tar'   => ['#d97706', '#b45309'],
        'gz'    => ['#d97706', '#b45309'],
        'mp3'   => ['#9333ea', '#7e22ce'],
        'wav'   => ['#9333ea', '#7e22ce'],
        'flac'  => ['#9333ea', '#7e22ce'],
        'aac'   => ['#9333ea', '#7e22ce'],
        'ogg'   => ['#9333ea', '#7e22ce'],
        'txt'   => ['#0284c7', '#0369a1'],
        'md'    => ['#0284c7', '#0369a1'],
        'json'  => ['#0891b2', '#0e7490'],
        'xml'   => ['#0891b2', '#0e7490'],
        'html'  => ['#ea580c', '#c2410c'],
        'css'   => ['#2563eb', '#1d4ed8'],
        'js'    => ['#ca8a04', '#a16207'],
        'php'   => ['#6366f1', '#4f46e5'],
        'py'    => ['#0284c7', '#0369a1'],
        'psd'   => ['#0284c7', '#0369a1'],
        'ai'    => ['#ea580c', '#c2410c'],
    ];

    $category_defaults = [
        'video'   => ['#dc2626', '#b91c1c'],
        'audio'   => ['#9333ea', '#7e22ce'],
        'doc'     => ['#2563eb', '#1d4ed8'],
        'archive' => ['#d97706', '#b45309'],
        'other'   => ['#475569', '#334155']
    ];

    $colors = $color_map[$ext_lower] ?? ($category_defaults[$category] ?? $category_defaults['other']);
    $primary_color = $colors[0];
    $dark_color    = $colors[1];

    $ext_label = strtoupper(trim($ext));
    if ($ext_label === '') {
        $ext_label = strtoupper($category !== '' ? $category : 'FILE');
    }
    if (strlen($ext_label) > 5) {
        $ext_label = substr($ext_label, 0, 5);
    }

    // Category icon symbol
    $icon_svg = '<path d="M135 125 h90 M135 150 h90 M135 175 h60" stroke="#64748b" stroke-width="7" stroke-linecap="round" />';
    if ($category === 'audio') {
        $icon_svg = '<path d="M170 175 a22 22 0 1 0 0 -44 a22 22 0 0 0 0 44 z M192 153 V 105 h 25" fill="none" stroke="#64748b" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />';
    } elseif ($category === 'video') {
        $icon_svg = '<path d="M130 120 h70 a10 10 0 0 1 10 10 v40 a10 10 0 0 1 -10 10 h-70 a10 10 0 0 1 -10 -10 v-40 a10 10 0 0 1 10 -10 z M210 140 l35 -20 v60 l-35 -20 z" fill="#64748b" />';
    } elseif ($category === 'archive') {
        $icon_svg = '<path d="M135 115 h90 v70 h-90 z M180 115 v70 M165 145 h30" fill="none" stroke="#64748b" stroke-width="7" stroke-linecap="round" />';
    }

    echo <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360">
  <defs>
    <!-- Paper Sheet Shadow -->
    <filter id="page-shadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000000" flood-opacity="0.45" />
    </filter>
    <!-- Fold Flap Shadow -->
    <filter id="fold-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="-3" dy="4" stdDeviation="4" flood-color="#000000" flood-opacity="0.35" />
    </filter>
    <linearGradient id="banner-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{$primary_color}" />
      <stop offset="100%" stop-color="{$dark_color}" />
    </linearGradient>
    <linearGradient id="page-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#f1f5f9" />
    </linearGradient>
    <linearGradient id="flap-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#e2e8f0" />
      <stop offset="100%" stop-color="#cbd5e1" />
    </linearGradient>
    <clipPath id="sheet-clip">
      <path d="M 95,30 L 220,30 L 280,90 L 280,315 C 280,323 273,330 265,330 L 95,330 C 87,330 80,323 80,315 L 80,45 C 80,37 87,30 95,30 Z" />
    </clipPath>
  </defs>

  <!-- Background -->
  <rect width="360" height="360" fill="#0f172a" rx="16" />

  <!-- Document Sheet Body -->
  <path d="M 95,30 L 220,30 L 280,90 L 280,315 C 280,323 273,330 265,330 L 95,330 C 87,330 80,323 80,315 L 80,45 C 80,37 87,30 95,30 Z" fill="url(#page-grad)" filter="url(#page-shadow)" />

  <!-- Folded Corner Triangle Flap -->
  <path d="M 220,30 L 220,82 C 220,86 224,90 228,90 L 280,90 Z" fill="url(#flap-grad)" filter="url(#fold-shadow)" />

  <!-- Icon inside page -->
  <g transform="translate(0, 10)">
    {$icon_svg}
  </g>

  <!-- Extension Colored Bottom Banner -->
  <g clip-path="url(#sheet-clip)">
    <rect x="70" y="240" width="220" height="95" fill="url(#banner-grad)" />
    <text x="180" y="292" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="34" font-weight="900" letter-spacing="1.5" text-anchor="middle" fill="#FFFFFF">{$ext_label}</text>
  </g>
</svg>
SVG;
    exit;
}

// Binary discovery helpers imported via config.php -> functions.php -> includes/binaries.php



function generate_imagemagick_frame_thumbnail(string $file_path, string $output_file, int $thumb_w = 360, int $thumb_h = 360, int $thumb_q = 85): bool {
    // 1. Try PHP Imagick extension if loaded
    if (class_exists('Imagick')) {
        try {
            $im = new Imagick();
            $im->readImage($file_path . '[0]');
            $im->setImageFormat('jpeg');
            $im->thumbnailImage($thumb_w, $thumb_h, true);
            $im->setImageCompressionQuality($thumb_q);
            $im->writeImage($output_file);
            $im->clear();
            $im->destroy();
            if (file_exists($output_file) && filesize($output_file) > 0) {
                return true;
            }
        } catch (Throwable $e) {
            // Fallback to CLI convert
        }
    }

    // 2. Try ImageMagick CLI (convert / magick)
    $convert = find_convert_binary();
    if ($convert) {
        $cmd = sprintf(
            '%s %s[0] -thumbnail %dx%d -quality %d %s 2>&1',
            escapeshellarg($convert),
            escapeshellarg($file_path),
            (int)$thumb_w,
            (int)$thumb_h,
            (int)$thumb_q,
            escapeshellarg($output_file)
        );
        @exec($cmd);
        if (file_exists($output_file) && filesize($output_file) > 0) {
            return true;
        }
    }

    return false;
}

ensure_session_started();
\SimpleGallery\Kernel\Auth\AuthManager::revalidateActiveUser($project_root);


$requested_file = $_GET['file'] ?? '';

// Phase B: Stream & cache thumbnails for external cloud/storage mount files (`ext://<mount_id>/...`)
$ext_parsed = \SimpleGallery\Kernel\Storage\ExternalMountManager::parseExternalPath((string)$requested_file);
if ($ext_parsed !== null) {
    ensure_session_started();
    \SimpleGallery\Kernel\Auth\AuthManager::revalidateActiveUser($project_root);
    $mount_id = (int)$ext_parsed['mount_id'];
    $resolved_mount = \SimpleGallery\Kernel\Storage\ExternalMountManager::resolveMountForCurrentUser($project_root, $mount_id);
    if (!$resolved_mount) {
        http_response_code(403);
        echo "403 Forbidden: Access denied.";
        exit;
    }
    $ext_rel = (string)$ext_parsed['rel_path'];
    $ext = strtolower(pathinfo($ext_rel, PATHINFO_EXTENSION));
    if (\SimpleGallery\Kernel\Media\FormatRegistry::isForbiddenExtension($ext)) {
        http_response_code(403);
        echo "403 Forbidden: Access denied.";
        exit;
    }

    $driver = $resolved_mount['driver'];
    $is_dl = !empty($_GET['download']) || !empty($_GET['attachment']);
    $is_raw = !empty($_GET['raw']);

    // 1. Raw file stream or explicit attachment download
    if ($is_dl || $is_raw) {
        $content = null;
        $content_type = '';
        $dl_name = basename($ext_rel);
        $effective_ext = $ext;

        if (method_exists($driver, 'readContentWithMeta')) {
            $meta = $driver->readContentWithMeta($ext_rel);
            if (is_array($meta) && isset($meta['content'])) {
                $content = (string)$meta['content'];
                $content_type = (string)($meta['mime'] ?? '');
                if (!empty($meta['filename'])) $dl_name = (string)$meta['filename'];
                if (!empty($meta['extension'])) $effective_ext = strtolower((string)$meta['extension']);
            }
        } else {
            $content = $driver->readContent($ext_rel);
        }

        if ($content === null) {
            http_response_code(404);
            echo "File not found.";
            exit;
        }
        if ($content_type === '' || $content_type === 'application/octet-stream') {
            $content_type = get_full_mime_type($effective_ext);
        }
        header('Content-Type: ' . $content_type);
        header('Content-Disposition: ' . ($is_dl ? 'attachment' : 'inline') . '; filename="' . rawurlencode($dl_name) . '"');
        header('Content-Length: ' . strlen($content));
        header('Cache-Control: private, no-store, max-age=0');
        header('X-Content-Type-Options: nosniff');
        if ($effective_ext === 'svg' || stripos($content_type, 'svg') !== false) {
            header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'none';");
        }
        echo $content;
        exit;
    }

    // 2. Thumbnail mode: serve from persistent per-mount disk cache (`storage/.thumbnails/ext_cache/`)
    $ext_cache_dir = get_cache_storage_dir($real_base_dir, $thumbnail_dir ?? '.thumbnails') . '/ext_cache';
    if (!is_dir($ext_cache_dir)) {
        @mkdir($ext_cache_dir, 0755, true);
        @file_put_contents($ext_cache_dir . '/.htaccess', "Order allow,deny\nDeny from all\n");
    }

    $ver_tag = preg_replace('/[^0-9_]/', '', (string)($_GET['v'] ?? ''));
    $cache_key = sha1("ext|{$mount_id}|{$ext_rel}|{$ver_tag}|v2");

    $serve_ext_cached = function (string $path, string $mime) {
        $mtime = @filemtime($path) ?: time();
        $size = @filesize($path) ?: 0;
        $etag = '"' . md5($path . '-' . $mtime . '-' . $size) . '"';
        header('Content-Type: ' . $mime);
        header('Cache-Control: private, max-age=86400, must-revalidate');
        header('ETag: ' . $etag);
        header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
        header('X-Content-Type-Options: nosniff');
        if (stripos($mime, 'svg') !== false) {
            header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'none';");
        }
        $inm = isset($_SERVER['HTTP_IF_NONE_MATCH']) ? trim($_SERVER['HTTP_IF_NONE_MATCH']) : null;
        $ims = isset($_SERVER['HTTP_IF_MODIFIED_SINCE']) ? strtotime($_SERVER['HTTP_IF_MODIFIED_SINCE']) : null;
        if (($inm !== null && $inm === $etag) || ($ims !== null && $ims >= $mtime)) {
            http_response_code(304);
            exit;
        }
        header('Content-Length: ' . $size);
        readfile($path);
        exit;
    };

    // Instant cache hit (0 remote API calls!)
    $max_unversioned_age = 86400 * 7;
    foreach (['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'svg' => 'image/svg+xml'] as $cext => $cmime) {
        $candidate = $ext_cache_dir . '/' . $cache_key . '.' . $cext;
        if (is_file($candidate) && filesize($candidate) > 0) {
            if ($ver_tag !== '' || (time() - (int)filemtime($candidate)) < $max_unversioned_age) {
                $serve_ext_cached($candidate, $cmime);
            }
        }
    }

    // Attempt A: Driver-native pre-rendered thumbnail (e.g. Google Drive thumbnailLink for PDFs, Docs, Sheets, Videos & Images)
    if (method_exists($driver, 'fetchThumbnail')) {
        $remote_thumb = $driver->fetchThumbnail($ext_rel, max((int)($thumb_width ?? 360), 400));
        if (is_array($remote_thumb) && !empty($remote_thumb['data'])) {
            $rmime = (string)($remote_thumb['mime'] ?? 'image/jpeg');
            $rext = (stripos($rmime, 'png') !== false) ? 'png' : ((stripos($rmime, 'webp') !== false) ? 'webp' : 'jpg');
            $dest = $ext_cache_dir . '/' . $cache_key . '.' . $rext;
            @file_put_contents($dest, $remote_thumb['data'], LOCK_EX);
            if (is_file($dest) && filesize($dest) > 0) {
                $serve_ext_cached($dest, $rmime);
            }
        }
    }

    // Resolve effective extension for non-Drive mounts or Drive items without thumbnailLink
    $effective_ext = $ext;
    if ($effective_ext === '' && method_exists($driver, 'stat')) {
        $st = $driver->stat($ext_rel);
        if (is_array($st) && !empty($st['mime'])) {
            $effective_ext = \SimpleGallery\Kernel\Storage\GoogleDriveStorageDriver::inferExtensionFromMime((string)$st['mime']);
        }
    }
    $is_ext_image = in_array($effective_ext, $media_types['image'] ?? [], true);

    // Attempt B: Resize remote image once with GD and cache to disk
    if ($is_ext_image) {
        $raw_img = $driver->readContent($ext_rel);
        if ($raw_img !== null && $raw_img !== '') {
            if ($effective_ext === 'svg') {
                $dest = $ext_cache_dir . '/' . $cache_key . '.svg';
                @file_put_contents($dest, $raw_img, LOCK_EX);
                if (is_file($dest) && filesize($dest) > 0) {
                    $serve_ext_cached($dest, 'image/svg+xml');
                }
            }
            if (function_exists('imagecreatefromstring')) {
                $src_im = @imagecreatefromstring($raw_img);
                if ($src_im !== false) {
                    $ow = imagesx($src_im);
                    $oh = imagesy($src_im);
                    $tw = max(120, (int)($thumb_width ?? 360));
                    $th = max(120, (int)($thumb_height ?? 360));
                    $ratio = ($ow > 0 && $oh > 0) ? min($tw / $ow, $th / $oh, 1.0) : 1.0;
                    $nw = max(1, (int)round($ow * $ratio));
                    $nh = max(1, (int)round($oh * $ratio));
                    $dst_im = imagecreatetruecolor($nw, $nh);
                    $white = imagecolorallocate($dst_im, 255, 255, 255);
                    imagefill($dst_im, 0, 0, $white);
                    imagecopyresampled($dst_im, $src_im, 0, 0, 0, 0, $nw, $nh, $ow, $oh);
                    $dest = $ext_cache_dir . '/' . $cache_key . '.jpg';
                    @imagejpeg($dst_im, $dest, (int)($thumb_quality ?? 85));
                    imagedestroy($src_im);
                    imagedestroy($dst_im);
                    if (is_file($dest) && filesize($dest) > 0) {
                        $serve_ext_cached($dest, 'image/jpeg');
                    }
                }
            }
            // Fallback: cache original image bytes
            $fallback_ext = ($effective_ext === 'png') ? 'png' : (($effective_ext === 'webp') ? 'webp' : 'jpg');
            $dest = $ext_cache_dir . '/' . $cache_key . '.' . $fallback_ext;
            @file_put_contents($dest, $raw_img, LOCK_EX);
            if (is_file($dest) && filesize($dest) > 0) {
                $serve_ext_cached($dest, get_full_mime_type($effective_ext));
            }
        }
    }

    // Attempt C: Render page 0 of remote PDF via Imagick / ImageMagick if available
    if ($effective_ext === 'pdf' && (class_exists('Imagick') || find_convert_binary())) {
        $pdf_bytes = $driver->readContent($ext_rel);
        if ($pdf_bytes !== null && strlen($pdf_bytes) > 0 && strlen($pdf_bytes) <= 25 * 1024 * 1024) {
            $tmp_pdf = $ext_cache_dir . '/tmp_' . $cache_key . '.pdf';
            $dest = $ext_cache_dir . '/' . $cache_key . '.jpg';
            @file_put_contents($tmp_pdf, $pdf_bytes, LOCK_EX);
            $ok = generate_imagemagick_frame_thumbnail($tmp_pdf, $dest, (int)($thumb_width ?? 360), (int)($thumb_height ?? 360), (int)($thumb_quality ?? 85));
            @unlink($tmp_pdf);
            if ($ok && is_file($dest) && filesize($dest) > 0) {
                $serve_ext_cached($dest, 'image/jpeg');
            }
        }
    }

    // Attempt D: Crisp color-coded SVG placeholder icon (never dump raw PDF/Office/MP4 bytes into <img>!)
    $ext_cat = get_media_category($effective_ext, $media_types);
    render_svg_placeholder($ext_cat, $effective_ext, basename($ext_rel));
}

$file_path = sanitize_file_path($requested_file, $real_base_dir);

if (!$file_path || is_path_ignored($file_path, $real_base_dir, $ignore_list)) {
    http_response_code(404);
    echo "File not found.";
    exit;
}

$ext = strtolower(pathinfo($file_path, PATHINFO_EXTENSION));
$forbidden_system_exts = ['php', 'phtml', 'php3', 'php4', 'php5', 'phps', 'phar', 'inc', 'htaccess', 'htpasswd', 'sh', 'bat', 'cmd', 'exe', 'dll', 'py', 'pl', 'cgi', 'hash', 'ini'];
if (in_array($ext, $forbidden_system_exts, true)) {
    http_response_code(403);
    echo "403 Forbidden: Access denied.";
    exit;
}

if (!is_dir_accessible(dirname($file_path), $real_base_dir)) {
    http_response_code(403);
    echo "403 Forbidden: Access denied.";
    exit;
}

// Determine whether the file lives inside a .private or .password-protected subtree
// so proxies/CDNs never publicly cache restricted media or thumbnails (SEC-10)
$effective_access = \SimpleGallery\Kernel\FS\DotfileManager::getEffectiveAccessInfo(dirname($file_path), $real_base_dir);
$is_restricted = !empty($effective_access['requires_auth']);

// Direct original raw media delivery: Inline View/Stream (raw=1) vs Attachment Download (download=1)
$is_download_req = !empty($_GET['download']) || !empty($_GET['attachment']);
$is_raw_req = !empty($_GET['raw']);

if ($is_download_req || $is_raw_req) {
    // Check if direct download (saving as attachment) is permitted
    $can_download = false;
    if (\SimpleGallery\Kernel\Auth\AuthManager::isAdminLoggedIn()) {
        $can_download = true;
    } else {
        $allow_cfg = isset($allow_direct_download) ? (bool)$allow_direct_download : true;
        $rel_for_perm = \SimpleGallery\Kernel\Security\PathValidator::getRelativePath($file_path, $real_base_dir);
        $can_perm = \SimpleGallery\Kernel\FS\PermissionsManager::hasPermission('can_download_item', $real_base_dir, $rel_for_perm);
        $can_download = ($allow_cfg && $can_perm);
    }

    // Direct download (attachment) explicitly requested: enforce permission
    if ($is_download_req && !$can_download) {
        http_response_code(403);
        echo "403 Forbidden: Direct download is restricted.";
        exit;
    }

    // Serve raw media: as attachment if downloading, or inline if streaming/viewing
    serve_raw_file($file_path, $ext, $is_download_req, $is_restricted);
}

// Setup thumbnail cache directory with fallback to sys_get_temp_dir()
$cache_dir = get_cache_storage_dir($real_base_dir, $thumbnail_dir ?? '.thumbnails');

// -------------------------------------------------------------
// 1. VIDEO THUMBNAIL HANDLING (5-Stage Extraction Chain)
// -------------------------------------------------------------
$is_video = in_array($ext, $media_types['video'], true);

if ($is_video) {
    $video_cache_key = md5($file_path . '_' . filesize($file_path) . '_' . filemtime($file_path) . '_vthumb');
    $video_cache_file = $cache_dir . '/' . $video_cache_key . '.jpg';

    // Serve cached video poster if present
    if (file_exists($video_cache_file) && filesize($video_cache_file) > 0 && filemtime($video_cache_file) >= filemtime($file_path)) {
        send_cached_file($video_cache_file, 'image/jpeg', 31536000, $is_restricted);
    }

    // Attempt 1: Fast pure PHP parser to extract embedded JPEG metadata thumbnail (Android/iOS MP4/MOV)
    if (extract_mp4_embedded_jpeg($file_path, $video_cache_file)) {
        send_cached_file($video_cache_file, 'image/jpeg', 31536000, $is_restricted);
    }

    // Attempt 2: ExifTool CLI (Extract embedded Preview/Thumbnail metadata)
    $exiftool = find_exiftool_binary();
    if ($exiftool) {
        $null_dev = (PHP_OS_FAMILY === 'Windows') ? 'NUL' : '/dev/null';
        $cmd_exif1 = sprintf(
            '%s -b -ThumbnailImage %s > %s 2>%s',
            escapeshellarg($exiftool),
            escapeshellarg($file_path),
            escapeshellarg($video_cache_file),
            $null_dev
        );
        @exec($cmd_exif1);
        if (!file_exists($video_cache_file) || filesize($video_cache_file) === 0) {
            $cmd_exif2 = sprintf(
                '%s -b -PreviewImage %s > %s 2>%s',
                escapeshellarg($exiftool),
                escapeshellarg($file_path),
                escapeshellarg($video_cache_file),
                $null_dev
            );
            @exec($cmd_exif2);
        }
        if (file_exists($video_cache_file) && filesize($video_cache_file) > 1000) {
            send_cached_file($video_cache_file, 'image/jpeg', 31536000, $is_restricted);
        }
    }

    // Attempt 3: Try FFmpeg frame extraction
    $ffmpeg = find_ffmpeg_binary();
    if ($ffmpeg) {
        $cmd1 = sprintf(
            '%s -y -ss 00:00:01 -i %s -vframes 1 -f image2 -pix_fmt yuv420p -q:v 3 -vf "scale=360:-2" %s 2>&1',
            escapeshellarg($ffmpeg),
            escapeshellarg($file_path),
            escapeshellarg($video_cache_file)
        );
        @exec($cmd1);

        if (!file_exists($video_cache_file) || filesize($video_cache_file) === 0) {
            $cmd2 = sprintf(
                '%s -y -i %s -ss 00:00:00.5 -vframes 1 -f image2 -pix_fmt yuv420p -q:v 3 -vf "scale=360:-2" %s 2>&1',
                escapeshellarg($ffmpeg),
                escapeshellarg($file_path),
                escapeshellarg($video_cache_file)
            );
            @exec($cmd2);
        }

        if (file_exists($video_cache_file) && filesize($video_cache_file) > 0) {
            send_cached_file($video_cache_file, 'image/jpeg', 31536000, $is_restricted);
        }
    }

    // Attempt 4: ImageMagick (Imagick extension or convert CLI for IONOS / shared hosting)
    if (generate_imagemagick_frame_thumbnail($file_path, $video_cache_file, $thumb_width, $thumb_height, $thumb_quality)) {
        send_cached_file($video_cache_file, 'image/jpeg', 31536000, $is_restricted);
    }

    // Fallback if none of the above are available or supported
    render_svg_placeholder('video', $ext, $file_path);
}

// -------------------------------------------------------------
// 2. PDF DOCUMENT THUMBNAIL HANDLING (via ImageMagick)
// -------------------------------------------------------------
if ($ext === 'pdf') {
    $pdf_cache_key = md5($file_path . '_' . filesize($file_path) . '_' . filemtime($file_path) . '_pdfthumb');
    $pdf_cache_file = $cache_dir . '/' . $pdf_cache_key . '.jpg';

    if (file_exists($pdf_cache_file) && filesize($pdf_cache_file) > 0 && filemtime($pdf_cache_file) >= filemtime($file_path)) {
        send_cached_file($pdf_cache_file, 'image/jpeg', 31536000, $is_restricted);
    }

    if (generate_imagemagick_frame_thumbnail($file_path, $pdf_cache_file, $thumb_width, $thumb_height, $thumb_quality)) {
        send_cached_file($pdf_cache_file, 'image/jpeg', 31536000, $is_restricted);
    }
}

// -------------------------------------------------------------
// 2. IMAGE THUMBNAIL HANDLING (GD or Direct Stream Fallback)
// -------------------------------------------------------------
$is_image = in_array($ext, $media_types['image'], true);

if ($is_image) {
    // SVGs serve directly
    if ($ext === 'svg') {
        serve_direct_file($file_path, 'svg', $is_restricted);
    }

    // If GD extension is not loaded in PHP, fall back to direct file stream immediately!
    if (!function_exists('imagecreatefromjpeg') && !function_exists('imagecreatefrompng')) {
        serve_direct_file($file_path, $ext, $is_restricted);
    }

    // GD processing
    $cache_key = md5($file_path . '_' . filesize($file_path) . '_' . filemtime($file_path) . '_' . $thumb_width . 'x' . $thumb_height . '_v2');
    $cache_file_webp = $cache_dir . '/' . $cache_key . '.webp';
    $cache_file_jpg  = $cache_dir . '/' . $cache_key . '.jpg';

    if (file_exists($cache_file_webp) && filemtime($cache_file_webp) >= filemtime($file_path)) {
        send_cached_file($cache_file_webp, 'image/webp', 31536000, $is_restricted);
    }

    if (file_exists($cache_file_jpg) && filemtime($cache_file_jpg) >= filemtime($file_path)) {
        send_cached_file($cache_file_jpg, 'image/jpeg', 31536000, $is_restricted);
    }

    // Attempt GD image loading
    $src_img = false;
    switch ($ext) {
        case 'jpg':
        case 'jpeg':
            if (function_exists('imagecreatefromjpeg')) $src_img = @imagecreatefromjpeg($file_path);
            break;
        case 'png':
            if (function_exists('imagecreatefrompng')) $src_img = @imagecreatefrompng($file_path);
            break;
        case 'gif':
            if (function_exists('imagecreatefromgif')) $src_img = @imagecreatefromgif($file_path);
            break;
        case 'webp':
            if (function_exists('imagecreatefromwebp')) $src_img = @imagecreatefromwebp($file_path);
            break;
        case 'avif':
            if (function_exists('imagecreatefromavif')) $src_img = @imagecreatefromavif($file_path);
            break;
        case 'bmp':
            if (function_exists('imagecreatefrombmp')) $src_img = @imagecreatefrombmp($file_path);
            break;
    }

    // If GD loading failed, serve original image file directly!
    if (!$src_img) {
        serve_direct_file($file_path, $ext, $is_restricted);
    }

    // Auto-rotate image according to EXIF orientation metadata (JPEG / TIFF)
    if (in_array($ext, ['jpg', 'jpeg', 'tif', 'tiff'], true)) {
        $exif = function_exists('exif_read_data') ? @exif_read_data($file_path) : parse_exif_app1_pure_php($file_path);
        if (!empty($exif['Orientation'])) {
            $orientation = (int)$exif['Orientation'];
            switch ($orientation) {
                case 2:
                    if (function_exists('imageflip')) @imageflip($src_img, IMG_FLIP_HORIZONTAL);
                    break;
                case 3:
                    $rotated = @imagerotate($src_img, 180, 0);
                    if ($rotated !== false) {
                        imagedestroy($src_img);
                        $src_img = $rotated;
                    }
                    break;
                case 4:
                    if (function_exists('imageflip')) @imageflip($src_img, IMG_FLIP_VERTICAL);
                    break;
                case 5:
                    $rotated = @imagerotate($src_img, 270, 0);
                    if ($rotated !== false) {
                        imagedestroy($src_img);
                        $src_img = $rotated;
                        if (function_exists('imageflip')) @imageflip($src_img, IMG_FLIP_HORIZONTAL);
                    }
                    break;
                case 6:
                    $rotated = @imagerotate($src_img, 270, 0); // 270 deg CCW = 90 deg CW
                    if ($rotated !== false) {
                        imagedestroy($src_img);
                        $src_img = $rotated;
                    }
                    break;
                case 7:
                    $rotated = @imagerotate($src_img, 90, 0);
                    if ($rotated !== false) {
                        imagedestroy($src_img);
                        $src_img = $rotated;
                        if (function_exists('imageflip')) @imageflip($src_img, IMG_FLIP_HORIZONTAL);
                    }
                    break;
                case 8:
                    $rotated = @imagerotate($src_img, 90, 0); // 90 deg CCW = 270 deg CW
                    if ($rotated !== false) {
                        imagedestroy($src_img);
                        $src_img = $rotated;
                    }
                    break;
            }
        }
    }

    $orig_w = imagesx($src_img);
    $orig_h = imagesy($src_img);

    if ($orig_w <= 0 || $orig_h <= 0) {
        imagedestroy($src_img);
        serve_direct_file($file_path, $ext, $is_restricted);
    }

    // Calculate aspect ratio scale
    $ratio = min($thumb_width / $orig_w, $thumb_height / $orig_h);
    $new_w = (int)max(1, round($orig_w * $ratio));
    $new_h = (int)max(1, round($orig_h * $ratio));

    $thumb_img = imagecreatetruecolor($new_w, $new_h);

    if (in_array($ext, ['png', 'gif', 'webp'], true)) {
        imagealphablending($thumb_img, false);
        imagesavealpha($thumb_img, true);
        $transparent = imagecolorallocatealpha($thumb_img, 255, 255, 255, 127);
        imagefilledrectangle($thumb_img, 0, 0, $new_w, $new_h, $transparent);
    }

    imagecopyresampled($thumb_img, $src_img, 0, 0, 0, 0, $new_w, $new_h, $orig_w, $orig_h);

    if (function_exists('imagewebp')) {
        @imagewebp($thumb_img, $cache_file_webp, $thumb_quality);
        imagedestroy($src_img);
        imagedestroy($thumb_img);

        if (file_exists($cache_file_webp)) {
            send_cached_file($cache_file_webp, 'image/webp', 31536000, $is_restricted);
        }
    } else {
        @imagejpeg($thumb_img, $cache_file_jpg, $thumb_quality);
        imagedestroy($src_img);
        imagedestroy($thumb_img);

        if (file_exists($cache_file_jpg)) {
            send_cached_file($cache_file_jpg, 'image/jpeg', 31536000, $is_restricted);
        }
    }

    // Ultimate fallback if saving failed
    serve_direct_file($file_path, $ext, $is_restricted);
}

// -------------------------------------------------------------
// 3. OTHER MEDIA (Audio, Docs, Archives)
// -------------------------------------------------------------
$category = 'other';
foreach ($media_types as $cat => $extensions) {
    if (in_array($ext, $extensions, true)) {
        $category = $cat;
        break;
    }
}
render_svg_placeholder($category, $ext, $file_path);
