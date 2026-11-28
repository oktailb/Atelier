<?php
namespace Atelier\Kernel\FS;

use Atelier\Kernel\Auth\AuthManager;
use Atelier\Kernel\Media\BinaryLocator;
use Atelier\Kernel\Security\PathValidator;
use RecursiveIteratorIterator;
use RecursiveDirectoryIterator;
use RecursiveCallbackFilterIterator;
use ZipArchive;

/**
 * Kernel Archive Engine (ZIP, 7Z, TAR)
 */
class ArchiveEngine {

    private const FORBIDDEN_EXTS = [
        'php', 'phtml', 'php3', 'php4', 'php5', 'phps', 'phar', 'inc',
        'htaccess', 'htpasswd', 'ini', 'sh', 'bash', 'bat', 'cmd', 'exe',
        'cgi', 'pl', 'py', 'hash', 'sql', 'bak', 'user.ini'
    ];

    /**
     * Collects all files inside $real_target that are safe and permitted for archiving:
     * - Prunes dotfiles, dot-directories, ignored paths, and any .private / locked .password subtrees
     * - Excludes forbidden executable/system extensions
     * @return array<int, array{full: string, local: string}>
     */
    public static function collectAllowedFiles(string $real_target, string $base_dir, array $ignore_list = []): array {
        $real_target = str_replace('\\', '/', $real_target);
        if (!is_dir($real_target) || !DotfileManager::isDirAccessible($real_target, $base_dir)) {
            return [];
        }

        $dir_iter = new RecursiveDirectoryIterator($real_target, RecursiveDirectoryIterator::SKIP_DOTS);
        $filter_iter = new RecursiveCallbackFilterIterator($dir_iter, function ($current) use ($base_dir, $ignore_list): bool {
            $name = $current->getFilename();
            if ($name === '' || $name[0] === '.' || in_array($name, $ignore_list, true)) {
                return false;
            }
            if ($current->isDir()) {
                return DotfileManager::isDirAccessible($current->getPathname(), $base_dir);
            }
            return true;
        });

        $files = new RecursiveIteratorIterator($filter_iter, RecursiveIteratorIterator::LEAVES_ONLY);
        $allowed = [];

        foreach ($files as $file) {
            if (!$file->isFile()) continue;
            $filePath = str_replace('\\', '/', $file->getRealPath());
            if (!$filePath) continue;

            $filename = basename($filePath);
            if ($filename === '' || $filename[0] === '.') continue;

            $localPath = PathValidator::getRelativePath($filePath, $real_target);
            if ($localPath === '' || $localPath[0] === '-') continue;

            $parts = explode('/', $localPath);
            $has_dot_part = false;
            foreach ($parts as $p) {
                if ($p !== '' && ($p[0] === '.' || in_array($p, $ignore_list, true))) {
                    $has_dot_part = true;
                    break;
                }
            }
            if ($has_dot_part) continue;

            $ext = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));
            if ($ext === '' || in_array($ext, self::FORBIDDEN_EXTS, true)) continue;

            if (!DotfileManager::isDirAccessible(dirname($filePath), $base_dir)) {
                continue;
            }

            $allowed[] = [
                'full'  => $filePath,
                'local' => $localPath
            ];
        }

        return $allowed;
    }

    public static function createArchive(string $format, string $target_dir, string $output_file, string $base_dir, array $ignore_list = []): bool {
        if (!is_dir($target_dir)) return false;

        $real_target = realpath($target_dir);
        if (!$real_target) return false;
        $real_target = str_replace('\\', '/', $real_target);

        if (!DotfileManager::isDirAccessible($real_target, $base_dir)) {
            return false;
        }

        $allowed_files = self::collectAllowedFiles($real_target, $base_dir, $ignore_list);
        if (empty($allowed_files)) {
            return false;
        }

        if ($format === 'zip' && (extension_loaded('zip') || class_exists('ZipArchive'))) {
            $zip = new ZipArchive();
            if ($zip->open($output_file, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
                return false;
            }

            foreach ($allowed_files as $entry) {
                $zip->addFile($entry['full'], $entry['local']);
            }

            return $zip->close();
        }

        // For CLI archive engines (zip CLI, 7z, tar), feed ONLY the explicitly validated file list
        // so .private / locked .password subtrees, dotfiles, and forbidden extensions can never be archived.
        $list_file = $output_file . '.filelist_' . bin2hex(random_bytes(6)) . '.txt';
        $rel_lines = array_map(static fn($entry) => $entry['local'], $allowed_files);
        if (@file_put_contents($list_file, implode("\n", $rel_lines) . "\n", LOCK_EX) === false) {
            return false;
        }

        try {
            if ($format === 'zip') {
                $zip_cli = BinaryLocator::find('zip');
                if ($zip_cli) {
                    $cmd = sprintf(
                        'cd %s && %s %s -@ < %s 2>&1',
                        escapeshellarg($real_target),
                        escapeshellarg($zip_cli),
                        escapeshellarg($output_file),
                        escapeshellarg($list_file)
                    );
                    @exec($cmd);
                    return (file_exists($output_file) && filesize($output_file) > 0);
                }
            }

            if ($format === '7z') {
                $sz_cli = BinaryLocator::find('7z') ?: BinaryLocator::find('7za');
                if ($sz_cli) {
                    $cmd = sprintf(
                        'cd %s && %s a -t7z %s %s 2>&1',
                        escapeshellarg($real_target),
                        escapeshellarg($sz_cli),
                        escapeshellarg($output_file),
                        escapeshellarg('@' . $list_file)
                    );
                    @exec($cmd);
                    return (file_exists($output_file) && filesize($output_file) > 0);
                }
            }

            if ($format === 'tar') {
                $tar_cli = BinaryLocator::find('tar');
                if ($tar_cli) {
                    $cmd = sprintf(
                        'cd %s && %s -czf %s -T %s 2>&1',
                        escapeshellarg($real_target),
                        escapeshellarg($tar_cli),
                        escapeshellarg($output_file),
                        escapeshellarg($list_file)
                    );
                    @exec($cmd);
                    return (file_exists($output_file) && filesize($output_file) > 0);
                }
            }
        } finally {
            if (file_exists($list_file)) {
                @unlink($list_file);
            }
        }

        return false;
    }
}
