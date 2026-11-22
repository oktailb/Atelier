<?php
/**
 * SimpleGallery 2026 - Tribune OAuth Secrets Template
 * Copy this file to `storage/tribune_secrets.php` and fill in your own OAuth credentials.
 * Never commit `storage/tribune_secrets.php` to version control.
 */
if (!defined('SG_EXEC') && !defined('SIMPLE_GALLERY_BOOTED')) {
    http_response_code(403);
    exit('Access Denied');
}

return [
    'linuxfr' => [
        'client_id'     => 'YOUR_LINUXFR_CLIENT_ID',
        'client_secret' => 'YOUR_LINUXFR_CLIENT_SECRET'
    ]
];
