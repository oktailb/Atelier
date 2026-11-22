<?php
namespace SimpleGallery\Kernel;

/**
 * Synthesizes a full SimpleGallery WebOS manifest for third-party standalone
 * web application distributions (static HTML/JS/WASM/PWA folders dropped into
 * `apps/` without a native SimpleGallery `manifest.json` or `app.js`).
 */
class StandaloneWebAppManifestSynthesizer {

    /**
     * Curated map of known document/media/creative formats to MIME types.
     * Excludes OS installer/package formats (.deb, .rpm, .msi, .dmg, .exe, etc.).
     */
    private const KNOWN_FORMAT_MIMES = [
        // Raster, layered & vector graphics
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
        'png'      => 'image/png',
        'jpg'      => 'image/jpeg',
        'jpeg'     => 'image/jpeg',
        'webp'     => 'image/webp',
        'gif'      => 'image/gif',
        'bmp'      => 'image/bmp',
        'svg'      => 'image/svg+xml',
        'tiff'     => 'image/tiff',
        'tif'      => 'image/tiff',
        'tga'      => 'image/x-tga',
        'ico'      => 'image/x-icon',
        'qoi'      => 'image/qoi',
        'pnm'      => 'image/x-portable-anymap',
        'exr'      => 'image/x-exr',
        'hdr'      => 'image/vnd.radiance',
        'fits'     => 'image/fits',
        'heic'     => 'image/heic',
        'heif'     => 'image/heif',
        'avif'     => 'image/avif',
        'dng'      => 'image/x-adobe-dng',
        'eps'      => 'application/postscript',
        // Video
        'mp4'      => 'video/mp4',
        'webm'     => 'video/webm',
        'mkv'      => 'video/x-matroska',
        'mov'      => 'video/quicktime',
        'avi'      => 'video/x-msvideo',
        'ogv'      => 'video/ogg',
        // Audio
        'mp3'      => 'audio/mpeg',
        'wav'      => 'audio/wav',
        'ogg'      => 'audio/ogg',
        'flac'     => 'audio/flac',
        'aac'      => 'audio/aac',
        'm4a'      => 'audio/mp4',
        'mid'      => 'audio/midi',
        'midi'     => 'audio/midi',
        // Documents & Office
        'pdf'      => 'application/pdf',
        'epub'     => 'application/epub+zip',
        'md'       => 'text/markdown',
        'txt'      => 'text/plain',
        'rtf'      => 'application/rtf',
        'odt'      => 'application/vnd.oasis.opendocument.text',
        'ods'      => 'application/vnd.oasis.opendocument.spreadsheet',
        'odp'      => 'application/vnd.oasis.opendocument.presentation',
        'docx'     => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xlsx'     => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'pptx'     => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'csv'      => 'text/csv',
        'tsv'      => 'text/tab-separated-values',
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
        if (file_exists($app_path . '/manifest.json') || file_exists($app_path . '/app.js') || file_exists($app_path . '/' . $folder . '.js')) {
            return false;
        }
        return self::detectHtmlEntryFile($app_path) !== null;
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

        // 4. Detect WebAssembly / Canvas runtime traits & renderer flags
        $is_wasm = self::detectWasmPresence($app_path, $html_content);
        $renderer_flags = self::extractRendererFlags($hosting_content . "\n" . $readme_content);

        // 5. Extract File Associations (W3C file_handlers -> HTML accept -> README Formats)
        $extracted_formats = self::extractFileAssociations($w3c, $html_content, $readme_content);
        $extensions = $extracted_formats['extensions'];
        $mime_types = $extracted_formats['mimeTypes'];

        // 6. Infer Category & Icon
        $parent_cat = (strpos($rel_key, '/') !== false) ? dirname($rel_key) : '';
        $inferred = self::inferCategoryAndIcon($parent_cat, $w3c, $name, $description, $extensions);
        $category = $inferred['category'];
        $icon = $inferred['icon'];

        // 7. Capabilities
        $capabilities = ['standalone-web', 'iframe-host', 'fullscreen'];
        if ($is_wasm) {
            $capabilities[] = 'wasm';
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
            'category'      => $category,
            'distribution'  => 'standalone-web',
            'runtime'       => 'iframe',
            'synthetic'     => true,
            'source_folder' => $folder,
            'entry'         => [
                'html' => $html_entry
            ],
            'extensions'    => $extensions,
            'mimeTypes'     => $mime_types,
            'capabilities'  => $capabilities,
            'rendererFlags' => $renderer_flags,
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

    private static function extractFileAssociations(array $w3c, string $html_content, string $readme_content): array {
        $ext_set = [];
        $mime_set = [];

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
                        if (isset(self::KNOWN_FORMAT_MIMES[$clean])) {
                            $ext_set[$clean] = true;
                            $mime_set[self::KNOWN_FORMAT_MIMES[$clean]] = true;
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
                        if (isset(self::KNOWN_FORMAT_MIMES[$e])) {
                            $ext_set[$e] = true;
                            $mime_set[self::KNOWN_FORMAT_MIMES[$e]] = true;
                        }
                    }
                }

                // Match uppercase/prose format tokens like PSD, PSB, PNG, JPEG, XCF, WebP, SVG, OpenEXR
                if (preg_match_all('/\b([a-zA-Z0-9]{2,12})\b/', $plain_block, $word_matches)) {
                    foreach ($word_matches[1] as $word) {
                        $w = strtolower($word);
                        if (isset(self::FORMAT_PROSE_ALIASES[$w])) {
                            foreach (self::FORMAT_PROSE_ALIASES[$w] as $mapped_ext) {
                                $ext_set[$mapped_ext] = true;
                                if (isset(self::KNOWN_FORMAT_MIMES[$mapped_ext])) {
                                    $mime_set[self::KNOWN_FORMAT_MIMES[$mapped_ext]] = true;
                                }
                            }
                        } elseif (isset(self::KNOWN_FORMAT_MIMES[$w])) {
                            // Avoid false positives on short ambiguous common English words ("af", "or", "raw", etc.)
                            // unless written uppercase or with leading dot (handled above)
                            if (strlen($w) >= 3 || strtoupper($word) === $word) {
                                $ext_set[$w] = true;
                                $mime_set[self::KNOWN_FORMAT_MIMES[$w]] = true;
                            }
                        }
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

    private static function inferCategoryAndIcon(string $parent_cat, array $w3c, string $name, string $desc, array $extensions): array {
        $text = strtolower($name . ' ' . $desc);
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

        if ($has_ext(['psd', 'psb', 'xcf', 'kra', 'ora', 'pcraft', 'afphoto', 'svg']) || preg_match('/\b(image|photo|photoshop|paint|vector|draw|illustrat|canvas|pixel)\b/i', $text)) {
            return ['category' => $category ?: 'media', 'icon' => '🎨'];
        }
        if ($has_ext(['mp4', 'webm', 'mkv', 'mov']) || preg_match('/\b(video|film|cinema|motion)\b/i', $text)) {
            return ['category' => $category ?: 'media', 'icon' => '🎬'];
        }
        if ($has_ext(['mp3', 'wav', 'flac', 'mid', 'midi']) || preg_match('/\b(audio|sound|music|synth|daw)\b/i', $text)) {
            return ['category' => $category ?: 'media', 'icon' => '🎵'];
        }
        if ($has_ext(['pdf', 'odt', 'ods', 'docx', 'xlsx', 'epub']) || preg_match('/\b(pdf|document|spreadsheet|word|office|markdown)\b/i', $text)) {
            return ['category' => $category ?: 'productivity', 'icon' => '📑'];
        }
        if ($has_ext(['obj', 'stl', 'gltf', 'glb', 'dxf']) || preg_match('/\b(cad|3d|mesh|model)\b/i', $text)) {
            return ['category' => $category ?: 'utilities', 'icon' => '🧊'];
        }
        if ($has_ext(['nes', 'gb', 'gba', 'wad']) || preg_match('/\b(game|emulator|retro|arcade|puzzle|chess)\b/i', $text)) {
            return ['category' => $category ?: 'games', 'icon' => '🎮'];
        }

        return ['category' => $category ?: 'utilities', 'icon' => '🌐'];
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
