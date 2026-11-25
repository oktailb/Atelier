<?php
/**
 * Atelier by GallusTech - Encrypted Credential Vault (AES-256-GCM)
 * Protects external storage credentials, S3 secrets, WebDAV passwords, and OAuth2 refresh tokens at rest.
 */

namespace SimpleGallery\Kernel\Storage;

use SimpleGallery\Kernel\Config\ConfigStore;

class CredentialVault {

    private static function getMasterKey(string $projectRoot): string {
        $storageDir = rtrim(str_replace('\\', '/', ConfigStore::getStorageDir($projectRoot)), '/');
        if (!is_dir($storageDir)) {
            @mkdir($storageDir, 0755, true);
        }
        $keyFile = $storageDir . '/.vault_master.key';
        if (is_file($keyFile)) {
            $raw = trim((string)@file_get_contents($keyFile));
            $bin = @hex2bin($raw);
            if ($bin !== false && strlen($bin) === 32) {
                return $bin;
            }
        }
        $newBin = random_bytes(32);
        @file_put_contents($keyFile, bin2hex($newBin) . "\n", LOCK_EX);
        @chmod($keyFile, 0600);
        return $newBin;
    }

    public static function encryptJson(string $projectRoot, array $payload): string {
        $plaintext = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($plaintext === false) {
            return '';
        }
        $key = self::getMasterKey($projectRoot);

        if (function_exists('openssl_encrypt') && in_array('aes-256-gcm', openssl_get_cipher_methods(), true)) {
            $iv = random_bytes(12);
            $tag = '';
            $ciphertext = openssl_encrypt($plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, 'atelier-vault-v1');
            if ($ciphertext !== false && strlen($tag) === 16) {
                return 'v1:gcm:' . base64_encode($iv . $tag . $ciphertext);
            }
        }

        // Pure-PHP authenticated fallback if OpenSSL GCM is unavailable
        $iv = random_bytes(16);
        $stream = '';
        $blocks = (int)ceil(strlen($plaintext) / 32);
        for ($i = 0; $i < $blocks; $i++) {
            $stream .= hash_hmac('sha256', $iv . pack('N', $i), $key, true);
        }
        $ciphertext = $plaintext ^ substr($stream, 0, strlen($plaintext));
        $mac = hash_hmac('sha256', 'v1:hmac:' . $iv . $ciphertext, $key, true);
        return 'v1:hmac:' . base64_encode($iv . $mac . $ciphertext);
    }

    public static function decryptJson(string $projectRoot, string $encoded): array {
        if ($encoded === '') {
            return [];
        }
        $key = self::getMasterKey($projectRoot);

        if (strpos($encoded, 'v1:gcm:') === 0 && function_exists('openssl_decrypt')) {
            $raw = base64_decode(substr($encoded, 7), true);
            if ($raw === false || strlen($raw) < 28) {
                return [];
            }
            $iv = substr($raw, 0, 12);
            $tag = substr($raw, 12, 16);
            $ciphertext = substr($raw, 28);
            $plain = openssl_decrypt($ciphertext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, 'atelier-vault-v1');
            if ($plain === false) {
                return [];
            }
            $decoded = @json_decode($plain, true);
            return is_array($decoded) ? $decoded : [];
        }

        if (strpos($encoded, 'v1:hmac:') === 0) {
            $raw = base64_decode(substr($encoded, 8), true);
            if ($raw === false || strlen($raw) < 48) {
                return [];
            }
            $iv = substr($raw, 0, 16);
            $mac = substr($raw, 16, 32);
            $ciphertext = substr($raw, 48);
            $expected = hash_hmac('sha256', 'v1:hmac:' . $iv . $ciphertext, $key, true);
            if (!hash_equals($expected, $mac)) {
                return [];
            }
            $stream = '';
            $blocks = (int)ceil(strlen($ciphertext) / 32);
            for ($i = 0; $i < $blocks; $i++) {
                $stream .= hash_hmac('sha256', $iv . pack('N', $i), $key, true);
            }
            $plain = $ciphertext ^ substr($stream, 0, strlen($ciphertext));
            $decoded = @json_decode($plain, true);
            return is_array($decoded) ? $decoded : [];
        }

        return [];
    }
}
