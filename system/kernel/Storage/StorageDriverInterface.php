<?php
/**
 * Atelier by GallusTech - Unified VFS Storage Driver Contract (Phase B)
 * Implemented by LocalFilesystemDriver, WebDavStorageDriver, S3StorageDriver, and GoogleDriveStorageDriver.
 */

namespace SimpleGallery\Kernel\Storage;

interface StorageDriverInterface {

    public function getDriverName(): string;

    /**
     * Lists immediate child directories and files under $relPath ('' = mount root).
     * Returns ['directories' => [ ['name', 'path', 'mtime'] ], 'files' => [ ['name', 'path', 'size', 'mtime', 'mime'] ]].
     */
    public function listDir(string $relPath = ''): array;

    /**
     * Returns metadata for a single file or directory, or null if not found.
     */
    public function stat(string $relPath): ?array;

    /**
     * Reads complete file contents as a binary string, or null on failure.
     */
    public function readContent(string $relPath): ?string;

    /**
     * Writes raw string content to $relPath.
     */
    public function putContent(string $relPath, string $content, string $mime = 'application/octet-stream'): bool;

    /**
     * Uploads a local file path to $relPath.
     */
    public function putFile(string $relPath, string $localTmpPath, string $mime = 'application/octet-stream'): bool;

    /**
     * Deletes a file or directory at $relPath.
     */
    public function delete(string $relPath): bool;

    /**
     * Creates a directory at $relPath.
     */
    public function mkdir(string $relPath): bool;

    /**
     * Moves / renames a file or directory within the same mount.
     */
    public function move(string $srcRel, string $dstRel): bool;

    /**
     * Verifies connectivity & credentials. Returns ['success' => bool, 'message' => string].
     */
    public function testConnection(): array;
}
