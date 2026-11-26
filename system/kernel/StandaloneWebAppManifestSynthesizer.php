<?php
namespace SimpleGallery\Kernel;

use SimpleGallery\Kernel\Media\FormatRegistry;

/**
 * Synthesizes a full SimpleGallery WebOS manifest for third-party standalone
 * web application distributions (static HTML/JS/WASM/PWA folders dropped into
 * `apps/` without a native SimpleGallery `manifest.json` or `app.js`).
 */
class StandaloneWebAppManifestSynthesizer {

    /**
     * Format keyword aliases commonly written in prose (e.g. README Formats sections).
     */
    private const FORMAT_PROSE_ALIASES = [
        'photoshop'  => ['psd'],
        'openraster' => ['ora'],
        'openexr'    => ['exr'],
        'radiance'   => ['hdr'],
        'jpeg'       => ['jpg', 'jpeg'],
        'tiff'       => ['tiff', 'tif'],
        'heif'       => ['heic', 'heif'],
        'pdn3'       => ['pdn'],
        'midi'       => ['mid', 'midi']
    ];

    /**
     * Extensions that frequently appear in README installation/build/size prose
     * and must NEVER be auto-inferred as document file associations from prose.
     */
    private const PROSE_EXT_BLOCKLIST = [
        'gb', 'mb', 'kb', 'tb', 'hz', 'khz', 'fps', 'dpi',
        'deb', 'rpm', 'msi', 'dmg', 'pkg', 'exe', 'appimage', 'flatpak', 'snap', 'zsync',
        'local', 'config', 'scr', 'ttf', 'otf', 'ttc', 'woff', 'woff2',
        'lock', 'log', 'sh', 'ps1', 'bat', 'cmd', 'wasm', 'js', 'mjs', 'cjs', 'ts', 'css',
        'rs', 'py', 'php', 'rb', 'go', 'java', 'cpp', 'hpp', 'toml', 'ini', 'env', 'bak',
        'tar', 'gz', 'bz2', 'xz', 'zip', '7z', 'rar'
    ];

    /**
     * Additional app-specific & document extensions recognized when written with a leading dot
     * in README prose even if not in the baseline MIME table.
     */
    private const EXTRA_KNOWN_DOT_EXTS = [
        'xls'      => 'application/vnd.ms-excel',
        'xlsx'     => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ods'      => 'application/vnd.oasis.opendocument.spreadsheet',
        'csv'      => 'text/csv',
        'tsv'      => 'text/tab-separated-values',
        'doc'      => 'application/msword',
        'docx'     => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'odt'      => 'application/vnd.oasis.opendocument.text',
        'rtf'      => 'application/rtf',
        'epub'     => 'application/epub+zip',
        'pptx'     => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'ppt'      => 'application/vnd.ms-powerpoint',
        'odp'      => 'application/vnd.oasis.opendocument.presentation',
        'pdf'      => 'application/pdf',
        'pdfcraft' => 'application/x-pdfcraft',
        'wcraft'   => 'application/x-wordcraft',
        'pcraft'   => 'application/x-photocraft',
        'fcproj'   => 'application/x-filmcraft-project',
        'prproj'   => 'application/x-premiere-project',
        'eml'      => 'message/rfc822',
        'mbox'     => 'application/mbox',
        'ics'      => 'text/calendar',
        'vcf'      => 'text/vcard',
        'pst'      => 'application/vnd.ms-outlook',
        'dxf'      => 'image/vnd.dxf',
        'dwg'      => 'image/vnd.dwg',
        'step'     => 'application/step',
        'stp'      => 'application/step',
        'stl'      => 'model/stl',
        'obj'      => 'model/obj',
        'gltf'     => 'model/gltf+json',
        'glb'      => 'model/gltf-binary',
        'svg'      => 'image/svg+xml',
        'ai'       => 'application/postscript',
        'eps'      => 'application/postscript',
        'psd'      => 'image/vnd.adobe.photoshop',
        'psb'      => 'image/vnd.adobe.photoshop',
        'kra'      => 'application/x-krita',
        'xcf'      => 'image/x-xcf',
        'ora'      => 'image/openraster',
        'pdn'      => 'image/x-paintnet',
        'af'       => 'application/octet-stream',
        'afdesign' => 'application/octet-stream',
        'afphoto'  => 'application/octet-stream',
        'afpub'    => 'application/octet-stream',
        'cube'     => 'text/plain',
        'look'     => 'text/xml',
        'pat'      => 'application/octet-stream',
        'mp4'      => 'video/mp4',
        'mov'      => 'video/quicktime',
        'webm'     => 'video/webm',
        'mkv'      => 'video/x-matroska',
        'avi'      => 'video/x-msvideo',
        'mp3'      => 'audio/mpeg',
        'wav'      => 'audio/wav',
        'flac'     => 'audio/flac',
        'ogg'      => 'audio/ogg',
        'opus'     => 'audio/opus',
        'aac'      => 'audio/aac',
        'mid'      => 'audio/midi',
        'midi'     => 'audio/midi',
        'png'      => 'image/png',
        'jpg'      => 'image/jpeg',
        'jpeg'     => 'image/jpeg',
        'webp'     => 'image/webp',
        'gif'      => 'image/gif',
        'bmp'      => 'image/bmp',
        'tif'      => 'image/tiff',
        'tiff'     => 'image/tiff',
        'avif'     => 'image/avif',
        'hdr'      => 'image/vnd.radiance',
        'exr'      => 'image/x-exr'
    ];

    /**
     * Returns the relative HTML entrypoint file name if $app_path is a standalone web app directory.
     */
    public static function detectHtmlEntryFile(string $app_path): ?string {
        if (!is_dir($app_path)) {
            return null;
        }
        if (file_exists($app_path . '/index.html')) {
            return 'index.html';
        }
        if (file_exists($app_path . '/index.htm')) {
            return 'index.htm';
        }
        return null;
    }

    /**
     * Checks whether a directory is a standalone third-party web distribution
     * (has index.html/index.htm and no native SimpleGallery manifest.json / app.js).
     */
    public static function isStandaloneWebApp(string $app_path, string $folder): bool {
        if (file_exists($app_path . '/manifest.json')) {
            return false;
        }
        $htmlEntry = self::detectHtmlEntryFile($app_path);
        if ($htmlEntry === null) {
            return false;
        }
        $normPath = str_replace('\\', '/', $app_path);
        // Anything installed inside `apps/external/` with an HTML entry is always a standalone web app,
        // even if its frontend bundle happens to be named `app.js`.
        if (stripos($normPath, '/apps/external/') !== false) {
            return true;
        }
        // Outside `apps/external/`, preserve backward compatibility with manifest-less native WebOS apps
        // only when `app.js` / `<folder>.js` actually registers with WebOSApp / appManager.
        foreach ([$app_path . '/app.js', $app_path . '/' . $folder . '.js'] as $nativeJs) {
            if (file_exists($nativeJs)) {
                $head = @file_get_contents($nativeJs, false, null, 0, 8192) ?: '';
                if (preg_match('/\b(extends\s+(?:window\.)?WebOSApp|appManager\.register|SG_APP_REGISTRY)\b/', $head)) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Parses folder name into a normalized app ID and semantic version.
     * Example: "photocraft-web-0.23.1" => ['id' => 'photocraft', 'version' => '0.23.1']
     */
    public static function parseFolderIdentity(string $folder): array {
        $version = '1.0.0';
        $base = $folder;

        if (preg_match('/^(.+?)[-_]v?(\d+\.\d+(?:\.\d+)?(?:[-+][a-zA-Z0-9._-]+)?)$/i', $base, $m)) {
            $base = $m[1];
            $version = $m[2];
        }

        // Strip common distribution suffixes like "-web", "-wasm", "-dist", "-static", "-app"
        $cleaned = preg_replace('/[-_](web|wasm|dist|static)$/i', '', $base);
        if (!empty($cleaned)) {
            $base = $cleaned;
        }

        $id = strtolower(preg_replace('/[^a-zA-Z0-9_-]+/', '-', $base));
        $id = trim((string)preg_replace('/-+/', '-', $id), '-_');
        if ($id === '') {
            $id = strtolower(preg_replace('/[^a-zA-Z0-9_-]+/', '-', $folder)) ?: 'webapp';
        }

        return [
            'id'      => $id,
            'version' => $version
        ];
    }

    /**
     * Synthesizes a complete SimpleGallery manifest array from a standalone web app directory.
     */
    public static function synthesize(string $app_path, string $rel_key, string $project_root = ''): array {
        $folder = basename($app_path);
        $html_file = self::detectHtmlEntryFile($app_path) ?? 'index.html';
        $html_entry = 'apps/' . $rel_key . '/' . $html_file;

        $identity = self::parseFolderIdentity($folder);
        $app_id = $identity['id'];
        $version = $identity['version'];

        $html_content = @file_get_contents($app_path . '/' . $html_file) ?: '';
        $readme_content = file_exists($app_path . '/README.md') ? (@file_get_contents($app_path . '/README.md') ?: '') : '';
        $hosting_content = file_exists($app_path . '/HOSTING.md') ? (@file_get_contents($app_path . '/HOSTING.md') ?: '') : '';

        // 1. Optional W3C Web App Manifest (manifest.webmanifest / site.webmanifest)
        $w3c = self::readW3cWebManifest($app_path);

        // 2. Resolve App Display Name
        $name = '';
        if (!empty($w3c['name'])) {
            $name = trim((string)$w3c['name']);
        } elseif (!empty($w3c['short_name'])) {
            $name = trim((string)$w3c['short_name']);
        }
        if ($name === '' && preg_match('/<title[^>]*>(.*?)<\/title>/is', $html_content, $tm)) {
            $name = trim(html_entity_decode(strip_tags($tm[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        }
        if ($name === '' && $readme_content !== '') {
            if (preg_match('/<h1[^>]*>(.*?)<\/h1>/is', $readme_content, $hm)) {
                $name = trim(html_entity_decode(strip_tags($hm[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
            } elseif (preg_match('/^#\s+(.+)$/m', $readme_content, $hm)) {
                $name = trim(strip_tags($hm[1]));
            }
        }
        if ($name === '') {
            $name = ucwords(str_replace(['-', '_'], ' ', $app_id));
        }

        // 3. Resolve Description
        $description = '';
        if (!empty($w3c['description'])) {
            $description = trim((string)$w3c['description']);
        }
        if ($description === '' && preg_match('/<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']/i', $html_content, $dm)) {
            $description = trim(html_entity_decode($dm[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        }
        if ($description === '' && $readme_content !== '') {
            $description = self::extractReadmeDescription($readme_content);
        }
        if ($description === '') {
            $description = "Application Web autonome ({$name})";
        }

        // 4. Detect WebAssembly / Canvas runtime traits, renderer flags, host bridge & startup file query param
        $health = self::checkDeploymentHealth($app_path, $html_file, $html_content);
        $is_wasm = self::detectWasmPresence($app_path, $html_content);
        $combined_docs = $hosting_content . "\n" . $readme_content;
        $renderer_flags = self::extractRendererFlags($combined_docs);
        $open_file_param = self::extractOpenFileParam($combined_docs);
        $host_bridge = self::extractHostBridgeSpec($combined_docs, $app_id);

        // 5. Extract File Associations (W3C file_handlers -> HTML accept -> README Formats -> README prose dot-exts -> Name/Desc/Hosting fallback)
        $extracted_formats = self::extractFileAssociations($w3c, $html_content, $readme_content, $name, $description, $hosting_content, $app_id);
        $extensions = $extracted_formats['extensions'];
        $mime_types = $extracted_formats['mimeTypes'];

        // 6. Infer Category & Icon (plus real image icon URL when available)
        $parent_cat = (strpos($rel_key, '/') !== false) ? dirname($rel_key) : '';
        if (in_array(strtolower($parent_cat), ['external', 'externals', 'third-party', '3rdparty'], true)) {
            $parent_cat = '';
        }
        $inferred = self::inferCategoryAndIcon($parent_cat, $w3c, $name, $description, $extensions, $app_id);
        $category = $inferred['category'];
        $icon = $inferred['icon'];
        $icon_url = self::extractIconUrl($app_path, $rel_key, $w3c, $html_content, $readme_content, $app_id, $name);

        // 7. Capabilities
        $capabilities = ['standalone-web', 'iframe-host', 'fullscreen'];
        if ($is_wasm) {
            $capabilities[] = 'wasm';
        }
        if ($host_bridge !== null) {
            $capabilities[] = 'host-parent-bridge';
        }
        if (!empty($extensions)) {
            $capabilities[] = 'file-handler';
            $capabilities[] = 'drag-drop-bridge';
        }

        $manifest = [
            'id'            => $app_id,
            'name'          => $name,
            'version'       => $version,
            'description'   => $description,
            'icon'          => $icon,
            'icon_url'      => $icon_url,
            'category'      => $category,
            'distribution'  => 'standalone-web',
            'runtime'       => 'iframe',
            'synthetic'     => true,
            'source_folder' => $folder,
            'health'        => $health,
            'publicBase'    => $health['public_base'] ?? null,
            'entry'         => [
                'html' => $html_entry
            ],
            'extensions'    => $extensions,
            'mimeTypes'     => $mime_types,
            'capabilities'  => $capabilities,
            'rendererFlags' => $renderer_flags,
            'openFileParam' => $open_file_param,
            'hostBridge'    => $host_bridge,
            'window'        => [
                'width'       => 1180,
                'height'      => 760,
                'resizable'   => true,
                'maximizable' => true
            ],
            'locales'       => [
                'fr' => ['title' => $name, 'description' => $description],
                'en' => ['title' => $name, 'description' => $description],
                'ja' => ['title' => $name, 'description' => $description]
            ]
        ];

        // 8. Optional admin overrides in config/external_apps.json (non-invasive, never touches app folder)
        if ($project_root !== '') {
            $override = self::loadAdminOverride($project_root, $app_id, $folder);
            if (!empty($override)) {
                $manifest = self::mergeOverride($manifest, $override);
            }
        }

        return $manifest;
    }

    private static function readW3cWebManifest(string $app_path): array {
        foreach (['manifest.webmanifest', 'site.webmanifest'] as $fname) {
            $fpath = $app_path . '/' . $fname;
            if (file_exists($fpath)) {
                $decoded = @json_decode((string)@file_get_contents($fpath), true);
                if (is_array($decoded)) {
                    return $decoded;
                }
            }
        }
        return [];
    }

    private static function extractReadmeDescription(string $readme): string {
        // Look for an explicit bold summary tagline first (common in project READMEs)
        if (preg_match('/<b>([^<]{18,220})<\/b>/i', $readme, $bm)) {
            $clean = trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags($bm[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8')));
            if ($clean !== '') {
                return mb_strlen($clean) > 180 ? mb_substr($clean, 0, 177) . '…' : $clean;
            }
        }

        // Otherwise extract the first clean Markdown paragraph line
        $lines = preg_split('/\r?\n/', $readme) ?: [];
        foreach ($lines as $line) {
            $t = trim($line);
            if ($t === '' || $t[0] === '#' || $t[0] === '<' || $t[0] === '!' || $t[0] === '[' || $t[0] === '|' || $t[0] === '>' || $t[0] === '`') {
                continue;
            }
            $plain = trim(preg_replace('/\[([^\]]+)\]\([^)]+\)/', '$1', $t));
            $plain = trim(str_replace(['**', '__', '`'], '', $plain));
            if (mb_strlen($plain) >= 20) {
                return mb_strlen($plain) > 180 ? mb_substr($plain, 0, 177) . '…' : $plain;
            }
        }

        return '';
    }

    private static function detectWasmPresence(string $app_path, string $html_content): bool {
        if (stripos($html_content, '.wasm') !== false || stripos($html_content, 'application/wasm') !== false) {
            return true;
        }
        $entries = @scandir($app_path) ?: [];
        foreach ($entries as $e) {
            if (substr(strtolower($e), -5) === '.wasm') {
                return true;
            }
        }
        return false;
    }

    private static function extractRendererFlags(string $docs): array {
        if ($docs === '') {
            return [];
        }
        $known_flags = [
            'webgl'  => 'WebGL2',
            'webgpu' => 'WebGPU',
            'cpu'    => 'CPU Canvas'
        ];
        $found = [];
        foreach ($known_flags as $flag => $label) {
            if (preg_match('/`\?' . preg_quote($flag, '/') . '`/i', $docs)) {
                $found[] = ['flag' => $flag, 'label' => $label];
            }
        }
        return $found;
    }

    /**
     * Detects a hardcoded root-absolute public base path (e.g. GitHub Pages Trunk/Vite builds
     * compiled with `--public-url /epub-reader-rs/`) where referenced assets actually exist
     * directly inside `$app_path` once that `/<prefix>/` is stripped.
     */
    public static function detectHardcodedPublicBase(string $app_path, string $html_content): ?string {
        if ($html_content === '') {
            return null;
        }
        $candidates = [];
        if (preg_match_all('/(?:(?:href|src)\s*=\s*["\']?|[\'"])(\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._\/-]+\.(?:wasm|js|mjs|css|svg|png|ico|woff2?))(?=["\'\s>])/i', $html_content, $m)) {
            foreach ($m[1] as $rawPath) {
                $norm = str_replace('\\', '/', $rawPath);
                if (strpos($norm, '..') !== false) continue;
                if (preg_match('#^/([^/]+)/(.+)$#', $norm, $pm)) {
                    $prefix = '/' . $pm[1] . '/';
                    $rel = $pm[2];
                    if (is_file($app_path . '/' . $rel) && (int)@filesize($app_path . '/' . $rel) > 0 && !is_file($app_path . $norm)) {
                        $candidates[$prefix] = ($candidates[$prefix] ?? 0) + 1;
                    }
                }
            }
        }
        if (empty($candidates)) {
            return null;
        }
        arsort($candidates);
        return (string)array_key_first($candidates);
    }

    /**
     * Rewrites hardcoded root-absolute public base paths (e.g. `/epub-reader-rs/`) in a standalone
     * app's HTML entry to the actual web mount path (`<webAppBaseUrl>/`) while preserving SRI hashes.
     */
    public static function rewriteHtmlPublicBase(string $html_content, string $public_base, string $web_app_base_url): string {
        $cleanBase = '/' . trim($public_base, '/') . '/';
        $cleanTarget = rtrim($web_app_base_url, '/') . '/';
        if ($cleanBase === '//' || $cleanTarget === '/') {
            return $html_content;
        }
        // Replace quoted or unquoted attribute/JS references to `/<prefix>/`
        $rewritten = preg_replace(
            '/(["\'=,\(\s])' . preg_quote($cleanBase, '/') . '/i',
            '$1' . $cleanTarget,
            $html_content
        );
        if (!is_string($rewritten)) {
            $rewritten = $html_content;
        }
        // Inject <base href="..."> if absent so any relative URLs (fonts, workers, sub-assets) resolve cleanly
        if (stripos($rewritten, '<base ') === false) {
            $baseTag = '<base href="' . htmlspecialchars($cleanTarget, ENT_QUOTES, 'UTF-8') . '">';
            if (preg_match('/<head\b[^>]*>/i', $rewritten)) {
                $rewritten = preg_replace('/(<head\b[^>]*>)/i', '$1' . $baseTag, $rewritten, 1);
            } elseif (preg_match('/<meta\b[^>]*charset[^>]*>/i', $rewritten)) {
                $rewritten = preg_replace('/(<meta\b[^>]*charset[^>]*>)/i', '$1' . $baseTag, $rewritten, 1);
            } else {
                $rewritten = $baseTag . $rewritten;
            }
        }
        return $rewritten;
    }

    /**
     * Verifies that a standalone web app deployment is intact (non-empty HTML entry and non-empty WASM assets).
     */
    private static function checkDeploymentHealth(string $app_path, string $html_file, string $html_content): array {
        $entry_path = $app_path . '/' . $html_file;
        $entry_size = is_file($entry_path) ? (int)@filesize($entry_path) : 0;
        if ($entry_size <= 0 || trim($html_content) === '') {
            return ['ok' => false, 'reason' => 'empty_html_entry', 'public_base' => null];
        }
        $public_base = self::detectHardcodedPublicBase($app_path, $html_content);

        if (preg_match_all('/(?:[\'"]|(?:href|src)\s*=\s*["\']?)((?:\.\/|\/)?[a-zA-Z0-9._\/-]+\.wasm)(?=["\'\s>])/i', $html_content, $wm)) {
            foreach (array_unique($wm[1]) as $wasm_rel) {
                $norm = str_replace('\\', '/', $wasm_rel);
                if (strpos($norm, '..') !== false) continue;

                $resolved = null;
                $clean = ltrim($norm, './');
                if (is_file($app_path . '/' . $clean) && (int)@filesize($app_path . '/' . $clean) > 0) {
                    $resolved = $app_path . '/' . $clean;
                } elseif ($public_base !== null && stripos($norm, $public_base) === 0) {
                    $stripped = ltrim(substr($norm, strlen($public_base)), '/');
                    if (is_file($app_path . '/' . $stripped) && (int)@filesize($app_path . '/' . $stripped) > 0) {
                        $resolved = $app_path . '/' . $stripped;
                    }
                }
                if ($resolved === null) {
                    return ['ok' => false, 'reason' => 'missing_or_empty_wasm', 'public_base' => $public_base];
                }
            }
        }
        return ['ok' => true, 'reason' => 'ok', 'public_base' => $public_base];
    }

    /**
     * Detects native same-origin parent host protocol (`?host=parent` + `<prefix>:ready/open/save/dirty/failed`)
     * documented in HOSTING.md (e.g. GridCraft, DeckCraft, CADCraft, FilmCraft, PdfCraft).
     */
    private static function extractHostBridgeSpec(string $docs, string $app_id): ?array {
        if ($docs === '' || stripos($docs, 'host=parent') === false) {
            return null;
        }
        $prefix = $app_id;
        if (preg_match('/`([a-z0-9_-]+):ready`/i', $docs, $pm)) {
            $prefix = strtolower($pm[1]);
        }
        return [
            'mode'            => 'parent',
            'prefix'          => $prefix,
            'supportsAuthor'  => (bool)preg_match('/[?&]author=/i', $docs),
            'supportsChrome'  => (bool)preg_match('/\?chrome=(?:notitlebar|none|nofiletab)/i', $docs),
            'supportsBlank'   => (bool)preg_match('/`\?blank`/i', $docs),
            'supportsControl' => (bool)preg_match('/`\?control`/i', $docs)
        ];
    }

    /**
     * Detects whether documentation declares a startup URL query parameter for opening a file (e.g. `?file=<url>`).
     */
    private static function extractOpenFileParam(string $docs): ?string {
        if ($docs === '') {
            return null;
        }
        if (preg_match('/`\?file=/i', $docs) || preg_match('/\?file=<[^>]+>/i', $docs)) {
            return 'file';
        }
        if (preg_match('/`\?url=/i', $docs) && stripos($docs, 'open') !== false) {
            return 'url';
        }
        return null;
    }

    private static function extractFileAssociations(
        array $w3c,
        string $html_content,
        string $readme_content,
        string $name = '',
        string $description = '',
        string $hosting_content = '',
        string $app_id = ''
    ): array {
        $ext_set = [];
        $mime_set = [];
        $known_mimes = array_merge(self::EXTRA_KNOWN_DOT_EXTS, FormatRegistry::getStandardMimeMap());

        // Layer 1: W3C Web App Manifest file_handlers
        if (!empty($w3c['file_handlers']) && is_array($w3c['file_handlers'])) {
            foreach ($w3c['file_handlers'] as $handler) {
                if (!empty($handler['accept']) && is_array($handler['accept'])) {
                    foreach ($handler['accept'] as $mime => $exts) {
                        $mime_str = strtolower(trim((string)$mime));
                        if ($mime_str !== '') {
                            $mime_set[$mime_str] = true;
                        }
                        foreach ((array)$exts as $ext) {
                            $clean = ltrim(strtolower(trim((string)$ext)), '.');
                            if ($clean !== '' && preg_match('/^[a-z0-9]{1,12}$/', $clean)) {
                                $ext_set[$clean] = true;
                            }
                        }
                    }
                }
            }
        }

        // Layer 2: HTML <input accept="...">
        if (preg_match_all('/<input[^>]+accept=["\']([^"\']+)["\']/i', $html_content, $accept_matches)) {
            foreach ($accept_matches[1] as $accept_val) {
                foreach (explode(',', $accept_val) as $token) {
                    $token = strtolower(trim($token));
                    if (strpos($token, '/') !== false) {
                        $mime_set[$token] = true;
                    } elseif (strpos($token, '.') === 0) {
                        $clean = ltrim($token, '.');
                        if (isset($known_mimes[$clean])) {
                            $ext_set[$clean] = true;
                            $mime_set[$known_mimes[$clean]] = true;
                        }
                    }
                }
            }
        }

        // Layer 3: README Formats section (scoped to avoid matching OS installer extensions in Downloads)
        if ($readme_content !== '') {
            $format_block = self::extractFormatsSection($readme_content);
            if ($format_block !== '') {
                $plain_block = strip_tags($format_block);

                // Match dotted extensions like .kra, .pcraft, .afphoto
                if (preg_match_all('/(?<![a-zA-Z0-9])\.([a-zA-Z0-9]{2,10})\b/', $plain_block, $dot_matches)) {
                    foreach ($dot_matches[1] as $raw_ext) {
                        $e = strtolower($raw_ext);
                        if (in_array($e, self::PROSE_EXT_BLOCKLIST, true)) continue;
                        if (isset($known_mimes[$e])) {
                            $ext_set[$e] = true;
                            $mime_set[$known_mimes[$e]] = true;
                        }
                    }
                }

                // Match uppercase/prose format tokens like PSD, PSB, PNG, JPEG, XCF, WebP, SVG, OpenEXR
                if (preg_match_all('/\b([a-zA-Z0-9]{2,12})\b/', $plain_block, $word_matches)) {
                    foreach ($word_matches[1] as $word) {
                        $w = strtolower($word);
                        if (in_array($w, self::PROSE_EXT_BLOCKLIST, true)) continue;
                        if (isset(self::FORMAT_PROSE_ALIASES[$w])) {
                            foreach (self::FORMAT_PROSE_ALIASES[$w] as $mapped_ext) {
                                $ext_set[$mapped_ext] = true;
                                if (isset($known_mimes[$mapped_ext])) {
                                    $mime_set[$known_mimes[$mapped_ext]] = true;
                                }
                            }
                        } elseif (isset($known_mimes[$w])) {
                            // Avoid false positives on short ambiguous common English words ("af", "or", "raw", etc.)
                            // unless written uppercase or with leading dot (handled above)
                            if (strlen($w) >= 3 || strtoupper($word) === $word) {
                                $ext_set[$w] = true;
                                $mime_set[$known_mimes[$w]] = true;
                            }
                        }
                    }
                }
            }

            // Layer 3b: Scan README intro / feature paragraphs for explicit dot-prefixed document formats
            // (catches .xls in GridCraft, .pptx in DeckCraft, .doc/.md/.tex in WordCraft, .eml/.mbox/.ics/.vcf in MailCraft, .fcproj/.prproj in FilmCraft)
            $prose_body = self::stripDownloadsAndLicenseSections($readme_content);
            // Strip URLs, HTML tags, and markdown image/link targets so filenames like foo.png in badges/screenshots aren't treated as supported formats
            $prose_clean = preg_replace('/!\[[^\]]*\]\([^)]+\)/', ' ', $prose_body);
            $prose_clean = preg_replace('/\[([^\]]+)\]\([^)]+\)/', '$1', $prose_clean);
            $prose_clean = preg_replace('#https?://\S+#i', ' ', $prose_clean);
            $prose_clean = strip_tags((string)$prose_clean);
            if (preg_match_all('/(?<![a-zA-Z0-9_\/-])\.([a-z][a-z0-9]{1,9})\b/i', $prose_clean, $prose_dots)) {
                foreach ($prose_dots[1] as $raw_ext) {
                    $e = strtolower($raw_ext);
                    if (in_array($e, self::PROSE_EXT_BLOCKLIST, true)) continue;
                    // Ignore generic web/screenshot image extensions unless this app is a photo/image/vector/video app
                    if (in_array($e, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'html', 'htm'], true)) {
                        continue;
                    }
                    if (isset($known_mimes[$e])) {
                        $ext_set[$e] = true;
                        $mime_set[$known_mimes[$e]] = true;
                    }
                }
            }
        }

        // Layer 4: Primary format inference from title / id / description / HOSTING.md
        $summary = strtolower($app_id . ' ' . $name . ' ' . $description . ' ' . substr($hosting_content, 0, 1200));
        $primary_rules = [
            '/\bpdf(craft)?\b/i'                                   => ['pdf'],
            '/\bepub\b|e-?book\s+reader/i'                         => ['epub'],
            '/\b(svg|vector\s+illustration|vectorcraft)\b/i'       => ['svg', 'eps'],
            '/\bmarkdown\b/i'                                      => ['md'],
            '/\b(spreadsheet|workbook|tableur|gridcraft)\b/i'      => ['xlsx', 'xls', 'ods', 'csv'],
            '/\b(presentation|slides?|deckcraft)\b/i'              => ['pptx', 'odp'],
            '/\b(word\s+processing|word\s+processor|wordcraft)\b/i'=> ['docx', 'doc', 'odt', 'rtf', 'epub', 'wcraft'],
            '/\b(mail\s+client|email\s+client|mailcraft)\b/i'      => ['eml', 'mbox', 'ics', 'vcf'],
            '/\b(video\s+edit|film\s+edit|filmcraft)\b/i'          => ['mp4', 'webm', 'mov', 'mkv', 'fcproj', 'prproj'],
            '/\b(audio\s+edit|audio\s+record|daw|soundcraft)\b/i'  => ['mp3', 'wav', 'ogg', 'flac', 'opus', 'aac'],
            '/\b(3d\s+cad|parametric\s+3d|cadcraft|stl)\b/i'       => ['obj', 'stl', 'gltf', 'glb', 'dxf']
        ];
        foreach ($primary_rules as $pattern => $exts) {
            if (preg_match($pattern, $summary)) {
                foreach ($exts as $e) {
                    $ext_set[$e] = true;
                    if (isset($known_mimes[$e])) {
                        $mime_set[$known_mimes[$e]] = true;
                    }
                }
            }
        }

        return [
            'extensions' => array_keys($ext_set),
            'mimeTypes'  => array_keys($mime_set)
        ];
    }

    /**
     * Strips Downloads / Installation / Building / License sections from README before scanning dot-extensions.
     */
    private static function stripDownloadsAndLicenseSections(string $readme): string {
        $cut = preg_split('/^#{1,3}\s+(?:Downloads?|Install(?:ation)?|Building|Build|Packaging|License|Community\s+packages|The\s+Crafting\s+Apps)\b/im', $readme, 2);
        return is_array($cut) && isset($cut[0]) ? substr($cut[0], 0, 8000) : substr($readme, 0, 8000);
    }

    /**
     * Extracts the dedicated Formats section from a README if present.
     */
    private static function extractFormatsSection(string $readme): string {
        // HTML heading inside table cell (e.g. <h4>🗂️ Formats</h4> ... </td>)
        if (preg_match('/<h[2-5][^>]*>[^<]*Formats[^<]*<\/h[2-5]>(.*?)<\/td>/is', $readme, $m)) {
            return $m[1];
        }
        // Markdown heading (e.g. ## Formats / ### Supported Formats)
        if (preg_match('/^#{1,4}\s+[^\n]*Formats[^\n]*\n(.*?)(?=^#{1,4}\s|\z)/ims', $readme, $m)) {
            return $m[1];
        }
        return '';
    }

    private static function inferCategoryAndIcon(string $parent_cat, array $w3c, string $name, string $desc, array $extensions, string $app_id = ''): array {
        $text = strtolower($app_id . ' ' . $name . ' ' . $desc);
        $has_ext = function (array $candidates) use ($extensions): bool {
            return !empty(array_intersect($candidates, $extensions));
        };

        $category = $parent_cat;
        if ($category === '' && !empty($w3c['categories'][0])) {
            $w3c_cat = strtolower(trim((string)$w3c['categories'][0]));
            $map = [
                'graphics'     => 'media',
                'photo'        => 'media',
                'multimedia'   => 'media',
                'entertainment'=> 'games',
                'games'        => 'games',
                'productivity' => 'productivity',
                'office'       => 'office',
                'utilities'    => 'utilities'
            ];
            $category = $map[$w3c_cat] ?? $w3c_cat;
        }

        if ($has_ext(['eml', 'mbox', 'pst']) || preg_match('/\b(mailcraft|email\s+client|mail\s+client|imap|smtp)\b/i', $text)) {
            return ['category' => $category ?: 'communication', 'icon' => '✉️'];
        }
        if ($has_ext(['pptx', 'odp']) || preg_match('/\b(deckcraft|presentation|slide\s*deck)\b/i', $text)) {
            return ['category' => $category ?: 'productivity', 'icon' => '📊'];
        }
        if ($has_ext(['xlsx', 'xls', 'ods']) || preg_match('/\b(gridcraft|spreadsheet|tableur)\b/i', $text)) {
            return ['category' => $category ?: 'productivity', 'icon' => '📗'];
        }
        if ($has_ext(['pdf', 'pdfcraft']) || preg_match('/\b(pdfcraft|pdf\s+editor|pdf\s+reader)\b/i', $text)) {
            return ['category' => $category ?: 'productivity', 'icon' => '📕'];
        }
        if ($has_ext(['epub']) && !$has_ext(['docx', 'doc', 'odt']) || preg_match('/\b(epub|e-?book)\b/i', $text)) {
            return ['category' => $category ?: 'productivity', 'icon' => '📖'];
        }
        if ($has_ext(['docx', 'doc', 'odt', 'rtf', 'epub', 'wcraft']) || preg_match('/\b(wordcraft|word\s+process|document|office|markdown)\b/i', $text)) {
            return ['category' => $category ?: 'productivity', 'icon' => '📝'];
        }
        if ($has_ext(['mp4', 'webm', 'mkv', 'mov', 'fcproj']) || preg_match('/\b(filmcraft|effectcraft|video|film|cinema|motion|vfx|compositing)\b/i', $text)) {
            return ['category' => $category ?: 'media', 'icon' => '🎬'];
        }
        if ($has_ext(['mp3', 'wav', 'flac', 'mid', 'midi']) || preg_match('/\b(soundcraft|audio|sound|music|synth|daw)\b/i', $text)) {
            return ['category' => $category ?: 'media', 'icon' => '🎵'];
        }
        if ($has_ext(['psd', 'psb', 'xcf', 'kra', 'ora', 'pcraft', 'afphoto', 'svg']) || preg_match('/\b(photocraft|vectorcraft|designcraft|figcraft|lightcraft|materialcraft|texturecraft|image|photo|photoshop|paint|vector|draw|illustrat|canvas|pixel|layout|publishing)\b/i', $text)) {
            return ['category' => $category ?: 'media', 'icon' => '🎨'];
        }
        if ($has_ext(['obj', 'stl', 'gltf', 'glb', 'dxf']) || preg_match('/\b(cadcraft|cad|3d|mesh|model)\b/i', $text)) {
            return ['category' => $category ?: 'utilities', 'icon' => '🧊'];
        }
        if ($has_ext(['nes', 'gba', 'wad']) || preg_match('/\b(dosbox|dos\s+wasm|game|emulator|retro|arcade|puzzle|chess)\b/i', $text)) {
            return ['category' => $category ?: 'games', 'icon' => '🕹️'];
        }

        return ['category' => $category ?: 'utilities', 'icon' => '🌐'];
    }

    /**
     * Resolves the best real image icon URL for a standalone web app:
     * 1. <link rel="icon|shortcut icon|apple-touch-icon"> in index.html (local file or safe data:image URI)
     * 2. W3C site.webmanifest / manifest.webmanifest icons[] (local file)
     * 3. Conventional local icon files (icon.svg, favicon.png, logo.svg, etc.)
     * 4. App icon <img> referenced in README.md (local file, direct https:// icon URL, or GitHub raw fallback)
     */
    public static function extractIconUrl(
        string $app_path,
        string $rel_key,
        array $w3c,
        string $html_content,
        string $readme_content,
        string $app_id,
        string $name
    ): ?string {
        $base_web_prefix = 'apps/' . trim($rel_key, '/') . '/';
        $public_base = self::detectHardcodedPublicBase($app_path, $html_content);

        // Helper to validate a local relative path strictly inside $app_path
        $resolve_local = function (string $rel) use ($app_path, $base_web_prefix, $public_base): ?string {
            $raw = preg_replace('/[?#].*$/', '', trim($rel));
            $norm = str_replace('\\', '/', $raw);
            if ($public_base !== null && stripos($norm, $public_base) === 0) {
                $norm = substr($norm, strlen($public_base));
            }
            $clean = ltrim($norm, './');
            if ($clean === '' || strpos($clean, '..') !== false) {
                return null;
            }
            if (file_exists($app_path . '/' . $clean) && is_file($app_path . '/' . $clean)) {
                return $base_web_prefix . $clean;
            }
            return null;
        };

        // Stage 1: <link rel="...icon..." href="..."> (supports both quoted and unquoted HTML5 attributes)
        if ($html_content !== '' && preg_match_all('/<link\b[^>]*>/i', $html_content, $link_tags)) {
            foreach ($link_tags[0] as $tag) {
                if (!preg_match('/\brel\s*=\s*(?:["\'][^"\']*icon[^"\']*["\']|[^\s>]*icon[^\s>]*)/i', $tag)) {
                    continue;
                }
                if (preg_match('/\bhref\s*=\s*(?:["\']([^"\']+)["\']|([^\s>]+))/i', $tag, $hm)) {
                    $rawHref = ($hm[1] !== '') ? $hm[1] : ($hm[2] ?? '');
                    $href = trim(html_entity_decode($rawHref, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
                    if (preg_match('#^data:image/(png|svg\+xml|webp|jpeg|gif|x-icon)(;|,)#i', $href)) {
                        return $href;
                    }
                    $local = $resolve_local($href);
                    if ($local !== null) {
                        return $local;
                    }
                }
            }
        }

        // Stage 2: W3C Web App Manifest icons[]
        if (!empty($w3c['icons']) && is_array($w3c['icons'])) {
            $best_local = null;
            $best_score = -1;
            foreach ($w3c['icons'] as $icon_entry) {
                if (!is_array($icon_entry) || empty($icon_entry['src'])) continue;
                $local = $resolve_local((string)$icon_entry['src']);
                if ($local === null) continue;
                $score = 10;
                $type = strtolower((string)($icon_entry['type'] ?? ''));
                $sizes = strtolower((string)($icon_entry['sizes'] ?? ''));
                if ($type === 'image/svg+xml' || substr(strtolower($local), -4) === '.svg') {
                    $score = 1000;
                } elseif (preg_match('/(\d+)x\d+/', $sizes, $sm)) {
                    $sz = (int)$sm[1];
                    $score = ($sz >= 48 && $sz <= 256) ? (500 + $sz) : $sz;
                }
                if ($score > $best_score) {
                    $best_score = $score;
                    $best_local = $local;
                }
            }
            if ($best_local !== null) {
                return $best_local;
            }
        }

        // Stage 3: Conventional local icon files across common static web directories (including hashed Trunk/Craft icons)
        $conventional_dirs = ['', 'assets/', 'icons/', 'icons/256/', 'img/', 'images/', 'static/', 'public/'];
        $conventional_names = [
            'icon.svg', 'icon.png', 'icon-256.png', 'icon-512.png', 'icon.webp',
            'app-icon.svg', 'app-icon.png',
            'logo.svg', 'logo.png',
            'apple-touch-icon.png',
            'favicon.svg', 'favicon.png', 'favicon.ico'
        ];
        foreach ($conventional_dirs as $dir_prefix) {
            foreach ($conventional_names as $fname) {
                $local = $resolve_local($dir_prefix . $fname);
                if ($local !== null) {
                    return $local;
                }
            }
        }
        // Stage 3b: Globs for app-named or Trunk content-hashed icon assets (e.g. icons/*.svg, *-<hash>.png, *-<hash>.ico)
        $slug_lower_for_glob = strtolower($app_id);
        foreach (['icons/*.svg', 'icons/256/*.png', '*.svg', '*.png', '*.ico'] as $pattern) {
            $matches = glob($app_path . '/' . $pattern) ?: [];
            foreach ($matches as $cand) {
                if (!is_file($cand) || (int)@filesize($cand) <= 0) continue;
                $bn = strtolower(basename($cand));
                if (strpos($bn, 'github') !== false || strpos($bn, 'badge') !== false || strpos($bn, 'hero') !== false || strpos($bn, 'screenshot') !== false) {
                    continue;
                }
                if ($pattern === '*.svg' || $pattern === '*.png' || $pattern === '*.ico') {
                    if ($slug_lower_for_glob !== '' && strpos($bn, $slug_lower_for_glob) === false && strpos($bn, 'icon') === false && strpos($bn, 'favicon') === false) {
                        continue;
                    }
                }
                $rel_cand = ltrim(str_replace('\\', '/', substr($cand, strlen($app_path))), '/');
                return $base_web_prefix . $rel_cand;
            }
        }

        // Stage 4: README.md icon image (HTML <img> and Markdown ![alt](src): local, direct https://, or GitHub raw fallback)
        if ($readme_content !== '') {
            $slug_lower = strtolower($app_id);
            $name_lower = strtolower($name);
            $direct_https_candidate = null;
            $relative_icon_candidate = null;

            $image_refs = [];
            if (preg_match_all('/<img\b[^>]*>/i', $readme_content, $img_tags)) {
                foreach ($img_tags[0] as $tag) {
                    if (!preg_match('/\bsrc\s*=\s*["\']([^"\']+)["\']/i', $tag, $sm)) continue;
                    $alt = '';
                    if (preg_match('/\balt\s*=\s*["\']([^"\']*)["\']/i', $tag, $am)) {
                        $alt = strtolower(trim(html_entity_decode($am[1], ENT_QUOTES | ENT_HTML5, 'UTF-8')));
                    }
                    $image_refs[] = [
                        'src' => trim(html_entity_decode($sm[1], ENT_QUOTES | ENT_HTML5, 'UTF-8')),
                        'alt' => $alt
                    ];
                }
            }
            if (preg_match_all('/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/', $readme_content, $md_imgs, PREG_SET_ORDER)) {
                foreach ($md_imgs as $m) {
                    $image_refs[] = [
                        'src' => trim($m[2]),
                        'alt' => strtolower(trim($m[1]))
                    ];
                }
            }

            foreach ($image_refs as $ref) {
                $src = $ref['src'];
                $alt = $ref['alt'];

                $src_lower = strtolower($src);
                // Ignore status badges / shields
                if (strpos($src_lower, 'shields.io') !== false || strpos($src_lower, 'badge') !== false || strpos($src_lower, 'sonarcloud') !== false) {
                    continue;
                }

                $is_image_ext = (bool)preg_match('/\.(png|svg|webp|ico|jpg|jpeg)(\?.*)?$/i', $src_lower);
                if (!$is_image_ext) {
                    continue;
                }

                $looks_like_app_icon = (
                    strpos($src_lower, 'icon') !== false ||
                    strpos($alt, 'icon') !== false ||
                    strpos($src_lower, 'logo') !== false ||
                    strpos($alt, 'logo') !== false
                );
                $matches_app = (
                    ($slug_lower !== '' && strpos($src_lower, $slug_lower) !== false) ||
                    ($name_lower !== '' && strpos($alt, $name_lower) !== false)
                );

                // Local file referenced in README
                if (!preg_match('#^https?://#i', $src)) {
                    if ($looks_like_app_icon && $matches_app) {
                        $local = $resolve_local($src);
                        if ($local !== null) {
                            return $local;
                        }
                        if ($relative_icon_candidate === null) {
                            $relative_icon_candidate = ltrim(str_replace('\\', '/', $src), './');
                        }
                    }
                    continue;
                }

                // Direct https:// icon URL specifically matching this app
                if (stripos($src, 'https://') === 0 && $looks_like_app_icon && $matches_app) {
                    if ($direct_https_candidate === null) {
                        $direct_https_candidate = $src;
                    }
                }
            }

            if ($direct_https_candidate !== null) {
                return $direct_https_candidate;
            }

            // Fallback: resolve README relative icon path against GitHub repository URL if present
            if ($relative_icon_candidate !== null && strpos($relative_icon_candidate, '..') === false) {
                if (preg_match('#https://github\.com/([a-zA-Z0-9_.-]+)/([a-zA-Z0-9_.-]+)#i', $readme_content, $gm)) {
                    $owner = $gm[1];
                    $repo = rtrim($gm[2], '/');
                    if (stripos($repo, $slug_lower) !== false || $slug_lower === '') {
                        return "https://raw.githubusercontent.com/{$owner}/{$repo}/main/{$relative_icon_candidate}";
                    }
                }
            }
        }

        return null;
    }

    private static function loadAdminOverride(string $project_root, string $app_id, string $folder): array {
        $file = $project_root . '/config/external_apps.json';
        if (!file_exists($file)) {
            return [];
        }
        $decoded = @json_decode((string)@file_get_contents($file), true);
        if (!is_array($decoded)) {
            return [];
        }
        if (isset($decoded[$app_id]) && is_array($decoded[$app_id])) {
            return $decoded[$app_id];
        }
        if (isset($decoded[$folder]) && is_array($decoded[$folder])) {
            return $decoded[$folder];
        }
        return [];
    }

    private static function mergeOverride(array $manifest, array $override): array {
        foreach ($override as $k => $v) {
            if ($k === 'locales' && is_array($v) && isset($manifest['locales'])) {
                foreach ($v as $lang => $loc_data) {
                    if (is_array($loc_data)) {
                        $manifest['locales'][$lang] = array_merge($manifest['locales'][$lang] ?? [], $loc_data);
                    }
                }
            } elseif ($k === 'window' && is_array($v) && isset($manifest['window'])) {
                $manifest['window'] = array_merge($manifest['window'], $v);
            } else {
                $manifest[$k] = $v;
            }
        }
        return $manifest;
    }
}
