<?php
/**
 * Atelier by GallusTech - Phase E (Lot 1): Zero-Dependency Multi-Provider LLM Gateway
 *
 * Supports:
 *   - OpenAI-compatible APIs (OpenAI, OpenRouter, Mistral, vLLM, LM Studio, Scaleway, custom)
 *   - Ollama (native `/api/tags` discovery + `/v1/chat/completions`)
 *   - Anthropic Messages API (`/v1/messages`, `x-api-key`, `tool_use` / `tool_result`)
 *   - Google Gemini API (`generateContent`, `functionDeclarations`, `functionCall` / `functionResponse`)
 *
 * Security invariants:
 *   - Anti-SSRF via `UrlValidator::resolveAndValidateUrl()` + `CURLOPT_RESOLVE` IP pinning + `CURLOPT_FOLLOWLOCATION = false`
 *   - Explicit admin opt-in (`allow_private_lan`) required for private LAN endpoints (Ollama / LM Studio),
 *     while ALWAYS blocking cloud metadata IPs (`169.254.169.254`, `metadata.google.internal`) and non-HTTP(S) schemes.
 *   - Optional admin domain allowlist (`allowed_domains`).
 */

namespace SimpleGallery\Kernel\AI;

use SimpleGallery\Kernel\Security\UrlValidator;

class LlmGateway {

    private const MAX_RESPONSE_BYTES = 4194304; // 4 MB max LLM JSON response
    private const BLOCKED_METADATA_HOSTS = [
        '169.254.169.254',
        'metadata.google.internal',
        'metadata',
        '100.100.100.200'
    ];

    /**
     * Validates an LLM endpoint URL against SSRF, cloud metadata, and optional admin domain allowlist.
     *
     * @return array|null ['url' => ..., 'host' => ..., 'port' => ..., 'pinned_ip' => ?string] or null if blocked
     */
    public static function validateEndpointUrl(string $url, bool $allowPrivateLan = false, array $allowedDomains = []): ?array {
        $clean = trim($url);
        if ($clean === '' || preg_match('/[\x00-\x1f\x7f]/', $clean) || !preg_match('#^https?://#i', $clean)) {
            return null;
        }
        $parts = parse_url($clean);
        if (!$parts || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
            return null;
        }

        $scheme = strtolower((string)$parts['scheme']);
        $host = strtolower(trim((string)$parts['host'], '[]'));
        $port = isset($parts['port']) ? (int)$parts['port'] : ($scheme === 'https' ? 443 : 80);
        if ($host === '' || $port < 1 || $port > 65535) {
            return null;
        }

        // Always block cloud metadata endpoints regardless of allow_private_lan
        if (in_array($host, self::BLOCKED_METADATA_HOSTS, true)) {
            return null;
        }
        if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            $long = ip2long($host);
            if ($long !== false) {
                $u = (int)sprintf('%u', $long);
                if (($u & 0xFFFF0000) === 0xA9FE0000) { // 169.254.0.0/16 link-local / cloud metadata
                    return null;
                }
            }
        }

        // Optional admin domain allowlist check
        if (!empty($allowedDomains)) {
            $matched = false;
            foreach ($allowedDomains as $dom) {
                $d = strtolower(trim((string)$dom));
                if ($d === '') continue;
                if ($host === $d || (strlen($host) > strlen($d) && substr($host, -(strlen($d) + 1)) === '.' . $d)) {
                    $matched = true;
                    break;
                }
            }
            if (!$matched) {
                return null;
            }
        }

        if (!$allowPrivateLan) {
            $validated = UrlValidator::resolveAndValidateUrl($clean);
            if ($validated === null) {
                return null;
            }
            return [
                'url'       => $clean,
                'host'      => (string)$validated['host'],
                'port'      => (int)$validated['port'],
                'pinned_ip' => !empty($validated['ips'][0]) ? (string)$validated['ips'][0] : null
            ];
        }

        // Private LAN explicitly enabled by admin: still verify DNS doesn't resolve to 169.254.0.0/16 metadata
        if (!filter_var($host, FILTER_VALIDATE_IP)) {
            $ip = @gethostbyname($host);
            if ($ip && $ip !== $host && filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
                $long = ip2long($ip);
                if ($long !== false && (((int)sprintf('%u', $long)) & 0xFFFF0000) === 0xA9FE0000) {
                    return null;
                }
            }
        }

        return [
            'url'       => $clean,
            'host'      => $host,
            'port'      => $port,
            'pinned_ip' => null
        ];
    }

    /**
     * Tests connectivity to a provider and discovers available model IDs.
     */
    public static function testAndDiscoverModels(
        array $profile,
        bool $allowPrivateLan = false,
        array $allowedDomains = [],
        ?callable $transport = null
    ): array {
        $type = strtolower((string)($profile['type'] ?? 'openai_compat'));
        $baseUrl = rtrim((string)($profile['base_url'] ?? ''), '/');
        $apiKey = (string)($profile['api_key'] ?? '');

        if ($baseUrl === '') {
            if ($type === 'anthropic') $baseUrl = 'https://api.anthropic.com';
            elseif ($type === 'gemini') $baseUrl = 'https://generativelanguage.googleapis.com';
            elseif ($type === 'ollama') $baseUrl = 'http://127.0.0.1:11434';
            else $baseUrl = 'https://api.openai.com/v1';
        }

        $headers = ['Accept: application/json'];
        $url = '';
        if ($type === 'ollama') {
            $url = preg_replace('#/v1$#i', '', $baseUrl) . '/api/tags';
            if ($apiKey !== '') {
                $headers[] = 'Authorization: Bearer ' . $apiKey;
            }
        } elseif ($type === 'anthropic') {
            $url = $baseUrl . '/v1/models';
            if ($apiKey !== '') {
                $headers[] = 'x-api-key: ' . $apiKey;
            }
            $headers[] = 'anthropic-version: 2023-06-01';
        } elseif ($type === 'gemini') {
            $url = $baseUrl . '/v1beta/models';
            if ($apiKey !== '') {
                $headers[] = 'x-goog-api-key: ' . $apiKey;
            }
        } else {
            $url = preg_match('#/v\d+$#i', $baseUrl) ? ($baseUrl . '/models') : ($baseUrl . '/v1/models');
            if ($apiKey !== '') {
                $headers[] = 'Authorization: Bearer ' . $apiKey;
            }
        }

        $res = self::sendJsonRequest('GET', $url, $headers, null, $allowPrivateLan, $allowedDomains, 15, $transport);
        if (!$res['success']) {
            return [
                'success' => false,
                'status'  => $res['status'] ?: 502,
                'error'   => $res['error'] ?: ('Provider returned HTTP ' . ($res['status'] ?: 502)),
                'models'  => []
            ];
        }

        $models = self::extractDiscoveredModels($type, $res['json'] ?? []);
        return [
            'success' => true,
            'status'  => 200,
            'models'  => $models,
            'message' => 'Connected (' . count($models) . ' model(s) discovered).'
        ];
    }

    /**
     * Executes a normalized multi-turn LLM chat completion with optional JSON Schema tool definitions.
     */
    public static function chat(
        array $profile,
        array $messages,
        array $tools = [],
        array $options = [],
        bool $allowPrivateLan = false,
        array $allowedDomains = [],
        ?callable $transport = null
    ): array {
        $type = strtolower((string)($profile['type'] ?? 'openai_compat'));
        $baseUrl = rtrim((string)($profile['base_url'] ?? ''), '/');
        $apiKey = (string)($profile['api_key'] ?? '');
        $model = (string)($profile['model'] ?? '');

        if ($model === '') {
            return ['success' => false, 'status' => 400, 'error' => 'A model identifier is required.'];
        }
        if ($baseUrl === '') {
            if ($type === 'anthropic') $baseUrl = 'https://api.anthropic.com';
            elseif ($type === 'gemini') $baseUrl = 'https://generativelanguage.googleapis.com';
            elseif ($type === 'ollama') $baseUrl = 'http://127.0.0.1:11434';
            else $baseUrl = 'https://api.openai.com/v1';
        }

        $built = self::buildProviderRequest($type, $baseUrl, $apiKey, $model, $messages, $tools, $options);
        $res = self::sendJsonRequest(
            'POST',
            $built['url'],
            $built['headers'],
            $built['body'],
            $allowPrivateLan,
            $allowedDomains,
            90,
            $transport
        );

        if (!$res['success']) {
            return [
                'success' => false,
                'status'  => $res['status'] ?: 502,
                'error'   => $res['error'] ?: 'LLM provider request failed.'
            ];
        }

        $parsed = self::parseProviderResponse($type, $res['json'] ?? [], $model);
        if (!$parsed['success']) {
            return [
                'success' => false,
                'status'  => 502,
                'error'   => $parsed['error'] ?? 'Malformed provider response.'
            ];
        }

        return [
            'success' => true,
            'status'  => 200,
            'model'   => $parsed['model'] ?? $model,
            'message' => $parsed['message'],
            'usage'   => $parsed['usage'] ?? null
        ];
    }

    /**
     * Builds provider-specific URL, HTTP headers, and JSON body from normalized messages & tools.
     */
    public static function buildProviderRequest(
        string $type,
        string $baseUrl,
        string $apiKey,
        string $model,
        array $messages,
        array $tools = [],
        array $options = []
    ): array {
        $maxTokens = max(64, min(16384, (int)($options['max_tokens'] ?? 2048)));
        $temperature = isset($options['temperature']) ? max(0.0, min(2.0, (float)$options['temperature'])) : 0.3;

        if ($type === 'anthropic') {
            $sysParts = [];
            $anthMsgs = [];
            foreach ($messages as $m) {
                if (!is_array($m)) continue;
                $role = strtolower((string)($m['role'] ?? 'user'));
                $content = (string)($m['content'] ?? '');
                if ($role === 'system') {
                    if ($content !== '') $sysParts[] = $content;
                    continue;
                }
                if ($role === 'tool') {
                    $block = [
                        'type'        => 'tool_result',
                        'tool_use_id' => (string)($m['tool_call_id'] ?? 'tool_1'),
                        'content'     => $content
                    ];
                    $lastIdx = count($anthMsgs) - 1;
                    if ($lastIdx >= 0 && ($anthMsgs[$lastIdx]['role'] ?? '') === 'user'
                        && is_array($anthMsgs[$lastIdx]['content'] ?? null)
                        && (($anthMsgs[$lastIdx]['content'][0]['type'] ?? '') === 'tool_result')
                    ) {
                        $anthMsgs[$lastIdx]['content'][] = $block;
                    } else {
                        $anthMsgs[] = ['role' => 'user', 'content' => [$block]];
                    }
                    continue;
                }
                if ($role === 'assistant' && !empty($m['tool_calls']) && is_array($m['tool_calls'])) {
                    $blocks = [];
                    if ($content !== '') {
                        $blocks[] = ['type' => 'text', 'text' => $content];
                    }
                    foreach ($m['tool_calls'] as $tc) {
                        $blocks[] = [
                            'type'  => 'tool_use',
                            'id'    => (string)($tc['id'] ?? ('tc_' . bin2hex(random_bytes(4)))),
                            'name'  => (string)($tc['name'] ?? ''),
                            'input' => self::ensureJsonObject($tc['arguments'] ?? null)
                        ];
                    }
                    $anthMsgs[] = ['role' => 'assistant', 'content' => $blocks];
                    continue;
                }
                $blocks = [['type' => 'text', 'text' => $content]];
                if (!empty($m['images']) && is_array($m['images'])) {
                    foreach (array_slice($m['images'], 0, 3) as $img) {
                        if (!is_array($img) || empty($img['data'])) continue;
                        $blocks[] = [
                            'type'   => 'image',
                            'source' => [
                                'type'       => 'base64',
                                'media_type' => (string)($img['mime'] ?? 'image/png'),
                                'data'       => (string)$img['data']
                            ]
                        ];
                    }
                }
                $anthMsgs[] = ['role' => ($role === 'assistant' ? 'assistant' : 'user'), 'content' => $blocks];
            }

            $body = [
                'model'       => $model,
                'max_tokens'  => $maxTokens,
                'temperature' => min(1.0, $temperature),
                'messages'    => $anthMsgs
            ];
            if (!empty($sysParts)) {
                $body['system'] = implode("\n\n", $sysParts);
            }
            if (!empty($tools)) {
                $anthTools = [];
                foreach ($tools as $t) {
                    if (!is_array($t) || empty($t['name'])) continue;
                    $anthTools[] = [
                        'name'         => (string)$t['name'],
                        'description'  => (string)($t['description'] ?? ''),
                        'input_schema' => self::normalizeToolParameters($t['parameters'] ?? null, false)
                    ];
                }
                if (!empty($anthTools)) {
                    $body['tools'] = $anthTools;
                }
            }

            $headers = [
                'Content-Type: application/json',
                'Accept: application/json',
                'anthropic-version: 2023-06-01'
            ];
            if ($apiKey !== '') {
                $headers[] = 'x-api-key: ' . $apiKey;
            }
            return [
                'url'     => $baseUrl . '/v1/messages',
                'headers' => $headers,
                'body'    => $body
            ];
        }

        if ($type === 'gemini') {
            $sysParts = [];
            $contents = [];
            foreach ($messages as $m) {
                if (!is_array($m)) continue;
                $role = strtolower((string)($m['role'] ?? 'user'));
                $content = (string)($m['content'] ?? '');
                if ($role === 'system') {
                    if ($content !== '') $sysParts[] = $content;
                    continue;
                }
                if ($role === 'tool') {
                    $decodedResp = @json_decode($content, true);
                    $fnPart = [
                        'functionResponse' => [
                            'name'     => (string)($m['name'] ?? 'tool'),
                            'response' => self::isAssocArray($decodedResp) ? $decodedResp : ['result' => $content]
                        ]
                    ];
                    $lastIdx = count($contents) - 1;
                    if ($lastIdx >= 0 && ($contents[$lastIdx]['role'] ?? '') === 'user'
                        && isset($contents[$lastIdx]['parts'][0]['functionResponse'])
                    ) {
                        $contents[$lastIdx]['parts'][] = $fnPart;
                    } else {
                        $contents[] = ['role' => 'user', 'parts' => [$fnPart]];
                    }
                    continue;
                }
                if ($role === 'assistant' && !empty($m['tool_calls']) && is_array($m['tool_calls'])) {
                    $parts = [];
                    if ($content !== '') $parts[] = ['text' => $content];
                    foreach ($m['tool_calls'] as $tc) {
                        $fcPart = [
                            'functionCall' => [
                                'name' => (string)($tc['name'] ?? ''),
                                'args' => self::ensureJsonObject($tc['arguments'] ?? null)
                            ]
                        ];
                        if (!empty($tc['thought_signature']) && is_string($tc['thought_signature'])) {
                            $fcPart['thoughtSignature'] = $tc['thought_signature'];
                        }
                        $parts[] = $fcPart;
                    }
                    $contents[] = ['role' => 'model', 'parts' => $parts];
                    continue;
                }
                $parts = [];
                if ($content !== '') $parts[] = ['text' => $content];
                if (!empty($m['images']) && is_array($m['images'])) {
                    foreach (array_slice($m['images'], 0, 3) as $img) {
                        if (!is_array($img) || empty($img['data'])) continue;
                        $parts[] = [
                            'inlineData' => [
                                'mimeType' => (string)($img['mime'] ?? 'image/png'),
                                'data'     => (string)$img['data']
                            ]
                        ];
                    }
                }
                if (empty($parts)) $parts[] = ['text' => ''];
                $contents[] = ['role' => ($role === 'assistant' ? 'model' : 'user'), 'parts' => $parts];
            }

            $body = [
                'contents'         => $contents,
                'generationConfig' => [
                    'temperature'     => $temperature,
                    'maxOutputTokens' => $maxTokens
                ]
            ];
            if (!empty($sysParts)) {
                $body['systemInstruction'] = ['parts' => [['text' => implode("\n\n", $sysParts)]]];
            }
            if (!empty($tools)) {
                $decls = [];
                foreach ($tools as $t) {
                    if (!is_array($t) || empty($t['name'])) continue;
                    $decl = [
                        'name'        => (string)$t['name'],
                        'description' => (string)($t['description'] ?? '')
                    ];
                    $normParams = self::normalizeToolParameters($t['parameters'] ?? null, true);
                    if ($normParams !== null) {
                        $decl['parameters'] = $normParams;
                    }
                    $decls[] = $decl;
                }
                if (!empty($decls)) {
                    $body['tools'] = [['functionDeclarations' => $decls]];
                }
            }

            $headers = ['Content-Type: application/json', 'Accept: application/json'];
            if ($apiKey !== '') {
                $headers[] = 'x-goog-api-key: ' . $apiKey;
            }
            return [
                'url'     => $baseUrl . '/v1beta/models/' . rawurlencode($model) . ':generateContent',
                'headers' => $headers,
                'body'    => $body
            ];
        }

        // OpenAI-compatible & Ollama (`/v1/chat/completions`)
        $oaMsgs = [];
        foreach ($messages as $m) {
            if (!is_array($m)) continue;
            $role = strtolower((string)($m['role'] ?? 'user'));
            $content = (string)($m['content'] ?? '');
            if ($role === 'tool') {
                $oaMsgs[] = [
                    'role'         => 'tool',
                    'tool_call_id' => (string)($m['tool_call_id'] ?? 'call_1'),
                    'content'      => $content
                ];
                continue;
            }
            if ($role === 'assistant' && !empty($m['tool_calls']) && is_array($m['tool_calls'])) {
                $tcs = [];
                foreach ($m['tool_calls'] as $tc) {
                    $tcs[] = [
                        'id'       => (string)($tc['id'] ?? ('call_' . bin2hex(random_bytes(4)))),
                        'type'     => 'function',
                        'function' => [
                            'name'      => (string)($tc['name'] ?? ''),
                            'arguments' => json_encode(self::ensureJsonObject($tc['arguments'] ?? null), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
                        ]
                    ];
                }
                $oaMsgs[] = ['role' => 'assistant', 'content' => ($content !== '' ? $content : null), 'tool_calls' => $tcs];
                continue;
            }
            if (!empty($m['images']) && is_array($m['images'])) {
                $parts = [];
                if ($content !== '') $parts[] = ['type' => 'text', 'text' => $content];
                foreach (array_slice($m['images'], 0, 3) as $img) {
                    if (!is_array($img) || empty($img['data'])) continue;
                    $mime = (string)($img['mime'] ?? 'image/png');
                    $parts[] = [
                        'type'      => 'image_url',
                        'image_url' => ['url' => 'data:' . $mime . ';base64,' . (string)$img['data']]
                    ];
                }
                $oaMsgs[] = ['role' => $role, 'content' => $parts];
            } else {
                $oaMsgs[] = ['role' => $role, 'content' => $content];
            }
        }

        $body = [
            'model'       => $model,
            'messages'    => $oaMsgs,
            'temperature' => $temperature,
            'max_tokens'  => $maxTokens
        ];
        if (!empty($tools)) {
            $oaTools = [];
            foreach ($tools as $t) {
                if (!is_array($t) || empty($t['name'])) continue;
                $oaTools[] = [
                    'type'     => 'function',
                    'function' => [
                        'name'        => (string)$t['name'],
                        'description' => (string)($t['description'] ?? ''),
                        'parameters'  => self::normalizeToolParameters($t['parameters'] ?? null, false)
                    ]
                ];
            }
            if (!empty($oaTools)) {
                $body['tools'] = $oaTools;
            }
        }

        $endpoint = ($type === 'ollama')
            ? (preg_replace('#/v1$#i', '', $baseUrl) . '/v1/chat/completions')
            : (preg_match('#/v\d+$#i', $baseUrl) ? ($baseUrl . '/chat/completions') : ($baseUrl . '/v1/chat/completions'));

        $headers = ['Content-Type: application/json', 'Accept: application/json'];
        if ($apiKey !== '') {
            $headers[] = 'Authorization: Bearer ' . $apiKey;
        }
        return [
            'url'     => $endpoint,
            'headers' => $headers,
            'body'    => $body
        ];
    }

    /**
     * Normalizes provider JSON responses into a uniform assistant message + tool_calls structure.
     */
    public static function parseProviderResponse(string $type, array $json, string $fallbackModel = ''): array {
        if ($type === 'anthropic') {
            $blocks = is_array($json['content'] ?? null) ? $json['content'] : [];
            $textParts = [];
            $toolCalls = [];
            foreach ($blocks as $b) {
                if (!is_array($b)) continue;
                if (($b['type'] ?? '') === 'text') {
                    $textParts[] = (string)($b['text'] ?? '');
                } elseif (($b['type'] ?? '') === 'tool_use') {
                    $toolCalls[] = [
                        'id'        => (string)($b['id'] ?? ('tc_' . bin2hex(random_bytes(4)))),
                        'name'      => (string)($b['name'] ?? ''),
                        'arguments' => is_array($b['input'] ?? null) ? $b['input'] : []
                    ];
                }
            }
            return [
                'success' => true,
                'model'   => (string)($json['model'] ?? $fallbackModel),
                'message' => [
                    'role'       => 'assistant',
                    'content'    => implode("\n", $textParts),
                    'tool_calls' => $toolCalls
                ],
                'usage'   => $json['usage'] ?? null
            ];
        }

        if ($type === 'gemini') {
            $cand = $json['candidates'][0] ?? null;
            if (!is_array($cand)) {
                return ['success' => false, 'error' => 'No candidate returned by Gemini API.'];
            }
            $parts = is_array($cand['content']['parts'] ?? null) ? $cand['content']['parts'] : [];
            $textParts = [];
            $toolCalls = [];
            foreach ($parts as $idx => $p) {
                if (!is_array($p)) continue;
                if (isset($p['text']) && empty($p['thought'])) {
                    $textParts[] = (string)$p['text'];
                } elseif (!empty($p['functionCall']) && is_array($p['functionCall'])) {
                    $call = [
                        'id'        => 'gcall_' . $idx . '_' . bin2hex(random_bytes(3)),
                        'name'      => (string)($p['functionCall']['name'] ?? ''),
                        'arguments' => is_array($p['functionCall']['args'] ?? null) ? $p['functionCall']['args'] : []
                    ];
                    if (!empty($p['thoughtSignature']) && is_string($p['thoughtSignature'])) {
                        $call['thought_signature'] = $p['thoughtSignature'];
                    }
                    $toolCalls[] = $call;
                }
            }
            return [
                'success' => true,
                'model'   => (string)($json['modelVersion'] ?? $fallbackModel),
                'message' => [
                    'role'       => 'assistant',
                    'content'    => implode("\n", $textParts),
                    'tool_calls' => $toolCalls
                ],
                'usage'   => $json['usageMetadata'] ?? null
            ];
        }

        // OpenAI-compatible & Ollama
        $choice = $json['choices'][0] ?? null;
        if (!is_array($choice) || !is_array($choice['message'] ?? null)) {
            return ['success' => false, 'error' => 'Invalid OpenAI-compatible response payload.'];
        }
        $msg = $choice['message'];
        $toolCalls = [];
        foreach ((array)($msg['tool_calls'] ?? []) as $tc) {
            if (!is_array($tc)) continue;
            $fn = is_array($tc['function'] ?? null) ? $tc['function'] : [];
            $rawArgs = $fn['arguments'] ?? [];
            $args = is_array($rawArgs) ? $rawArgs : (@json_decode((string)$rawArgs, true) ?: []);
            $toolCalls[] = [
                'id'        => (string)($tc['id'] ?? ('call_' . bin2hex(random_bytes(4)))),
                'name'      => (string)($fn['name'] ?? ''),
                'arguments' => $args
            ];
        }
        return [
            'success' => true,
            'model'   => (string)($json['model'] ?? $fallbackModel),
            'message' => [
                'role'       => 'assistant',
                'content'    => (string)($msg['content'] ?? ''),
                'tool_calls' => $toolCalls
            ],
            'usage'   => $json['usage'] ?? null
        ];
    }

    private static function isAssocArray($val): bool {
        if (!is_array($val) || empty($val)) return false;
        return array_keys($val) !== range(0, count($val) - 1);
    }

    /**
     * Ensures PHP empty arrays `[]` serialize as JSON objects `{}` instead of JSON lists `[]`.
     */
    private static function ensureJsonObject($val) {
        if ($val instanceof \stdClass) return $val;
        if (self::isAssocArray($val)) return $val;
        return new \stdClass();
    }

    /**
     * Recursively normalizes JSON Schema tool parameter objects so `properties` never encodes as `[]`.
     * For Google Gemini, omits `parameters` on zero-argument functions and strips unsupported schema keys.
     */
    public static function normalizeToolParameters($params, bool $forGemini = false, bool $isRoot = true) {
        if (!is_array($params) || empty($params)) {
            return $forGemini && $isRoot ? null : ['type' => 'object', 'properties' => new \stdClass()];
        }

        $out = [];
        $geminiDrop = ['$schema', 'additionalProperties', 'default', 'title', '$defs', 'definitions', 'examples'];
        foreach ($params as $k => $v) {
            if ($forGemini && in_array((string)$k, $geminiDrop, true)) {
                continue;
            }
            if ($k === 'properties') {
                if (!is_array($v) || empty($v)) {
                    $out['properties'] = new \stdClass();
                } else {
                    $normProps = [];
                    foreach ($v as $propName => $propSchema) {
                        $normProps[(string)$propName] = is_array($propSchema)
                            ? self::normalizeToolParameters($propSchema, $forGemini, false)
                            : $propSchema;
                    }
                    $out['properties'] = empty($normProps) ? new \stdClass() : $normProps;
                }
                continue;
            }
            if ($k === 'items' && is_array($v)) {
                $out['items'] = self::normalizeToolParameters($v, $forGemini, false);
                continue;
            }
            if ($k === 'required' && is_array($v)) {
                $req = array_values(array_filter(array_map('strval', $v), function ($s) { return $s !== ''; }));
                if (!empty($req)) {
                    $out['required'] = $req;
                }
                continue;
            }
            $out[$k] = $v;
        }

        if ($isRoot) {
            if (empty($out['type'])) {
                $out['type'] = 'object';
            }
            if (($out['type'] ?? '') === 'object') {
                $hasProps = isset($out['properties']) && is_array($out['properties']) && !empty($out['properties']);
                if (!$hasProps) {
                    if ($forGemini) {
                        // Gemini v1beta FunctionDeclaration requires omitting `parameters` for zero-arg tools
                        return null;
                    }
                    $out['properties'] = new \stdClass();
                }
            }
        }

        return $out;
    }

    public static function extractDiscoveredModels(string $type, array $json): array {
        $models = [];
        if ($type === 'ollama' && is_array($json['models'] ?? null)) {
            foreach ($json['models'] as $m) {
                $name = AiSettings::sanitizeModelName((string)($m['name'] ?? $m['model'] ?? ''));
                if ($name !== '') $models[] = $name;
            }
        } elseif ($type === 'gemini' && is_array($json['models'] ?? null)) {
            foreach ($json['models'] as $m) {
                $methods = (array)($m['supportedGenerationMethods'] ?? []);
                if (!empty($methods) && !in_array('generateContent', $methods, true)) continue;
                $rawName = preg_replace('#^models/#i', '', (string)($m['name'] ?? ''));
                $name = AiSettings::sanitizeModelName((string)$rawName);
                if ($name !== '') $models[] = $name;
            }
        } elseif (is_array($json['data'] ?? null)) {
            foreach ($json['data'] as $m) {
                $name = AiSettings::sanitizeModelName((string)($m['id'] ?? ''));
                if ($name !== '') $models[] = $name;
            }
        }
        $models = array_values(array_unique($models));
        sort($models);
        return array_slice($models, 0, 100);
    }

    private static function sendJsonRequest(
        string $method,
        string $url,
        array $headers,
        ?array $jsonBody,
        bool $allowPrivateLan,
        array $allowedDomains,
        int $timeout,
        ?callable $transport = null
    ): array {
        $validated = self::validateEndpointUrl($url, $allowPrivateLan, $allowedDomains);
        if ($validated === null) {
            return [
                'success' => false,
                'status'  => 403,
                'error'   => 'LLM endpoint URL blocked by SSRF or allowed-domains security policy.'
            ];
        }

        if (is_callable($transport)) {
            return $transport($method, $validated['url'], $headers, $jsonBody);
        }

        if (!function_exists('curl_init')) {
            return ['success' => false, 'status' => 500, 'error' => 'PHP cURL extension is required for AI Gateway requests.'];
        }

        $respBody = '';
        $sizeExceeded = false;

        $ch = curl_init($validated['url']);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
        curl_setopt($ch, CURLOPT_TIMEOUT, max(5, $timeout));
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
        curl_setopt($ch, CURLOPT_USERAGENT, 'Atelier-WebOS-AI/1.0');
        if (defined('CURLPROTO_HTTP') && defined('CURLPROTO_HTTPS')) {
            curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
        }
        if (!empty($validated['pinned_ip']) && !filter_var($validated['host'], FILTER_VALIDATE_IP) && defined('CURLOPT_RESOLVE')) {
            $rip = (strpos($validated['pinned_ip'], ':') !== false) ? "[{$validated['pinned_ip']}]" : $validated['pinned_ip'];
            curl_setopt($ch, CURLOPT_RESOLVE, ["{$validated['host']}:{$validated['port']}:{$rip}"]);
        }
        if (!empty($headers)) {
            curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        }
        if ($jsonBody !== null) {
            $encoded = json_encode($jsonBody, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $encoded);
        }
        curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($chHandle, string $chunk) use (&$respBody, &$sizeExceeded): int {
            $len = strlen($chunk);
            if (strlen($respBody) + $len > self::MAX_RESPONSE_BYTES) {
                $sizeExceeded = true;
                return 0;
            }
            $respBody .= $chunk;
            return $len;
        });

        $ok = @curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = (string)curl_error($ch);
        curl_close($ch);

        if ($sizeExceeded) {
            return ['success' => false, 'status' => 502, 'error' => 'LLM response exceeded 4 MB safety limit.'];
        }
        if ($ok === false && $status === 0) {
            return ['success' => false, 'status' => 502, 'error' => $curlErr ?: 'Unable to reach LLM provider.'];
        }

        $decoded = @json_decode($respBody, true);
        if ($status < 200 || $status >= 300) {
            $apiErr = '';
            if (is_array($decoded)) {
                $apiErr = (string)($decoded['error']['message'] ?? $decoded['message'] ?? (is_string($decoded['error'] ?? null) ? $decoded['error'] : ''));
            }
            return [
                'success' => false,
                'status'  => $status ?: 502,
                'error'   => $apiErr !== '' ? ("HTTP {$status}: " . mb_substr($apiErr, 0, 300)) : ("LLM provider returned HTTP {$status}.")
            ];
        }

        if (!is_array($decoded)) {
            return ['success' => false, 'status' => 502, 'error' => 'Invalid JSON returned by LLM provider.'];
        }

        return [
            'success' => true,
            'status'  => $status,
            'json'    => $decoded
        ];
    }
}
