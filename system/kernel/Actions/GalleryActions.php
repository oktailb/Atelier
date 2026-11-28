<?php
namespace Atelier\Kernel\Actions;

use Atelier\Kernel\Security\PathValidator;
use Atelier\Kernel\Security\SecurityManager;
use Atelier\Kernel\Auth\AuthManager;
use Atelier\Kernel\FS\CacheManager;
use Atelier\Kernel\FS\DotfileManager;
use Atelier\Kernel\FS\PermissionsManager;
use Atelier\Kernel\FS\ArchiveEngine;
use Atelier\Kernel\Media\BinaryLocator;
use Atelier\Kernel\Media\ExifParser;


/**
 * Kernel Gallery Actions Handler
 * Handles get_gallery, get_metadata, get_all_media_flat, and get_stream_url.
 */
class GalleryActions {

    public static function handle(string $action, array $params, array $context): ?array {
        $base_dir      = $context['base_dir'] ?? '';
        $media_types   = $context['media_types'] ?? [];
        $ignore_list   = $context['ignore_list'] ?? [];
        $gallery_title = $context['gallery_title'] ?? 'Atelier by GallusTech';
        $thumbnail_dir = $context['thumbnail_dir'] ?? '.thumbnails';

        switch ($action) {
            case 'get_gallery':
                return self::getGallery($params, $base_dir, $media_types, $ignore_list, $gallery_title, $thumbnail_dir);

            case 'get_metadata':
                return self::getMetadata($params, $base_dir, $media_types);

            case 'get_all_media_flat':
                return self::getAllMediaFlat($base_dir, $media_types, $ignore_list);

            case 'get_stream_url':
                return self::getStreamUrl($params, $base_dir);

            default:
                return null;
        }
    }

    public static function getGallery(array $params, string $base_dir, array $media_types, array $ignore_list, string $gallery_title, string $thumbnail_dir): array {
        $requested_dir = $params['dir'] ?? '';

        // Phase B: Transparent Virtual Mount browsing (`ext://<mount_id>/...`)
        $extParsed = \Atelier\Kernel\Storage\ExternalMountManager::parseExternalPath((string)$requested_dir);
        if ($extParsed !== null) {
            return self::getExternalGallery($extParsed, $base_dir, $media_types, $gallery_title);
        }

        $target_dir = PathValidator::sanitizePath($requested_dir, $base_dir);

        if (!$target_dir || !is_dir($target_dir)) {
            return [
                'status' => 404,
                'data'   => ['success' => false, 'error' => __t('api.err_folder_not_found', [], null, $base_dir)]
            ];
        }

        $access_info = DotfileManager::getEffectiveAccessInfo($target_dir, $base_dir);
        if ($access_info['is_private'] && empty($access_info['is_accessible']) && !AuthManager::isAdminLoggedIn()) {
            return [
                'status' => 403,
                'data'   => ['success' => false, 'error' => __t('api.err_private_access', [], null, $base_dir)]
            ];
        }

        if ($access_info['is_protected'] && !$access_info['is_unlocked'] && empty($access_info['is_accessible']) && !AuthManager::isAdminLoggedIn()) {
            return [
                'status' => 200,
                'data'   => [
                    'success'      => true,
                    'is_locked'    => true,
                    'access_mode'  => 'password',
                    'current_path' => $access_info['blocking_rel_path'] ?? PathValidator::getRelativePath($target_dir, $base_dir),
                    'message'      => __t('api.msg_password_required', [], null, $base_dir)
                ]
            ];
        }

        $folder_overrides = DotfileManager::getFolderOverrides($target_dir, $base_dir);
        $comments         = DotfileManager::loadDirComments($target_dir);
        $current_relative = PathValidator::getRelativePath($target_dir, $base_dir);

        // Build breadcrumbs
        $breadcrumbs = [['name' => $gallery_title, 'path' => '']];
        if ($current_relative !== '') {
            $parts = explode('/', $current_relative);
            $accumulated = '';
            foreach ($parts as $part) {
                $accumulated = ($accumulated === '') ? $part : $accumulated . '/' . $part;
                $part_dir = PathValidator::sanitizePath($accumulated, $base_dir);
                $part_title = $part;

                if ($part_dir && file_exists($part_dir . '/.title')) {
                    $custom_t = trim(@file_get_contents($part_dir . '/.title'));
                    if ($custom_t !== '') $part_title = $custom_t;
                }

                $breadcrumbs[] = [
                    'name' => $part_title,
                    'path' => $accumulated
                ];
            }
        }

        // Parent path
        $parent_path = null;
        if ($current_relative !== '') {
            $parent_dir_full = str_replace('\\', '/', dirname($target_dir));
            $users_root_norm = rtrim(str_replace('\\', '/', realpath(PathValidator::getUsersRoot($base_dir)) ?: PathValidator::getUsersRoot($base_dir)), '/');
            $base_norm = rtrim(str_replace('\\', '/', realpath($base_dir) ?: $base_dir), '/');
            if ($current_relative === 'users') {
                $parent_path = '';
            } elseif (strpos($parent_dir_full, $base_norm) === 0 || $parent_dir_full === $users_root_norm || strpos($parent_dir_full, $users_root_norm . '/') === 0) {
                $candidate_parent = PathValidator::getRelativePath($parent_dir_full, $base_dir);
                // If parent is inaccessible (e.g., `users/` for a non-admin inside their own home), fall back cleanly to public root
                if ($candidate_parent !== '' && !DotfileManager::isDirAccessible($parent_dir_full, $base_dir)) {
                    $parent_path = '';
                } else {
                    $parent_path = $candidate_parent;
                }
            }
        }

        $directories = [];
        $files = [];

        $cache_file_path = CacheManager::getDirCacheFilePath($target_dir, $base_dir, $thumbnail_dir);
        $cached_raw = null;

        if (CacheManager::isDirCacheValid($cache_file_path, $target_dir)) {
            $json_content = @file_get_contents($cache_file_path);
            if ($json_content) {
                $decoded = @json_decode($json_content, true);
                if (is_array($decoded) && isset($decoded['raw_items'])) {
                    $cached_raw = $decoded['raw_items'];
                }
            }
        }

        if ($cached_raw !== null) {
            if (empty($cached_raw['directories']) && empty($cached_raw['files'])) {
                $real_items = @scandir($target_dir) ?: [];
                foreach ($real_items as $ri) {
                    if ($ri[0] !== '.' && !in_array($ri, $ignore_list, true)) {
                        $cached_raw = null;
                        break;
                    }
                }
            }
        }

        if ($cached_raw !== null) {
            // CACHE HIT
            foreach ($cached_raw['directories'] as $dir_item) {
                $full_item_path = $target_dir . '/' . $dir_item['raw_name'];
                $sub_access = DotfileManager::getEffectiveAccessInfo($full_item_path, $base_dir);

                if ($sub_access['is_private'] && empty($sub_access['is_accessible']) && !AuthManager::isAdminLoggedIn()) {
                    continue;
                }

                $dir_display_name = $dir_item['raw_name'];
                if (file_exists($full_item_path . '/.title')) {
                    $custom_title = trim(@file_get_contents($full_item_path . '/.title'));
                    if ($custom_title !== '') {
                        $dir_display_name = $custom_title;
                    }
                }

                $cover_thumb = null;
                if ($sub_access['is_unlocked'] || AuthManager::isAdminLoggedIn()) {
                    $cover_exts = array_merge($media_types['image'] ?? [], $media_types['video'] ?? []);
                    $cover_thumb = ExifParser::findFirstImageThumbnail($full_item_path, $base_dir, $cover_exts);
                }

                $sub_items = @scandir($full_item_path) ?: [];
                $live_item_count = 0;
                foreach ($sub_items as $sub) {
                    if ($sub[0] !== '.' && !in_array($sub, $ignore_list, true)) {
                        $live_item_count++;
                    }
                }

                $directories[] = [
                    'name'         => $dir_display_name,
                    'raw_name'     => $dir_item['raw_name'],
                    'path'         => $dir_item['path'],
                    'mtime'        => $dir_item['mtime'],
                    'item_count'   => $live_item_count,
                    'cover'        => $cover_thumb,
                    'comment'      => $comments[$dir_item['raw_name']] ?? '',
                    'access_mode'  => $sub_access['access_mode'],
                    'is_private'   => $sub_access['is_private'],
                    'is_protected' => $sub_access['is_protected'],
                    'is_unlocked'  => $sub_access['is_unlocked']
                ];
            }

            foreach ($cached_raw['files'] as $file_item) {
                $file_item['comment'] = $comments[$file_item['name']] ?? '';
                if (isset($file_item['thumb_url']) && str_starts_with($file_item['thumb_url'], 'thumb.php?')) {
                    $file_item['thumb_url'] = 'system/endpoints/' . $file_item['thumb_url'];
                }
                if (isset($file_item['file_url']) && str_starts_with($file_item['file_url'], 'thumb.php?')) {
                    $file_item['file_url'] = 'system/endpoints/' . $file_item['file_url'];
                }
                $files[] = $file_item;
            }
        } else {
            // CACHE MISS: Full disk scan & EXIF extraction
            $raw_directories = [];
            $raw_files = [];

            $scan_items = @scandir($target_dir);
            if ($scan_items !== false) {
                foreach ($scan_items as $item) {
                    if (in_array($item, $ignore_list, true) || $item[0] === '.') {
                        continue;
                    }

                    $full_item_path = $target_dir . '/' . $item;
                    $item_relative = PathValidator::getRelativePath($full_item_path, $base_dir);

                    if (is_dir($full_item_path)) {
                        $sub_access = DotfileManager::getEffectiveAccessInfo($full_item_path, $base_dir);

                        $sub_items = @scandir($full_item_path) ?: [];
                        $item_count = 0;
                        foreach ($sub_items as $sub) {
                            $sub_ext = strtolower(pathinfo($sub, PATHINFO_EXTENSION));
                            if ($sub[0] !== '.' && !in_array($sub, $ignore_list, true) && !in_array($sub_ext, ['php', 'phtml', 'phar', 'htaccess', 'ini', 'hash'], true)) {
                                $item_count++;
                            }
                        }

                        $raw_directories[] = [
                            'raw_name'   => $item,
                            'path'       => $item_relative,
                            'mtime'      => filemtime($full_item_path),
                            'item_count' => $item_count
                        ];

                        if ($sub_access['is_private'] && empty($sub_access['is_accessible']) && !AuthManager::isAdminLoggedIn()) {
                            continue;
                        }

                        $dir_display_name = $item;
                        if (file_exists($full_item_path . '/.title')) {
                            $custom_title = trim(@file_get_contents($full_item_path . '/.title'));
                            if ($custom_title !== '') {
                                $dir_display_name = $custom_title;
                            }
                        }

                        $cover_thumb = null;
                        if ($sub_access['is_unlocked'] || AuthManager::isAdminLoggedIn()) {
                            $cover_exts = array_merge($media_types['image'] ?? [], $media_types['video'] ?? []);
                            $cover_thumb = ExifParser::findFirstImageThumbnail($full_item_path, $base_dir, $cover_exts);
                        }

                        $directories[] = [
                            'name'         => $dir_display_name,
                            'raw_name'     => $item,
                            'path'         => $item_relative,
                            'mtime'        => filemtime($full_item_path),
                            'item_count'   => $item_count,
                            'cover'        => $cover_thumb,
                            'comment'      => $comments[$item] ?? '',
                            'access_mode'  => $sub_access['access_mode'],
                            'is_private'   => $sub_access['is_private'],
                            'is_protected' => $sub_access['is_protected'],
                            'is_unlocked'  => $sub_access['is_unlocked']
                        ];
                    } elseif (is_file($full_item_path)) {
                        $ext = strtolower(pathinfo($item, PATHINFO_EXTENSION));
                        $forbidden_system_exts = ['php', 'phtml', 'php3', 'php4', 'php5', 'phps', 'phar', 'inc', 'js', 'css', 'html', 'htm', 'htaccess', 'htpasswd', 'sh', 'bat', 'cmd', 'exe', 'dll', 'py', 'pl', 'cgi', 'hash', 'ini', 'sql', 'bak', 'json'];
                        if ($ext === '' || in_array($ext, $forbidden_system_exts, true) || in_array($item, $ignore_list, true)) {
                            continue;
                        }
                        $category = ExifParser::getMediaCategory($ext, $media_types);
                        $size = filesize($full_item_path);
                        $mtime = filemtime($full_item_path);

                        $exif = ($category === 'image') ? ExifParser::extractExifData($full_item_path) : null;
                        $effective_mtime = ($exif && !empty($exif['date_ts'])) ? $exif['date_ts'] : $mtime;

                        $file_entry = [
                            'name'           => $item,
                            'path'           => $item_relative,
                            'extension'      => $ext,
                            'category'       => $category,
                            'size'           => $size,
                            'size_formatted' => ExifParser::formatBytes($size),
                            'mtime'          => $mtime,
                            'effective_mtime'=> $effective_mtime,
                            'exif'           => $exif,
                            'thumb_url'      => 'system/endpoints/thumb.php?file=' . rawurlencode($item_relative),
                            'file_url'       => 'system/endpoints/thumb.php?file=' . rawurlencode($item_relative) . '&raw=1',
                            'comment'        => $comments[$item] ?? ''
                        ];

                        $raw_files[] = $file_entry;
                        $files[]     = $file_entry;
                    }
                }
            }

            $cache_payload = [
                'created_at' => time(),
                'raw_items'  => [
                    'directories' => $raw_directories,
                    'files'       => $raw_files
                ]
            ];
            @file_put_contents($cache_file_path, json_encode($cache_payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);
        }

        usort($directories, function($a, $b) {
            return strnatcasecmp($a['name'], $b['name']);
        });
        usort($files, function($a, $b) {
            return strnatcasecmp($a['name'], $b['name']);
        });

        $output_data = [
            'success'           => true,
            'csrf_token'        => SecurityManager::getCsrfToken(),
            'title'             => $folder_overrides['title'] ?? $gallery_title,
            'current_path'      => $current_relative,
            'parent_path'       => $parent_path,
            'breadcrumbs'       => $breadcrumbs,
            'overrides'         => $folder_overrides,
            'directories'       => $directories,
            'files'             => $files,
            'is_admin'          => AuthManager::isAdminLoggedIn(),
            'admin_enabled'     => !empty(AuthManager::getPasswordHash('', $base_dir)),
            'user_permissions'  => PermissionsManager::resolveEffectivePermissions($base_dir),
            'user_rights'        => [
                'is_admin'             => AuthManager::isAdminLoggedIn(),
                'can_upload'           => PermissionsManager::hasPermission('can_upload', $base_dir, $current_relative),
                'can_delete'           => PermissionsManager::hasPermission('can_delete', $base_dir, $current_relative),
                'can_move'             => PermissionsManager::hasPermission('can_move', $base_dir, $current_relative),
                'can_comment'          => PermissionsManager::hasPermission('can_comment', $base_dir, $current_relative),
                'can_create_folder'    => PermissionsManager::hasPermission('can_create_folder', $base_dir, $current_relative),
                'can_download_archive' => PermissionsManager::hasPermission('can_download_archive', $base_dir, $current_relative),
                'can_download_item'    => PermissionsManager::hasPermission('can_download_item', $base_dir, $current_relative)
            ],
            'available_archives'=> BinaryLocator::findArchiveBinaries(),

            'stats'             => [
                'directory_count' => count($directories),
                'file_count'      => count($files)
            ]
        ];

        return ['status' => 200, 'data' => $output_data];
    }

    /**
     * Phase B: Renders an external storage mount (`ext://<mount_id>/...`) in standard Explorer gallery format.
     */
    private static function getExternalGallery(array $extParsed, string $base_dir, array $media_types, string $gallery_title): array {
        $project_root = \Atelier\Kernel\Config\ConfigStore::resolveRoot($base_dir);
        $mountId = (int)$extParsed['mount_id'];
        $rel = (string)$extParsed['rel_path'];
        $resolved = \Atelier\Kernel\Storage\ExternalMountManager::resolveMountForCurrentUser($project_root, $mountId);
        if (!$resolved) {
            return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied', [], null, $base_dir)]];
        }

        $mount = $resolved['mount'];
        $driver = $resolved['driver'];
        $canWrite = !empty($resolved['can_write']);
        $prefix = 'ext://' . $mountId;
        $currentPath = $rel === '' ? $prefix : ($prefix . '/' . $rel);

        try {
            $listing = $driver->listDir($rel);
        } catch (\Throwable $e) {
            return ['status' => 502, 'data' => [
                'success' => false,
                'error'   => 'External storage error: ' . $e->getMessage()
            ]];
        }
        if (!empty($listing['error'])) {
            return ['status' => 502, 'data' => [
                'success' => false,
                'error'   => (string)$listing['error']
            ]];
        }
        $directories = [];
        foreach ($listing['directories'] ?? [] as $d) {
            $dPath = $prefix . '/' . ltrim((string)$d['path'], '/');
            $directories[] = [
                'name'      => (string)$d['name'],
                'raw_name'  => (string)$d['name'],
                'path'      => $dPath,
                'mtime'     => (int)($d['mtime'] ?? 0),
                'count'     => 0,
                'cover_url' => null,
                'is_locked' => false,
                'is_private'=> false
            ];
        }

        $files = [];
        foreach ($listing['files'] ?? [] as $f) {
            $name = (string)$f['name'];
            $mime = (string)($f['mime'] ?? '');
            $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
            if ($ext === '' && $mime !== '') {
                $ext = \Atelier\Kernel\Storage\GoogleDriveStorageDriver::inferExtensionFromMime($mime);
            }
            $cat = ExifParser::getMediaCategory($ext, $media_types);
            $fPath = $prefix . '/' . ltrim((string)$f['path'], '/');
            $encPath = rawurlencode($fPath);
            $size = (int)($f['size'] ?? 0);
            $mtime = (int)($f['mtime'] ?? 0);
            $cacheVer = ($mtime > 0 || $size > 0) ? ('&v=' . $mtime . '_' . $size) : '';
            $files[] = [
                'name'           => $name,
                'path'           => $fPath,
                'extension'      => $ext,
                'mime'           => $mime,
                'category'       => $cat,
                'size'           => $size,
                'size_formatted' => ExifParser::formatBytes($size),
                'mtime'          => $mtime,
                'date_formatted' => $mtime > 0 ? date('d/m/Y H:i', $mtime) : '',
                'thumb_url'      => 'system/endpoints/thumb.php?file=' . $encPath . $cacheVer,
                'file_url'       => 'system/endpoints/thumb.php?file=' . $encPath . '&raw=1',
                'download_url'   => 'system/endpoints/thumb.php?file=' . $encPath . '&download=1',
                'comment'        => '',
                'external_driver'=> (string)$mount['driver']
            ];
        }

        $breadcrumbs = [
            ['name' => $gallery_title, 'path' => ''],
            ['name' => ($mount['mount_icon'] ?? '☁️') . ' ' . $mount['mount_name'], 'path' => $prefix]
        ];
        $parentPath = '';
        if ($rel !== '') {
            $parts = explode('/', $rel);
            $acc = '';
            foreach ($parts as $p) {
                $acc = $acc === '' ? $p : ($acc . '/' . $p);
                $breadcrumbs[] = ['name' => $p, 'path' => $prefix . '/' . $acc];
            }
            $parentRel = strpos($rel, '/') !== false ? dirname($rel) : '';
            $parentPath = $parentRel === '' ? $prefix : ($prefix . '/' . $parentRel);
        }

        return ['status' => 200, 'data' => [
            'success'            => true,
            'csrf_token'         => SecurityManager::getCsrfToken(),
            'title'              => (string)$mount['mount_name'],
            'current_path'       => $currentPath,
            'parent_path'        => $parentPath,
            'breadcrumbs'        => $breadcrumbs,
            'overrides'          => [],
            'directories'        => $directories,
            'files'              => $files,
            'is_admin'           => AuthManager::isAdminLoggedIn(),
            'is_external_mount'  => true,
            'external_driver'    => (string)$mount['driver'],
            'user_permissions'   => PermissionsManager::resolveEffectivePermissions($base_dir),
            'user_rights'        => [
                'is_admin'             => AuthManager::isAdminLoggedIn(),
                'can_upload'           => $canWrite,
                'can_delete'           => $canWrite,
                'can_move'             => $canWrite,
                'can_comment'          => false,
                'can_create_folder'    => $canWrite,
                'can_download_archive' => false,
                'can_download_item'    => true
            ],
            'stats'              => [
                'directory_count' => count($directories),
                'file_count'      => count($files)
            ]
        ]];
    }

    public static function getMetadata(array $params, string $base_dir, array $media_types): array {
        $file_param = $params['file'] ?? '';
        $file_path = PathValidator::sanitizeFilePath($file_param, $base_dir);

        if (!$file_path || !is_file($file_path)) {
            return [
                'status' => 404,
                'data'   => ['success' => false, 'error' => __t('api.err_file_not_found', [], null, $base_dir)]
            ];
        }

        if (!AuthManager::isDirAccessible(dirname($file_path), $base_dir)) {
            return [
                'status' => 403,
                'data'   => ['success' => false, 'error' => __t('api.err_access_denied', [], null, $base_dir)]
            ];
        }

        $filename = basename($file_path);
        $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        $category = ExifParser::getMediaCategory($ext, $media_types);
        $metadata = get_file_unified_metadata($file_path, $filename, $category, $ext);

        return [
            'status' => 200,
            'data'   => [
                'success'  => true,
                'metadata' => $metadata
            ]
        ];

    }

    public static function getAllMediaFlat(string $base_dir, array $media_types, array $ignore_list): array {
        $all_files = [];
        if (!is_dir($base_dir) || !DotfileManager::isDirAccessible($base_dir, $base_dir)) {
            return [
                'status' => 200,
                'data'   => [
                    'success' => true,
                    'files'   => [],
                    'count'   => 0
                ]
            ];
        }

        $dir_iterator = new \RecursiveDirectoryIterator($base_dir, \RecursiveDirectoryIterator::SKIP_DOTS);
        $filter_iterator = new \RecursiveCallbackFilterIterator($dir_iterator, function ($current) use ($base_dir, $ignore_list): bool {
            $name = $current->getFilename();
            if ($name === '' || $name[0] === '.' || in_array($name, $ignore_list, true)) {
                return false;
            }
            if ($current->isDir()) {
                return DotfileManager::isDirAccessible($current->getPathname(), $base_dir);
            }
            return true;
        });

        $iterator = new \RecursiveIteratorIterator(
            $filter_iterator,
            \RecursiveIteratorIterator::LEAVES_ONLY
        );

        foreach ($iterator as $item) {
            if ($item->isFile()) {
                $ext = strtolower($item->getExtension());
                if (in_array($ext, $media_types['image'] ?? [], true) || in_array($ext, $media_types['video'] ?? [], true) || in_array($ext, $media_types['audio'] ?? [], true)) {
                    $rel = PathValidator::getRelativePath($item->getPathname(), $base_dir);
                    $all_files[] = [
                        'name'      => $item->getFilename(),
                        'path'      => $rel,
                        'extension' => $ext,
                        'category'  => ExifParser::getMediaCategory($ext, $media_types),
                        'thumb_url' => 'system/endpoints/thumb.php?file=' . rawurlencode($rel),
                        'file_url'  => 'system/endpoints/thumb.php?file=' . rawurlencode($rel) . '&raw=1'
                    ];
                }
            }
        }

        return [
            'status' => 200,
            'data'   => [
                'success' => true,
                'files'   => $all_files,
                'count'   => count($all_files)
            ]
        ];
    }

    public static function getStreamUrl(array $params, string $base_dir): array {
        $file_param = $params['file'] ?? '';
        $file_path = PathValidator::sanitizeFilePath($file_param, $base_dir);

        if (!$file_path || !is_file($file_path)) {
            return [
                'status' => 404,
                'data'   => ['success' => false, 'error' => __t('api.err_file_not_found', [], null, $base_dir)]
            ];
        }

        if (!DotfileManager::isDirAccessible(dirname($file_path), $base_dir)) {
            return [
                'status' => 403,
                'data'   => ['success' => false, 'error' => __t('api.err_access_denied', [], null, $base_dir)]
            ];
        }

        $rel = PathValidator::getRelativePath($file_path, $base_dir);
        return [
            'status' => 200,
            'data'   => [
                'success'    => true,
                'stream_url' => 'system/endpoints/thumb.php?file=' . rawurlencode($rel) . '&raw=1'
            ]
        ];
    }
}
