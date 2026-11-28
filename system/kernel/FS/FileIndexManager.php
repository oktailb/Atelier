<?php
/**
 * Atelier by GallusTech - Incremental SQLite/JSON File & Metadata Indexer (Phase B)
 * Replaces repeated heavy recursive `scandir()` calls with an incremental `file_index` table
 * tracking path, category, size, mtime, comments, tags, and GPS coordinates.
 */

namespace Atelier\Kernel\FS;

use Atelier\Kernel\Data\AtelierStore;
use Atelier\Kernel\Media\ExifParser;
use Atelier\Kernel\Security\PathValidator;

class FileIndexManager {

    /**
     * Upserts a single local file into `file_index`.
     */
    public static function upsertFile(
        string $projectRoot,
        string $mediaDir,
        string $absFilePath,
        array $mediaTypes = []
    ): bool {
        if (!is_file($absFilePath)) return false;
        $rel = PathValidator::getRelativePath($absFilePath, $mediaDir);
        if ($rel === '') return false;

        $store = AtelierStore::forRoot($projectRoot);
        $size = (int)@filesize($absFilePath);
        $mtime = (int)@filemtime($absFilePath);
        $existing = $store->selectOne('file_index', ['path' => $rel]);
        if ($existing && (int)$existing['mtime'] === $mtime && (int)$existing['size_bytes'] === $size) {
            return true; // Unchanged — incremental skip!
        }

        $name = basename($absFilePath);
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        $parent = strpos($rel, '/') !== false ? dirname($rel) : '';
        $category = ExifParser::getMediaCategory($ext, $mediaTypes);

        $comments = DotfileManager::loadDirComments(dirname($absFilePath));
        $comment = (string)($comments[$name] ?? '');

        $hasGps = 0;
        $lat = null;
        $lng = null;
        if ($category === 'image' && in_array($ext, ['jpg', 'jpeg', 'tif', 'tiff'], true) && function_exists('exif_read_data')) {
            $exif = @exif_read_data($absFilePath, 'GPS', true);
            if (is_array($exif) && !empty($exif['GPS'])) {
                $coords = ExifParser::extractGpsCoordinates($exif['GPS']);
                if (is_array($coords) && isset($coords['lat'], $coords['lng'])) {
                    $hasGps = 1;
                    $lat = (float)$coords['lat'];
                    $lng = (float)$coords['lng'];
                }
            }
        }

        $payload = [
            'path'       => $rel,
            'parent_dir' => $parent,
            'name'       => $name,
            'extension'  => $ext,
            'category'   => $category,
            'size_bytes' => $size,
            'mtime'      => $mtime,
            'has_gps'    => $hasGps,
            'lat'        => $lat,
            'lng'        => $lng,
            'comment'    => $comment,
            'tags_text'  => '',
            'indexed_at' => time()
        ];

        if ($existing) {
            $store->update('file_index', $payload, ['id' => (int)$existing['id']]);
        } else {
            $store->insert('file_index', $payload);
        }
        return true;
    }

    public static function removePath(string $projectRoot, string $relPath): void {
        $clean = trim(str_replace('\\', '/', $relPath), '/');
        if ($clean === '') return;
        $store = AtelierStore::forRoot($projectRoot);
        $store->delete('file_index', ['path' => $clean]);
    }

    /**
     * Incrementally indexes all files under `$mediaDir` (and optional `storage/users/`),
     * skipping unchanged files and pruning removed entries.
     */
    public static function rebuildIndex(
        string $projectRoot,
        string $mediaDir,
        array $mediaTypes = [],
        array $ignoreList = []
    ): array {
        $store = AtelierStore::forRoot($projectRoot);
        $seen = [];
        $indexed = 0;
        $skipped = 0;

        $scanTree = function (string $rootAbs) use (&$scanTree, &$seen, &$indexed, &$skipped, $projectRoot, $mediaDir, $mediaTypes, $ignoreList, $store) {
            if (!is_dir($rootAbs)) return;
            foreach (@scandir($rootAbs) ?: [] as $item) {
                if ($item === '.' || $item === '..' || $item[0] === '.') continue;
                if (in_array($item, $ignoreList, true)) continue;
                $abs = $rootAbs . '/' . $item;
                if (is_dir($abs)) {
                    $scanTree($abs);
                } elseif (is_file($abs)) {
                    $rel = PathValidator::getRelativePath($abs, $mediaDir);
                    if ($rel === '') continue;
                    $seen[$rel] = true;
                    $existing = $store->selectOne('file_index', ['path' => $rel]);
                    if ($existing && (int)$existing['mtime'] === (int)@filemtime($abs) && (int)$existing['size_bytes'] === (int)@filesize($abs)) {
                        $skipped++;
                    } else {
                        self::upsertFile($projectRoot, $mediaDir, $abs, $mediaTypes);
                        $indexed++;
                    }
                }
            }
        };

        $scanTree($mediaDir);
        $usersRoot = PathValidator::getUsersRoot($mediaDir);
        if (is_dir($usersRoot)) {
            $scanTree($usersRoot);
        }

        // Prune stale rows whose files no longer exist
        $pruned = 0;
        foreach ($store->select('file_index') as $row) {
            $p = (string)($row['path'] ?? '');
            if ($p !== '' && !isset($seen[$p])) {
                $store->delete('file_index', ['id' => (int)$row['id']]);
                $pruned++;
            }
        }

        return [
            'success' => true,
            'indexed' => $indexed,
            'skipped' => $skipped,
            'pruned'  => $pruned,
            'total'   => count($seen)
        ];
    }

    /**
     * Queries the SQLite/JSON index with strict per-directory access checks (never leaks private user homes!).
     */
    public static function search(
        string $projectRoot,
        string $mediaDir,
        string $query,
        string $category = 'all',
        int $limit = 100
    ): array {
        $q = mb_strtolower(trim($query));
        $store = AtelierStore::forRoot($projectRoot);
        $rows = $store->select('file_index', [], ['mtime' => 'DESC']);
        $results = [];

        foreach ($rows as $row) {
            if ($category !== 'all' && $category !== '' && ($row['category'] ?? '') !== $category) {
                continue;
            }
            if ($q !== '') {
                $hay = mb_strtolower(
                    (string)$row['name'] . ' ' . (string)$row['path'] . ' ' . (string)($row['comment'] ?? '') . ' ' . (string)($row['tags_text'] ?? '')
                );
                if (mb_strpos($hay, $q) === false) {
                    continue;
                }
            }

            // Enforce strict access control before returning any row
            $abs = PathValidator::sanitizeFile((string)$row['path'], $mediaDir);
            if (!$abs || !is_file($abs)) continue;
            if (!DotfileManager::isDirAccessible(dirname($abs), $mediaDir)) continue;

            $results[] = $row;
            if (count($results) >= $limit) break;
        }

        return $results;
    }

    public static function getStats(string $projectRoot): array {
        $store = AtelierStore::forRoot($projectRoot);
        $rows = $store->select('file_index');
        $byCat = [];
        $lastIndexed = 0;
        foreach ($rows as $r) {
            $cat = (string)($r['category'] ?? 'other');
            $byCat[$cat] = ($byCat[$cat] ?? 0) + 1;
            $ts = (int)($r['indexed_at'] ?? 0);
            if ($ts > $lastIndexed) $lastIndexed = $ts;
        }
        return [
            'total_files'  => count($rows),
            'by_category'  => $byCat,
            'last_indexed' => $lastIndexed > 0 ? $lastIndexed : null
        ];
    }
}
