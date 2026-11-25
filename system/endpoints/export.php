<?php
/**
 * Atelier by GallusTech - Signed Time-Limited Account Data Export Endpoint
 * Works with a signed token (even after account deletion / logout):
 *  - GET  ?token=<token>             : Status, SHA-256 checksum, Download & Complete Receipt Confirmation UI
 *  - GET  ?token=<token>&download=1  : Streams ZIP archive and records byte-exact transfer completion
 *  - POST token=<token>&action=confirm_receipt : Confirms complete receipt and purges ZIP from disk
 */

$project_root = dirname(dirname(__DIR__));
require_once $project_root . '/system/boot/bootstrap.php';
require_once $project_root . '/system/kernel/functions.php';

use SimpleGallery\Kernel\Auth\AccountExportService;

$token = trim((string)($_GET['token'] ?? $_POST['token'] ?? ''));
$isDownload = !empty($_GET['download']);
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$wantsJson = stripos((string)($_SERVER['HTTP_ACCEPT'] ?? ''), 'application/json') !== false || !empty($_GET['json']);

function esc_html_export(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function format_export_size(int $bytes): string {
    if ($bytes >= 1073741824) return number_format($bytes / 1073741824, 2) . ' Go';
    if ($bytes >= 1048576) return number_format($bytes / 1048576, 2) . ' Mo';
    if ($bytes >= 1024) return number_format($bytes / 1024, 1) . ' Ko';
    return $bytes . ' o';
}

// 1. Handle POST receipt confirmation
$postNotice = null;
$postError = null;
if ($method === 'POST' && ($_POST['action'] ?? '') === 'confirm_receipt') {
    $discard = !empty($_POST['discard_without_download']);
    $res = AccountExportService::confirmReceipt($project_root, $token, null, null, $discard);
    if ($wantsJson) {
        http_response_code($res['status'] ?? 200);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($res, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }
    if (!empty($res['success'])) {
        $postNotice = 'Réception confirmée : votre archive temporaire a été définitivement supprimée du serveur.';
    } else {
        $postError = (string)($res['error'] ?? 'Impossible de confirmer la réception.');
    }
}

// 2. Inspect signed token
$info = AccountExportService::inspectByToken($project_root, $token);

// 3. Handle ZIP binary streaming with exact byte verification
if ($isDownload) {
    if (empty($info['success']) || empty($info['abs_path']) || !is_file($info['abs_path'])) {
        http_response_code($info['status'] ?? 404);
        header('Content-Type: text/plain; charset=utf-8');
        echo (string)($info['error'] ?? 'Archive unavailable.');
        exit;
    }

    $absPath = (string)$info['abs_path'];
    $exp = $info['export'];
    $filename = preg_replace('/[^a-zA-Z0-9._-]/', '_', (string)$exp['filename']);
    $size = (int)@filesize($absPath);

    if (ob_get_level()) {
        while (ob_get_level()) {
            @ob_end_clean();
        }
    }
    @ignore_user_abort(false);
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . $size);
    header('X-Export-SHA256: ' . (string)$exp['sha256']);
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('Pragma: no-cache');
    header('Expires: 0');

    $fh = @fopen($absPath, 'rb');
    $bytesSent = 0;
    if ($fh) {
        while (!feof($fh) && !connection_aborted()) {
            $chunk = fread($fh, 65536);
            if ($chunk === false || $chunk === '') break;
            echo $chunk;
            $bytesSent += strlen($chunk);
            @flush();
        }
        fclose($fh);
    }

    if (!connection_aborted() && $bytesSent >= $size && $size > 0) {
        AccountExportService::markDownloadCompleted($project_root, (int)$info['token_id'], $bytesSent);
    }
    exit;
}

if ($wantsJson) {
    http_response_code($info['status'] ?? 200);
    header('Content-Type: application/json; charset=utf-8');
    unset($info['abs_path']);
    echo json_encode($info, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

// 4. Standalone self-contained HTML Portal Page (download + SHA-256 + confirm complete receipt)
http_response_code(!empty($info['success']) ? 200 : ($postNotice ? 200 : ($info['status'] ?? 404)));
header('Content-Type: text/html; charset=utf-8');
header('X-Frame-Options: SAMEORIGIN');
header('Cache-Control: no-store, no-cache, must-revalidate');

$exp = $info['export'] ?? null;
$downloadUrl = '?token=' . rawurlencode($token) . '&download=1';
$canConfirm = is_array($exp) && !empty($exp['download_completed_at']);
?>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Atelier — Archive de données personnelles</title>
  <style>
    :root { color-scheme: dark; }
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:radial-gradient(circle at 20% 20%, #1e1b4b, #0b0f19 70%); color:#f8fafc; }
    .card { width:100%; max-width:560px; background:rgba(15,23,42,0.88); border:1px solid rgba(255,255,255,0.12); border-radius:16px; padding:26px; box-shadow:0 24px 60px rgba(0,0,0,0.5); }
    .brand { display:flex; align-items:center; gap:10px; margin-bottom:18px; }
    .logo { width:34px; height:34px; border-radius:9px; background:linear-gradient(135deg,#4f46e5,#2563eb); display:flex; align-items:center; justify-content:center; font-weight:800; font-size:1rem; }
    h1 { margin:0 0 8px; font-size:1.2rem; }
    p { margin:0 0 12px; color:#94a3b8; font-size:0.9rem; line-height:1.5; }
    .meta { background:rgba(2,6,23,0.55); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:12px 14px; margin:14px 0; font-size:0.84rem; display:flex; flex-direction:column; gap:6px; }
    .meta code { font-family:ui-monospace,Consolas,monospace; font-size:0.76rem; word-break:break-all; color:#a5b4fc; }
    .btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:11px 16px; border-radius:9px; border:none; font-weight:600; font-size:0.92rem; cursor:pointer; text-decoration:none; box-sizing:border-box; margin-top:8px; }
    .btn-primary { background:linear-gradient(135deg,#4f46e5,#2563eb); color:#fff; }
    .btn-success { background:#16a34a; color:#fff; }
    .btn-muted { background:rgba(148,163,184,0.14); color:#cbd5e1; border:1px solid rgba(148,163,184,0.25); }
    .alert { padding:11px 14px; border-radius:9px; font-size:0.86rem; margin-bottom:14px; }
    .alert-ok { background:rgba(34,197,94,0.15); border:1px solid rgba(34,197,94,0.4); color:#86efac; }
    .alert-err { background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.4); color:#fca5a5; }
    .alert-info { background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.35); color:#bae6fd; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <div class="logo">A</div>
      <div>
        <div style="font-weight:700;">Atelier <span style="font-weight:400;opacity:0.7;font-size:0.84rem;">by GallusTech</span></div>
        <div style="font-size:0.76rem;color:#94a3b8;">Export de données personnelles (archive signée)</div>
      </div>
    </div>

    <?php if ($postNotice): ?>
      <div class="alert alert-ok">✅ <?php echo esc_html_export($postNotice); ?></div>
    <?php elseif ($postError): ?>
      <div class="alert alert-err">❌ <?php echo esc_html_export($postError); ?></div>
    <?php endif; ?>

    <?php if (!empty($info['success']) && is_array($exp)): ?>
      <h1>📦 Votre archive est prête</h1>
      <p>Ce lien signé est temporaire. Téléchargez l'archive complète, vérifiez son empreinte SHA-256 si nécessaire, puis confirmez la réception complète pour purger le fichier du serveur.</p>

      <div class="meta">
        <div><strong>Fichier :</strong> <?php echo esc_html_export((string)$exp['filename']); ?></div>
        <div><strong>Taille :</strong> <?php echo esc_html_export(format_export_size((int)$exp['size_bytes'])); ?> (<?php echo (int)$exp['file_count']; ?> fichier(s))</div>
        <div><strong>Expire le :</strong> <?php echo esc_html_export(gmdate('Y-m-d H:i', (int)$exp['expires_at'])); ?> UTC</div>
        <div><strong>Téléchargements complets :</strong> <?php echo (int)$exp['download_count']; ?></div>
        <div><strong>SHA-256 :</strong><br><code><?php echo esc_html_export((string)$exp['sha256']); ?></code></div>
      </div>

      <a class="btn btn-primary" href="<?php echo esc_html_export($downloadUrl); ?>" onclick="setTimeout(function(){ window.location.reload(); }, 2500);">
        ⬇️ Télécharger l'archive ZIP
      </a>

      <?php if ($canConfirm): ?>
        <div class="alert alert-info" style="margin-top:14px;margin-bottom:6px;">
          ✅ Un téléchargement complet a été détecté par le serveur. Confirmez la réception pour supprimer immédiatement cette copie du serveur.
        </div>
        <form method="POST">
          <input type="hidden" name="token" value="<?php echo esc_html_export($token); ?>">
          <input type="hidden" name="action" value="confirm_receipt">
          <button type="submit" class="btn btn-success">✅ Confirmer la réception complète &amp; purger du serveur</button>
        </form>
      <?php else: ?>
        <p style="margin-top:12px;font-size:0.8rem;">Après le téléchargement complet de l'archive, actualisez cette page pour activer le bouton de confirmation de réception complète.</p>
        <a class="btn btn-muted" href="?token=<?php echo esc_html_export(rawurlencode($token)); ?>">🔄 Actualiser le statut</a>
      <?php endif; ?>
    <?php else: ?>
      <h1>🔒 Archive indisponible</h1>
      <p><?php echo esc_html_export((string)($info['error'] ?? 'Ce lien d\'export est invalide, expiré ou a déjà été confirmé et purgé.')); ?></p>
    <?php endif; ?>
  </div>
</body>
</html>
