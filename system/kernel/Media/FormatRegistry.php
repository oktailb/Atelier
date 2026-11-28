<?php
namespace Atelier\Kernel\Media;

use Atelier\Kernel\PluginDiscovery;

/**
 * Centralized Format & MIME Registry (Single Source of Truth)
 *
 * Dynamically aggregates supported file formats, MIME mappings, media categories,
 * and upload whitelists from:
 *   1. Core baseline formats (`config/mime_types.php`)
 *   2. Active native applications (`apps/<app>/manifest.json`)
 *   3. Active standalone/external web/WASM apps (`StandaloneWebAppManifestSynthesizer` + `config/external_apps.json`)
 *   4. Optional administrator overrides (`config/formats.json`)
 *
 * Security invariant: `FORBIDDEN_UPLOAD_EXTENSIONS` is strictly immutable and ALWAYS
 * enforced for uploads & saves, even if a viewer app declares those extensions for read-only display.
 */
class FormatRegistry {

    /**
     * Immutable security blacklist: extensions that can NEVER be uploaded or written
     * as user content, regardless of any app manifest or configuration override.
     */
    public const FORBIDDEN_UPLOAD_EXTENSIONS = [
        // Server-side executable scripts
        'php', 'phtml', 'php3', 'php4', 'php5', 'php7', 'php8', 'phps', 'phar', 'inc', 'pht', 'shtml',
        'asp', 'aspx', 'jsp', 'jspx', 'war', 'cgi', 'pl', 'py', 'rb',
        // Active web / XSS vectors
        'js', 'mjs', 'cjs', 'css', 'html', 'htm', 'xhtml',
        // Server / environment config files
        'htaccess', 'htpasswd', 'env',
        // OS scripts & native executables
        'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'vbs', 'wsf',
        'exe', 'msi', 'dll', 'so', 'dylib', 'com', 'scr'
    ];

    /**
     * Regex detecting dangerous double extensions (e.g. `payload.php.jpg`, `script.exe.png`).
     */
    public const FORBIDDEN_DOUBLE_EXT_REGEX = '/\.(php|phtml|php3|php4|php5|php7|php8|phps|phar|inc|pl|py|rb|cgi|sh|exe|bat|cmd|ps1|vbs|dll|msi)\./i';

    /**
     * Canonical extension -> MIME type dictionary shared across Kernel, Thumbnails,
     * StandaloneWebAppManifestSynthesizer, and Frontend FilePickerService.
     */
    public const STANDARD_MIME_MAP = [
        // Raster, layered & vector graphics
        'jpg'      => 'image/jpeg',
        'jpeg'     => 'image/jpeg',
        'png'      => 'image/png',
        'gif'      => 'image/gif',
        'webp'     => 'image/webp',
        'avif'     => 'image/avif',
        'bmp'      => 'image/bmp',
        'svg'      => 'image/svg+xml',
        'ico'      => 'image/x-icon',
        'heic'     => 'image/heic',
        'heif'     => 'image/heif',
        'tif'      => 'image/tiff',
        'tiff'     => 'image/tiff',
        'tga'      => 'image/x-tga',
        'qoi'      => 'image/qoi',
        'pnm'      => 'image/x-portable-anymap',
        'exr'      => 'image/x-exr',
        'hdr'      => 'image/vnd.radiance',
        'fits'     => 'image/fits',
        'dng'      => 'image/x-adobe-dng',
        'psd'      => 'image/vnd.adobe.photoshop',
        'psb'      => 'image/vnd.adobe.photoshop',
        'xcf'      => 'image/x-xcf',
        'kra'      => 'application/x-krita',
        'ora'      => 'image/openraster',
        'pdn'      => 'image/x-paintnet',
        'pcraft'   => 'application/x-photocraft',
        'af'       => 'application/x-affinity',
        'afphoto'  => 'application/x-affinity-photo',
        'afdesign' => 'application/x-affinity-designer',
        'afpub'    => 'application/x-affinity-publisher',
        'eps'      => 'application/postscript',
        'ai'       => 'application/postscript',
        // Video
        'mp4'      => 'video/mp4',
        'm4v'      => 'video/mp4',
        'webm'     => 'video/webm',
        'ogv'      => 'video/ogg',
        'mov'      => 'video/quicktime',
        'mkv'      => 'video/x-matroska',
        'avi'      => 'video/x-msvideo',
        'fcraft'   => 'application/x-filmcraft',
        // Video Wall
        'vwall'     => 'application/json',
        'videowall' => 'application/json',
        // Audio
        'mp3'      => 'audio/mpeg',
        'wav'      => 'audio/wav',
        'ogg'      => 'audio/ogg',
        'opus'     => 'audio/opus',
        'm4a'      => 'audio/mp4',
        'flac'     => 'audio/flac',
        'aac'      => 'audio/aac',
        'wma'      => 'audio/x-ms-wma',
        'mid'      => 'audio/midi',
        'midi'     => 'audio/midi',
        // Documents, Office & OpenDocument
        'pdf'      => 'application/pdf',
        'epub'     => 'application/epub+zip',
        'txt'      => 'text/plain',
        'log'      => 'text/plain',
        'md'       => 'text/markdown',
        'markdown' => 'text/markdown',
        'rtf'      => 'application/rtf',
        'csv'      => 'text/csv',
        'tsv'      => 'text/tab-separated-values',
        'json'     => 'application/json',
        'xml'      => 'application/xml',
        'yaml'     => 'text/yaml',
        'yml'      => 'text/yaml',
        'tex'      => 'application/x-tex',
        'latex'    => 'application/x-latex',
        'doc'      => 'application/msword',
        'docx'     => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls'      => 'application/vnd.ms-excel',
        'xlsx'     => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ppt'      => 'application/vnd.ms-powerpoint',
        'pptx'     => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'odt'      => 'application/vnd.oasis.opendocument.text',
        'ods'      => 'application/vnd.oasis.opendocument.spreadsheet',
        'odp'      => 'application/vnd.oasis.opendocument.presentation',
        'odg'      => 'application/vnd.oasis.opendocument.graphics',
        'wcraft'   => 'application/x-wordcraft',
        'pages'    => 'application/vnd.apple.pages',
        'numbers'  => 'application/vnd.apple.numbers',
        'key'      => 'application/vnd.apple.keynote',
        // Archives
        'zip'      => 'application/zip',
        'tar'      => 'application/x-tar',
        'tgz'      => 'application/gzip',
        'gz'       => 'application/gzip',
        'bz2'      => 'application/x-bzip2',
        'xz'       => 'application/x-xz',
        'rar'      => 'application/vnd.rar',
        '7z'       => 'application/x-7z-compressed',
        // 3D & CAD
        'obj'      => 'model/obj',
        'stl'      => 'model/stl',
        'gltf'     => 'model/gltf+json',
        'glb'      => 'model/gltf-binary',
        'dxf'      => 'image/vnd.dxf',
        // Retro ROMs
        'nes'      => 'application/x-nes-rom',
        'gb'       => 'application/x-gameboy-rom',
        'gbc'      => 'application/x-gameboy-color-rom',
        'gba'      => 'application/x-gba-rom',
        'wad'      => 'application/x-doom'
    ];

    /**
     * Text-based extensions served with `; charset=utf-8` HTTP Content-Type.
     */
    private const UTF8_TEXT_EXTENSIONS = [
        'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'yaml', 'yml', 'tex', 'latex'
    ];

    /**
     * Built-in core baseline media categories (ensures gallery works even with zero plugins).
     */
    private const CORE_BASELINE_MEDIA_TYPES = [
        'image'     => ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico', 'heic', 'heif', 'tif', 'tiff'],
        'video'     => ['mp4', 'm4v', 'webm', 'ogv', 'mov', 'mkv', 'avi'],
        'audio'     => ['mp3', 'wav', 'ogg', 'opus', 'm4a', 'flac', 'aac'],
        'doc'       => ['pdf', 'txt', 'md', 'markdown', 'csv', 'rtf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'odg'],
        'archive'   => ['zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z'],
        'videowall' => ['vwall', 'videowall']
    ];

    /**
     * Per-request cache keyed by project root + base hash.
     * @var array<string, array>
     */
    private static array $cache = [];

    /**
     * Clears the in-memory cache (useful for unit tests or after toggling apps).
     */
    public static function clearCache(): void {
        self::$cache = [];
    }

    /**
     * Returns the canonical extension -> MIME dictionary (no disk I/O, safe for synthesizer).
     */
    public static function getStandardMimeMap(): array {
        return self::STANDARD_MIME_MAP;
    }

    /**
     * Checks whether an extension is strictly forbidden for upload / write.
     */
    public static function isForbiddenExtension(string $ext): bool {
        $clean = self::normalizeExtension($ext);
        if ($clean === '') {
            return true;
        }
        return in_array($clean, self::FORBIDDEN_UPLOAD_EXTENSIONS, true);
    }

    /**
     * Checks whether a filename contains a dangerous double extension (e.g. `shell.php.jpg`).
     */
    public static function hasForbiddenDoubleExtension(string $filename): bool {
        return preg_match(self::FORBIDDEN_DOUBLE_EXT_REGEX, $filename) === 1;
    }

    /**
     * Normalizes an extension string (`".ODT "` -> `"odt"`). Returns `""` if invalid.
     */
    public static function normalizeExtension(string $ext): string {
        $clean = ltrim(strtolower(trim($ext)), '.');
        if ($clean === '' || !preg_match('/^[a-z0-9]{1,16}$/', $clean)) {
            return '';
        }
        return $clean;
    }

    /**
     * Resolves and caches the complete dynamic format registry for a project root.
     *
     * @param string     $project_root    Absolute path to project root
     * @param array      $base_media_types Optional baseline `$media_types` from `config/mime_types.php`
     * @param array|null $discovered_apps  Optional pre-discovered active apps array (avoids redundant disk scan)
     * @return array{
     *   media_types: array<string, string[]>,
     *   allowed_upload_extensions: string[],
     *   ext_to_mime: array<string, string>,
     *   mime_to_extensions: array<string, string[]>,
     *   sources: array<string, string[]>
     * }
     */
    public static function resolve(string $project_root, array $base_media_types = [], ?array $discovered_apps = null): array {
        $norm_root = rtrim(str_replace('\\', '/', $project_root), '/');
        $cache_key = $norm_root . '|' . md5(json_encode($base_media_types)) . '|' . ($discovered_apps === null ? 'scan' : 'pre:' . count($discovered_apps));

        if (isset(self::$cache[$cache_key])) {
            return self::$cache[$cache_key];
        }

        // 1. Seed with core baseline + config/mime_types.php
        $media_sets = [];
        $ext_to_mime = self::STANDARD_MIME_MAP;
        $upload_set = [];
        $sources = [];

        $seed_types = !empty($base_media_types) ? $base_media_types : self::CORE_BASELINE_MEDIA_TYPES;
        foreach ($seed_types as $cat => $exts) {
            if (!is_array($exts)) continue;
            $cat_key = strtolower(trim((string)$cat));
            if ($cat_key === '') continue;
            if (!isset($media_sets[$cat_key])) {
                $media_sets[$cat_key] = [];
            }
            foreach ($exts as $raw_ext) {
                $ext = self::normalizeExtension((string)$raw_ext);
                if ($ext === '' || self::isForbiddenExtension($ext)) {
                    continue;
                }
                $media_sets[$cat_key][$ext] = true;
                $upload_set[$ext] = true;
                $sources[$ext][] = 'core';
            }
        }

        // 2. Auto-register formats from all active discovered apps (native + standalone/WASM)
        $apps = $discovered_apps ?? PluginDiscovery::getDiscoveredApps($norm_root, false);
        foreach ($apps as $app_id => $app_info) {
            $manifest = is_array($app_info['manifest'] ?? null) ? $app_info['manifest'] : [];
            $app_exts = [];

            foreach (['extensions', 'exportExtensions', 'uploadExtensions'] as $field) {
                if (!empty($manifest[$field]) && is_array($manifest[$field])) {
                    foreach ($manifest[$field] as $raw_ext) {
                        $ext = self::normalizeExtension((string)$raw_ext);
                        if ($ext !== '') {
                            $app_exts[$ext] = true;
                        }
                    }
                }
            }

            // Custom extension -> MIME declarations inside manifest (`"mimeMap": { "wcraft": "application/x-wordcraft" }`)
            if (!empty($manifest['mimeMap']) && is_array($manifest['mimeMap'])) {
                foreach ($manifest['mimeMap'] as $raw_ext => $raw_mime) {
                    $ext = self::normalizeExtension((string)$raw_ext);
                    $mime = strtolower(trim((string)$raw_mime));
                    if ($ext !== '' && $mime !== '' && strpos($mime, '/') !== false && !self::isForbiddenExtension($ext)) {
                        $ext_to_mime[$ext] = $mime;
                        $app_exts[$ext] = true;
                    }
                }
            }

            if (empty($app_exts)) {
                continue;
            }

            $declared_media_cat = !empty($manifest['mediaCategory']) ? strtolower(trim((string)$manifest['mediaCategory'])) : '';
            $app_mime_types = is_array($manifest['mimeTypes'] ?? null) ? $manifest['mimeTypes'] : [];

            foreach (array_keys($app_exts) as $ext) {
                // Immutable security guard: NEVER allow forbidden executable/active formats for upload or media indexing
                if (self::isForbiddenExtension($ext)) {
                    continue;
                }

                $upload_set[$ext] = true;
                $sources[$ext][] = (string)$app_id;

                // Assign to a media category if not already categorized
                if (!self::isExtensionInAnyCategory($ext, $media_sets)) {
                    $inferred_cat = self::inferCategoryForExtension($ext, $ext_to_mime[$ext] ?? '', $declared_media_cat, $app_mime_types, (string)$app_id);
                    if ($inferred_cat !== '') {
                        if (!isset($media_sets[$inferred_cat])) {
                            $media_sets[$inferred_cat] = [];
                        }
                        $media_sets[$inferred_cat][$ext] = true;
                    }
                }
            }
        }

        // 3. Optional administrator overrides in `config/formats.json`
        $formats_config_file = $norm_root . '/config/formats.json';
        if (is_file($formats_config_file)) {
            $decoded = @json_decode((string)@file_get_contents($formats_config_file), true);
            if (is_array($decoded)) {
                if (!empty($decoded['mime_map']) && is_array($decoded['mime_map'])) {
                    foreach ($decoded['mime_map'] as $raw_ext => $raw_mime) {
                        $ext = self::normalizeExtension((string)$raw_ext);
                        $mime = strtolower(trim((string)$raw_mime));
                        if ($ext !== '' && $mime !== '' && strpos($mime, '/') !== false && !self::isForbiddenExtension($ext)) {
                            $ext_to_mime[$ext] = $mime;
                        }
                    }
                }
                if (!empty($decoded['media_types']) && is_array($decoded['media_types'])) {
                    foreach ($decoded['media_types'] as $cat => $exts) {
                        $cat_key = strtolower(trim((string)$cat));
                        if ($cat_key === '' || !is_array($exts)) continue;
                        foreach ($exts as $raw_ext) {
                            $ext = self::normalizeExtension((string)$raw_ext);
                            if ($ext !== '' && !self::isForbiddenExtension($ext)) {
                                $media_sets[$cat_key][$ext] = true;
                                $upload_set[$ext] = true;
                                $sources[$ext][] = 'config:formats.json';
                            }
                        }
                    }
                }
                if (!empty($decoded['allow_extensions']) && is_array($decoded['allow_extensions'])) {
                    foreach ($decoded['allow_extensions'] as $raw_ext) {
                        $ext = self::normalizeExtension((string)$raw_ext);
                        if ($ext !== '' && !self::isForbiddenExtension($ext)) {
                            $upload_set[$ext] = true;
                            $sources[$ext][] = 'config:formats.json';
                        }
                    }
                }
            }
        }

        // Build final structured arrays
        $media_types = [];
        foreach ($media_sets as $cat => $set) {
            $media_types[$cat] = array_keys($set);
        }

        $allowed_upload = array_keys($upload_set);
        sort($allowed_upload);

        // Build reverse MIME -> extensions map for frontend FilePickerService
        $mime_to_extensions = [];
        foreach ($ext_to_mime as $ext => $mime) {
            if (!isset($mime_to_extensions[$mime])) {
                $mime_to_extensions[$mime] = [];
            }
            if (!in_array($ext, $mime_to_extensions[$mime], true)) {
                $mime_to_extensions[$mime][] = $ext;
            }
        }
        // Common MIME aliases (e.g. text/rtf alongside application/rtf)
        if (isset($mime_to_extensions['application/rtf'])) {
            $mime_to_extensions['text/rtf'] = $mime_to_extensions['application/rtf'];
        }
        if (isset($mime_to_extensions['application/vnd.rar'])) {
            $mime_to_extensions['application/x-rar-compressed'] = $mime_to_extensions['application/vnd.rar'];
        }

        foreach ($sources as $ext => $src_list) {
            $sources[$ext] = array_values(array_unique($src_list));
        }

        $resolved = [
            'media_types'               => $media_types,
            'allowed_upload_extensions' => $allowed_upload,
            'ext_to_mime'               => $ext_to_mime,
            'mime_to_extensions'        => $mime_to_extensions,
            'sources'                   => $sources
        ];

        self::$cache[$cache_key] = $resolved;
        return $resolved;
    }

    /**
     * Returns the dynamically merged `$media_types` category map.
     */
    public static function getMediaTypes(string $project_root, array $base_media_types = [], ?array $discovered_apps = null): array {
        return self::resolve($project_root, $base_media_types, $discovered_apps)['media_types'];
    }

    /**
     * Returns the dynamically computed upload whitelist (always filtered by immutable security blacklist).
     */
    public static function getAllowedUploadExtensions(string $project_root, array $base_media_types = [], ?array $discovered_apps = null): array {
        return self::resolve($project_root, $base_media_types, $discovered_apps)['allowed_upload_extensions'];
    }

    /**
     * Checks whether a given file extension is permitted for upload.
     */
    public static function isUploadExtensionAllowed(string $ext, string $project_root, array $base_media_types = [], ?array $discovered_apps = null): bool {
        $clean = self::normalizeExtension($ext);
        if ($clean === '' || self::isForbiddenExtension($clean)) {
            return false;
        }
        $allowed = self::getAllowedUploadExtensions($project_root, $base_media_types, $discovered_apps);
        return in_array($clean, $allowed, true);
    }

    /**
     * Resolves the MIME type for a given extension (including app-declared custom `mimeMap`).
     */
    public static function getMimeType(string $ext, ?string $project_root = null, array $base_media_types = []): string {
        $clean = self::normalizeExtension($ext);
        if ($clean === '') {
            return 'application/octet-stream';
        }
        if ($project_root !== null && $project_root !== '') {
            $map = self::resolve($project_root, $base_media_types)['ext_to_mime'];
            if (isset($map[$clean])) {
                return $map[$clean];
            }
        }
        return self::STANDARD_MIME_MAP[$clean] ?? 'application/octet-stream';
    }

    /**
     * Resolves the HTTP Content-Type header value (appending `; charset=utf-8` for UTF-8 text formats).
     */
    public static function getHttpContentType(string $ext, ?string $project_root = null, array $base_media_types = []): string {
        $clean = self::normalizeExtension($ext);
        $mime = self::getMimeType($clean, $project_root, $base_media_types);
        if (in_array($clean, self::UTF8_TEXT_EXTENSIONS, true) && stripos($mime, 'charset=') === false) {
            return $mime . '; charset=utf-8';
        }
        return $mime;
    }

    /**
     * Returns the reverse `MIME -> [ext1, ext2, ...]` map for frontend file pickers.
     */
    public static function getMimeToExtensionsMap(string $project_root, array $base_media_types = [], ?array $discovered_apps = null): array {
        return self::resolve($project_root, $base_media_types, $discovered_apps)['mime_to_extensions'];
    }

    private static function isExtensionInAnyCategory(string $ext, array $media_sets): bool {
        foreach ($media_sets as $set) {
            if (isset($set[$ext])) {
                return true;
            }
        }
        return false;
    }

    private static function inferCategoryForExtension(
        string $ext,
        string $mime,
        string $declared_media_cat,
        array $app_mime_types,
        string $app_id
    ): string {
        $valid_cats = ['image', 'video', 'audio', 'doc', 'archive', 'videowall'];
        if ($declared_media_cat !== '' && in_array($declared_media_cat, $valid_cats, true)) {
            return $declared_media_cat;
        }

        // 1. Infer from the extension's own MIME type
        if ($mime !== '') {
            if (strpos($mime, 'image/') === 0) return 'image';
            if (strpos($mime, 'video/') === 0) return 'video';
            if (strpos($mime, 'audio/') === 0) return 'audio';
            if (
                strpos($mime, 'text/') === 0
                || $mime === 'application/pdf'
                || $mime === 'application/rtf'
                || $mime === 'application/epub+zip'
                || $mime === 'application/msword'
                || $mime === 'application/vnd.ms-excel'
                || $mime === 'application/vnd.ms-powerpoint'
                || strpos($mime, 'application/vnd.oasis.opendocument.') === 0
                || strpos($mime, 'application/vnd.openxmlformats-officedocument.') === 0
                || strpos($mime, 'application/vnd.apple.') === 0
                || $mime === 'application/x-wordcraft'
                || $mime === 'application/x-tex'
                || $mime === 'application/x-latex'
                || $mime === 'application/json'
                || $mime === 'application/xml'
            ) {
                return 'doc';
            }
            if (in_array($mime, [
                'application/zip', 'application/x-tar', 'application/gzip',
                'application/x-bzip2', 'application/x-xz', 'application/vnd.rar',
                'application/x-rar-compressed', 'application/x-7z-compressed'
            ], true)) {
                return 'archive';
            }
            if (in_array($mime, [
                'application/x-krita', 'application/x-photocraft', 'application/x-affinity',
                'application/x-affinity-photo', 'application/x-affinity-designer', 'application/postscript'
            ], true)) {
                return 'image';
            }
            if ($mime === 'application/x-filmcraft') {
                return 'video';
            }
        }

        // 2. Infer from the registering app's declared mimeTypes
        foreach ($app_mime_types as $m) {
            $ms = strtolower(trim((string)$m));
            if (strpos($ms, 'image/') === 0) return 'image';
            if (strpos($ms, 'video/') === 0) return 'video';
            if (strpos($ms, 'audio/') === 0) return 'audio';
            if (strpos($ms, 'text/') === 0 || $ms === 'application/pdf') return 'doc';
        }

        // 3. Fallback from well-known core app IDs
        $app_cat_map = [
            'image-viewer'    => 'image',
            'video-player'    => 'video',
            'audio-player'    => 'audio',
            'doc-viewer'      => 'doc',
            'archive-manager' => 'archive'
        ];
        if (isset($app_cat_map[$app_id])) {
            return $app_cat_map[$app_id];
        }

        return '';
    }
}
