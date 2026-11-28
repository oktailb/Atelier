# Atelier by GallusTech 🚀

**Atelier by GallusTech** est un **environnement WebOS souverain, cloud multimédia, studio créatif WASM et bureau assisté par IA**, conçu en **PHP 7.4+ / PHP 8.x et JavaScript Vanilla pur** (zéro framework lourd, zéro dépendance Composer/npm, zéro base de données externe obligatoire).

Le principe fondamental d'origine reste intact : **pour publier de nouveaux médias (photos, vidéos, musique, documents, archives), il suffit de les déposer dans n'importe quel dossier sur le serveur ou dans un volume cloud monté.**

---

![Aperçu Atelier by GallusTech](screenshot.webp)

## 🌟 Fonctionnalités Principales

### 🖥️ 1. Environnement de Bureau WebOS & Personnalisation
- **Gestionnaire de Fenêtres Multi-Tâches (`WindowManager`)** : Déplacement, redimensionnement, maximisation, minimisation, empilement `z-index` et **9 habillages de fenêtres** (`wm-styles/` : macOS, Aqua, Mac OS Classic, Windows 11, Windows 9x, Windows 3.11, AmigaOS, BeOS/Haiku, Window Maker).
- **Barre Supérieure Contextuelle (`MenuBarManager`) & Barre des Tâches** : Menus dynamiques adaptés à l'application active, lanceur d'applications, horloge, raccourcis bureau isolés par utilisateur et accès rapide à l'Agent IA.
- **Thèmes & Typographie Native** : 4 thèmes système (`polaroid-classic`, `dark-glass`, `light-minimal`, `cyberpunk`), polices système natives (zéro appel Google Fonts) et bibliothèques cartographiques/documentaires auto-hébergées (`assets/vendor/`).
- **Internationalisation Complète (i18n)** : Interface traduite en **Français (FR)**, **Anglais (EN)** et **Japonais (JA)** avec **basculement réactif en temps réel** sans rechargement de page.
- **Progressive Web App (PWA)** : Installable sur desktop et mobile via `manifest.webmanifest` et `sw.js` (politique cache sécurisée excluant toute route API ou média privé).

---

### 📂 2. Suite d'Applications Intégrées (`apps/`) & Studio WASM

| Application | Icône | Description & Capacités |
|---|:---:|---|
| **Explorateur de Fichiers** | 📁 | Navigation double volet, volumes montés, fil d'Ariane, tri, recherche indexée SQLite, sélection multiple, uploads fragmentés résumables, modes **Polaroid**, **Grille**, **Liste** et **Compact**. |
| **Visionneuse d'Images** | 🖼️ | Zoom profond (*Deep Zoom* jusqu'à 10x), panoramique (*Pan*), rotation 90°, édition/filtres colorimétriques et panneau d'inspection des métadonnées EXIF. |
| **Lecteur Vidéo HTML5** | 🎬 | Sous-titres (`.vtt`, `.srt`), vitesse de lecture (0.25x à 2x), mode cinéma, *Picture-in-Picture* (PiP), mur vidéo multi-écrans et capture instantanée. |
| **Lecteur Audio & Musique** | 🎵 | Lecteur flottant avec analyseur de spectre Canvas temps réel, pochettes et tags ID3, listes de lecture et lecture aléatoire. |
| **Lecteur & Éditeur de Documents** | 📄 | **PDF**, **Markdown** (rendu local `marked` + éditeur scindé en direct), **LaTeX** et **Code Source** (coloration syntaxique locale `Prism`). |
| **Gestionnaire d'Archives** | 📦 | Exploration directe du contenu des archives (ZIP, TAR, GZ, 7Z, RAR), extraction et création d'archives à la volée. |
| **Cartes & Géolocalisation** | 🗺️ | Carte interactive **Leaflet** (auto-hébergé en local) avec regroupement par clusters, tracé chronologique GPS et déduction de position par horodatage EXIF. |
| **Tribune Libre** | 💬 | Messagerie communautaire temps réel multi-tribunes (Bouchot), horloges interactives, Totoz, OAuth2, médias temporaires et publications programmées. |
| **Moniteur Système** | 📊 | Supervision en temps réel des ressources serveur, mémoire PHP, espace disque, file de jobs asynchrones, caches et diagnostics. |
| **Calculatrice & Traceur 2D** | 📐 | Calculatrice scientifique (parseur AST sécurisé sans `eval`, `DEG`/`RAD`/`GRAD`), mode Programmeur 8–64 bits et traceur Canvas 2D multi-courbes (racines, extrema, intersections). |
| **Autorun Studio** | 🎞️ | Éditeur visuel et JSON de présentations multimédia synchronisées par timeline. |
| **Panneau de Configuration** | ⚙️ | Navigation latérale catégorisée : Sécurité & RBAC 3 niveaux, Utilisateurs/Groupes/2FA/OIDC, Email/SMTP, Stockage & Cloud, Plugins & Apps Externes, IA & Agent. |
| **Hôte d'Apps Web / WASM** | 🔗 | Auto-découverte et déploiement admin d'applications web/WASM tierces (`WebAppHost` + `ExternalAppManager`) avec **Pont VFS Bidirectionnel** (`WebAppVfsBridge` Open/Save Hook & `?host=parent`). |
| **Suite de Jeux Rétro** | 🎮 | **8 Dames** (solveur backtracking), **Foot Pong** (physique 1v1 + IA), **Tours de Hanoï** (solveur animé) et **Pipe Connect / Netwalk**. |

---

### 🤖 3. Agent IA Universel (« Compagnon » — Phase E)
- **Accès rapide en barre des tâches (`Ctrl+K`)** : Popup ancrée en bas à gauche avec sélecteur de modèle/profil et 3 niveaux d'autonomie (`Lecture seule`, `Assisté` avec validation *Human-in-the-Loop*, `Autonome` sur l'app active).
- **Passerelle Multi-LLM zéro dépendance (`LlmGateway`)** : Compatible **OpenAI / OpenRouter / Mistral / vLLM / LM Studio**, **Ollama** (local/LAN avec opt-in admin explicite), **Anthropic** et **Google Gemini**, avec clés API chiffrées au repos (`CredentialVault` AES-256-GCM) et protection anti-SSRF stricte.
- **Bus d'Outils Universel (`AgentToolRegistry` & `WebAppAgentBridge`)** : Pilote le noyau WebOS/VFS (dans les strictes ACL de session), les applications natives et jeux (`WebOSApp`), les apps WASM (`craft-web-api`) et toute app tierce via `postMessage` *same-origin*.

---

### 👥 4. Multi-Utilisateurs, Stockage Hybride & Interopérabilité OS
- **Persistance Dual-Driver (`AtelierStore`)** : Base **SQLite WAL** automatique (zéro serveur DB externe) avec repli atomique JSON verrouillé et indexation incrémentale des fichiers (`FileIndexManager`).
- **Identité & Gouvernance** : Comptes, groupes, espaces personnels isolés (`storage/users/`), quotas disque, matrice RBAC en cascade à 3 niveaux (Rôle → Groupe → Utilisateur), inscription autonome configurable (ouvert / invitation / approbation), **2FA TOTP (RFC 6238)** avec QR Code SVG généré 100 % en local, **SSO OpenID Connect (PKCE S256)**, suivi/révocation de sessions, liens de partage signés (`/s/<token>`), journal d'audit et **export/suppression RGPD** (`/e/<token>`).
- **Connecteurs Cloud & Résilience** : Montage transparent `ext://<id>/...` vers **S3 / Cloudflare R2 / MinIO / Scaleway / Backblaze B2** (AWS SigV4 natif), **WebDAV** et **Google Drive**, uploads fragmentés résumables, corbeille 30 jours et versioning léger (5 révisions).
- **Passerelle WebDAV (`/dav/`)** : Montage natif RFC 4918 depuis Windows, macOS, Linux et mobile via *App Passwords* dédiés.
- **Worker Asynchrone & Backups** : File de tâches persistante (`bin/worker.php`) pour pré-génération de vignettes, réindexation, archives ZIP, aperçus FFmpeg et sauvegardes d'instance ZIP avec manifeste SHA-256.

---

## ⚡ Installation & Démarrage Rapide

### Option 1 — Docker Compose (Recommandé en production)
Image complète incluant **PHP 8.3-FPM, Nginx, Supervisor (worker inclus), GD/WebP, EXIF, Zip, SQLite, cURL et FFmpeg** :

```bash
docker compose up -d
```
Ouvrez ensuite `http://localhost:8080/setup` pour lancer l'assistant de premier démarrage (qui s'auto-verrouille définitivement dès la création du premier SuperAdmin).

### Option 2 — Démarrage Local Immédiat (Développement)
Prérequis : **PHP 7.4+** ou **PHP 8.x** (extensions recommandées : `gd`, `exif`, `fileinfo`, `zip`, `pdo_sqlite`, `curl`, `openssl` ; optionnel : **FFmpeg**).

```bash
php -S localhost:8080
```
Ouvrez `http://localhost:8080` (ou `http://localhost:8080/setup`).

### Option 3 — Déploiement Classique (Apache / Nginx / Caddy)
1. Déposez les fichiers du projet dans la racine web (`/var/www/html/atelier`).
2. Accordez les permissions d'écriture sur `storage/` et `config/` :
   ```bash
   chown -R www-data:www-data /var/www/html/atelier/storage /var/www/html/atelier/config
   chmod -R 775 /var/www/html/atelier/storage /var/www/html/atelier/config
   ```
3. Initialisez un administrateur via `/setup` ou en ligne de commande :
   ```bash
   php bin/set_admin_password.php "VotreMotDePasseSecret"
   ```
4. Déposez vos dossiers de médias dans `storage/media/` : ils sont immédiatement détectés.

---

## 🔐 Modèle de Sécurité

- **Authentification & 2FA** : Hachage Argon2id / BCRYPT, 2FA TOTP RFC 6238 anti-replay, *App Passwords* dédiés pour WebDAV et chiffrement des secrets au repos en **AES-256-GCM** (`CredentialVault`).
- **Protection CSRF & Anti-SSRF** : Vérification CSRF globale sur toutes les actions mutantes (noyau + plugins `manifest.backend`), validation DNS + *IP pinning* (`UrlValidator`) bloquant les IP privées et métadonnées cloud (`169.254.169.254`).
- **Cloisonnement Serveur & VFS** : Isolation stricte contre le *Directory Traversal* (`PathValidator`), blocage HTTP 403 des dotfiles, de `storage/`, `config/`, `system/kernel/` et de tout `.php` sous `apps/` (parité stricte `.htaccess` et `docker/nginx.conf`), CSP stricte anti-XSS sur les SVG.
- **Visionnage en Ligne vs Téléchargement** : Contrôle fin via `can_download_item` et `can_download_archive` dans la matrice RBAC.

---

## 📂 Configuration par Fichiers Cachés (*Dotfiles*)

Personnalisez n'importe quel dossier sans base de données en y déposant des fichiers texte :

| Fichier | Rôle & Fonctionnalité | Exemple |
|---|---|---|
| **`.title`** | Surcharge le nom d'affichage du dossier. | `Vacances d'Été 🏖️` |
| **`.desc`** | Affiche une bannière descriptive en en-tête. | `Souvenirs de notre voyage.` |
| **`.comment`** | Associe des légendes personnalisées aux médias (`photo.jpg = Légende`). | `p1.jpg = Plage au coucher du soleil` |
| **`.bg`** | Définit une image ou une couleur CSS en fond d'écran du dossier. | `#0f172a` ou `fond.jpg` |
| **`.theme`** | Applique un thème dédié au répertoire (`polaroid-classic`, `dark-glass`, etc.). | `dark-glass` |
| **`.private`** | Masque le dossier aux visiteurs publics (accessible uniquement aux comptes autorisés). | *Fichier vide* |
| **`.password`** | Protège l'accès au dossier par mot de passe. | *Hash BCRYPT/Argon2id* |

---

## ⌨️ Raccourcis Clavier Principaux

| Raccourci | Action |
|---|---|
| `Ctrl+K` / `Alt+Espace` | Ouvrir / fermer l'Agent IA **Compagnon** |
| `<Flèche Gauche>` / `<Flèche Droite>` | Élément précédent / suivant |
| `+` ou `=` / `-` ou `_` | Zoom avant / arrière dans la visionneuse |
| `Glisser Souris` (*Drag*) | Déplacer l'image agrandie (*Pan*) |
| `Double Clic` | Alterne entre zoom normal (1x) et zoom centré (2.5x) |
| `R` / `0` / `F` / `I` | Rotation 90° / Reset zoom / Plein écran / Inspecteur EXIF |
| `Échap` | Fermer la visionneuse ou la fenêtre active |

---

## 🧪 Tests Unitaires & Validation

Pour lancer la suite de tests complète (Sécurité PHP, Fonctionnels PHP et Runtime JS Node.js) :

```bash
php tests/run_tests.php
```

---

## 🛠️ Documentation Technique Complète

- 🏗️ **[Architecture Système](docs/architecture.md)** : Fonctionnement du Kernel PHP, VFS, Gateway et structure.
- 🛠️ **[Guide Développeur d'Applications](docs/apps-guide.md)** : Créer une application WebOS avec `WebOSApp` et `manifest.backend`.
- ⚙️ **[Guide d'Administration](docs/admin-guide.md)** : Multi-utilisateurs, RBAC, 2FA, OIDC, SMTP, WebDAV et sauvegardes.
- 🔐 **[Sécurité & Permissions](docs/security.md)** : Modèle de sécurité, politiques d'accès et streaming inline.
- 🔒 **[Modules Métier & Dépôts Privés](docs/private-extensions.md)** : Intégrer des applications propriétaires sans modifier le noyau public.
- 🗺️ **[Feuille de Route Produit & Cloud](ROADMAP.md)** : Vision Atelier Cloud, phases A–E et trajectoire produit.
- 📋 **[Backlog Opérationnel](TODO.md)** : Suivi des évolutions applicatives.
- 📖 **[Portail de Documentation](DOCUMENTATION.md)** : Vue d'ensemble et référence technique.

---

## 📄 Licence
Ce projet est distribué sous licence [MIT License](LICENSE). Les bibliothèques tierces embarquées dans `assets/vendor/` conservent leurs licences permissives d'origine (Leaflet : BSD 2-Clause ; Leaflet.markercluster, Marked, PrismJS : MIT).
