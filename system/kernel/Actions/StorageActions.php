<?php
/**
 * Atelier by GallusTech - Phase B Storage, External Mounts, Chunked Uploads, Trash, Versioning & File Index Controller
 */

namespace Atelier\Kernel\Actions;

use Atelier\Kernel\Auth\AppPasswordManager;
use Atelier\Kernel\Auth\AuthManager;
use Atelier\Kernel\Auth\AuthSettings;
use Atelier\Kernel\Backup\InstanceBackupService;
use Atelier\Kernel\Config\ConfigStore;
use Atelier\Kernel\FS\CacheManager;
use Atelier\Kernel\FS\ChunkedUploadManager;
use Atelier\Kernel\FS\DotfileManager;
use Atelier\Kernel\FS\FileIndexManager;
use Atelier\Kernel\FS\PermissionsManager;
use Atelier\Kernel\FS\TrashAndVersioningManager;
use Atelier\Kernel\Jobs\JobQueueManager;
use Atelier\Kernel\Security\PathValidator;
use Atelier\Kernel\Storage\ExternalMountManager;

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
            $authCfg = AuthSettings::load($project_root);
            $baseUrl = AuthSettings::resolvePublicBaseUrl($authCfg);
            $isGoogleOidc = !empty($authCfg['oidc_client_id'])
                && stripos((string)($authCfg['oidc_issuer_url'] ?? ''), 'accounts.google.com') !== false;
            return ['status' => 200, 'data' => [
                'success'                  => true,
                'mounts'                   => ExternalMountManager::listAccessibleMounts($project_root),
                'gdrive_oauth_redirect_uri' => $baseUrl . '/api.php?action=gdrive_oauth_callback',
                'gdrive_has_server_client' => $isGoogleOidc
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

        if ($action === 'test_external_mount_config') {
            $res = ExternalMountManager::testRawConfig($project_root, $in);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'gdrive_oauth_start') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $authCfg = AuthSettings::load($project_root);
            $clientId = trim((string)($in['client_id'] ?? ''));
            $clientSecret = trim((string)($in['client_secret'] ?? ''));
            if ($clientId === '' && stripos((string)($authCfg['oidc_issuer_url'] ?? ''), 'accounts.google.com') !== false) {
                $clientId = trim((string)($authCfg['oidc_client_id'] ?? ''));
                if ($clientSecret === '') {
                    $clientSecret = trim((string)($authCfg['oidc_client_secret'] ?? ''));
                }
            }
            if ($clientId === '') {
                return ['status' => 400, 'data' => [
                    'success' => false,
                    'error'   => 'Google Client ID is required to start OAuth2 sign-in.'
                ]];
            }

            AuthManager::ensureSessionStarted();
            $state = bin2hex(random_bytes(16));
            $verifier = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
            $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
            $redirectUri = AuthSettings::resolvePublicBaseUrl($authCfg) . '/api.php?action=gdrive_oauth_callback';
            $permission = strtolower(trim((string)($in['permission'] ?? 'write'))) === 'read' ? 'read' : 'write';
            $scope = $permission === 'read'
                ? 'https://www.googleapis.com/auth/drive.readonly'
                : 'https://www.googleapis.com/auth/drive';
            $mountName = trim((string)($in['mount_name'] ?? '')) ?: 'Google Drive';
            $targetType = (string)($in['target_type'] ?? 'user');
            $showOnDesktop = !array_key_exists('show_on_desktop', $in) || !empty($in['show_on_desktop']);
            $rootFolderId = trim((string)($in['root_folder_id'] ?? 'root')) ?: 'root';

            $_SESSION['atelier_gdrive_oauth'] = [
                'state'           => $state,
                'code_verifier'   => $verifier,
                'redirect_uri'    => $redirectUri,
                'client_id'       => $clientId,
                'client_secret'   => $clientSecret,
                'mount_name'      => $mountName,
                'permission'      => $permission,
                'target_type'     => $targetType,
                'show_on_desktop' => $showOnDesktop,
                'root_folder_id'  => $rootFolderId,
                'expires_at'      => time() + 600
            ];

            $authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
                'client_id'             => $clientId,
                'redirect_uri'          => $redirectUri,
                'response_type'         => 'code',
                'scope'                 => $scope,
                'access_type'           => 'offline',
                'prompt'                => 'consent',
                'state'                 => $state,
                'code_challenge'        => $challenge,
                'code_challenge_method' => 'S256'
            ]);

            return ['status' => 200, 'data' => [
                'success'      => true,
                'auth_url'     => $authUrl,
                'redirect_uri' => $redirectUri
            ]];
        }

        if ($action === 'gdrive_oauth_callback') {
            AuthManager::ensureSessionStarted();
            $saved = $_SESSION['atelier_gdrive_oauth'] ?? null;
            unset($_SESSION['atelier_gdrive_oauth']);

            $code = trim((string)($in['code'] ?? ''));
            $state = trim((string)($in['state'] ?? ''));
            $oauthErr = trim((string)($in['error'] ?? ''));

            $payload = ['type' => 'atelier_gdrive_oauth_result', 'success' => false, 'error' => 'OAuth2 failed.'];

            if (!AuthManager::isLoggedIn()) {
                $payload['error'] = 'Authentication required.';
                return self::renderGdriveOauthCallbackResponse($payload, 403);
            }
            if ($oauthErr !== '') {
                $payload['error'] = 'Google OAuth2 error: ' . $oauthErr;
                return self::renderGdriveOauthCallbackResponse($payload, 400);
            }
            if (!is_array($saved) || (int)($saved['expires_at'] ?? 0) < time()) {
                $payload['error'] = 'OAuth2 session expired. Please try again.';
                return self::renderGdriveOauthCallbackResponse($payload, 400);
            }
            if ($code === '' || $state === '' || !hash_equals((string)($saved['state'] ?? ''), $state)) {
                $payload['error'] = 'Invalid OAuth2 state parameter.';
                return self::renderGdriveOauthCallbackResponse($payload, 403);
            }

            $postFields = [
                'grant_type'    => 'authorization_code',
                'code'          => $code,
                'redirect_uri'  => (string)$saved['redirect_uri'],
                'client_id'     => (string)$saved['client_id'],
                'code_verifier' => (string)$saved['code_verifier']
            ];
            if (!empty($saved['client_secret'])) {
                $postFields['client_secret'] = (string)$saved['client_secret'];
            }

            $tokenData = null;
            if (function_exists('curl_init')) {
                $ch = curl_init('https://oauth2.googleapis.com/token');
                curl_setopt($ch, CURLOPT_POST, true);
                curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
                curl_setopt($ch, CURLOPT_TIMEOUT, 15);
                curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
                curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
                if (defined('CURLPROTO_HTTPS')) {
                    curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
                }
                curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($postFields));
                $resp = curl_exec($ch);
                $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
                curl_close($ch);
                if ($httpCode === 200 && is_string($resp)) {
                    $tokenData = @json_decode($resp, true);
                }
            }

            if (!is_array($tokenData) || empty($tokenData['access_token'])) {
                $payload['error'] = 'Failed to exchange Google OAuth2 authorization code for tokens.';
                return self::renderGdriveOauthCallbackResponse($payload, 502);
            }

            $created = ExternalMountManager::createMount($project_root, [
                'driver'          => 'gdrive',
                'mount_name'      => (string)($saved['mount_name'] ?? 'Google Drive'),
                'permission'      => (string)($saved['permission'] ?? 'write'),
                'target_type'     => (string)($saved['target_type'] ?? 'user'),
                'show_on_desktop' => !empty($saved['show_on_desktop']),
                'config'          => [
                    'access_token'   => (string)$tokenData['access_token'],
                    'refresh_token'  => (string)($tokenData['refresh_token'] ?? ''),
                    'client_id'      => (string)$saved['client_id'],
                    'client_secret'  => (string)($saved['client_secret'] ?? ''),
                    'expires_at'     => time() + max(300, (int)($tokenData['expires_in'] ?? 3600)),
                    'root_folder_id' => (string)($saved['root_folder_id'] ?? 'root')
                ]
            ]);

            if (!empty($created['success'])) {
                $payload = [
                    'type'    => 'atelier_gdrive_oauth_result',
                    'success' => true,
                    'mount'   => $created['mount'] ?? null
                ];
                return self::renderGdriveOauthCallbackResponse($payload, 200);
            }

            $payload['error'] = (string)($created['error'] ?? 'Could not create Google Drive mount.');
            return self::renderGdriveOauthCallbackResponse($payload, (int)($created['status'] ?? 500));
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
            $res = ChunkedUploadManager::storeChunk($project_root, $uploadId, $chunkIndex, $tmpFile, is_string($rawData) ? $rawData : null, $base_dir);
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

        // ---------------------------------------------------------------------
        // 6. PHASE C — WEBDAV APP PASSWORDS (`/dav/`)
        // ---------------------------------------------------------------------
        if ($action === 'list_app_passwords') {
            $curUser = AuthManager::getCurrentUser();
            if (!$curUser || empty($curUser['id'])) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $authCfg = AuthSettings::load($project_root);
            $baseUrl = AuthSettings::resolvePublicBaseUrl($authCfg);
            return ['status' => 200, 'data' => [
                'success'       => true,
                'dav_url'       => rtrim($baseUrl, '/') . '/dav/',
                'username'      => (string)$curUser['username'],
                'app_passwords' => AppPasswordManager::listForUser($project_root, (int)$curUser['id'])
            ]];
        }

        if ($action === 'create_app_password') {
            $curUser = AuthManager::getCurrentUser();
            if (!$curUser || empty($curUser['id'])) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $label = (string)($in['label'] ?? 'WebDAV Client');
            $scope = (string)($in['scope'] ?? 'write');
            $res = AppPasswordManager::createForUser($project_root, (int)$curUser['id'], $label, $scope);
            return ['status' => (int)($res['status'] ?? 200), 'data' => $res];
        }

        if ($action === 'revoke_app_password') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $curUser = AuthManager::getCurrentUser();
            $id = (int)($in['id'] ?? $in['app_password_id'] ?? 0);
            $res = AppPasswordManager::revoke(
                $project_root,
                $id,
                $curUser ? (int)$curUser['id'] : null,
                AuthManager::isAdminLoggedIn()
            );
            return ['status' => (int)($res['status'] ?? 200), 'data' => $res];
        }

        // ---------------------------------------------------------------------
        // 7. PHASE C — ASYNC BACKGROUND JOB QUEUE (`bin/worker.php`)
        // ---------------------------------------------------------------------
        if ($action === 'list_jobs') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $isAdmin = AuthManager::isAdminLoggedIn();
            $curUser = AuthManager::getCurrentUser();
            $uid = $curUser ? (int)$curUser['id'] : null;
            return ['status' => 200, 'data' => [
                'success' => true,
                'stats'   => JobQueueManager::getStats($project_root, $uid, $isAdmin),
                'jobs'    => JobQueueManager::listJobs($project_root, $uid, $isAdmin, 50)
            ]];
        }

        if ($action === 'enqueue_job') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $isAdmin = AuthManager::isAdminLoggedIn();
            $curUser = AuthManager::getCurrentUser();
            $uid = $curUser ? (int)$curUser['id'] : null;
            $jobType = strtolower(trim((string)($in['job_type'] ?? '')));
            if (in_array($jobType, JobQueueManager::ADMIN_ONLY_TYPES, true) && !$isAdmin) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $payload = is_array($in['payload'] ?? null) ? $in['payload'] : [];
            if (isset($in['dir']) && !isset($payload['dir'])) {
                $payload['dir'] = (string)$in['dir'];
            }
            if (isset($in['file']) && !isset($payload['file'])) {
                $payload['file'] = (string)$in['file'];
            }
            if (isset($in['include_media']) && !isset($payload['include_media'])) {
                $payload['include_media'] = !empty($in['include_media']);
            }

            // Enforce strict read ACLs on target dir/file before enqueuing background jobs (anti-IDOR)
            if (in_array($jobType, ['generate_thumbnails', 'build_zip_archive'], true)) {
                $reqDir = trim(str_replace('\\', '/', (string)($payload['dir'] ?? '')), '/');
                if ($reqDir === '') {
                    if (!$isAdmin) {
                        return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
                    }
                    $payload['dir'] = '';
                } else {
                    $targetAbs = PathValidator::sanitizeDirectory($reqDir, $base_dir);
                    if (!$targetAbs || !is_dir($targetAbs)) {
                        return ['status' => 404, 'data' => ['success' => false, 'error' => __t('api.err_folder_not_found')]];
                    }
                    if (!$isAdmin && !DotfileManager::isDirAccessible($targetAbs, $base_dir)) {
                        return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
                    }
                    $payload['dir'] = PathValidator::getRelativePath($targetAbs, $base_dir);
                }
            } elseif ($jobType === 'video_preview') {
                $reqFile = trim(str_replace('\\', '/', (string)($payload['file'] ?? '')), '/');
                $targetFile = PathValidator::sanitizeFile($reqFile, $base_dir);
                if (!$targetFile || !is_file($targetFile)) {
                    return ['status' => 404, 'data' => ['success' => false, 'error' => __t('api.err_file_not_found')]];
                }
                if (!$isAdmin && !DotfileManager::isDirAccessible(dirname($targetFile), $base_dir)) {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
                }
                $payload['file'] = PathValidator::getRelativePath($targetFile, $base_dir);
            }

            // Prevent queue-flooding DoS by non-admin users
            if (!$isAdmin && $uid !== null) {
                $userStats = JobQueueManager::getStats($project_root, $uid, false);
                if (((int)$userStats['pending'] + (int)$userStats['running']) >= 15) {
                    return ['status' => 429, 'data' => ['success' => false, 'error' => 'Too many active background jobs. Please wait for current jobs to finish.']];
                }
            }

            $payload['_owner_is_admin'] = $isAdmin;
            $res = JobQueueManager::enqueue(
                $project_root,
                $jobType,
                $payload,
                $uid,
                (int)($in['priority'] ?? 50)
            );
            return ['status' => (int)($res['status'] ?? 200), 'data' => $res];
        }

        if ($action === 'run_next_job') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $job = JobQueueManager::runNextJob($project_root, $base_dir, $media_types);
            return ['status' => 200, 'data' => [
                'success'   => true,
                'processed' => $job !== null,
                'job'       => $job,
                'stats'     => JobQueueManager::getStats($project_root)
            ]];
        }

        if ($action === 'cancel_job') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $curUser = AuthManager::getCurrentUser();
            $jobId = (int)($in['job_id'] ?? $in['id'] ?? 0);
            $res = JobQueueManager::cancelJob(
                $project_root,
                $jobId,
                $curUser ? (int)$curUser['id'] : null,
                AuthManager::isAdminLoggedIn()
            );
            return ['status' => (int)($res['status'] ?? 200), 'data' => $res];
        }

        // ---------------------------------------------------------------------
        // 8. PHASE C — AUTOMATED INSTANCE BACKUPS (Admin Only)
        // ---------------------------------------------------------------------
        if ($action === 'list_instance_backups') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            return ['status' => 200, 'data' => [
                'success' => true,
                'backups' => InstanceBackupService::listBackups($project_root)
            ]];
        }

        if ($action === 'create_instance_backup') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $includeMedia = !empty($in['include_media']);
            $label = (string)($in['label'] ?? '');
            $res = InstanceBackupService::createBackup($project_root, $includeMedia, $label);
            return ['status' => (int)($res['status'] ?? 200), 'data' => $res];
        }

        if ($action === 'delete_instance_backup') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $filename = (string)($in['filename'] ?? '');
            $res = InstanceBackupService::deleteBackup($project_root, $filename);
            return ['status' => (int)($res['status'] ?? 200), 'data' => $res];
        }

        return null;
    }

    /**
     * Emits an origin-locked postMessage HTML page for browser OAuth2 popups,
     * or returns a structured JSON response when invoked in CLI/unit tests.
     */
    private static function renderGdriveOauthCallbackResponse(array $payload, int $status): array {
        if (PHP_SAPI === 'cli') {
            return ['status' => $status, 'data' => $payload];
        }
        $json = json_encode($payload, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE);
        $title = !empty($payload['success']) ? 'Google Drive connected' : 'Google Drive connection error';
        $msg = !empty($payload['success'])
            ? 'Google Drive mounted successfully. You can close this window.'
            : (string)($payload['error'] ?? 'OAuth2 error');
        http_response_code($status);
        if (!headers_sent()) {
            header('Content-Type: text/html; charset=utf-8');
            header('Cache-Control: no-store');
            header('X-Content-Type-Options: nosniff');
            header('Referrer-Policy: no-referrer');
        }
        echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</title>'
            . '<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}.card{max-width:420px;padding:24px;border-radius:14px;border:1px solid rgba(255,255,255,0.14);background:rgba(30,41,59,0.9)}</style></head><body>'
            . '<div class="card"><h3>' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</h3><p>' . htmlspecialchars($msg, ENT_QUOTES, 'UTF-8') . '</p></div>'
            . '<script>(function(){var d=' . $json . ';try{if(window.opener&&!window.opener.closed){window.opener.postMessage(d,window.location.origin);}}catch(e){}if(d&&d.success){setTimeout(function(){window.close();},900);}})();</script>'
            . '</body></html>';
        exit;
    }
}
