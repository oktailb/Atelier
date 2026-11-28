# 💼 Atelier by GallusTech — Vision Produit, Modèles Économiques & Go-To-Market (`BUSINESS.md`)

Ce document rassemble la **stratégie produit, le positionnement marketing, les modèles de monétisation et le plan de lancement** d'**Atelier by GallusTech**.

> 📌 **Documents complémentaires** :
> - [`ROADMAP.md`](ROADMAP.md) : feuille de route technique (chantiers restants et architecture cible).
> - [`TODO.md`](TODO.md) : backlog opérationnel court terme.

---

## 1. Vision Produit & Avantage Compétitif (« Unfair Advantage »)

### ❌ Le piège à éviter
Affronter frontalement **Google Drive / Dropbox** (stockage quasi gratuit + suite collaborative temps réel + effet réseau) ou **Nextcloud / ownCloud** (groupware institutionnel lourd avec 300 plugins CalDAV/CardDAV/Collabora) est un combat asymétrique perdu d'avance pour une petite équipe.

### ✅ Notre différenciateur réel
Atelier by GallusTech dispose d'un ADN unique que les clouds classiques n'ont pas :

1. **Un Bureau WebOS complet + Studio Créatif WASM côté client (`WebAppHost` + `WebAppVfsBridge`)** :
   - Au lieu d'une simple liste de fichiers, l'utilisateur dispose d'un **bureau fenêtré fluide** capable d'ouvrir, éditer et sauvegarder directement dans son VFS des médias complexes (PSD, PDF, vidéo, audio, EXIF, cartes GPS, documents Markdown/LaTeX) via des applications **WebAssembly**.
   - **Avantage économique décisif en SaaS** : tout le calcul lourd (retouche d'image, édition PDF, rendu graphique) s'exécute **sur le CPU/GPU du client**, pas sur le serveur. Le coût serveur se résume presque uniquement au stockage objet (~0,015 €/Go/mois) + un micro-conteneur PHP/Nginx.
2. **Légèreté radicale & zéro usine à gaz** :
   - Beaucoup d'indépendants, de créatifs et de PME fuient Nextcloud (lenteur, dépendances lourdes, mises à jour fragiles). Un équivalent rapide, élégant et déployable en 60 secondes façon **« Synology DSM + Creative Studio dans un onglet »** comble un vrai vide du marché.
3. **Architecture modulaire & extensible (`apps/`) + Agent IA agnostique (`Compagnon`)** :
   - Capacité éprouvée à héberger des **modules métier privés en marque blanche** (sans toucher au noyau) — un levier B2B immédiat — combinée à un assistant IA souverain (cloud ou Ollama local) pilotant les apps natives et WASM.

---

## 2. Positionnement Marketing : 3 Segments Cibles Prioritaires

| Positionnement | Cible principale | Promesse client | Concurrents remplacés |
|---|---|---|---|
| **1. Creative Cloud & Media Hub Souverain** *(Priorité #1)* | Photographes, graphistes, vidéastes, petites agences, créateurs indépendants | *« Vos galeries clients HD, sélections commentées, cartes EXIF et outils de retouche PSD/PDF directement dans le navigateur — sans abonnement Adobe ni WeTransfer, hébergé en Europe ou chez vous. »* | Pixieset, Frame.io, Adobe CC, WeTransfer + Drive |
| **2. Bureau WebOS Personnel / Petite Équipe** | Freelances, associations, écoles, passionnés de self-hosting et souveraineté numérique | *« Un bureau complet dans un onglet, rapide et élégant, auto-hébergeable en 1 clic sur un NAS ou un mini-VPS à 5 €/mois. »* | Nextcloud, ownCloud, Puter.com, Cozy Cloud, CasaOS |
| **3. Portail WebOS Marque Blanche (B2B)** | PME techniques, centres de formation, clubs, simulateurs, collectivités | *« Un espace bureau web à votre marque combinant gestion documentaire sécurisée et vos propres applications métier privées dans `apps/`. »* | Intranets sur mesure, SharePoint léger |

---

## 3. Modèles Économiques & Services Vendables

### 1. Modèle **Open-Core** *(acquisition organique + licences self-hosted)*

| Offre | Cible | Prix indicatif | Inclus |
|---|---|---|---|
| **Community (Open Source)** | Particuliers, homelabs, découverte | **Gratuit** | Auto-hébergé, jusqu'à 3–5 utilisateurs, disque local, WebOS + apps natives + pont WASM, galeries publiques/privées. |
| **Pro / Studio License** | Photographes, freelances, créatifs, petites équipes | **79–149 € / an** *(ou licence perpétuelle + 1 an MAJ)* | Utilisateurs illimités, stockage **S3/R2**, WebDAV, galeries clients avancées (filigrane, sélection favoris, boîtes de dépôt), **Marque Blanche**, support prioritaire. |
| **Enterprise / White-Label** | PME, écoles, collectivités, intégrateurs | **À partir de 490 € / an** | SSO (OIDC/LDAP), journaux d'audit avancés, SLA, accompagnement intégration d'apps métier privées. |

### 2. Modèle **SaaS Hébergé (« Atelier Cloud »)** *(revenu récurrent prévisible)*

Grâce au déport du calcul lourd en **WebAssembly côté client**, la marge brute sur le stockage est très élevée :

| Formule SaaS | Stockage & Utilisateurs | Prix indicatif | Coût infra estimé (S3/R2 + micro-conteneur) |
|---|---|---|---|
| **Solo Créatif** | 250 Go · 1 utilisateur + partages clients illimités | **7–9 € / mois** | ~1,50–2,50 € / mois |
| **Studio** | 2 To · jusqu'à 5 utilisateurs · domaine perso · marque blanche | **29–39 € / mois** | ~6–10 € / mois |
| **Agence / Équipe** | 5–10 To · jusqu'à 20 utilisateurs · SSO · sauvegardes dédiées | **79–129 € / mois** | ~20–35 € / mois |

### 3. Prestations **B2B & Développement d'Apps Privées** *(financement court terme)*
- Installation souveraine sur serveur/NAS client + formation + infogérance annuelle.
- Développement au forfait d'applications métier privées dans `apps/` (modèle déjà validé en interne), finançant le développement du cœur produit sans dépendre d'une levée de fonds.

---

## 4. Stratégie de Lancement (Go-To-Market)

1. **Démo Live Publique « Zéro Friction »** :
   - Une instance de démonstration en lecture seule (reset périodique) permettant de tester le bureau WebOS, le nouvel Explorateur, la galerie EXIF/GPS, la calculatrice/traceur et l'ouverture d'un PSD/PDF dans le navigateur en 1 clic — meilleur outil marketing possible.
2. **Communauté Self-Hosting & Open Source** :
   - Lancement avec image Docker 1-clic sur *r/selfhosted*, *Hacker News (Show HN)*, *LinuxFr*, *Product Hunt* et blogs tech francophones/européens sous l'angle : **« Un WebOS créatif ultra-léger en PHP + WASM comme alternative simple à Nextcloud »**.
3. **Validation Terrain auprès de 5 à 10 Beta-Testeurs Payants** :
   - Recruter quelques photographes, graphistes ou petites structures avant d'investir dans le Control Plane SaaS complet : valider les usages réels (galeries clients, partage, WebDAV, retouche, automatisations) et ajuster les priorités.

---

## 5. Risques Majeurs & Garde-fous

| Risque | Impact | Parade |
|---|---|---|
| **Dispersion fonctionnelle** (vouloir tout faire : jeux, émulateurs, cloud pro) | Dilue l'effort et brouille le message marketing | Séparer clairement le **noyau Produit Cloud/Studio** (`ROADMAP.md`) des **apps communautaires/loisirs optionnelles** (`apps/games/`, `FEAT-11`) désactivables via `enabled_by_default: false`. |
| **Licences des apps WASM tierces** | Risque juridique si redistribution commerciale sans accord | Vérifier les licences (MIT/Apache/GPL) de chaque app embarquée en SaaS ; privilégier le téléchargement séparé ou des accords explicites avec leurs auteurs. |
| **Abus & contenus illicites (en mode SaaS)** | Blocage hébergeur / responsabilité légale | Quotas stricts, pas de plan gratuit anonyme illimité (essai limité ou carte requise), CGU claires, mécanisme de signalement/retrait rapide, logs d'audit. |
| **Sécurité multi-utilisateurs** | Fuite de données entre comptes | Couvrir chaque brique critique par une suite dédiée dans `tests/SecurityUnitTest.php` (isolation stricte des chemins, tokens de partage signés, RBAC testé en boîte noire). |
