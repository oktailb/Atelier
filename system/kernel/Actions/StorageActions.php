<?php
/**
 * Atelier by GallusTech - Phase B Storage, External Mounts, Chunked Uploads, Trash, Versioning & File Index Controller
 */

namespace SimpleGallery\Kernel\Actions;

use SimpleGallery\Kernel\Auth\AuthManager;
use SimpleGallery\Kernel\Config\ConfigStore;
use SimpleGallery\Kernel\FS\CacheManager;
use SimpleGallery\Kernel\FS\ChunkedUploadManager;
use SimpleGallery\Kernel\FS\DotfileManager;
use SimpleGallery\Kernel\FS\FileIndexManager;
use SimpleGallery\Kernel\FS\PermissionsManager;
use SimpleGallery\Kernel\FS\TrashAndVersioningManager;
use SimpleGallery\Kernel\Security\PathValidator;
use SimpleGallery\Kernel\Storage\ExternalMountManager;

class StorageActions {

    public static function handle(string $action, array $params, $context): ?array {
        $base_dir      = is_array($context) ? ($context['base_dir'] ?? '') : (string)$context;
        $project_root  = (is_array($context) && !empty($context['project_root']))
            ? (string)$context['project_root']
            : ConfigStore::resolveRoot($base_dir);
        $media_types   = is_array($context) ? ($context['media_types'] ?? []) : [];
        $ignore_list   = is_array($context) ? ($context['ignore_list'] ?? []) : [];
        $thumbnail_dir = is_array($context) ? ($context['thumbnail_dir'] ?? '.thumbnails') : '.thumbnails';
        $raw_body      = is_array($context) ? ($context['raw_body'] ?? $params) : $params;
        $in            = array_merge($_GET, $_POST, is_array($raw_body) ? $raw_body : []);

        // ---------------------------------------------------------------------
        // 1. EXTERNAL CLOUD & STORAGE MOUNTS (`ext://<id>`)
        // ---------------------------------------------------------------------
        if ($action === 'list_external_mounts') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            return ['status' => 200, 'data' => [
                'success' => true,
                'mounts'  => ExternalMountManager::listAccessibleMounts($project_root)
            ]];
        }

        if ($action === 'create_external_mount') {
            $res = ExternalMountManager::createMount($project_root, $in);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'delete_external_mount') {
            $id = (int)($in['mount_id'] ?? $in['id'] ?? 0);
            $res = ExternalMountManager::deleteMount($project_root, $id);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'test_external_mount') {
            $id = (int)($in['mount_id'] ?? $in['id'] ?? 0);
            $res = ExternalMountManager::testMount($project_root, $id);
            return ['status' => $res['status'], 'data' => $res];
        }

        // ---------------------------------------------------------------------
        // 2. RESUMABLE CHUNKED UPLOADS
        // ---------------------------------------------------------------------
        if ($action === 'upload_chunk_init') {
            $res = ChunkedUploadManager::initUpload($project_root, $base_dir, $media_types, $in);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'upload_chunk') {
            $uploadId = (string)($in['upload_id'] ?? '');
            $chunkIndex = (int)($in['chunk_index'] ?? -1);
            $tmpFile = isset($_FILES['chunk']['tmp_name']) && is_string($_FILES['chunk']['tmp_name'])
                ? $_FILES['chunk']['tmp_name']
                : (isset($_FILES['file']['tmp_name']) && is_string($_FILES['file']['tmp_name']) ? $_FILES['file']['tmp_name'] : null);
            $rawData = ($tmpFile === null && isset($in['chunk_base64'])) ? base64_decode((string)$in['chunk_base64'], true) : null;
            $res = ChunkedUploadManager::storeChunk($project_root, $uploadId, $chunkIndex, $tmpFile, is_string($rawData) ? $rawData : null);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'upload_chunk_complete') {
            $uploadId = (string)($in['upload_id'] ?? '');
            $res = ChunkedUploadManager::completeUpload($project_root, $base_dir, $media_types, $uploadId, $thumbnail_dir);
            return ['status' => $res['status'], 'data' => $res];
        }

        // ---------------------------------------------------------------------
        // 3. SOFT-DELETE TRASH (30-Day Retention & 1-Click Restore)
        // ---------------------------------------------------------------------
        if ($action === 'list_trash') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $all = !empty($in['all']) && AuthManager::isAdminLoggedIn();
            return ['status' => 200, 'data' => [
                'success' => true,
                'items'   => TrashAndVersioningManager::listTrash($project_root, null, $all)
            ]];
        }

        if ($action === 'restore_trash_item') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $trashId = (string)($in['trash_id'] ?? $in['id'] ?? '');
            $res = TrashAndVersioningManager::restoreItem($project_root, $base_dir, $trashId);
            if (!empty($res['success']) && !empty($res['restored_path'])) {
                $abs = PathValidator::sanitizePath((string)$res['restored_path'], $base_dir);
                if ($abs) {
                    CacheManager::invalidateDirCache(dirname($abs), $base_dir, $thumbnail_dir);
                    if (is_file($abs)) FileIndexManager::upsertFile($project_root, $base_dir, $abs, $media_types);
                }
            }
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'purge_trash_item') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $trashId = (string)($in['trash_id'] ?? $in['id'] ?? '');
            $res = TrashAndVersioningManager::purgeItem($project_root, $trashId);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'empty_trash') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $res = TrashAndVersioningManager::emptyTrash($project_root);
            return ['status' => $res['status'], 'data' => $res];
        }

        // ---------------------------------------------------------------------
        // 4. LIGHTWEIGHT FILE VERSIONING
        // ---------------------------------------------------------------------
        if ($action === 'list_file_versions') {
            $fileParam = trim((string)($in['file'] ?? $in['path'] ?? ''));
            $abs = PathValidator::sanitizeFile($fileParam, $base_dir);
            if (!$abs || !is_file($abs)) {
                return ['status' => 404, 'data' => ['success' => false, 'error' => __t('api.err_file_not_found')]];
            }
            if (!DotfileManager::isDirAccessible(dirname($abs), $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $rel = PathValidator::getRelativePath($abs, $base_dir);
            return ['status' => 200, 'data' => [
                'success'  => true,
                'path'     => $rel,
                'versions' => TrashAndVersioningManager::listVersions($project_root, $rel)
            ]];
        }

        if ($action === 'restore_file_version') {
            $fileParam = trim((string)($in['file'] ?? $in['path'] ?? ''));
            $versionId = trim((string)($in['version_id'] ?? ''));
            $abs = PathValidator::sanitizeFile($fileParam, $base_dir);
            if (!$abs || !is_file($abs)) {
                return ['status' => 404, 'data' => ['success' => false, 'error' => __t('api.err_file_not_found')]];
            }
            $rel = PathValidator::getRelativePath($abs, $base_dir);
            if (!PermissionsManager::hasPermission('can_upload', $base_dir, $rel) && !AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_save_denied')]];
            }
            if (!DotfileManager::isDirAccessible(dirname($abs), $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $res = TrashAndVersioningManager::restoreVersion($project_root, $base_dir, $rel, $versionId);
            if (!empty($res['success'])) {
                CacheManager::invalidateDirCache(dirname($abs), $base_dir, $thumbnail_dir);
                FileIndexManager::upsertFile($project_root, $base_dir, $abs, $media_types);
            }
            return ['status' => $res['status'], 'data' => $res];
        }

        // ---------------------------------------------------------------------
        // 5. SQLITE INCREMENTAL FILE INDEX
        // ---------------------------------------------------------------------
        if ($action === 'get_file_index_stats') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            return ['status' => 200, 'data' => [
                'success' => true,
                'stats'   => FileIndexManager::getStats($project_root)
            ]];
        }

        if ($action === 'rebuild_file_index') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $res = FileIndexManager::rebuildIndex($project_root, $base_dir, $media_types, $ignore_list);
            return ['status' => 200, 'data' => $res];
        }

        if ($action === 'search_file_index') {
            $q = (string)($in['q'] ?? '');
            $cat = (string)($in['category'] ?? 'all');
            $limit = max(1, min(300, (int)($in['limit'] ?? 100)));
            return ['status' => 200, 'data' => [
                'success' => true,
                'results' => FileIndexManager::search($project_root, $base_dir, $q, $cat, $limit)
            ]];
        }

        return null;
    }
}
