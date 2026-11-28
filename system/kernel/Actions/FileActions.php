<?php
namespace Atelier\Kernel\Actions;

use Atelier\Kernel\Auth\AuthManager;
use Atelier\Kernel\FS\CacheManager;
use Atelier\Kernel\FS\DotfileManager;
use Atelier\Kernel\FS\PermissionsManager;
use Atelier\Kernel\Media\ExifParser;
use Atelier\Kernel\Media\FormatRegistry;
use Atelier\Kernel\Security\PathValidator;
use Atelier\Kernel\Security\RateLimiter;
use Atelier\Kernel\Security\SecurityManager;

class FileActions {

    public static function handle(string $action, array $params, array $context): ?array {
        $base_dir       = $context['base_dir'] ?? '';
        $ignore_list    = $context['ignore_list'] ?? [];
        $media_types    = $context['media_types'] ?? [];
        $thumbnail_dir  = $context['thumbnail_dir'] ?? '.thumbnails';
        $project_root   = $context['project_root'] ?? dirname(dirname(dirname(__DIR__)));
        $raw_body       = $context['raw_body'] ?? $params;
        $thumb_dir_name = $thumbnail_dir;


        if ($action === 'unlock_folder') {
            $req_dir = $raw_body['dir'] ?? $_POST['dir'] ?? '';
            $password = $raw_body['password'] ?? $_POST['password'] ?? '';
            $dir_target = PathValidator::sanitizeDirectory($req_dir, $base_dir);

            if (!$dir_target || !is_dir($dir_target)) {
                return ['status' => 404, 'data' => ['success' => false, 'error' => __t('api.err_folder_not_found')]];
            }

            $password_file = $dir_target . '/.password';
            if (!file_exists($password_file)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_folder_not_protected')]];
            }

            $rel = PathValidator::getRelativePath($dir_target, $base_dir);
            global $rate_limits;
            $unlock_max = (int)($rate_limits['unlock_folder']['max_attempts'] ?? 5);
            $unlock_decay = (int)($rate_limits['unlock_folder']['decay_seconds'] ?? 900);
            $unlock_rl_key = 'unlock_' . md5($rel) . '_' . RateLimiter::getClientIp();

            if (!RateLimiter::check($unlock_rl_key, $unlock_max, $unlock_decay)) {
                return ['status' => 429, 'data' => ['success' => false, 'error' => __t('api.err_rate_limit')]];
            }

            $hash = trim((string)@file_get_contents($password_file));
            if (empty($hash) || password_verify($password, $hash)) {
                RateLimiter::reset($unlock_rl_key);
                AuthManager::ensureSessionStarted();
                $_SESSION['atelier_unlocked_folders'][$rel] = true;
                $_SESSION['unlocked_dirs'][$rel] = true;

                return ['status' => 200, 'data' => [
                    'success' => true,
                    'message' => __t('api.msg_folder_unlocked')
                ]];
            }

            RateLimiter::increment($unlock_rl_key);
            return ['status' => 401, 'data' => ['success' => false, 'error' => __t('api.err_invalid_folder_password')]];
        }

        if ($action === 'lock_folder') {
            $req_dir = $raw_body['dir'] ?? $_POST['dir'] ?? '';
            $dir_target = PathValidator::sanitizeDirectory($req_dir, $base_dir);

            if ($dir_target && is_dir($dir_target)) {
                AuthManager::ensureSessionStarted();
                $rel = PathValidator::getRelativePath($dir_target, $base_dir);
                unset($_SESSION['atelier_unlocked_folders'][$rel]);
                unset($_SESSION['unlocked_dirs'][$rel]);
            }

            return ['status' => 200, 'data' => ['success' => true, 'message' => __t('api.msg_folder_locked')]];
        }

        if ($action === 'update_dotfile') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }

            $req_dir   = $raw_body['dir'] ?? $_POST['dir'] ?? '';
            $type      = $raw_body['type'] ?? $_POST['type'] ?? '';
            $value     = $raw_body['value'] ?? $_POST['value'] ?? '';
            $dir_target = PathValidator::sanitizeDirectory($req_dir, $base_dir);

            if (!$dir_target || !is_dir($dir_target)) {
                return ['status' => 404, 'data' => ['success' => false, 'error' => __t('api.err_folder_not_found')]];
            }

            switch ($type) {
                case 'access_mode':
                    @unlink($dir_target . '/.private');
                    @unlink($dir_target . '/.password');
                    @unlink($dir_target . '/.public');
                    if ($value === 'private') {
                        @file_put_contents($dir_target . '/.private', "1\n", LOCK_EX);
                    } elseif ($value === 'password') {
                        $pass_hash = password_hash((string)($raw_body['password'] ?? $_POST['password'] ?? ''), PASSWORD_DEFAULT);
                        @file_put_contents($dir_target . '/.password', $pass_hash . "\n", LOCK_EX);
                    }
                    break;
                case 'title':
                    if (trim((string)$value) === '') @unlink($dir_target . '/.title');
                    else @file_put_contents($dir_target . '/.title', trim((string)$value) . "\n", LOCK_EX);
                    break;
                case 'description':
                    if (trim((string)$value) === '') {
                        @unlink($dir_target . '/.desc');
                        @unlink($dir_target . '/.description');
                    } else {
                        @file_put_contents($dir_target . '/.desc', trim((string)$value) . "\n", LOCK_EX);
                    }
                    break;
                case 'bg':
                    if (trim((string)$value) === '') @unlink($dir_target . '/.bg');
                    else @file_put_contents($dir_target . '/.bg', trim((string)$value) . "\n", LOCK_EX);
                    break;
                case 'theme':
                    if (trim((string)$value) === '') @unlink($dir_target . '/.theme');
                    else @file_put_contents($dir_target . '/.theme', trim((string)$value) . "\n", LOCK_EX);
                    break;
                case 'comment':
                    $fname = $raw_body['filename'] ?? $_POST['filename'] ?? '';
                    if (!empty($fname)) {
                        $comments = DotfileManager::loadDirComments($dir_target);
                        if (trim((string)$value) === '') unset($comments[$fname]);
                        else $comments[$fname] = trim((string)$value);
                        DotfileManager::saveDirComments($dir_target, $comments);
                    }
                    break;
            }

            CacheManager::invalidateDirCache($dir_target, $base_dir, $thumb_dir_name);
            return ['status' => 200, 'data' => ['success' => true, 'message' => __t('api.msg_dotfile_updated')]];
        }

        if ($action === 'save_comment') {
            $dir_param = $_POST['dir'] ?? $raw_body['dir'] ?? '';
            if (!PermissionsManager::hasPermission('can_comment', $base_dir, (string)$dir_param)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_comment_denied')]];
            }

            $req_dir  = $raw_body['dir'] ?? $_POST['dir'] ?? '';
            $filename = $raw_body['filename'] ?? $_POST['filename'] ?? '';
            $comment  = $raw_body['comment'] ?? $_POST['comment'] ?? '';

            $dir_target = PathValidator::sanitizeDirectory($req_dir, $base_dir);
            if (!$dir_target || !is_dir($dir_target)) {
                return ['status' => 404, 'data' => ['success' => false, 'error' => __t('api.err_folder_not_found')]];
            }
            if (!DotfileManager::isDirAccessible($dir_target, $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }

            $comments = DotfileManager::loadDirComments($dir_target);
            if (trim((string)$comment) === '') {
                unset($comments[$filename]);
            } else {
                $comments[$filename] = trim((string)$comment);
            }
            DotfileManager::saveDirComments($dir_target, $comments);
            CacheManager::invalidateDirCache($dir_target, $base_dir, $thumb_dir_name);

            return ['status' => 200, 'data' => ['success' => true, 'message' => __t('api.msg_comment_saved')]];
        }

        if ($action === 'save_folder_settings') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }

            $req_dir     = $raw_body['dir'] ?? $_POST['dir'] ?? '';
            $title       = $raw_body['title'] ?? $_POST['title'] ?? null;
            $desc        = $raw_body['description'] ?? $_POST['description'] ?? null;
            $bg          = $raw_body['background'] ?? $_POST['background'] ?? null;
            $theme       = $raw_body['theme'] ?? $_POST['theme'] ?? null;
            $access_mode = $raw_body['access_mode'] ?? $_POST['access_mode'] ?? null;
            $password    = $raw_body['password'] ?? $_POST['password'] ?? null;

            $dir_target = PathValidator::sanitizeDirectory($req_dir, $base_dir);
            if (!$dir_target || !is_dir($dir_target)) {
                return ['status' => 404, 'data' => ['success' => false, 'error' => __t('api.err_folder_not_found')]];
            }
            if (!DotfileManager::isDirAccessible($dir_target, $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }

            if ($title !== null) {
                if (trim((string)$title) === '') @unlink($dir_target . '/.title');
                else @file_put_contents($dir_target . '/.title', trim((string)$title) . "\n", LOCK_EX);
            }
            if ($desc !== null) {
                if (trim((string)$desc) === '') {
                    @unlink($dir_target . '/.desc');
                    @unlink($dir_target . '/.description');
                } else {
                    @file_put_contents($dir_target . '/.desc', trim((string)$desc) . "\n", LOCK_EX);
                }
            }
            if ($bg !== null) {
                if (trim((string)$bg) === '') @unlink($dir_target . '/.bg');
                else @file_put_contents($dir_target . '/.bg', trim((string)$bg) . "\n", LOCK_EX);
            }
            if ($theme !== null) {
                if (trim((string)$theme) === '') @unlink($dir_target . '/.theme');
                else @file_put_contents($dir_target . '/.theme', trim((string)$theme) . "\n", LOCK_EX);
            }
            if ($access_mode !== null) {
                @unlink($dir_target . '/.private');
                @unlink($dir_target . '/.password');
                @unlink($dir_target . '/.public');
                if ($access_mode === 'private') {
                    @file_put_contents($dir_target . '/.private', "1\n", LOCK_EX);
                } elseif ($access_mode === 'password' && !empty($password)) {
                    $pass_hash = password_hash((string)$password, PASSWORD_DEFAULT);
                    @file_put_contents($dir_target . '/.password', $pass_hash . "\n", LOCK_EX);
                }
            }

            CacheManager::invalidateDirCache($dir_target, $base_dir, $thumb_dir_name);
            return ['status' => 200, 'data' => ['success' => true, 'message' => __t('api.msg_folder_settings_saved')]];
        }

        if ($action === 'upload_file' || $action === 'upload_media') {
            $dir_param = $_POST['dir'] ?? $_GET['dir'] ?? '';

            // Phase B: Direct upload into an external mount (`ext://<mount_id>/...`)
            $ext_up = \Atelier\Kernel\Storage\ExternalMountManager::parseExternalPath((string)$dir_param);
            if ($ext_up !== null) {
                $resolved = \Atelier\Kernel\Storage\ExternalMountManager::resolveMountForCurrentUser($project_root, (int)$ext_up['mount_id']);
                if (!$resolved || empty($resolved['can_write'])) {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_upload_denied')]];
                }
                $allowed_exts = FormatRegistry::getAllowedUploadExtensions($project_root, $media_types);
                $files_input = $_FILES['file'] ?? $_FILES['files'] ?? null;
                if (!$files_input && !empty($_FILES)) {
                    $first_key = array_keys($_FILES)[0];
                    $files_input = $_FILES[$first_key];
                }
                if (!$files_input) {
                    return ['status' => 400, 'data' => ['success' => false, 'error' => 'Aucun fichier reçu pour le téléversement.']];
                }
                $is_multi = is_array($files_input['name']);
                $cnt = $is_multi ? count($files_input['name']) : 1;
                $uploaded = [];
                $errs = [];
                for ($i = 0; $i < $cnt; $i++) {
                    $raw_n = $is_multi ? $files_input['name'][$i] : $files_input['name'];
                    $tmp_n = $is_multi ? $files_input['tmp_name'][$i] : $files_input['tmp_name'];
                    $err_c = $is_multi ? $files_input['error'][$i] : $files_input['error'];
                    if ($err_c !== UPLOAD_ERR_OK) { $errs[] = "Upload error on '{$raw_n}'."; continue; }
                    $safe_n = preg_replace('/[^\w\.\-\s]/u', '_', basename($raw_n));
                    $ext = strtolower(pathinfo($safe_n, PATHINFO_EXTENSION));
                    if ($safe_n === '' || $safe_n[0] === '.' || FormatRegistry::hasForbiddenDoubleExtension($safe_n) || FormatRegistry::isForbiddenExtension($ext) || !in_array($ext, $allowed_exts, true)) {
                        $errs[] = "Forbidden format '{$raw_n}'.";
                        continue;
                    }
                    $destRel = $ext_up['rel_path'] === '' ? $safe_n : ($ext_up['rel_path'] . '/' . $safe_n);
                    $mime = FormatRegistry::getHttpContentType($ext, $project_root, $media_types);
                    if ($resolved['driver']->putFile($destRel, $tmp_n, $mime)) {
                        $uploaded[] = ['original_name' => $raw_n, 'saved_name' => $safe_n, 'renamed' => false];
                    } else {
                        $errs[] = "External mount write failed for '{$raw_n}'.";
                    }
                }
                $ok = !empty($uploaded);
                return ['status' => $ok ? 200 : 400, 'data' => ['success' => $ok, 'uploaded' => $uploaded, 'errors' => $errs, 'error' => $ok ? null : implode(' ', $errs)]];
            }

            if (!PermissionsManager::hasPermission('can_upload', $base_dir, (string)$dir_param)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => 'Accès refusé. Permission d\'upload manquante.']];
            }
            $target_dir = PathValidator::sanitizeDirectory($dir_param, $base_dir);
            if ($target_dir === null || !is_dir($target_dir)) {
                return ['status' => 404, 'data' => ['success' => false, 'error' => 'Dossier cible introuvable ou accès refusé.']];
            }
            if (!DotfileManager::isDirAccessible($target_dir, $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }

            if (empty($_FILES)) {
                $content_length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
                $post_max = ini_get('post_max_size');
                $error_msg = 'Aucun fichier reçu pour le téléversement.';
                if ($content_length > 0) {
                    $error_msg = "La taille totale du téléversement dépasse la limite serveur post_max_size ({$post_max}).";
                }
                return ['status' => 400, 'data' => ['success' => false, 'error' => $error_msg]];
            }

            $overwrite = isset($_POST['overwrite']) && ($_POST['overwrite'] === '1' || $_POST['overwrite'] === 'true');

            // Dynamically resolved from core baseline + active native & external/WASM apps (always filtered by immutable security blacklist)
            $allowed_exts = FormatRegistry::getAllowedUploadExtensions($project_root, $media_types);

            $files_input = $_FILES['file'] ?? $_FILES['files'] ?? null;
            if (!$files_input && !empty($_FILES)) {
                $keys = array_keys($_FILES);
                $first_key = $keys[0];
                $files_input = $_FILES[$first_key];
            }

            // Enforce personal disk quota when uploading inside a user's `users/<username>` space
            $rel_target = PathValidator::getRelativePath($target_dir, $base_dir);
            if (preg_match('#^users/([^/]+)(?:/|$)#i', $rel_target, $um)) {
                $owner = \Atelier\Kernel\Auth\UserManager::findByUsername($project_root, $um[1]);
                if ($owner && (int)($owner['quota_bytes'] ?? 0) > 0) {
                    $quotaInfo = \Atelier\Kernel\Auth\UserManager::getUserQuotaInfo($project_root, $base_dir, $owner);
                    $incomingBytes = 0;
                    if (isset($files_input['size'])) {
                        $sizes = is_array($files_input['size']) ? $files_input['size'] : [$files_input['size']];
                        foreach ($sizes as $sz) {
                            $incomingBytes += max(0, (int)$sz);
                        }
                    }
                    if (($quotaInfo['used_bytes'] + $incomingBytes) > $quotaInfo['quota_bytes']) {
                        return ['status' => 413, 'data' => [
                            'success' => false,
                            'error'   => 'Quota disque dépassé pour cet espace personnel.'
                        ]];
                    }
                }
            }

            $uploaded_results = [];
            $errors = [];

            $is_multiple = is_array($files_input['name']);
            $file_count = $is_multiple ? count($files_input['name']) : 1;

            for ($i = 0; $i < $file_count; $i++) {
                $raw_name = $is_multiple ? $files_input['name'][$i] : $files_input['name'];
                $tmp_name = $is_multiple ? $files_input['tmp_name'][$i] : $files_input['tmp_name'];
                $error_code = $is_multiple ? $files_input['error'][$i] : $files_input['error'];

                if ($error_code !== UPLOAD_ERR_OK) {
                    $errors[] = "Erreur de téléversement pour '{$raw_name}' (Code {$error_code}).";
                    continue;
                }

                $safe_filename = basename($raw_name);
                $safe_filename = preg_replace('/[^\w\.\-\s]/u', '_', $safe_filename);

                if ($safe_filename[0] === '.') {
                    $errors[] = "Sécurité : Les fichiers système masqués (dotfiles) comme '{$raw_name}' sont strictement interdits.";
                    continue;
                }

                if (FormatRegistry::hasForbiddenDoubleExtension($safe_filename)) {
                    $errors[] = "Sécurité : Double extension d'exécution suspecte détectée sur '{$raw_name}'.";
                    continue;
                }

                $ext = strtolower(pathinfo($safe_filename, PATHINFO_EXTENSION));
                if ($ext === '' || FormatRegistry::isForbiddenExtension($ext) || !in_array($ext, $allowed_exts, true)) {
                    $errors[] = "Sécurité : L'extension '.{$ext}' du fichier '{$raw_name}' n'est pas autorisée.";
                    continue;
                }

                $target_file_name = $safe_filename;
                $dest_path = $target_dir . '/' . $target_file_name;

                if (file_exists($dest_path) && !$overwrite) {
                    $info = pathinfo($safe_filename);
                    $base_name = $info['filename'];
                    $counter = 1;
                    while (file_exists($target_dir . '/' . $target_file_name)) {
                        $target_file_name = $base_name . '_' . $counter . ($ext !== '' ? '.' . $ext : '');
                        $counter++;
                    }
                    $dest_path = $target_dir . '/' . $target_file_name;
                }

                if (file_exists($dest_path) && $overwrite) {
                    $rel_existing = PathValidator::getRelativePath($dest_path, $base_dir);
                    \Atelier\Kernel\FS\TrashAndVersioningManager::snapshotBeforeOverwrite($project_root, $dest_path, $rel_existing);
                }

                if (@move_uploaded_file($tmp_name, $dest_path)) {
                    @chmod($dest_path, 0644);
                    if ($ext === 'svg') {
                        SecurityManager::sanitizeSvgContent($dest_path);
                    }
                    \Atelier\Kernel\FS\FileIndexManager::upsertFile($project_root, $base_dir, $dest_path, $media_types);
                    $uploaded_results[] = [
                        'original_name' => $raw_name,
                        'saved_name'    => $target_file_name,
                        'renamed'       => ($target_file_name !== $raw_name)
                    ];
                } else {
                    $errors[] = "Échec du déplacement du fichier '{$raw_name}' vers le dossier cible.";
                }
            }

            if (!empty($uploaded_results)) {
                CacheManager::invalidateDirCache($target_dir, $base_dir, $thumb_dir_name);
            }

            $has_success = !empty($uploaded_results);
            $error_summary = !$has_success ? (!empty($errors) ? implode(' ', $errors) : 'Échec du téléversement.') : null;
            return [
                'status' => $has_success ? 200 : 400,
                'data'   => [
                    'success'  => $has_success,
                    'uploaded' => $uploaded_results,
                    'errors'   => $errors,
                    'error'    => $error_summary,
                    'message'  => $has_success ? count($uploaded_results) . ' fichier(s) téléversé(s) avec succès.' : $error_summary
                ]
            ];
        }

        if ($action === 'create_folder') {
            $dir_param = $_POST['dir'] ?? $raw_body['dir'] ?? '';
            $name_param = trim($_POST['name'] ?? $raw_body['name'] ?? '');

            $ext_mk = \Atelier\Kernel\Storage\ExternalMountManager::parseExternalPath((string)$dir_param);
            if ($ext_mk !== null) {
                $resolved = \Atelier\Kernel\Storage\ExternalMountManager::resolveMountForCurrentUser($project_root, (int)$ext_mk['mount_id']);
                if (!$resolved || empty($resolved['can_write'])) {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_create_folder_denied')]];
                }
                $clean_name = basename($name_param);
                if (empty($clean_name) || $clean_name[0] === '.' || preg_match('/[\/\\\\:\*\?"<>\|]/', $clean_name)) {
                    return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_invalid_folder_name')]];
                }
                $relNew = $ext_mk['rel_path'] === '' ? $clean_name : ($ext_mk['rel_path'] . '/' . $clean_name);
                if ($resolved['driver']->mkdir($relNew)) {
                    return ['status' => 200, 'data' => ['success' => true, 'message' => __t('api.msg_folder_created'), 'name' => $clean_name]];
                }
                return ['status' => 500, 'data' => ['success' => false, 'error' => __t('api.err_folder_create_failed')]];
            }

            if (!PermissionsManager::hasPermission('can_create_folder', $base_dir, (string)$dir_param)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_create_folder_denied')]];
            }

            $dir_param = $_POST['dir'] ?? $raw_body['dir'] ?? '';
            $name_param = trim($_POST['name'] ?? $raw_body['name'] ?? '');

            $target_dir = PathValidator::sanitizeDirectory($dir_param, $base_dir);
            if ($target_dir === null || !is_dir($target_dir)) {
                return ['status' => 404, 'data' => ['success' => false, 'error' => __t('api.err_folder_not_found')]];
            }
            if (!DotfileManager::isDirAccessible($target_dir, $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }

            $clean_name = basename($name_param);
            if (empty($clean_name) || $clean_name[0] === '.' || preg_match('/[\/\\\\:\*\?"<>\|]/', $clean_name)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_invalid_folder_name')]];
            }

            $new_dir = $target_dir . '/' . $clean_name;
            if (file_exists($new_dir)) {
                return ['status' => 409, 'data' => ['success' => false, 'error' => __t('api.err_folder_exists')]];
            }

            if (@mkdir($new_dir, 0755, true)) {
                CacheManager::invalidateDirCache($target_dir, $base_dir, $thumb_dir_name);
                return ['status' => 200, 'data' => [
                    'success' => true,
                    'message' => __t('api.msg_folder_created'),
                    'name'    => $clean_name
                ]];
            }

            return ['status' => 500, 'data' => ['success' => false, 'error' => __t('api.err_folder_create_failed')]];
        }

        if ($action === 'move_item') {
            $source_param = $_POST['source'] ?? $raw_body['source'] ?? '';
            $target_dir_param = $_POST['target_dir'] ?? $raw_body['target_dir'] ?? '';
            $target_dir_full = PathValidator::sanitizeDirectory($target_dir_param, $base_dir);
            if ($target_dir_full === null || !is_dir($target_dir_full)) {
                return ['status' => 404, 'data' => ['success' => false, 'error' => __t('api.err_source_or_dest_invalid')]];
            }
            $target_dir_rel = PathValidator::getRelativePath($target_dir_full, $base_dir);
            if (!PermissionsManager::hasPermission('can_move', $base_dir, $target_dir_rel)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_move_denied')]];
            }
            $new_name_param = isset($_POST['new_name']) ? trim($_POST['new_name']) : (isset($raw_body['new_name']) ? trim($raw_body['new_name']) : null);

            if (!DotfileManager::isDirAccessible($target_dir_full, $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }

            $is_protected_user_root = function(string $rel_path): bool {
                $clean = trim(str_replace('\\', '/', $rel_path), '/');
                if (strcasecmp($clean, 'users') === 0) return true;
                // Protect top-level user home directory `users/<username>` from being moved/deleted by non-admins
                if (preg_match('#^users/[^/]+$#i', $clean) && !AuthManager::isAdminLoggedIn()) return true;
                return false;
            };

            // Single item string path (preserves exact legacy contract & HTTP status codes)
            if (!is_array($source_param)) {
                $source_full = PathValidator::canonicalizeAndValidate((string)$source_param, $base_dir, true, false);
                if ($source_full === null || !file_exists($source_full)) {
                    return ['status' => 404, 'data' => ['success' => false, 'error' => __t('api.err_source_or_dest_invalid')]];
                }
                $source_rel = PathValidator::getRelativePath($source_full, $base_dir);
                if ($is_protected_user_root($source_rel) || !PermissionsManager::hasPermission('can_move', $base_dir, $source_rel)) {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_move_denied')]];
                }
                $src_check_dir = is_dir($source_full) ? $source_full : dirname($source_full);
                if (!DotfileManager::isDirAccessible($src_check_dir, $base_dir)) {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
                }

                if (is_dir($source_full) && ($source_full === $target_dir_full || strpos($target_dir_full . '/', $source_full . '/') === 0)) {
                    return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_move_into_self')]];
                }

                $dest_name = $new_name_param !== null ? basename($new_name_param) : basename($source_full);
                if (empty($dest_name) || $dest_name[0] === '.' || preg_match('/[\/\\\\:\*\?"<>\|]/', $dest_name)) {
                    return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_invalid_name')]];
                }

                // Prevent renaming a benign file into a server-executable or active forbidden extension
                if (!is_dir($source_full)) {
                    $dest_ext = strtolower(pathinfo($dest_name, PATHINFO_EXTENSION));
                    if (FormatRegistry::isForbiddenExtension($dest_ext) || FormatRegistry::hasForbiddenDoubleExtension($dest_name)) {
                        return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_forbidden_file_type')]];
                    }
                }

                // Enforce personal disk quota if moving an item from outside a user's home into `users/<username>`
                if (preg_match('#^users/([^/]+)(?:/|$)#i', $target_dir_rel, $um_dst)) {
                    $same_home = preg_match('#^users/' . preg_quote($um_dst[1], '#') . '(?:/|$)#i', $source_rel);
                    if (!$same_home) {
                        $owner = \Atelier\Kernel\Auth\UserManager::findByUsername($project_root, $um_dst[1]);
                        if ($owner && (int)($owner['quota_bytes'] ?? 0) > 0) {
                            $quotaInfo = \Atelier\Kernel\Auth\UserManager::getUserQuotaInfo($project_root, $base_dir, $owner);
                            $movingBytes = is_dir($source_full) ? self::computePathBytes($source_full) : max(0, (int)@filesize($source_full));
                            if (($quotaInfo['used_bytes'] + $movingBytes) > $quotaInfo['quota_bytes']) {
                                return ['status' => 413, 'data' => ['success' => false, 'error' => 'Quota disque dépassé pour cet espace personnel.']];
                            }
                        }
                    }
                }

                $destination = $target_dir_full . '/' . $dest_name;
                if ($destination === $source_full) {
                    return ['status' => 200, 'data' => ['success' => true, 'message' => __t('api.msg_item_moved')]];
                }
                if (file_exists($destination)) {
                    return ['status' => 409, 'data' => ['success' => false, 'error' => __t('api.err_destination_exists')]];
                }

                if (@rename($source_full, $destination)) {
                    if (is_file($destination) && strtolower(pathinfo($destination, PATHINFO_EXTENSION)) === 'svg') {
                        SecurityManager::sanitizeSvgContent($destination);
                    }
                    CacheManager::invalidateDirCache(dirname($source_full), $base_dir, $thumb_dir_name);
                    CacheManager::invalidateDirCache($target_dir_full, $base_dir, $thumb_dir_name);
                    return ['status' => 200, 'data' => ['success' => true, 'message' => __t('api.msg_item_moved')]];
                }

                return ['status' => 500, 'data' => ['success' => false, 'error' => __t('api.err_move_failed')]];
            }

            // Batch array path (cross-window & multi-selection drag & drop)
            $sources = $source_param;
            if (empty($sources)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_source_or_dest_invalid')]];
            }

            $moved_count = 0;
            $errors = [];

            foreach ($sources as $src_item) {
                if (!is_string($src_item) || trim($src_item) === '') continue;
                $source_full = PathValidator::canonicalizeAndValidate(trim($src_item), $base_dir, true, false);
                if ($source_full === null || !file_exists($source_full)) {
                    $errors[] = basename($src_item) . ' introuvable';
                    continue;
                }
                $src_rel = PathValidator::getRelativePath($source_full, $base_dir);
                if ($is_protected_user_root($src_rel) || !PermissionsManager::hasPermission('can_move', $base_dir, $src_rel)) {
                    $errors[] = basename($src_item) . ' (permission de déplacement refusée)';
                    continue;
                }
                $src_check_dir = is_dir($source_full) ? $source_full : dirname($source_full);
                if (!DotfileManager::isDirAccessible($src_check_dir, $base_dir)) {
                    $errors[] = basename($src_item) . ' (accès refusé)';
                    continue;
                }
                if (is_dir($source_full) && ($source_full === $target_dir_full || strpos($target_dir_full . '/', $source_full . '/') === 0)) {
                    $errors[] = basename($src_item) . ' (déplacement dans lui-même interdit)';
                    continue;
                }
                $dest_name = basename($source_full);
                if (empty($dest_name) || $dest_name[0] === '.' || preg_match('/[\/\\\\:\*\?"<>\|]/', $dest_name)) {
                    $errors[] = basename($src_item) . ' (nom invalide)';
                    continue;
                }
                $destination = $target_dir_full . '/' . $dest_name;
                if ($destination === $source_full) {
                    $moved_count++;
                    continue;
                }
                if (file_exists($destination)) {
                    $errors[] = basename($src_item) . ' (existe déjà dans la destination)';
                    continue;
                }
                if (@rename($source_full, $destination)) {
                    CacheManager::invalidateDirCache(dirname($source_full), $base_dir, $thumb_dir_name);
                    $moved_count++;
                } else {
                    $errors[] = basename($src_item) . ' (échec du déplacement)';
                }
            }

            CacheManager::invalidateDirCache($target_dir_full, $base_dir, $thumb_dir_name);

            if ($moved_count > 0) {
                return ['status' => 200, 'data' => [
                    'success' => true,
                    'message' => __t('api.msg_item_moved'),
                    'moved_count' => $moved_count,
                    'errors' => $errors
                ]];
            }

            return ['status' => 400, 'data' => [
                'success' => false,
                'error' => !empty($errors) ? implode(', ', $errors) : __t('api.err_move_failed')
            ]];
        }

        if ($action === 'rename_item') {
            $source_param = trim((string)($_POST['source'] ?? $_POST['path'] ?? $raw_body['source'] ?? $raw_body['path'] ?? ''));
            $new_name_raw = trim((string)($_POST['new_name'] ?? $_POST['name'] ?? $raw_body['new_name'] ?? $raw_body['name'] ?? ''));

            if ($source_param === '' || $new_name_raw === '') {
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_invalid_name')]];
            }

            // Strictly disallow path separators, control chars, dotfiles or invalid filename characters
            if ($new_name_raw === '.' || $new_name_raw === '..' || $new_name_raw[0] === '.' || preg_match('/[\/\\\\:\*\?"<>\|\\x00-\\x1f]/', $new_name_raw)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_invalid_name')]];
            }

            // Phase B / G: External mount rename (`ext://<mount_id>/...`)
            $ext_src = \Atelier\Kernel\Storage\ExternalMountManager::parseExternalPath($source_param);
            if ($ext_src !== null) {
                $resolved = \Atelier\Kernel\Storage\ExternalMountManager::resolveMountForCurrentUser($project_root, (int)$ext_src['mount_id']);
                if (!$resolved || empty($resolved['can_write']) || $ext_src['rel_path'] === '') {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_move_denied')]];
                }
                $driver = $resolved['driver'];
                $srcRel = trim($ext_src['rel_path'], '/');
                $parentRel = dirname($srcRel);
                $parentRel = ($parentRel === '.' || $parentRel === '/') ? '' : trim($parentRel, '/');
                $dstRel = ($parentRel !== '' ? $parentRel . '/' : '') . $new_name_raw;

                if ($dstRel === $srcRel) {
                    return ['status' => 200, 'data' => ['success' => true, 'new_path' => 'ext://' . (int)$ext_src['mount_id'] . '/' . $dstRel, 'name' => $new_name_raw]];
                }

                $stat = method_exists($driver, 'stat') ? $driver->stat($srcRel) : null;
                $isDir = is_array($stat) && !empty($stat['is_dir']);
                if (!$isDir) {
                    $ext = strtolower(pathinfo($new_name_raw, PATHINFO_EXTENSION));
                    if (FormatRegistry::isForbiddenExtension($ext) || FormatRegistry::hasForbiddenDoubleExtension($new_name_raw)) {
                        return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_forbidden_file_type')]];
                    }
                }
                if (method_exists($driver, 'stat') && $driver->stat($dstRel) !== null) {
                    return ['status' => 409, 'data' => ['success' => false, 'error' => __t('api.err_destination_exists')]];
                }
                if (method_exists($driver, 'move') && $driver->move($srcRel, $dstRel)) {
                    return ['status' => 200, 'data' => [
                        'success'  => true,
                        'new_path' => 'ext://' . (int)$ext_src['mount_id'] . '/' . $dstRel,
                        'name'     => $new_name_raw
                    ]];
                }
                return ['status' => 500, 'data' => ['success' => false, 'error' => __t('api.err_move_failed')]];
            }

            // Local VFS rename
            $source_full = PathValidator::canonicalizeAndValidate($source_param, $base_dir, true, false);
            if ($source_full === null || !file_exists($source_full)) {
                return ['status' => 404, 'data' => ['success' => false, 'error' => __t('api.err_source_or_dest_invalid')]];
            }

            $source_rel = PathValidator::getRelativePath($source_full, $base_dir);
            $clean_rel = trim(str_replace('\\', '/', $source_rel), '/');
            if (strcasecmp($clean_rel, 'users') === 0 || (preg_match('#^users/[^/]+$#i', $clean_rel) && !AuthManager::isAdminLoggedIn())) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_move_denied')]];
            }
            if (!PermissionsManager::hasPermission('can_move', $base_dir, $source_rel)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_move_denied')]];
            }

            $parent_dir = dirname($source_full);
            $check_dir = is_dir($source_full) ? $source_full : $parent_dir;
            if (!DotfileManager::isDirAccessible($check_dir, $base_dir) || !DotfileManager::isDirAccessible($parent_dir, $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }

            if (!is_dir($source_full)) {
                $dest_ext = strtolower(pathinfo($new_name_raw, PATHINFO_EXTENSION));
                if (FormatRegistry::isForbiddenExtension($dest_ext) || FormatRegistry::hasForbiddenDoubleExtension($new_name_raw)) {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_forbidden_file_type')]];
                }
            }

            $destination = $parent_dir . '/' . $new_name_raw;
            if ($destination === $source_full) {
                return ['status' => 200, 'data' => ['success' => true, 'new_path' => $source_rel, 'name' => $new_name_raw]];
            }
            if (file_exists($destination)) {
                return ['status' => 409, 'data' => ['success' => false, 'error' => __t('api.err_destination_exists')]];
            }

            if (@rename($source_full, $destination)) {
                if (is_file($destination) && strtolower(pathinfo($destination, PATHINFO_EXTENSION)) === 'svg') {
                    SecurityManager::sanitizeSvgContent($destination);
                }
                $new_rel = PathValidator::getRelativePath($destination, $base_dir);
                \Atelier\Kernel\FS\FileIndexManager::removePath($project_root, $source_rel);
                if (is_file($destination)) {
                    \Atelier\Kernel\FS\FileIndexManager::upsertFile($project_root, $base_dir, $destination, $media_types);
                }
                CacheManager::invalidateDirCache($parent_dir, $base_dir, $thumb_dir_name);
                return ['status' => 200, 'data' => [
                    'success'  => true,
                    'new_path' => $new_rel,
                    'name'     => $new_name_raw
                ]];
            }

            return ['status' => 500, 'data' => ['success' => false, 'error' => __t('api.err_move_failed')]];
        }

        if ($action === 'copy_item') {
            $source_param = $_POST['source'] ?? $raw_body['source'] ?? '';
            $target_dir_param = $_POST['target_dir'] ?? $raw_body['target_dir'] ?? '';
            $new_name_param = isset($_POST['new_name']) ? trim($_POST['new_name']) : (isset($raw_body['new_name']) ? trim($raw_body['new_name']) : null);

            $source_full = PathValidator::canonicalizeAndValidate((string)$source_param, $base_dir, true, false);
            $target_dir_full = PathValidator::sanitizeDirectory($target_dir_param, $base_dir);

            if ($source_full === null || $target_dir_full === null || !file_exists($source_full) || !is_dir($target_dir_full)) {
                return ['status' => 404, 'data' => ['success' => false, 'error' => __t('api.err_source_or_dest_invalid')]];
            }
            $target_dir_rel = PathValidator::getRelativePath($target_dir_full, $base_dir);
            if (!PermissionsManager::hasPermission('can_upload', $base_dir, $target_dir_rel) && !AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_permission_denied')]];
            }
            $src_check_dir = is_dir($source_full) ? $source_full : dirname($source_full);
            if (!DotfileManager::isDirAccessible($src_check_dir, $base_dir) || !DotfileManager::isDirAccessible($target_dir_full, $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }

            if (is_dir($source_full) && ($source_full === $target_dir_full || strpos($target_dir_full . '/', $source_full . '/') === 0)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_move_into_self')]];
            }

            $dest_name = $new_name_param !== null ? basename($new_name_param) : basename($source_full);
            if (empty($dest_name) || $dest_name[0] === '.' || preg_match('/[\/\\\\:\*\?"<>\|]/', $dest_name)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_invalid_name')]];
            }
            if (!is_dir($source_full)) {
                $dest_ext = strtolower(pathinfo($dest_name, PATHINFO_EXTENSION));
                if (FormatRegistry::isForbiddenExtension($dest_ext) || FormatRegistry::hasForbiddenDoubleExtension($dest_name)) {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_forbidden_file_type')]];
                }
            }

            // Enforce personal disk quota when copying inside `users/<username>`
            if (preg_match('#^users/([^/]+)(?:/|$)#i', $target_dir_rel, $um_cp)) {
                $owner = \Atelier\Kernel\Auth\UserManager::findByUsername($project_root, $um_cp[1]);
                if ($owner && (int)($owner['quota_bytes'] ?? 0) > 0) {
                    $quotaInfo = \Atelier\Kernel\Auth\UserManager::getUserQuotaInfo($project_root, $base_dir, $owner);
                    $copyBytes = is_dir($source_full) ? self::computePathBytes($source_full) : max(0, (int)@filesize($source_full));
                    if (($quotaInfo['used_bytes'] + $copyBytes) > $quotaInfo['quota_bytes']) {
                        return ['status' => 413, 'data' => ['success' => false, 'error' => 'Quota disque dépassé pour cet espace personnel.']];
                    }
                }
            }

            $destination = $target_dir_full . '/' . $dest_name;
            if (file_exists($destination)) {
                $ext = pathinfo($dest_name, PATHINFO_EXTENSION);
                $name_without_ext = pathinfo($dest_name, PATHINFO_FILENAME);
                $counter = 1;
                do {
                    $candidate = $name_without_ext . '_copy' . ($counter > 1 ? $counter : '') . ($ext ? '.' . $ext : '');
                    $destination = $target_dir_full . '/' . $candidate;
                    $counter++;
                } while (file_exists($destination));
            }

            $copy_recursive = function(string $src, string $dst) use (&$copy_recursive): bool {
                if (is_link($src)) {
                    return true; // Never follow symlinks during recursive copy
                }
                if (is_dir($src)) {
                    @mkdir($dst, 0755, true);
                    $files = @scandir($src) ?: [];
                    foreach ($files as $file) {
                        if ($file === '.' || $file === '..') continue;
                        if (!$copy_recursive($src . '/' . $file, $dst . '/' . $file)) return false;
                    }
                    return true;
                }
                return @copy($src, $dst);
            };

            if ($copy_recursive($source_full, $destination)) {
                if (is_file($destination) && strtolower(pathinfo($destination, PATHINFO_EXTENSION)) === 'svg') {
                    SecurityManager::sanitizeSvgContent($destination);
                }
                CacheManager::invalidateDirCache($target_dir_full, $base_dir, $thumb_dir_name);
                return ['status' => 200, 'data' => [
                    'success'     => true,
                    'message'     => 'Élément copié avec succès',
                    'destination' => basename($destination)
                ]];
            }

            return ['status' => 500, 'data' => ['success' => false, 'error' => 'Erreur lors de la copie']];
        }

        if ($action === 'delete_item' || $action === 'delete_file' || $action === 'delete_folder') {
            $target_param = $_POST['target'] ?? $_GET['target'] ?? $raw_body['target']
                ?? $_POST['target_path'] ?? $_GET['target_path'] ?? $raw_body['target_path']
                ?? $_POST['path'] ?? $_GET['path'] ?? $raw_body['path']
                ?? $_POST['file'] ?? $raw_body['file'] ?? '';

            // Phase B: Delete inside an external mount (`ext://<mount_id>/...`)
            $ext_del = \Atelier\Kernel\Storage\ExternalMountManager::parseExternalPath((string)$target_param);
            if ($ext_del !== null) {
                $resolved = \Atelier\Kernel\Storage\ExternalMountManager::resolveMountForCurrentUser($project_root, (int)$ext_del['mount_id']);
                if (!$resolved || empty($resolved['can_write']) || $ext_del['rel_path'] === '') {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_delete_denied')]];
                }
                if ($resolved['driver']->delete($ext_del['rel_path'])) {
                    return ['status' => 200, 'data' => ['success' => true, 'message' => __t('api.msg_item_deleted')]];
                }
                return ['status' => 500, 'data' => ['success' => false, 'error' => __t('api.err_delete_failed')]];
            }

            $target_full = PathValidator::canonicalizeAndValidate((string)$target_param, $base_dir, true, false);

            if ($target_full === null || !file_exists($target_full)) {
                if (!PermissionsManager::hasPermission('can_delete', $base_dir, (string)$target_param)) {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_delete_denied')]];
                }
                return ['status' => 404, 'data' => ['success' => false, 'error' => __t('api.err_item_not_found')]];
            }
            $target_rel = PathValidator::getRelativePath($target_full, $base_dir);
            $target_rel_clean = trim(str_replace('\\', '/', $target_rel), '/');
            // Never allow deleting `users` root or a top-level user home folder via delete_item
            if (strcasecmp($target_rel_clean, 'users') === 0 || (preg_match('#^users/[^/]+$#i', $target_rel_clean) && !AuthManager::isAdminLoggedIn())) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_delete_denied')]];
            }
            if (!PermissionsManager::hasPermission('can_delete', $base_dir, $target_rel_clean)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_delete_denied')]];
            }
            $del_check_dir = is_dir($target_full) ? $target_full : dirname($target_full);
            if (!DotfileManager::isDirAccessible($del_check_dir, $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }

            $parent_dir = dirname($target_full);
            $permanent = !empty($raw_body['permanent']) || !empty($_POST['permanent']) || !empty($raw_body['hard_delete']);
            $success = false;
            $trash_item = null;

            if (!$permanent) {
                $tr_res = \Atelier\Kernel\FS\TrashAndVersioningManager::moveToTrash($project_root, $target_full, $target_rel_clean);
                if (!empty($tr_res['success'])) {
                    $success = true;
                    $trash_item = $tr_res['item'] ?? null;
                }
            }

            if (!$success) {
                if (is_dir($target_full)) {
                    $recursive_delete = function(string $dir) use (&$recursive_delete): bool {
                        $items = @scandir($dir);
                        if ($items === false) return false;
                        foreach ($items as $item) {
                            if ($item === '.' || $item === '..') continue;
                            $path = $dir . '/' . $item;
                            if (is_dir($path) && !is_link($path)) {
                                if (!$recursive_delete($path)) return false;
                            } else {
                                if (!@unlink($path)) return false;
                            }
                        }
                        return @rmdir($dir);
                    };
                    $success = $recursive_delete($target_full);
                } else {
                    $success = @unlink($target_full);
                }
            }

            if ($success) {
                CacheManager::invalidateDirCache($parent_dir, $base_dir, $thumb_dir_name);
                \Atelier\Kernel\FS\FileIndexManager::removePath($project_root, $target_rel_clean);
                return ['status' => 200, 'data' => [
                    'success'    => true,
                    'trashed'    => $trash_item !== null,
                    'trash_item' => $trash_item,
                    'message'    => __t('api.msg_item_deleted')
                ]];
            }

            return ['status' => 500, 'data' => ['success' => false, 'error' => __t('api.err_delete_failed')]];
        }

        if ($action === 'edit_image') {
            $target_param = $raw_body['target_path'] ?? $_POST['target_path'] ?? '';
            $save_mode = $raw_body['save_mode'] ?? $_POST['save_mode'] ?? 'copy';
            $image_data = $raw_body['image_data'] ?? $_POST['image_data'] ?? '';

            if (empty($target_param)) {
                if (!AuthManager::isAdminLoggedIn() && !PermissionsManager::hasPermission('can_upload', $base_dir)) {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
                }
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_invalid_path')]];
            }

            if (empty($image_data)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_missing_image_data')]];
            }

            $target_file = PathValidator::sanitizeFile($target_param, $base_dir);
            if ($target_file === null || !is_file($target_file) || PathValidator::isPathIgnored($target_file, $base_dir, $ignore_list)) {
                return ['status' => 404, 'data' => ['success' => false, 'error' => __t('api.err_invalid_path')]];
            }
            $target_rel = PathValidator::getRelativePath($target_file, $base_dir);
            if (!AuthManager::isAdminLoggedIn() && !PermissionsManager::hasPermission('can_upload', $base_dir, $target_rel)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            if (!DotfileManager::isDirAccessible(dirname($target_file), $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }

            $ext = strtolower(pathinfo($target_file, PATHINFO_EXTENSION));
            if (!in_array($ext, $media_types['image'] ?? ['jpg', 'jpeg', 'png', 'webp', 'gif'], true) || in_array($ext, ['php', 'phtml', 'phar', 'svg'], true)) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_unsupported_format')]];
            }

            if (preg_match('/^data:image\/(\w+);base64,/', $image_data, $type_match)) {
                $data_substr = substr($image_data, strpos($image_data, ',') + 1);
                $decoded_image = base64_decode($data_substr, true);
                if ($decoded_image === false || $decoded_image === '') {
                    return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_invalid_image_data')]];
                }
            } else {
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_invalid_image_data')]];
            }

            $parent_dir = dirname($target_file);
            if (!is_writable($parent_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_write_permission')]];
            }

            $dest_file = $target_file;
            $is_copy = ($save_mode === 'copy');

            // Enforce user disk quota when saving edited image inside `users/<username>`
            if (preg_match('#^users/([^/]+)(?:/|$)#i', $target_rel, $um_ed)) {
                $owner = \Atelier\Kernel\Auth\UserManager::findByUsername($project_root, $um_ed[1]);
                if ($owner && (int)($owner['quota_bytes'] ?? 0) > 0) {
                    $quotaInfo = \Atelier\Kernel\Auth\UserManager::getUserQuotaInfo($project_root, $base_dir, $owner);
                    $existingSz = (!$is_copy && is_file($target_file)) ? (int)@filesize($target_file) : 0;
                    $delta = max(0, strlen($decoded_image) - $existingSz);
                    if (($quotaInfo['used_bytes'] + $delta) > $quotaInfo['quota_bytes']) {
                        return ['status' => 413, 'data' => ['success' => false, 'error' => 'Quota disque dépassé pour cet espace personnel.']];
                    }
                }
            }

            if ($is_copy) {
                $info = pathinfo($target_file);
                $base_name = $info['filename'];
                $file_ext = !empty($info['extension']) ? '.' . $info['extension'] : '.jpg';
                $clean_base = preg_replace('/_edited(_\d+)?$/i', '', $base_name);
                $candidate_name = $clean_base . '_edited' . $file_ext;
                $counter = 1;
                while (file_exists($parent_dir . '/' . $candidate_name)) {
                    $candidate_name = $clean_base . '_edited_' . $counter . $file_ext;
                    $counter++;
                }
                $dest_file = $parent_dir . '/' . $candidate_name;
            }

            $image_to_write = $decoded_image;
            if (($ext === 'jpg' || $ext === 'jpeg')) {
                $image_to_write = ExifParser::transferJpegExif($target_file, $decoded_image);
            }

            $save_success = (@file_put_contents($dest_file, $image_to_write, LOCK_EX) !== false);

            if ($save_success) {
                @chmod($dest_file, 0644);
                CacheManager::invalidateDirCache($parent_dir, $base_dir, $thumb_dir_name);

                if (!$is_copy) {
                    $rel = PathValidator::getRelativePath($dest_file, $base_dir);
                    $thumb_cache_dir = CacheManager::getCacheStorageDir($base_dir, $thumb_dir_name);
                    $cache_key_jpg = $thumb_cache_dir . '/' . md5($rel) . '.jpg';
                    if (file_exists($cache_key_jpg)) @unlink($cache_key_jpg);
                }

                $saved_relative = PathValidator::getRelativePath($dest_file, $base_dir);
                $saved_filename = basename($dest_file);

                return ['status' => 200, 'data' => [
                    'success'        => true,
                    'message'        => $is_copy ? __t('api.success_copy_saved', ['name' => $saved_filename]) : __t('api.success_image_updated', ['name' => $saved_filename]),
                    'save_mode'      => $save_mode,
                    'is_copy'        => $is_copy,
                    'file_name'      => $saved_filename,
                    'path'           => $saved_relative,
                    'thumb_url'      => 'system/endpoints/thumb.php?file=' . rawurlencode($saved_relative) . '&t=' . time(),
                    'file_url'       => 'system/endpoints/thumb.php?file=' . rawurlencode($saved_relative) . '&raw=1&t=' . time()
                ]];
            }

            return ['status' => 500, 'data' => ['success' => false, 'error' => __t('api.err_file_write_failed')]];
        }

        if ($action === 'save_text_file' || $action === 'save_file_content') {
            $file_param = $raw_body['file'] ?? $raw_body['path'] ?? $_POST['file'] ?? $_POST['path'] ?? '';
            $content    = $raw_body['content'] ?? $_POST['content'] ?? '';

            // Phase B: Save text file inside an external mount (`ext://<mount_id>/...`)
            $ext_save = \Atelier\Kernel\Storage\ExternalMountManager::parseExternalPath((string)$file_param);
            if ($ext_save !== null) {
                $resolved = \Atelier\Kernel\Storage\ExternalMountManager::resolveMountForCurrentUser($project_root, (int)$ext_save['mount_id']);
                if (!$resolved || empty($resolved['can_write']) || $ext_save['rel_path'] === '') {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_save_denied')]];
                }
                $ext_bn = basename($ext_save['rel_path']);
                $ext = strtolower(pathinfo($ext_bn, PATHINFO_EXTENSION));
                if ($ext_bn === '' || $ext_bn[0] === '.' || FormatRegistry::isForbiddenExtension($ext) || FormatRegistry::hasForbiddenDoubleExtension($ext_bn)) {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_forbidden_file_type')]];
                }
                $mime = FormatRegistry::getHttpContentType($ext, $project_root, $media_types);
                if ($resolved['driver']->putContent($ext_save['rel_path'], (string)$content, $mime)) {
                    return ['status' => 200, 'data' => ['success' => true, 'message' => __t('api.msg_file_saved')]];
                }
                return ['status' => 500, 'data' => ['success' => false, 'error' => __t('api.err_file_save_failed')]];
            }

            if (!PermissionsManager::hasPermission('can_upload', $base_dir, (string)$file_param) && !AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_save_denied')]];
            }

            $file_full = PathValidator::canonicalizeAndValidate($file_param, $base_dir, false, false);
            if ($file_full === null) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_invalid_path')]];
            }
            if (!DotfileManager::isDirAccessible(dirname($file_full), $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }

            $filename = basename($file_full);
            $is_allowed_dotfile = in_array(strtolower($filename), ['.autorun.json', 'autorun.json'], true);
            if ($filename === '' || ($filename[0] === '.' && !$is_allowed_dotfile) || in_array(strtolower($filename), ['user.ini', '.user.ini', 'htaccess', '.htaccess', '.env', '.admin_password_hash'], true)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_forbidden_file_type')]];
            }

            $ext = strtolower(pathinfo($file_full, PATHINFO_EXTENSION));
            if (FormatRegistry::isForbiddenExtension($ext) || FormatRegistry::hasForbiddenDoubleExtension($filename) || in_array($ext, ['user.ini', 'admin_password_hash'], true)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_forbidden_file_type')]];
            }

            // Enforce user disk quota when saving inside `users/<username>`
            $rel_save = PathValidator::getRelativePath($file_full, $base_dir);
            if (preg_match('#^users/([^/]+)(?:/|$)#i', $rel_save, $um_sv)) {
                $owner = \Atelier\Kernel\Auth\UserManager::findByUsername($project_root, $um_sv[1]);
                if ($owner && (int)($owner['quota_bytes'] ?? 0) > 0) {
                    $quotaInfo = \Atelier\Kernel\Auth\UserManager::getUserQuotaInfo($project_root, $base_dir, $owner);
                    $existingSz = is_file($file_full) ? (int)@filesize($file_full) : 0;
                    $delta = max(0, strlen((string)$content) - $existingSz);
                    if (($quotaInfo['used_bytes'] + $delta) > $quotaInfo['quota_bytes']) {
                        return ['status' => 413, 'data' => ['success' => false, 'error' => 'Quota disque dépassé pour cet espace personnel.']];
                    }
                }
            }

            if ($is_allowed_dotfile) {
                $decoded = @json_decode((string)$content, true);
                if (!is_array($decoded)) {
                    return ['status' => 400, 'data' => ['success' => false, 'error' => __t('api.err_invalid_data')]];
                }
            }

            if (is_file($file_full)) {
                $rel_v = PathValidator::getRelativePath($file_full, $base_dir);
                \Atelier\Kernel\FS\TrashAndVersioningManager::snapshotBeforeOverwrite($project_root, $file_full, $rel_v);
            }

            if (@file_put_contents($file_full, (string)$content, LOCK_EX) !== false) {
                if ($ext === 'svg') {
                    SecurityManager::sanitizeSvgContent($file_full);
                }
                \Atelier\Kernel\FS\FileIndexManager::upsertFile($project_root, $base_dir, $file_full, $media_types);
                if ($is_allowed_dotfile) {
                    $dir = dirname($file_full);
                    $alt_name = (strtolower($filename) === '.autorun.json') ? 'autorun.json' : '.autorun.json';
                    $alt_path = $dir . '/' . $alt_name;
                    if (file_exists($alt_path)) {
                        @file_put_contents($alt_path, (string)$content, LOCK_EX);
                    }
                }
                CacheManager::invalidateDirCache(dirname($file_full), $base_dir, $thumb_dir_name);
                return ['status' => 200, 'data' => ['success' => true, 'message' => __t('api.msg_file_saved')]];
            }

            return ['status' => 500, 'data' => ['success' => false, 'error' => __t('api.err_file_save_failed')]];
        }

        return null;
    }

    /**
     * Computes recursive disk size of a file or directory without following symlinks.
     */
    private static function computePathBytes(string $absPath): int {
        if (is_link($absPath)) return 0;
        if (is_file($absPath)) return max(0, (int)@filesize($absPath));
        if (!is_dir($absPath)) return 0;
        $total = 0;
        foreach ((@scandir($absPath) ?: []) as $it) {
            if ($it === '.' || $it === '..') continue;
            $p = $absPath . '/' . $it;
            if (is_link($p)) continue;
            $total += is_dir($p) ? self::computePathBytes($p) : max(0, (int)@filesize($p));
        }
        return $total;
    }
}
