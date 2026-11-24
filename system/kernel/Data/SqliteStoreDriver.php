<?php
/**
 * Atelier by GallusTech - SQLite WAL Store Driver (PDO_SQLITE)
 * Automatically runs versioned DDL migrations covering:
 * - users, groups, group_members (multi-user identity & RBAC)
 * - user_shares (folder mounts between users/groups, ready for E2EE wrapped keys)
 * - share_links (signed public/client links with expiry, password & quotas)
 * - acl_rules (fine-grained path ACLs complementing dotfiles)
 * - tags, item_tags (future tagging & classification engine)
 * - item_metadata, vault_keys (future classification & client-side E2EE cryptography)
 * - audit_logs (security & GDPR audit trail)
 */

namespace SimpleGallery\Kernel\Data;

use PDO;

class SqliteStoreDriver implements AtelierStoreInterface {

    /** @var PDO */
    private $pdo;

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
        'auth_tokens'
    ];

    public function __construct(string $dbPath) {
        $dir = dirname($dbPath);
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }

        $this->pdo = new PDO('sqlite:' . $dbPath, null, null, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false
        ]);

        $this->pdo->exec('PRAGMA journal_mode = WAL;');
        $this->pdo->exec('PRAGMA synchronous = NORMAL;');
        $this->pdo->exec('PRAGMA foreign_keys = ON;');
        $this->pdo->exec('PRAGMA busy_timeout = 5000;');

        $this->migrate();
    }

    public function getDriverName(): string {
        return 'sqlite';
    }

    public function getPdo(): PDO {
        return $this->pdo;
    }

    private function assertIdentifier(string $name, bool $isTable = false): string {
        if ($isTable && !in_array($name, self::ALLOWED_TABLES, true)) {
            throw new \InvalidArgumentException("Unknown table: {$name}");
        }
        if (!preg_match('/^[a-zA-Z_][a-zA-Z0-9_]*$/', $name)) {
            throw new \InvalidArgumentException("Invalid SQL identifier: {$name}");
        }
        return $name;
    }

    private function migrate(): void {
        $this->pdo->exec("
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at INTEGER NOT NULL
            );
        ");

        $applied = [];
        $stmt = $this->pdo->query("SELECT version FROM schema_migrations");
        if ($stmt) {
            foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $v) {
                $applied[(int)$v] = true;
            }
        }

        if (empty($applied[1])) {
            $this->pdo->beginTransaction();
            try {
                $this->pdo->exec("
                    CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username TEXT NOT NULL UNIQUE,
                        display_name TEXT NOT NULL,
                        email TEXT DEFAULT '',
                        password_hash TEXT NOT NULL,
                        role TEXT NOT NULL DEFAULT 'user',
                        home_dir TEXT NOT NULL,
                        quota_bytes INTEGER NOT NULL DEFAULT 0,
                        is_active INTEGER NOT NULL DEFAULT 1,
                        totp_secret TEXT DEFAULT NULL,
                        public_key TEXT DEFAULT NULL,
                        key_salt TEXT DEFAULT NULL,
                        preferences_json TEXT DEFAULT '{}',
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL,
                        last_login_at INTEGER DEFAULT NULL
                    );

                    CREATE TABLE IF NOT EXISTS groups (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL UNIQUE,
                        display_name TEXT NOT NULL,
                        description TEXT DEFAULT '',
                        created_at INTEGER NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS group_members (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        group_id INTEGER NOT NULL,
                        user_id INTEGER NOT NULL,
                        role TEXT NOT NULL DEFAULT 'member',
                        added_at INTEGER NOT NULL,
                        UNIQUE(group_id, user_id),
                        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS user_shares (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        owner_user_id INTEGER NOT NULL,
                        source_path TEXT NOT NULL,
                        mount_name TEXT NOT NULL,
                        mount_icon TEXT NOT NULL DEFAULT '💽',
                        target_type TEXT NOT NULL DEFAULT 'user',
                        target_id INTEGER NOT NULL,
                        permission TEXT NOT NULL DEFAULT 'read',
                        show_on_desktop INTEGER NOT NULL DEFAULT 1,
                        crypto_wrapped_key TEXT DEFAULT NULL,
                        created_at INTEGER NOT NULL,
                        expires_at INTEGER DEFAULT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_user_shares_target ON user_shares(target_type, target_id);
                    CREATE INDEX IF NOT EXISTS idx_user_shares_owner ON user_shares(owner_user_id);

                    CREATE TABLE IF NOT EXISTS share_links (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        token TEXT NOT NULL UNIQUE,
                        owner_user_id INTEGER NOT NULL,
                        target_path TEXT NOT NULL,
                        label TEXT NOT NULL DEFAULT '',
                        mode TEXT NOT NULL DEFAULT 'read',
                        password_hash TEXT DEFAULT NULL,
                        expires_at INTEGER DEFAULT NULL,
                        max_downloads INTEGER DEFAULT NULL,
                        download_count INTEGER NOT NULL DEFAULT 0,
                        allow_zip INTEGER NOT NULL DEFAULT 1,
                        watermark_text TEXT DEFAULT NULL,
                        created_at INTEGER NOT NULL,
                        revoked_at INTEGER DEFAULT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);

                    CREATE TABLE IF NOT EXISTS acl_rules (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        path TEXT NOT NULL,
                        subject_type TEXT NOT NULL,
                        subject_id INTEGER NOT NULL DEFAULT 0,
                        permission TEXT NOT NULL DEFAULT 'read',
                        inherit INTEGER NOT NULL DEFAULT 1,
                        created_at INTEGER NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_acl_rules_path ON acl_rules(path);

                    CREATE TABLE IF NOT EXISTS tags (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        slug TEXT NOT NULL UNIQUE,
                        label TEXT NOT NULL,
                        color TEXT NOT NULL DEFAULT '#6366f1',
                        namespace TEXT NOT NULL DEFAULT 'general',
                        owner_user_id INTEGER DEFAULT NULL,
                        created_at INTEGER NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS item_tags (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        item_path TEXT NOT NULL,
                        tag_id INTEGER NOT NULL,
                        added_by_user_id INTEGER DEFAULT NULL,
                        confidence REAL NOT NULL DEFAULT 1.0,
                        created_at INTEGER NOT NULL,
                        UNIQUE(item_path, tag_id),
                        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
                    );
                    CREATE INDEX IF NOT EXISTS idx_item_tags_path ON item_tags(item_path);

                    CREATE TABLE IF NOT EXISTS item_metadata (
                        item_path TEXT PRIMARY KEY,
                        classification TEXT NOT NULL DEFAULT 'internal',
                        is_encrypted INTEGER NOT NULL DEFAULT 0,
                        crypto_algo TEXT DEFAULT NULL,
                        crypto_key_id TEXT DEFAULT NULL,
                        crypto_iv TEXT DEFAULT NULL,
                        crypto_meta_json TEXT DEFAULT NULL,
                        custom_json TEXT DEFAULT '{}',
                        updated_at INTEGER NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS vault_keys (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        owner_user_id INTEGER NOT NULL,
                        key_fingerprint TEXT NOT NULL UNIQUE,
                        algorithm TEXT NOT NULL DEFAULT 'AES-256-GCM',
                        wrapped_key TEXT NOT NULL,
                        kdf_params_json TEXT DEFAULT '{}',
                        created_at INTEGER NOT NULL,
                        rotated_at INTEGER DEFAULT NULL
                    );

                    CREATE TABLE IF NOT EXISTS audit_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER DEFAULT NULL,
                        username TEXT DEFAULT 'guest',
                        action TEXT NOT NULL,
                        target_path TEXT DEFAULT '',
                        ip_address TEXT DEFAULT '',
                        status TEXT NOT NULL DEFAULT 'ok',
                        details_json TEXT DEFAULT '{}',
                        created_at INTEGER NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON audit_logs(created_at DESC);
                ");

                $ins = $this->pdo->prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)");
                $ins->execute([1, 'initial_atelier_phase1_schema', time()]);
                $this->pdo->commit();
            } catch (\Throwable $e) {
                $this->pdo->rollBack();
                throw $e;
            }
        }

        if (empty($applied[2])) {
            $this->pdo->beginTransaction();
            try {
                // Inspect existing columns on users before ALTER TABLE
                $existingCols = [];
                $colStmt = $this->pdo->query("PRAGMA table_info(users)");
                if ($colStmt) {
                    foreach ($colStmt->fetchAll(PDO::FETCH_ASSOC) as $c) {
                        $existingCols[(string)$c['name']] = true;
                    }
                }
                $alterCols = [
                    'email_verified_at'        => "ALTER TABLE users ADD COLUMN email_verified_at INTEGER DEFAULT NULL",
                    'approval_status'          => "ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'",
                    'totp_confirmed_at'        => "ALTER TABLE users ADD COLUMN totp_confirmed_at INTEGER DEFAULT NULL",
                    'totp_recovery_codes_json' => "ALTER TABLE users ADD COLUMN totp_recovery_codes_json TEXT DEFAULT NULL",
                    'totp_last_step'           => "ALTER TABLE users ADD COLUMN totp_last_step INTEGER DEFAULT NULL"
                ];
                foreach ($alterCols as $colName => $sql) {
                    if (empty($existingCols[$colName])) {
                        $this->pdo->exec($sql);
                    }
                }

                $this->pdo->exec("
                    CREATE TABLE IF NOT EXISTS auth_tokens (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER DEFAULT NULL,
                        token_hash TEXT NOT NULL UNIQUE,
                        type TEXT NOT NULL,
                        target_email TEXT DEFAULT '',
                        meta_json TEXT DEFAULT '{}',
                        expires_at INTEGER NOT NULL,
                        used_at INTEGER DEFAULT NULL,
                        created_at INTEGER NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens(token_hash);
                    CREATE INDEX IF NOT EXISTS idx_auth_tokens_type ON auth_tokens(type);
                ");

                $ins = $this->pdo->prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)");
                $ins->execute([2, 'atelier_phase_a2_self_registration_2fa', time()]);
                $this->pdo->commit();
            } catch (\Throwable $e) {
                $this->pdo->rollBack();
                throw $e;
            }
        }
    }

    private function buildWhere(array $where): array {
        if (empty($where)) {
            return ['', []];
        }
        $clauses = [];
        $values = [];
        foreach ($where as $col => $val) {
            $safeCol = $this->assertIdentifier((string)$col);
            if ($val === null) {
                $clauses[] = "{$safeCol} IS NULL";
            } else {
                $clauses[] = "{$safeCol} = ?";
                $values[] = $val;
            }
        }
        return [' WHERE ' . implode(' AND ', $clauses), $values];
    }

    public function select(string $table, array $where = [], array $orderBy = [], ?int $limit = null): array {
        $safeTable = $this->assertIdentifier($table, true);
        list($whereSql, $params) = $this->buildWhere($where);
        $orderSql = '';
        if (!empty($orderBy)) {
            $parts = [];
            foreach ($orderBy as $col => $dir) {
                $safeCol = $this->assertIdentifier((string)$col);
                $safeDir = strtoupper((string)$dir) === 'DESC' ? 'DESC' : 'ASC';
                $parts[] = "{$safeCol} {$safeDir}";
            }
            $orderSql = ' ORDER BY ' . implode(', ', $parts);
        }
        $limitSql = ($limit !== null && $limit > 0) ? (' LIMIT ' . (int)$limit) : '';
        $stmt = $this->pdo->prepare("SELECT * FROM {$safeTable}{$whereSql}{$orderSql}{$limitSql}");
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    public function selectOne(string $table, array $where): ?array {
        $rows = $this->select($table, $where, [], 1);
        return $rows[0] ?? null;
    }

    public function insert(string $table, array $data) {
        $safeTable = $this->assertIdentifier($table, true);
        $cols = [];
        $placeholders = [];
        $values = [];
        foreach ($data as $col => $val) {
            $cols[] = $this->assertIdentifier((string)$col);
            $placeholders[] = '?';
            $values[] = $val;
        }
        $sql = "INSERT INTO {$safeTable} (" . implode(', ', $cols) . ") VALUES (" . implode(', ', $placeholders) . ")";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($values);
        $lastId = $this->pdo->lastInsertId();
        return is_numeric($lastId) ? (int)$lastId : $lastId;
    }

    public function upsert(string $table, string $pkColumn, array $data): bool {
        $safeTable = $this->assertIdentifier($table, true);
        $this->assertIdentifier($pkColumn);
        $cols = [];
        $placeholders = [];
        $values = [];
        foreach ($data as $col => $val) {
            $cols[] = $this->assertIdentifier((string)$col);
            $placeholders[] = '?';
            $values[] = $val;
        }
        $sql = "INSERT OR REPLACE INTO {$safeTable} (" . implode(', ', $cols) . ") VALUES (" . implode(', ', $placeholders) . ")";
        $stmt = $this->pdo->prepare($sql);
        return $stmt->execute($values);
    }

    public function update(string $table, array $data, array $where): int {
        $safeTable = $this->assertIdentifier($table, true);
        if (empty($data)) return 0;
        $sets = [];
        $values = [];
        foreach ($data as $col => $val) {
            $sets[] = $this->assertIdentifier((string)$col) . ' = ?';
            $values[] = $val;
        }
        list($whereSql, $whereValues) = $this->buildWhere($where);
        $sql = "UPDATE {$safeTable} SET " . implode(', ', $sets) . $whereSql;
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute(array_merge($values, $whereValues));
        return $stmt->rowCount();
    }

    public function delete(string $table, array $where): int {
        $safeTable = $this->assertIdentifier($table, true);
        list($whereSql, $whereValues) = $this->buildWhere($where);
        $stmt = $this->pdo->prepare("DELETE FROM {$safeTable}{$whereSql}");
        $stmt->execute($whereValues);
        return $stmt->rowCount();
    }

    public function count(string $table, array $where = []): int {
        $safeTable = $this->assertIdentifier($table, true);
        list($whereSql, $whereValues) = $this->buildWhere($where);
        $stmt = $this->pdo->prepare("SELECT COUNT(*) FROM {$safeTable}{$whereSql}");
        $stmt->execute($whereValues);
        return (int)$stmt->fetchColumn();
    }
}
