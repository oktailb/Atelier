# 📋 SimpleGallery WebOS — Feuille de Route & Backlog (`TODO.md`)

Ce document recense les évolutions produit restantes (**Phase 4**) pour **SimpleGallery WebOS**, ordonnées par priorité, complexité et dépendances.

> [!NOTE]
> - **Historique achevé et archivé** : les Phases 0 & 1 (Cybersécurité `SEC-01`–`SEC-11`), Phase 2 (Architecture noyau `ARCH-01`–`ARCH-03` + OAuth2 Tribune silencieux), Phase 3 (Qualité, i18n, `SyscallClient`, SRI, hygiène Git & découpage modulaire `QUAL-01`–`QUAL-05`) ainsi que `FEAT-01` (`system-monitor`), `FEAT-02` (`taskbar`) et `FEAT-03` (`tribune`) sont **terminés et validés** (`804/804 PASS`).
> - **Règle d'exécution (`.agents/AGENTS.md`)** : Toute fonctionnalité ou refactorisation doit rester **100 % iso-fonctionnelle**, sans fallback hardcodé dans `this.t('key')`, et validée par `php tests/run_tests.php` (PHP Sécurité + PHP Fonctionnel + Node.js Runtime).

---

## 📊 Tableau de Suivi — Phase 4 (Backlog Actif)

| ID | Titre | Priorité | Complexité | Dépendances | Statut |
|---|---|:---:|:---:|---|:---:|
| `FEAT-04` | 📈 Calculatrice Scientifique & Traceur de Courbes (`apps/graphing-calc`) | **P4 (Haute)** | `M` | — | ✅ Fait |
| `FEAT-05` | 🛠️ Terminal WebOS & Shell Interactif (`apps/terminal`) | **P4 (Haute)** | `L` | — | ⬜ À faire |
| `FEAT-06` | 📑 Suite Bureautique & Support ODF XML (`apps/doc-viewer` + `apps/calc`) | **P4 (Moyenne)** | `L` | — | ⬜ À faire |
| `FEAT-07` | 🗄️ Client SQL & Gestionnaire de Bases (`apps/sql-client`) | **P4 (Moyenne)** | `L` | — | ⬜ À faire |
| `FEAT-08` | 🕹️ Émulateurs Rétro 8/16-Bits & Doom Wasm (`apps/retro-station`) | **P4 (Basse)** | `L` | `WebAppHost` | ⬜ À faire |
| `FEAT-09` | 💻 IDE Multi-Langages, Toolchain & Débogueur (`apps/code-studio`) | **P4 (Basse)** | `XL` | `FEAT-05` | ⬜ À faire |
| `FEAT-10` | 👥 Jeux Multijoueurs & Table Virtuelle JDR / VTT (`apps/games/*`) | **P4 (Basse)** | `XL` | — | ⬜ À faire |
| `FEAT-11` | 🔌 Atelier d'Émulation Matérielle Modulaire & Chimères (`apps/silicon-lab`) | **P4 (R&D)** | `XL` | `FEAT-04`, `FEAT-08` | ⬜ À faire |

---

## 🚀 Phase 4 — Feuille de Route Produit & Nouvelles Applications

### - [x] `FEAT-04` — 📈 Calculatrice Scientifique & Traceur de Courbes Graphiques (`apps/graphing-calc`)
- **Priorité** : `P4 (Haute)` | **Complexité** : `M` | **Dépendances** : Aucune *(100 % frontend, zéro surface d'attaque backend)*
- **Description technique** :
  - Catégorie `utilities` | Icône `📐`.
  - Modes **Standard / Scientifique** (`sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `sinh`, `cosh`, `tanh`, `log`, `ln`, `exp`, factorielles `!`, puissances `^`, racines, constantes $\pi$/$e$, modes `DEG`/`RAD`/`GRAD`, mémoire `MC`/`MR`/`M+`/`M-`/`MS`, historique cliquable) et **Programmeur** (`DEC`/`HEX`/`BIN`/`OCT`, `AND`/`OR`/`XOR`/`NOT`/`SHL`/`SHR`, éditeur visuel de bits 8/16/32 bits).
  - **Traceur Canvas 2D** : tracé multi-courbes $f(x)$, zoom/pan interactif, curseur de trace, détection automatique des racines, extrema locaux et intersections (sans `eval()` : parseur d'expressions sécurisé en JS pur), tableau de valeurs, export PNG local ou vers la galerie via `SyscallClient`.
- **Rapport d'exécution** :
  - *Statut* : `Terminé (2026-11-23)`
  - *Modifications* : Création de l'application auto-découverte `apps/graphing-calc/` (`manifest.json`, `math-engine.js` parseur AST récursif descendant 100 % pur JS + analyse numérique + moteur bitwise `BigInt` 8/16/32/64-bit, `plotter.js` Canvas 2D HiDPI avec zoom/pan/trace/export PNG, `app.js` héritant de `WebOSApp` avec 3 onglets & raccourcis clavier, `style.css`). Ajout de 37 clés i18n autonomes dans `apps/graphing-calc/locales/{fr,en,ja}.json` (chargées par `PluginDiscovery::getAppTranslations()`).
  - *Tests & Vérifications* : +4 assertions PHP (`GeneralUnitTest.php`) et +15 assertions JS (`test_js_runtime.mjs`) ; suite complète **`239/239` Sécurité PHP + `283/283` Fonctionnels PHP + `304/304` Runtime JS = `826/826 PASS`** (`exit code 0`).
  - *Notes / Incidents* : Zéro `eval()`, zéro `new Function()`, zéro `fetch()` brut (export galerie via `this.api.upload('upload_file', ...)`), zéro fallback hardcodé dans `this.t()`.

---

### - [ ] `FEAT-05` — 🛠️ Terminal WebOS & Shell Interactif (`apps/terminal`)
- **Priorité** : `P4 (Haute)` | **Complexité** : `L` | **Dépendances** : Aucune
- **Description technique** :
  - Catégorie `system` | Icône `💻`.
  - **Mode Invité (Read-Only VFS)** : `cd`, `pwd`, `ls -l`, `tree`, `cat`, `head`, `tail`, `grep`, `find`, `file`, `stat`, `du`, `df`, plus commandes WebOS (`help`, `clear`, `theme`, `locale`, `history`, `date`, `echo`, `man`).
  - **Mode Administrateur (Read-Write VFS)** : `mkdir`, `touch`, `rm`, `mv`, `cp`, `rename`, `ps`, `kill`, `sysinfo`, `run-tests`.
  - **Option "Vrai Shell / Bash" (désactivée par défaut dans `config/config.php`)** : Passerelle `proc_open` strictement réservée à l'Admin avec garde-fous, `escapeshellarg`, journalisation d'audit et isolation du répertoire de travail.
- **Rapport d'exécution** :
  - *Statut* : `À faire`
  - *Date / Commit* : `—`
  - *Tests & Vérifications* : `—`
  - *Notes / Incidents* : `—`

---

### - [ ] `FEAT-06` — 📑 Suite Bureautique & Support des Formats ODF XML (`apps/doc-viewer` + `apps/calc`)
- **Priorité** : `P4 (Moyenne)` | **Complexité** : `L` | **Dépendances** : Aucune
- **Description technique** :
  - Catégorie `productivity` | Icône `📋`.
  - **Visionneuse Native ODF XML (ISO/IEC 26300)** : décompression ZIP + parsing `content.xml`/`styles.xml` (avec sanitisation XSS stricte) pour `.odt`, `.ods`, `.odp`.
  - **Tableur Calc (`apps/calc`)** : édition/création `.csv`, `.tsv`, `.ods`, `.xlsx`, moteur de formules (`=SUM()`, `=AVERAGE()`, `=COUNT()`, `=IF()`), tri/filtres et sauvegarde VFS via `SyscallClient`.
- **Rapport d'exécution** :
  - *Statut* : `À faire`
  - *Date / Commit* : `—`
  - *Tests & Vérifications* : `—`
  - *Notes / Incidents* : `—`

---

### - [ ] `FEAT-07` — 🗄️ Client SQL & Gestionnaire de Bases de Données (`apps/sql-client`)
- **Priorité** : `P4 (Moyenne)` | **Complexité** : `L` | **Dépendances** : Aucune
- **Description technique** :
  - Catégorie `development` | Icône `🗄️`.
  - **SQLite local transparent** : ouverture de `.sqlite`/`.sqlite3`/`.db` de la galerie via `sql.js` (WASM côté client, idéal en lecture sûre) ou `pdo_sqlite` côté backend (Admin uniquement pour les écritures).
  - **Bases distantes (MySQL / sockets Unix)** : strictement réservé Admin avec protection anti-SSRF / liste blanche d'hôtes.
  - Explorateur de schéma (tables, vues, index, triggers), console SQL avec coloration syntaxique, grille paginée/triable et export `JSON`/`CSV`/`SQL`.
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

### - [ ] `FEAT-09` — 💻 IDE Multi-Langages, Détection Toolchain & Débogueur (`apps/code-studio`)
- **Priorité** : `P4 (Basse)` | **Complexité** : `XL` | **Dépendances** : `FEAT-05`
- **Description technique** :
  - Catégorie `productivity` | Icône `⚡`.
  - Endpoint Admin-only `detect_toolchain` (`gcc`/`g++`, `python3`, `perl`, `php`, `node`, `rustc`, `go`) + interpréteur BASIC rétro 100 % JS côté client.
  - Éditeur avancé (coloration syntaxique, pliage, minimap, recherche Regex), exécution `F5` (`stdout`/`stderr`) et débogueur pas-à-pas.
  - **Exigence sécurité** : exécution serveur strictement désactivée par défaut, réservée Admin, avec timeouts stricts et isolation de répertoire.
- **Rapport d'exécution** :
  - *Statut* : `À faire`
  - *Date / Commit* : `—`
  - *Tests & Vérifications* : `—`
  - *Notes / Incidents* : `—`

---

### - [ ] `FEAT-10` — 👥 Jeux Multijoueurs & Table Virtuelle de JDR / VTT (`apps/games/jdr`, `chess-2p`, `konquest`)
- **Priorité** : `P4 (Basse)` | **Complexité** : `XL` | **Dépendances** : Aucune
- **Description technique** :
  - Catégorie `games` | Icône `🎲`.
  - **Table Virtuelle JDR (VTT)** : chat MJ/Joueur, fiches de personnages, lanceur de dés (`d4`–`d100`), carte tactique avec grille carrée/hexagonale, pions/tokens et brouillard de guerre (*Fog of War*).
  - **Échecs & Dames 2 Joueurs** (local + synchro réseau) et **Konquest** (4X spatial au tour par tour).
- **Rapport d'exécution** :
  - *Statut* : `À faire`
  - *Date / Commit* : `—`
  - *Tests & Vérifications* : `—`
  - *Notes / Incidents* : `—`

---

### - [ ] `FEAT-11` — 🔌 Atelier d'Émulation Matérielle Modulaire & Machines Chimères (`apps/silicon-lab`)
- **Priorité** : `P4 (Exploration / R&D)` | **Complexité** : `XL` *(incrémental en jalons `M` → `L` → `XL`)* | **Dépendances** : `FEAT-04` *(complémentaire)*, `FEAT-08` *(synergie émulation)*, `WebAppHost` / Web Workers
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
