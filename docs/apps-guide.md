# 🛠️ Guide & Kit Développeur — Création d'Applications WebOS

Ce guide de référence explique comment concevoir, sécuriser, traduire, tester et intégrer une application dans **Atelier by GallusTech**, qu'il s'agisse d'une **application native JS/PHP** ou d'une **application web/WASM autonome tierce**.

> 💡 **Squelette prêt à copier-coller** : consultez [`apps/template-app/`](../apps/template-app/) pour un exemple complet, fonctionnel et 100 % conforme à toutes les règles ci-dessous.

---

## 1. Anatomie d'une Application Native (`apps/<id>/`)

Toute application native vit dans son propre dossier sous `apps/` (ou dans une sous-catégorie comme `apps/games/<id>/`) et est **auto-découverte** par `PluginDiscovery` sans aucune modification de `index.php` :

```text
apps/mon-outil/
├── manifest.json        # OBLIGATOIRE — Métadonnées, scripts, fenêtre, backend, commandes
├── app.js               # OBLIGATOIRE — Classe héritant de WebOSApp
├── engine.js            # (Optionnel) — Sous-modules JS déclarés dans manifest.scripts
├── style.css            # (Recommandé) — Styles CSS adaptatifs aux thèmes WebOS
├── backend/             # (Optionnel) — Contrôleurs PHP routés via manifest.backend (ActionRouter)
│   └── MonOutilActions.php
├── template.php         # (Optionnel) — Fragment HTML statique monté au chargement
└── locales/             # OBLIGATOIRE dès qu'il y a des textes UI — i18n isolée FR/EN/JA
    ├── fr.json
    ├── en.json
    └── ja.json
```

---

## 2. Déclaration dans `manifest.json`

`PluginDiscovery` lit `manifest.json` pour charger les scripts/styles dans le bon ordre (`css` → `scripts[]` → `entry.js`), enregistrer l'app dans `AppManager` (Menu Démarrer, Barre des Tâches, Paramètres, Autorun) et déclarer ses associations de fichiers et ses routes backend :

```json
{
  "id": "mon-outil",
  "name": "Mon Outil",
  "version": "1.0.0",
  "icon": "⚡",
  "author": "Votre Nom",
  "category": "utilities",
  "enabled_by_default": true,
  "autostartCapable": true,
  "extensions": ["txt", "csv"],
  "mimeTypes": ["text/plain", "text/csv"],
  "window": {
    "width": 860,
    "height": 600,
    "minWidth": 480,
    "minHeight": 360,
    "resizable": true,
    "maximizable": true
  },
  "scripts": [
    "engine.js"
  ],
  "entry": {
    "js": "app.js",
    "css": "style.css"
  },
  "locales": {
    "fr": { "title": "Mon Outil", "description": "Application utilitaire WebOS" },
    "en": { "title": "My Tool", "description": "WebOS utility application" },
    "ja": { "title": "マイツール", "description": "WebOSユーティリティアプリ" }
  }
}
```

### Champs clés du manifeste
- **`category`** : `media`, `productivity`, `utilities`, `games`, `system`, `development`.
- **`scripts`** : tableau de fichiers JS auxiliaires (chemins relatifs à l'app) chargés **avant** `entry.js` (ex. `math-engine.js`, `plotter.js` dans `apps/graphing-calc/`).
- **`enabled_by_default: false`** : recommandé pour les modules spécialisés ou internes devant rester masqués tant que l'Admin ne les active pas dans *Paramètres*.
- **`extensions` / `mimeTypes`** : inscrit l'app dans le menu contextuel *« Ouvrir avec »* de l'Explorateur et dans `AppManager.getAppsForFile()`.
- **`commands`** : expose des commandes pilotables par **Autorun Studio** (`AppManager.dispatchCommand`).
- **`backend`** *(optionnel)* : enregistre dynamiquement des actions dans `system/endpoints/api.php` (voir section 6).

---

## 3. Cycle de Vie `WebOSApp` (`window.sys.App`)

Hériter de `WebOSApp` gère automatiquement la création de fenêtre (`WindowManager`), la barre d'onglets, les changements de langue/thème, le stockage namespacé et le nettoyage des abonnements `EventBus`.

![Cycle de Vie d'une Application WebOS](assets/app-lifecycle.svg)

> [!IMPORTANT]
> **`renderTab(tabId)` vs `renderContent()`** :
> - Si vous passez un tableau `tabs: [...]` à `super({ ... })`, `WebOSApp.render()` appelle **`renderTab(tabId)`** (et **non** `renderContent()`).
> - Si votre app n'a **pas** d'onglets (`tabs` vide/omis), `WebOSApp.render()` appelle **`renderContent()`**.

### Patron de référence `app.js`

```javascript
(function (window) {
  'use strict';

  const WebOSApp = (window.sys && window.sys.App) || window.WebOSApp;

  class MonOutilApp extends WebOSApp {
    constructor() {
      super({
        id: 'mon-outil',
        title: 'apps.mon-outil.title',
        icon: '⚡',
        width: 860,
        height: 600,
        tabs: [
          { id: 'main',     label: 'mon_outil.tab_main', icon: '📋' },
          { id: 'settings', label: 'mon_outil.tab_cfg',  icon: '⚙️' }
        ]
      });

      // Client API routé via la passerelle unifiée system/endpoints/api.php (manifest.backend)
      this.appApi = (window.sys && window.sys.api)
        ? window.sys.api.forApp('mon-outil')
        : new window.SyscallClient('system/endpoints/api.php');
    }

    onInit() {
      // Abonnements automatiquement nettoyés dans close()
      this.subscribe('theme:changed', (theme) => this.onThemeChanged(theme));
    }

    onOpen(params) {
      this.registerMenus();
      if (params && params.file) {
        this.loadFile(params.file);
      }
    }

    onClose() {
      // Détacher ici tout timer, ResizeObserver ou listener global ajouté manuellement
    }

    onLocaleChanged() {
      if (this.window && window.WindowManager) {
        window.WindowManager.setTitle(this.window.id, `${this.icon} ${this.t('apps.mon-outil.title')}`);
      }
      this.registerMenus();
    }

    registerMenus() {
      if (!window.MenuBarManager || typeof window.MenuBarManager.registerAppMenu !== 'function') return;
      window.MenuBarManager.registerAppMenu('mon-outil', [
        {
          id: 'file',
          label: this.t('mon_outil.menu_file'),
          items: [
            { id: 'open', label: this.t('mon_outil.menu_open'), action: () => this.pickGalleryFile() },
            { id: 'opt-auto', checked: true, label: this.t('mon_outil.menu_auto'), action: () => {} },
            { separator: true },
            { id: 'close', label: this.t('common.close'), action: () => this.close() }
          ]
        }
      ]);
    }

    renderTab(tabId) {
      if (tabId === 'settings') {
        return `<div class="mon-outil-pane">${this.escapeHtml(this.t('mon_outil.settings_hint'))}</div>`;
      }
      return `
        <div class="mon-outil-pane">
          <button type="button" id="monOutilPickBtn">${this.escapeHtml(this.t('mon_outil.btn_pick'))}</button>
        </div>
      `;
    }

    bindEvents(container) {
      if (!container) return;
      container.querySelector('#monOutilPickBtn')?.addEventListener('click', () => this.pickGalleryFile());
    }

    async pickGalleryFile() {
      if (!window.sys || typeof window.sys.pickFile !== 'function') return;
      const file = await window.sys.pickFile({
        title: this.t('mon_outil.pick_title'),
        accept: 'image/*,.pdf'
      });
      if (file) {
        this.toast.success(this.t('mon_outil.opened_toast', { name: file.name }));
      }
    }
  }

  const instance = new MonOutilApp();
  window.MonOutilApp = instance;
  if (window.sys && window.sys.appManager) {
    window.sys.appManager.register(instance);
  }
})(window);
```

### Services Userland disponibles

| Service | Accès | Usage |
|---|---|---|
| **Syscalls Système** | `this.api` (`window.sys.api`) | `get(action, params)`, `post(action, payload)`, `upload(action, formData)`, `getText(url)`. Gère automatiquement `credentials: 'same-origin'`, `X-Requested-With` et `X-CSRF-Token`. |
| **API App (Backend)** | `window.sys.api.forApp('id')` | Route les actions déclarées dans `manifest.backend` via la passerelle unifiée `system/endpoints/api.php` avec la même protection CSRF. |
| **Sélecteur VFS** | `window.sys.pickFile()`, `pickFolder()`, `pickSaveLocation()` | Ouvre une boîte de dialogue modale sur les dossiers de la galerie (avec filtrage `accept` par extension/MIME et option repli PC). |
| **Stockage Client** | `this.storage` | `localStorage` namespacé sous `webos_app_<id>_<key>` (`get`, `set`, `remove`). |
| **Notifications** | `this.toast` | `.info()`, `.success()`, `.warning()`, `.error()`. |
| **Dialogues** | `this.dialog` | `.alert()`, `.confirm()`, `.prompt()` (ne jamais utiliser `window.alert()`). |
| **Bus IPC** | `this.subscribe(ev, cb)` / `window.sys.events.emit()` | Événements système (`locale:changed`, `theme:changed`, `app:launch`) et événements personnalisés. |
| **Barre de Menus** | `MenuBarManager.registerAppMenu(id, menus)` | Supporte `separator: true` et `checked: true/false` (affiche une coche `✓`). |
| **Échappement XSS** | `this.escapeHtml(str)` | Obligatoire pour toute donnée dynamique injectée dans un template HTML. |

---

## 4. Internationalisation (i18n) Isolée par Application

> [!CAUTION]
> **Deux règles impératives (`.agents/AGENTS.md`)** :
> 1. **Isolation par app** : toutes les chaînes propres à votre application **doivent** vivre dans `apps/<id>/locales/{fr,en,ja}.json` (et **jamais** dans le dossier racine `locales/` réservé au noyau WebOS). `PluginDiscovery::getAppTranslations()` les fusionne automatiquement au chargement.
> 2. **Zéro fallback hardcodé dans `this.t()`** :
>    - ❌ `this.t('mon_outil.save') || 'Enregistrer'`
>    - ❌ `this.t('mon_outil.save', 'Enregistrer')` *(le 2e paramètre est réservé à l'objet `{ cle: valeur }` de remplacement !)*
>    - ✅ `this.t('mon_outil.save')` ou `this.t('mon_outil.saved_msg', { name: file.name })`

Exemple `apps/mon-outil/locales/fr.json` (format plat recommandé, à maintenir en **parité exacte** avec `en.json` et `ja.json`) :

```json
{
  "apps.mon-outil.title": "Mon Outil",
  "mon_outil.tab_main": "Principal",
  "mon_outil.tab_cfg": "Réglages",
  "mon_outil.saved_msg": "Fichier enregistré : {name}"
}
```

---

## 5. Thèmes & Design System CSS

Atelier by GallusTech embarque 4 thèmes (`polaroid-classic`, `dark-glass`, `light-minimal`, `cyberpunk`). Pour garantir une lisibilité parfaite sur **tous** les thèmes (y compris le thème clair `light-minimal`), utilisez exclusivement les variables CSS système :

| Variable CSS | Rôle |
|---|---|
| `--window-bg` *(alias `--bg-panel`)* | Fond des fenêtres, menus déroulants et panneaux flottants |
| `--bg-main` | Fond de surface secondaire / zone de contenu |
| `--bg-card` | Fond des cartes et conteneurs internes |
| `--header-bg` / `--sidebar-bg` | En-têtes et barres latérales |
| `--text-main` / `--text-muted` | Texte principal et texte secondaire |
| `--border-color` / `--border-color-hover` | Bordures subtiles et bordures au survol |
| `--accent` *(alias `--accent-primary`)* | Couleur d'accentuation active |

Si vous dessinez dans un `<canvas>` (ex. `apps/graphing-calc/plotter.js`), détectez le thème clair via :

```javascript
const activeTheme = String(
  document.body?.getAttribute('data-theme') ||
  document.documentElement?.getAttribute('data-theme') || ''
).toLowerCase();
const isLight = activeTheme.includes('light');
```

---

## 6. Backend PHP & Exigences de Sécurité

> [!IMPORTANT]
> Pour empêcher toute exécution de code PHP arbitraire dans les bundles d'applications déposés sous `apps/`, Apache (`.htaccess`) et Nginx (`docker/nginx.conf`) bloquent strictement tout accès HTTP direct à `^/apps/.*\.php$` (`HTTP 403`).
> **Modèle unique recommandé** : déclarez votre contrôleur PHP dans `manifest.json` → `backend` ; le noyau le charge côté serveur via `system/endpoints/api.php` et `ActionRouter` avec vérification CSRF automatique.

### 1. Déclaration dans `manifest.json`
Déclarez le bloc `backend` dans `apps/<id>/manifest.json` (voir `apps/template-app/manifest.json`, `apps/browser/manifest.json` et `apps/tribune/manifest.json`) :

```json
"backend": {
  "file": "backend/MonOutilActions.php",
  "class": "Atelier\\Apps\\MonOutil\\Backend\\MonOutilActions",
  "actions": ["mon_outil_list", "mon_outil_save"],
  "mutating_actions": ["mon_outil_save"]
}
```

### 2. Contrôleur `apps/<id>/backend/MonOutilActions.php`

```php
<?php
namespace Atelier\Apps\MonOutil\Backend;

use Atelier\Kernel\FS\StorageRepository;
use Atelier\Kernel\Security\SecurityManager;

class MonOutilActions {
    public static function handle(string $action, array $params, array $context): ?array {
        // IMPORTANT (ARCH-01) : toujours utiliser project_root pour storage/, jamais base_dir (storage/media)
        $project_root = $context['project_root'] ?? $context['base_dir'];
        $storage = StorageRepository::forApp('mon-outil', $project_root);
        $is_admin = isset($context['is_admin']) ? !empty($context['is_admin']) : SecurityManager::isAdminLoggedIn();

        switch ($action) {
            case 'mon_outil_list':
                return ['status' => 200, 'data' => ['success' => true, 'items' => $storage->getJson('items.json', [])]];

            case 'mon_outil_save':
                // Action déclarée dans manifest.backend.mutating_actions -> POST + CSRF vérifiés automatiquement
                if (!$is_admin) {
                    return ['status' => 403, 'data' => ['success' => false, 'error' => 'Admin required']];
                }
                // Valider les entrées puis écrire atomiquement dans storage/apps/mon-outil/items.json
                $storage->saveJson('items.json', []);
                return ['status' => 200, 'data' => ['success' => true]];

            default:
                return null; // Retourne HTTP 404 JSON
        }
    }
}
```

### Checklist Sécurité Backend Obligatoire
- **Séparation `project_root` / `media_dir` (`ARCH-01`)** : écrire les données runtime uniquement dans `$project_root . '/storage/...'` (`StorageRepository::forApp()`), jamais dans `config/` ni dans `storage/media/`.
- **Contrôle d'accès VFS** : valider tout chemin de la galerie avec `PathValidator::sanitizeDirectory()` / `sanitizeFile()` **et** vérifier `DotfileManager::isDirAccessible($dir, $base_dir)` (héritage récursif `.private` / `.password`).
- **Autorisations** : vérifier `AuthManager::isAdminLoggedIn()` (ou `$context['is_admin']`) pour toute configuration globale, et `PermissionsManager::hasPermission('can_upload', ...)` pour les écritures invité.
- **Anti-SSRF & Rate Limiting** : utiliser exclusivement `UrlValidator::safeCurlFetch()` pour toute requête HTTP sortante (jamais `file_get_contents()` sur une URL), et `RateLimiter::check()` sur les endpoints sensibles.
- **Zéro `eval()` / `exec()` non contrôlé** : côté JS, ne jamais utiliser `eval()` ou `new Function()` sur des entrées utilisateur ; côté PHP, ne jamais exposer de shell système (`proc_open`).
- **Compatibilité PHP** : rester compatible **PHP 7.4+ / 8.x** (éviter les types union PHP 8.0+ dans les signatures).

---

## 7. Intégrer une Application Web / WASM Autonome (`WebAppHost`)

Vous pouvez déposer n'importe quelle application statique (HTML/JS/WASM/PWA — ex. éditeur Rust/egui, lecteur PDF, jeu Canvas) dans `apps/<dossier>/` **sans écrire de `manifest.json`** :

1. **`StandaloneWebAppManifestSynthesizer`** détecte automatiquement `index.html`, le titre, l'icône, les formats supportés (`extensions` / `mimeTypes`), les drapeaux de rendu (`?webgl`, `?cpu`) et `openFileParam` (`?file=...`).
2. **Surcharges administrateur** : créez ou éditez `config/external_apps.json` pour personnaliser l'icône, la catégorie, les dimensions ou le pont VFS sans toucher aux fichiers de l'app tierce :
   ```json
   {
     "photocraft": {
       "category": "media",
       "icon": "🎨",
       "vfsBridge": { "enabled": true, "hookOpen": true, "hookSave": true }
     }
   }
   ```
3. **Pont VFS Bidirectionnel (`WebAppVfsBridge`)** :
   - Pour toute app auto-hébergée en **same-origin** (`apps/...`), `WebAppVfsBridge` intercepte automatiquement `<input type="file">`, `showOpenFilePicker()`, `showSaveFilePicker()` et `<a download href="blob:...">` afin d'ouvrir et enregistrer directement dans la Galerie WebOS (avec bouton repli PC et toggle dans le menu *Fichier*).
   - Les apps coopératives (y compris *cross-origin*) peuvent dialoguer directement via `postMessage` :
     - Demander un fichier : `window.parent.postMessage({ type: 'webos:vfs-pick', requestId: '1', accept: 'image/*' }, origin)` → réponse `webos:vfs-pick-result`.
     - Sauvegarder un fichier : `window.parent.postMessage({ type: 'webos:vfs-save', requestId: '2', filename: 'out.png', mime: 'image/png', data: arrayBuffer }, origin)` → réponse `webos:vfs-save-result`.

---

## 8. Intégration avec Compagnon (Agent IA Universel)

**Atelier by GallusTech** intègre **Compagnon**, un agent IA multi-fournisseurs (Gemini, OpenAI, Anthropic, Ollama/LM Studio) gouverné par `AgentToolRegistry` (`window.sys.agentTools`). Toute application — **native** ou **externe/WASM** — peut exposer son état courant et ses outils de manière standardisée, sans modifier le noyau ni la barre des tâches.

### 8.1 Contrat Universel pour les Applications Natives (`WebOSApp`)

`WebOSApp` (et `WebOSGameApp`) fournit quatre hooks optionnels détectés automatiquement par `AgentToolRegistry` dès qu'une fenêtre de l'application est ouverte :

| Méthode | Rôle |
|---|---|
| `isWindowOpen()` | Retourne `true` si l'application a au moins une fenêtre ouverte (déjà géré par défaut via `this.window` et `this.instances`). |
| `getAgentContext()` | Retourne un petit objet JSON résumant l'état courant visible à l'écran (onglet actif, position de carte, plateau de jeu, fichier ouvert…). |
| `getAgentTools()` | Retourne un tableau d'outils `{ name, description, risk, parameters, alwaysAvailable? }`. Chaque outil est automatiquement préfixé `app_<appId>_<name>` (les tirets sont normalisés en `_`, ex. `graphing-calc` → `app_graphing_calc_evaluate`). |
| `executeAgentTool(name, args, ctx)` | Exécute l'outil demandé (synchrone ou `async`) et retourne `{ success: true, ... }` ou `{ success: false, error: '...' }`. |

#### Niveaux de risque (`risk`) & Human-in-the-Loop
- **`read`** : lecture seule (toujours autorisé, y compris en mode *Lecture seule*, sans confirmation).
- **`mutate_app`** : modifie l'état interne de l'application (tracer une courbe, déplacer la carte, jouer un coup). Confirmation demandée en mode *Assisté*, automatique sur l'app active en mode *Autonome dans l'app*.
- **`mutate_fs`** / **`destructive`** : écriture sur le VFS ou action irréversible — exige **toujours** une confirmation manuelle explicite dans la popup Compagnon.

#### Exemple minimal dans une classe `WebOSApp`

```javascript
class MonOutilApp extends WebOSApp {
  getAgentContext() {
    return {
      tab: this.currentTab,
      selected_count: this.selectedIds.length
    };
  }

  getAgentTools() {
    return [
      {
        name: 'get_summary',
        description: 'Retourne un résumé structuré des éléments chargés dans Mon Outil.',
        risk: 'read',
        parameters: { type: 'object', properties: {} }
      },
      {
        name: 'filter_items',
        description: 'Filtre la vue courante par mot-clé.',
        risk: 'mutate_app',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Texte de filtre' }
          },
          required: ['query']
        }
      }
    ];
  }

  executeAgentTool(name, args = {}) {
    if (name === 'get_summary') {
      return { success: true, total: this.items.length, tab: this.currentTab };
    }
    if (name === 'filter_items') {
      this.applyFilter(String(args.query || ''));
      return { success: true, matched: this.filteredItems.length };
    }
    return { success: false, error: `Unknown tool '${name}'` };
  }
}
```

> 💡 **Exemples pilotes livrés dans le dépôt** : `apps/graphing-calc/app.js` (évaluation & tracé de courbes), `apps/maps/maps.js` (navigation & couches), `apps/doc-viewer/viewer.js` (recherche & navigation de pages), `apps/explorer/explorer.js` (navigation VFS & tri), `apps/games/hanoi/app.js` et `apps/games/8queens/app.js` (mode **Coach IA** avec calcul de coup optimal et jeu direct).

### 8.2 Applications Externes & WASM (`WebAppAgentBridge`)

Deux mécanismes sont pris en charge automatiquement pour les applications hébergées dans `WebAppHost` :

1. **Auto-découverte `craft-web-api`** : toute application WASM exposant un namespace `window.<prefix>` (ex. `wordcraft`, `gridcraft`, `deckcraft`) avec `.commands()`, `.execute()`, `.docInspect()` / `.screenshot()` est automatiquement pilotable via les outils dynamiques `craft_*`.
2. **Protocole coopératif `postMessage` (`same-origin` strict)** : toute WebApp tierce (React, Vue, Godot, Rust/WASM…) peut enregistrer ses outils auprès de Compagnon sans couplage :
   - **Déclarer des outils** :
     ```javascript
     window.parent.postMessage({
       type: 'webos:agent-register-tools',
       tools: [
         { name: 'set_zoom', description: 'Définit le zoom (0.5 à 4)', risk: 'mutate_app',
           parameters: { type: 'object', properties: { factor: { type: 'number' } }, required: ['factor'] } }
       ]
     }, window.location.origin);
     ```
   - **Publier un contexte vivant** :
     `window.parent.postMessage({ type: 'webos:agent-context', context: { page: 3, zoom: 1.5 } }, window.location.origin);`
   - **Répondre aux appels `webos:agent-call`** :
     ```javascript
     window.addEventListener('message', (e) => {
       if (e.origin !== window.location.origin || !e.data || e.data.type !== 'webos:agent-call') return;
       const { callId, tool, args } = e.data;
       // Exécuter l'action puis renvoyer le résultat :
       window.parent.postMessage({
         type: 'webos:agent-result',
         callId,
         success: true,
         result: { applied: tool, factor: args.factor }
       }, window.location.origin);
     });
     ```

---

## 9. Tests Automatisés & Validation Avant Livraison

Toute nouvelle application doit être accompagnée de tests et passer l'intégralité de la suite :

```bash
php tests/run_tests.php
```

1. **Tests PHP (`tests/GeneralUnitTest.php`)** : vérifier que `PluginDiscovery::getDiscoveredApps()` découvre votre app, ses scripts/CSS, et que `PluginDiscovery::getAppTranslations()` charge ses locales FR/EN/JA.
2. **Tests Sécurité (`tests/SecurityUnitTest.php`)** : si votre app ajoute un backend PHP, tester le rejet des utilisateurs non authentifiés (`403`), des payloads malveillants / path traversal et des actions mutantes sans CSRF.
3. **Tests Runtime JS (`tests/test_js_runtime.mjs`)** : la suite vérifie automatiquement :
   - La validité JSON de vos fichiers `apps/<id>/locales/{fr,en,ja}.json` et la présence des titres dans `manifest.json` ;
   - L'absence totale de fallback `.t('key') || '...'` (`QUAL-01`) ;
   - L'absence totale de `fetch()` brut dans `apps/` (`QUAL-02`) ;
   - Ajoutez votre propre section de tests unitaires (instanciation, `renderTab()`/`renderContent()`, logique métier).
