<?php
/**
 * Atelier by GallusTech - Unified Data Store Interface
 * Shared contract implemented by both SqliteStoreDriver (PDO SQLite WAL) and JsonStoreDriver (atomic fallback).
 */

namespace Atelier\Kernel\Data;

interface AtelierStoreInterface {
    public function getDriverName(): string;

    /**
     * Fetch all rows from a table matching optional exact equality filters ($where = ['col' => val])
     */
    public function select(string $table, array $where = [], array $orderBy = [], ?int $limit = null): array;

    /**
     * Fetch a single row matching $where, or null
     */
    public function selectOne(string $table, array $where): ?array;

    /**
     * Insert a new row and return its numeric/string primary key ID
     */
    public function insert(string $table, array $data);

    /**
     * Insert or replace a row keyed by $pkColumn (used for string-PK tables like item_metadata)
     */
    public function upsert(string $table, string $pkColumn, array $data): bool;

    /**
     * Update rows matching $where; returns affected row count
     */
    public function update(string $table, array $data, array $where): int;

    /**
     * Delete rows matching $where; returns deleted row count
     */
    public function delete(string $table, array $where): int;

    /**
     * Count rows matching $where
     */
    public function count(string $table, array $where = []): int;
}
