<?php
namespace SimpleGallery\Kernel\FS;

use SimpleGallery\Kernel\Security\PathValidator;
use SimpleGallery\Kernel\Security\SecurityManager;

/**
 * Kernel Dotfile Manager
 * Manages directory metadata files (.title, .desc, .comment, .bg, .theme, .private, .password)
 */
class DotfileManager {

    /**
     * Evaluates local dotfile access state for a single directory (without walking parents).
     */
    public static function getDirAccessInfo(string $dir_path, string $base_dir): array {
        \SimpleGallery\Kernel\Auth\AuthManager::ensureSessionStarted();
        $rel = PathValidator::getRelativePath($dir_path, $base_dir);

        $has_password = file_exists($dir_path . '/.password');
        $has_public   = file_exists($dir_path . '/.public');
        $has_private  = file_exists($dir_path . '/.private');

        $is_private = false;
        $is_protected = false;

        if ($has_password) {
            $is_protected = true;
        } elseif ($has_public) {
            $is_private = false;
            $is_protected = false;
        } elseif ($has_private) {
            $is_private = true;
        } elseif ($rel !== '' && basename($dir_path) === 'private') {
            $is_private = true;
        }

        $is_admin = SecurityManager::isAdminLoggedIn();
        if ($is_admin) {
            $is_unlocked = true;
        } elseif ($is_private) {
            $is_unlocked = false;
        } elseif ($is_protected) {
            $is_unlocked = (!empty($_SESSION['sg_unlocked_folders'][$rel]) || !empty($_SESSION['unlocked_dirs'][$rel]));
        } else {
            $is_unlocked = true;
        }

        $access_mode = 'public';
        if ($is_private) {
            $access_mode = 'private';
        } elseif ($is_protected) {
            $access_mode = 'password';
        }

        $is_accessible = $is_admin || (!$is_private && (!$is_protected || $is_unlocked));

        return [
            'mode'              => $access_mode,
            'access_mode'       => $access_mode,
            'is_private'        => $is_private,
            'is_protected'      => $is_protected,
            'is_unlocked'       => $is_unlocked,
            'is_accessible'     => $is_accessible,
            'requires_auth'     => ($is_private || $is_protected),
            'rel_path'          => $rel,
            'blocking_rel_path' => $is_accessible ? null : $rel
        ];
    }

    /**
     * Evaluates effective access state for $dir_path by walking every ancestor directory
     * from $base_dir down to $dir_path. A parent .private or locked .password always
     * restricts all descendant subdirectories.
     */
    public static function getEffectiveAccessInfo(string $dir_path, string $base_dir): array {
        $is_admin = SecurityManager::isAdminLoggedIn();
        $rel = PathValidator::getRelativePath($dir_path, $base_dir);
        $real_base = rtrim(str_replace('\\', '/', realpath($base_dir) ?: $base_dir), '/');

        // Build full chain of directories to check: root (if explicit .private/.password) + every ancestor segment
        $chain = [];
        if (file_exists($real_base . '/.private') || file_exists($real_base . '/.password')) {
            $chain[] = $real_base;
        }

        if ($rel !== '') {
            $parts = explode('/', $rel);
            $accumulated = '';
            foreach ($parts as $part) {
                if ($part === '') continue;
                $accumulated = ($accumulated === '') ? $part : $accumulated . '/' . $part;
                $chain[] = $real_base . '/' . $accumulated;
            }
        } elseif (empty($chain)) {
            return self::getDirAccessInfo($real_base, $base_dir);
        }

        $inherited_private = false;
        $inherited_protected = false;
        $blocking_mode = null;
        $blocking_rel = null;

        foreach ($chain as $check_dir) {
            $step = self::getDirAccessInfo($check_dir, $base_dir);
            if ($step['is_private']) {
                $inherited_private = true;
                if (!$is_admin && $blocking_mode === null) {
                    $blocking_mode = 'private';
                    $blocking_rel = $step['rel_path'];
                }
            } elseif ($step['is_protected']) {
                $inherited_protected = true;
                if (!$is_admin && !$step['is_unlocked'] && $blocking_mode === null) {
                    $blocking_mode = 'password';
                    $blocking_rel = $step['rel_path'];
                }
            }
        }

        $leaf = self::getDirAccessInfo($dir_path, $base_dir);

        if ($blocking_mode === 'private') {
            return [
                'mode'              => 'private',
                'access_mode'       => 'private',
                'is_private'        => true,
                'is_protected'      => false,
                'is_unlocked'       => false,
                'is_accessible'     => false,
                'requires_auth'     => true,
                'rel_path'          => $rel,
                'blocking_rel_path' => $blocking_rel
            ];
        }

        if ($blocking_mode === 'password') {
            return [
                'mode'              => 'password',
                'access_mode'       => 'password',
                'is_private'        => false,
                'is_protected'      => true,
                'is_unlocked'       => false,
                'is_accessible'     => false,
                'requires_auth'     => true,
                'rel_path'          => $rel,
                'blocking_rel_path' => $blocking_rel
            ];
        }

        // Accessible (either admin, public, or all ancestor .password folders are unlocked)
        if ($inherited_private && !$leaf['is_private']) {
            $leaf['mode'] = 'private';
            $leaf['access_mode'] = 'private';
            $leaf['is_private'] = true;
            $leaf['requires_auth'] = true;
        } elseif ($inherited_protected && !$leaf['is_private'] && !$leaf['is_protected']) {
            $leaf['mode'] = 'password';
            $leaf['access_mode'] = 'password';
            $leaf['is_protected'] = true;
            $leaf['is_unlocked'] = true;
            $leaf['requires_auth'] = true;
        }

        $leaf['is_accessible'] = true;
        $leaf['blocking_rel_path'] = null;
        return $leaf;
    }

    public static function isDirAccessible(string $dir_path, string $base_dir): bool {
        if (SecurityManager::isAdminLoggedIn()) {
            return true;
        }

        $effective = self::getEffectiveAccessInfo($dir_path, $base_dir);
        return !empty($effective['is_accessible']);
    }

    public static function loadComments(string $dir_path): array {
        $comments = [];
        $comment_file = $dir_path . '/.comment';
        if (file_exists($comment_file) && is_readable($comment_file)) {
            $lines = file($comment_file, FILE_IGNORE_NEW_LINES);
            if ($lines !== false) {
                for ($i = 0; $i < count($lines); $i++) {
                    $line = trim($lines[$i]);
                    if ($line === '') continue;

                    if (strpos($line, '=') !== false) {
                        list($fname, $cmt) = explode('=', $line, 2);
                        $comments[trim($fname)] = trim($cmt);
                    } elseif (strpos($line, ':') !== false && !file_exists($dir_path . '/' . $line)) {
                        list($fname, $cmt) = explode(':', $line, 2);
                        $comments[trim($fname)] = trim($cmt);
                    } else {
                        $fname = $line;
                        $cmt = isset($lines[$i + 1]) ? trim($lines[$i + 1]) : '';
                        $comments[$fname] = $cmt;
                        $i++;
                    }
                }
            }
        }
        return $comments;
    }

    public static function saveComments(string $dir_path, array $comments): bool {
        $comment_file = $dir_path . '/.comment';
        $clean_comments = [];
        foreach ($comments as $fname => $cmt) {
            $cmt_clean = trim(str_replace(["\r", "\n"], [' ', ' '], $cmt));
            if ($cmt_clean !== '') {
                $clean_comments[] = $fname . '=' . $cmt_clean;
            }
        }

        if (empty($clean_comments)) {
            if (file_exists($comment_file)) {
                return @unlink($comment_file);
            }
            return true;
        }

        return (@file_put_contents($comment_file, implode("\n", $clean_comments) . "\n", LOCK_EX) !== false);
    }

    public static function loadDirComments(string $dir_path): array {
        return self::loadComments($dir_path);
    }

    public static function saveDirComments(string $dir_path, array $comments): bool {
        return self::saveComments($dir_path, $comments);
    }

    public static function loadFolderOverrides(string $dir_path, string $base_dir, array $theme_colors = []): array {
        $access_info = self::getDirAccessInfo($dir_path, $base_dir);

        $overrides = [
            'title'        => null,
            'description'  => null,
            'background'   => null,
            'theme'        => null,
            'access_mode'  => $access_info['access_mode'],
            'is_private'   => $access_info['is_private'],
            'is_protected' => $access_info['is_protected'],
            'is_unlocked'  => $access_info['is_unlocked']
        ];

        $title_file = $dir_path . '/.title';
        if (file_exists($title_file) && is_readable($title_file)) {
            $overrides['title'] = trim((string)file_get_contents($title_file));
        }

        $desc_file = file_exists($dir_path . '/.desc') ? $dir_path . '/.desc' : (file_exists($dir_path . '/.description') ? $dir_path . '/.description' : null);
        if ($desc_file && is_readable($desc_file)) {
            $overrides['description'] = trim((string)file_get_contents($desc_file));
        }

        $bg_file = $dir_path . '/.bg';
        if (file_exists($bg_file) && is_readable($bg_file)) {
            $bg_val = trim((string)file_get_contents($bg_file));
            if ($bg_val !== '') {
                $overrides['raw_background'] = $bg_val;
                $possible_image = $dir_path . '/' . $bg_val;
                if (file_exists($possible_image) && is_file($possible_image)) {
                    $rel_bg = PathValidator::getRelativePath($possible_image, $base_dir);
                    $overrides['background'] = 'system/endpoints/thumb.php?file=' . rawurlencode($rel_bg) . '&raw=1';
                } else {
                    $overrides['background'] = $bg_val;
                }
            }
        }

        $theme_file = $dir_path . '/.theme';
        if (file_exists($theme_file) && is_readable($theme_file)) {
            $theme_val = trim((string)file_get_contents($theme_file));
            if ($theme_val !== '') {
                if (strpos($theme_val, '=') !== false) {
                    $custom_theme = [];
                    $lines = explode("\n", $theme_val);
                    foreach ($lines as $line) {
                        if (strpos($line, '=') !== false) {
                            list($k, $v) = explode('=', trim($line), 2);
                            $custom_theme[trim($k)] = trim($v);
                        }
                    }
                    $overrides['theme'] = $custom_theme;
                    $overrides['theme_name'] = 'custom';
                } else {
                    $overrides['theme_name'] = $theme_val;
                    if (!empty($theme_colors[$theme_val])) {
                        $overrides['theme'] = $theme_colors[$theme_val];
                    }
                }
            }
        }

        $autorun_file = null;
        $f_plain = $dir_path . '/autorun.json';
        $f_dot   = $dir_path . '/.autorun.json';
        if (file_exists($f_plain) && file_exists($f_dot)) {
            $autorun_file = (filemtime($f_plain) >= filemtime($f_dot)) ? $f_plain : $f_dot;
        } elseif (file_exists($f_plain)) {
            $autorun_file = $f_plain;
        } elseif (file_exists($f_dot)) {
            $autorun_file = $f_dot;
        }

        if ($autorun_file && is_readable($autorun_file)) {
            $raw_autorun = @file_get_contents($autorun_file);
            $parsed_autorun = @json_decode((string)$raw_autorun, true);
            if (is_array($parsed_autorun)) {
                $overrides['has_autorun'] = true;
                $overrides['autorun'] = $parsed_autorun;
                $overrides['autorun_filename'] = basename($autorun_file);
            }
        }

        return $overrides;
    }

    public static function getFolderOverrides(string $dir_path, string $base_dir, array $theme_colors = []): array {
        return self::loadFolderOverrides($dir_path, $base_dir, $theme_colors);
    }
}



