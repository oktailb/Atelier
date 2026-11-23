<?php
namespace SimpleGallery\Apps\Tribune\Backend;

use SimpleGallery\Kernel\Auth\AuthManager;
use SimpleGallery\Kernel\FS\PermissionsManager;
use SimpleGallery\Kernel\Security\RateLimiter;

/**
 * Tribune Temporary File Upload & Hardened Delivery Controller
 * Enforces strict extension+MIME whitelist, auth/rate-limit gates, TTL pruning,
 * and CSP sandbox + nosniff headers to eliminate same-origin Stored XSS.
 */
class TribuneUploadController {

    public const MAX_UPLOAD_BYTES = 10485760; // 10 MB

    private const ALLOWED_UPLOAD_MIMES = [
        // Safe raster images (eligible for inline display with strict CSP sandbox)
        'jpg'  => ['image/jpeg'],
        'jpeg' => ['image/jpeg'],
        'png'  => ['image/png'],
        'gif'  => ['image/gif'],
        'webp' => ['image/webp'],
        'avif' => ['image/avif'],
        // Safe media, documents & archives (always served as attachment)
        'mp4'  => ['video/mp4', 'application/octet-stream'],
        'webm' => ['video/webm', 'audio/webm'],
        'mp3'  => ['audio/mpeg', 'application/octet-stream'],
        'wav'  => ['audio/wav', 'audio/x-wav'],
        'ogg'  => ['audio/ogg', 'video/ogg', 'application/ogg'],
        'pdf'  => ['application/pdf'],
        'txt'  => ['text/plain'],
        'md'   => ['text/plain', 'text/markdown'],
        'zip'  => ['application/zip', 'application/x-zip-compressed'],
        'tar'  => ['application/x-tar'],
        'gz'   => ['application/gzip', 'application/x-gzip'],
        '7z'   => ['application/x-7z-compressed']
    ];

    private const INLINE_SAFE_MIMES = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/avif'
    ];

    /**
     * Validates a Tribune upload filename, detected MIME type and byte size against strict whitelist rules.
     * @return array{valid: bool, error?: string, ext?: string, safe_mime?: string}
     */
    public static function validateUpload(string $orig_name, string $detected_mime, int $size, ?int $max_bytes = null): array {
        $limit = $max_bytes ?? self::MAX_UPLOAD_BYTES;
        if ($size <= 0 || $size > $limit) {
            $max_mb = round($limit / (1024 * 1024), 1);
            return ['valid' => false, 'error' => "Le fichier dépasse la taille maximale autorisée ({$max_mb} Mo) ou est vide."];
        }

        $clean_name = basename(str_replace('\\', '/', $orig_name));
        if ($clean_name === '' || $clean_name[0] === '.') {
            return ['valid' => false, 'error' => 'Nom de fichier masqué ou invalide interdit.'];
        }

        if (preg_match('/\.(php|phtml|php\d|phps|phar|inc|pl|py|cgi|sh|exe|bat|cmd|html|htm|xhtml|svg|js|mjs)\./i', $clean_name)) {
            return ['valid' => false, 'error' => 'Double extension suspecte interdite pour des raisons de sécurité.'];
        }

        $ext = strtolower(pathinfo($clean_name, PATHINFO_EXTENSION));
        if ($ext === '' || !isset(self::ALLOWED_UPLOAD_MIMES[$ext])) {
            return ['valid' => false, 'error' => "Type de fichier '.{$ext}' non autorisé sur la tribune."];
        }

        $mime_base = strtolower(trim(explode(';', $detected_mime)[0] ?? ''));
        $dangerous_mimes = ['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml', 'application/xml', 'text/javascript', 'application/javascript', 'application/x-httpd-php', 'text/x-php'];
        if (in_array($mime_base, $dangerous_mimes, true)) {
            return ['valid' => false, 'error' => 'Contenu actif (HTML/SVG/XML/Script) strictement interdit.'];
        }

        $allowed_mimes = self::ALLOWED_UPLOAD_MIMES[$ext];
        if (!in_array($mime_base, $allowed_mimes, true)) {
            return ['valid' => false, 'error' => "Incohérence entre l'extension '.{$ext}' et le type MIME détecté ({$mime_base})."];
        }

        return [
            'valid'     => true,
            'ext'       => $ext,
            'safe_mime' => $allowed_mimes[0]
        ];
    }

    /**
     * Computes hardened HTTP response headers for tribune_file_get.
     */
    public static function getFileResponseHeaders(string $ext, string $stored_mime, string $orig_name): array {
        $ext_lower = strtolower($ext);
        $mime_base = strtolower(trim(explode(';', $stored_mime)[0] ?? ''));

        $allowed_for_ext = self::ALLOWED_UPLOAD_MIMES[$ext_lower] ?? null;
        if ($allowed_for_ext !== null && in_array($mime_base, $allowed_for_ext, true)) {
            $safe_mime = $allowed_for_ext[0];
        } else {
            $safe_mime = 'application/octet-stream';
        }

        $is_inline_safe = in_array($safe_mime, self::INLINE_SAFE_MIMES, true);
        $disposition = $is_inline_safe ? 'inline' : 'attachment';
        $safe_filename = rawurlencode(basename(str_replace(["\r", "\n", "\0", '\\'], '', $orig_name)));

        return [
            'Content-Type'            => $safe_mime,
            'Content-Disposition'     => "{$disposition}; filename=\"{$safe_filename}\"",
            'X-Content-Type-Options'  => 'nosniff',
            'Content-Security-Policy' => "sandbox; default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none';",
            'Referrer-Policy'         => 'no-referrer',
            'Cache-Control'           => 'private, max-age=86400'
        ];
    }

    /**
     * Prunes temporary Tribune uploads older than $ttl_seconds (default 24h).
     */
    public static function pruneExpiredUploads(string $upload_dir, int $ttl_seconds = 86400): void {
        if (!is_dir($upload_dir)) return;
        $now = time();
        $entries = @scandir($upload_dir) ?: [];
        foreach ($entries as $entry) {
            if ($entry[0] === '.' || substr($entry, -5) !== '.json') continue;
            $meta_path = $upload_dir . '/' . $entry;
            $mtime = @filemtime($meta_path);
            if ($mtime !== false && ($now - $mtime) > $ttl_seconds) {
                $token = substr($entry, 0, -5);
                @unlink($meta_path);
                @unlink($upload_dir . '/' . $token . '.bin');
            }
        }
    }

    public static function handleUpload(string $base_dir, string $storage_dir): array {
        $project_root = dirname(dirname(dirname(__DIR__)));
        $is_authorized = AuthManager::isAdminLoggedIn()
            || PermissionsManager::hasPermission('can_upload', $project_root)
            || PermissionsManager::hasPermission('can_upload', $base_dir);

        if (!$is_authorized) {
            return ['status' => 403, 'data' => ['success' => false, 'error' => 'Accès refusé : le téléversement de fichiers sur la tribune requiert la permission d\'upload ou une connexion administrateur.']];
        }

        global $rate_limits;
        $max_attempts = (int)($rate_limits['tribune_upload']['max_attempts'] ?? 15);
        $decay_seconds = (int)($rate_limits['tribune_upload']['decay_seconds'] ?? 60);
        $rl_key = 'tribune_upload_' . RateLimiter::getClientIp();
        if (!RateLimiter::check($rl_key, $max_attempts, $decay_seconds)) {
            return ['status' => 429, 'data' => ['success' => false, 'error' => 'Trop de téléversements récents. Veuillez patienter avant de réessayer.']];
        }
        RateLimiter::increment($rl_key);

        if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
            return ['status' => 400, 'data' => ['success' => false, 'error' => 'Aucun fichier valide n\'a été transmis ou erreur lors du téléversement.']];
        }

        $file = $_FILES['file'];
        $orig_name = basename(str_replace('\\', '/', (string)$file['name']));

        $mime_type = 'application/octet-stream';
        if (function_exists('finfo_open')) {
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            if ($finfo) {
                $detected = finfo_file($finfo, $file['tmp_name']);
                if ($detected) $mime_type = $detected;
                finfo_close($finfo);
            }
        } elseif (function_exists('mime_content_type')) {
            $detected = @mime_content_type($file['tmp_name']);
            if ($detected) $mime_type = $detected;
        }

        $validation = self::validateUpload($orig_name, $mime_type, (int)($file['size'] ?? 0));
        if (empty($validation['valid'])) {
            return ['status' => 400, 'data' => ['success' => false, 'error' => $validation['error'] ?? 'Fichier refusé pour des raisons de sécurité.']];
        }

        $ext = $validation['ext'];
        $safe_mime = $validation['safe_mime'];

        $upload_dir = $storage_dir . '/tribune_uploads';
        if (!is_dir($upload_dir)) @mkdir($upload_dir, 0755, true);
        self::pruneExpiredUploads($upload_dir, 86400);

        $token = bin2hex(random_bytes(16));
        $bin_path = $upload_dir . '/' . $token . '.bin';
        $meta_path = $upload_dir . '/' . $token . '.json';

        if (!move_uploaded_file($file['tmp_name'], $bin_path)) {
            return ['status' => 500, 'data' => ['success' => false, 'error' => 'Échec de l\'enregistrement du fichier temporaire sur le serveur.']];
        }
        @chmod($bin_path, 0644);

        $meta_data = [
            'token'         => $token,
            'original_name' => $orig_name,
            'mime_type'     => $safe_mime,
            'size'          => (int)$file['size'],
            'uploaded_at'   => time(),
            'ext'           => $ext
        ];

        @file_put_contents($meta_path, json_encode($meta_data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);

        return ['status' => 200, 'data' => [
            'success'       => true,
            'token'         => $token,
            'original_name' => $orig_name,
            'size'          => (int)$file['size'],
            'mime_type'     => $safe_mime,
            'url'           => 'system/endpoints/api.php?action=tribune_file_get&token=' . $token
        ]];
    }

    public static function handleFileGet(array $raw_body, string $storage_dir): void {
        @session_write_close();
        $token = trim($_GET['token'] ?? $raw_body['token'] ?? '');
        $token = preg_replace('/[^a-f0-9]/i', '', $token);

        if (empty($token) || strlen($token) !== 32) {
            http_response_code(400);
            echo "Jeton de fichier invalide.";
            exit;
        }

        $upload_dir = $storage_dir . '/tribune_uploads';
        $bin_path = $upload_dir . '/' . $token . '.bin';
        $meta_path = $upload_dir . '/' . $token . '.json';

        if (!file_exists($bin_path) || !file_exists($meta_path)) {
            http_response_code(404);
            echo "Fichier temporaire introuvable ou expiré.";
            exit;
        }

        $meta = @json_decode(@file_get_contents($meta_path), true) ?: [];
        $stored_mime = (string)($meta['mime_type'] ?? 'application/octet-stream');
        $orig_name = (string)($meta['original_name'] ?? ('tribune_' . $token . '.bin'));
        $ext = (string)($meta['ext'] ?? pathinfo($orig_name, PATHINFO_EXTENSION));

        $headers = self::getFileResponseHeaders($ext, $stored_mime, $orig_name);
        foreach ($headers as $h_name => $h_val) {
            header("{$h_name}: {$h_val}");
        }
        header('Content-Length: ' . filesize($bin_path));

        readfile($bin_path);
        exit;
    }
}
