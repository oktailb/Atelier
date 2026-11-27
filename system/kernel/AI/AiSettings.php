<?php
/**
 * Atelier by GallusTech - Phase E (Lot 1): Universal AI Agent Settings & Encrypted User Profiles
 *
 * Security invariants:
 * - User LLM profiles & API keys are NEVER stored in `users.preferences_json` (which is exposed to JS boot).
 * - Each user's profiles are stored in `storage/ai_profiles/<scope>.enc.json` (protected by `.htaccess` Deny from all)
 *   encrypted at rest via `CredentialVault` (AES-256-GCM).
 * - Plaintext API keys are NEVER returned to the browser (`has_api_key: bool` only).
 * - Admin policy (`storage/ai_settings.json`) governs global activation, private LAN access (Ollama/vLLM),
 *   allowed domains, rate limits, max tool steps, and optional instance-wide shared provider.
 */

namespace SimpleGallery\Kernel\AI;

use SimpleGallery\Kernel\Auth\AuditLogger;
use SimpleGallery\Kernel\Auth\AuthManager;
use SimpleGallery\Kernel\Config\ConfigStore;
use SimpleGallery\Kernel\FS\PermissionsManager;
use SimpleGallery\Kernel\Storage\CredentialVault;

class AiSettings {

    public const VALID_PROVIDER_TYPES = ['openai_compat', 'anthropic', 'gemini', 'ollama'];
    public const VALID_AUTONOMY_LEVELS = ['read_only', 'assisted', 'autonomous_app'];
    public const MAX_PROFILES_PER_USER = 10;

    public const PROVIDER_PRESETS = [
        'openai' => [
            'label'            => 'OpenAI',
            'type'             => 'openai_compat',
            'base_url'         => 'https://api.openai.com/v1',
            'default_model'    => 'gpt-4o-mini',
            'suggested_models' => ['gpt-4o-mini', 'gpt-4o', 'o4-mini'],
            'docs_url'         => 'https://platform.openai.com/api-keys',
            'help_key'         => 'ai.help_openai',
            'requires_api_key' => true
        ],
        'anthropic' => [
            'label'            => 'Anthropic Claude',
            'type'             => 'anthropic',
            'base_url'         => 'https://api.anthropic.com',
            'default_model'    => 'claude-sonnet-4-20250514',
            'suggested_models' => ['claude-sonnet-4-20250514', 'claude-3-5-haiku-latest'],
            'docs_url'         => 'https://console.anthropic.com/settings/keys',
            'help_key'         => 'ai.help_anthropic',
            'requires_api_key' => true
        ],
        'gemini' => [
            'label'            => 'Google Gemini',
            'type'             => 'gemini',
            'base_url'         => 'https://generativelanguage.googleapis.com',
            'default_model'    => 'gemini-2.5-flash',
            'suggested_models' => ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
            'docs_url'         => 'https://aistudio.google.com/apikey',
            'help_key'         => 'ai.help_gemini',
            'requires_api_key' => true
        ],
        'openrouter' => [
            'label'            => 'OpenRouter',
            'type'             => 'openai_compat',
            'base_url'         => 'https://openrouter.ai/api/v1',
            'default_model'    => 'google/gemini-2.5-flash',
            'suggested_models' => ['google/gemini-2.5-flash', 'anthropic/claude-sonnet-4', 'openai/gpt-4o-mini'],
            'docs_url'         => 'https://openrouter.ai/keys',
            'help_key'         => 'ai.help_openrouter',
            'requires_api_key' => true
        ],
        'mistral' => [
            'label'            => 'Mistral AI',
            'type'             => 'openai_compat',
            'base_url'         => 'https://api.mistral.ai/v1',
            'default_model'    => 'mistral-small-latest',
            'suggested_models' => ['mistral-small-latest', 'mistral-large-latest', 'codestral-latest'],
            'docs_url'         => 'https://console.mistral.ai/api-keys',
            'help_key'         => 'ai.help_mistral',
            'requires_api_key' => true
        ],
        'ollama' => [
            'label'            => 'Ollama (Local / LAN)',
            'type'             => 'ollama',
            'base_url'         => 'http://127.0.0.1:11434',
            'default_model'    => 'llama3.2',
            'suggested_models' => ['llama3.2', 'qwen2.5-coder:7b', 'mistral'],
            'docs_url'         => 'https://ollama.com/download',
            'help_key'         => 'ai.help_ollama',
            'requires_api_key' => false
        ],
        'openai_compat' => [
            'label'            => 'OpenAI-Compatible (vLLM / LM Studio / Custom)',
            'type'             => 'openai_compat',
            'base_url'         => '',
            'default_model'    => '',
            'suggested_models' => [],
            'docs_url'         => '',
            'help_key'         => 'ai.help_openai_compat',
            'requires_api_key' => false
        ]
    ];

    public const DEFAULT_ADMIN_POLICY = [
        'enabled'                   => true,
        'allow_authenticated_users' => true,
        'allow_private_lan'         => false,
        'allowed_domains'           => [],
        'rate_limit_per_minute'     => 30,
        'max_tool_steps'            => 10,
        'shared_provider_enabled'   => false,
        'shared_provider'           => [
            'label'         => 'Instance Default LLM',
            'type'          => 'openai_compat',
            'base_url'      => 'https://api.openai.com/v1',
            'default_model' => 'gpt-4o-mini',
            'models'        => [],
            'api_key_enc'   => ''
        ]
    ];

    public const DEFAULT_USER_CONFIG = [
        'profiles'          => [],
        'active_profile_id' => '',
        'active_model'      => '',
        'autonomy_level'    => 'assisted',
        'system_prompt'     => '',
        'max_tool_steps'    => 8,
        'vision_enabled'    => true,
        'disabled_apps'     => []
    ];

    public static function getProfilesDir(string $projectRoot): string {
        $dir = rtrim(str_replace('\\', '/', ConfigStore::getStorageDir($projectRoot)), '/') . '/ai_profiles';
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        $ht = $dir . '/.htaccess';
        if (!file_exists($ht)) {
            @file_put_contents($ht, "Deny from all\n", LOCK_EX);
        }
        return $dir;
    }

    public static function getCurrentActorScope(): ?string {
        $user = AuthManager::getCurrentUser();
        if ($user && !empty($user['id'])) {
            return 'u_' . (int)$user['id'];
        }
        if (AuthManager::isAdminLoggedIn()) {
            return 'admin';
        }
        return null;
    }

    // -------------------------------------------------------------------------
    // Admin Policy (`storage/ai_settings.json`)
    // -------------------------------------------------------------------------

    public static function loadAdminPolicy(string $projectRoot): array {
        $raw = ConfigStore::get('ai_settings', [], $projectRoot);
        if (!is_array($raw)) {
            $raw = [];
        }
        $policy = array_merge(self::DEFAULT_ADMIN_POLICY, $raw);
        $policy['enabled'] = !empty($policy['enabled']);
        $policy['allow_authenticated_users'] = array_key_exists('allow_authenticated_users', $raw)
            ? !empty($raw['allow_authenticated_users'])
            : true;
        $policy['allow_private_lan'] = !empty($policy['allow_private_lan']);
        $policy['allowed_domains'] = self::sanitizeDomainList($policy['allowed_domains'] ?? []);
        $policy['rate_limit_per_minute'] = max(1, min(300, (int)($policy['rate_limit_per_minute'] ?? 30)));
        $policy['max_tool_steps'] = max(1, min(25, (int)($policy['max_tool_steps'] ?? 10)));
        $policy['shared_provider_enabled'] = !empty($policy['shared_provider_enabled']);

        $spRaw = is_array($policy['shared_provider'] ?? null) ? $policy['shared_provider'] : [];
        $spType = in_array($spRaw['type'] ?? '', self::VALID_PROVIDER_TYPES, true) ? (string)$spRaw['type'] : 'openai_compat';
        $policy['shared_provider'] = [
            'label'         => mb_substr(trim((string)($spRaw['label'] ?? 'Instance Default LLM')) ?: 'Instance Default LLM', 0, 80),
            'type'          => $spType,
            'base_url'      => self::sanitizeBaseUrl((string)($spRaw['base_url'] ?? '')),
            'default_model' => self::sanitizeModelName((string)($spRaw['default_model'] ?? '')),
            'models'        => self::sanitizeModelList($spRaw['models'] ?? []),
            'api_key_enc'   => (string)($spRaw['api_key_enc'] ?? '')
        ];
        return $policy;
    }

    public static function getAdminPolicyForUi(string $projectRoot): array {
        $policy = self::loadAdminPolicy($projectRoot);
        $sp = $policy['shared_provider'];
        $policy['shared_provider'] = [
            'label'         => $sp['label'],
            'type'          => $sp['type'],
            'base_url'      => $sp['base_url'],
            'default_model' => $sp['default_model'],
            'models'        => $sp['models'],
            'has_api_key'   => ($sp['api_key_enc'] !== '')
        ];
        return $policy;
    }

    public static function saveAdminPolicy(string $projectRoot, array $input): array {
        if (!AuthManager::isAdminLoggedIn()) {
            return ['success' => false, 'status' => 403, 'error' => 'Administrator privileges required.'];
        }
        $current = self::loadAdminPolicy($projectRoot);

        $updated = [
            'enabled'                   => array_key_exists('enabled', $input) ? (bool)$input['enabled'] : $current['enabled'],
            'allow_authenticated_users' => array_key_exists('allow_authenticated_users', $input) ? (bool)$input['allow_authenticated_users'] : $current['allow_authenticated_users'],
            'allow_private_lan'         => array_key_exists('allow_private_lan', $input) ? (bool)$input['allow_private_lan'] : $current['allow_private_lan'],
            'allowed_domains'           => array_key_exists('allowed_domains', $input) ? self::sanitizeDomainList($input['allowed_domains']) : $current['allowed_domains'],
            'rate_limit_per_minute'     => array_key_exists('rate_limit_per_minute', $input) ? max(1, min(300, (int)$input['rate_limit_per_minute'])) : $current['rate_limit_per_minute'],
            'max_tool_steps'            => array_key_exists('max_tool_steps', $input) ? max(1, min(25, (int)$input['max_tool_steps'])) : $current['max_tool_steps'],
            'shared_provider_enabled'   => array_key_exists('shared_provider_enabled', $input) ? (bool)$input['shared_provider_enabled'] : $current['shared_provider_enabled'],
            'shared_provider'           => $current['shared_provider']
        ];

        if (isset($input['shared_provider']) && is_array($input['shared_provider'])) {
            $spIn = $input['shared_provider'];
            $spType = in_array($spIn['type'] ?? '', self::VALID_PROVIDER_TYPES, true)
                ? (string)$spIn['type']
                : $current['shared_provider']['type'];
            $apiKeyEnc = $current['shared_provider']['api_key_enc'];
            if (!empty($spIn['clear_api_key'])) {
                $apiKeyEnc = '';
            } elseif (isset($spIn['api_key']) && trim((string)$spIn['api_key']) !== '') {
                $apiKeyEnc = CredentialVault::encryptJson($projectRoot, ['api_key' => trim((string)$spIn['api_key'])]);
            }
            $updated['shared_provider'] = [
                'label'         => mb_substr(trim((string)($spIn['label'] ?? $current['shared_provider']['label'])) ?: 'Instance Default LLM', 0, 80),
                'type'          => $spType,
                'base_url'      => array_key_exists('base_url', $spIn) ? self::sanitizeBaseUrl((string)$spIn['base_url']) : $current['shared_provider']['base_url'],
                'default_model' => array_key_exists('default_model', $spIn) ? self::sanitizeModelName((string)$spIn['default_model']) : $current['shared_provider']['default_model'],
                'models'        => array_key_exists('models', $spIn) ? self::sanitizeModelList($spIn['models']) : $current['shared_provider']['models'],
                'api_key_enc'   => $apiKeyEnc
            ];
        }

        if (!ConfigStore::set('ai_settings', $updated, $projectRoot)) {
            return ['success' => false, 'status' => 500, 'error' => 'Failed to persist AI policy settings.'];
        }

        AuditLogger::log($projectRoot, 'ai_policy_updated', 'ai_settings', 'ok', [
            'enabled'                 => $updated['enabled'],
            'allow_private_lan'       => $updated['allow_private_lan'],
            'shared_provider_enabled' => $updated['shared_provider_enabled']
        ]);

        return [
            'success' => true,
            'status'  => 200,
            'policy'  => self::getAdminPolicyForUi($projectRoot)
        ];
    }

    /**
     * Checks whether the current authenticated session is allowed to use the AI Agent.
     */
    public static function canCurrentUserUseAgent(string $projectRoot, string $mediaDir): bool {
        if (!AuthManager::isLoggedIn()) {
            return false;
        }
        $policy = self::loadAdminPolicy($projectRoot);
        if (AuthManager::isAdminLoggedIn()) {
            return true;
        }
        if (empty($policy['enabled'])) {
            return false;
        }
        if (PermissionsManager::hasPermission('can_use_ai_agent', $mediaDir)) {
            return true;
        }
        if (!empty($policy['allow_authenticated_users'])) {
            // Respect explicit deny overrides at user or group tier
            $user = AuthManager::getCurrentUser();
            if ($user && !empty($user['id'])) {
                $overrides = PermissionsManager::decodeOverrides($user['permission_overrides'] ?? []);
                if (($overrides['can_use_ai_agent'] ?? '') === 'deny') {
                    return false;
                }
                return strtolower((string)($user['role'] ?? 'user')) !== 'guest';
            }
        }
        return false;
    }

    // -------------------------------------------------------------------------
    // Per-User Encrypted AI Config (`storage/ai_profiles/<scope>.enc.json`)
    // -------------------------------------------------------------------------

    private static function getScopeFilePath(string $projectRoot, string $scope): string {
        $safeScope = preg_replace('/[^a-zA-Z0-9_-]/', '', $scope);
        return self::getProfilesDir($projectRoot) . '/' . $safeScope . '.enc.json';
    }

    public static function loadUserConfigRaw(string $projectRoot, ?string $scope = null): array {
        $resolvedScope = $scope ?? self::getCurrentActorScope();
        if ($resolvedScope === null || $resolvedScope === '') {
            return self::DEFAULT_USER_CONFIG;
        }
        $path = self::getScopeFilePath($projectRoot, $resolvedScope);
        if (!is_file($path)) {
            return self::DEFAULT_USER_CONFIG;
        }
        $wrapper = @json_decode((string)@file_get_contents($path), true);
        if (!is_array($wrapper) || empty($wrapper['enc'])) {
            return self::DEFAULT_USER_CONFIG;
        }
        $decoded = CredentialVault::decryptJson($projectRoot, (string)$wrapper['enc']);
        if (!is_array($decoded)) {
            return self::DEFAULT_USER_CONFIG;
        }
        return array_merge(self::DEFAULT_USER_CONFIG, $decoded);
    }

    /**
     * Returns the current user's AI configuration sanitized for the frontend UI (NEVER exposes API keys).
     */
    public static function getUserConfigForUi(string $projectRoot, ?string $scope = null): array {
        $raw = self::loadUserConfigRaw($projectRoot, $scope);
        $policy = self::loadAdminPolicy($projectRoot);
        $cleanProfiles = [];
        foreach ((array)($raw['profiles'] ?? []) as $p) {
            if (!is_array($p) || empty($p['id'])) continue;
            $cleanProfiles[] = [
                'id'            => (string)$p['id'],
                'label'         => (string)($p['label'] ?? 'LLM'),
                'type'          => (string)($p['type'] ?? 'openai_compat'),
                'base_url'      => (string)($p['base_url'] ?? ''),
                'default_model' => (string)($p['default_model'] ?? ''),
                'models'        => self::sanitizeModelList($p['models'] ?? []),
                'has_api_key'   => !empty($p['api_key'])
            ];
        }

        return [
            'profiles'          => $cleanProfiles,
            'active_profile_id' => (string)($raw['active_profile_id'] ?? ''),
            'active_model'      => (string)($raw['active_model'] ?? ''),
            'autonomy_level'    => in_array($raw['autonomy_level'] ?? '', self::VALID_AUTONOMY_LEVELS, true)
                ? (string)$raw['autonomy_level']
                : 'assisted',
            'system_prompt'     => (string)($raw['system_prompt'] ?? ''),
            'max_tool_steps'    => max(1, min((int)$policy['max_tool_steps'], (int)($raw['max_tool_steps'] ?? 8))),
            'vision_enabled'    => !array_key_exists('vision_enabled', $raw) || !empty($raw['vision_enabled']),
            'disabled_apps'     => self::sanitizeAppIdList($raw['disabled_apps'] ?? [])
        ];
    }

    /**
     * Persists a user's AI profiles & preferences encrypted at rest.
     * Existing API keys are preserved unless a new non-empty `api_key` or `clear_api_key: true` is sent.
     */
    public static function saveUserConfig(string $projectRoot, array $input, ?string $scope = null): array {
        $resolvedScope = $scope ?? self::getCurrentActorScope();
        if ($resolvedScope === null || $resolvedScope === '') {
            return ['success' => false, 'status' => 403, 'error' => 'Authentication required.'];
        }

        $policy = self::loadAdminPolicy($projectRoot);
        $existing = self::loadUserConfigRaw($projectRoot, $resolvedScope);
        $existingById = [];
        foreach ((array)($existing['profiles'] ?? []) as $ep) {
            if (is_array($ep) && !empty($ep['id'])) {
                $existingById[(string)$ep['id']] = $ep;
            }
        }

        $nextProfiles = $existing['profiles'] ?? [];
        if (array_key_exists('profiles', $input) && is_array($input['profiles'])) {
            $nextProfiles = [];
            foreach (array_slice($input['profiles'], 0, self::MAX_PROFILES_PER_USER) as $p) {
                if (!is_array($p)) continue;
                $pid = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($p['id'] ?? ''));
                if ($pid === '') {
                    $pid = 'p_' . bin2hex(random_bytes(4));
                }
                $prev = $existingById[$pid] ?? [];
                $type = in_array($p['type'] ?? '', self::VALID_PROVIDER_TYPES, true)
                    ? (string)$p['type']
                    : (string)($prev['type'] ?? 'openai_compat');
                $label = mb_substr(trim((string)($p['label'] ?? ($prev['label'] ?? 'LLM Profile'))) ?: 'LLM Profile', 0, 80);
                $baseUrl = self::sanitizeBaseUrl((string)($p['base_url'] ?? ($prev['base_url'] ?? '')));
                $defaultModel = self::sanitizeModelName((string)($p['default_model'] ?? ($prev['default_model'] ?? '')));
                $models = array_key_exists('models', $p)
                    ? self::sanitizeModelList($p['models'])
                    : self::sanitizeModelList($prev['models'] ?? []);
                if ($defaultModel !== '' && !in_array($defaultModel, $models, true)) {
                    array_unshift($models, $defaultModel);
                }

                $apiKey = (string)($prev['api_key'] ?? '');
                if (!empty($p['clear_api_key'])) {
                    $apiKey = '';
                } elseif (isset($p['api_key']) && trim((string)$p['api_key']) !== '') {
                    $apiKey = trim((string)$p['api_key']);
                }

                $nextProfiles[] = [
                    'id'            => $pid,
                    'label'         => $label,
                    'type'          => $type,
                    'base_url'      => $baseUrl,
                    'default_model' => $defaultModel,
                    'models'        => array_slice($models, 0, 100),
                    'api_key'       => $apiKey
                ];
            }
        }

        $autonomy = in_array($input['autonomy_level'] ?? '', self::VALID_AUTONOMY_LEVELS, true)
            ? (string)$input['autonomy_level']
            : (string)($existing['autonomy_level'] ?? 'assisted');

        $systemPrompt = array_key_exists('system_prompt', $input)
            ? mb_substr(trim((string)$input['system_prompt']), 0, 4000)
            : (string)($existing['system_prompt'] ?? '');

        $maxSteps = array_key_exists('max_tool_steps', $input)
            ? max(1, min((int)$policy['max_tool_steps'], (int)$input['max_tool_steps']))
            : max(1, min((int)$policy['max_tool_steps'], (int)($existing['max_tool_steps'] ?? 8)));

        $vision = array_key_exists('vision_enabled', $input)
            ? (bool)$input['vision_enabled']
            : (!array_key_exists('vision_enabled', $existing) || !empty($existing['vision_enabled']));

        $disabledApps = array_key_exists('disabled_apps', $input)
            ? self::sanitizeAppIdList($input['disabled_apps'])
            : self::sanitizeAppIdList($existing['disabled_apps'] ?? []);

        $activeProfileId = array_key_exists('active_profile_id', $input)
            ? preg_replace('/[^a-zA-Z0-9_-]/', '', (string)$input['active_profile_id'])
            : (string)($existing['active_profile_id'] ?? '');

        $activeModel = array_key_exists('active_model', $input)
            ? self::sanitizeModelName((string)$input['active_model'])
            : (string)($existing['active_model'] ?? '');

        $payload = [
            'profiles'          => $nextProfiles,
            'active_profile_id' => $activeProfileId,
            'active_model'      => $activeModel,
            'autonomy_level'    => $autonomy,
            'system_prompt'     => $systemPrompt,
            'max_tool_steps'    => $maxSteps,
            'vision_enabled'    => $vision,
            'disabled_apps'     => $disabledApps,
            'updated_at'        => time()
        ];

        $encrypted = CredentialVault::encryptJson($projectRoot, $payload);
        if ($encrypted === '') {
            return ['success' => false, 'status' => 500, 'error' => 'Failed to encrypt AI configuration.'];
        }

        $path = self::getScopeFilePath($projectRoot, $resolvedScope);
        $wrapped = json_encode(['version' => 1, 'updated_at' => time(), 'enc' => $encrypted], JSON_PRETTY_PRINT);
        if (@file_put_contents($path, $wrapped, LOCK_EX) === false) {
            return ['success' => false, 'status' => 500, 'error' => 'Failed to save encrypted AI configuration.'];
        }
        @chmod($path, 0600);

        AuditLogger::log($projectRoot, 'ai_user_config_saved', $resolvedScope, 'ok', [
            'profiles_count' => count($nextProfiles),
            'autonomy_level' => $autonomy
        ]);

        return [
            'success' => true,
            'status'  => 200,
            'config'  => self::getUserConfigForUi($projectRoot, $resolvedScope)
        ];
    }

    /**
     * Resolves an effective decrypted profile ready for server-side LlmGateway execution.
     */
    public static function resolveProfileForExecution(
        string $projectRoot,
        string $requestedProfileId = '',
        string $requestedModel = '',
        ?string $scope = null
    ): ?array {
        $policy = self::loadAdminPolicy($projectRoot);
        $userCfg = self::loadUserConfigRaw($projectRoot, $scope);
        $targetId = $requestedProfileId !== '' ? $requestedProfileId : (string)($userCfg['active_profile_id'] ?? '');

        // Shared instance provider (configured by admin)
        if (($targetId === '__shared__' || ($targetId === '' && empty($userCfg['profiles']))) && !empty($policy['shared_provider_enabled'])) {
            $sp = $policy['shared_provider'];
            $dec = $sp['api_key_enc'] !== '' ? CredentialVault::decryptJson($projectRoot, (string)$sp['api_key_enc']) : [];
            $model = $requestedModel !== '' ? self::sanitizeModelName($requestedModel) : $sp['default_model'];
            return [
                'id'        => '__shared__',
                'label'     => $sp['label'],
                'type'      => $sp['type'],
                'base_url'  => $sp['base_url'],
                'api_key'   => (string)($dec['api_key'] ?? ''),
                'model'     => $model,
                'is_shared' => true
            ];
        }

        $profiles = (array)($userCfg['profiles'] ?? []);
        $matched = null;
        foreach ($profiles as $p) {
            if (is_array($p) && (string)($p['id'] ?? '') === $targetId) {
                $matched = $p;
                break;
            }
        }
        if ($matched === null && !empty($profiles)) {
            $matched = $profiles[0];
        }
        if (!is_array($matched)) {
            return null;
        }

        $model = $requestedModel !== ''
            ? self::sanitizeModelName($requestedModel)
            : ((string)($userCfg['active_model'] ?? '') ?: (string)($matched['default_model'] ?? ''));

        return [
            'id'        => (string)$matched['id'],
            'label'     => (string)($matched['label'] ?? 'LLM'),
            'type'      => (string)($matched['type'] ?? 'openai_compat'),
            'base_url'  => (string)($matched['base_url'] ?? ''),
            'api_key'   => (string)($matched['api_key'] ?? ''),
            'model'     => $model,
            'is_shared' => false
        ];
    }

    public static function sanitizeBaseUrl(string $raw): string {
        $u = trim($raw);
        if ($u === '' || preg_match('/[\x00-\x1f\x7f]/', $u)) {
            return '';
        }
        if (!preg_match('#^https?://#i', $u)) {
            return '';
        }
        return rtrim($u, '/');
    }

    public static function sanitizeModelName(string $raw): string {
        $m = trim($raw);
        if ($m === '') return '';
        $m = preg_replace('/[^a-zA-Z0-9._:\/-]/', '', $m);
        return mb_substr((string)$m, 0, 128);
    }

    public static function sanitizeModelList($raw): array {
        if (is_string($raw)) {
            $raw = preg_split('/[\r\n,;]+/', $raw) ?: [];
        }
        if (!is_array($raw)) return [];
        $out = [];
        foreach ($raw as $item) {
            $m = self::sanitizeModelName((string)$item);
            if ($m !== '' && !in_array($m, $out, true)) {
                $out[] = $m;
            }
            if (count($out) >= 100) break;
        }
        return $out;
    }

    public static function sanitizeDomainList($raw): array {
        if (is_string($raw)) {
            $raw = preg_split('/[\r\n,;\s]+/', $raw) ?: [];
        }
        if (!is_array($raw)) return [];
        $out = [];
        foreach ($raw as $item) {
            $d = strtolower(trim((string)$item));
            $d = preg_replace('#^https?://#i', '', $d);
            $d = trim(explode('/', (string)$d)[0], '. ');
            if ($d !== '' && preg_match('/^[a-z0-9.-]{2,120}$/', $d) && !in_array($d, $out, true)) {
                $out[] = $d;
            }
        }
        return $out;
    }

    public static function sanitizeAppIdList($raw): array {
        if (!is_array($raw)) return [];
        $out = [];
        foreach ($raw as $id) {
            $clean = preg_replace('/[^a-zA-Z0-9._-]/', '', trim((string)$id));
            if ($clean !== '' && !in_array($clean, $out, true)) {
                $out[] = $clean;
            }
            if (count($out) >= 200) break;
        }
        return $out;
    }
}
