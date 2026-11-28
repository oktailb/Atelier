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

        $tagsText = '';
        try {
            $itemTags = \Atelier\Kernel\Auth\ShareManager::getItemTags($projectRoot, $rel);
            if (!empty($itemTags)) {
                $labels = array_values(array_filter(array_map(function ($t) {
                    return trim((string)($t['label'] ?? ''));
                }, $itemTags)));
                $tagsText = implode(', ', $labels);
            }
        } catch (\Throwable $e) {
            $tagsText = '';
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
            'tags_text'  => $tagsText,
            'indexed_at' => time()
        ];

        if ($existing) {
            $store->update('file_index', $payload, ['id' => (int)$existing['id']]);
        } else {
            $store->insert('file_index', $payload);
        }
        return true;
    }

    /**
     * Synchronizes `tags_text` in `file_index` immediately after tags change on a file.
     */
    public static function updateTagsText(string $projectRoot, string $relPath, array $tags): void {
        $clean = trim(str_replace('\\', '/', $relPath), '/');
        if ($clean === '') return;
        $labels = array_values(array_filter(array_map(function ($t) {
            return is_array($t) ? trim((string)($t['label'] ?? '')) : trim((string)$t);
        }, $tags)));
        $store = AtelierStore::forRoot($projectRoot);
        $existing = $store->selectOne('file_index', ['path' => $clean]);
        if ($existing) {
            $store->update('file_index', ['tags_text' => implode(', ', $labels), 'indexed_at' => time()], ['id' => (int)$existing['id']]);
        }
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
     * Supports optional multi-criteria `$filters`: `tag`, `dir`, `scope` ('current'|'global'),
     * `size_range` ('small'|'medium'|'large'|'xlarge'), `timing` ('today'|'week'|'month'|'year'|'custom'),
     * `date_from`, `date_to`, `gps_only`, and `enrich` (adds thumb_url/file_url/download_url/size_formatted/mtime_formatted).
     */
    public static function search(
        string $projectRoot,
        string $mediaDir,
        string $query,
        string $category = 'all',
        int $limit = 100,
        array $filters = []
    ): array {
        $q = mb_strtolower(trim($query));
        $tagFilter = mb_strtolower(trim((string)($filters['tag'] ?? '')));
        $scope = strtolower(trim((string)($filters['scope'] ?? 'global')));
        $dirPrefix = trim(str_replace('\\', '/', (string)($filters['dir'] ?? '')), '/');
        $sizeRange = strtolower(trim((string)($filters['size_range'] ?? 'all')));
        $timing = strtolower(trim((string)($filters['timing'] ?? 'all')));
        $dateFrom = trim((string)($filters['date_from'] ?? ''));
        $dateTo = trim((string)($filters['date_to'] ?? ''));
        $gpsOnly = !empty($filters['gps_only']);
        $enrich = !empty($filters['enrich']);

        $minMtime = null;
        $maxMtime = null;
        $now = time();
        if ($timing === 'today') {
            $minMtime = strtotime('today');
        } elseif ($timing === 'week') {
            $minMtime = $now - 7 * 86400;
        } elseif ($timing === 'month') {
            $minMtime = $now - 30 * 86400;
        } elseif ($timing === 'year') {
            $minMtime = $now - 365 * 86400;
        } elseif ($timing === 'custom') {
            if ($dateFrom !== '') {
                $ts = strtotime($dateFrom . ' 00:00:00');
                if ($ts !== false) $minMtime = $ts;
            }
            if ($dateTo !== '') {
                $ts = strtotime($dateTo . ' 23:59:59');
                if ($ts !== false) $maxMtime = $ts;
            }
        }

        // Pre-resolve tagged paths from item_tags table when filtering by tag so even freshly tagged items match
        $taggedPathSet = null;
        if ($tagFilter !== '') {
            $storeTmp = AtelierStore::forRoot($projectRoot);
            $allTags = $storeTmp->select('tags');
            $matchingIds = [];
            foreach ($allTags as $tRow) {
                $lbl = mb_strtolower(trim((string)($tRow['label'] ?? '')));
                $slg = mb_strtolower(trim((string)($tRow['slug'] ?? '')));
                if ($lbl === $tagFilter || $slg === $tagFilter || ($lbl !== '' && mb_strpos($lbl, $tagFilter) !== false)) {
                    $matchingIds[] = (int)$tRow['id'];
                }
            }
            $taggedPathSet = [];
            if (!empty($matchingIds)) {
                foreach ($storeTmp->select('item_tags') as $lnk) {
                    if (in_array((int)$lnk['tag_id'], $matchingIds, true)) {
                        $taggedPathSet[trim(str_replace('\\', '/', (string)$lnk['item_path']), '/')] = true;
                    }
                }
            }
        }

        $store = AtelierStore::forRoot($projectRoot);
        $rows = $store->select('file_index', [], ['mtime' => 'DESC']);
        $results = [];

        foreach ($rows as $row) {
            if ($category !== 'all' && $category !== '' && ($row['category'] ?? '') !== $category) {
                continue;
            }

            $rowPath = trim(str_replace('\\', '/', (string)($row['path'] ?? '')), '/');
            if ($scope === 'current' && $dirPrefix !== '') {
                if ($rowPath !== $dirPrefix && strpos($rowPath, $dirPrefix . '/') !== 0) {
                    continue;
                }
            }

            if ($gpsOnly && empty($row['has_gps'])) {
                continue;
            }

            $sizeBytes = (int)($row['size_bytes'] ?? 0);
            if ($sizeRange === 'small' && $sizeBytes >= 1048576) continue;
            if ($sizeRange === 'medium' && ($sizeBytes < 1048576 || $sizeBytes > 10485760)) continue;
            if ($sizeRange === 'large' && ($sizeBytes <= 10485760 || $sizeBytes > 104857600)) continue;
            if ($sizeRange === 'xlarge' && $sizeBytes <= 104857600) continue;

            $mtime = (int)($row['mtime'] ?? 0);
            if ($minMtime !== null && $mtime < $minMtime) continue;
            if ($maxMtime !== null && $mtime > $maxMtime) continue;

            if ($tagFilter !== '') {
                $tagsHay = mb_strtolower((string)($row['tags_text'] ?? ''));
                $inTagsText = ($tagsHay !== '' && mb_strpos($tagsHay, $tagFilter) !== false);
                $inJoinTable = ($taggedPathSet !== null && isset($taggedPathSet[$rowPath]));
                if (!$inTagsText && !$inJoinTable) {
                    continue;
                }
            }

            if ($q !== '') {
                $hay = mb_strtolower(
                    (string)$row['name'] . ' ' . $rowPath . ' ' . (string)($row['comment'] ?? '') . ' ' . (string)($row['tags_text'] ?? '')
                );
                if (mb_strpos($hay, $q) === false) {
                    continue;
                }
            }

            // Enforce strict access control before returning any row
            $abs = PathValidator::sanitizeFile($rowPath, $mediaDir);
            if (!$abs || !is_file($abs)) continue;
            if (!DotfileManager::isDirAccessible(dirname($abs), $mediaDir)) continue;

            if ($enrich) {
                $enc = rawurlencode($rowPath);
                $row['size'] = $sizeBytes;
                $row['size_formatted'] = ExifParser::formatBytes($sizeBytes);
                $row['mtime_formatted'] = $mtime > 0 ? date('d/m/Y H:i', $mtime) : '';
                $row['thumb_url'] = 'system/endpoints/thumb.php?file=' . $enc;
                $row['file_url'] = 'system/endpoints/thumb.php?file=' . $enc . '&raw=1';
                $row['download_url'] = 'system/endpoints/thumb.php?file=' . $enc . '&download=1';
                $row['tags'] = array_values(array_filter(array_map('trim', explode(',', (string)($row['tags_text'] ?? '')))));
                if (!empty($row['has_gps']) && isset($row['lat'], $row['lng'])) {
                    $row['exif'] = ['gps' => ['lat' => (float)$row['lat'], 'lng' => (float)$row['lng']]];
                }
            }

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
