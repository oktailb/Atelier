<?php
namespace SimpleGallery\Apps\Tribune\Backend;

use SimpleGallery\Kernel\Auth\AuthManager;
use SimpleGallery\Kernel\Security\RateLimiter;

/**
 * Tribune Scheduled Posts Controller
 * Manages scheduling, ownership-scoped listing/cancellation, cookie sanitization, and due post dispatch.
 */
class TribuneSchedulerController {

    public static function getCurrentOwnerSessionHash(): string {
        AuthManager::ensureSessionStarted();
        $sid = session_id();
        if ($sid === '') {
            $sid = 'cli_session';
        }
        return hash('sha256', $sid);
    }

    public static function sanitizeItemForOutput(array $item): array {
        unset($item['cookie'], $item['owner_session_hash']);
        return $item;
    }

    public static function processScheduledPosts(string $base_dir): void {
        $storage_dir = TribuneActions::resolveStorageDir($base_dir);
        $sched_file = $storage_dir . '/tribune_scheduled_posts.json';
        if (!file_exists($sched_file)) return;

        $fp = @fopen($sched_file, 'c+');
        if (!$fp) return;

        if (@flock($fp, LOCK_EX)) {
            $content = '';
            while (!feof($fp)) {
                $content .= fread($fp, 8192);
            }
            $scheduled = @json_decode($content, true) ?: [];
            if (empty($scheduled)) {
                @flock($fp, LOCK_UN);
                @fclose($fp);
                return;
            }

            $now = time();
            $remaining = [];
            $due_posts = [];

            foreach ($scheduled as $item) {
                if (!empty($item['scheduled_at']) && $now >= (int)$item['scheduled_at']) {
                    $due_posts[] = $item;
                } else {
                    $remaining[] = $item;
                }
            }

            if (!empty($due_posts)) {
                ftruncate($fp, 0);
                rewind($fp);
                fwrite($fp, json_encode(array_values($remaining), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
                fflush($fp);
                @flock($fp, LOCK_UN);
                @fclose($fp);

                foreach ($due_posts as $post) {
                    $board = $post['board'] ?? 'local';
                    if ($board === 'local') {
                        $storage_file = $storage_dir . '/tribune_messages.json';
                        $messages = [];
                        if (file_exists($storage_file)) {
                            $messages = @json_decode(@file_get_contents($storage_file), true) ?: [];
                        }

                        $max_id = 0;
                        foreach ($messages as $m) {
                            if (isset($m['id']) && $m['id'] > $max_id) $max_id = (int)$m['id'];
                        }

                        $post_time = $post['scheduled_at'] ?? time();
                        $new_post = [
                            'id'        => $max_id + 1,
                            'time'      => date('YmdHis', $post_time),
                            'clock'     => date('H:i:s', $post_time),
                            'login'     => htmlspecialchars($post['login'] ?? 'Anonyme', ENT_QUOTES, 'UTF-8'),
                            'info'      => htmlspecialchars($post['info'] ?? 'Atelier Scheduled', ENT_QUOTES, 'UTF-8'),
                            'message'   => htmlspecialchars($post['message'] ?? '', ENT_QUOTES, 'UTF-8'),
                            'is_admin'  => !empty($post['is_admin']),
                            'board'     => 'local'
                        ];

                        $messages[] = $new_post;
                        if (count($messages) > 300) {
                            $messages = array_slice($messages, -300);
                        }
                        @file_put_contents($storage_file, json_encode($messages, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
                        @touch($storage_file);
                    } else {
                        if (!empty($post['target_url'])) {
                            $headers = [
                                "User-Agent: " . ($post['user_agent'] ?? 'SimpleGallery-Scheduled/1.0'),
                                "Content-Type: application/x-www-form-urlencoded"
                            ];
                            if (!empty($post['cookie'])) {
                                $headers[] = "Cookie: " . $post['cookie'];
                            }

                            $post_fields = [];
                            $field_name = $post['post_field'] ?? 'message';
                            $post_fields[$field_name] = $post['message'];

                            TribuneProxyController::httpRequestProxy($post['target_url'], 'POST', $headers, http_build_query($post_fields), 6);
                        }
                    }
                }
            } else {
                @flock($fp, LOCK_UN);
                @fclose($fp);
            }
        } else {
            @fclose($fp);
        }
    }

    public static function handleSchedulePost(array $raw_body, string $base_dir, string $storage_dir): array {
        global $rate_limits;
        $sched_max = (int)($rate_limits['tribune_schedule']['max_attempts'] ?? 20);
        $sched_decay = (int)($rate_limits['tribune_schedule']['decay_seconds'] ?? 60);
        $sched_rl_key = 'tribune_schedule_' . RateLimiter::getClientIp();
        if (!RateLimiter::check($sched_rl_key, $sched_max, $sched_decay)) {
            return ['status' => 429, 'data' => ['success' => false, 'error' => 'Trop de programmations récentes. Veuillez patienter.']];
        }
        RateLimiter::increment($sched_rl_key);

        $msg_text    = trim($_POST['message'] ?? $raw_body['message'] ?? '');
        $login       = trim($_POST['login'] ?? $raw_body['login'] ?? 'Anonyme');
        $info        = trim($_POST['info'] ?? $raw_body['info'] ?? 'Atelier Client');
        $board       = trim($_POST['board'] ?? $raw_body['board'] ?? 'local');
        $sched_ts    = (int)($_POST['scheduled_at'] ?? $raw_body['scheduled_at'] ?? 0);
        $target_url  = trim($_POST['target_url'] ?? $raw_body['target_url'] ?? '');
        $post_field  = trim($_POST['post_field'] ?? $raw_body['post_field'] ?? 'message');
        $cookie_hdr  = trim($_POST['cookie'] ?? $raw_body['cookie'] ?? '');
        $user_agent  = trim($_POST['user_agent'] ?? $raw_body['user_agent'] ?? 'SimpleGallery Client');

        if (empty($msg_text)) {
            return ['status' => 400, 'data' => ['success' => false, 'error' => 'Le message ne peut pas être vide.']];
        }

        if ($sched_ts <= (time() - 30)) {
            return ['status' => 400, 'data' => ['success' => false, 'error' => 'L\'heure programmée doit être située dans le futur.']];
        }

        if ($board !== 'local' && $target_url !== '') {
            $is_admin = AuthManager::isAdminLoggedIn();
            if (!TribuneActions::isSafePublicUrl($target_url) || (!$is_admin && !TribuneProxyController::isAllowedBoardRemoteUrl($target_url, $base_dir))) {
                return ['status' => 403, 'data' => ['success' => false, 'error' => 'URL cible distante non autorisée pour l\'envoi programmé.']];
            }
        }

        $sched_file = $storage_dir . '/tribune_scheduled_posts.json';
        $scheduled = [];
        if (file_exists($sched_file)) {
            $scheduled = @json_decode(@file_get_contents($sched_file), true) ?: [];
        }

        $id = bin2hex(random_bytes(10));
        $owner_hash = self::getCurrentOwnerSessionHash();
        $scheduled_item = [
            'id'                 => $id,
            'message'            => $msg_text,
            'login'              => $login,
            'info'               => $info,
            'board'              => $board,
            'scheduled_at'       => $sched_ts,
            'target_url'         => $target_url,
            'post_field'         => $post_field,
            'cookie'             => $cookie_hdr,
            'user_agent'         => $user_agent,
            'is_admin'           => AuthManager::isAdminLoggedIn(),
            'owner_session_hash' => $owner_hash,
            'created_at'         => time()
        ];

        $scheduled[] = $scheduled_item;
        @file_put_contents($sched_file, json_encode(array_values($scheduled), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);

        return ['status' => 200, 'data' => [
            'success'   => true,
            'message'   => 'Message programmé avec succès.',
            'item'      => self::sanitizeItemForOutput($scheduled_item),
            'count'     => count($scheduled)
        ]];
    }

    public static function handleScheduledList(string $base_dir, string $storage_dir): array {
        self::processScheduledPosts($base_dir);
        $sched_file = $storage_dir . '/tribune_scheduled_posts.json';
        $scheduled = [];
        if (file_exists($sched_file)) {
            $scheduled = @json_decode(@file_get_contents($sched_file), true) ?: [];
        }

        $is_admin = AuthManager::isAdminLoggedIn();
        $owner_hash = self::getCurrentOwnerSessionHash();
        $visible = [];
        foreach ($scheduled as $item) {
            if (!is_array($item)) continue;
            $item_owner = (string)($item['owner_session_hash'] ?? '');
            if ($is_admin || ($item_owner !== '' && hash_equals($item_owner, $owner_hash))) {
                $visible[] = self::sanitizeItemForOutput($item);
            }
        }

        return ['status' => 200, 'data' => [
            'success'   => true,
            'scheduled' => $visible,
            'count'     => count($visible),
            'server_ts' => time()
        ]];
    }

    public static function handleScheduleCancel(array $raw_body, string $storage_dir): array {
        $id = trim($_POST['id'] ?? $raw_body['id'] ?? '');
        if (empty($id)) {
            return ['status' => 400, 'data' => ['success' => false, 'error' => 'ID de message programmé manquant.']];
        }

        $sched_file = $storage_dir . '/tribune_scheduled_posts.json';
        $scheduled = [];
        if (file_exists($sched_file)) {
            $scheduled = @json_decode(@file_get_contents($sched_file), true) ?: [];
        }

        $is_admin = AuthManager::isAdminLoggedIn();
        $owner_hash = self::getCurrentOwnerSessionHash();
        $found = false;
        $authorized = false;
        $filtered = [];

        foreach ($scheduled as $item) {
            if (($item['id'] ?? '') === $id) {
                $found = true;
                $item_owner = (string)($item['owner_session_hash'] ?? '');
                if ($is_admin || ($item_owner !== '' && hash_equals($item_owner, $owner_hash))) {
                    $authorized = true;
                    continue;
                }
            }
            $filtered[] = $item;
        }

        if ($found && !$authorized) {
            return ['status' => 403, 'data' => ['success' => false, 'error' => 'Accès refusé : vous ne pouvez annuler que vos propres messages programmés.']];
        }

        @file_put_contents($sched_file, json_encode(array_values($filtered), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);

        return ['status' => 200, 'data' => [
            'success' => true,
            'message' => 'Programmation annulée avec succès.',
            'count'   => count($filtered)
        ]];
    }
}
