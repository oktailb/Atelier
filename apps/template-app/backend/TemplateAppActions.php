<?php
/**
 * Atelier WebOS - Template App Backend Controller
 * Reference implementation showcasing unified ActionRouter + manifest.backend routing,
 * StorageRepository, ARCH-01 root separation, CSRF protection via manifest mutating_actions,
 * and Admin authorization gates.
 */

namespace Atelier\Apps\TemplateApp\Backend;

use Atelier\Kernel\FS\StorageRepository;
use Atelier\Kernel\Security\SecurityManager;

class TemplateAppActions {

    public static function handle(string $action, array $params, array $context): ?array {
        // ARCH-01: Always anchor runtime JSON storage under project_root (never media_dir / storage/media)
        $project_root = $context['project_root'] ?? $context['base_dir'];
        $storage = StorageRepository::forApp('template-app', $project_root);
        $is_admin = isset($context['is_admin']) ? !empty($context['is_admin']) : SecurityManager::isAdminLoggedIn();

        switch ($action) {
            // 1. Read Notes List (Safe GET)
            case 'template_get_notes':
                $notes = $storage->getJson('notes.json', [
                    [
                        'id'        => 'note-1',
                        'title'     => 'Welcome to Atelier by GallusTech',
                        'content'   => 'Persisted atomically inside storage/apps/template-app/notes.json.',
                        'timestamp' => time() - 3600
                    ]
                ]);
                return [
                    'status' => 200,
                    'data'   => ['success' => true, 'notes' => $notes]
                ];

            // 2. Add Note (POST + CSRF via manifest.backend.mutating_actions + Admin Gate + Input Validation)
            case 'template_save_note':
                if (!$is_admin) {
                    return [
                        'status' => 403,
                        'data'   => ['success' => false, 'error' => 'Admin authentication required to write notes.']
                    ];
                }

                $title   = trim((string)($params['title'] ?? ''));
                $content = trim((string)($params['content'] ?? ''));
                if ($title === '' || strlen($title) > 120 || strlen($content) > 2000) {
                    return [
                        'status' => 400,
                        'data'   => ['success' => false, 'error' => 'Invalid note title or content length.']
                    ];
                }

                $notes = $storage->getJson('notes.json', []);
                $newNote = [
                    'id'        => 'note-' . time() . '-' . substr(bin2hex(random_bytes(3)), 0, 4),
                    'title'     => $title,
                    'content'   => $content,
                    'timestamp' => time()
                ];
                array_unshift($notes, $newNote);
                $notes = array_slice($notes, 0, 50);

                $saved = $storage->saveJson('notes.json', $notes);
                return [
                    'status' => $saved ? 200 : 500,
                    'data'   => [
                        'success' => $saved,
                        'note'    => $newNote,
                        'notes'   => $notes,
                        'error'   => $saved ? null : 'Unable to persist notes to storage.'
                    ]
                ];

            // 3. Clear Notes (POST + CSRF + Admin Gate)
            case 'template_clear_notes':
                if (!$is_admin) {
                    return [
                        'status' => 403,
                        'data'   => ['success' => false, 'error' => 'Admin authentication required to clear notes.']
                    ];
                }
                $storage->saveJson('notes.json', []);
                return [
                    'status' => 200,
                    'data'   => ['success' => true, 'notes' => []]
                ];

            // 4. Ping App Diagnostic (Safe GET)
            case 'template_ping':
                return [
                    'status' => 200,
                    'data'   => [
                        'success'   => true,
                        'message'   => 'Template App API is operational.',
                        'app_id'    => 'template-app',
                        'timestamp' => time(),
                        'user'      => $is_admin ? 'Administrator' : 'Guest'
                    ]
                ];

            default:
                return null;
        }
    }
}
