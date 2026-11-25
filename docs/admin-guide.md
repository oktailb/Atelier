# Guide d'Administration — Atelier by GallusTech

Ce guide décrit l'architecture multi-utilisateurs, l'isolation des bureaux et du stockage, la matrice de permissions en cascade à 3 niveaux, ainsi que l'exploitation sécurisée d'une instance **Atelier by GallusTech**.

---

## 1. Comptes, rôles et modes d'authentification

Atelier prend en charge deux modes d'administration compatibles entre eux :

| Type de session | Stockage | Droits | Usage recommandé |
|---|---|---|---|
| **Admin « legacy »** (mot de passe maître sans login) | `.admin_password_hash` à la racine | Accès administrateur complet | Initialisation, mono-utilisateur ou compte de secours (*break-glass*) |
| **`superadmin` / `admin`** (compte en base) | Table `users` (`storage/atelier.sqlite` ou `storage/atelier_db/`) | Accès administrateur complet + home privé `users/<login>` + 2FA TOTP | Administration quotidienne en environnement multi-utilisateurs |
| **`user`** (membre standard) | Table `users` | Home privé `users/<login>` (RW) + matrice de droits (rôle `user` → groupes → utilisateur) | Collaborateurs et utilisateurs inscrits |
| **`guest`** (compte invité nommé) | Table `users` | Home privé `users/<login>` (RW) + matrice de droits (rôle `guest` → groupes → utilisateur) | Partenaires/clients disposant d'un identifiant restreint |
| **Anonyme** (non connecté) | Aucun | Lecture seule sur la galerie publique (`storage/media/`) + matrice de droits `anonymous` | Visiteurs publics |

> **Conseil de sécurité** : en production multi-utilisateurs, créez au moins un compte personnel `admin` avec 2FA TOTP activé et conservez le mot de passe maître (`.admin_password_hash`) uniquement comme accès d'urgence fort.

---

## 2. Isolation des bureaux et modèle global

Chaque catégorie de session dispose de son propre bureau de raccourcis afin qu'aucun raccourci privé ou d'administration ne fuite vers les visiteurs :

| Session active | Source des raccourcis bureau | Portée d'une modification (drag & drop / suppression) |
|---|---|---|
| **Visiteur anonyme** | `storage/desktop.json` (`scope: global`) | **Lecture seule** (toute écriture est rejetée avec HTTP `403`) |
| **Compte utilisateur / admin en base** | `users.preferences_json.desktop.shortcuts` (`scope: user`), avec repli initial sur `storage/desktop.json` | Sauvegardé uniquement sur le bureau personnel du compte |
| **Admin legacy** (sans compte en base) | `storage/desktop_admin.json` (`scope: admin`), avec repli initial sur `storage/desktop.json` | Sauvegardé uniquement dans `storage/desktop_admin.json` |

### Gérer le bureau par défaut (Invités & nouveaux comptes)

Depuis **Panneau de configuration → Apparence → Bureau par défaut (Invités & nouveaux comptes)** (visible uniquement aux administrateurs) :
- Consultez et retirez les raccourcis présents dans `storage/desktop.json`.
- Cliquez sur **« Publier mon bureau actuel comme modèle global »** pour copier la disposition de votre bureau vers `storage/desktop.json` (action API `save_desktop_shortcuts` avec `scope: "global"`).
- Les comptes déjà personnalisés conservent leur propre bureau ; seuls les invités et les nouveaux comptes sans personnalisation héritent du modèle global.

---

## 3. Cloisonnement du stockage (serveur & navigateur)

### 3.1 Stockage serveur (VFS)
- **Galerie publique** : `storage/media/` — visible par défaut (sauf sous-dossiers protégés par `.private` ou `.password`).
- **Espaces privés utilisateurs** : `storage/users/<username>/` — physiquement séparés de `storage/media/`, protégés par `.htaccess` (`Deny from all`) et `.private`. Un utilisateur ne peut voir que son propre home et les dossiers explicitement partagés avec lui ou ses groupes.
- **Base de données** : `storage/atelier.sqlite` (SQLite WAL avec migrations automatiques) ou fallback JSON atomique `storage/atelier_db/` si `PDO_SQLITE` est absent.

### 3.2 Stockage navigateur (`localStorage` & préférences UI)
- `window.sys.storage` et les services WebOS isolent toutes les clés par scope utilisateur :
  - Utilisateur nommé : `u_<id>` (ex. `webos_u_4_app_graphing-calc_history`, `sg_pref_u_4_theme`, `tribune_u_4_board_auth`).
  - Admin legacy : `admin`.
  - Visiteur anonyme : `guest`.
- Les préférences principales (`theme`, `wallpaper`, `window_style`, `locale`, `explorer_view_mode`) sont également **synchronisées côté serveur** dans `users.preferences_json` (limite 128 Ko) et réappliquées à chaud lors d'un changement de session (`auth:changed`).
- Le bouton **« Réinitialiser le stockage local »** (onglet *Confidentialité*) appelle `sys.storage.clearUserScope()` et ne supprime **que** les données du compte actif, sans impacter les autres comptes enregistrés sur le même navigateur.

### 3.3 Limite connue sur les applications externes (iframes WASM même origine)
Les applications tierces intégrées en `<iframe>` sur la même origine (ex. WordCraft, ArtCraft, PdfCraft) sauvegardent leurs fichiers dans Atelier via le pont VFS (`WebAppVfsBridge`) dans le home isolé `users/<login>/`. En revanche, leurs éventuels brouillons auto-sauvegardés dans leur propre `IndexedDB` interne restent liés au **profil navigateur**. Sur un poste partagé physiquement entre plusieurs personnes, recommandez l'utilisation de profils navigateur distincts ou d'une fenêtre de navigation privée.

---

## 4. Matrice de droits en cascade à 3 niveaux

Les permissions sur la **galerie publique (`storage/media/`)** et les **capacités globales** (`can_use_browser_proxy`) sont évaluées par `PermissionsManager::resolveEffectivePermissions()` selon une cascade déterministe à 3 niveaux :

```text
Admin / Superadmin / Admin legacy  ──▶  Tout autorisé (true)

Non-admin :
  Niveau 1 : Matrice de rôle (storage/permissions.json)
               ├─ Visiteur non connecté  → roles.anonymous
               ├─ Compte rôle `guest`    → roles.guest
               └─ Compte rôle `user`     → roles.user
                     │
                     ▼
  Niveau 2 : Surcharges des Groupes (groups.permissions_json)
               ├─ `inherit` (omis) : conserve la valeur du rôle
               ├─ `allow`          : autorise
               └─ `deny`           : refuse (PRIORITAIRE sur `allow` si l'utilisateur
                                     appartient à plusieurs groupes contradictoires)
                     │
                     ▼
  Niveau 3 : Surcharges Utilisateur (users.permissions_json)
               ├─ `inherit` (omis) : conserve le résultat Rôle + Groupes
               ├─ `allow`          : autorise (priorité maximale)
               └─ `deny`           : refuse (priorité maximale)
```

### Liste des 8 capacités contrôlées par la matrice

| Clé technique | Rôle |
|---|---|
| `can_upload` | Téléverser des fichiers dans la galerie publique |
| `can_delete` | Supprimer des fichiers/dossiers dans la galerie publique |
| `can_move` | Déplacer/renommer dans la galerie publique |
| `can_comment` | Éditer les légendes/commentaires (`.comment`) dans la galerie publique |
| `can_create_folder` | Créer des sous-dossiers dans la galerie publique |
| `can_download_archive` | Télécharger un dossier entier en archive ZIP/TAR |
| `can_download_item` | Télécharger des fichiers individuels |
| `can_use_browser_proxy` | Utiliser le proxy HTTP côté serveur dans l'application Navigateur |

### Séparation stricte avec les ACL des espaces privés (`users/...`) et partages
La matrice ci-dessus **ne s'applique jamais** pour ouvrir un accès sur `users/<login>/...` ou sur un dossier partagé :
- **Home personnel (`users/<login>/`)** : le propriétaire a les droits complets lecture/écriture/upload/suppression dans son home (sous réserve de son **quota disque**).
- **Partage utilisateur ou groupe** : strictement limité au mode configuré (`read` ou `write`). Un partage `read` interdit toute écriture même si la matrice publique autorise `can_upload`.
- **Lien externe signé (`/s/<token>`)** : mode `read` (lecture/téléchargement) ou `drop` (boîte de dépôt : upload uniquement, jamais suppression ni déplacement).

### Où configurer chaque niveau dans le Control Panel
1. **Niveau 1 (Rôles)** : **Panneau de configuration → Sécurité** — tableau 3 colonnes (*Anonyme* | *Invité (compte)* | *Membre (user)*).
2. **Niveau 2 (Groupes)** : **Panneau de configuration → Utilisateurs & Groupes → Groupes** — dépliez **🔑 Droits** sur chaque groupe (*Hériter* / *Autoriser* / *Refuser*).
3. **Niveau 3 (Utilisateur)** : **Panneau de configuration → Utilisateurs & Groupes → Utilisateurs** — dépliez **🔑 Droits** sur chaque compte non-admin.

### Exemples pratiques
- **Autoriser les membres à commenter/télécharger la galerie publique mais garder les anonymes en consultation seule** : cochez `can_comment` et `can_download_item` uniquement dans la colonne *Membre (user)*.
- **Créer une équipe « Éditeurs » qui peut publier dans la galerie publique** : laissez `can_upload` décoché pour le rôle `user`, créez le groupe `editeurs` avec la surcharge `can_upload = Autoriser` et ajoutez-y les membres concernés.
- **Restreindre un membre précis malgré son groupe** : dans la fiche utilisateur, passez `can_upload = Refuser` (la surcharge utilisateur l'emporte sur le groupe).

---

## 5. Inscriptions autonomes, E-mail SMTP, 2FA TOTP et SSO OIDC

### 5.1 Politique d'inscription (**Inscriptions, 2FA & SSO**)
- `disabled` *(par défaut)* : seuls les administrateurs créent des comptes.
- `invite_only` : exige un lien d'invitation signé à usage unique (`?invite=<token>`), générable dans la même section.
- `approval` : les nouveaux comptes sont placés en file **Approbations en attente** avant activation.
- `open` : création autonome immédiate (après vérification e-mail si activée).
- Filtrage par **domaines e-mail autorisés / bloqués**, longueur minimale de mot de passe, **quota disque par défaut (Mo)** et **groupes par défaut**.

### 5.2 Transport E-mail (**E-mail & SMTP**)
- `outbox_log` *(par défaut)* : n'envoie rien sur le réseau ; enregistre les e-mails (avec liens de vérification/reset) dans un journal local consultable dans l'onglet **E-mail & SMTP** (idéal pour les tests et environnements isolés).
- `php_mail` : utilise la fonction `mail()` de PHP.
- `smtp` : client SMTP natif (STARTTLS / SSL/TLS / AUTH LOGIN/PLAIN) avec bouton **Envoyer un e-mail de test**.

### 5.3 Double authentification 2FA (TOTP RFC 6238)
- Politiques : `disabled`, `optional`, `required_admins`, `required_all`.
- QR Code généré **100 % localement en SVG** (zéro appel réseau externe), protection anti-replay sur le pas TOTP, et **8 codes de secours** à usage unique hashés en base.
- En cas de perte de téléphone, un administrateur peut réinitialiser la 2FA d'un utilisateur depuis **Utilisateurs & Groupes → 🔓 Réinitialiser 2FA**.

### 5.4 SSO OpenID Connect (OIDC)
- Compatible Authentik, Keycloak, Google, Authelia, etc. via discovery `.well-known/openid-configuration` (avec PKCE `S256` et vérification `state`).
- URI de callback à déclarer chez votre fournisseur d'identité : `https://<votre-domaine>/?oidc_callback=1`.

---

## 6. Quotas disque, Sessions actives, Partages et Audit

- **Quotas disque** : configurables par utilisateur (`0` = illimité) ou par défaut à l'inscription. L'occupation du home (`users/<login>/`, hors `.thumbnails/`) est affichée en barre visuelle dans l'Explorateur et bloquée côté serveur par HTTP `413` en cas de dépassement.
- **Sessions actives** : visibles dans **Sécurité → Sessions actives** (avec révocation individuelle ou « Déconnecter les autres »). La désactivation d'un utilisateur ou la révocation d'une session coupe l'accès dès la requête suivante (`AuthManager::revalidateActiveUser()`).
- **Liens de partage courts (`/s/<token>`)** : réécrits via `.htaccess` vers `index.php?share=$1`, avec mot de passe optionnel, expiration, limite de téléchargements et révocation immédiate (**Partages, Liens & Audit**).
- **Journal d'audit** : trace les connexions, créations/modifications/suppressions de comptes, changements de droits, partages et révocations dans la table `audit_logs`.

---

## 6.1 Export de données personnelles (ZIP signé) & suppression autonome de compte (RGPD)

Tout utilisateur authentifié (compte en base `users`) dispose depuis **Panneau de configuration → Sécurité** de deux outils de souveraineté sur ses données :

1. **Archive ZIP signée à durée de vie limitée (`AccountExportService`)** :
   - Empaquette `account_export.json` (profil sanitisé, préférences, groupes, partages) + l'intégralité du home `users/<login>/` (hors `.thumbnails/` et dotfiles système) dans `storage/exports/` (protégé par `.htaccess` `Deny from all`).
   - Délivre un lien signé à durée limitée (`6 h` / `24 h` / `72 h`, jeton stocké **hashé SHA-256** dans `auth_tokens`) accessible via `system/endpoints/export.php?token=<token>` ou la route courte `/e/<token>`, **même après déconnexion ou suppression du compte**.
   - **Confirmation de réception complète** :
     - Lors du téléchargement streamé (`Content-Length` + en-tête `X-Export-SHA256`), le serveur vérifie que **100 % des octets** ont été transmis sans interruption avant d'enregistrer `download_completed_at`.
     - L'utilisateur vérifie son archive (empreinte SHA-256 affichée) et clique sur **« Confirmer la réception complète & purger »** (`confirm_account_export_receipt` ou portail `/e/<token>`), ce qui invalide le jeton (`410 Gone`) et **supprime immédiatement le fichier `.zip` du disque**.
     - Les archives expirées sont automatiquement purgées du disque par ramasse-miettes opportuniste.

2. **Suppression autonome de compte (`delete_own_account`)** :
   - Exige le **mot de passe actuel**, un **code 2FA** (si activé), la saisie exacte du `@username` et une confirmation d'irréversibilité.
   - Bloque la suppression si le compte est le **dernier administrateur actif** sans mot de passe maître `.admin_password_hash` (protection anti-verrouillage).
   - Par défaut, génère l'archive ZIP signée **avant** d'effacer la moindre donnée (si l'empaquetage échoue, la suppression est annulée), envoie le lien par e-mail si une adresse est renseignée, affiche la modale de téléchargement post-suppression, puis efface physiquement `storage/users/<login>/`, les sessions, les partages, les lignes en base et le `localStorage` du compte.

---

## 7. Sauvegarde et checklist de mise en production

### Fichiers critiques à sauvegarder
- `storage/atelier.sqlite` (ou `storage/atelier_db/`) — comptes, groupes, surcharges de droits, partages, sessions, audit.
- `storage/users/` et `storage/media/` — fichiers utilisateurs et galerie publique.
- `storage/permissions.json`, `storage/auth_settings.json`, `storage/desktop.json`, `storage/desktop_admin.json`, `storage/autostart.json`, `.admin_password_hash`.

### Checklist avant exposition sur Internet
1. Servir impérativement derrière **HTTPS** (cookies de session `Secure` + `HttpOnly` + `SameSite=Lax`, obligatoire pour OIDC et recommandé pour TOTP).
2. Vérifier que le serveur Web respecte les `.htaccess` (ou répliquer le blocage de `/storage/`, `/config/`, `/tests/` et des fichiers `.*` sous Nginx).
3. Configurer `URL publique de base` dans **E-mail & SMTP** afin que les liens d'e-mail, `/s/<token>` et callbacks OIDC pointent vers le bon domaine HTTPS.
4. Définir la politique 2FA sur `required_admins` (minimum) et lancer la suite de tests (`php tests/run_tests.php`) après chaque mise à jour.
