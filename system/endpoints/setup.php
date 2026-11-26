<?php
/**
 * Atelier by GallusTech - First-Run Web Setup Wizard Endpoint (`system/endpoints/setup.php` -> `/setup`)
 * Self-locks with HTTP 403 once an administrator account exists.
 */

require_once __DIR__ . '/../boot/bootstrap.php';

use SimpleGallery\Kernel\Auth\AuthManager;
use SimpleGallery\Kernel\Security\CsrfGuard;
use SimpleGallery\Kernel\Setup\SetupWizard;

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');

$projectRoot = rtrim(str_replace('\\', '/', dirname(__DIR__, 2)), '/');
$mediaDir = $real_base_dir ?? ($projectRoot . '/storage/media');

AuthManager::ensureSessionStarted();
$csrfToken = CsrfGuard::getToken();

if (!SetupWizard::isSetupRequired($projectRoot)) {
    http_response_code(403);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Atelier Setup</title></head>'
        . '<body style="font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">'
        . '<div style="max-width:440px;padding:28px;border-radius:14px;background:#1e293b;border:1px solid #334155;text-align:center;">'
        . '<h2 style="margin-top:0;">🔒 Installation déjà terminée</h2>'
        . '<p style="color:#94a3b8;">Un compte administrateur est déjà configuré. L\'assistant d\'installation est verrouillé pour des raisons de sécurité.</p>'
        . '<a href="./" style="display:inline-block;margin-top:10px;padding:9px 18px;border-radius:8px;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;">Ouvrir Atelier</a>'
        . '</div></body></html>';
    exit;
}

$diag = SetupWizard::getEnvironmentDiagnostics($projectRoot);
$errorMsg = '';
$successDone = false;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $postedCsrf = (string)($_POST['csrf_token'] ?? '');
    if (!CsrfGuard::validate($postedCsrf)) {
        $errorMsg = 'Jeton CSRF invalide. Rechargez la page et réessayez.';
    } else {
        $res = SetupWizard::completeSetup($projectRoot, $mediaDir, [
            'username'        => (string)($_POST['username'] ?? 'admin'),
            'display_name'    => (string)($_POST['display_name'] ?? 'Administrator'),
            'email'           => (string)($_POST['email'] ?? ''),
            'password'        => (string)($_POST['password'] ?? ''),
            'public_base_url' => (string)($_POST['public_base_url'] ?? '')
        ]);
        if (!empty($res['success'])) {
            $successDone = true;
        } else {
            $errorMsg = (string)($res['error'] ?? 'Setup failed.');
        }
    }
}

header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Atelier by GallusTech — Assistant d'installation</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px;display:flex;justify-content:center;align-items:center;min-height:100vh;box-sizing:border-box}
    .card{width:100%;max-width:620px;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:28px;box-shadow:0 20px 50px rgba(0,0,0,.4)}
    h1{margin:0 0 6px;font-size:1.35rem}
    .sub{color:#94a3b8;font-size:.9rem;margin:0 0 20px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-bottom:20px}
    .chk{padding:8px 10px;border-radius:8px;background:#0f172a;border:1px solid #334155;font-size:.82rem;display:flex;justify-content:space-between;align-items:center}
    label{display:flex;flex-direction:column;gap:4px;font-size:.82rem;color:#cbd5e1;margin-bottom:12px}
    input{padding:9px 11px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#f8fafc;font-size:.9rem}
    .btn{width:100%;padding:11px;border-radius:9px;border:none;background:linear-gradient(135deg,#4f46e5,#2563eb);color:#fff;font-weight:700;font-size:.95rem;cursor:pointer}
    .err{padding:10px 12px;border-radius:8px;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);color:#fca5a5;margin-bottom:14px;font-size:.86rem}
    .ok{padding:14px;border-radius:10px;background:rgba(34,197,94,.14);border:1px solid rgba(34,197,94,.4);color:#86efac;text-align:center}
  </style>
</head>
<body>
  <div class="card">
    <h1>✨ Atelier by GallusTech — Premier démarrage</h1>
    <p class="sub">Diagnostic de l'environnement serveur et création du compte SuperAdmin initial.</p>

    <div class="grid">
      <?php foreach ($diag['checks'] as $c): ?>
        <div class="chk">
          <span><?php echo htmlspecialchars($c['label'], ENT_QUOTES, 'UTF-8'); ?></span>
          <span><?php echo !empty($c['ok']) ? '✅' : (!empty($c['required']) ? '❌' : '⚠️'); ?></span>
        </div>
      <?php endforeach; ?>
    </div>

    <?php if ($successDone): ?>
      <div class="ok">
        <p style="margin:0 0 12px;font-weight:700;">✅ Compte SuperAdmin créé et assistant verrouillé !</p>
        <a href="./" style="display:inline-block;padding:9px 18px;border-radius:8px;background:#16a34a;color:#fff;text-decoration:none;font-weight:600;">Accéder à Atelier</a>
      </div>
    <?php else: ?>
      <?php if ($errorMsg !== ''): ?>
        <div class="err">❌ <?php echo htmlspecialchars($errorMsg, ENT_QUOTES, 'UTF-8'); ?></div>
      <?php endif; ?>
      <form method="post">
        <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8'); ?>">
        <label>Identifiant SuperAdmin<input type="text" name="username" value="admin" required pattern="[a-zA-Z0-9._-]{3,32}"></label>
        <label>Nom affiché<input type="text" name="display_name" value="Administrateur" required></label>
        <label>Adresse e-mail (optionnelle)<input type="email" name="email" placeholder="admin@studio.fr"></label>
        <label>Mot de passe (min. 10 caractères)<input type="password" name="password" required minlength="10" autocomplete="new-password"></label>
        <label>URL publique de base (optionnelle, pour liens /s/, OIDC et WebDAV)<input type="url" name="public_base_url" placeholder="https://cloud.monstudio.fr"></label>
        <button type="submit" class="btn" <?php echo empty($diag['ready']) ? 'disabled' : ''; ?>>Créer le SuperAdmin et verrouiller l'assistant</button>
      </form>
    <?php endif; ?>
  </div>
</body>
</html>
