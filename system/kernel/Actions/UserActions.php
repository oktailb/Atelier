<?php
/**
 * Atelier by GallusTech - Multi-User, Group, Shares, Mounted Volumes, Tags & Audit API Controller
 */

namespace Atelier\Kernel\Actions;

use Atelier\Kernel\Auth\AuditLogger;
use Atelier\Kernel\Auth\AuthManager;
use Atelier\Kernel\Auth\ShareManager;
use Atelier\Kernel\Auth\UserManager;
use Atelier\Kernel\Config\ConfigStore;
use Atelier\Kernel\Data\AtelierStore;
use Atelier\Kernel\Security\RateLimiter;

class UserActions {

    public static function handle(string $action, array $params, $context): ?array {
        $base_dir = is_array($context) ? ($context['base_dir'] ?? '') : (string)$context;
        $project_root = (is_array($context) && !empty($context['project_root']))
            ? (string)$context['project_root']
            : ConfigStore::resolveRoot($base_dir);
        $raw_body = is_array($context) ? ($context['raw_body'] ?? $params) : $params;
        $in = array_merge($_GET, $_POST, is_array($raw_body) ? $raw_body : []);

        // 1. Current Identity, Preferences, Isolated Desktop & Mounted Volumes
        if ($action === 'get_current_user') {
            $user = AuthManager::getCurrentUser();
            $isAdmin = AuthManager::isAdminLoggedIn();
            $store = AtelierStore::forRoot($project_root);
            return ['status' => 200, 'data' => [
                'success'         => true,
                'user'            => $user,
                'is_admin'        => $isAdmin,
                'is_logged_in'    => AuthManager::isLoggedIn(),
                'store_driver'    => $store->getDriverName(),
                'quota'                 => $user ? UserManager::getUserQuotaInfo($project_root, $base_dir, $user) : null,
                'preferences'           => $user ? UserManager::getUserPreferences($project_root, (int)$user['id']) : [],
                'desktop_config'        => UserManager::getEffectiveDesktopConfig($project_root, $user, $isAdmin),
                'effective_permissions' => \Atelier\Kernel\FS\PermissionsManager::resolveEffectivePermissions($project_root, $user, $isAdmin),
                'mounted_volumes'       => ShareManager::getMountedVolumesForCurrentUser($base_dir),
                'csrf_token'            => get_csrf_token()
            ]];
        }

        if ($action === 'get_user_preferences') {
            $user = AuthManager::getCurrentUser();
            if (!$user) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            return ['status' => 200, 'data' => [
                'success'     => true,
                'preferences' => UserManager::getUserPreferences($project_root, (int)$user['id'])
            ]];
        }

        if ($action === 'save_user_preferences') {
            $user = AuthManager::getCurrentUser();
            if (!$user) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $patch = $in['preferences'] ?? $in;
            if (is_string($patch)) {
                $patch = @json_decode($patch, true) ?: [];
            }
            $res = UserManager::saveUserPreferences($project_root, (int)$user['id'], is_array($patch) ? $patch : []);
            return ['status' => $res['status'], 'data' => $res];
        }

        // 1b. Self-Service Data Export (Signed ZIP) & Account Deletion
        if ($action === 'create_account_export') {
            $user = AuthManager::getCurrentUser();
            if (!$user) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $ttlHours = (int)($in['ttl_hours'] ?? \Atelier\Kernel\Auth\AccountExportService::DEFAULT_TTL_HOURS);
            $res = \Atelier\Kernel\Auth\AccountExportService::createExport($project_root, $base_dir, $user, $ttlHours, false);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'list_account_exports') {
            $user = AuthManager::getCurrentUser();
            if (!$user) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            return ['status' => 200, 'data' => [
                'success' => true,
                'exports' => \Atelier\Kernel\Auth\AccountExportService::listUserExports($project_root, (int)$user['id'])
            ]];
        }

        if ($action === 'confirm_account_export_receipt') {
            $token = isset($in['token']) ? trim((string)$in['token']) : null;
            $exportId = isset($in['export_id']) ? (int)$in['export_id'] : null;
            $discard = !empty($in['discard_without_download']);
            $user = AuthManager::getCurrentUser();
            if (($token === null || $token === '') && !$user) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $res = \Atelier\Kernel\Auth\AccountExportService::confirmReceipt(
                $project_root,
                $token,
                $exportId,
                $user ? (int)$user['id'] : null,
                $discard
            );
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'delete_own_account') {
            $user = AuthManager::getCurrentUser();
            if (!$user) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $res = \Atelier\Kernel\Auth\AccountExportService::deleteSelfAccount($project_root, $base_dir, $user, $in);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'get_mounted_volumes') {
            return ['status' => 200, 'data' => [
                'success' => true,
                'volumes' => ShareManager::getMountedVolumesForCurrentUser($base_dir)
            ]];
        }

        // 2. Users Management
        if ($action === 'list_users') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $all = UserManager::listUsers($project_root);
            if (!AuthManager::isAdminLoggedIn()) {
                // Non-admin users only see minimal directory entries to select share recipients
                $directory = [];
                foreach ($all as $u) {
                    if (empty($u['is_active'])) continue;
                    $directory[] = [
                        'id'           => $u['id'],
                        'username'     => $u['username'],
                        'display_name' => $u['display_name']
                    ];
                }
                return ['status' => 200, 'data' => ['success' => true, 'users' => $directory]];
            }
            return ['status' => 200, 'data' => ['success' => true, 'users' => $all]];
        }

        if ($action === 'create_user') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $res = UserManager::createUser($project_root, $base_dir, $in);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'update_user') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $uid = (int)($in['user_id'] ?? $in['id'] ?? 0);
            $res = UserManager::updateUser($project_root, $uid, $in);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'delete_user') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $uid = (int)($in['user_id'] ?? $in['id'] ?? 0);
            $cur = AuthManager::getCurrentUser();
            if ($cur && (int)$cur['id'] === $uid) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'Cannot delete your own active account.']];
            }
            $res = UserManager::deleteUser($project_root, $uid);
            return ['status' => $res['status'], 'data' => $res];
        }

        // 3. Groups Management
        if ($action === 'list_groups') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            return ['status' => 200, 'data' => [
                'success' => true,
                'groups'  => UserManager::listGroups($project_root)
            ]];
        }

        if ($action === 'create_group') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $res = UserManager::createGroup($project_root, $in);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'set_group_members') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $gid = (int)($in['group_id'] ?? $in['id'] ?? 0);
            $memberIds = $in['member_ids'] ?? $in['user_ids'] ?? [];
            if (is_string($memberIds)) {
                $memberIds = json_decode($memberIds, true) ?: [];
            }
            $res = UserManager::setGroupMembers($project_root, $gid, is_array($memberIds) ? $memberIds : []);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'delete_group') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $gid = (int)($in['group_id'] ?? $in['id'] ?? 0);
            $res = UserManager::deleteGroup($project_root, $gid);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'set_group_permissions') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $gid = (int)($in['group_id'] ?? $in['id'] ?? 0);
            $overrides = $in['permission_overrides'] ?? $in['permissions'] ?? [];
            $res = UserManager::setGroupPermissions($project_root, $gid, $overrides);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'set_user_permissions') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $uid = (int)($in['user_id'] ?? $in['id'] ?? 0);
            $overrides = $in['permission_overrides'] ?? $in['permissions'] ?? [];
            $res = UserManager::setUserPermissions($project_root, $uid, $overrides);
            return ['status' => $res['status'], 'data' => $res];
        }

        // 4. User-to-User & Group Folder Shares (Mounted Volumes)
        if ($action === 'list_user_shares') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $all = !empty($in['all']) && AuthManager::isAdminLoggedIn();
            return ['status' => 200, 'data' => [
                'success' => true,
                'shares'  => ShareManager::listUserShares($project_root, $all)
            ]];
        }

        if ($action === 'create_user_share') {
            $res = ShareManager::createUserShare($project_root, $base_dir, $in);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'revoke_user_share') {
            $sid = (int)($in['share_id'] ?? $in['id'] ?? 0);
            $res = ShareManager::revokeUserShare($project_root, $sid);
            return ['status' => $res['status'], 'data' => $res];
        }

        // 5. Signed External Share Links
        if ($action === 'list_share_links') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            return ['status' => 200, 'data' => [
                'success' => true,
                'links'   => ShareManager::listShareLinks($project_root)
            ]];
        }

        if ($action === 'create_share_link') {
            $res = ShareManager::createShareLink($project_root, $base_dir, $in);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'revoke_share_link') {
            $lid = (int)($in['link_id'] ?? $in['id'] ?? 0);
            $res = ShareManager::revokeShareLink($project_root, $lid);
            return ['status' => $res['status'], 'data' => $res];
        }

        if ($action === 'access_share_link') {
            $token = (string)($in['token'] ?? '');
            $password = (string)($in['password'] ?? '');
            $rlKey = 'share_link_' . md5($token) . '_' . RateLimiter::getClientIp();
            if (!RateLimiter::check($rlKey, 10, 900)) {
                return ['status' => 429, 'data' => ['success' => false, 'error' => __t('api.err_rate_limit')]];
            }
            $res = ShareManager::accessShareLink($project_root, $token, $password);
            if (empty($res['success']) && ($res['status'] ?? 0) === 401) {
                RateLimiter::increment($rlKey);
            } elseif (!empty($res['success'])) {
                RateLimiter::reset($rlKey);
            }
            return ['status' => $res['status'], 'data' => $res];
        }

        // 6. Future-Proof Tagging, Classification & Crypto Metadata Endpoints
        if ($action === 'list_tags') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $ns = isset($in['namespace']) ? (string)$in['namespace'] : null;
            $tags = ShareManager::listTags($project_root, $ns);
            if (!AuthManager::isAdminLoggedIn()) {
                $cur = AuthManager::getCurrentUser();
                $curId = $cur ? (int)$cur['id'] : 0;
                $tags = array_values(array_filter($tags, function ($t) use ($curId) {
                    return empty($t['owner_user_id']) || (int)$t['owner_user_id'] === $curId;
                }));
            }
            return ['status' => 200, 'data' => [
                'success' => true,
                'tags'    => $tags
            ]];
        }

        if ($action === 'get_item_tags') {
            $rel = ShareManager::normalizeRelPath((string)($in['path'] ?? ''));
            if ($rel === '') {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'Path required.']];
            }
            // Enforce strict read ACL / dotfile visibility (anti-IDOR)
            $canRead = AuthManager::isAdminLoggedIn() || ShareManager::canReadPath($rel, $base_dir);
            if (!$canRead) {
                $resolved = \Atelier\Kernel\Security\PathValidator::canonicalize($rel, $base_dir, true, true);
                if ($resolved !== null) {
                    $checkDir = is_dir($resolved) ? $resolved : dirname($resolved);
                    $canRead = \Atelier\Kernel\FS\DotfileManager::isDirAccessible($checkDir, $base_dir);
                }
            }
            if (!$canRead) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            return ['status' => 200, 'data' => [
                'success'  => true,
                'tags'     => ShareManager::getItemTags($project_root, $rel),
                'metadata' => ShareManager::getItemMetadata($project_root, $rel)
            ]];
        }

        if ($action === 'set_item_tags') {
            $rel = ShareManager::normalizeRelPath((string)($in['path'] ?? ''));
            if ($rel === '' || !ShareManager::canWritePath($rel, $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $tags = $in['tags'] ?? [];
            if (is_string($tags)) {
                $tags = json_decode($tags, true) ?: array_map('trim', explode(',', $tags));
            }
            $savedTags = ShareManager::setItemTags($project_root, $rel, is_array($tags) ? $tags : []);
            if (isset($in['classification']) || isset($in['is_encrypted']) || isset($in['crypto_algo'])) {
                ShareManager::setItemMetadata($project_root, $rel, $in);
            }
            return ['status' => 200, 'data' => [
                'success'  => true,
                'tags'     => $savedTags,
                'metadata' => ShareManager::getItemMetadata($project_root, $rel)
            ]];
        }

        // 7. Audit Log (Admin only)
        if ($action === 'get_audit_logs') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $limit = (int)($in['limit'] ?? 50);
            return ['status' => 200, 'data' => [
                'success' => true,
                'logs'    => AuditLogger::recent($project_root, $limit)
            ]];
        }

        return null;
    }
}
