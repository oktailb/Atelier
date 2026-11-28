<?php
/**
 * Atelier by GallusTech - Unified Data Store Factory (`AtelierStore`)
 * Automatically selects PDO SQLite WAL (`storage/atelier.sqlite`) when `pdo_sqlite` is enabled,
 * and seamlessly falls back to atomic locked JSON tables (`storage/atelier_db/`) on minimal PHP hosts.
 */

namespace Atelier\Kernel\Data;

use Atelier\Kernel\Config\ConfigStore;

class AtelierStore {

    /** @var array<string, AtelierStoreInterface> */
    private static $instances = [];

    /**
     * Returns a store instance scoped to the resolved project root (ARCH-01 safe, test-sandbox safe).
     */
    public static function forRoot(string $baseOrProjectRoot, ?string $forceDriver = null): AtelierStoreInterface {
        $root = ConfigStore::resolveRoot($baseOrProjectRoot);
        $storageDir = ConfigStore::getStorageDir($root);
        $driver = $forceDriver ?: (extension_loaded('pdo_sqlite') ? 'sqlite' : 'json');
        $cacheKey = $driver . '::' . $storageDir;

        if (isset(self::$instances[$cacheKey])) {
            return self::$instances[$cacheKey];
        }

        if ($driver === 'sqlite' && extension_loaded('pdo_sqlite')) {
            $instance = new SqliteStoreDriver($storageDir . '/atelier.sqlite');
        } else {
            $instance = new JsonStoreDriver($storageDir . '/atelier_db');
        }

        self::$instances[$cacheKey] = $instance;
        return $instance;
    }

    /**
     * Clears cached connections (useful in unit tests with temporary directories).
     */
    public static function resetCache(): void {
        self::$instances = [];
    }
}
