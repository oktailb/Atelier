<?php
/**
 * Atelier by GallusTech - Core Baseline MIME Types and File Association Configuration
 *
 * This file defines only the minimal core gallery baseline.
 * Installed native apps (`apps/<app>/manifest.json`), external/WASM standalone apps
 * (`StandaloneWebAppManifestSynthesizer` + `config/external_apps.json`), and optional
 * `config/formats.json` automatically register additional formats via `FormatRegistry`.
 */

$media_types = [
    'image'     => ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico', 'heic', 'heif', 'tif', 'tiff'],
    'video'     => ['mp4', 'm4v', 'webm', 'ogv', 'mov', 'mkv', 'avi'],
    'audio'     => ['mp3', 'wav', 'ogg', 'opus', 'm4a', 'flac', 'aac'],
    'doc'       => ['pdf', 'txt', 'md', 'markdown', 'rtf', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'odg'],
    'archive'   => ['zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z'],
    'videowall' => ['vwall', 'videowall']
];

// App mappings by category
$app_category_associations = [
    'image'     => 'image-viewer',
    'video'     => 'video-player',
    'audio'     => 'audio-player',
    'doc'       => 'doc-viewer',
    'archive'   => 'archive-manager',
    'videowall' => 'video-player'
];
