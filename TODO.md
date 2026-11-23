# 📋 Atelier by GallusTech — Feuille de Route & Backlog (`TODO.md`)

Ce document recense les évolutions produit restantes (**Phase 4**) pour **Atelier by GallusTech**, ordonnées par priorité, complexité et dépendances.

> [!NOTE]
> - **Historique achevé et archivé** : Phases 0 & 1 (Cybersécurité `SEC-01`–`SEC-11`), Phase 2 (Architecture noyau `ARCH-01`–`ARCH-03` + OAuth2 Tribune silencieux), Phase 3 (Qualité, i18n, `SyscallClient`, SRI, hygiène Git & découpage modulaire `QUAL-01`–`QUAL-05`), ainsi que `FEAT-01` (`system-monitor`), `FEAT-02` (`taskbar`), `FEAT-03` (`tribune`) et `FEAT-04` (`graphing-calc` — Calculatrice Scientifique, Programmeur & Traceur 2D) sont **terminés et validés** (`826/826 PASS`).
> - **Règles d'exécution (`.agents/AGENTS.md`)** :
>   - Toute fonctionnalité ou refactorisation doit rester **100 % iso-fonctionnelle**, sans fallback hardcodé dans `this.t('key')`.
>   - Les traductions spécifiques à une application doivent vivre dans `apps/<app>/locales/{fr,en,ja}.json` (et non dans `locales/`).
>   - Toute livraison est validée par `php tests/run_tests.php` (PHP Sécurité + PHP Fonctionnel + Node.js Runtime).

---

## 📊 Tableau de Suivi — Phase 4 (Backlog Actif)

| ID | Titre | Priorité | Complexité | Dépendances | Statut |
|---|---|:---:|:---:|---|:---:|
| `FEAT-06` | 🔗 Pont VFS Bidirectionnel pour Apps Externes (`WebAppHost` Open/Save Hook) | **P4 (Haute)** | `M` | `WebAppHost` | ✅ Fait |
| `FEAT-05` | 🛠️ CLI & Terminal WebOS / VFS (100 % sans shell OS) | **P4 (Moyenne)** | `M` | — | ⬜ À faire |
| `FEAT-09` | 📚 Guide & Kit Développeur d'Applications WebOS (`docs/apps-guide.md` + `template-app`) | **P4 (Moyenne)** | `S` | — | ✅ Fait |
| `FEAT-10` | 👥 Jeux Multijoueurs & Table Virtuelle de JDR / VTT (`apps/games/*`) | **P4 (Moyenne)** | `XL` | — | ⬜ À faire |
| `FEAT-08` | 🕹️ Émulateurs Rétro 8/16-Bits & Doom Wasm (`apps/retro-station`) | **P4 (Basse)** | `L` | `WebAppHost` | ⬜ À faire |
| `FEAT-11` | 🔌 Atelier d'Émulation Matérielle Modulaire & Chimères (`apps/silicon-lab`) | **P4 (R&D)** | `XL` | `FEAT-08` | ⬜ À faire |
| `FEAT-07` | 🗄️ Visionneuse SQLite Client-Side (`apps/sql-viewer` — Optionnel) | **P4 (En réflexion)** | `M` | — | 💭 En réflexion |

---

## 🚀 Phase 4 — Feuille de Route Produit & Nouvelles Applications

### - [x] `FEAT-06` — 🔗 Pont VFS Bidirectionnel pour Apps Externes (`WebAppHost` Open/Save Hooking)
- **Priorité** : `P4 (Haute)` | **Complexité** : `M` | **Dépendances** : `system/userland/core/WebAppHost.js`
- **Description technique** :
  - Améliorer l'intégration transparente des applications autonomes/WASM auto-hébergées en *same-origin* dans `apps/` (ex. suite ArtCraft / PdfCraft / PixelCraft) afin qu'elles puissent **ouvrir et enregistrer directement les fichiers du VFS Atelier by GallusTech** sans obliger l'utilisateur à télécharger puis ré-uploader manuellement.
  - **Interception *same-origin* optionnelle (déclarable par app dans `config/external_apps.json` ou `manifest.json`)** :
    1. **Ouverture VFS (`Open Hook`)** : interception de `HTMLInputElement.prototype.click` (lorsque `type === 'file'`) et de `contentWindow.showOpenFilePicker()` dans l'iframe → ouvre un sélecteur de fichiers WebOS (galerie VFS filtrée par `accept`) avec un bouton de repli « Fichier local de l'ordinateur », puis injecte le `File` via `DataTransfer` + événement `change`.
    2. **Enregistrement VFS (`Save Hook`)** : interception de `contentWindow.showSaveFilePicker()` et des téléchargements `blob:` (`<a download>`) → propose « Enregistrer dans la Galerie WebOS » (dossier courant ou choix de dossier, via `SyscallClient.upload('upload_file', ...)` si l'utilisateur a la permission `can_upload`) en plus du téléchargement local.
    3. **Protocole `postMessage` standardisé** (`webos:vfs-pick`, `webos:vfs-save`, `webos:file-saved`) pour les apps tierces qui souhaitent s'y intégrer nativement (y compris *cross-origin*).
  - **Limites documentées** : le hooking DOM/API s'applique aux apps *same-origin* hébergées sous `apps/` ; les apps externes *cross-origin* restent limitées au protocole `postMessage` / paramètres d'URL (politique SOP navigateur).
- **Rapport d'exécution** :
  - *Statut* : `Terminé (2026-11-23)`
  - *Modifications* :
    - Création de `system/userland/core/WebAppVfsBridge.js` : capture `URL.createObjectURL` (survit aux `revokeObjectURL` immédiats), Open Hooks (`HTMLInputElement.prototype.click`, `showOpenFilePicker` avec `FileSystemFileHandle` virtuel + `createWritable()`), Save Hooks (`showSaveFilePicker`, `<a download href="blob:...|data:...">`), capture-phase DOM click hook, protocole `postMessage` authentifié par `event.source` (`webos:vfs-pick` / `webos:vfs-save`), configuration par manifeste (`vfsBridge`) et toggle utilisateur par app (`localStorage`).
    - Enrichissement de `system/userland/services/FilePickerService.js` : ajout de `pickSaveLocation()`, repli « Fichier local / Télécharger sur le PC » (`allowLocalFallback`), filtrage `accept` étendu aux MIME types exacts, migration sur `SyscallClient`, échappement HTML, i18n complet (`locales/{fr,en,ja}.json`, parité 745/745/745) et adaptation thème clair/sombre.
    - Intégration dans `system/userland/core/WebAppHost.js` (attachement automatique dans `attachIframeWindowHooks()`, ouverture multi-dossiers VFS & toggle `🔗 Pont VFS Galerie` dans le menu Fichier) et chargement dans `index.php`.
  - *Tests & Vérifications* : +11 nouvelles assertions `FEAT-06` dans `tests/test_js_runtime.mjs` ; suite complète **`239/239` Sécurité PHP + `283/283` Fonctionnels PHP + `315/315` Runtime JS = `837/837 PASS`** (`exit code 0`).
  - *Notes / Incidents* : Les iframes *cross-origin* sont ignorées proprement sans exception `SecurityError`.

---

### - [ ] `FEAT-05` — 🛠️ CLI & Terminal WebOS / VFS (`apps/terminal` — 100 % sans shell OS)
- **Priorité** : `P4 (Moyenne)` | **Complexité** : `M` | **Dépendances** : Aucune *(zéro `exec`/`proc_open` côté serveur : surface d'attaque système nulle)*
- **Description technique** :
  - Catégorie `system` | Icône `💻` | Locales autonomes dans `apps/terminal/locales/{fr,en,ja}.json`.
  - **Conçu comme un vrai CLI d'administration & de productivité WebOS** (et non un faux bash cosmétique ni un shell OS exposé), branché exclusivement sur `SyscallClient` et les services du bureau (respect strict de `PathValidator`, `DotfileManager` `.private`/`.password`, `PermissionsManager` et CSRF) :
    - **Commandes VFS lecture (Invité & Admin)** : `pwd`, `cd`, `ls [-l|-a]`, `tree`, `cat`, `head`, `tail`, `stat`, `exif <image>`, `find`, `grep`, `search <requête>`, `zip` (téléchargement d'archive du dossier).
    - **Commandes VFS écriture (Admin / selon permissions)** : `mkdir`, `touch`, `cp`, `mv`, `rm`, `comment <fichier> "<texte>"`, `lock` / `unlock` (gestion `.private`/`.password`).
    - **Commandes de pilotage WebOS** : `open <fichier>` (via `AppManager`), `launch <app>`, `ps` (fenêtres actives), `kill <winId>`, `theme [nom]`, `locale [fr|en|ja]`, `apps [list|enable|disable <id>]`, `sysinfo`, `cache clear` (Admin), `calc <expr>` (réutilise `GraphingCalcEngine`), `help`, `man <cmd>`, `clear`, `history`.
    - **Ergonomie CLI** : pipes côté client (`| grep`, `| head`, `| tail`, `| sort`, `| count`), autocomplétion `Tab` (commandes + chemins VFS du répertoire courant), historique persistant (`↑`/`↓`), coloration ANSI légère.
  - **Note sécurité** : aucune exécution de commandes OS côté PHP (`proc_open`/`exec` définitivement exclus). Si un environnement Linux complet est souhaité un jour, il relèvera d'un module 100 % client-side en WebAssembly (ex. BusyBox/v86 via `WebAppHost`).
- **Rapport d'exécution** :
  - *Statut* : `À faire`
  - *Date / Commit* : `—`
  - *Tests & Vérifications* : `—`
  - *Notes / Incidents* : `—`

---

### - [x] `FEAT-09` — 📚 Guide & Kit Développeur d'Applications WebOS (`docs/apps-guide.md` + `apps/template-app`)
- **Priorité** : `P4 (Moyenne)` | **Complexité** : `S` | **Dépendances** : Aucune
- **Description technique** :
  - Rédiger un guide pas-à-pas complet et illustré (`docs/apps-guide.md`) couvrant tout le cycle de création et d'intégration d'une application dans Atelier by GallusTech :
    1. **Anatomie d'une app native** : structure `apps/<id>/`, `manifest.json` (`id`, `category`, `icon`, `scripts`, `entry`, `extensions`, `mimeTypes`, `autostartCapable`).
    2. **Cycle de vie `WebOSApp`** : `renderTab(tabId)` (apps à onglets) vs `renderContent()`, `bindEvents()`, `onOpen()`/`onClose()`, `this.storage`, `this.toast`, `this.dialog`, `MenuBarManager`, thèmes clair/sombre.
    3. **Internationalisation isolée** : création de `apps/<id>/locales/{fr,en,ja}.json`, chargement automatique par `PluginDiscovery::getAppTranslations()`, règle zéro fallback hardcodé dans `this.t()`.
    4. **Appels backend & sécurité** : `SyscallClient` (`this.api.get`/`post`/`upload`/`getText`), déclaration d'actions backend dynamiques dans `manifest.json` (`backend.actions` / `mutating_actions`), contrôles `AuthManager`, `PermissionsManager`, `PathValidator`, `DotfileManager` et `RateLimiter`.
    5. **Intégration d'apps web/WASM tierces** : auto-découverte `StandaloneWebAppManifestSynthesizer`, surcharges `config/external_apps.json`, pont fichiers `WebAppHost`.
    6. **Tests & validation** : comment ajouter des tests PHP (`GeneralUnitTest.php`, `SecurityUnitTest.php`) et runtime JS (`test_js_runtime.mjs`).
  - Synchroniser et moderniser `apps/template-app/` pour qu'il serve de squelette copier-coller 100 % conforme à ces bonnes pratiques.
- **Rapport d'exécution** :
  - *Statut* : `Terminé (2026-11-23)`
  - *Modifications* :
    - Refonte complète de `docs/apps-guide.md` (8 chapitres : anatomie, `manifest.json`, cycle de vie `WebOSApp` avec distinction `renderTab` vs `renderContent`, services Userland, i18n isolée par app, design system multi-thèmes, backend PHP Option A `AppEndpoint` / Option B `manifest.backend` + checklist sécurité, intégration d'apps WASM/tierces + `WebAppVfsBridge` + `postMessage`, et tests automatisés). Mise à jour de `README.md` (ajout Calculatrice & Hôte WASM/VFS).
    - Modernisation de `apps/template-app/` (`manifest.json` v2.1 format `entry`, `api.php` utilisant `project_root` `ARCH-01` + garde `is_admin` + validation longueurs, `app.js` corrigeant `MenuBarManager.registerAppMenu()`, `this.subscribe('theme:changed'/'locale:changed')`, démos `pickFile()` + `pickSaveLocation()` et 100 % i18n sans chaînes françaises en dur dans `apps/template-app/locales/{fr,en,ja}.json` en parité 56/56/56).
  - *Tests & Vérifications* : `php -l apps/template-app/api.php` OK ; +4 assertions `FEAT-09` ajoutées dans `tests/test_js_runtime.mjs` ; suite complète **`239/239` Sécurité PHP + `283/283` Fonctionnels PHP + `319/319` Runtime JS = `841/841 PASS`** (`exit code 0`).
  - *Notes / Incidents* : Plusieurs bugs latents du modèle d'origine (`registerAppMenus`, `theme:change`/`locale:change`, `base_dir` au lieu de `project_root`) ont été corrigés au passage.

---

### - [ ] `FEAT-10` — 👥 Jeux Multijoueurs & Table Virtuelle de JDR / VTT (`apps/games/jdr`, `chess-2p`, `konquest`)
- **Priorité** : `P4 (Moyenne)` | **Complexité** : `XL` *(réalisable jeu par jeu)* | **Dépendances** : Aucune *(réutilisation du pattern SSE/polling sécurisé + stockage `storage/`)*
- **Description technique** :
  - Catégorie `games` | Locales autonomes `apps/games/<jeu>/locales/{fr,en,ja}.json` | **Socle réseau partagé léger** (salles identifiées par code de session, jetons de joueur, synchronisation par polling/SSE sécurisé sans dépendance WebSocket externe, purge automatique des salles inactives).
  - **1. Table Virtuelle de Jeu de Rôle — VTT (`apps/games/jdr`, 🎲)** :
    - **Gestion de campagne & rôles** : création de table par le MJ (code d'invitation), distinction stricte vue **MJ** vs vue **Joueurs**, persistance JSON de la session dans `storage/` (avec export/import sauvegarde).
    - **Carte tactique interactive (Canvas 2D)** : chargement d'images de cartes directement depuis la **galerie Atelier by GallusTech**, zoom/pan fluide, grille **carrée ou hexagonale** calibrable (taille, opacité, échelle en mètres/cases), outil **règle de mesure** de distances et gabarits de zones (cône, cercle, ligne).
    - **Pions (Tokens) & Calques** : placement/déplacement de pions (avatars issus de la galerie ou icônes), barres de PV/ressources, marqueurs d'états, calque caché réservé au MJ (monstres/pièges invisibles aux joueurs jusqu'à révélation).
    - **Brouillard de guerre (*Fog of War*)** : masquage initial de la carte pour les joueurs, pinceau/polygone MJ pour révéler ou recouvrir des zones en temps réel.
    - **Moteur de dés & Chat RP** : syntaxe complète (`1d20+5`, `2d20kh1` avantage/désavantage, `4d6dl1`, `1d100`, jets multiples), jets secrets (MJ uniquement), historique horodaté, chuchotements (`/w`).
    - **Fiches de personnages & Ambiance** : fiches modulaires (modèles JSON génériques ou systèmes classiques : caractéristiques, PV, inventaire, notes) + lecteur d'ambiance sonore synchronisé pointant sur les fichiers audio de la galerie.
  - **2. Échecs & Dames 2 Joueurs (`apps/games/chess-2p`, ♟️)** :
    - **Échecs complets** : validation stricte de tous les coups légaux (roque, prise en passant, promotion, détection échec / mat / pat / nulle par répétition), surbrillance des coups possibles, historique algébrique, import/export **FEN / PGN**.
    - **Dames internationales (10×10) / classiques (8×8)** : prise obligatoire, rafles multiples, couronnement en dame.
    - **Modes de jeu** : local (*pass-and-play* sur le même écran), solo contre **IA JS intégrée** (Minimax + élagage Alpha-Bêta à profondeur configurable), et **2 joueurs en ligne** par code de partie avec pendule (Blitz / Rapide / Classique).
  - **3. Konquest — Stratégie Spatiale 4X (`apps/games/konquest`, 🪐)** :
    - **Galaxie procédurale au tour par tour** : carte stellaire configurable (taille, nombre de planètes neutres, joueurs humains + bots IA de différents profils : agressif, défensif, expansionniste).
    - **Mécaniques tactiques** : chaque planète possède production/tour, garnison et *kill-ratio* (efficacité de combat) ; envoi de flottes avec délai de transit proportionnel à la distance euclidienne, résolution simultanée des batailles en fin de tour.
    - **Options avancées** : brouillard de guerre galactique (statistiques des planètes ennemies masquées jusqu'à reconnaissance), statistiques/courbes de puissance en fin de partie, mode hotseat local ou multijoueur tour par tour via salle partagée.
- **Rapport d'exécution** :
  - *Statut* : `À faire`
  - *Date / Commit* : `—`
  - *Tests & Vérifications* : `—`
  - *Notes / Incidents* : `—`

---

### - [ ] `FEAT-08` — 🕹️ Émulateurs Rétro 8/16-Bits & Doom Wasm (`apps/retro-station`)
- **Priorité** : `P4 (Basse)` | **Complexité** : `L` | **Dépendances** : `WebAppHost`
- **Description technique** :
  - Catégorie `games` | Icône `👾`.
  - Exécution de cœurs WASM / pur JS (NES, GB/GBC, Chip-8, C64, ZX Spectrum, Amstrad CPC, Apple II, Doom Shareware Wasm, DOSBox-lite) en s'appuyant sur `WebAppHost` / `StandaloneWebAppManifestSynthesizer` (associations `.nes`, `.gb`, `.gba`, `.wad` déjà présentes).
  - Glisser-déposer de ROMs depuis l'Explorateur, *Save States* dans `this.storage` ou VFS, support HTML5 Gamepad API.
- **Rapport d'exécution** :
  - *Statut* : `À faire`
  - *Date / Commit* : `—`
  - *Tests & Vérifications* : `—`
  - *Notes / Incidents* : `—`

---

### - [ ] `FEAT-11` — 🔌 Atelier d'Émulation Matérielle Modulaire & Machines Chimères (`apps/silicon-lab`)
- **Priorité** : `P4 (Exploration / R&D)` | **Complexité** : `XL` *(incrémental en jalons `M` → `L` → `XL`)* | **Dépendances** : `FEAT-08` *(synergie émulation)*, `WebAppHost` / Web Workers
- **Description technique** :
  - Catégorie `development` / `games` | Icône `🔌`.
  - **Architecture « Backplane Virtuel » pilotée par profils JSON** (100 % côté client, JS pur avec `TypedArray` + Web Worker, prêt pour substitution ponctuelle WASM) :
    - **Cœur Bus & Horloge (`BusMatrix`, `PagedMemoryMap`, `ClockScheduler`)** : table de pages mémoire rapide O(1) (ex. pages de 256 o / 1 Ko) pour RAM/ROM/Bank-Switching + routage MMIO / ports I/O + synchronisation multi-horloges par quanta (scanline / événements IRQ/NMI/DMA).
    - **Modules CPU indépendants** (contrat uniforme `reset()`, `step()`, `irq()`, `nmi()`, `getState()`/`setState()`) :
      1. **Jalon 1 (MVP)** : **Z80** (et variante **SM83** Game Boy), **MOS 6502** (et 2A03 sans BCD).
      2. **Jalon 2** : **Motorola 6809** / **68000** (table de décodage 64K sur opcodes 16 bits, utile pour TI-89/TI-92, Atari ST, Mega Drive, ou coprocesseurs).
    - **Modules Périphériques enfichables** :
      - Mémoire (`RAM`, `ROM`, `Flash`, `BankMapper` TI/CPC/MBC).
      - Vidéo : LCD monochrome `T6A04` (96×64 TI-83), Texte/HGR Apple II, `CRTC 6845` + Gate Array (CPC), `PPU 2C02` (NES), `VDP TMS9918` (MSX/SMS), et une carte vidéo modulaire inspirée **OCS Amiga-lite** (bitplanes, palette 4096 couleurs, Copper/Blitter simplifié).
      - Audio (`AY-3-8912`, `SN76489`, beeper 1-bit, synthétiseur Paula-lite via `AudioWorklet`).
      - Entrées/Sorties : matrices clavier configurables en JSON (TI-83 7×8, CPC 10×8, Apple II ASCII), Gamepad HTML5, UART série / Link port, lecteur disquette/K7 virtuel.
    - **Profils JSON de machines réelles & « Chimères »** :
      - *Machines réelles* : **TI-83 / TI-83+** (MVP idéal : Z80 + LCD T6A04 + clavier matriciel, support ROM utilisateur depuis le VFS + OS libre type KnightOS/mini-BIOS), **RC2014 / CP/M**, **ZX Spectrum 48K**, **Apple II+**, **Amstrad CPC 464/6128**, **NES**, **TI-89 (68k)**.
      - *Machines Chimères (« Franken-Machines »)* : assemblage libre en JSON (ex. **Apple II double-CPU 6502+Z80** façon Microsoft SoftCard, **Z80 + carte vidéo OCS 4096 couleurs**, **TI-83 couleur**) accompagné d'un **mini-assembleur / moniteur open-source** et de démos homebrew (puisqu'une ROM propriétaire 6502 ne s'exécute pas nativement sur Z80 sans pont/coprocesseur).
    - **Outils d'ingénierie intégrés** : débogueur pas-à-pas, désassembleur live, inspecteur registres/drapeaux/mémoire hexadécimale, visualiseur de topologie bus JSON, *Save States* JSON/binaires dans le VFS.
  - **Exigence légale & sécurité** : **aucune ROM/firmware propriétaire sous copyright dans le dépôt** ; chargement exclusif de ROMs fournies par l'utilisateur (VFS ou drag-and-drop local en mémoire) + fourniture de firmwares/BIOS/démos 100 % open-source pour un fonctionnement immédiat.
- **Rapport d'exécution** :
  - *Statut* : `À faire`
  - *Date / Commit* : `—`
  - *Tests & Vérifications* : `—`
  - *Notes / Incidents* : `—`

---

### - [ ] `FEAT-07` — 🗄️ Visionneuse SQLite Client-Side (`apps/sql-viewer` — Optionnel / En réflexion)
- **Priorité** : `P4 (En réflexion)` | **Complexité** : `M` | **Dépendances** : Aucune
- **Description technique** :
  - Catégorie `development` | Icône `🗄️`.
  - Périmètre volontairement allégé et **100 % côté client** (sans pont MySQL/sockets serveur) : ouverture directe des fichiers `.sqlite`/`.sqlite3`/`.db` de la galerie via `sql.js` (WASM) pour explorer le schéma (tables, index, vues), exécuter des requêtes `SELECT` en lecture sûre et exporter les résultats en `CSV`/`JSON`.
- **Rapport d'exécution** :
  - *Statut* : `En réflexion`
  - *Date / Commit* : `—`
  - *Tests & Vérifications* : `—`
  - *Notes / Incidents* : `—`
