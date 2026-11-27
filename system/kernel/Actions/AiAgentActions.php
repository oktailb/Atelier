<?php
/**
 * Atelier by GallusTech - Phase E (Lot 1): AI Agent API Controller (`AiAgentActions`)
 *
 * Exposes CSRF-protected, session-scoped API actions:
 *   - `ai_get_config`        : Returns sanitized user AI config, available presets, policy status & admin policy (admin only)
 *   - `ai_save_user_config`  : Persists encrypted user LLM profiles, active model, autonomy level & per-app permissions
 *   - `ai_save_admin_policy` : Admin-only global policy (enabled, allow_private_lan, allowed_domains, rate limit, shared provider)
 *   - `ai_test_profile`      : Tests connectivity & discovers models for a saved or unsaved profile (anti-SSRF enforced)
 *   - `ai_chat`              : Server-side LLM completion proxy with rate limiting & normalized tool-calling
 */

namespace SimpleGallery\Kernel\Actions;

use SimpleGallery\Kernel\AI\AiSettings;
use SimpleGallery\Kernel\AI\LlmGateway;
use SimpleGallery\Kernel\Auth\AuditLogger;
use SimpleGallery\Kernel\Auth\AuthManager;
use SimpleGallery\Kernel\Config\ConfigStore;
use SimpleGallery\Kernel\Security\RateLimiter;

class AiAgentActions {

    public static function handle(string $action, array $params, $context): ?array {
        $base_dir = is_array($context) ? ($context['base_dir'] ?? '') : (string)$context;
        $project_root = (is_array($context) && !empty($context['project_root']))
            ? (string)$context['project_root']
            : ConfigStore::resolveRoot($base_dir);
        $raw_body = is_array($context) ? ($context['raw_body'] ?? $params) : $params;
        $in = array_merge($_GET, $_POST, is_array($raw_body) ? $raw_body : []);

        if ($action === 'ai_get_config') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            $isAdmin = AuthManager::isAdminLoggedIn();
            $policy = AiSettings::loadAdminPolicy($project_root);
            $canUse = AiSettings::canCurrentUserUseAgent($project_root, $base_dir);

            $data = [
                'success'          => true,
                'can_use'          => $canUse,
                'presets'          => AiSettings::PROVIDER_PRESETS,
                'autonomy_levels'  => AiSettings::VALID_AUTONOMY_LEVELS,
                'public_policy'    => [
                    'enabled'                 => $policy['enabled'],
                    'allow_private_lan'       => $policy['allow_private_lan'],
                    'allowed_domains'         => $policy['allowed_domains'],
                    'max_tool_steps'          => $policy['max_tool_steps'],
                    'rate_limit_per_minute'   => $policy['rate_limit_per_minute'],
                    'shared_provider_enabled' => $policy['shared_provider_enabled'],
                    'shared_provider_label'   => $policy['shared_provider']['label'],
                    'shared_provider_model'   => $policy['shared_provider']['default_model'],
                    'shared_provider_models'  => $policy['shared_provider']['models']
                ],
                'config'           => AiSettings::getUserConfigForUi($project_root)
            ];
            if ($isAdmin) {
                $data['admin_policy'] = AiSettings::getAdminPolicyForUi($project_root);
            }
            return ['status' => 200, 'data' => $data];
        }

        if ($action === 'ai_save_user_config') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            if (!AiSettings::canCurrentUserUseAgent($project_root, $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => 'AI Agent is disabled for your account.']];
            }
            $payload = isset($in['config']) && is_array($in['config']) ? $in['config'] : $in;
            $res = AiSettings::saveUserConfig($project_root, $payload);
            return ['status' => (int)($res['status'] ?? 200), 'data' => $res];
        }

        if ($action === 'ai_save_admin_policy') {
            if (!AuthManager::isAdminLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
            }
            $payload = isset($in['policy']) && is_array($in['policy']) ? $in['policy'] : $in;
            $res = AiSettings::saveAdminPolicy($project_root, $payload);
            return ['status' => (int)($res['status'] ?? 200), 'data' => $res];
        }

        if ($action === 'ai_test_profile') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            if (!AiSettings::canCurrentUserUseAgent($project_root, $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => 'AI Agent is disabled for your account.']];
            }

            $policy = AiSettings::loadAdminPolicy($project_root);
            $profileId = trim((string)($in['profile_id'] ?? ''));
            $profileIn = is_array($in['profile'] ?? null) ? $in['profile'] : [];
            $isSharedTest = ($profileId === '__shared__' || !empty($in['is_shared']));

            if ($isSharedTest) {
                if (!AuthManager::isAdminLoggedIn()) {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_admin_required')]];
                }
                $sp = $policy['shared_provider'];
                $dec = $sp['api_key_enc'] !== ''
                    ? \SimpleGallery\Kernel\Storage\CredentialVault::decryptJson($project_root, (string)$sp['api_key_enc'])
                    : [];
                $effective = [
                    'type'     => (string)($profileIn['type'] ?? $sp['type']),
                    'base_url' => (string)($profileIn['base_url'] ?? $sp['base_url']),
                    'api_key'  => (isset($profileIn['api_key']) && trim((string)$profileIn['api_key']) !== '')
                        ? trim((string)$profileIn['api_key'])
                        : (string)($dec['api_key'] ?? '')
                ];
            } else {
                $saved = $profileId !== ''
                    ? AiSettings::resolveProfileForExecution($project_root, $profileId)
                    : null;
                $effective = [
                    'type'     => (string)($profileIn['type'] ?? ($saved['type'] ?? 'openai_compat')),
                    'base_url' => (string)($profileIn['base_url'] ?? ($saved['base_url'] ?? '')),
                    'api_key'  => (isset($profileIn['api_key']) && trim((string)$profileIn['api_key']) !== '')
                        ? trim((string)$profileIn['api_key'])
                        : (string)($saved['api_key'] ?? '')
                ];
            }

            $res = LlmGateway::testAndDiscoverModels(
                $effective,
                (bool)$policy['allow_private_lan'],
                (array)$policy['allowed_domains']
            );
            return ['status' => (int)($res['status'] ?? 200), 'data' => $res];
        }

        if ($action === 'ai_chat') {
            if (!AuthManager::isLoggedIn()) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => __t('api.err_access_denied')]];
            }
            if (!AiSettings::canCurrentUserUseAgent($project_root, $base_dir)) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => 'AI Agent is disabled for your account.']];
            }

            $policy = AiSettings::loadAdminPolicy($project_root);
            $scope = AiSettings::getCurrentActorScope() ?: 'anon';
            $rlKey = 'ai_chat_' . md5($scope . '|' . RateLimiter::getClientIp());
            if (!RateLimiter::check($rlKey, (int)$policy['rate_limit_per_minute'], 60)) {
                return ['status' => 429, 'data' => ['success' => false, 'error' => __t('api.err_rate_limit')]];
            }
            RateLimiter::increment($rlKey);

            $messages = is_array($in['messages'] ?? null) ? $in['messages'] : [];
            if (empty($messages) || count($messages) > 60) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'Messages array is required (1-60 messages).']];
            }

            $profileId = trim((string)($in['profile_id'] ?? ''));
            $model = trim((string)($in['model'] ?? ''));
            $profile = AiSettings::resolveProfileForExecution($project_root, $profileId, $model);
            if ($profile === null) {
                return ['status' => 400, 'data' => ['success' => false, 'error' => 'No AI provider profile configured. Configure one in Control Panel → AI & Agent.']];
            }

            $tools = is_array($in['tools'] ?? null) ? array_slice($in['tools'], 0, 50) : [];
            $options = [
                'max_tokens'  => isset($in['max_tokens']) ? (int)$in['max_tokens'] : 2048,
                'temperature' => isset($in['temperature']) ? (float)$in['temperature'] : 0.3
            ];

            $res = LlmGateway::chat(
                $profile,
                $messages,
                $tools,
                $options,
                (bool)$policy['allow_private_lan'],
                (array)$policy['allowed_domains']
            );

            AuditLogger::log($project_root, 'ai_chat', $profile['type'] . ':' . $profile['model'], !empty($res['success']) ? 'ok' : 'failed', [
                'profile_id' => $profile['id'],
                'tools_cnt'  => count($tools)
            ]);

            return ['status' => (int)($res['status'] ?? 200), 'data' => $res];
        }

        return null;
    }
}
