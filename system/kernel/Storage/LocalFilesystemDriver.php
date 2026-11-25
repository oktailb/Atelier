<?php
/**
 * Atelier by GallusTech - Sandboxed Local Filesystem Storage Driver (Phase B)
 */

namespace SimpleGallery\Kernel\Storage;

class LocalFilesystemDriver implements StorageDriverInterface {

    /** @var string */
    private $rootDir;

    public function __construct(string $rootDir) {
        $real = realpath($rootDir);
        $this->rootDir = rtrim(str_replace('\\', '/', $real !== false ? $real : $rootDir), '/');
    }

    public function getDriverName(): string {
        return 'local';
    }

    private function normalizeRel(string $relPath): string {
        $clean = trim(str_replace('\\', '/', $relPath), '/');
        if ($clean === '' || $clean === '.') return '';
        $parts = array_filter(explode('/', $clean), function ($p) {
            return $p !== '' && $p !== '.';
        });
        foreach ($parts as $p) {
            if ($p === '..' || strpos($p, "\0") !== false) {
                throw new \InvalidArgumentException('Path traversal blocked.');
            }
        }
        return implode('/', $parts);
    }

    private function resolveAbs(string $relPath): string {
        $rel = $this->normalizeRel($relPath);
        return $rel === '' ? $this->rootDir : ($this->rootDir . '/' . $rel);
    }

    public function listDir(string $relPath = ''): array {
        $rel = $this->normalizeRel($relPath);
        $abs = $this->resolveAbs($rel);
        if (!is_dir($abs)) {
            return ['directories' => [], 'files' => []];
        }

        $dirs = [];
        $files = [];
        $entries = @scandir($abs) ?: [];
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..' || $entry[0] === '.') {
                continue;
            }
            $childAbs = $abs . '/' . $entry;
            $childRel = $rel === '' ? $entry : ($rel . '/' . $entry);
            $mtime = (int)@filemtime($childAbs);
            if (is_dir($childAbs)) {
                $dirs[] = [
                    'name'  => $entry,
                    'path'  => $childRel,
                    'mtime' => $mtime
                ];
            } elseif (is_file($childAbs)) {
                $files[] = [
                    'name'  => $entry,
                    'path'  => $childRel,
                    'size'  => (int)@filesize($childAbs),
                    'mtime' => $mtime,
                    'mime'  => ''
                ];
            }
        }

        return ['directories' => $dirs, 'files' => $files];
    }

    public function stat(string $relPath): ?array {
        try {
            $rel = $this->normalizeRel($relPath);
            $abs = $this->resolveAbs($rel);
        } catch (\Throwable $e) {
            return null;
        }
        if (!file_exists($abs)) {
            return null;
        }
        $isDir = is_dir($abs);
        return [
            'type'  => $isDir ? 'dir' : 'file',
            'name'  => $rel === '' ? basename($this->rootDir) : basename($abs),
            'path'  => $rel,
            'size'  => $isDir ? 0 : (int)@filesize($abs),
            'mtime' => (int)@filemtime($abs),
            'mime'  => ''
        ];
    }

    public function readContent(string $relPath): ?string {
        try {
            $abs = $this->resolveAbs($relPath);
        } catch (\Throwable $e) {
            return null;
        }
        if (!is_file($abs) || !is_readable($abs)) {
            return null;
        }
        $data = @file_get_contents($abs);
        return $data === false ? null : $data;
    }

    public function putContent(string $relPath, string $content, string $mime = 'application/octet-stream'): bool {
        try {
            $abs = $this->resolveAbs($relPath);
        } catch (\Throwable $e) {
            return false;
        }
        $parent = dirname($abs);
        if (!is_dir($parent)) {
            @mkdir($parent, 0755, true);
        }
        return @file_put_contents($abs, $content, LOCK_EX) !== false;
    }

    public function putFile(string $relPath, string $localTmpPath, string $mime = 'application/octet-stream'): bool {
        if (!is_file($localTmpPath)) {
            return false;
        }
        try {
            $abs = $this->resolveAbs($relPath);
        } catch (\Throwable $e) {
            return false;
        }
        $parent = dirname($abs);
        if (!is_dir($parent)) {
            @mkdir($parent, 0755, true);
        }
        return @copy($localTmpPath, $abs);
    }

    private function rrmdir(string $dir): bool {
        $items = @scandir($dir) ?: [];
        foreach ($items as $it) {
            if ($it === '.' || $it === '..') continue;
            $p = $dir . '/' . $it;
            if (is_dir($p) && !is_link($p)) {
                $this->rrmdir($p);
            } else {
                @unlink($p);
            }
        }
        return @rmdir($dir);
    }

    public function delete(string $relPath): bool {
        try {
            $rel = $this->normalizeRel($relPath);
            if ($rel === '') return false;
            $abs = $this->resolveAbs($rel);
        } catch (\Throwable $e) {
            return false;
        }
        if (is_dir($abs)) {
            return $this->rrmdir($abs);
        }
        return is_file($abs) ? @unlink($abs) : false;
    }

    public function mkdir(string $relPath): bool {
        try {
            $rel = $this->normalizeRel($relPath);
            if ($rel === '') return false;
            $abs = $this->resolveAbs($rel);
        } catch (\Throwable $e) {
            return false;
        }
        return is_dir($abs) || @mkdir($abs, 0755, true);
    }

    public function move(string $srcRel, string $dstRel): bool {
        try {
            $srcAbs = $this->resolveAbs($srcRel);
            $dstAbs = $this->resolveAbs($dstRel);
        } catch (\Throwable $e) {
            return false;
        }
        if (!file_exists($srcAbs)) return false;
        $dstParent = dirname($dstAbs);
        if (!is_dir($dstParent)) @mkdir($dstParent, 0755, true);
        return @rename($srcAbs, $dstAbs);
    }

    public function testConnection(): array {
        if (is_dir($this->rootDir) && is_readable($this->rootDir)) {
            return ['success' => true, 'message' => 'Local directory accessible.'];
        }
        return ['success' => false, 'message' => 'Local directory not found or unreadable.'];
    }
}
