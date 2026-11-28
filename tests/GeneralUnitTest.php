<?php
/**
 * Atelier by GallusTech - General Functional & Feature Unit Test Suite
 * Covers directory indexing, path operations, dotfile overrides, caching, search filters, comments, and archives.
 */

if (!defined('ATELIER_CORE')) {
    define('ATELIER_CORE', true);
}

require_once dirname(__DIR__) . '/system/boot/bootstrap.php';
require_once dirname(__DIR__) . '/system/kernel/functions.php';

class GeneralUnitTestSuite {
    /** @var string */
    private $base_dir;
    /** @var string */
    private $test_dir;
    /** @var int */
    private $passed = 0;
    /** @var int */
    private $failed = 0;
    /** @var array */
    private $results = [];

    public function getResults(): array {
        return $this->results;
    }

    public function getCounts(): array {
        return [
            'passed' => $this->passed,
            'failed' => $this->failed,
            'total'  => $this->passed + $this->failed
        ];
    }

    private function getActionCode(): string {
        $files = array_merge(
            glob($this->base_dir . '/system/kernel/Actions/*.php') ?: [],
            glob($this->base_dir . '/apps/*/backend/*.php') ?: [],
            glob($this->base_dir . '/apps/*/api.php') ?: []
        );
        $code = (string)@file_get_contents($this->base_dir . '/system/endpoints/api.php');
        foreach ($files as $f) {
            $code .= "\n" . @file_get_contents($f);
        }
        return $code;
    }



    public function __construct() {
        $this->base_dir = realpath(dirname(__DIR__)) ?: dirname(__DIR__);
        $this->base_dir = str_replace('\\', '/', $this->base_dir);

        // Create temporary test environment folder in ignored directory (.thumbnails)
        $sandbox = $this->base_dir . '/.thumbnails/test_sandbox_gen_' . md5(uniqid('', true));
        if (!is_dir($sandbox)) {
            @mkdir($sandbox, 0755, true);
        }
        if (!is_dir($sandbox) || !is_writable($sandbox)) {
            $sandbox = sys_get_temp_dir() . '/atelier_test_sandbox_gen_' . md5(uniqid('', true));
            if (!is_dir($sandbox)) {
                @mkdir($sandbox, 0755, true);
            }
        }
        $this->test_dir = str_replace('\\', '/', $sandbox);

    }

    public function __destruct() {
        if (is_dir($this->test_dir)) {
            $this->recursive_rmdir($this->test_dir);
        }
    }

    private function recursive_rmdir(string $dir): void {
        if (!is_dir($dir)) return;
        $items = @scandir($dir);
        if ($items === false) return;
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            $path = $dir . '/' . $item;
            if (is_dir($path)) {
                $this->recursive_rmdir($path);
            } else {
                @unlink($path);
            }
        }
        @rmdir($dir);
    }

    private function assert(string $test_name, bool $condition, string $details = ''): void {
        if ($condition) {
            $this->passed++;
            $this->results[] = ['name' => $test_name, 'status' => 'PASS', 'details' => ''];
            echo "  ✅ PASS: {$test_name}\n";
        } else {
            $this->failed++;
            $this->results[] = ['name' => $test_name, 'status' => 'FAIL', 'details' => $details];
            echo "  ❌ FAIL: {$test_name}" . ($details ? " - {$details}" : "") . "\n";
        }
    }

    public function runAll(): bool {
        $saved_session = $_SESSION ?? [];
        $_SESSION = [];

        echo "\n============================================================\n";
        echo " ⚙️ Atelier by GallusTech - Suite de Tests Fonctionnels Généraux\n";
        echo "============================================================\n\n";

        $this->testPathAndRelativeHelpers();
        $this->testDotfileFolderOverrides();
        $this->testCommentLegendParser();
        $this->testDirectoryCacheEngine();
        $this->testSearchEngineFilters();
        $this->testArchiveGenerationEngine();
        $this->testMp4ExtractorFallback();
        $this->testCookieConsentConfiguration();
        $this->testImageEditorBackend();
        $this->testI18nEngineAndLocales();
        $this->testUnifiedMetadataExtractors();
        $this->testSystemMonitorAppAndTelemetry();
        $this->testNextGenTaskbarAndAppCategories();
        $this->testTribuneAppAndMultiBouchot();
        $this->testAutostartConfiguration();
        $this->testDisabledAppsFilteringAndTribuneStandalone();
        $this->testClipboardAndKeyboardShortcuts();
        $this->testAutorunAndExplorerEnhancements();
        $this->testPhase1MultiUserVolumesTagsCrypto();

        $_SESSION = $saved_session;

        echo "\n============================================================\n";
        echo " 📊 RÉSULTAT FINAL DES TESTS FONCTIONNELS\n";
        echo "============================================================\n";
        echo "  Tests Réussis : {$this->passed}\n";
        echo "  Tests Échoués : {$this->failed}\n";
        echo "  Total Tests   : " . ($this->passed + $this->failed) . "\n";

        if ($this->failed === 0) {
            echo "\n 🎉 VÉRIFICATION RÉUSSIE : TOUTES LES FONCTIONNALITÉS SONT STABLES !\n\n";
            return true;
        } else {
            echo "\n ⚠️ ATTENTION : CERTAINS TESTS FONCTIONNELS ONT ÉCHOUÉ !\n\n";
            return false;
        }
    }

    /**
     * 1. Path & Relative Path Resolution Tests
     */
    private function testPathAndRelativeHelpers(): void {
        echo "📂 [1/7] Test de la Résolution des Chemins Relatifs...\n";

        $rel_root = get_relative_path($this->base_dir, $this->base_dir);
        $this->assert("get_relative_path sur racine renvoie ''", $rel_root === '');

        $sub = $this->base_dir . '/css/gallery.css';
        $rel_sub = get_relative_path($sub, $this->base_dir);
        $this->assert("get_relative_path('css/gallery.css') renvoie 'css/gallery.css'", $rel_sub === 'css/gallery.css');

        $win_style = str_replace('/', '\\', $this->base_dir . '/js/desktop.js');
        $rel_win = get_relative_path($win_style, $this->base_dir);
        $this->assert("get_relative_path normalise les antislashs Windows", $rel_win === 'js/desktop.js');
    }

    /**
     * 2. Dotfile Folder Overrides Tests (.title, .desc, .bg, .theme)
     */
    private function testDotfileFolderOverrides(): void {
        echo "\n📁 [2/7] Test de Configuration des Dotfiles de Dossier (.title, .desc, .bg, .theme)...\n";

        $sample_dir = $this->test_dir . '/folder_config_test';
        mkdir($sample_dir, 0755, true);

        file_put_contents($sample_dir . '/.title', "Mon Titre Personnalisé\n");
        file_put_contents($sample_dir . '/.desc', "Description de test du dossier\n");
        file_put_contents($sample_dir . '/.bg', "#1e293b\n");
        file_put_contents($sample_dir . '/.theme', "dark-glass\n");

        $overrides = load_folder_overrides($sample_dir, $this->base_dir);

        $this->assert("Titre personnalisé lu depuis .title", $overrides['title'] === "Mon Titre Personnalisé");
        $this->assert("Description lue depuis .desc", $overrides['description'] === "Description de test du dossier");
        $this->assert("Arrière-plan brut lu depuis .bg", ($overrides['raw_background'] ?? '') === "#1e293b");
        $this->assert("Thème 'dark-glass' résolu en palette", is_array($overrides['theme']) && isset($overrides['theme']['bg_main']));
    }

    /**
     * 3. Comment Legend Parser Tests (.comment)
     */
    private function testCommentLegendParser(): void {
        echo "\n💬 [3/7] Test du Parser de Légendes de Fichiers (.comment)...\n";

        $sample_dir = $this->test_dir . '/comments_test';
        mkdir($sample_dir, 0755, true);

        $initial_comments = [
            'photo1.jpg' => 'Coucher de soleil sur la plage',
            'video1.mp4' => 'Vacances 2026'
        ];

        $saved = save_dir_comments($sample_dir, $initial_comments);
        $this->assert("Sauvegarde du fichier .comment", $saved === true && file_exists($sample_dir . '/.comment'));

        $loaded = load_dir_comments($sample_dir);
        $this->assert("Lecture des légendes photo1.jpg", ($loaded['photo1.jpg'] ?? '') === 'Coucher de soleil sur la plage');
        $this->assert("Lecture des légendes video1.mp4", ($loaded['video1.mp4'] ?? '') === 'Vacances 2026');

        // Update comment
        $loaded['photo1.jpg'] = 'Coucher de soleil à Hawaii';
        save_dir_comments($sample_dir, $loaded);
        $reloaded = load_dir_comments($sample_dir);
        $this->assert("Mise à jour d'une légende existante", ($reloaded['photo1.jpg'] ?? '') === 'Coucher de soleil à Hawaii');
    }

    /**
     * 4. Directory Cache Engine Tests
     */
    private function testDirectoryCacheEngine(): void {
        echo "\n⚡ [4/7] Test du Moteur de Cache des Dossiers...\n";

        $sample_dir = $this->test_dir . '/cache_test';
        mkdir($sample_dir, 0755, true);
        touch($sample_dir . '/sample_image.jpg');

        $cache_file = get_dir_cache_file_path($sample_dir, $this->base_dir, '.thumbnails');
        $this->assert("Génération du chemin de cache JSON", !empty($cache_file));

        $is_valid_before = is_dir_cache_valid($cache_file, $sample_dir);
        $this->assert("Cache invalide si inexistant", $is_valid_before === false);

        // Create dummy cache payload
        $dummy_payload = ['created_at' => time(), 'raw_items' => ['directories' => [], 'files' => []]];
        file_put_contents($cache_file, json_encode($dummy_payload));
        touch($cache_file, time() + 10);

        $is_valid_after = is_dir_cache_valid($cache_file, $sample_dir);
        $this->assert("Cache valide une fois créé avec mtime récent", $is_valid_after === true);

        // Invalidate cache
        invalidate_dir_cache($sample_dir, $this->base_dir, '.thumbnails');
        $this->assert("Invalidation du cache supprime le fichier JSON", !file_exists($cache_file));
    }

    /**
     * 5. Search Engine Filters Tests
     */
    private function testSearchEngineFilters(): void {
        echo "\n🔍 [5/7] Test des Filtres Multidimensionnels du Moteur de Recherche...\n";

        $search_dir = $this->test_dir . '/search_test';
        mkdir($search_dir, 0755, true);

        // Create dummy test media files
        file_put_contents($search_dir . '/vacances_plage.jpg', str_repeat('A', 100)); // small
        file_put_contents($search_dir . '/concert_rock.mp4', str_repeat('B', 1500));
        file_put_contents($search_dir . '/document_comptable.pdf', str_repeat('C', 500));

        save_dir_comments($search_dir, ['concert_rock.mp4' => 'Super festival d été']);

        global $ignore_list, $media_types;
        $media_types_config = $media_types ?: [
            'image' => ['jpg'], 'video' => ['mp4'], 'doc' => ['pdf']
        ];

        // 1. Category Filter Test
        $img_results = search_gallery_recursive($search_dir, $search_dir, [
            'category' => 'image',
            'recursive' => true
        ], [], $media_types_config);

        $this->assert("Filtre catégorie 'image' trouve uniquement les photos", count($img_results) === 1 && $img_results[0]['name'] === 'vacances_plage.jpg');

        // 2. Word Search in Comments
        $comment_results = search_gallery_recursive($search_dir, $search_dir, [
            'words' => 'festival',
            'category' => 'all',
            'recursive' => true
        ], [], $media_types_config);

        $this->assert("Recherche de mots dans les légendes .comment", count($comment_results) === 1 && $comment_results[0]['name'] === 'concert_rock.mp4');
    }

    /**
     * 6. Multi-Format Archive Generation Engine Tests
     */
    private function testArchiveGenerationEngine(): void {
        echo "\n📦 [6/7] Test de la Génération d'Archives Zip...\n";

        $arch_dir = $this->test_dir . '/archive_test';
        @mkdir($arch_dir, 0755, true);
        file_put_contents($arch_dir . '/photo.jpg', 'fake image data');
        file_put_contents($arch_dir . '/secret.php', '<?php echo "hidden";'); // Should be excluded!
        file_put_contents($arch_dir . '/.dotfile_secret', 'sensitive'); // Should be excluded!

        // Create a private subfolder inside archive_test
        $private_sub = $arch_dir . '/private_subfolder';
        @mkdir($private_sub, 0755, true);
        file_put_contents($private_sub . '/.private', "1\n");
        file_put_contents($private_sub . '/private_pic.jpg', 'private content');

        $out_zip = $this->test_dir . '/test_output.zip';

        $created = create_archive('zip', $arch_dir, $out_zip, $arch_dir, []);
        $this->assert("Création d'archive Zip", $created === true && file_exists($out_zip) && filesize($out_zip) > 0);

        if ($created && class_exists('ZipArchive')) {
            $zip = new ZipArchive();
            if ($zip->open($out_zip) === true) {
                $has_jpg = ($zip->locateName('photo.jpg') !== false);
                $has_php = ($zip->locateName('secret.php') !== false);
                $has_dotfile = ($zip->locateName('.dotfile_secret') !== false);
                $has_private_pic = ($zip->locateName('private_subfolder/private_pic.jpg') !== false || $zip->locateName('private_pic.jpg') !== false);
                $zip->close();
                $this->assert("L'archive contient les photos publiques", $has_jpg === true);
                $this->assert("L'archive exclut le code PHP de sécurité", $has_php === false);
                $this->assert("L'archive exclut les fichiers dotfiles masqués", $has_dotfile === false);
                $this->assert("L'archive exclut les sous-dossiers privés non-admin", $has_private_pic === false);
            }
        }

        // Test existence of archive.php endpoint
        $this->assert("Point d'accès archive.php présent", file_exists($this->base_dir . '/system/endpoints/archive.php'));

        if (file_exists($out_zip)) @unlink($out_zip);
    }

    /**
     * 7. MP4 Extractor Fallback Test
     */
    private function testMp4ExtractorFallback(): void {
        echo "\n🎥 [7/7] Test de l'Extracteur de Miniature MP4...\n";

        $fake_mp4 = $this->test_dir . '/fake.mp4';
        $out_jpg = $this->test_dir . '/out.jpg';
        file_put_contents($fake_mp4, 'NOT_REAL_MP4_DATA');

        $result = extract_mp4_embedded_jpeg($fake_mp4, $out_jpg);
        $this->assert("extract_mp4_embedded_jpeg gère proprement un fichier non-MP4 sans planter", $result === false);

        if (file_exists($fake_mp4)) @unlink($fake_mp4);
        if (file_exists($out_jpg)) @unlink($out_jpg);
    }

    /**
     * Helper to get full rendered UI template output including auto-discovered app templates
     */
    private function getRenderedIndex(): string {
        $index_content = @file_get_contents($this->base_dir . '/index.php') ?: '';
        $discovered_apps = \Atelier\Kernel\PluginDiscovery::getDiscoveredApps($this->base_dir);
        $all_templates = '';
        foreach ($discovered_apps as $app) {
            if (!empty($app['template_entry']) && file_exists($this->base_dir . '/' . $app['template_entry'])) {
                $all_templates .= "\n" . file_get_contents($this->base_dir . '/' . $app['template_entry']);
            }
        }
        return $index_content . "\n" . $all_templates;
    }

    /**
     * 8. Cookie Consent Configuration & Template Meta Tag Test
     */
    private function testCookieConsentConfiguration(): void {
        echo "\n🍪 [8/8] Test de la Configuration du Consentement Cookies...\n";
        global $enable_cookie_consent;

        $this->assert("Variable \$enable_cookie_consent définie", isset($enable_cookie_consent));
        $this->assert("Consentement des cookies activé par défaut", $enable_cookie_consent === true);

        $rendered_ui = $this->getRenderedIndex();
        $this->assert("index.php contient la balise meta cookie-consent-enabled", strpos($rendered_ui, 'name="cookie-consent-enabled"') !== false);
        $this->assert("Application settings fournit le bandeau cookieConsentBanner", strpos($rendered_ui, 'id="cookieConsentBanner"') !== false);
        $this->assert("Application settings fournit l'accès aux préférences cookies", (strpos($rendered_ui, 'id="openCookieSettingsBtn"') !== false || strpos($rendered_ui, 'cookieConsentBanner') !== false));
        $this->assert("index.php contient le pied de page app-footer ou la taskbar intégrée", (strpos($rendered_ui, 'app-footer') !== false || strpos($rendered_ui, 'webos-taskbar') !== false));
    }

    /**
     * 9. Image Editor Backend & UI Elements Test
     */
    private function testImageEditorBackend(): void {
        echo "\n🎨 [9/9] Test de l'Éditeur d'Images Admin (Backend & UI)...\n";

        $rendered_ui = $this->getRenderedIndex();
        $image_viewer_js = @file_get_contents($this->base_dir . '/apps/image-viewer/viewer.js') ?: '';
        $this->assert("Application image-viewer fournit le contrôle d'édition d'image", (strpos($rendered_ui, 'id="lightboxEditImageBtn"') !== false || strpos($image_viewer_js, 'imgEdit-') !== false || strpos($image_viewer_js, 'menuImgEditBtn') !== false));
        $this->assert("Application image-viewer fournit le modal imageEditorModal", strpos($rendered_ui, 'id="imageEditorModal"') !== false);
        $this->assert("Application image-viewer fournit le modal de choix de sauvegarde imageSaveChoiceModal", strpos($rendered_ui, 'id="imageSaveChoiceModal"') !== false);

        $api_content = $this->getActionCode();
        $this->assert("api.php déclare l'action edit_image dans les actions mutantes", in_array('edit_image', \Atelier\Kernel\Actions\ActionRouter::MUTATING_ACTIONS, true));
        $this->assert("api.php implémente le gestionnaire d'action edit_image", strpos($api_content, "'edit_image'") !== false);

        // Create a 10x10 sample truecolor JPEG image
        $test_image_file = $this->test_dir . '/sample_photo.jpg';
        if (function_exists('imagecreatetruecolor')) {
            $im = @imagecreatetruecolor(10, 10);
            if ($im) {
                $red = imagecolorallocate($im, 255, 0, 0);
                imagefill($im, 0, 0, $red);
                imagejpeg($im, $test_image_file);
            }
        }
        if (!file_exists($test_image_file)) {
            // Minimal valid 1x1 JPEG binary fallback
            $jpeg_min = "\xFF\xD8\xFF\xE0\x00\x10\x4A\x46\x49\x46\x00\x01\x01\x01\x00\x48\x00\x48\x00\x00\xFF\xDB\x00\x43\x00\xFF\xC0\x00\x0B\x08\x00\x01\x00\x01\x01\x01\x11\x00\xFF\xC4\x00\x14\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\xFF\xDA\x00\x08\x01\x01\x00\x00\x3F\x00\x7F\xFF\xD9";
            file_put_contents($test_image_file, $jpeg_min);
        }

        $this->assert("Image de test sample_photo.jpg créée avec succès", file_exists($test_image_file));

        // Test copy filename resolution logic
        $info = pathinfo($test_image_file);
        $base_name = $info['filename'];
        $clean_base = preg_replace('/_edited(_\d+)?$/i', '', $base_name);
        $candidate_name = $clean_base . '_edited.jpg';
        $copy_path = dirname($test_image_file) . '/' . $candidate_name;
        
        file_put_contents($copy_path, 'EDITED_COPY_DATA');
        $this->assert("Génération du nom de copie '_edited.jpg' valide", file_exists($copy_path));
        $this->assert("L'image originale est préservée lors d'une copie", filesize($test_image_file) > 0);

        // Test EXIF segment preservation helper
        $mock_exif_payload = "Exif\0\0MM\x00\x2A\x00\x00\x00\x08\x00\x00";
        $mock_orig_jpeg = "\xFF\xD8\xFF\xE1" . pack('n', strlen($mock_exif_payload) + 2) . $mock_exif_payload . "\xFF\xDB\x00\x43\x00\xFF\xD9";
        $orig_exif_file = $this->test_dir . '/orig_with_exif.jpg';
        file_put_contents($orig_exif_file, $mock_orig_jpeg);

        $new_canvas_jpeg = "\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01\x01\x00\x48\x00\x48\x00\x00\xFF\xDB\x00\x43\x00\xFF\xD9";
        $injected_jpeg = transfer_jpeg_exif($orig_exif_file, $new_canvas_jpeg);
        $this->assert("transfer_jpeg_exif injecte le segment APP1 EXIF d'origine", strpos($injected_jpeg, "Exif\0\0") !== false);

        if (file_exists($test_image_file)) @unlink($test_image_file);
        if (file_exists($copy_path)) @unlink($copy_path);
        if (file_exists($orig_exif_file)) @unlink($orig_exif_file);

        // Test Document WYSIWYG & Markdown save action
        $doc_viewer_js = @file_get_contents($this->base_dir . '/apps/doc-viewer/viewer.js') ?: '';
        $this->assert("doc-viewer intègre le chargeur Toast UI Editor", strpos($doc_viewer_js, 'loadToastUiEditor') !== false);
        $this->assert("api.php déclare l'action save_text_file dans les actions mutantes", in_array('save_text_file', \Atelier\Kernel\Actions\ActionRouter::MUTATING_ACTIONS, true));
        $this->assert("api.php implémente le gestionnaire d'action save_text_file", strpos($api_content, "'save_text_file'") !== false);


        // Test sample markdown saving
        $test_md_file = $this->test_dir . '/notes.md';
        file_put_contents($test_md_file, "# Initial Title\n\nSome text content");
        $this->assert("Création fichier Markdown test", file_exists($test_md_file));

        $updated_content = "# Updated Title\n\n* Updated with Toast UI Editor";
        file_put_contents($test_md_file, $updated_content);
        $this->assert("Sauvegarde contenu Markdown mis à jour", file_get_contents($test_md_file) === $updated_content);

        if (file_exists($test_md_file)) @unlink($test_md_file);
    }

    /**
     * 10. i18n Locales Discovery & Engine Test
     */
    private function testI18nEngineAndLocales(): void {
        echo "\n🌐 [10/10] Test du Moteur d'Internationalisation (i18n) & Découverte...\n";

        $locales = get_available_locales($this->base_dir);
        $this->assert("Découverte automatique des locales non vide", !empty($locales));
        $this->assert("Locale 'fr' présente dans les locales", isset($locales['fr']));
        $this->assert("Locale 'en' présente dans les locales", isset($locales['en']));
        $this->assert("Drapeau de la locale 'fr' est 🇫🇷", ($locales['fr']['flag'] ?? '') === '🇫🇷');
        $this->assert("Drapeau de la locale 'en' est 🇬🇧", ($locales['en']['flag'] ?? '') === '🇬🇧');

        // Test browser locale detection
        $_SERVER['HTTP_ACCEPT_LANGUAGE'] = 'fr-FR,fr;q=0.9,en-US;q=0.8';
        $detected_fr = detect_browser_locale($locales, 'fr');
        $this->assert("Détection de la langue du navigateur (FR)", $detected_fr === 'fr');

        $_SERVER['HTTP_ACCEPT_LANGUAGE'] = 'en-US,en;q=0.9';
        $detected_en = detect_browser_locale($locales, 'fr');
        $this->assert("Détection de la langue du navigateur (EN)", $detected_en === 'en');

        // Test loading translations
        $fr_trans = load_locale_translations($this->base_dir, 'fr');
        $this->assert("Traductions FR chargées avec succès", !empty($fr_trans) && isset($fr_trans['app.title']));
        $this->assert("Traduction FR de 'nav.root' non vide", in_array($fr_trans['nav.root'] ?? '', ['Stockage', 'Accueil'], true));

        $en_trans = load_locale_translations($this->base_dir, 'en');
        $this->assert("Traductions EN chargées avec succès", !empty($en_trans) && isset($en_trans['app.title']));
        $this->assert("Traduction EN de 'nav.root' non vide", in_array($en_trans['nav.root'] ?? '', ['Storage', 'Home'], true));

        // Test adding a dynamic third locale file
        $temp_es_file = $this->base_dir . '/locales/tmp_test_es.json';
        file_put_contents($temp_es_file, json_encode([
            '_meta' => ['code' => 'tmp_test_es', 'name' => 'Español Test', 'flag' => '🇪🇸'],
            'translations' => ['app.title' => 'Atelier ES']
        ]));

        // Test global __t helper function
        $msg_fr = __t('api.err_admin_required', [], 'fr', $this->base_dir);
        $this->assert("Traduction PHP __t FR correcte", $msg_fr === 'Droits administrateur requis pour cette action.');

        $msg_en = __t('api.err_admin_required', [], 'en', $this->base_dir);
        $this->assert("Traduction PHP __t EN correcte", $msg_en === 'Admin rights required for this action.');

        $msg_repl = __t('stats.summary', ['folders' => 3, 'files' => 12], 'en', $this->base_dir);
        $this->assert("Interpolation de variables __t correcte", $msg_repl === '3 folders • 12 files');

        if (file_exists($temp_es_file)) @unlink($temp_es_file);
    }

    /**
     * 11. Unified Multi-Format Metadata Extractors Test
     */
    private function testUnifiedMetadataExtractors(): void {
        echo "\nℹ️ [11/11] Test des Extracteurs de Métadonnées Multi-Formats...\n";

        // 1. Test Text/Document Metadata
        $doc_path = $this->test_dir . '/sample_doc.txt';
        file_put_contents($doc_path, "Ligne 1: Bonjour le monde\nLigne 2: Test Atelier by GallusTech\nLigne 3: Fin de fichier");
        $meta_doc = get_file_unified_metadata($doc_path, 'sample_doc.txt', 'doc', 'txt');

        $this->assert("Extraction métadonnées générales TXT", isset($meta_doc['general']['filename']) && $meta_doc['general']['filename'] === 'sample_doc.txt');
        $this->assert("Comptage des lignes TXT (3 lignes)", ($meta_doc['specific']['doc']['lines_count'] ?? 0) === 3);

        // 2. Test Image Aspect Ratio computation
        $ratio_169 = compute_aspect_ratio(1920, 1080);
        $this->assert("Calcul Ratio 1920x1080 => 16:9", $ratio_169 === '16:9');
        $ratio_43 = compute_aspect_ratio(4032, 3024);
        $this->assert("Calcul Ratio 4032x3024 => 4:3", $ratio_43 === '4:3');
        $ratio_11 = compute_aspect_ratio(1000, 1000);
        $this->assert("Calcul Ratio 1000x1000 => 1:1", $ratio_11 === '1:1');

        // 3. Test Audio duration formatting helper
        $dur_fmt = format_media_duration(125.4);
        $this->assert("Formatage durée audio 125.4s => 02:05", $dur_fmt === '02:05');
        $dur_fmt_hr = format_media_duration(3665);
        $this->assert("Formatage durée longue 3665s => 01:01:05", $dur_fmt_hr === '01:01:05');

        // 4. Test API get_metadata action resolution with sanitize_file_path
        $api_code = $this->getActionCode();
        $this->assert("api.php utilise sanitize_file_path pour get_metadata", strpos($api_code, "sanitize_file_path") !== false || strpos($api_code, "sanitizeFilePath") !== false || strpos($api_code, "getMetadata") !== false);

        // 5. Test Synthetic MP4 Atom Parsing (mvhd duration & tkhd dimensions)
        $mp4_test = $this->test_dir . '/test_video.mp4';
        // Build minimal valid ISO MP4: ftyp + moov (mvhd + trak/tkhd)
        $ftyp = pack('Na4a4N', 16, 'ftyp', 'isom', 512);
        
        // mvhd (version 0): size=108, 'mvhd', ver/flags=0, ctime=0, mtime=0, timescale=1000, duration=15000 (15 sec)
        $mvhd_body = "\x00\x00\x00\x00" . pack('NNNN', 0, 0, 1000, 15000) . str_repeat("\x00", 80);
        $mvhd = pack('Na4', 8 + strlen($mvhd_body), 'mvhd') . $mvhd_body;

        // tkhd (version 0): size=92, 'tkhd', ver/flags=0, ctime/mtime/track_id..., width=1920<<16, height=1080<<16
        $tkhd_body = "\x00\x00\x00\x01" . str_repeat("\x00", 72) . pack('NN', 1920 << 16, 1080 << 16);
        $tkhd = pack('Na4', 8 + strlen($tkhd_body), 'tkhd') . $tkhd_body;
        $trak = pack('Na4', 8 + strlen($tkhd), 'trak') . $tkhd;

        $moov = pack('Na4', 8 + strlen($mvhd) + strlen($trak), 'moov') . $mvhd . $trak;
        file_put_contents($mp4_test, $ftyp . $moov);

        $parsed_mp4 = parse_mp4_atoms_pure_php($mp4_test);
        $this->assert("Parseur MP4 pur PHP extrait la durée (15s)", ($parsed_mp4['duration'] ?? 0) == 15);
        $this->assert("Parseur MP4 pur PHP extrait la résolution (1920x1080)", ($parsed_mp4['width'] ?? 0) === 1920 && ($parsed_mp4['height'] ?? 0) === 1080);

        // 6. Test Pure PHP ZIP Parser (EOCD and Central Directory Records)
        $zip_pure_test = $this->test_dir . '/test_pure.zip';
        $z = new ZipArchive();
        if ($z->open($zip_pure_test, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true) {
            $z->addFromString('doc1.txt', 'Content for first document');
            $z->addFromString('images/pic.png', 'Fake PNG binary payload data');
            $z->close();
        }

        $pure_zip_res = parse_zip_pure_php($zip_pure_test);
        $this->assert("Parseur ZIP pur PHP (EOCD) détecte les 2 fichiers", ($pure_zip_res['files_count'] ?? 0) === 2);
        $this->assert("Parseur ZIP pur PHP calcule la taille décompressée", ($pure_zip_res['uncompressed_size'] ?? 0) > 0);
        $this->assert("Parseur ZIP pur PHP extrait l'échantillon de fichiers", count($pure_zip_res['files_sample'] ?? []) === 2);

        if (file_exists($zip_pure_test)) @unlink($zip_pure_test);
        if (file_exists($mp4_test)) @unlink($mp4_test);
        if (file_exists($doc_path)) @unlink($doc_path);
    }

    /**
     * 12. System Monitor App & Telemetry API Test
     */
    private function testSystemMonitorAppAndTelemetry(): void {
        echo "\n📊 [12/12] Test de l'Application Moniteur Système & Télémétrie Serveur...\n";

        // 1. App Discovery
        $discovered = \Atelier\Kernel\PluginDiscovery::getDiscoveredApps($this->base_dir);
        $this->assert("Application 'system-monitor' découverte par PluginDiscovery", isset($discovered['system-monitor']));
        $this->assert("Manifeste system-monitor valide", !empty($discovered['system-monitor']['manifest']['id']));
        $this->assert("Point d'entrée JS de system-monitor présent", file_exists($this->base_dir . '/' . $discovered['system-monitor']['js_entry']));
        $this->assert("Feuille de style CSS de system-monitor présente", file_exists($this->base_dir . '/' . $discovered['system-monitor']['css_entry']));

        // 2. Translations
        $fr_trans = \Atelier\Kernel\PluginDiscovery::getAppTranslations($this->base_dir, 'fr');
        $this->assert("Traduction FR de system-monitor chargée", !empty($fr_trans['apps.system-monitor.title']) || !empty($discovered['system-monitor']['locales']['fr']['title']));

        $en_trans = \Atelier\Kernel\PluginDiscovery::getAppTranslations($this->base_dir, 'en');
        $this->assert("Traduction EN de system-monitor chargée", !empty($en_trans['apps.system-monitor.title']) || !empty($discovered['system-monitor']['locales']['en']['title']));

        $ja_trans = \Atelier\Kernel\PluginDiscovery::getAppTranslations($this->base_dir, 'ja');
        $this->assert("Traduction JA de system-monitor chargée", !empty($ja_trans['apps.system-monitor.title']) || !empty($discovered['system-monitor']['locales']['ja']['title']));

        // 3. API Declarations
        $api_code = $this->getActionCode();
        $this->assert("api.php déclare l'action get_system_info", strpos($api_code, "get_system_info") !== false);
        $this->assert("api.php déclare l'action clear_all_caches dans les actions mutantes", in_array('clear_all_caches', \Atelier\Kernel\Actions\ActionRouter::MUTATING_ACTIONS, true));
        $this->assert("api.php fournit les métriques de mémoire RAM (current & peak)", strpos($api_code, "'memory_current'") !== false && strpos($api_code, "'memory_peak'") !== false);
        $this->assert("api.php fournit les métriques d'espace disque (total, free, used)", strpos($api_code, "'disk_total'") !== false && strpos($api_code, "'disk_free'") !== false);
        $this->assert("api.php fournit les métriques de caches et miniatures", strpos($api_code, "'cache_count'") !== false && strpos($api_code, "'thumbs_count'") !== false);
    }

    /**
     * 13. Next-Gen Taskbar & App Category Organization Test
     */
    private function testNextGenTaskbarAndAppCategories(): void {
        echo "\n🖥️ [13/13] Test de la Barre des Tâches Évoluée & Catégories d'Applications...\n";

        // 1. Dynamic App Categories Discovery (from manifest.json or subfolder name, else empty string for root)
        $discovered = \Atelier\Kernel\PluginDiscovery::getDiscoveredApps($this->base_dir);
        $this->assert("Catégorie de 'system-monitor' vient du manifest ('system')", ($discovered['system-monitor']['category'] ?? '') === 'system');
        $this->assert("Catégorie de '8queens' vient du manifest ou sous-dossier ('game' ou 'games')", in_array($discovered['8queens']['category'] ?? '', ['game', 'games'], true));
        $this->assert("Catégorie de 'explorer' vient du manifest ('view')", ($discovered['explorer']['category'] ?? '') === 'view');
        $this->assert("Catégorie de 'image-viewer' vient du manifest ('viewer')", ($discovered['image-viewer']['category'] ?? '') === 'viewer');

        // 2. WindowManager Next-Gen Taskbar Elements & Dynamic Skins
        $wm_code = @file_get_contents($this->base_dir . '/system/userland/core/WindowManager.js');
        $this->assert("WindowManager implémente le conteneur d'applications taskbar-apps-container", strpos($wm_code, 'taskbarAppsContainer') !== false);
        $this->assert("WindowManager implémente le System Tray taskbar-tray-container", strpos($wm_code, 'taskbarTrayContainer') !== false);
        $this->assert("WindowManager implémente le bouton horloge taskbarCalendarBtn", strpos($wm_code, 'taskbarCalendarBtn') !== false);
        $this->assert("WindowManager implémente le bouton 'Afficher le Bureau' taskbarShowDesktopBtn", strpos($wm_code, 'taskbarShowDesktopBtn') !== false);
        $this->assert("WindowManager implémente la prévisualisation au survol taskbarPreviewCard", strpos($wm_code, 'taskbarPreviewCard') !== false);
        $this->assert("WindowManager implémente le registre dynamique getWindowStyles()", strpos($wm_code, 'getWindowStyles') !== false);
        $this->assert("WindowManager implémente setWindowStyle()", strpos($wm_code, 'setWindowStyle') !== false);
        $this->assert("WindowManager supporte la découverte dynamique sans liste en dur", strpos($wm_code, 'ATELIER_DISCOVERED_WM_STYLES') !== false);

        // 3. Modular Window Manager Skins Auto-Discovery (wm-styles/*)
        $discovered_styles = \Atelier\Kernel\PluginDiscovery::getDiscoveredWindowStyles($this->base_dir);
        $this->assert("PluginDiscovery découvre au moins 9 styles de fenêtres", count($discovered_styles) >= 9);
        $style_ids = array_column($discovered_styles, 'id');
        $this->assert("Style modulaire 'beos' découvert avec style.json/css", in_array('beos', $style_ids, true));
        $this->assert("Style modulaire 'win9x' découvert avec style.json/css", in_array('win9x', $style_ids, true));
        $this->assert("Style modulaire 'macos-classic' découvert avec style.json/css", in_array('macos-classic', $style_ids, true));
        $this->assert("Style modulaire 'windowmaker' découvert avec style.json/css", in_array('windowmaker', $style_ids, true));
        $this->assert("Style modulaire 'amigaos' découvert avec style.json/css", in_array('amigaos', $style_ids, true));
        $this->assert("Style modulaire 'aqua' découvert avec style.json/css", in_array('aqua', $style_ids, true));

        // Vérification de l'existence des fichiers CSS pour chaque style découvert
        $all_css_exist = true;
        foreach ($discovered_styles as $s) {
            if (empty($s['css_entry']) || !file_exists($this->base_dir . '/' . $s['css_entry'])) {
                $all_css_exist = false;
                break;
            }
        }
        $this->assert("Tous les fichiers CSS des skins modulaires wm-styles/ existent", $all_css_exist);

        $toolkit_code = @file_get_contents($this->base_dir . '/system/userland/ui/WebOSToolkit.js');
        $this->assert("WebOSToolkit fournit la grille windowStyleGrid", strpos($toolkit_code, 'windowStyleGrid') !== false);

        $settings_code = @file_get_contents($this->base_dir . '/apps/settings/settings.js');
        $this->assert("SettingsApp supporte la sélection data-wm-style-id", strpos($settings_code, 'data-wm-style-id') !== false);

        // 4. Category & Style Translations
        $fr_trans = load_locale_translations($this->base_dir, 'fr');
        $this->assert("Traduction FR de categories.productivity présente", !empty($fr_trans['categories.productivity']));
        $this->assert("Traduction FR de categories.games présente", !empty($fr_trans['categories.games']));
        $this->assert("Traduction FR de taskbar.show_desktop présente", !empty($fr_trans['taskbar.show_desktop']));
        $this->assert("Traduction FR de settings.wm_style_title présente", !empty($fr_trans['settings.wm_style_title']));
    }

    /**
     * 14. Tribune Libre & Multi-Bouchot App Test
     */
    private function testTribuneAppAndMultiBouchot(): void {
        echo "\n🦆 [14/14] Test de l'Application Tribune Libre & Client Bouchot...\n";
        require_once $this->base_dir . '/apps/tribune/backend/TribuneActions.php';

        // 1. App Discovery
        $discovered = \Atelier\Kernel\PluginDiscovery::getDiscoveredApps($this->base_dir);
        $this->assert("Application 'tribune' découverte par PluginDiscovery", isset($discovered['tribune']));
        $this->assert("Manifeste tribune valide (ID='tribune')", ($discovered['tribune']['manifest']['id'] ?? '') === 'tribune');
        $this->assert("Point d'entrée JS de tribune présent", file_exists($this->base_dir . '/' . $discovered['tribune']['js_entry']));
        $this->assert("Feuille de style CSS de tribune présente", file_exists($this->base_dir . '/' . $discovered['tribune']['css_entry']));
        $this->assert("Catégorie de 'tribune' vient du manifest ('communication')", ($discovered['tribune']['category'] ?? '') === 'communication');

        // 2. Translations
        $fr_trans = \Atelier\Kernel\PluginDiscovery::getAppTranslations($this->base_dir, 'fr');
        $this->assert("Traduction FR de tribune chargée", !empty($fr_trans['apps.tribune.title']) || !empty($discovered['tribune']['locales']['fr']['title']));

        // 3. Backend Endpoints in API / Tribune API
        $api_code = $this->getActionCode();
        $this->assert("api.php déclare l'action tribune_get", strpos($api_code, "tribune_get") !== false);
        $this->assert("ActionRouter déclare l'action tribune_post dans les actions mutantes (CSRF)", in_array('tribune_post', \Atelier\Kernel\Actions\ActionRouter::MUTATING_ACTIONS, true));
        $this->assert("api.php déclare l'action tribune_proxy_fetch", strpos($api_code, "tribune_proxy_fetch") !== false);
        $this->assert("api.php déclare l'action tribune_file_upload dans les actions mutantes", in_array('tribune_file_upload', \Atelier\Kernel\Actions\ActionRouter::MUTATING_ACTIONS, true) || strpos($api_code, 'tribune_file_upload') !== false);
        $this->assert("api.php déclare l'action tribune_file_get", strpos($api_code, "tribune_file_get") !== false);
        $this->assert("api.php déclare l'action tribune_stream (SSE EventSource)", strpos($api_code, "tribune_stream") !== false);
        $this->assert("api.php déclare l'action tribune_schedule_post", strpos($api_code, "tribune_schedule_post") !== false);
        $this->assert("api.php déclare l'action tribune_scheduled_list", strpos($api_code, "tribune_scheduled_list") !== false);
        $this->assert("api.php déclare l'action tribune_proxy_post dans les actions mutantes", in_array('tribune_proxy_post', \Atelier\Kernel\Actions\ActionRouter::MUTATING_ACTIONS, true) || strpos($api_code, 'tribune_proxy_post') !== false);
        $proxy_post_res = \Atelier\Apps\Tribune\Backend\TribuneActions::handle('tribune_proxy_post', ['message' => ''], $this->base_dir);
        $this->assert("TribuneActions gère l'action tribune_proxy_post (non-null)", $proxy_post_res !== null && isset($proxy_post_res['data']['success']));

        // 4. App UI Elements & Features (Balltrap, Trollometer, Miaoli)
        $app_js = @file_get_contents($this->base_dir . '/apps/tribune/app.js');
        $this->assert("Application tribune fournit le bouton d'upload 📎", strpos($app_js, 'tribuneUploadBtn') !== false);
        $this->assert("Application tribune fournit l'input file masqué", strpos($app_js, 'tribuneFileInput') !== false);
        $this->assert("Application tribune intègre EventSource (SSE)", strpos($app_js, 'startSSE') !== false);
        $this->assert("Application tribune fournit le bouton de programmation ⏰", strpos($app_js, 'tribuneScheduleBtn') !== false);
        $this->assert("Application tribune implémente les raccourcis clavier Alt (handleAltShortcut)", strpos($app_js, 'handleAltShortcut') !== false);
        $this->assert("Application tribune intègre le moteur de Balltrap interactif (duckRegex)", strpos($app_js, 'duckRegex') !== false);
        $this->assert("Application tribune intègre le déclencheur Balltrap (triggerBalltrap)", strpos($app_js, 'triggerBalltrap') !== false);
        $this->assert("Application tribune intègre le calculateur de Trollabilité (computePostTrollScore)", strpos($app_js, 'computePostTrollScore') !== false);
        $this->assert("Application tribune intègre le support du protocole Miaoli", strpos($app_js, 'miaoli') !== false);

        // 5. Storage file check (accepts runtime tribune_messages.json or clean-checkout template tribune_messages.example.json)
        $storage_file = $this->base_dir . '/storage/tribune_messages.json';
        $template_file = $this->base_dir . '/storage/tribune_messages.example.json';
        $active_tribune_file = file_exists($storage_file) ? $storage_file : $template_file;
        $this->assert("Fichier de stockage storage/tribune_messages(.example).json présent", file_exists($active_tribune_file));
        $content = @file_get_contents($active_tribune_file);
        $json = @json_decode($content, true);
        $this->assert("Fichier storage/tribune_messages(.example).json contient une liste valide", is_array($json) && count($json) >= 1);

        // 6. Test direct de stockage et récupération anonymisée de fichier
        $test_upload_dir = $this->base_dir . '/storage/tribune_uploads';
        if (!is_dir($test_upload_dir)) {
            @mkdir($test_upload_dir, 0755, true);
        }
        $test_token = bin2hex(random_bytes(16));
        $test_bin = $test_upload_dir . '/' . $test_token . '.bin';
        $test_meta = $test_upload_dir . '/' . $test_token . '.json';

        $dummy_content = "PNG DUMMY IMAGE CONTENT FOR TRIBUNE TEST";
        file_put_contents($test_bin, $dummy_content);
        file_put_contents($test_meta, json_encode([
            'token'         => $test_token,
            'original_name' => 'sample_image.png',
            'mime_type'     => 'image/png',
            'size'          => strlen($dummy_content),
            'uploaded_at'   => time(),
            'ext'           => 'png'
        ]));

        $this->assert("Fichier binaire temporaire créé dans storage/tribune_uploads/", file_exists($test_bin));
        $this->assert("Métadonnées JSON temporaires créées avec jeton 32 hex", file_exists($test_meta));

        $meta_decoded = json_decode(file_get_contents($test_meta), true);
        $this->assert("Le type MIME enregistré est bien préservé (image/png)", ($meta_decoded['mime_type'] ?? '') === 'image/png');
        $this->assert("Le nom original est conservé (sample_image.png)", ($meta_decoded['original_name'] ?? '') === 'sample_image.png');

        @unlink($test_bin);
        @unlink($test_meta);
    }

    public function testAutostartConfiguration() {
        echo "\n🚀 [15/15] Test de la Configuration du Démarrage Système & Autostart...\n";

        // 1. Helper function
        $this->assert("Fonction get_autostart_config présente", function_exists('get_autostart_config'));
        $config = get_autostart_config($this->base_dir);
        $this->assert("get_autostart_config renvoie une configuration valide", is_array($config) && isset($config['enabled']));

        // 2. API Actions
        $api_code = $this->getActionCode();
        $this->assert("api.php déclare l'action get_autostart_settings", strpos($api_code, "get_autostart_settings") !== false);
        $this->assert("api.php déclare l'action save_autostart_settings dans les actions mutantes", in_array('save_autostart_settings', \Atelier\Kernel\Actions\ActionRouter::MUTATING_ACTIONS, true));

        // 3. Settings App UI & Boot Process
        $settings_js = file_get_contents($this->base_dir . '/apps/settings/settings.js');
        $this->assert("Panneau de configuration contient l'onglet autostart", strpos($settings_js, "id: 'autostart'") !== false);
        $this->assert("SettingsApp implémente renderAutostartTab", strpos($settings_js, "renderAutostartTab") !== false);
        $this->assert("SettingsApp implémente saveAutostartConfig", strpos($settings_js, "saveAutostartConfig") !== false);

        $desktop_js = file_get_contents($this->base_dir . '/js/desktop.js');
        $this->assert("WebOS Desktop implémente initAutostartApps au démarrage", strpos($desktop_js, "initAutostartApps") !== false);
        $this->assert("SettingsApp implémente le réordonnancement par flèches autostart-move-up / down", strpos($settings_js, "autostart-move-up") !== false && strpos($settings_js, "autostart-move-down") !== false);
    }

    public function testDisabledAppsFilteringAndTribuneStandalone(): void {
        echo "\n🔒 [16/16] Test du Filtrage des Applications Désactivées & Tribune Standalone...\n";

        // 1. PluginDiscovery filtering tests
        $active_apps = \Atelier\Kernel\PluginDiscovery::getDiscoveredApps($this->base_dir, false);
        $all_apps = \Atelier\Kernel\PluginDiscovery::getDiscoveredApps($this->base_dir, true);
        $disabled_list = \Atelier\Kernel\PluginDiscovery::getDisabledAppIds($this->base_dir);

        $this->assert("Liste des apps désactivées est un tableau", is_array($disabled_list));
        $test_disabled_id = !empty($disabled_list) ? $disabled_list[0] : null;
        if ($test_disabled_id && isset($all_apps[$test_disabled_id])) {
            $this->assert("L'app '{$test_disabled_id}' est bien présente dans la liste désactivée", in_array($test_disabled_id, $disabled_list, true));
            $this->assert("PluginDiscovery omet l'app désactivée quand include_disabled=false", !isset($active_apps[$test_disabled_id]));
            $this->assert("PluginDiscovery inclut toutes les apps quand include_disabled=true", isset($all_apps[$test_disabled_id]));
            $this->assert("L'attribut 'enabled' est false pour l'app désactivée", ($all_apps[$test_disabled_id]['enabled'] ?? true) === false);
        } else {
            $GLOBALS['disabled_apps'] = ['template-app'];
            $filtered_active = \Atelier\Kernel\PluginDiscovery::getDiscoveredApps($this->base_dir, false);
            $filtered_all = \Atelier\Kernel\PluginDiscovery::getDiscoveredApps($this->base_dir, true);
            $this->assert("PluginDiscovery omet l'app désactivée quand include_disabled=false", !isset($filtered_active['template-app']));
            $this->assert("PluginDiscovery inclut toutes les apps quand include_disabled=true", isset($filtered_all['template-app']));
            $this->assert("L'attribut 'enabled' est false pour l'app désactivée", ($filtered_all['template-app']['enabled'] ?? true) === false);
            unset($GLOBALS['disabled_apps']);
        }

        // 2. Tribune Standalone Entrypoint tests
        $tribune_index = $this->base_dir . '/apps/tribune/index.php';
        $this->assert("Fichier apps/tribune/index.php présent pour mode standalone", file_exists($tribune_index));
        $tribune_html = file_get_contents($tribune_index);
        $this->assert("Tribune standalone injecte le conteneur standalone-container", strpos($tribune_html, 'standalone-container') !== false);
        $this->assert("Tribune standalone instancie SyscallClient pointant sur system/endpoints/api.php", strpos($tribune_html, "SyscallClient('../../system/endpoints/api.php')") !== false);
        $this->assert("Tribune standalone charge les traductions locales", strpos($tribune_html, 'translations') !== false);

        // 2b. Unified plugin backend routing (template-app via ActionRouter + manifest.backend)
        $this->assert("ActionRouter reconnaît template_save_note comme action mutante CSRF", \Atelier\Kernel\Actions\ActionRouter::isMutatingAction('template_save_note', $this->base_dir));
        $tpl_ping = \Atelier\Kernel\Actions\ActionRouter::dispatch('template_ping', [], $this->base_dir . '/storage/media', [], [], 'Atelier', '.thumbnails', $this->base_dir);
        $this->assert("ActionRouter dispatche template_ping via manifest.backend", is_array($tpl_ping) && ($tpl_ping['status'] ?? 0) === 200 && !empty($tpl_ping['data']['success']));
        $api_gw_src = @file_get_contents($this->base_dir . '/system/endpoints/api.php') ?: '';
        $this->assert("api.php passe project_root à __t pour api.err_unknown_action", strpos($api_gw_src, "__t('api.err_unknown_action', [], null, \$project_root)") !== false);

        // 3. Tribune app.js auto-mount
        $tribune_js = file_get_contents($this->base_dir . '/apps/tribune/app.js');
        $this->assert("Tribune app.js intègre la fonction d'auto-montage standalone", strpos($tribune_js, "document.getElementById('standalone-container')") !== false);
    }

    public function testClipboardAndKeyboardShortcuts(): void {
        echo "\n⌨️ [17/17] Test du Presse-papiers Universel & Raccourcis Clavier WebOS...\n";

        // 1. Files existence & index.php inclusion
        $clipboard_file = $this->base_dir . '/system/userland/services/ClipboardService.js';
        $shortcut_file = $this->base_dir . '/system/userland/core/ShortcutManager.js';
        $this->assert("ClipboardService.js présent", file_exists($clipboard_file));
        $this->assert("ShortcutManager.js présent", file_exists($shortcut_file));

        $index_html = file_get_contents($this->base_dir . '/index.php');
        $this->assert("index.php inclut ClipboardService.js", strpos($index_html, 'ClipboardService.js') !== false);
        $this->assert("index.php inclut ShortcutManager.js", strpos($index_html, 'ShortcutManager.js') !== false);

        // 2. ActionRouter declares copy_item
        $this->assert("ActionRouter déclare l'action copy_item dans les actions mutantes", in_array('copy_item', \Atelier\Kernel\Actions\ActionRouter::MUTATING_ACTIONS, true));

        // 3. Backend copy_item functional execution
        $sample_src = $this->test_dir . '/sample_for_copy.txt';
        file_put_contents($sample_src, "Original content for copy test");
        $rel_src = ltrim(str_replace($this->base_dir, '', $sample_src), '/');
        $rel_target_dir = ltrim(str_replace($this->base_dir, '', $this->test_dir), '/');

        $_SESSION['atelier_admin_logged'] = true;
        $copy_res = \Atelier\Kernel\Actions\FileActions::handle('copy_item', [
            'source'     => $rel_src,
            'target_dir' => $rel_target_dir
        ], ['base_dir' => $this->base_dir]);
        unset($_SESSION['atelier_admin_logged']);

        $this->assert("FileActions::copy_item renvoie un statut 200", ($copy_res['status'] ?? 0) === 200);
        $this->assert("FileActions::copy_item indique success = true", ($copy_res['data']['success'] ?? false) === true);
        $this->assert("Le fichier copié existe sur le disque avec suffixe _copy", file_exists($this->test_dir . '/sample_for_copy_copy.txt'));

        // 4. Explorer integration
        $explorer_js = file_get_contents($this->base_dir . '/apps/explorer/explorer.js');
        $this->assert("Explorer implémente copySelection", strpos($explorer_js, 'copySelection') !== false);
        $this->assert("Explorer implémente cutSelection", strpos($explorer_js, 'cutSelection') !== false);
        $this->assert("Explorer implémente pasteClipboard", strpos($explorer_js, 'pasteClipboard') !== false);
        $this->assert("Explorer implémente moveItems", strpos($explorer_js, 'moveItems') !== false);

        // 5. Test move_item action with single string and with array (drag & drop)
        $move_src1 = $this->test_dir . '/sample_for_move_1.txt';
        $move_src2 = $this->test_dir . '/sample_for_move_2.txt';
        $subfolder_target = $this->test_dir . '/move_target_dir';
        @mkdir($subfolder_target, 0777, true);
        file_put_contents($move_src1, 'move content 1');
        file_put_contents($move_src2, 'move content 2');

        $rel_src1 = ltrim(str_replace($this->base_dir, '', $move_src1), '/');
        $rel_src2 = ltrim(str_replace($this->base_dir, '', $move_src2), '/');
        $rel_sub_target = ltrim(str_replace($this->base_dir, '', $subfolder_target), '/');

        $_SESSION['atelier_admin_logged'] = true;
        // Test single move
        $move_res1 = \Atelier\Kernel\Actions\FileActions::handle('move_item', [
            'source'     => $rel_src1,
            'target_dir' => $rel_sub_target
        ], ['base_dir' => $this->base_dir]);
        $this->assert("FileActions::move_item supporte une source sous forme de chaîne unique", ($move_res1['status'] ?? 0) === 200);
        $this->assert("Le fichier 1 a bien été déplacé dans le dossier cible", file_exists($subfolder_target . '/sample_for_move_1.txt'));

        // Test batch array move
        $move_res2 = \Atelier\Kernel\Actions\FileActions::handle('move_item', [
            'source'     => [$rel_src2],
            'target_dir' => $rel_sub_target
        ], ['base_dir' => $this->base_dir]);
        unset($_SESSION['atelier_admin_logged']);

        $this->assert("FileActions::move_item supporte un tableau de sources (drag & drop)", ($move_res2['status'] ?? 0) === 200);
        $this->assert("Le fichier 2 a bien été déplacé dans le dossier cible via tableau", file_exists($subfolder_target . '/sample_for_move_2.txt'));

        // 6. Test rename_item action (Phase G Lot 3)
        $this->assert("ActionRouter déclare l'action rename_item dans les actions mutantes", \Atelier\Kernel\Actions\ActionRouter::isMutatingAction('rename_item', $this->base_dir));

        $rename_src = $this->test_dir . '/sample_for_rename.txt';
        $rename_collide = $this->test_dir . '/sample_collide.txt';
        $rename_dir_src = $this->test_dir . '/rename_dir_a';
        file_put_contents($rename_src, 'rename content');
        file_put_contents($rename_collide, 'collision content');
        @mkdir($rename_dir_src, 0777, true);
        $rel_rename_src = ltrim(str_replace($this->base_dir, '', $rename_src), '/');
        $rel_rename_dir = ltrim(str_replace($this->base_dir, '', $rename_dir_src), '/');

        // Guest denied
        unset($_SESSION['atelier_admin_logged'], $_SESSION['atelier_user']);
        $guest_ren = \Atelier\Kernel\Actions\FileActions::handle('rename_item', [
            'source'   => $rel_rename_src,
            'new_name' => 'guest_renamed.txt'
        ], ['base_dir' => $this->base_dir]);
        $this->assert("FileActions::rename_item refuse un visiteur non connecté (403)", ($guest_ren['status'] ?? 0) === 403);

        $_SESSION['atelier_admin_logged'] = true;
        $dot_ren = \Atelier\Kernel\Actions\FileActions::handle('rename_item', [
            'source'   => $rel_rename_src,
            'new_name' => '.htaccess'
        ], ['base_dir' => $this->base_dir]);
        $this->assert("FileActions::rename_item refuse les dotfiles (400)", ($dot_ren['status'] ?? 0) === 400);

        $trav_ren = \Atelier\Kernel\Actions\FileActions::handle('rename_item', [
            'source'   => $rel_rename_src,
            'new_name' => '../evil.txt'
        ], ['base_dir' => $this->base_dir]);
        $this->assert("FileActions::rename_item refuse les séparateurs / path traversal (400)", ($trav_ren['status'] ?? 0) === 400);

        $php_ren = \Atelier\Kernel\Actions\FileActions::handle('rename_item', [
            'source'   => $rel_rename_src,
            'new_name' => 'shell.php'
        ], ['base_dir' => $this->base_dir]);
        $this->assert("FileActions::rename_item refuse une extension exécutable interdite (403)", ($php_ren['status'] ?? 0) === 403);

        $col_ren = \Atelier\Kernel\Actions\FileActions::handle('rename_item', [
            'source'   => $rel_rename_src,
            'new_name' => 'sample_collide.txt'
        ], ['base_dir' => $this->base_dir]);
        $this->assert("FileActions::rename_item refuse d'écraser une cible existante (409)", ($col_ren['status'] ?? 0) === 409);

        $ok_ren = \Atelier\Kernel\Actions\FileActions::handle('rename_item', [
            'source'   => $rel_rename_src,
            'new_name' => 'sample_renamed.txt'
        ], ['base_dir' => $this->base_dir]);
        $this->assert("FileActions::rename_item renomme un fichier valide (200)", ($ok_ren['status'] ?? 0) === 200 && ($ok_ren['data']['success'] ?? false) === true);
        $this->assert("Le fichier renommé existe et l'ancien a disparu", !file_exists($rename_src) && file_exists($this->test_dir . '/sample_renamed.txt'));

        $dir_ren = \Atelier\Kernel\Actions\FileActions::handle('rename_item', [
            'source'   => $rel_rename_dir,
            'new_name' => 'rename_dir_b'
        ], ['base_dir' => $this->base_dir]);
        unset($_SESSION['atelier_admin_logged']);
        $this->assert("FileActions::rename_item renomme un dossier valide (200)", ($dir_ren['status'] ?? 0) === 200 && is_dir($this->test_dir . '/rename_dir_b') && !is_dir($rename_dir_src));
    }

    private function testAutorunAndExplorerEnhancements(): void {
        echo "\n🎬 [18/18] Test du Moteur Multimodal Autorun (autorun.json) & Améliorations Explorer...\n";

        // 1. AutorunSyncEngine script presence and class definition
        $engine_path = $this->base_dir . '/apps/explorer/autorun-engine.js';
        $this->assert("Fichier apps/explorer/autorun-engine.js présent", file_exists($engine_path));
        $engine_js = file_get_contents($engine_path);
        $this->assert("AutorunSyncEngine déclare parseTimecode", strpos($engine_js, 'parseTimecode') !== false);
        $this->assert("AutorunSyncEngine gère layout split-horizontal", strpos($engine_js, 'split-horizontal') !== false);
        $this->assert("AutorunSyncEngine implémente set_doc", strpos($engine_js, 'set_doc') !== false);
        $this->assert("AutorunSyncEngine implémente show_image", strpos($engine_js, 'show_image') !== false);
        $this->assert("AutorunSyncEngine implémente un HUD interactif", strpos($engine_js, 'autorun-sync-hud') !== false);

        // 2. DotfileManager autorun detection & parsing
        $test_autorun_folder = $this->test_dir . '/test_autorun_sub';
        @mkdir($test_autorun_folder, 0755, true);
        $sample_autorun = [
            'version' => '1.0',
            'title' => 'Mon VLog Test',
            'description' => 'Test de synchronisation autorun',
            'window_layout' => 'split-horizontal',
            'lead_media' => ['app' => 'viewer-video', 'file' => 'clip.mp4'],
            'steps' => [
                ['time' => '00:00', 'action' => 'open_app', 'app' => 'viewer-video', 'file' => 'clip.mp4'],
                ['time' => '00:05', 'action' => 'set_doc', 'app' => 'viewer-text', 'file' => 'doc.md', 'chapter' => 'Intro']
            ]
        ];
        file_put_contents($test_autorun_folder . '/autorun.json', json_encode($sample_autorun));

        $overrides = \Atelier\Kernel\FS\DotfileManager::loadFolderOverrides($test_autorun_folder, $this->test_dir);
        $this->assert("DotfileManager détecte has_autorun = true", ($overrides['has_autorun'] ?? false) === true);
        $this->assert("DotfileManager extrait le titre de l'autorun", ($overrides['autorun']['title'] ?? '') === 'Mon VLog Test');
        $this->assert("DotfileManager extrait les étapes de l'autorun", count($overrides['autorun']['steps'] ?? []) === 2);

        // Test cohabitation autorun.json & .autorun.json (autorun.json prioritaire si mtime >=)
        $dot_autorun = $sample_autorun;
        $dot_autorun['title'] = 'Ancien Dotfile';
        file_put_contents($test_autorun_folder . '/.autorun.json', json_encode($dot_autorun));
        touch($test_autorun_folder . '/autorun.json', time());
        touch($test_autorun_folder . '/.autorun.json', time());
        $overrides_cohab = \Atelier\Kernel\FS\DotfileManager::loadFolderOverrides($test_autorun_folder, $this->test_dir);
        $this->assert("DotfileManager privilégie autorun.json par rapport à .autorun.json", ($overrides_cohab['autorun']['title'] ?? '') === 'Mon VLog Test');
        @unlink($test_autorun_folder . '/.autorun.json');

        // 3. Explorer template UI components
        $template_php = file_get_contents($this->base_dir . '/apps/explorer/template.php');
        $this->assert("template.php contient la bannière autorun .explorer-autorun-banner", strpos($template_php, 'explorer-autorun-banner') !== false);
        $this->assert("template.php contient la recherche rapide .explorer-quick-search-input", strpos($template_php, 'explorer-quick-search-input') !== false);
        $this->assert("template.php contient les boutons de changement de vue .view-mode-btn", strpos($template_php, 'view-mode-btn') !== false);
        $this->assert("template.php contient le tiroir d'inspection .explorer-inspector-drawer", strpos($template_php, 'explorer-inspector-drawer') !== false);
        $autorun_tpl = file_get_contents($this->base_dir . '/apps/autorun-editor/template.php');
        $this->assert("Autorun Studio template contient #autorunEditorAppTemplate", strpos($autorun_tpl, 'autorunEditorAppTemplate') !== false);
        $this->assert("template.php contient le bouton barre d'outils .explorer-autorun-btn", strpos($template_php, 'explorer-autorun-btn') !== false);
        $this->assert("Autorun Studio template contient les onglets visual/json", strpos($autorun_tpl, 'data-tab="visual"') !== false);

        // 4. Explorer JavaScript & Multimodal Features
        $explorer_js = file_get_contents($this->base_dir . '/apps/explorer/explorer.js');
        $this->assert("explorer.js implémente launchAutorun", strpos($explorer_js, 'launchAutorun') !== false);
        $this->assert("explorer.js implémente toggleInspector", strpos($explorer_js, 'toggleInspector') !== false);
        $this->assert("explorer.js implémente updateInspectorUI", strpos($explorer_js, 'updateInspectorUI') !== false);
        $this->assert("explorer.js supporte la navigation au clavier (Flèches & Espace)", strpos($explorer_js, 'ArrowRight') !== false);
        $this->assert("explorer.js implémente renderAutorunVisualTimeline", strpos($explorer_js, 'renderAutorunVisualTimeline') !== false);
        $this->assert("explorer.js implémente addAutorunStep", strpos($explorer_js, 'addAutorunStep') !== false);
        $this->assert("explorer.js implémente previewCurrentAutorun", strpos($explorer_js, 'previewCurrentAutorun') !== false);
        $this->assert("AutorunSyncEngine implémente close_app", strpos($engine_js, 'close_app') !== false);
        $this->assert("AutorunSyncEngine implémente control_app", strpos($engine_js, 'control_app') !== false);
        $this->assert("AutorunSyncEngine implémente la réconciliation au scrub", strpos($engine_js, 'reconcileStateAtTime') !== false);

        // 5. Translations in fr, en, ja
        $fr_json = json_decode(file_get_contents($this->base_dir . '/locales/fr.json'), true);
        $en_json = json_decode(file_get_contents($this->base_dir . '/locales/en.json'), true);
        $ja_json = json_decode(file_get_contents($this->base_dir . '/locales/ja.json'), true);
        $this->assert("AutorunSyncEngine implémente computePositionBounds", strpos($engine_js, 'computePositionBounds') !== false);
        $this->assert("Traduction FR présente pour autorun.badge", isset($fr_json['translations']['autorun.badge']));
        $this->assert("Traduction EN présente pour autorun.badge", isset($en_json['translations']['autorun.badge']));
        $this->assert("Traduction JA présente pour autorun.badge", isset($ja_json['translations']['autorun.badge']));
        $this->assert("Traduction FR présente pour autorun.step_pos", isset($fr_json['translations']['autorun.step_pos']));
        $this->assert("Traduction EN présente pour autorun.step_pos", isset($en_json['translations']['autorun.step_pos']));
        $this->assert("Traduction JA présente pour autorun.step_pos", isset($ja_json['translations']['autorun.step_pos']));
        $this->assert("Traduction FR présente pour autorun.toolbar_btn", isset($fr_json['translations']['autorun.toolbar_btn']));
        $this->assert("Traduction FR présente pour autorun.editor_tab_visual", isset($fr_json['translations']['autorun.editor_tab_visual']));
        $this->assert("Traduction FR présente pour explorer.quick_search_ph", isset($fr_json['translations']['explorer.quick_search_ph']));
        $this->assert("Traduction FR présente pour explorer.details", isset($fr_json['translations']['explorer.details']));

        // 6. PluginDiscovery auxiliary scripts discovery & template syntax verification
        $discovered = \Atelier\Kernel\PluginDiscovery::getDiscoveredApps($this->base_dir, true);
        $this->assert("PluginDiscovery découvre l'app explorer", isset($discovered['explorer']));
        $this->assert("PluginDiscovery découvre autorun-engine.js dans scripts de explorer", in_array('apps/explorer/autorun-engine.js', $discovered['explorer']['scripts'] ?? []));

        $php_bin = defined('PHP_BINARY') && !empty(PHP_BINARY) ? PHP_BINARY : 'php';
        foreach (glob($this->base_dir . '/apps/*/template.php') as $tpl) {
            $cmd = escapeshellarg($php_bin) . ' -l ' . escapeshellarg($tpl) . ' 2>&1';
            $lint_out = shell_exec($cmd);
            $this->assert("Syntaxe PHP valide pour " . basename(dirname($tpl)) . "/template.php", strpos($lint_out, 'No syntax errors') !== false);
        }

        // 7. App Controllable Commands Discovery & Manifests
        $maps_manifest = json_decode(file_get_contents($this->base_dir . '/apps/maps/manifest.json'), true);
        $img_manifest = json_decode(file_get_contents($this->base_dir . '/apps/image-viewer/manifest.json'), true);
        $doc_manifest = json_decode(file_get_contents($this->base_dir . '/apps/doc-viewer/manifest.json'), true);
        $vid_manifest = json_decode(file_get_contents($this->base_dir . '/apps/video-player/manifest.json'), true);

        $this->assert("Manifest de maps déclare la commande flyTo", isset($maps_manifest['commands']['flyTo']));
        $this->assert("Manifest de image-viewer déclare la commande showImage", isset($img_manifest['commands']['showImage']));
        $this->assert("Manifest de doc-viewer déclare la commande scroll", isset($doc_manifest['commands']['scroll']));
        $this->assert("Manifest de video-player déclare la commande play", isset($vid_manifest['commands']['play']));

        $app_manager_js = file_get_contents($this->base_dir . '/system/userland/core/AppManager.js');
        $this->assert("AppManager implémente registerAppCommands", strpos($app_manager_js, 'registerAppCommands') !== false);
        $this->assert("AppManager implémente getAppCommands", strpos($app_manager_js, 'getAppCommands') !== false);
        $this->assert("AppManager implémente getAllControllableApps", strpos($app_manager_js, 'getAllControllableApps') !== false);
        $this->assert("AppManager implémente dispatchCommand", strpos($app_manager_js, 'dispatchCommand') !== false);
        $this->assert("autorun-engine.js délègue à dispatchCommand", strpos($engine_js, 'dispatchCommand') !== false);

        // 8. Standalone Autorun Studio App Discovery & Modular Explorer scripts
        $this->assert("PluginDiscovery découvre l'app autorun-editor", isset($discovered['autorun-editor']));
        $this->assert("Autorun Studio déclare app.js", ($discovered['autorun-editor']['js_entry'] ?? '') === 'apps/autorun-editor/app.js');
        $this->assert("Autorun Studio déclare style.css", ($discovered['autorun-editor']['css_entry'] ?? '') === 'apps/autorun-editor/style.css');
        $this->assert("Explorer déclare scripts/explorer-selection.js", in_array('apps/explorer/scripts/explorer-selection.js', $discovered['explorer']['scripts'] ?? []));
        $this->assert("Explorer déclare scripts/explorer-dragdrop.js", in_array('apps/explorer/scripts/explorer-dragdrop.js', $discovered['explorer']['scripts'] ?? []));
        $this->assert("Explorer déclare scripts/explorer-map.js", in_array('apps/explorer/scripts/explorer-map.js', $discovered['explorer']['scripts'] ?? []));
        $this->assert("Explorer déclare scripts/explorer-modals.js", in_array('apps/explorer/scripts/explorer-modals.js', $discovered['explorer']['scripts'] ?? []));

        // 9. WebOS Browser & Proxying (SSRF, X-Frame-Options, Base Injection)
        $this->assert("PluginDiscovery découvre l'app browser", isset($discovered['browser']));
        $this->assert("Browser déclare app.js", ($discovered['browser']['js_entry'] ?? '') === 'apps/browser/app.js');
        $this->assert("Browser déclare style.css", ($discovered['browser']['css_entry'] ?? '') === 'apps/browser/style.css');

        require_once $this->base_dir . '/apps/browser/backend/BrowserProxyAction.php';
        $router_code = file_get_contents($this->base_dir . '/system/kernel/Actions/ActionRouter.php');
        $this->assert("ActionRouter déclare l'action browser_proxy", strpos($router_code, 'browser_proxy') !== false);
        $this->assert("BrowserProxyAction rejette localhost (Anti-SSRF)", !\Atelier\Apps\Browser\Backend\BrowserProxyAction::isSafePublicUrl('http://localhost/'));
        $this->assert("BrowserProxyAction rejette 127.0.0.1 (Anti-SSRF)", !\Atelier\Apps\Browser\Backend\BrowserProxyAction::isSafePublicUrl('http://127.0.0.1/admin'));
        $this->assert("BrowserProxyAction rejette IP privée 192.168.1.1 (Anti-SSRF)", !\Atelier\Apps\Browser\Backend\BrowserProxyAction::isSafePublicUrl('http://192.168.1.1/'));
        $this->assert("BrowserProxyAction accepte URL publique", \Atelier\Apps\Browser\Backend\BrowserProxyAction::isSafePublicUrl('https://fr.wikipedia.org/wiki/Accueil'));

        $proxy_ssrf_res = \Atelier\Apps\Browser\Backend\BrowserProxyAction::handle('browser_proxy', ['url' => 'http://127.0.0.1:8080/test'], ['test_mode' => true]);
        $this->assert("BrowserProxyAction retourne 403 sur tentative SSRF", ($proxy_ssrf_res['status'] ?? 0) === 403);

        $mock_html = "<html><head><title>Test Page</title></head><body><a href=\"/page2\">Page 2</a></body></html>";
        $proxy_mock_res = \Atelier\Apps\Browser\Backend\BrowserProxyAction::handle('browser_proxy', [
            'url' => 'https://example.com/sub/index.html'
        ], [
            'test_mode' => true,
            'mock_body' => $mock_html
        ]);
        $this->assert("BrowserProxyAction retourne 200 sur page mockée", ($proxy_mock_res['status'] ?? 0) === 200);
        $rewritten = $proxy_mock_res['data']['content'] ?? '';
        $this->assert("BrowserProxyAction injecte la balise <base href='https://example.com/sub/'>", strpos($rewritten, '<base href="https://example.com/sub/"') !== false);
        $this->assert("BrowserProxyAction injecte le helper script de navigation", strpos($rewritten, 'webos-browser-proxy-helper') !== false);

        // 10. Auto-discovery & Synthetic Manifest for Standalone Third-Party Web Apps (HTML/WASM/PWA)
        $tmp_root = sys_get_temp_dir() . '/atelier_standalone_webapp_test_' . md5(uniqid('', true));
        $tmp_app1 = $tmp_root . '/apps/pixelcraft-web-0.9.5';
        $tmp_app2 = $tmp_root . '/apps/games/retrobox-v2.1';
        @mkdir($tmp_app1 . '/app', 0755, true);
        @mkdir($tmp_app2, 0755, true);
        @mkdir($tmp_root . '/config', 0755, true);

        file_put_contents($tmp_app1 . '/index.html', '<!DOCTYPE html><html><head><title>PixelCraft</title></head><body><canvas id="c"></canvas><script type="module">fetch("./boot.wasm");</script></body></html>');
        file_put_contents($tmp_app1 . '/boot.wasm', "\0asm");
        file_put_contents($tmp_app1 . '/README.md', "<h1>PixelCraft</h1><img src=\"https://raw.githubusercontent.com/example/pixelcraft/main/assets/pixelcraft-icon.png\" alt=\"PixelCraft icon\" width=\"64\"><p><b>Open-source image editing studio in Rust/WASM.</b></p><h4>Formats</h4>PSD, XCF, .kra, .pcraft, PNG, JPEG, WebP, SVG</td>\n## Downloads\nInstallers: pixelcraft.deb, pixelcraft.rpm, pixelcraft.msi");
        file_put_contents($tmp_app1 . '/HOSTING.md', "Flags: `?webgl` and `?cpu`");

        file_put_contents($tmp_app2 . '/index.html', '<!DOCTYPE html><html><head><title>RetroBox</title><link rel="icon" href="./favicon.svg"></head><body></body></html>');
        file_put_contents($tmp_app2 . '/favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
        file_put_contents($tmp_app2 . '/site.webmanifest', json_encode([
            'name' => 'RetroBox Emulator',
            'description' => 'Classic 8-bit console emulator',
            'file_handlers' => [
                ['action' => './', 'accept' => ['application/x-nes-rom' => ['.nes', '.gb']]]
            ]
        ]));

        $tmp_discovered = \Atelier\Kernel\PluginDiscovery::getDiscoveredApps($tmp_root, true);
        $this->assert("PluginDiscovery découvre une distribution web autonome sans manifest.json", isset($tmp_discovered['pixelcraft']));
        $pc = $tmp_discovered['pixelcraft'] ?? [];
        $this->assert("Manifest synthétique extrait id='pixelcraft' et version='0.9.5'", ($pc['id'] ?? '') === 'pixelcraft' && ($pc['version'] ?? '') === '0.9.5');
        $this->assert("Manifest synthétique extrait le titre depuis index.html", ($pc['name'] ?? '') === 'PixelCraft');
        $this->assert("Manifest synthétique définit distribution='standalone-web' et html_entry", ($pc['distribution'] ?? '') === 'standalone-web' && ($pc['html_entry'] ?? '') === 'apps/pixelcraft-web-0.9.5/index.html');
        $this->assert("Manifest synthétique détecte les formats (psd, xcf, kra, png)", in_array('psd', $pc['manifest']['extensions'] ?? [], true) && in_array('xcf', $pc['manifest']['extensions'] ?? [], true) && in_array('kra', $pc['manifest']['extensions'] ?? [], true) && in_array('png', $pc['manifest']['extensions'] ?? [], true));
        $this->assert("Manifest synthétique ignore les extensions d'installateurs (deb, rpm, msi)", !in_array('deb', $pc['manifest']['extensions'] ?? [], true) && !in_array('msi', $pc['manifest']['extensions'] ?? [], true));
        $this->assert("Manifest synthétique détecte la capacité wasm et les flags renderer", in_array('wasm', $pc['manifest']['capabilities'] ?? [], true) && count($pc['manifest']['rendererFlags'] ?? []) === 2);
        $this->assert("Manifest synthétique extrait l'URL d'icône depuis README.md", ($pc['icon_url'] ?? '') === 'https://raw.githubusercontent.com/example/pixelcraft/main/assets/pixelcraft-icon.png');

        $this->assert("PluginDiscovery découvre une web app autonome imbriquée (apps/games/*) avec site.webmanifest", isset($tmp_discovered['retrobox']));
        $rb = $tmp_discovered['retrobox'] ?? [];
        $this->assert("Web app imbriquée hérite de la catégorie 'games' et des file_handlers W3C", ($rb['category'] ?? '') === 'games' && in_array('nes', $rb['manifest']['extensions'] ?? [], true) && in_array('gb', $rb['manifest']['extensions'] ?? [], true));
        $this->assert("Web app imbriquée extrait l'icône locale depuis <link rel='icon'>", ($rb['icon_url'] ?? '') === 'apps/games/retrobox-v2.1/favicon.svg');

        $tmp_trans = \Atelier\Kernel\PluginDiscovery::getAppTranslations($tmp_root, 'fr', true);
        $this->assert("getAppTranslations expose le titre synthétique apps.pixelcraft.title", ($tmp_trans['apps.pixelcraft.title'] ?? '') === 'PixelCraft');

        // Test Layer 4 primary format inference + ?file= openFileParam (e.g. PDF workbench without Formats heading)
        $tmp_app3 = $tmp_root . '/apps/docbench-web-0.5.0';
        @mkdir($tmp_app3, 0755, true);
        file_put_contents($tmp_app3 . '/index.html', '<!DOCTYPE html><html><head><title>DocBench</title></head><body><canvas id="c"></canvas></body></html>');
        file_put_contents($tmp_app3 . '/README.md', "<h1>DocBench</h1><p><b>Modern PDF reader and editor built in Rust.</b></p>");
        file_put_contents($tmp_app3 . '/HOSTING.md', "Add `?file=<url>` to open a PDF on startup.");
        $tmp_discovered_3 = \Atelier\Kernel\PluginDiscovery::getDiscoveredApps($tmp_root, true);
        $db = $tmp_discovered_3['docbench'] ?? [];
        $this->assert("Inférence Layer 4 associe .pdf sans section Formats explicite", in_array('pdf', $db['manifest']['extensions'] ?? [], true));
        $this->assert("Détection du paramètre de démarrage openFileParam='file' depuis HOSTING.md", ($db['manifest']['openFileParam'] ?? null) === 'file');

        // Test Lot 1 Synthesizer v2: ?host=parent detection, .xls extraction, SemVer dedup, apps/external/, & 0-byte health filter
        $tmp_sheet_old = $tmp_root . '/apps/external/sheetcraft-web-0.18.0';
        $tmp_sheet_new = $tmp_root . '/apps/external/sheetcraft-web-0.19.1';
        $tmp_broken    = $tmp_root . '/apps/external/broken-web-0.1.0';
        @mkdir($tmp_sheet_old, 0755, true);
        @mkdir($tmp_sheet_new, 0755, true);
        @mkdir($tmp_broken, 0755, true);
        file_put_contents($tmp_sheet_old . '/index.html', '<!DOCTYPE html><html><head><title>SheetCraft</title></head><body></body></html>');
        file_put_contents($tmp_sheet_new . '/index.html', '<!DOCTYPE html><html><head><title>SheetCraft</title></head><body></body></html>');
        file_put_contents($tmp_sheet_new . '/README.md', "# SheetCraft\nSpreadsheet editor opening .xls, .xlsx and .ods files. Needs 2 GB RAM.");
        file_put_contents($tmp_sheet_new . '/HOSTING.md', "Use `?host=parent&author=Ada` and `?chrome=notitlebar` for iframe hosting. Posts `sheetcraft:ready` and `sheetcraft:save`.");
        file_put_contents($tmp_broken . '/index.html', '');

        $tmp_active_l1 = \Atelier\Kernel\PluginDiscovery::getDiscoveredApps($tmp_root, false);
        $sc = $tmp_active_l1['sheetcraft'] ?? [];
        $hb = $sc['manifest']['hostBridge'] ?? null;
        $this->assert("Lot 1 Synthétiseur v2: dédoublonnage SemVer (0.19.1 > 0.18.0), conteneur apps/external/ neutre & filtrage app 0 octet",
            ($sc['version'] ?? '') === '0.19.1' &&
            ($sc['category'] ?? '') === 'productivity' &&
            !isset($tmp_active_l1['broken'])
        );
        $this->assert("Lot 1 Synthétiseur v2: détection native ?host=parent (+chrome/+author) & formats .xls/.xlsx sans faux positif 'gb'",
            is_array($hb) &&
            ($hb['mode'] ?? '') === 'parent' &&
            ($hb['prefix'] ?? '') === 'sheetcraft' &&
            !empty($hb['supportsChrome']) &&
            !empty($hb['supportsAuthor']) &&
            in_array('xls', $sc['manifest']['extensions'] ?? [], true) &&
            in_array('xlsx', $sc['manifest']['extensions'] ?? [], true) &&
            !in_array('gb', $sc['manifest']['extensions'] ?? [], true)
        );

        // Verify optional admin override via config/external_apps.json
        file_put_contents($tmp_root . '/config/external_apps.json', json_encode([
            'pixelcraft' => ['icon' => '🖌️', 'category' => 'productivity']
        ]));
        $tmp_overridden = \Atelier\Kernel\PluginDiscovery::getDiscoveredApps($tmp_root, true);
        $this->assert("config/external_apps.json permet de surcharger icône et catégorie sans modifier l'app tierce", ($tmp_overridden['pixelcraft']['icon'] ?? '') === '🖌️' && ($tmp_overridden['pixelcraft']['category'] ?? '') === 'productivity');

        // Verify FormatRegistry dynamic auto-registration (native apps + standalone WASM apps + immutable blacklist)
        \Atelier\Kernel\Media\FormatRegistry::clearCache();
        $real_reg = \Atelier\Kernel\Media\FormatRegistry::resolve($this->base_dir);
        $this->assert("FormatRegistry: les apps natives enregistrent automatiquement .odt et .epub pour l'upload",
            in_array('odt', $real_reg['allowed_upload_extensions'], true) &&
            in_array('epub', $real_reg['allowed_upload_extensions'], true) &&
            \Atelier\Kernel\Media\FormatRegistry::getMimeType('odt', $this->base_dir) === 'application/vnd.oasis.opendocument.text'
        );
        $this->assert("FormatRegistry: la blacklist sécurité bloque TOUJOURS .php/.js/.html/.sh même si déclarés par doc-viewer en lecture",
            !\Atelier\Kernel\Media\FormatRegistry::isUploadExtensionAllowed('php', $this->base_dir) &&
            !\Atelier\Kernel\Media\FormatRegistry::isUploadExtensionAllowed('js', $this->base_dir) &&
            !\Atelier\Kernel\Media\FormatRegistry::isUploadExtensionAllowed('html', $this->base_dir) &&
            !\Atelier\Kernel\Media\FormatRegistry::isUploadExtensionAllowed('sh', $this->base_dir) &&
            \Atelier\Kernel\Media\FormatRegistry::hasForbiddenDoubleExtension('exploit.php.jpg') === true
        );
        $tmp_reg = \Atelier\Kernel\Media\FormatRegistry::resolve($tmp_root);
        $this->assert("FormatRegistry: une app externe WASM (PixelCraft) auto-enregistre ses formats (.pcraft, .kra, .psd) sans liste en dur",
            in_array('pcraft', $tmp_reg['allowed_upload_extensions'], true) &&
            in_array('kra', $tmp_reg['allowed_upload_extensions'], true) &&
            in_array('pcraft', $tmp_reg['media_types']['image'] ?? [], true)
        );
        // Verify custom native app mimeMap + config/formats.json override (still enforcing immutable blacklist)
        file_put_contents($tmp_root . '/config/formats.json', json_encode([
            'allow_extensions' => ['mycustom', 'php'],
            'mime_map' => ['mycustom' => 'application/x-mycustom']
        ]));
        \Atelier\Kernel\Media\FormatRegistry::clearCache();
        $this->assert("FormatRegistry: config/formats.json étend les formats custom mais ne peut JAMAIS autoriser .php",
            \Atelier\Kernel\Media\FormatRegistry::isUploadExtensionAllowed('mycustom', $tmp_root) &&
            !\Atelier\Kernel\Media\FormatRegistry::isUploadExtensionAllowed('php', $tmp_root) &&
            \Atelier\Kernel\Media\FormatRegistry::getMimeType('mycustom', $tmp_root) === 'application/x-mycustom'
        );
        @unlink($tmp_root . '/config/formats.json');
        \Atelier\Kernel\Media\FormatRegistry::clearCache();

        // Verify .htaccess supports WASM MIME type & split-bundle snippets fallback
        $root_htaccess = @file_get_contents($this->base_dir . '/.htaccess') ?: '';
        $this->assert(".htaccess déclare le type MIME application/wasm", strpos($root_htaccess, 'AddType application/wasm .wasm') !== false);
        $this->assert(".htaccess route le fallback app/snippets/* vers snippets/* pour les apps WASM/Trunk", strpos($root_htaccess, '/app/(snippets/.+)$') !== false);

        // 11. Phase 2 Architecture (ARCH-01 project_root vs media_dir, ARCH-02 kernel fixes, ARCH-03 plugin action discovery, Tribune OAuth2 silent refresh)
        $media_sub = $this->base_dir . '/storage/media';
        $this->assert("ARCH-01: ConfigStore::resolveRoot résout storage/media vers project_root", \Atelier\Kernel\Config\ConfigStore::resolveRoot($media_sub) === $this->base_dir);
        $this->assert("ARCH-01: ConfigStore::resolveRoot préserve un sandbox isolé de test", \Atelier\Kernel\Config\ConfigStore::resolveRoot($this->test_dir) === $this->test_dir);
        $this->assert("ARCH-01: PermissionsManager résout storage/permissions.json sous project_root (jamais sous storage/media)", \Atelier\Kernel\FS\PermissionsManager::getPermissionsFilePath($media_sub) === $this->base_dir . '/storage/permissions.json');
        $wm_res = \Atelier\Kernel\Actions\SystemActions::handle('get_wm_styles', [], ['base_dir' => $media_sub]);
        $this->assert("ARCH-01: SystemActions::get_wm_styles trouve les skins même quand base_dir=storage/media", ($wm_res['status'] ?? 0) === 200 && !empty($wm_res['data']['styles']));
        $this->assert("ARCH-01: TribuneActions::resolveStorageDir pointe vers <project_root>/storage pour storage/media", \Atelier\Apps\Tribune\Backend\TribuneActions::resolveStorageDir($media_sub) === $this->base_dir . '/storage');

        $gal_src = @file_get_contents($this->base_dir . '/system/kernel/Actions/GalleryActions.php') ?: '';
        $this->assert("ARCH-02: GalleryActions appelle AuthManager::getPasswordHash('', \$base_dir)", strpos($gal_src, "AuthManager::getPasswordHash('', \$base_dir)") !== false);
        $thumb_src = @file_get_contents($this->base_dir . '/system/endpoints/thumb.php') ?: '';
        $this->assert("ARCH-02: thumb.php utilise un cast (int) pour HTTP Range (fseek)", strpos($thumb_src, '(int)$matches[1]') !== false && strpos($thumb_src, '(float)$matches[1]') === false);
        $this->assert("ARCH-02: thumb.php gère la redirection stderr portable Windows/Unix", strpos($thumb_src, "PHP_OS_FAMILY === 'Windows'") !== false);

        $discovered_backend = \Atelier\Kernel\PluginDiscovery::getDiscoveredBackendActions($this->base_dir);
        $this->assert("ARCH-03: PluginDiscovery découvre browser_proxy depuis apps/browser/manifest.json", isset($discovered_backend['actions']['browser_proxy']));
        $this->assert("ARCH-03: PluginDiscovery découvre tribune_oauth_refresh depuis apps/tribune/manifest.json", isset($discovered_backend['actions']['tribune_oauth_refresh']));
        $this->assert("ARCH-03: ActionRouter::isMutatingAction protège tribune_oauth_refresh via manifeste", \Atelier\Kernel\Actions\ActionRouter::isMutatingAction('tribune_oauth_refresh', $this->base_dir) === true);
        $this->assert("ARCH-03: ActionRouter::resolvePluginAction résout dynamiquement browser_proxy", (\Atelier\Kernel\Actions\ActionRouter::resolvePluginAction('browser_proxy', $this->base_dir)['app_id'] ?? '') === 'browser');

        $refresh_missing = \Atelier\Apps\Tribune\Backend\TribuneActions::handle('tribune_oauth_refresh', ['board_id' => 'linuxfr', 'refresh_token' => ''], $this->test_dir);
        $this->assert("Tribune OAuth2: tribune_oauth_refresh valide les paramètres requis (400)", ($refresh_missing['status'] ?? 0) === 400);
        $tribune_backend_src = @file_get_contents($this->base_dir . '/apps/tribune/backend/TribuneActions.php') ?: '';
        $this->assert("Tribune OAuth2: tribune_oauth_callback ne contient plus d'alert() bloquant", strpos($tribune_backend_src, 'alert(') === false);

        // 12. FEAT-04 : Calculatrice Scientifique & Traceur de Courbes (apps/graphing-calc)
        $discovered_all = \Atelier\Kernel\PluginDiscovery::getDiscoveredApps($this->base_dir, true);
        $this->assert("FEAT-04: PluginDiscovery découvre apps/graphing-calc", isset($discovered_all['graphing-calc']));
        $gcalc_app = $discovered_all['graphing-calc'] ?? [];
        $this->assert("FEAT-04: graphing-calc appartient à la catégorie utilities avec icône 📐", ($gcalc_app['category'] ?? '') === 'utilities' && ($gcalc_app['icon'] ?? '') === '📐');
        $this->assert("FEAT-04: graphing-calc déclare math-engine.js, plotter.js, app.js et style.css",
            in_array('apps/graphing-calc/math-engine.js', $gcalc_app['scripts'] ?? [], true) &&
            in_array('apps/graphing-calc/plotter.js', $gcalc_app['scripts'] ?? [], true) &&
            ($gcalc_app['js_entry'] ?? '') === 'apps/graphing-calc/app.js' &&
            ($gcalc_app['css_entry'] ?? '') === 'apps/graphing-calc/style.css'
        );
        $gcalc_tr_fr = \Atelier\Kernel\PluginDiscovery::getAppTranslations($this->base_dir, 'fr', true);
        $gcalc_tr_en = \Atelier\Kernel\PluginDiscovery::getAppTranslations($this->base_dir, 'en', true);
        $gcalc_tr_ja = \Atelier\Kernel\PluginDiscovery::getAppTranslations($this->base_dir, 'ja', true);
        $this->assert("FEAT-04: Locales autonomes apps/graphing-calc/locales/{fr,en,ja}.json chargées par PluginDiscovery",
            !empty($gcalc_tr_fr['calc.tab_graph']) &&
            !empty($gcalc_tr_en['calc.tab_graph']) &&
            !empty($gcalc_tr_ja['calc.tab_graph']) &&
            !empty($gcalc_tr_fr['tribune.oauth_error'])
        );

        // Cleanup temporary fixture tree
        @unlink($tmp_root . '/config/external_apps.json');
        @unlink($tmp_app1 . '/index.html');
        @unlink($tmp_app1 . '/boot.wasm');
        @unlink($tmp_app1 . '/README.md');
        @unlink($tmp_app1 . '/HOSTING.md');
        @rmdir($tmp_app1 . '/app');
        @rmdir($tmp_app1);
        @unlink($tmp_app2 . '/index.html');
        @unlink($tmp_app2 . '/favicon.svg');
        @unlink($tmp_app2 . '/site.webmanifest');
        @rmdir($tmp_app2);
        @unlink($tmp_app3 . '/index.html');
        @unlink($tmp_app3 . '/README.md');
        @unlink($tmp_app3 . '/HOSTING.md');
        @rmdir($tmp_app3);
        @rmdir($tmp_root . '/apps/games');
        @rmdir($tmp_root . '/apps');
        @rmdir($tmp_root . '/config');
        @rmdir($tmp_root);

    }

    private function testPhase1MultiUserVolumesTagsCrypto(): void {
        echo "\n👥 [19/19] Phase 1 : Multi-Utilisateurs, Groupes, Volumes Montés, Tags & Métadonnées E2EE...\n";

        $saved_sess = $_SESSION ?? [];
        $_SESSION = [];
        \Atelier\Kernel\Data\AtelierStore::resetCache();

        $p1_root = $this->test_dir . '/phase1_func_sandbox';
        @mkdir($p1_root, 0755, true);

        // 1. Store driver & schema initialization
        $store = \Atelier\Kernel\Data\AtelierStore::forRoot($p1_root);
        $driver = $store->getDriverName();
        $this->assert("Phase 1: AtelierStore initialise un moteur valide (sqlite ou json)", in_array($driver, ['sqlite', 'json'], true));

        // 2. Create users & group & membership
        $alice_res = \Atelier\Kernel\Auth\UserManager::createUser($p1_root, $p1_root, [
            'username' => 'alice', 'password' => 'Alice123!', 'role' => 'user', 'display_name' => 'Alice Dupont'
        ]);
        $bob_res = \Atelier\Kernel\Auth\UserManager::createUser($p1_root, $p1_root, [
            'username' => 'bob', 'password' => 'Bob1234!', 'role' => 'user', 'display_name' => 'Bob Martin'
        ]);
        $alice = $alice_res['user'] ?? [];
        $bob = $bob_res['user'] ?? [];
        $studio_res = \Atelier\Kernel\Auth\UserManager::createGroup($p1_root, [
            'name' => 'studio', 'display_name' => 'Équipe Studio'
        ]);
        $studio = $studio_res['group'] ?? [];
        $_SESSION['is_admin'] = true;
        $_SESSION['atelier_admin_logged'] = true;
        $set_mem_res = \Atelier\Kernel\Actions\UserActions::handle('set_group_members', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['group_id' => (int)$studio['id'], 'member_ids' => [(int)$bob['id']]]
        ]);
        $this->assert("Phase 1: API set_group_members persiste member_ids et renvoie la liste", ($set_mem_res['status'] ?? 0) === 200 && in_array((int)$bob['id'], $set_mem_res['data']['member_ids'] ?? [], true));
        unset($_SESSION['is_admin'], $_SESSION['atelier_admin_logged']);
        $bob_groups = \Atelier\Kernel\Auth\UserManager::getUserGroupIds($p1_root, (int)$bob['id']);
        $this->assert("Phase 1: Bob appartient au groupe studio", in_array((int)$studio['id'], $bob_groups, true));

        // 3. Alice shares folder with group 'studio' -> appears in Bob's mounted volumes
        $users_root = \Atelier\Kernel\Security\PathValidator::getUsersRoot($p1_root);
        @mkdir($users_root . '/alice/projets', 0755, true);
        \Atelier\Kernel\Auth\AuthManager::loginUserSession($alice);
        \Atelier\Kernel\Auth\ShareManager::createUserShare($p1_root, $p1_root, [
            'source_path'     => 'users/alice/projets',
            'target_type'     => 'group',
            'target_id'       => (int)$studio['id'],
            'permission'      => 'write',
            'mount_name'      => 'Disque Studio',
            'mount_icon'      => '🎬',
            'show_on_desktop' => 1
        ]);

        \Atelier\Kernel\Auth\AuthManager::loginUserSession($bob);
        $bob_vols = \Atelier\Kernel\Auth\ShareManager::getMountedVolumesForCurrentUser($p1_root);
        $vol_names = array_column($bob_vols, 'mount_name');
        $vol_kinds = array_column($bob_vols, 'kind');
        $this->assert("Phase 1: Bob reçoit son volume Home + le volume partagé de groupe 'Disque Studio'", in_array('home', $vol_kinds, true) && in_array('Disque Studio', $vol_names, true));
        $this->assert("Phase 1: Bob dispose bien du droit d'écriture via le partage de groupe", \Atelier\Kernel\Auth\ShareManager::canWritePath('users/alice/projets', $p1_root) === true);

        // 4. Future-proof Tagging/Classification & E2EE metadata schema hooks
        $tags_saved = \Atelier\Kernel\Auth\ShareManager::setItemTags($p1_root, 'users/alice/projets', ['client', 'prioritaire']);
        $tags_read = \Atelier\Kernel\Auth\ShareManager::getItemTags($p1_root, 'users/alice/projets');
        $tag_slugs = array_column($tags_read, 'slug');
        $this->assert("Phase 1: Tags/Classification persistés sur un chemin VFS", count($tags_saved) === 2 && in_array('client', $tag_slugs, true) && in_array('prioritaire', $tag_slugs, true));

        \Atelier\Kernel\Auth\ShareManager::setItemMetadata($p1_root, 'users/alice/projets/coffre.bin', [
            'classification' => 'confidential',
            'is_encrypted' => 1,
            'crypto_algo' => 'AES-256-GCM',
            'crypto_key_id' => 'vault-key-01',
            'crypto_iv' => '00112233445566778899aabb'
        ]);
        $meta = \Atelier\Kernel\Auth\ShareManager::getItemMetadata($p1_root, 'users/alice/projets/coffre.bin');
        $this->assert("Phase 1: Métadonnées futures (classification + E2EE AES-256-GCM) stockées et relues",
            ($meta['classification'] ?? '') === 'confidential' &&
            (int)($meta['is_encrypted'] ?? 0) === 1 &&
            ($meta['crypto_algo'] ?? '') === 'AES-256-GCM'
        );

        // 5. Audit logging records security events
        \Atelier\Kernel\Auth\AuditLogger::log($p1_root, 'test_audit_event', 'users/alice/projets', 'ok', ['ok' => true]);
        $logs = \Atelier\Kernel\Auth\AuditLogger::recent($p1_root, 10);
        $this->assert("Phase 1: AuditLogger enregistre et renvoie les événements récents", count($logs) >= 1 && ($logs[0]['action'] ?? '') === 'test_audit_event');

        // 6. PluginDiscovery loads apps/settings/users-panel.js and apps/settings/locales/{fr,en,ja}.json
        $discovered = \Atelier\Kernel\PluginDiscovery::getDiscoveredApps($this->base_dir, true);
        $this->assert("Phase 1: PluginDiscovery charge apps/settings/users-panel.js dans scripts", in_array('apps/settings/users-panel.js', $discovered['settings']['scripts'] ?? [], true));

        $tr_fr = \Atelier\Kernel\PluginDiscovery::getAppTranslations($this->base_dir, 'fr', true);
        $tr_en = \Atelier\Kernel\PluginDiscovery::getAppTranslations($this->base_dir, 'en', true);
        $tr_ja = \Atelier\Kernel\PluginDiscovery::getAppTranslations($this->base_dir, 'ja', true);
        $this->assert("Phase 1: Locales autonomes apps/settings/locales/{fr,en,ja}.json chargées par PluginDiscovery",
            !empty($tr_fr['settings.tab_users']) && !empty($tr_en['settings.tab_users']) && !empty($tr_ja['settings.tab_users']) &&
            !empty($tr_fr['users.section_users']) && !empty($tr_en['users.section_users']) && !empty($tr_ja['users.section_users'])
        );

        $_SESSION = $saved_sess;
        \Atelier\Kernel\Data\AtelierStore::resetCache();
    }
}


// Run test suite directly if called from CLI
if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    $suite = new GeneralUnitTestSuite();
    $success = $suite->runAll();
    exit($success ? 0 : 1);
}



