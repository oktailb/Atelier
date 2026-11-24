<?php
/**
 * Atelier by GallusTech - Native Zero-Dependency Mail Transport (`Mailer`)
 * Supports:
 *  - `smtp`       : Direct SMTP client with STARTTLS / implicit SSL / AUTH PLAIN & LOGIN
 *  - `php_mail`   : Standard PHP `mail()` transport
 *  - `outbox_log` : Local file outbox (`storage/mail_outbox/`) for local dev, diagnostics & tests
 */

namespace SimpleGallery\Kernel\Mail;

use SimpleGallery\Kernel\Auth\AuditLogger;
use SimpleGallery\Kernel\Auth\AuthSettings;
use SimpleGallery\Kernel\Config\ConfigStore;

class Mailer {

    /**
     * Sends an email using the configured transport for `$projectRoot`.
     */
    public static function send(
        string $projectRoot,
        string $toEmail,
        string $subject,
        string $textBody,
        ?string $htmlBody = null,
        ?array $overrideConfig = null
    ): array {
        $to = trim($toEmail);
        if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return ['success' => false, 'error' => 'Invalid recipient email address.'];
        }

        $cfg = $overrideConfig !== null ? array_merge(AuthSettings::defaults(), $overrideConfig) : AuthSettings::load($projectRoot);
        $driver = strtolower((string)($cfg['mail_driver'] ?? 'outbox_log'));
        $fromEmail = trim((string)($cfg['mail_from_email'] ?? 'noreply@localhost'));
        $fromName = trim(preg_replace('/[\r\n]+/', ' ', (string)($cfg['mail_from_name'] ?? 'Atelier by GallusTech')));
        $cleanSubject = trim(preg_replace('/[\r\n]+/', ' ', $subject));

        if ($driver === 'outbox_log') {
            return self::sendToOutbox($projectRoot, $to, $fromEmail, $fromName, $cleanSubject, $textBody, $htmlBody);
        }

        if ($driver === 'php_mail') {
            return self::sendViaPhpMail($projectRoot, $to, $fromEmail, $fromName, $cleanSubject, $textBody, $htmlBody);
        }

        if ($driver === 'smtp') {
            return self::sendViaSmtp($projectRoot, $cfg, $to, $fromEmail, $fromName, $cleanSubject, $textBody, $htmlBody);
        }

        return ['success' => false, 'error' => "Unsupported mail driver: {$driver}"];
    }

    /**
     * Sends a localized templated email (`verify_email`, `password_reset`, `invite`, `account_approved`, `test`).
     */
    public static function sendTemplate(
        string $projectRoot,
        string $toEmail,
        string $template,
        array $vars = [],
        string $lang = 'fr'
    ): array {
        $lang = in_array(strtolower($lang), ['fr', 'en', 'ja'], true) ? strtolower($lang) : 'fr';
        $brand = (string)($vars['brand'] ?? 'Atelier by GallusTech');
        $link = (string)($vars['link'] ?? '');
        $username = (string)($vars['username'] ?? '');
        $ttl = (string)($vars['ttl'] ?? '');

        $tpl = self::renderTemplate($template, $lang, [
            'brand'    => $brand,
            'link'     => $link,
            'username' => $username,
            'ttl'      => $ttl
        ]);

        return self::send($projectRoot, $toEmail, $tpl['subject'], $tpl['text'], $tpl['html']);
    }

    /**
     * Lists recent messages recorded in `storage/mail_outbox/` (admin diagnostics & tests).
     */
    public static function listOutbox(string $projectRoot, int $limit = 20): array {
        $dir = self::getOutboxDir($projectRoot);
        if (!is_dir($dir)) {
            return [];
        }
        $files = @glob($dir . '/*.json') ?: [];
        rsort($files);
        $files = array_slice($files, 0, max(1, min(100, $limit)));

        $messages = [];
        foreach ($files as $f) {
            $decoded = @json_decode((string)@file_get_contents($f), true);
            if (is_array($decoded)) {
                $messages[] = $decoded;
            }
        }
        return $messages;
    }

    public static function getOutboxDir(string $projectRoot): string {
        $root = ConfigStore::resolveRoot($projectRoot);
        return ConfigStore::getStorageDir($root) . '/mail_outbox';
    }

    private static function sendToOutbox(
        string $projectRoot,
        string $to,
        string $fromEmail,
        string $fromName,
        string $subject,
        string $textBody,
        ?string $htmlBody
    ): array {
        $dir = self::getOutboxDir($projectRoot);
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        if (!file_exists($dir . '/.htaccess')) {
            @file_put_contents($dir . '/.htaccess', "Deny from all\n", LOCK_EX);
        }

        $now = time();
        $id = date('Ymd_His', $now) . '_' . bin2hex(random_bytes(4));
        $entry = [
            'id'         => $id,
            'driver'     => 'outbox_log',
            'to'         => $to,
            'from'       => $fromName !== '' ? "{$fromName} <{$fromEmail}>" : $fromEmail,
            'subject'    => $subject,
            'text'       => $textBody,
            'html'       => $htmlBody,
            'created_at' => $now
        ];
        $path = $dir . '/' . $id . '.json';
        $ok = @file_put_contents($path, json_encode($entry, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX) !== false;
        if (!$ok) {
            return ['success' => false, 'error' => 'Failed to write email to local outbox.'];
        }

        AuditLogger::log($projectRoot, 'mail_sent', $to, 'ok', ['driver' => 'outbox_log', 'subject' => $subject]);
        return ['success' => true, 'driver' => 'outbox_log', 'id' => $id];
    }

    private static function sendViaPhpMail(
        string $projectRoot,
        string $to,
        string $fromEmail,
        string $fromName,
        string $subject,
        string $textBody,
        ?string $htmlBody
    ): array {
        $mime = self::buildMimeMessage($to, $fromEmail, $fromName, $subject, $textBody, $htmlBody);
        $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
        $ok = @mail($to, $encodedSubject, $mime['body'], implode("\r\n", $mime['headers']));
        AuditLogger::log($projectRoot, 'mail_sent', $to, $ok ? 'ok' : 'failed', ['driver' => 'php_mail', 'subject' => $subject]);
        return $ok
            ? ['success' => true, 'driver' => 'php_mail']
            : ['success' => false, 'driver' => 'php_mail', 'error' => 'PHP mail() returned false. Check server MTA configuration.'];
    }

    private static function sendViaSmtp(
        string $projectRoot,
        array $cfg,
        string $to,
        string $fromEmail,
        string $fromName,
        string $subject,
        string $textBody,
        ?string $htmlBody
    ): array {
        $host = trim((string)($cfg['smtp_host'] ?? ''));
        $port = (int)($cfg['smtp_port'] ?? 587);
        $encryption = strtolower((string)($cfg['smtp_encryption'] ?? 'tls'));
        $username = (string)($cfg['smtp_username'] ?? '');
        $password = (string)($cfg['smtp_password'] ?? '');

        if ($host === '') {
            return ['success' => false, 'driver' => 'smtp', 'error' => 'SMTP host is not configured.'];
        }

        $scheme = ($encryption === 'ssl') ? 'ssl://' : 'tcp://';
        $ctx = stream_context_create([
            'ssl' => [
                'verify_peer'      => true,
                'verify_peer_name' => true,
                'allow_self_signed'=> false
            ]
        ]);
        $errno = 0;
        $errstr = '';
        $sock = @stream_socket_client($scheme . $host . ':' . $port, $errno, $errstr, 12, STREAM_CLIENT_CONNECT, $ctx);
        if (!$sock) {
            AuditLogger::log($projectRoot, 'mail_sent', $to, 'failed', ['driver' => 'smtp', 'error' => $errstr]);
            return ['success' => false, 'driver' => 'smtp', 'error' => "SMTP connection failed ({$errno}): {$errstr}"];
        }
        stream_set_timeout($sock, 12);

        try {
            self::smtpExpect($sock, [220]);
            $ehloHost = preg_replace('/[^a-zA-Z0-9.-]/', '', (string)($_SERVER['SERVER_NAME'] ?? 'localhost')) ?: 'localhost';
            self::smtpCmd($sock, "EHLO {$ehloHost}", [250]);

            if ($encryption === 'tls') {
                self::smtpCmd($sock, 'STARTTLS', [220]);
                $cryptoOk = @stream_socket_enable_crypto($sock, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT);
                if (!$cryptoOk) {
                    throw new \RuntimeException('STARTTLS handshake failed.');
                }
                self::smtpCmd($sock, "EHLO {$ehloHost}", [250]);
            }

            if ($username !== '') {
                self::smtpCmd($sock, 'AUTH LOGIN', [334]);
                self::smtpCmd($sock, base64_encode($username), [334]);
                self::smtpCmd($sock, base64_encode($password), [235]);
            }

            self::smtpCmd($sock, "MAIL FROM:<{$fromEmail}>", [250]);
            self::smtpCmd($sock, "RCPT TO:<{$to}>", [250, 251]);
            self::smtpCmd($sock, 'DATA', [354]);

            $mime = self::buildMimeMessage($to, $fromEmail, $fromName, $subject, $textBody, $htmlBody, true);
            $payload = implode("\r\n", $mime['headers']) . "\r\n\r\n" . $mime['body'];
            // Dot-stuff lines starting with '.'
            $payload = preg_replace('/^\./m', '..', $payload);
            fwrite($sock, $payload . "\r\n.\r\n");
            self::smtpExpect($sock, [250]);

            @fwrite($sock, "QUIT\r\n");
            fclose($sock);

            AuditLogger::log($projectRoot, 'mail_sent', $to, 'ok', ['driver' => 'smtp', 'subject' => $subject]);
            return ['success' => true, 'driver' => 'smtp'];
        } catch (\Throwable $e) {
            @fclose($sock);
            AuditLogger::log($projectRoot, 'mail_sent', $to, 'failed', ['driver' => 'smtp', 'error' => $e->getMessage()]);
            return ['success' => false, 'driver' => 'smtp', 'error' => 'SMTP error: ' . $e->getMessage()];
        }
    }

    private static function smtpCmd($sock, string $cmd, array $expectedCodes): string {
        fwrite($sock, $cmd . "\r\n");
        return self::smtpExpect($sock, $expectedCodes);
    }

    private static function smtpExpect($sock, array $expectedCodes): string {
        $resp = '';
        while (($line = fgets($sock, 515)) !== false) {
            $resp .= $line;
            if (strlen($line) >= 4 && $line[3] === ' ') {
                break;
            }
        }
        $code = (int)substr(trim($resp), 0, 3);
        if (!in_array($code, $expectedCodes, true)) {
            throw new \RuntimeException("Unexpected SMTP response ({$code}): " . trim($resp));
        }
        return $resp;
    }

    private static function buildMimeMessage(
        string $to,
        string $fromEmail,
        string $fromName,
        string $subject,
        string $textBody,
        ?string $htmlBody,
        bool $includeRoutingHeaders = false
    ): array {
        $encodedFromName = $fromName !== '' ? ('=?UTF-8?B?' . base64_encode($fromName) . '?=' . " <{$fromEmail}>") : "<{$fromEmail}>";
        $headers = [];
        if ($includeRoutingHeaders) {
            $headers[] = 'Date: ' . date('r');
            $headers[] = "To: <{$to}>";
            $headers[] = 'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=';
            $headers[] = 'Message-ID: <' . bin2hex(random_bytes(12)) . '@atelier.local>';
        }
        $headers[] = "From: {$encodedFromName}";
        $headers[] = 'MIME-Version: 1.0';

        if ($htmlBody !== null && $htmlBody !== '') {
            $boundary = 'atelier_' . bin2hex(random_bytes(10));
            $headers[] = "Content-Type: multipart/alternative; boundary=\"{$boundary}\"";
            $body = "--{$boundary}\r\n"
                . "Content-Type: text/plain; charset=UTF-8\r\n"
                . "Content-Transfer-Encoding: base64\r\n\r\n"
                . chunk_split(base64_encode($textBody)) . "\r\n"
                . "--{$boundary}\r\n"
                . "Content-Type: text/html; charset=UTF-8\r\n"
                . "Content-Transfer-Encoding: base64\r\n\r\n"
                . chunk_split(base64_encode($htmlBody)) . "\r\n"
                . "--{$boundary}--";
        } else {
            $headers[] = 'Content-Type: text/plain; charset=UTF-8';
            $headers[] = 'Content-Transfer-Encoding: base64';
            $body = chunk_split(base64_encode($textBody));
        }

        return ['headers' => $headers, 'body' => $body];
    }

    private static function renderTemplate(string $template, string $lang, array $v): array {
        $brand = htmlspecialchars($v['brand'], ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $user  = htmlspecialchars($v['username'], ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $link  = $v['link'];
        $linkH = htmlspecialchars($link, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $ttl   = htmlspecialchars($v['ttl'], ENT_QUOTES | ENT_HTML5, 'UTF-8');

        $catalog = [
            'verify_email' => [
                'fr' => [
                    'subject' => "[{$v['brand']}] Confirmez votre adresse e-mail",
                    'title'   => "Confirmez votre adresse e-mail",
                    'intro'   => "Bonjour {$v['username']}, merci d'avoir créé votre compte sur {$v['brand']}. Cliquez sur le lien ci-dessous pour vérifier votre adresse e-mail (valable {$v['ttl']}) :",
                    'cta'     => "Vérifier mon adresse e-mail",
                    'footer'  => "Si vous n'êtes pas à l'origine de cette inscription, ignorez simplement cet e-mail."
                ],
                'en' => [
                    'subject' => "[{$v['brand']}] Verify your email address",
                    'title'   => "Verify your email address",
                    'intro'   => "Hello {$v['username']}, thank you for creating an account on {$v['brand']}. Click the link below to verify your email address (valid for {$v['ttl']}):",
                    'cta'     => "Verify my email",
                    'footer'  => "If you did not request this account, you can safely ignore this email."
                ],
                'ja' => [
                    'subject' => "[{$v['brand']}] メールアドレスの確認",
                    'title'   => "メールアドレスの確認",
                    'intro'   => "{$v['username']} 様、{$v['brand']} にご登録いただきありがとうございます。以下のリンクからメールアドレスを確認してください（有効期限：{$v['ttl']}）：",
                    'cta'     => "メールアドレスを確認する",
                    'footer'  => "このメールに心当たりがない場合は、このまま破棄してください。"
                ]
            ],
            'password_reset' => [
                'fr' => [
                    'subject' => "[{$v['brand']}] Réinitialisation de votre mot de passe",
                    'title'   => "Réinitialisation du mot de passe",
                    'intro'   => "Bonjour {$v['username']}, une demande de réinitialisation de mot de passe a été reçue pour votre compte (lien valable {$v['ttl']}) :",
                    'cta'     => "Choisir un nouveau mot de passe",
                    'footer'  => "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message."
                ],
                'en' => [
                    'subject' => "[{$v['brand']}] Password reset request",
                    'title'   => "Reset your password",
                    'intro'   => "Hello {$v['username']}, a password reset was requested for your account (link valid for {$v['ttl']}):",
                    'cta'     => "Set a new password",
                    'footer'  => "If you did not request this reset, you can safely ignore this email."
                ],
                'ja' => [
                    'subject' => "[{$v['brand']}] パスワード再設定のご案内",
                    'title'   => "パスワードの再設定",
                    'intro'   => "{$v['username']} 様、パスワード再設定のリクエストを受け付けました（有効期限：{$v['ttl']}）：",
                    'cta'     => "新しいパスワードを設定",
                    'footer'  => "心当たりがない場合は、このメールを無視してください。"
                ]
            ],
            'invite' => [
                'fr' => [
                    'subject' => "[{$v['brand']}] Vous êtes invité(e) à créer un compte",
                    'title'   => "Invitation personnelle",
                    'intro'   => "Un administrateur vous invite à rejoindre {$v['brand']}. Utilisez ce lien personnel pour créer votre compte (valable {$v['ttl']}) :",
                    'cta'     => "Créer mon compte",
                    'footer'  => "Ce lien d'invitation est à usage unique."
                ],
                'en' => [
                    'subject' => "[{$v['brand']}] You are invited to create an account",
                    'title'   => "Personal invitation",
                    'intro'   => "An administrator has invited you to join {$v['brand']}. Use this personal link to create your account (valid for {$v['ttl']}):",
                    'cta'     => "Create my account",
                    'footer'  => "This invitation link is single-use."
                ],
                'ja' => [
                    'subject' => "[{$v['brand']}] アカウント作成へのご招待",
                    'title'   => "ご招待リンク",
                    'intro'   => "管理者より {$v['brand']} への招待が届いています。以下のリンクからアカウントを作成してください（有効期限：{$v['ttl']}）：",
                    'cta'     => "アカウントを作成する",
                    'footer'  => "この招待リンクは1回限り有効です。"
                ]
            ],
            'account_approved' => [
                'fr' => [
                    'subject' => "[{$v['brand']}] Votre compte a été approuvé",
                    'title'   => "Compte activé",
                    'intro'   => "Bonjour {$v['username']}, votre compte sur {$v['brand']} a été validé par un administrateur. Vous pouvez maintenant vous connecter :",
                    'cta'     => "Accéder à {$v['brand']}",
                    'footer'  => "Votre espace personnel est prêt."
                ],
                'en' => [
                    'subject' => "[{$v['brand']}] Your account has been approved",
                    'title'   => "Account activated",
                    'intro'   => "Hello {$v['username']}, your account on {$v['brand']} has been approved by an administrator. You can now sign in:",
                    'cta'     => "Open {$v['brand']}",
                    'footer'  => "Your personal workspace is ready."
                ],
                'ja' => [
                    'subject' => "[{$v['brand']}] アカウントが承認されました",
                    'title'   => "アカウント有効化完了",
                    'intro'   => "{$v['username']} 様、管理者によりアカウントが承認されました。以下よりログインできます：",
                    'cta'     => "{$v['brand']} を開く",
                    'footer'  => "パーソナルスペースの準備が完了しています。"
                ]
            ],
            'test' => [
                'fr' => [
                    'subject' => "[{$v['brand']}] Test de configuration e-mail",
                    'title'   => "Configuration e-mail opérationnelle",
                    'intro'   => "Cet e-mail confirme que le transport de messagerie de {$v['brand']} fonctionne correctement.",
                    'cta'     => "Ouvrir {$v['brand']}",
                    'footer'  => "Envoyé depuis le panneau d'administration."
                ],
                'en' => [
                    'subject' => "[{$v['brand']}] Email configuration test",
                    'title'   => "Email delivery working",
                    'intro'   => "This email confirms that your {$v['brand']} mail transport is configured properly.",
                    'cta'     => "Open {$v['brand']}",
                    'footer'  => "Sent from the administrator panel."
                ],
                'ja' => [
                    'subject' => "[{$v['brand']}] メール設定テスト",
                    'title'   => "メール送信テスト成功",
                    'intro'   => "このメールは {$v['brand']} のメール送信設定が正常に機能していることを確認するテストです。",
                    'cta'     => "{$v['brand']} を開く",
                    'footer'  => "管理パネルから送信されました。"
                ]
            ]
        ];

        $entry = $catalog[$template][$lang] ?? $catalog['test']['en'];
        $text = $entry['title'] . "\n\n" . $entry['intro'] . ($link !== '' ? "\n\n{$link}\n" : "\n") . "\n" . $entry['footer'];

        $btnHtml = $linkH !== ''
            ? "<p style=\"margin:24px 0;\"><a href=\"{$linkH}\" style=\"display:inline-block;padding:12px 22px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;\">" . htmlspecialchars($entry['cta'], ENT_QUOTES | ENT_HTML5, 'UTF-8') . "</a></p><p style=\"font-size:12px;color:#64748b;word-break:break-all;\">{$linkH}</p>"
            : '';

        $html = "<!DOCTYPE html><html><body style=\"font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;\">"
            . "<div style=\"max-width:540px;margin:0 auto;background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:28px;\">"
            . "<div style=\"font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:#818cf8;margin-bottom:8px;\">{$brand}</div>"
            . "<h2 style=\"margin:0 0 14px;color:#f8fafc;\">" . htmlspecialchars($entry['title'], ENT_QUOTES | ENT_HTML5, 'UTF-8') . "</h2>"
            . "<p style=\"line-height:1.6;color:#cbd5e1;\">" . nl2br(htmlspecialchars($entry['intro'], ENT_QUOTES | ENT_HTML5, 'UTF-8')) . "</p>"
            . $btnHtml
            . "<hr style=\"border:none;border-top:1px solid rgba(255,255,255,0.08);margin:20px 0;\">"
            . "<p style=\"font-size:12px;color:#94a3b8;margin:0;\">" . htmlspecialchars($entry['footer'], ENT_QUOTES | ENT_HTML5, 'UTF-8') . "</p>"
            . "</div></body></html>";

        return [
            'subject' => $entry['subject'],
            'text'    => $text,
            'html'    => $html
        ];
    }
}
