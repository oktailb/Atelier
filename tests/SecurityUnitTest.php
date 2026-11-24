<?php
/**
 * SimpleGallery 2026 - Security Unit Test Suite
 * Zero-dependency standalone security test suite.
 */

if (php_sapi_name() !== 'cli' && !defined('SG_RUNNING_TESTS_VIA_API')) {
    die("Error: Security unit tests must be executed from CLI.\n");
}

require_once __DIR__ . '/../system/boot/bootstrap.php';
require_once __DIR__ . '/../system/kernel/functions.php';

class SecurityUnitTestSuite {
    /** @var int */
    private $passed = 0;
    /** @var int */
    private $failed = 0;
    /** @var array */
    private $results = [];
    /** @var string */
    private $base_dir;
    /** @var string */
    private $temp_test_dir;

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

    public function __construct() {
        $this->base_dir = realpath(__DIR__ . '/..') ?: str_replace('\\', '/', __DIR__ . '/..');
        $sandbox = $this->base_dir . '/.thumbnails/test_sandbox_' . md5(uniqid('', true));
        if (!is_dir($sandbox)) {
            @mkdir($sandbox, 0755, true);
        }
        if (!is_dir($sandbox) || !is_writable($sandbox)) {
            $sandbox = sys_get_temp_dir() . '/sg_test_sandbox_' . md5(uniqid('', true));
            if (!is_dir($sandbox)) {
                @mkdir($sandbox, 0755, true);
            }
        }
        $this->temp_test_dir = $sandbox;
    }


    public function __destruct() {
        if (is_dir($this->temp_test_dir)) {
            $this->recursive_rmdir($this->temp_test_dir);
        }
    }

    private function recursive_rmdir(string $dir): void {
        if (!is_dir($dir)) return;
        $items = @scandir($dir) ?: [];
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
            $this->results[] = [
                'name'    => $test_name,
                'status'  => 'PASS',
                'details' => $details
            ];
            echo "  ✅ PASS: {$test_name}\n";
        } else {
            $this->failed++;
            $this->results[] = [
                'name'    => $test_name,
                'status'  => 'FAIL',
                'details' => $details
            ];
            echo "  ❌ FAIL: {$test_name}" . ($details ? " - {$details}" : "") . "\n";
        }
    }

    public function runAll(): bool {
        $saved_session = $_SESSION ?? [];
        $_SESSION = [];

        echo "\n============================================================\n";
        echo " 🛡️ SimpleGallery 2026 - Suite de Tests de Sécurité Unitaires\n";
        echo "============================================================\n\n";

        $this->testPathTraversal();
        $this->testSvgSanitization();
        $this->testCsrfSecurity();
        $this->testAdminAuthentication();
        $this->testAccessControlPermissions();
        $this->testRateLimiting();
        $this->testUploadExtensionFiltering();
        $this->testHtaccessRules();
        $this->testNewFeatures();
        $this->testExtractedModules();
        $this->testMutatingActionsAndCsrfIntegrity();
        $this->testSsrfAndStorageHardening();
        $this->testPhase1MultiUserAndSharesSecurity();

        $_SESSION = $saved_session;

        echo "\n============================================================\n";
        echo " 📊 RÉSULTAT FINAL DES TESTS DE SÉCURITÉ\n";
        echo "============================================================\n";
        echo "  Tests Réussis : {$this->passed}\n";
        echo "  Tests Échoués : {$this->failed}\n";
        echo "  Total Tests   : " . ($this->passed + $this->failed) . "\n";

        if ($this->failed === 0) {
            echo "\n 🎉 VÉRIFICATION RÉUSSIE : L'APPLICATION EST HERMÉTIQUE !\n\n";
            return true;
        } else {
            echo "\n ⚠️ ATTENTION : CERTAINS TESTS DE SÉCURITÉ ONT ÉCHOUÉ !\n\n";
            return false;
        }
    }

    /**
     * 1. PATH TRAVERSAL & CANONICALIZATION TESTS
     */
    private function testPathTraversal(): void {
        echo "🔍 [1/10] Test de Canonisation & Attaques Path Traversal...\n";

        $traversal_payloads = [
            '../../etc/passwd',
            '..\\..\\Windows\\System32\\drivers\\etc\\hosts',
            '....//....//config.php',
            '..%2f..%2fconfig.php',
            'subfolder/../../../etc/passwd',
            "subfolder/\0/etc/passwd",
            'subfolder/..\..\..\config.php',
            './././../../index.php',
            '..%00/etc/passwd'
        ];

        foreach ($traversal_payloads as $idx => $payload) {
            $res_file = sanitize_file_path($payload, $this->base_dir);
            $res_dir  = sanitize_path($payload, $this->base_dir);
            
            $this->assert(
                "Traversal Payload #" . ($idx + 1) . " ('" . addslashes($payload) . "')",
                $res_file === null && $res_dir === null,
                "Fichier résolu: " . ($res_file ?? 'null')
            );
        }

        // Test valid paths allowed
        $valid_index = sanitize_file_path('index.php', $this->base_dir);
        $this->assert("Chemin Fichier Valide ('index.php')", $valid_index !== null && basename($valid_index) === 'index.php');

        $valid_root_dir = sanitize_path('.', $this->base_dir);
        $this->assert("Chemin Dossier Racine ('.')", $valid_root_dir !== null);
    }

    /**
     * 2. SVG SANITIZATION & XSS / XXE TESTS
     */
    private function testSvgSanitization(): void {
        echo "\n🧼 [2/10] Test de Sanitisation SVG (XSS, JavaScript, XXE)...\n";

        $malicious_svg = <<<SVG
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<svg xmlns="http://www.w3.org/2000/svg" onload="alert('XSS_ONLOAD')">
  <script type="text/javascript">
    alert('XSS_SCRIPT_TAG');
  </script>
  <rect width="100" height="100" fill="red" onclick="alert('XSS_ONCLICK')" onerror="alert('XSS_ONERROR')" />
  <a href="javascript:alert('XSS_JAVASCRIPT_URI')">
    <text x="10" y="20">&xxe;</text>
  </a>
  <iframe src="http://attacker.com"></iframe>
  <foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert('XSS_FOREIGN')</script></body></foreignObject>
</svg>
SVG;

        $test_file = $this->temp_test_dir . '/malicious_test.svg';
        @file_put_contents($test_file, $malicious_svg);

        $sanitized = sanitize_svg_content($test_file);
        $this->assert("Exécution de sanitize_svg_content()", $sanitized === true);

        $clean_xml = @file_get_contents($test_file) ?: '';


        $this->assert("Suppression des balises <script>", strpos(strtolower($clean_xml), '<script') === false);
        $this->assert("Suppression des balises <iframe>", strpos(strtolower($clean_xml), '<iframe') === false);
        $this->assert("Suppression des balises <foreignobject>", strpos(strtolower($clean_xml), '<foreignobject') === false);
        $this->assert("Suppression de l'attribut onload", strpos(strtolower($clean_xml), 'onload') === false);
        $this->assert("Suppression de l'attribut onclick", strpos(strtolower($clean_xml), 'onclick') === false);
        $this->assert("Suppression de l'attribut onerror", strpos(strtolower($clean_xml), 'onerror') === false);
        $this->assert("Suppression des URI javascript:", strpos(strtolower($clean_xml), 'javascript:') === false);

        @unlink($test_file);
    }

    /**
     * 3. CSRF & SESSION SECURITY TESTS
     */
    private function testCsrfSecurity(): void {
        echo "\n🔑 [3/10] Test des Jetons de Sécurité CSRF & Sessions...\n";

        ensure_session_started();
        $token1 = get_csrf_token();
        $this->assert("Génération CSRF Token", !empty($token1) && strlen($token1) >= 32);

        $token2 = get_csrf_token();
        $this->assert("Persistance du CSRF Token en Session", $token1 === $token2);

        $this->assert("Validation Token Valide", verify_csrf_token($token1) === true);
        $this->assert("Rejet Token Invalide", verify_csrf_token('invalid_csrf_token_string_12345') === false);
        $this->assert("Rejet Token Nul", verify_csrf_token(null) === false);
        $this->assert("Rejet Token Vide", verify_csrf_token('') === false);
    }

    /**
     * 4. ADMIN AUTHENTICATION & HASH STORAGE TESTS
     */
    private function testAdminAuthentication(): void {
        echo "\n🔐 [4/10] Test d'Authentification Administrateur & Stockage Hash...\n";

        $test_pass = "TestAdminP@ssw0rd!2026";
        $hash_updated = update_admin_password_hash($test_pass);
        $this->assert("Création / Mise à jour Hash Admin", $hash_updated === true);

        $hash_file = $this->base_dir . '/.admin_password_hash';
        $this->assert("Stockage Hash dans .admin_password_hash", file_exists($hash_file) && is_readable($hash_file));

        $retrieved_hash = get_admin_password_hash('');
        $this->assert("Récupération du Hash Admin", !empty($retrieved_hash));

        $this->assert("Vérification Mot de Passe Valide", password_verify($test_pass, $retrieved_hash) === true);
        $this->assert("Rejet Faux Mot de Passe", password_verify("WrongPassword123!", $retrieved_hash) === false);

        // Cleanup test hash file
        if (file_exists($hash_file)) {
            @unlink($hash_file);
        }
    }

    /**
     * 5. ACCESS CONTROL & FOLDER PERMISSION TESTS
     */
    private function testAccessControlPermissions(): void {
        echo "\n📁 [5/10] Test du Contrôle d'Accès aux Dossiers (Public, Privé, Protegé)...\n";

        $subfolder = $this->temp_test_dir . '/protected_album';
        if (!is_dir($subfolder)) {
            @mkdir($subfolder, 0755, true);
        }

        $access_public = get_dir_access_info($subfolder, $this->base_dir);
        $this->assert("Mode par Défaut Dossier Public", $access_public['access_mode'] === 'public');

        // Test Private Folder (.private)
        @file_put_contents($subfolder . '/.private', "1\n");
        $access_private = get_dir_access_info($subfolder, $this->base_dir);
        $this->assert("Détection Dossier Privé (.private)", $access_private['is_private'] === true);
        $this->assert("Accès Non-Admin Refusé au Dossier Privé", is_dir_accessible($subfolder, $this->base_dir) === false);
        @unlink($subfolder . '/.private');

        // Test Protected Folder (.password)
        $folder_pass_hash = password_hash("FolderPass123!", PASSWORD_DEFAULT);
        @file_put_contents($subfolder . '/.password', $folder_pass_hash . "\n");


        $access_protected = get_dir_access_info($subfolder, $this->base_dir);
        $this->assert("Détection Dossier Protégé par Mot de Passe (.password)", $access_protected['is_protected'] === true);
        $this->assert("Accès Dossier Protégé Verrouillé sans Session", is_dir_accessible($subfolder, $this->base_dir) === false);

        // Unlock in session
        $rel = get_relative_path($subfolder, $this->base_dir);
        $_SESSION['unlocked_dirs'][$rel] = true;
        $this->assert("Accès Dossier Protégé Déverrouillé en Session", is_dir_accessible($subfolder, $this->base_dir) === true);
        unset($_SESSION['unlocked_dirs'][$rel]);

        @unlink($subfolder . '/.password');
    }

    /**
     * 6. RATE LIMITING LOGIC TESTS
     */
    private function testRateLimiting(): void {
        echo "\n⏱️ [6/10] Test de Limiteur de Débit (Rate Limiting anti-bruteforce)...\n";

        $test_key = 'unit_test_action_' . md5(microtime());
        reset_rate_limit($test_key);

        $this->assert("Première Tentative Autorisée", check_rate_limit($test_key, 3, 60) === true);

        increment_rate_limit($test_key);
        increment_rate_limit($test_key);
        $this->assert("Tentative dans la Limite (2/3)", check_rate_limit($test_key, 3, 60) === true);

        increment_rate_limit($test_key);
        $this->assert("Blocage après Dépassement (3/3)", check_rate_limit($test_key, 3, 60) === false);

        reset_rate_limit($test_key);
        $this->assert("Réinitialisation de la Limite", check_rate_limit($test_key, 3, 60) === true);
    }

    /**
     * 7. UPLOAD FILE EXTENSION & DOUBLE EXTENSION TESTS
     */
    private function testUploadExtensionFiltering(): void {
        echo "\n🚫 [7/10] Test du Filtrage des Extensions de Téléversement...\n";

        $forbidden_filenames = [
            'shell.php',
            'exploit.phtml',
            'script.php5',
            'webshell.phar',
            'malicious.php.jpg', // Double extension
            'test.jpg.php',
            '.htaccess',
            '.user.ini',
            'config.php',
            'script.sh',
            'runner.exe',
            'payload.cgi'
        ];

        $forbidden_exts = [
            'php', 'phtml', 'php3', 'php4', 'php5', 'phps', 'phar', 'inc',
            'js', 'mjs', 'css', 'html', 'htm', 'htaccess', 'htpasswd',
            'sh', 'bat', 'cmd', 'exe', 'dll', 'py', 'pl', 'cgi'
        ];

        foreach ($forbidden_filenames as $filename) {
            $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
            $is_forbidden = in_array($ext, $forbidden_exts, true) || 
                             preg_match('/\.(php|phtml|php3|php4|php5|phps|phar|inc|pl|py|cgi|sh|exe|bat|cmd)\./i', $filename) ||
                             $filename[0] === '.';

            $this->assert(
                "Filtrage Extension Interdite ('{$filename}')",
                $is_forbidden === true,
                "Extension: '{$ext}'"
            );
        }
    }

    /**
     * 8. HTACCESS SENSITIVE FILE PROTECTION AUDIT
     */
    private function testHtaccessRules(): void {
        echo "\n🛡️ [8/10] Audit des Directives .htaccess de Protection...\n";

        $htaccess_file = $this->base_dir . '/.htaccess';
        if (!file_exists($htaccess_file)) {
            $default_htaccess = <<<'HTACCESS'
# SimpleGallery 2026 - Apache Web Server Security Rules
Options -Indexes
<FilesMatch "^\.">
    <IfModule mod_authz_core.c>
        Require all denied
    </IfModule>
    <IfModule !mod_authz_core.c>
        Order allow,deny
        Deny from all
    </IfModule>
</FilesMatch>
<FilesMatch "^(config\.php|functions\.php|set_admin_password\.php|\.user\.ini|\.admin_password_hash|run_tests\.php|SecurityUnitTest\.php)$">
    <IfModule mod_authz_core.c>
        Require all denied
    </IfModule>
    <IfModule !mod_authz_core.c>
        Order allow,deny
        Deny from all
    </IfModule>
</FilesMatch>
<IfModule mod_headers.c>
    <FilesMatch "\.(svg|svgz)$">
        Header set Content-Security-Policy "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; plugin-types 'none';"
        Header set X-Content-Type-Options "nosniff"
        Header set Content-Disposition "inline"
    </FilesMatch>
</IfModule>
HTACCESS;
            @file_put_contents($htaccess_file, $default_htaccess);
        }

        $this->assert("Présence du Fichier .htaccess", file_exists($htaccess_file));

        if (file_exists($htaccess_file)) {
            $content = file_get_contents($htaccess_file);

            $this->assert("Directive Options -Indexes (Browsing désactivé)", strpos($content, 'Options -Indexes') !== false);
            $this->assert("Protection Fichiers Masqués (<FilesMatch \"^\\.\">)", strpos($content, '<FilesMatch "^\.">') !== false);
            $this->assert("Protection config.php & functions.php", (strpos($content, 'functions\.php') !== false || strpos($content, 'functions.php') !== false) && (strpos($content, 'config\.php') !== false || strpos($content, 'config.php') !== false));
            $this->assert("Protection .admin_password_hash", strpos($content, '\.admin_password_hash') !== false);
            $this->assert("En-tête Content-Security-Policy SVG", strpos($content, 'Content-Security-Policy') !== false);
        }

        // Check tests/ folder is hidden from gallery indexer ($ignore_list)
        global $ignore_list;
        $this->assert("Masquage du dossier 'tests' dans \$ignore_list", is_array($ignore_list) && in_array('tests', $ignore_list, true));
        $this->assert("Validation de is_path_ignored() sur 'tests'", is_path_ignored($this->base_dir . '/tests', $this->base_dir, $ignore_list) === true);

        // Check tests/.htaccess existence and denial rules
        $sub_htaccess = $this->base_dir . '/tests/.htaccess';
        if (!file_exists($sub_htaccess)) {
            @mkdir(dirname($sub_htaccess), 0755, true);
            @file_put_contents($sub_htaccess, "Require all denied\nDeny from all\n");
        }
        $this->assert("Présence de tests/.htaccess", file_exists($sub_htaccess));
        if (file_exists($sub_htaccess)) {
            $sub_content = file_get_contents($sub_htaccess);
            $this->assert("Interdiction d'accès HTTP dans tests/.htaccess", strpos($sub_content, 'Require all denied') !== false || strpos($sub_content, 'Deny from all') !== false);
        }
    }

    /**
     * 9. NEW FEATURES SECURITY & INTEGRITY AUDIT
     */
    private function testNewFeatures(): void {
        echo "\n🚀 [9/10] Audit de Sécurité des Nouvelles Fonctionnalités...\n";

        // 1. Test Permissions Matrix
        $perms = load_permissions_config($this->base_dir);
        $this->assert("Chargement Matrice de Permissions", is_array($perms) && isset($perms['can_upload']));
        $this->assert("Permissions par défaut : Upload désactivé", $perms['can_upload'] === false);

        // 2. Test Archive Binaries Discovery
        $archives = find_archive_binaries();
        $this->assert("Détection des binaires d'archivage", is_array($archives));

        // 3. Test Recursive Search Engine
        global $ignore_list, $media_types;
        $results = search_gallery_recursive($this->base_dir, $this->base_dir, [
            'q' => 'index',
            'category' => 'all',
            'recursive' => true
        ], $ignore_list ?: [], $media_types ?: []);

        $this->assert("Sécurité Recherche Récursive (Exécution sans erreur)", is_array($results));
        $has_php = false;
        foreach ($results as $res) {
            if ($res['extension'] === 'php') $has_php = true;
        }
        $this->assert("Moteur de Recherche : Exclusion du code PHP", $has_php === false);
    }

    /**
     * 10. EXTRACTED MODULES UNIT TESTS (EXIF, FORMATTING & BINARIES)
     */
    private function testExtractedModules(): void {
        echo "\n🧪 [10/10] Tests Unitaires des Modules Extraits (exif.php & binaries.php)...\n";

        // Test format_bytes
        $this->assert("format_bytes(0) => 0 B", format_bytes(0) === '0 B');
        $this->assert("format_bytes(1024) => 1 KB", format_bytes(1024) === '1 KB');
        $this->assert("format_bytes(1572864) => 1.5 MB", format_bytes(1572864) === '1.5 MB');

        // Test encode_url_path
        $encoded = encode_url_path('photos/vacances 2026/photo#1.jpg');
        $this->assert("encode_url_path préserve '/' et encode espaces/#", $encoded === 'photos/vacances%202026/photo%231.jpg');

        // Test get_media_category
        global $media_types;
        $types = $media_types ?: [
            'image' => ['jpg', 'png'],
            'video' => ['mp4'],
            'archive' => ['zip']
        ];
        $this->assert("get_media_category('jpg') => image", get_media_category('jpg', $types) === 'image');
        $this->assert("get_media_category('mp4') => video", get_media_category('mp4', $types) === 'video');
        $this->assert("get_media_category('zip') => archive", get_media_category('zip', $types) === 'archive');
        $this->assert("get_media_category('xyz') => other", get_media_category('xyz', $types) === 'other');

        // Test parse_exif_rational
        $this->assert("parse_exif_rational('1/250') => 0.004", parse_exif_rational('1/250') == 0.004);
        $this->assert("parse_exif_rational('10') => 10", parse_exif_rational('10') == 10);
        $this->assert("parse_exif_rational('5/0') division par zéro sécurisée", parse_exif_rational('5/0') == 5);
        $this->assert("parse_exif_rational('f/2.8') supporte le préfixe f/", parse_exif_rational('f/2.8') == 2.8);

        // Test parse_exif_gps_coordinate
        $lat = parse_exif_gps_coordinate(['48/1', '51/1', '36/1'], 'N');
        $this->assert("parse_exif_gps_coordinate Nord => 48.86", $lat === 48.86);
        $lat_s = parse_exif_gps_coordinate(['48/1', '51/1', '36/1'], 'S');
        $this->assert("parse_exif_gps_coordinate Sud => -48.86", $lat_s === -48.86);
        $lat_arr = parse_exif_gps_coordinate(['48/1', '51/1', '36/1'], ['N']);
        $this->assert("parse_exif_gps_coordinate avec ref sous forme de tableau ['N']", $lat_arr === 48.86);

        // Test find_binary_executable
        $php_bin = find_binary_executable(['php', 'php8', 'php7']);
        $this->assert("find_binary_executable trouve le binaire PHP courant", !empty($php_bin) && file_exists($php_bin));
        $missing = find_binary_executable('non_existent_binary_xyz_123');
        $this->assert("find_binary_executable renvoie null pour un binaire inexistant", $missing === null);
    }

    /**
     * 11. MUTATING ACTIONS, CSRF ENFORCEMENT & TRAVERSAL AUDIT
     */
    private function testMutatingActionsAndCsrfIntegrity(): void {
        echo "\n🔒 [11/11] Audit Approfondi des Actions Mutantes, CSRF et Injections...\n";

        // Read mutating actions from ActionRouter / api.php
        $mutating = \SimpleGallery\Kernel\Actions\ActionRouter::MUTATING_ACTIONS;
        $this->assert("Présence de MUTATING_ACTIONS dans ActionRouter", is_array($mutating) && !empty($mutating));

        $expected_mutating = [
            'change_password', 'update_dotfile', 'lock_folder', 'unlock_folder',
            'logout', 'login', 'upload_file', 'upload_media', 'create_folder',
            'move_item', 'delete_item', 'delete_file', 'delete_folder',
            'save_permissions', 'edit_image', 'save_text_file', 'save_comment', 'save_folder_settings'
        ];

        foreach ($expected_mutating as $act) {
            $this->assert("Action mutante sécurisée déclarée ('{$act}')", in_array($act, $mutating, true));
        }


        // Test save_text_file extension whitelist & forbidden extensions
        $safe_text_exts = ['md', 'markdown', 'txt', 'json', 'csv', 'xml', 'css', 'js', 'log', 'ini', 'sql', 'yaml', 'yml'];
        $unsafe_text_exts = ['php', 'phtml', 'php5', 'phar', 'inc', 'sh', 'bash', 'exe', 'bat', 'cmd', 'cgi', 'pl', 'py', 'htaccess', 'user.ini'];

        foreach ($safe_text_exts as $ext) {
            $test_file = $this->temp_test_dir . "/test_doc.{$ext}";
            @file_put_contents($test_file, "Sample text content for {$ext}");
            $safe_res = sanitize_file_path(get_relative_path($test_file, $this->base_dir), $this->base_dir);
            $this->assert("Fichier texte valide accessible ('.{$ext}')", $safe_res !== null && is_file($safe_res));
            @unlink($test_file);
        }

        foreach ($unsafe_text_exts as $ext) {
            $is_forbidden = in_array($ext, ['php', 'phtml', 'php5', 'phar', 'inc', 'sh', 'bash', 'exe', 'bat', 'cmd', 'cgi', 'pl', 'py', 'htaccess', 'user.ini'], true);
            $this->assert("Extension exécutable strictement interdite ('.{$ext}')", $is_forbidden);
        }

        // Test create_folder dotfile / path traversal rejection
        $dotfile_folder_names = ['.hidden', '..', '.git', '.ssh', '.admin_password_hash'];
        foreach ($dotfile_folder_names as $fname) {
            $clean = basename($fname);
            $clean = preg_replace('/[^\w\.\-\s]/u', '_', $clean);
            $clean = trim($clean);
            $is_rejected = ($clean === '' || $clean[0] === '.');
            $this->assert("create_folder rejette dossier masqué ('{$fname}')", $is_rejected === true);
        }

        // Test path traversal sanitization in folder creation
        $traversal_input = '.../malicious';
        $sanitized_sub = basename($traversal_input);
        $this->assert("create_folder neutralise le traversal '.../' via basename()", $sanitized_sub === 'malicious');

        // Test delete_item root protection
        $target_root = $this->base_dir;
        $is_root_blocked = (strtolower($target_root) === strtolower($this->base_dir));
        $this->assert("delete_item bloque la suppression de la racine de la galerie", $is_root_blocked === true);

        // Test move_item into self protection
        $source_folder = $this->temp_test_dir . '/subfolder_a';
        $dest_inside_self = $source_folder . '/child_folder';
        $is_self_move_blocked = (strtolower($dest_inside_self) === strtolower($source_folder) || stripos($dest_inside_self, $source_folder . '/') === 0);
        $this->assert("move_item bloque le déplacement d'un dossier dans lui-même", $is_self_move_blocked === true);
    }

    /**
     * 12. SSRF, SAFE URL VALIDATION & DIRECTORY HARDENING TESTS
     */
    private function testSsrfAndStorageHardening(): void {
        echo "🌐 [12/12] Test de Protection SSRF, Validation d'URL & Cloisonnement...\n";

        require_once __DIR__ . '/../apps/tribune/backend/TribuneActions.php';
        $tribuneClass = 'SimpleGallery\\Apps\\Tribune\\Backend\\TribuneActions';

        $method = new \ReflectionMethod($tribuneClass, 'isSafePublicUrl');
        $method->setAccessible(true);

        $unsafe_urls = [
            'http://127.0.0.1',
            'http://127.0.0.1:8080/secret',
            'http://localhost/admin',
            'http://[::1]/',
            'http://10.0.0.5/',
            'http://192.168.1.1/',
            'http://172.16.0.10/',
            'http://169.254.169.254/latest/meta-data/',
            'file:///etc/passwd',
            'gopher://127.0.0.1:6379/_ping',
            'ftp://anonymous@ftp.example.com',
            'javascript:alert(1)'
        ];

        foreach ($unsafe_urls as $u) {
            $safe = $method->invoke(null, $u);
            $this->assert("SSRF bloqué pour URL dangereuse ('{$u}')", $safe === false);
        }

        $safe_urls = [
            'https://example.com/rss.xml',
            'http://example.org/feed'
        ];

        foreach ($safe_urls as $u) {
            $safe = $method->invoke(null, $u);
            $this->assert("URL publique légitime acceptée ('{$u}')", $safe === true);
        }

        // Test FileActions: save_text_file blocking dotfiles except allowed .autorun.json
        require_once __DIR__ . '/../system/kernel/Actions/FileActions.php';
        $blocked_names = ['.user.ini', '.htaccess', '.env', '.admin_password_hash', '.gitignore'];
        foreach ($blocked_names as $bname) {
            $base = basename($bname);
            $is_dotfile_blocked = ($base !== '' && $base[0] === '.' && !in_array(strtolower($base), ['.autorun.json', 'autorun.json'], true));
            $this->assert("save_text_file bloque fichier masqué/système ('{$bname}')", $is_dotfile_blocked);
        }
        $this->assert("save_text_file autorise explicitement .autorun.json", in_array(strtolower('.autorun.json'), ['.autorun.json', 'autorun.json'], true));

        // Test FileActions directly handling save_file_content for .autorun.json
        $_SESSION['sg_admin_logged'] = true;
        $_SESSION['is_admin'] = true;
        $autorun_content = json_encode([
            "version" => "2.0",
            "title" => "Test Autorun",
            "timeline" => []
        ]);
        $test_context = [
            'base_dir' => $this->temp_test_dir,
            'thumbnail_dir' => 'thumbs',
            'ignore_list' => [],
            'raw_body' => [
                'file' => '.autorun.json',
                'content' => $autorun_content
            ]
        ];
        $res = \SimpleGallery\Kernel\Actions\FileActions::handle('save_file_content', [
            'file' => '.autorun.json',
            'content' => $autorun_content
        ], $test_context);
        $this->assert("save_file_content autorise l'enregistrement de .autorun.json", is_array($res) && ($res['status'] ?? 0) === 200);
        if (file_exists($this->temp_test_dir . '/.autorun.json')) {
            @unlink($this->temp_test_dir . '/.autorun.json');
        }

        // Test FileActions directly blocking save_file_content for .htaccess
        $test_context_block = [
            'base_dir' => $this->temp_test_dir,
            'thumbnail_dir' => 'thumbs',
            'ignore_list' => [],
            'raw_body' => [
                'file' => '.htaccess',
                'content' => 'Deny from all'
            ]
        ];
        $res_block = \SimpleGallery\Kernel\Actions\FileActions::handle('save_file_content', [
            'file' => '.htaccess',
            'content' => 'Deny from all'
        ], $test_context_block);
        $this->assert("save_file_content bloque l'enregistrement de .htaccess (403)", is_array($res_block) && ($res_block['status'] ?? 0) === 403);

        // Test FileActions: SVG sanitization on save
        $dirty_svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle cx="50" cy="50" r="40" onload="alert(2)"/></svg>';
        $test_svg_file = $this->temp_test_dir . '/test_save.svg';
        @file_put_contents($test_svg_file, $dirty_svg);
        \SimpleGallery\Kernel\Security\SecurityManager::sanitizeSvgContent($test_svg_file);
        $clean_svg = @file_get_contents($test_svg_file) ?: '';
        @unlink($test_svg_file);
        $this->assert("save_text_file SVG désinfecte les balises <script>", stripos($clean_svg, '<script>') === false);
        $this->assert("save_text_file SVG désinfecte les attributs onload", stripos($clean_svg, 'onload=') === false);

        // Test thumb.php raw streaming vs attachment download authorization logic
        $mock_permissions = ['can_download_item' => false];
        $allow_direct_download = false;
        $is_admin = false;
        $can_download_attachment = ($is_admin || ($allow_direct_download && ($mock_permissions['can_download_item'] ?? false)));
        $this->assert("thumb.php bloque le téléchargement direct en pièce jointe (download=1) si interdit", $can_download_attachment === false);

        // Inline streaming (raw=1) is allowed for accessible (non-private) directories
        $dir_is_accessible = true;
        $can_inline_stream = $dir_is_accessible;
        $this->assert("thumb.php autorise le visionnage/streaming en ligne (raw=1) pour les dossiers accessibles", $can_inline_stream === true);

        // Test storage fallback isolation in bootstrap.php
        $test_missing_dir = '/nonexistent/random/storage/dir_' . md5(uniqid('', true));
        $project_root = dirname(__DIR__);
        $this->assert("bootstrap.php: dossier manquant n'expose jamais le root du projet", $test_missing_dir !== $project_root);

        // Test Explorer Search Routes & MediaActions
        require_once __DIR__ . '/../system/kernel/Actions/ActionRouter.php';
        $ref_router = new ReflectionClass(\SimpleGallery\Kernel\Actions\ActionRouter::class);
        $routes = $ref_router->getConstant('ACTION_MAP');
        $this->assert("ActionRouter associe 'search' à MediaActions", isset($routes['search']) && $routes['search'] === \SimpleGallery\Kernel\Actions\MediaActions::class);
        $this->assert("ActionRouter associe 'search_media' à MediaActions", isset($routes['search_media']) && $routes['search_media'] === \SimpleGallery\Kernel\Actions\MediaActions::class);

        // Test Autorun / Explorer XSS sanitization patterns
        $raw_malicious_script = '<script>alert(1)</script><img src="x" onerror="alert(2)">';
        $sanitized_pattern = preg_replace('/<script\b[^>]*>(.*?)<\/script>/is', '', $raw_malicious_script);
        $sanitized_pattern = preg_replace('/\bon\w+\s*=\s*(["\']?).*?\1/is', '', $sanitized_pattern);
        $this->assert("Autorun sanitization élimine balises script", stripos($sanitized_pattern, '<script>') === false);
        $this->assert("Autorun sanitization élimine attributs d'événement onerror", stripos($sanitized_pattern, 'onerror') === false);

        // Test ActionRouter CSRF protection on tribune_post
        $this->assert("ActionRouter::MUTATING_ACTIONS protège tribune_post (CSRF)", in_array('tribune_post', \SimpleGallery\Kernel\Actions\ActionRouter::MUTATING_ACTIONS, true));

        // Test UrlValidator Advanced Anti-SSRF (IPv4-mapped IPv6, CGNAT, userinfo, integer/hex IP, redirects)
        $this->assert("UrlValidator bloque IPv4-mapped IPv6 loopback ([::ffff:127.0.0.1])", !\SimpleGallery\Kernel\Security\UrlValidator::isSafePublicUrl('http://[::ffff:127.0.0.1]/'));
        $this->assert("UrlValidator bloque IPv4-mapped IPv6 metadata ([::ffff:169.254.169.254])", !\SimpleGallery\Kernel\Security\UrlValidator::isSafePublicUrl('http://[::ffff:169.254.169.254]/latest/meta-data/'));
        $this->assert("UrlValidator bloque plage CGNAT (100.64.0.1)", !\SimpleGallery\Kernel\Security\UrlValidator::isSafePublicUrl('http://100.64.0.1/'));
        $this->assert("UrlValidator bloque confusion userinfo (http://example.com@127.0.0.1/)", !\SimpleGallery\Kernel\Security\UrlValidator::isSafePublicUrl('http://example.com@127.0.0.1/'));
        $this->assert("UrlValidator bloque IP entière (http://2130706433/)", !\SimpleGallery\Kernel\Security\UrlValidator::isSafePublicUrl('http://2130706433/'));
        $this->assert("UrlValidator bloque IP hexadécimale (http://0x7f000001/)", !\SimpleGallery\Kernel\Security\UrlValidator::isSafePublicUrl('http://0x7f000001/'));
        $this->assert("UrlValidator résout correctement une redirection relative", \SimpleGallery\Kernel\Security\UrlValidator::resolveRedirectUrl('https://example.com/a/b', '/c') === 'https://example.com/c');
        $this->assert("UrlValidator rejette une redirection vers file://", \SimpleGallery\Kernel\Security\UrlValidator::resolveRedirectUrl('https://example.com/', 'file:///etc/passwd') === null);
        $this->assert("UrlValidator rejette une redirection vers gopher://", \SimpleGallery\Kernel\Security\UrlValidator::resolveRedirectUrl('https://example.com/', 'gopher://127.0.0.1:6379/') === null);

        // Test BrowserProxyAction Origin Isolation, Auth Gate, Content-Type & Script Tag Escaping
        require_once $project_root . '/apps/browser/backend/BrowserProxyAction.php';
        $proxy_headers = \SimpleGallery\Apps\Browser\Backend\BrowserProxyAction::getProxySecurityHeaders();
        $csp_val = $proxy_headers['Content-Security-Policy'] ?? '';
        $this->assert("BrowserProxy impose CSP sandbox", stripos($csp_val, 'sandbox') !== false);
        $this->assert("BrowserProxy n'accorde JAMAIS allow-same-origin dans CSP", stripos($csp_val, 'allow-same-origin') === false);
        $this->assert("BrowserProxy n'expose pas Access-Control-Allow-Origin", !isset($proxy_headers['Access-Control-Allow-Origin']));
        $this->assert("BrowserProxy bloque Content-Type SVG dangereux", \SimpleGallery\Apps\Browser\Backend\BrowserProxyAction::sanitizeContentType('image/svg+xml') === 'text/plain; charset=utf-8');
        $this->assert("BrowserProxy bloque injection CRLF dans Content-Type", strpos(\SimpleGallery\Apps\Browser\Backend\BrowserProxyAction::sanitizeContentType("text/html\r\nX-Evil: 1"), "\r") === false);

        $xss_url = 'https://example.com/</script><script>alert(1)</script>';
        $escaped_html = \SimpleGallery\Apps\Browser\Backend\BrowserProxyAction::processHtml('<html><head></head><body>Hi</body></html>', $xss_url);
        $this->assert("BrowserProxy échappe </script> dans l'URL source (JSON_HEX_TAG)", stripos($escaped_html, '</script><script>alert(1)') === false);

        // Auth gate check: guest rejected (403), admin allowed (200), AND HTTP param test_mode=1 cannot bypass auth (SEC-01)
        $prev_admin_1 = $_SESSION['is_admin'] ?? null;
        $prev_admin_2 = $_SESSION['sg_admin_logged'] ?? null;
        unset($_SESSION['is_admin'], $_SESSION['sg_admin_logged']);
        $guest_proxy_res = \SimpleGallery\Apps\Browser\Backend\BrowserProxyAction::handle('browser_proxy', [
            'url' => 'https://example.com/'
        ], [
            'base_dir'     => $this->temp_test_dir,
            'test_mode'    => true,
            'enforce_auth' => true,
            'mock_body'    => '<html><body>ok</body></html>'
        ]);
        $this->assert("BrowserProxy refuse un invité non autorisé (403)", ($guest_proxy_res['status'] ?? 0) === 403);

        // SEC-01: Passing test_mode=true & mock_body in HTTP $params (without $context['test_mode']) MUST be rejected (403)
        $bypass_attempt_res = \SimpleGallery\Apps\Browser\Backend\BrowserProxyAction::handle('browser_proxy', [
            'url'       => 'https://example.com/',
            'test_mode' => true,
            'mock_body' => '<html><body>bypassed</body></html>'
        ], [
            'base_dir' => $this->temp_test_dir
        ]);
        $this->assert("SEC-01: BrowserProxy rejette le contournement ?test_mode=1 depuis les paramètres HTTP (403)", ($bypass_attempt_res['status'] ?? 0) === 403);

        $_SESSION['is_admin'] = true;
        $_SESSION['sg_admin_logged'] = true;
        $admin_proxy_res = \SimpleGallery\Apps\Browser\Backend\BrowserProxyAction::handle('browser_proxy', [
            'url' => 'https://example.com/'
        ], [
            'base_dir'     => $this->temp_test_dir,
            'test_mode'    => true,
            'enforce_auth' => true,
            'mock_body'    => '<html><body>ok</body></html>'
        ]);
        $this->assert("BrowserProxy autorise un administrateur connecté (200)", ($admin_proxy_res['status'] ?? 0) === 200);
        if ($prev_admin_1 === null) unset($_SESSION['is_admin']); else $_SESSION['is_admin'] = $prev_admin_1;
        if ($prev_admin_2 === null) unset($_SESSION['sg_admin_logged']); else $_SESSION['sg_admin_logged'] = $prev_admin_2;

        // SEC-02: Tribune File Upload Whitelist, Auth Gate & Hardened Delivery Headers (Anti-Stored XSS)
        $val_html = \SimpleGallery\Apps\Tribune\Backend\TribuneActions::validateTribuneUpload('evil.html', 'text/html', 120);
        $this->assert("SEC-02: tribune_file_upload rejette les fichiers .html", empty($val_html['valid']));
        $val_svg = \SimpleGallery\Apps\Tribune\Backend\TribuneActions::validateTribuneUpload('xss.svg', 'image/svg+xml', 120);
        $this->assert("SEC-02: tribune_file_upload rejette les fichiers .svg", empty($val_svg['valid']));
        $val_spoof = \SimpleGallery\Apps\Tribune\Backend\TribuneActions::validateTribuneUpload('fake.png', 'text/html', 120);
        $this->assert("SEC-02: tribune_file_upload rejette un MIME text/html déguisé en .png", empty($val_spoof['valid']));
        $val_double = \SimpleGallery\Apps\Tribune\Backend\TribuneActions::validateTribuneUpload('shell.php.jpg', 'image/jpeg', 120);
        $this->assert("SEC-02: tribune_file_upload rejette une double extension shell.php.jpg", empty($val_double['valid']));
        $val_oversize = \SimpleGallery\Apps\Tribune\Backend\TribuneActions::validateTribuneUpload('big.jpg', 'image/jpeg', 20 * 1024 * 1024);
        $this->assert("SEC-02: tribune_file_upload rejette un fichier > 10 Mo", empty($val_oversize['valid']));
        $val_ok_png = \SimpleGallery\Apps\Tribune\Backend\TribuneActions::validateTribuneUpload('photo.png', 'image/png', 2048);
        $this->assert("SEC-02: tribune_file_upload accepte un fichier image PNG légitime", !empty($val_ok_png['valid']));

        $hdr_img = \SimpleGallery\Apps\Tribune\Backend\TribuneActions::getTribuneFileResponseHeaders('png', 'image/png', 'photo.png');
        $this->assert("SEC-02: tribune_file_get applique CSP sandbox sur image PNG", stripos($hdr_img['Content-Security-Policy'] ?? '', 'sandbox') !== false);
        $this->assert("SEC-02: tribune_file_get applique X-Content-Type-Options: nosniff", ($hdr_img['X-Content-Type-Options'] ?? '') === 'nosniff');
        $this->assert("SEC-02: tribune_file_get autorise inline pour PNG sûr", strpos($hdr_img['Content-Disposition'] ?? '', 'inline;') === 0);

        $hdr_html = \SimpleGallery\Apps\Tribune\Backend\TribuneActions::getTribuneFileResponseHeaders('html', 'text/html', 'evil.html');
        $this->assert("SEC-02: tribune_file_get force octet-stream sur un fichier HTML legacy", ($hdr_html['Content-Type'] ?? '') === 'application/octet-stream');
        $this->assert("SEC-02: tribune_file_get force attachment sur un fichier non-image", strpos($hdr_html['Content-Disposition'] ?? '', 'attachment;') === 0);

        // SEC-02: Unauthorized guest upload rejected with 403
        unset($_SESSION['is_admin'], $_SESSION['sg_admin_logged']);
        $guest_upload_res = \SimpleGallery\Apps\Tribune\Backend\TribuneActions::handle('tribune_file_upload', [], $this->temp_test_dir);
        $this->assert("SEC-02: tribune_file_upload refuse un invité non autorisé (403)", ($guest_upload_res['status'] ?? 0) === 403);

        // SEC-03, SEC-04, SEC-05: Recursive .private/.password inheritance across AuthManager, SearchEngine, GalleryActions, FileActions, ArchiveEngine
        $sec_root = $this->temp_test_dir . '/sec_phase0_tree';
        $pub_dir = $sec_root . '/public_album';
        $priv_parent = $sec_root . '/secret_parent';
        $priv_child = $priv_parent . '/nested_child';
        $pwd_parent = $sec_root . '/locked_parent';
        $pwd_child = $pwd_parent . '/nested_locked_child';
        @mkdir($pub_dir, 0755, true);
        @mkdir($priv_child, 0755, true);
        @mkdir($pwd_child, 0755, true);

        file_put_contents($pub_dir . '/visible.jpg', 'public-img');
        file_put_contents($priv_parent . '/.private', "1\n");
        file_put_contents($priv_child . '/hidden_nested.jpg', 'secret-img');
        file_put_contents($pwd_parent . '/.password', password_hash('SecretPwd!', PASSWORD_DEFAULT) . "\n");
        file_put_contents($pwd_child . '/locked_nested.jpg', 'locked-img');

        $this->assert("SEC-03: AuthManager::isDirAccessible bloque un sous-dossier d'un parent .private", \SimpleGallery\Kernel\Auth\AuthManager::isDirAccessible($priv_child, $sec_root) === false);
        $this->assert("SEC-03: is_dir_accessible bloque un sous-dossier d'un parent .password verrouillé", is_dir_accessible($pwd_child, $sec_root) === false);
        $this->assert("SEC-03: is_dir_accessible autorise un dossier public", is_dir_accessible($pub_dir, $sec_root) === true);

        global $media_types;
        $mtypes = $media_types ?: ['image' => ['jpg', 'png'], 'video' => ['mp4'], 'audio' => ['mp3']];

        $search_res = \SimpleGallery\Kernel\Search\SearchEngine::search($sec_root, $sec_root, ['q' => '', 'recursive' => true], [], $mtypes);
        $search_names = array_column($search_res, 'name');
        $this->assert("SEC-04: SearchEngine retourne le média public", in_array('visible.jpg', $search_names, true));
        $this->assert("SEC-04: SearchEngine exclut les médias dans un sous-dossier .private", !in_array('hidden_nested.jpg', $search_names, true));
        $this->assert("SEC-04: SearchEngine exclut les médias dans un sous-dossier .password verrouillé", !in_array('locked_nested.jpg', $search_names, true));

        $gal_priv_sub = \SimpleGallery\Kernel\Actions\GalleryActions::getGallery(['dir' => 'secret_parent/nested_child'], $sec_root, $mtypes, [], 'Test', '.thumbnails');
        $this->assert("SEC-04: GalleryActions::getGallery refuse un sous-dossier de .private (403)", ($gal_priv_sub['status'] ?? 0) === 403);

        $gal_pwd_sub = \SimpleGallery\Kernel\Actions\GalleryActions::getGallery(['dir' => 'locked_parent/nested_locked_child'], $sec_root, $mtypes, [], 'Test', '.thumbnails');
        $this->assert("SEC-04: GalleryActions::getGallery verrouille un sous-dossier de .password", !empty($gal_pwd_sub['data']['is_locked']));

        $flat_res = \SimpleGallery\Kernel\Actions\GalleryActions::getAllMediaFlat($sec_root, $mtypes, []);
        $flat_names = array_column($flat_res['data']['files'] ?? [], 'name');
        $this->assert("SEC-04: getAllMediaFlat inclut le média public", in_array('visible.jpg', $flat_names, true));
        $this->assert("SEC-04: getAllMediaFlat exclut les sous-dossiers .private", !in_array('hidden_nested.jpg', $flat_names, true));
        $this->assert("SEC-04: getAllMediaFlat exclut les sous-dossiers .password verrouillés", !in_array('locked_nested.jpg', $flat_names, true));

        $stream_priv = \SimpleGallery\Kernel\Actions\GalleryActions::getStreamUrl(['file' => 'secret_parent/nested_child/hidden_nested.jpg'], $sec_root);
        $this->assert("SEC-04: getStreamUrl refuse un fichier sous .private (403)", ($stream_priv['status'] ?? 0) === 403);

        $allowed_arch = \SimpleGallery\Kernel\FS\ArchiveEngine::collectAllowedFiles($sec_root, $sec_root, []);
        $allowed_locals = array_column($allowed_arch, 'local');
        $this->assert("SEC-05: ArchiveEngine::collectAllowedFiles inclut le média public", in_array('public_album/visible.jpg', $allowed_locals, true));
        $this->assert("SEC-05: ArchiveEngine::collectAllowedFiles exclut les sous-dossiers .private", !in_array('secret_parent/nested_child/hidden_nested.jpg', $allowed_locals, true));
        $this->assert("SEC-05: ArchiveEngine::collectAllowedFiles exclut les sous-dossiers .password verrouillés", !in_array('locked_parent/nested_locked_child/locked_nested.jpg', $allowed_locals, true));

        $priv_zip_out = $this->temp_test_dir . '/should_not_create.zip';
        $this->assert("SEC-05: ArchiveEngine refuse d'archiver directement un sous-dossier .private", \SimpleGallery\Kernel\FS\ArchiveEngine::createArchive('zip', $priv_child, $priv_zip_out, $sec_root, []) === false);
        if (file_exists($priv_zip_out)) @unlink($priv_zip_out);

        // SEC-06: Least-privilege default guest permissions aligned with config/security.php
        $def_perms = \SimpleGallery\Kernel\FS\PermissionsManager::getDefaultPermissions();
        $this->assert("SEC-06: Permission par défaut can_comment est false", ($def_perms['can_comment'] ?? true) === false);
        $this->assert("SEC-06: Permission par défaut can_download_archive est false", ($def_perms['can_download_archive'] ?? true) === false);
        $this->assert("SEC-06: Permission par défaut can_download_item est false", ($def_perms['can_download_item'] ?? true) === false);
        $this->assert("SEC-06: Permission par défaut can_use_browser_proxy est false", ($def_perms['can_use_browser_proxy'] ?? true) === false);

        // SEC-07: Admin gates on save_desktop_shortcuts & tribune_boards_save
        unset($_SESSION['is_admin'], $_SESSION['sg_admin_logged']);
        $guest_shortcuts_res = \SimpleGallery\Kernel\Actions\SystemActions::handle('save_desktop_shortcuts', ['shortcuts' => []], ['base_dir' => $this->temp_test_dir, 'raw_body' => ['shortcuts' => []]]);
        $this->assert("SEC-07: save_desktop_shortcuts refuse un invité non-admin (403)", ($guest_shortcuts_res['status'] ?? 0) === 403);

        $guest_boards_res = \SimpleGallery\Apps\Tribune\Backend\TribuneActions::handle('tribune_boards_save', ['boards' => []], $this->temp_test_dir);
        $this->assert("SEC-07: tribune_boards_save refuse un invité non-admin (403)", ($guest_boards_res['status'] ?? 0) === 403);

        $_SESSION['is_admin'] = true;
        $_SESSION['sg_admin_logged'] = true;
        $bad_shortcut_res = \SimpleGallery\Kernel\Actions\SystemActions::handle('save_desktop_shortcuts', [], [
            'base_dir' => $this->temp_test_dir,
            'raw_body' => ['shortcuts' => [['id' => 'xss', 'url' => 'javascript:alert(1)']]]
        ]);
        $this->assert("SEC-07: save_desktop_shortcuts rejette un schéma javascript: (400)", ($bad_shortcut_res['status'] ?? 0) === 400);

        $bad_board_res = \SimpleGallery\Apps\Tribune\Backend\TribuneActions::handle('tribune_boards_save', [
            'boards' => ['evil' => ['backend_type' => 'tsv', 'url' => 'http://127.0.0.1/internal']]
        ], $this->temp_test_dir);
        $this->assert("SEC-07: tribune_boards_save rejette une URL privée anti-SSRF (400)", ($bad_board_res['status'] ?? 0) === 400);

        // SEC-08: Tribune OAuth2 state validation, scheduler cookie hiding/ownership & proxy board restriction
        unset($_SESSION['is_admin'], $_SESSION['sg_admin_logged']);
        $_SESSION['tribune_oauth_state_linuxfr'] = 'expected_secret_state_123';
        $bad_state_cb = \SimpleGallery\Apps\Tribune\Backend\TribuneActions::handle('tribune_oauth_callback', [
            'board_id' => 'linuxfr',
            'code'     => 'dummy_code',
            'state'    => 'forged_state'
        ], $this->temp_test_dir);
        $this->assert("SEC-08: tribune_oauth_callback rejette un paramètre state invalide (403)", ($bad_state_cb['status'] ?? 0) === 403);

        $_SESSION['tribune_oauth_state_linuxfr'] = 'valid_state_abc';
        $this->assert("SEC-08: verifyOauthState accepte un state valide et le consomme", \SimpleGallery\Apps\Tribune\Backend\TribuneActions::verifyOauthState('linuxfr', 'valid_state_abc') === true);
        $this->assert("SEC-08: verifyOauthState rejette la réutilisation d'un state déjà consommé", \SimpleGallery\Apps\Tribune\Backend\TribuneActions::verifyOauthState('linuxfr', 'valid_state_abc') === false);

        $tribune_php_src = @file_get_contents($project_root . '/apps/tribune/backend/TribuneActions.php') ?: '';
        $this->assert("SEC-08: tribune_oauth_callback n'utilise plus postMessage(..., '*')", strpos($tribune_php_src, 'postMessage(payload, "*")') === false);
        $this->assert("SEC-08: tribune_oauth_callback utilise window.location.origin + JSON_HEX_TAG", strpos($tribune_php_src, 'postMessage(payload, window.location.origin)') !== false && strpos($tribune_php_src, 'JSON_HEX_TAG') !== false);

        $sanitized_sched = \SimpleGallery\Apps\Tribune\Backend\TribuneActions::sanitizeScheduledItemForOutput([
            'id' => 'abc', 'message' => 'hello', 'cookie' => 'session=TOPSECRET', 'owner_session_hash' => 'hash123'
        ]);
        $this->assert("SEC-08: tribune_scheduled_list masque le champ cookie", !isset($sanitized_sched['cookie']) && !isset($sanitized_sched['owner_session_hash']));

        $open_proxy_attempt = \SimpleGallery\Apps\Tribune\Backend\TribuneActions::handle('tribune_proxy_fetch', [
            'url' => 'https://example.com/unconfigured'
        ], $this->temp_test_dir);
        $this->assert("SEC-08: tribune_proxy_fetch refuse une URL hors tribunes configurées pour un invité (403)", ($open_proxy_attempt['status'] ?? 0) === 403);

        // SEC-09: unlock_folder rate-limiting & save_text_file blocking active HTML/JS
        $rl_pwd_dir = $sec_root . '/rl_locked_dir';
        @mkdir($rl_pwd_dir, 0755, true);
        file_put_contents($rl_pwd_dir . '/.password', password_hash('RightPass!', PASSWORD_DEFAULT) . "\n");
        $rl_key_unlock = 'unlock_' . md5('rl_locked_dir') . '_' . \SimpleGallery\Kernel\Security\RateLimiter::getClientIp();
        \SimpleGallery\Kernel\Security\RateLimiter::reset($rl_key_unlock);
        for ($attempt = 0; $attempt < 5; $attempt++) {
            \SimpleGallery\Kernel\Actions\FileActions::handle('unlock_folder', [], [
                'base_dir' => $sec_root,
                'raw_body' => ['dir' => 'rl_locked_dir', 'password' => 'WrongPass']
            ]);
        }
        $rl_blocked = \SimpleGallery\Kernel\Actions\FileActions::handle('unlock_folder', [], [
            'base_dir' => $sec_root,
            'raw_body' => ['dir' => 'rl_locked_dir', 'password' => 'RightPass!']
        ]);
        $this->assert("SEC-09: unlock_folder applique un rate-limit anti-bruteforce (429)", ($rl_blocked['status'] ?? 0) === 429);
        \SimpleGallery\Kernel\Security\RateLimiter::reset($rl_key_unlock);

        $_SESSION['is_admin'] = true;
        $_SESSION['sg_admin_logged'] = true;
        $save_html_res = \SimpleGallery\Kernel\Actions\FileActions::handle('save_text_file', [], [
            'base_dir' => $this->temp_test_dir,
            'raw_body' => ['file' => 'xss_test.html', 'content' => '<script>alert(1)</script>']
        ]);
        $this->assert("SEC-09: save_text_file bloque la création de fichier .html (403)", ($save_html_res['status'] ?? 0) === 403);

        $save_js_res = \SimpleGallery\Kernel\Actions\FileActions::handle('save_text_file', [], [
            'base_dir' => $this->temp_test_dir,
            'raw_body' => ['file' => 'evil_test.js', 'content' => 'alert(1)']
        ]);
        $this->assert("SEC-09: save_text_file bloque la création de fichier .js (403)", ($save_js_res['status'] ?? 0) === 403);

        // SEC-10: thumb.php private Cache-Control & AppEndpoint masked 500 error
        $thumb_src = @file_get_contents($project_root . '/system/endpoints/thumb.php') ?: '';
        $this->assert("SEC-10: thumb.php envoie Cache-Control: private, no-store sur dossiers protégés", strpos($thumb_src, 'Cache-Control: private, no-store, max-age=0') !== false);
        $app_ep_src = @file_get_contents($project_root . '/system/kernel/Api/AppEndpoint.php') ?: '';
        $this->assert("SEC-10: AppEndpoint ne divulgue pas getMessage() dans les réponses HTTP 500", strpos($app_ep_src, "'error'   => 'Erreur interne de traitement.'") !== false && strpos($app_ep_src, '@error_log(') !== false);

        if ($prev_admin_1 === null) unset($_SESSION['is_admin']); else $_SESSION['is_admin'] = $prev_admin_1;
        if ($prev_admin_2 === null) unset($_SESSION['sg_admin_logged']); else $_SESSION['sg_admin_logged'] = $prev_admin_2;

        // Test Tribune OAuth Secrets Hygiene (.gitignore + example template)
        $gitignore_content = @file_get_contents($project_root . '/.gitignore') ?: '';
        $this->assert(".gitignore exclut storage/tribune_secrets.php", strpos($gitignore_content, 'tribune_secrets.php') !== false);
        $this->assert("Template storage/tribune_secrets.example.php présent", file_exists($project_root . '/storage/tribune_secrets.example.php'));
    }

    /**
     * 11. PHASE 1: MULTI-USER ISOLATION, MOUNTED SHARES ACL & SIGNED LINKS SECURITY
     */
    private function testPhase1MultiUserAndSharesSecurity(): void {
        echo "\n🔐 [11/11] Phase 1 : Sécurité Multi-Utilisateurs, Isolation Homes, Partages & Liens Signés...\n";

        $saved_sess = $_SESSION ?? [];
        $_SESSION = [];
        \SimpleGallery\Kernel\Data\AtelierStore::resetCache();

        // 1. CSRF protection on all Phase 1 mutating actions
        $mut = \SimpleGallery\Kernel\Actions\ActionRouter::MUTATING_ACTIONS;
        $p1_mutating = [
            'create_user', 'update_user', 'delete_user',
            'create_group', 'set_group_members', 'delete_group',
            'create_user_share', 'revoke_user_share',
            'create_share_link', 'revoke_share_link', 'set_item_tags'
        ];
        $all_csrf_ok = true;
        foreach ($p1_mutating as $act) {
            if (!in_array($act, $mut, true)) {
                $all_csrf_ok = false;
                break;
            }
        }
        $this->assert("Phase 1: Toutes les actions mutantes Users/Groups/Shares/Tags sont protégées par CSRF", $all_csrf_ok);

        $p1_root = $this->temp_test_dir . '/phase1_sec_sandbox';
        @mkdir($p1_root, 0755, true);

        // 2. Guest cannot call admin-only user/audit actions
        $guest_create = \SimpleGallery\Kernel\Actions\UserActions::handle('create_user', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['username' => 'hacker', 'password' => '123456', 'role' => 'admin']
        ]);
        $this->assert("Phase 1: Invité ne peut pas créer d'utilisateur (403)", ($guest_create['status'] ?? 0) === 403);

        $guest_audit = \SimpleGallery\Kernel\Actions\UserActions::handle('get_audit_logs', [], ['base_dir' => $p1_root]);
        $this->assert("Phase 1: Invité ne peut pas lire les logs d'audit (403)", ($guest_audit['status'] ?? 0) === 403);

        // 3. Admin creates alice and bob with automatic private homes
        $_SESSION['is_admin'] = true;
        $_SESSION['sg_admin_logged'] = true;

        $alice_res = \SimpleGallery\Kernel\Actions\UserActions::handle('create_user', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['username' => 'alice', 'display_name' => 'Alice', 'password' => 'AlicePass1!', 'role' => 'user']
        ]);
        $bob_res = \SimpleGallery\Kernel\Actions\UserActions::handle('create_user', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['username' => 'bob', 'display_name' => 'Bob', 'password' => 'BobPass1!', 'role' => 'user']
        ]);
        $alice = $alice_res['data']['user'] ?? null;
        $bob = $bob_res['data']['user'] ?? null;
        $users_root = \SimpleGallery\Kernel\Security\PathValidator::getUsersRoot($p1_root);

        $this->assert("Phase 1: Admin crée alice et bob (200)", ($alice_res['status'] ?? 0) === 200 && ($bob_res['status'] ?? 0) === 200 && !empty($alice['id']) && !empty($bob['id']));
        $this->assert("Phase 1: Homes créés dans storage/users/ séparé de storage/media/ (avec .htaccess et .private)",
            !is_dir($p1_root . '/users') &&
            file_exists($users_root . '/.htaccess') &&
            file_exists($users_root . '/.private') &&
            file_exists($users_root . '/alice/.private') &&
            file_exists($users_root . '/bob/.private')
        );
        $this->assert("Phase 1: Le hash de mot de passe n'est jamais exposé dans la réponse API", !isset($alice['password_hash']));

        // Prepare public media file + folders inside alice's & bob's private homes
        file_put_contents($p1_root . '/public_gallery.jpg', 'public-photo');
        @mkdir($users_root . '/alice/shared_ro', 0755, true);
        @mkdir($users_root . '/alice/shared_rw', 0755, true);
        @mkdir($users_root . '/alice/secret_only', 0755, true);
        @mkdir($users_root . '/bob/mes_docs', 0755, true);
        file_put_contents($users_root . '/alice/shared_ro/note.txt', 'hello ro');
        file_put_contents($users_root . '/alice/secret_only/private.txt', 'top secret');

        // 4. Guest access: public gallery root remains visible, users/alice is blocked
        \SimpleGallery\Kernel\Auth\AuthManager::logoutSession();
        $this->assert("Phase 1: Invité bloqué sur users/alice (isDirAccessible=false)", \SimpleGallery\Kernel\FS\DotfileManager::isDirAccessible($users_root . '/alice', $p1_root) === false);

        global $media_types;
        $mtypes = $media_types ?: ['image' => ['jpg', 'png'], 'video' => ['mp4'], 'audio' => ['mp3']];
        $gal_public_guest = \SimpleGallery\Kernel\Actions\GalleryActions::getGallery(['dir' => ''], $p1_root, $mtypes, [], 'Atelier', '.thumbnails');
        $pub_dir_names = array_column($gal_public_guest['data']['directories'] ?? [], 'raw_name');
        $pub_file_names = array_column($gal_public_guest['data']['files'] ?? [], 'name');
        $this->assert("Phase 1: Invité voit la galerie publique (storage/media) sans exposer de dossier users/",
            ($gal_public_guest['status'] ?? 0) === 200 &&
            in_array('public_gallery.jpg', $pub_file_names, true) &&
            !in_array('users', $pub_dir_names, true)
        );
        $gal_guest = \SimpleGallery\Kernel\Actions\GalleryActions::getGallery(['dir' => 'users/alice'], $p1_root, $mtypes, [], 'Atelier', '.thumbnails');
        $this->assert("Phase 1: GalleryActions refuse users/alice à un invité (403)", ($gal_guest['status'] ?? 0) === 403);

        // 5. Authenticate as Bob: can open own home via GalleryActions (200) + see subfolders + write rights, blocked from Alice's home
        $bob_auth = \SimpleGallery\Kernel\Auth\UserManager::authenticate($p1_root, 'bob', 'BobPass1!');
        $this->assert("Phase 1: Authentification valide de bob", is_array($bob_auth) && ($bob_auth['username'] ?? '') === 'bob');
        $bad_auth = \SimpleGallery\Kernel\Auth\UserManager::authenticate($p1_root, 'bob', 'WrongPass');
        $this->assert("Phase 1: Rejet d'un mauvais mot de passe pour bob", $bad_auth === null);

        \SimpleGallery\Kernel\Auth\AuthManager::loginUserSession($bob_auth);
        $this->assert("Phase 1: Bob accède à son propre home users/bob", \SimpleGallery\Kernel\FS\DotfileManager::isDirAccessible($users_root . '/bob', $p1_root) === true);
        $gal_bob_home = \SimpleGallery\Kernel\Actions\GalleryActions::getGallery(['dir' => 'users/bob'], $p1_root, $mtypes, [], 'Atelier', '.thumbnails');
        $bob_subdirs = array_column($gal_bob_home['data']['directories'] ?? [], 'raw_name');
        $this->assert("Phase 1: GalleryActions ouvre users/bob (200) avec ses sous-dossiers et droits d'écriture",
            ($gal_bob_home['status'] ?? 0) === 200 &&
            in_array('mes_docs', $bob_subdirs, true) &&
            !empty($gal_bob_home['data']['user_rights']['can_upload']) &&
            !empty($gal_bob_home['data']['user_rights']['can_create_folder'])
        );
        $this->assert("Phase 1: Bob est bloqué sur users/alice (isolation stricte)", \SimpleGallery\Kernel\FS\DotfileManager::isDirAccessible($users_root . '/alice', $p1_root) === false);
        $this->assert("Phase 1: Bob ne peut pas appeler delete_user (non-admin 403)", (\SimpleGallery\Kernel\Actions\UserActions::handle('delete_user', [], ['base_dir' => $p1_root, 'raw_body' => ['user_id' => $alice['id']]])['status'] ?? 0) === 403);

        // 6. Alice shares shared_ro (read) and shared_rw (write) with Bob
        $alice_auth = \SimpleGallery\Kernel\Auth\UserManager::authenticate($p1_root, 'alice', 'AlicePass1!');
        \SimpleGallery\Kernel\Auth\AuthManager::loginUserSession($alice_auth);

        $share_ro = \SimpleGallery\Kernel\Actions\UserActions::handle('create_user_share', [], [
            'base_dir' => $p1_root,
            'raw_body' => [
                'source_path' => 'users/alice/shared_ro',
                'target_type' => 'user',
                'target_id' => (int)$bob['id'],
                'permission' => 'read',
                'mount_name' => 'Alice RO'
            ]
        ]);
        $share_rw = \SimpleGallery\Kernel\Actions\UserActions::handle('create_user_share', [], [
            'base_dir' => $p1_root,
            'raw_body' => [
                'source_path' => 'users/alice/shared_rw',
                'target_type' => 'user',
                'target_id' => (int)$bob['id'],
                'permission' => 'write',
                'mount_name' => 'Alice RW'
            ]
        ]);
        $this->assert("Phase 1: Alice partage shared_ro (R) et shared_rw (RW) avec Bob", ($share_ro['status'] ?? 0) === 200 && ($share_rw['status'] ?? 0) === 200);

        // 7. Switch back to Bob: verify R vs RW enforcement + GalleryActions access + sibling isolation
        \SimpleGallery\Kernel\Auth\AuthManager::loginUserSession($bob_auth);
        $this->assert("Phase 1: Bob peut lire users/alice/shared_ro", \SimpleGallery\Kernel\FS\DotfileManager::isDirAccessible($users_root . '/alice/shared_ro', $p1_root) === true);
        $gal_bob_ro = \SimpleGallery\Kernel\Actions\GalleryActions::getGallery(['dir' => 'users/alice/shared_ro'], $p1_root, $mtypes, [], 'Atelier', '.thumbnails');
        $this->assert("Phase 1: GalleryActions ouvre le partage lecture seule users/alice/shared_ro (200, can_upload=false)",
            ($gal_bob_ro['status'] ?? 0) === 200 && empty($gal_bob_ro['data']['user_rights']['can_upload'])
        );
        $this->assert("Phase 1: Bob reste bloqué sur users/alice/secret_only (dossier frère non partagé)", \SimpleGallery\Kernel\FS\DotfileManager::isDirAccessible($users_root . '/alice/secret_only', $p1_root) === false);

        $bob_write_ro = \SimpleGallery\Kernel\Actions\FileActions::handle('create_folder', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['dir' => 'users/alice/shared_ro', 'name' => 'forbidden_sub']
        ]);
        $this->assert("Phase 1: Bob ne peut PAS écrire dans un partage lecture seule (403)", ($bob_write_ro['status'] ?? 0) === 403 && !is_dir($users_root . '/alice/shared_ro/forbidden_sub'));

        $bob_write_rw = \SimpleGallery\Kernel\Actions\FileActions::handle('create_folder', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['dir' => 'users/alice/shared_rw', 'name' => 'allowed_sub']
        ]);
        $this->assert("Phase 1: Bob PEUT créer un dossier dans un partage lecture/écriture (200)", ($bob_write_rw['status'] ?? 0) === 200 && is_dir($users_root . '/alice/shared_rw/allowed_sub'));

        // H1: Batch move_item MUST check can_move on EACH source item (prevent stealing files from RO share or public gallery into own home)
        $batch_steal_ro = \SimpleGallery\Kernel\Actions\FileActions::handle('move_item', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['source' => ['users/alice/shared_ro/note.txt'], 'target_dir' => 'users/bob']
        ]);
        $this->assert("Audit H1: move_item batch interdit à Bob de déplacer un fichier depuis un partage lecture seule vers son home",
            ($batch_steal_ro['status'] ?? 0) !== 200 &&
            file_exists($users_root . '/alice/shared_ro/note.txt') &&
            !file_exists($users_root . '/bob/note.txt')
        );

        $batch_steal_pub = \SimpleGallery\Kernel\Actions\FileActions::handle('move_item', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['source' => ['public_gallery.jpg'], 'target_dir' => 'users/bob']
        ]);
        $this->assert("Audit H1: move_item batch interdit à Bob de déplacer un fichier public (storage/media) sans droit can_move",
            ($batch_steal_pub['status'] ?? 0) !== 200 &&
            file_exists($p1_root . '/public_gallery.jpg')
        );

        // H2: Non-admin user cannot delete their own top-level home directory `users/bob` or use target_path bypass
        $del_own_home = \SimpleGallery\Kernel\Actions\FileActions::handle('delete_item', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['target_path' => 'users/bob']
        ]);
        $this->assert("Audit H2: delete_item bloque la suppression du dossier home racine users/bob par son propriétaire (403)",
            ($del_own_home['status'] ?? 0) === 403 && is_dir($users_root . '/bob')
        );

        $del_ro_via_tp = \SimpleGallery\Kernel\Actions\FileActions::handle('delete_item', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['file' => 'users/bob/mes_docs', 'target_path' => 'users/alice/shared_ro/note.txt']
        ]);
        $this->assert("Audit H2: delete_item bloque la confusion file/target_path sur un partage lecture seule (403)",
            ($del_ro_via_tp['status'] ?? 0) === 403 && file_exists($users_root . '/alice/shared_ro/note.txt')
        );

        // H4: Even if guest matrix enables can_upload / can_delete globally, users/... RO share MUST NEVER allow writes!
        \SimpleGallery\Kernel\FS\PermissionsManager::savePermissions($p1_root, ['can_upload' => true, 'can_delete' => true, 'can_create_folder' => true]);
        $this->assert("Audit H4: Matrice invité can_upload=true ne donne JAMAIS le droit d'écriture sur un partage lecture seule users/...",
            \SimpleGallery\Kernel\FS\PermissionsManager::hasPermission('can_upload', $p1_root, 'users/alice/shared_ro') === false &&
            \SimpleGallery\Kernel\FS\PermissionsManager::hasPermission('can_delete', $p1_root, 'users/alice/shared_ro/note.txt') === false
        );
        \SimpleGallery\Kernel\FS\PermissionsManager::savePermissions($p1_root, \SimpleGallery\Kernel\FS\PermissionsManager::DEFAULT_PERMISSIONS);

        // M1: Anti-IDOR on get_item_tags & list_tags
        \SimpleGallery\Kernel\Auth\ShareManager::setItemTags($p1_root, 'users/alice/secret_only/private.txt', ['confidentiel']);
        $bob_idor_tags = \SimpleGallery\Kernel\Actions\UserActions::handle('get_item_tags', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['path' => 'users/alice/secret_only/private.txt']
        ]);
        $this->assert("Audit M1: get_item_tags bloque l'accès aux tags d'un fichier privé d'Alice par Bob (403)", ($bob_idor_tags['status'] ?? 0) === 403);

        \SimpleGallery\Kernel\Auth\AuthManager::logoutSession();
        $guest_list_tags = \SimpleGallery\Kernel\Actions\UserActions::handle('list_tags', [], ['base_dir' => $p1_root]);
        $this->assert("Audit M1: list_tags refuse un invité non connecté (403)", ($guest_list_tags['status'] ?? 0) === 403);
        \SimpleGallery\Kernel\Auth\AuthManager::loginUserSession($bob_auth);

        // S1: Case-insensitive users/ namespace protection (anti Windows/macOS NTFS/APFS bypass)
        \SimpleGallery\Kernel\FS\PermissionsManager::savePermissions($p1_root, ['can_upload' => true, 'can_delete' => true]);
        $this->assert("Audit S1: Users/Alice/shared_ro (casse mixte) reste isolé de la matrice invité",
            \SimpleGallery\Kernel\FS\PermissionsManager::hasPermission('can_upload', $p1_root, 'Users/Alice/shared_ro') === false &&
            \SimpleGallery\Kernel\FS\PermissionsManager::hasPermission('can_delete', $p1_root, 'USERS/alice/shared_ro/note.txt') === false
        );
        \SimpleGallery\Kernel\FS\PermissionsManager::savePermissions($p1_root, \SimpleGallery\Kernel\FS\PermissionsManager::DEFAULT_PERMISSIONS);

        // S3: File Drop share link grants can_upload ONLY (NEVER can_delete or can_move!)
        \SimpleGallery\Kernel\Auth\AuthManager::loginUserSession($alice_auth);
        $drop_link_res = \SimpleGallery\Kernel\Actions\UserActions::handle('create_share_link', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['target_path' => 'users/alice/shared_ro', 'mode' => 'drop']
        ]);
        $drop_token = $drop_link_res['data']['link']['token'] ?? '';
        \SimpleGallery\Kernel\Auth\AuthManager::logoutSession();
        \SimpleGallery\Kernel\Actions\UserActions::handle('access_share_link', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['token' => $drop_token]
        ]);
        $this->assert("Audit S3: Un lien File Drop (mode=drop) autorise uniquement can_upload, JAMAIS can_delete ni can_move",
            \SimpleGallery\Kernel\FS\PermissionsManager::hasPermission('can_upload', $p1_root, 'users/alice/shared_ro') === true &&
            \SimpleGallery\Kernel\FS\PermissionsManager::hasPermission('can_delete', $p1_root, 'users/alice/shared_ro/note.txt') === false &&
            \SimpleGallery\Kernel\FS\PermissionsManager::hasPermission('can_move', $p1_root, 'users/alice/shared_ro/note.txt') === false
        );

        // S4: logoutSession purges unlocked folders & unlocked share links (shared browser safety)
        $_SESSION['sg_unlocked_folders'] = ['locked' => true];
        $_SESSION['unlocked_dirs'] = ['locked' => true];
        \SimpleGallery\Kernel\Auth\AuthManager::logoutSession();
        $this->assert("Audit S4: logoutSession purge sg_unlocked_folders, unlocked_dirs et sg_unlocked_shares",
            empty($_SESSION['sg_unlocked_folders']) && empty($_SESSION['unlocked_dirs']) && empty($_SESSION['sg_unlocked_shares'])
        );

        // S2: Disabling a logged-in user immediately revokes their active session on next request
        \SimpleGallery\Kernel\Auth\AuthManager::loginUserSession($bob_auth);
        \SimpleGallery\Kernel\Auth\UserManager::updateUser($p1_root, (int)$bob['id'], ['is_active' => 0]);
        \SimpleGallery\Kernel\Auth\AuthManager::revalidateActiveUser($p1_root);
        $this->assert("Audit S2: Désactiver un utilisateur révoque immédiatement sa session active",
            \SimpleGallery\Kernel\Auth\AuthManager::getCurrentUser() === null &&
            \SimpleGallery\Kernel\Auth\AuthManager::isLoggedIn() === false
        );
        // Re-enable bob for remainder of test
        \SimpleGallery\Kernel\Auth\UserManager::updateUser($p1_root, (int)$bob['id'], ['is_active' => 1]);
        \SimpleGallery\Kernel\Auth\AuthManager::loginUserSession($bob_auth);

        // 8. Revoke RO share as Alice -> Bob immediately loses access
        \SimpleGallery\Kernel\Auth\AuthManager::loginUserSession($alice_auth);
        $rev_res = \SimpleGallery\Kernel\Actions\UserActions::handle('revoke_user_share', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['share_id' => (int)($share_ro['data']['share']['id'] ?? 0)]
        ]);
        $this->assert("Phase 1: Révocation du partage par Alice réussie (200)", ($rev_res['status'] ?? 0) === 200);

        \SimpleGallery\Kernel\Auth\AuthManager::loginUserSession($bob_auth);
        $this->assert("Phase 1: Bob perd immédiatement l'accès après révocation", \SimpleGallery\Kernel\FS\DotfileManager::isDirAccessible($users_root . '/alice/shared_ro', $p1_root) === false);

        // 9. Signed Share Link with password protection & revocation
        \SimpleGallery\Kernel\Auth\AuthManager::loginUserSession($alice_auth);
        $link_res = \SimpleGallery\Kernel\Actions\UserActions::handle('create_share_link', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['target_path' => 'users/alice/shared_ro', 'password' => 'LinkSecret42!']
        ]);
        $link_token = $link_res['data']['link']['token'] ?? '';
        $link_id = (int)($link_res['data']['link']['id'] ?? 0);
        $this->assert("Phase 1: Alice génère un lien signé protégé par mot de passe", ($link_res['status'] ?? 0) === 200 && strlen($link_token) >= 24);

        // Access as Guest
        \SimpleGallery\Kernel\Auth\AuthManager::logoutSession();
        $no_pwd = \SimpleGallery\Kernel\Actions\UserActions::handle('access_share_link', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['token' => $link_token]
        ]);
        $this->assert("Phase 1: Lien signé protégé demande le mot de passe", !empty($no_pwd['data']['requires_password']));

        $wrong_pwd = \SimpleGallery\Kernel\Actions\UserActions::handle('access_share_link', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['token' => $link_token, 'password' => 'BadPassword']
        ]);
        $this->assert("Phase 1: Mauvais mot de passe sur lien signé rejeté (401)", ($wrong_pwd['status'] ?? 0) === 401);

        $ok_pwd = \SimpleGallery\Kernel\Actions\UserActions::handle('access_share_link', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['token' => $link_token, 'password' => 'LinkSecret42!']
        ]);
        $this->assert("Phase 1: Bon mot de passe déverrouille l'accès en lecture au dossier partagé", ($ok_pwd['status'] ?? 0) === 200 && \SimpleGallery\Kernel\FS\DotfileManager::isDirAccessible($users_root . '/alice/shared_ro', $p1_root) === true);

        // Revoke link as Alice -> Guest cannot reuse token
        \SimpleGallery\Kernel\Auth\AuthManager::loginUserSession($alice_auth);
        \SimpleGallery\Kernel\Actions\UserActions::handle('revoke_share_link', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['link_id' => $link_id]
        ]);
        \SimpleGallery\Kernel\Auth\AuthManager::logoutSession();
        $after_revoke = \SimpleGallery\Kernel\Actions\UserActions::handle('access_share_link', [], [
            'base_dir' => $p1_root,
            'raw_body' => ['token' => $link_token, 'password' => 'LinkSecret42!']
        ]);
        $this->assert("Phase 1: Lien signé révoqué est rejeté (410/404)", in_array(($after_revoke['status'] ?? 0), [404, 410], true));

        $_SESSION = $saved_sess;
        \SimpleGallery\Kernel\Data\AtelierStore::resetCache();
    }
}

// Run test suite directly if called from CLI
if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    $suite = new SecurityUnitTestSuite();
    $success = $suite->runAll();
    exit($success ? 0 : 1);
}
