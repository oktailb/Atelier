<?php
/**
 * Atelier by GallusTech - Atomic JSON Store Driver (Fallback when PDO_SQLITE is not loaded)
 * Mirrors the exact relational schema & semantics of SqliteStoreDriver using flock()-locked JSON tables
 * inside `storage/atelier_db/<table>.json`.
 */

namespace Atelier\Kernel\Data;

class JsonStoreDriver implements AtelierStoreInterface {

    /** @var string */
    private $dbDir;

    private const ALLOWED_TABLES = [
        'schema_migrations',
        'users',
        'groups',
        'group_members',
        'user_shares',
        'share_links',
        'acl_rules',
        'tags',
        'item_tags',
        'item_metadata',
        'vault_keys',
        'audit_logs',
        'auth_tokens',
        'user_sessions',
        'external_mounts',
        'file_index',
        'app_passwords',
        'background_jobs'
    ];

    private const UNIQUE_COLUMNS = [
        'users'         => ['username'],
        'groups'        => ['name'],
        'share_links'   => ['token'],
        'tags'          => ['slug'],
        'vault_keys'    => ['key_fingerprint'],
        'auth_tokens'   => ['token_hash'],
        'user_sessions' => ['session_token_hash'],
        'file_index'    => ['path']
    ];

    public function __construct(string $dbDir) {
        $this->dbDir = rtrim(str_replace('\\', '/', $dbDir), '/');
        if (!is_dir($this->dbDir)) {
            @mkdir($this->dbDir, 0755, true);
        }
        $htaccess = $this->dbDir . '/.htaccess';
        if (!file_exists($htaccess)) {
            @file_put_contents($htaccess, "Deny from all\n", LOCK_EX);
        }
    }

    public function getDriverName(): string {
        return 'json';
    }

    private function tablePath(string $table): string {
        if (!in_array($table, self::ALLOWED_TABLES, true)) {
            throw new \InvalidArgumentException("Unknown table: {$table}");
        }
        return $this->dbDir . '/' . $table . '.json';
    }

    private function readTable(string $table): array {
        $path = $this->tablePath($table);
        if (!file_exists($path)) {
            return ['next_id' => 1, 'rows' => []];
        }
        $raw = @file_get_contents($path);
        $decoded = @json_decode((string)$raw, true);
        if (!is_array($decoded) || !isset($decoded['rows']) || !is_array($decoded['rows'])) {
            return ['next_id' => 1, 'rows' => []];
        }
        return [
            'next_id' => isset($decoded['next_id']) ? (int)$decoded['next_id'] : 1,
            'rows'    => $decoded['rows']
        ];
    }

    private function writeTable(string $table, array $payload): bool {
        $path = $this->tablePath($table);
        $tmp = $path . '.tmp.' . getmypid() . '.' . mt_rand(1000, 9999);
        $json = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
            return false;
        }
        if (!@rename($tmp, $path)) {
            $ok = @file_put_contents($path, $json, LOCK_EX) !== false;
            @unlink($tmp);
            return $ok;
        }
        return true;
    }

    private function matches(array $row, array $where): bool {
        foreach ($where as $col => $val) {
            $exists = array_key_exists($col, $row);
            $rowVal = $exists ? $row[$col] : null;
            if ($val === null) {
                if ($rowVal !== null) return false;
            } else {
                if ($rowVal === null) return false;
                if ((string)$rowVal !== (string)$val) return false;
            }
        }
        return true;
    }

    public function select(string $table, array $where = [], array $orderBy = [], ?int $limit = null): array {
        $tbl = $this->readTable($table);
        $rows = [];
        foreach ($tbl['rows'] as $row) {
            if ($this->matches($row, $where)) {
                $rows[] = $row;
            }
        }

        if (!empty($orderBy)) {
            usort($rows, function ($a, $b) use ($orderBy) {
                foreach ($orderBy as $col => $dir) {
                    $va = $a[$col] ?? null;
                    $vb = $b[$col] ?? null;
                    if ($va == $vb) continue;
                    $cmp = (is_numeric($va) && is_numeric($vb))
                        ? (($va < $vb) ? -1 : 1)
                        : strcmp((string)$va, (string)$vb);
                    return strtoupper((string)$dir) === 'DESC' ? -$cmp : $cmp;
                }
                return 0;
            });
        }

        if ($limit !== null && $limit > 0) {
            $rows = array_slice($rows, 0, $limit);
        }
        return $rows;
    }

    public function selectOne(string $table, array $where): ?array {
        $rows = $this->select($table, $where, [], 1);
        return $rows[0] ?? null;
    }

    public function insert(string $table, array $data) {
        $tbl = $this->readTable($table);

        // Enforce declared UNIQUE constraints
        if (isset(self::UNIQUE_COLUMNS[$table])) {
            foreach (self::UNIQUE_COLUMNS[$table] as $uCol) {
                if (isset($data[$uCol])) {
                    foreach ($tbl['rows'] as $existing) {
                        if (isset($existing[$uCol]) && (string)$existing[$uCol] === (string)$data[$uCol]) {
                            throw new \RuntimeException("UNIQUE constraint failed: {$table}.{$uCol}");
                        }
                    }
                }
            }
        }

        if ($table !== 'item_metadata') {
            $id = $tbl['next_id']++;
            $data = array_merge(['id' => $id], $data);
        } else {
            $id = $data['item_path'] ?? '';
        }

        $tbl['rows'][] = $data;
        $this->writeTable($table, $tbl);
        return $id;
    }

    public function upsert(string $table, string $pkColumn, array $data): bool {
        $tbl = $this->readTable($table);
        $pkVal = $data[$pkColumn] ?? null;
        $found = false;
        foreach ($tbl['rows'] as $i => $row) {
            if (isset($row[$pkColumn]) && (string)$row[$pkColumn] === (string)$pkVal) {
                $tbl['rows'][$i] = array_merge($row, $data);
                $found = true;
                break;
            }
        }
        if (!$found) {
            $tbl['rows'][] = $data;
        }
        return $this->writeTable($table, $tbl);
    }

    public function update(string $table, array $data, array $where): int {
        $tbl = $this->readTable($table);
        $affected = 0;
        foreach ($tbl['rows'] as $i => $row) {
            if ($this->matches($row, $where)) {
                $tbl['rows'][$i] = array_merge($row, $data);
                $affected++;
            }
        }
        if ($affected > 0) {
            $this->writeTable($table, $tbl);
        }
        return $affected;
    }

    public function delete(string $table, array $where): int {
        $tbl = $this->readTable($table);
        $kept = [];
        $deleted = 0;
        foreach ($tbl['rows'] as $row) {
            if ($this->matches($row, $where)) {
                $deleted++;
            } else {
                $kept[] = $row;
            }
        }
        if ($deleted > 0) {
            $tbl['rows'] = $kept;
            $this->writeTable($table, $tbl);
        }
        return $deleted;
    }

    public function count(string $table, array $where = []): int {
        return count($this->select($table, $where));
    }
}
