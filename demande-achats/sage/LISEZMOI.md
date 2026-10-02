# Connecteur Sage 100 – Demandes d'achat

Le connecteur relie l'application de demandes d'achat (Supabase) à **Sage 100 Gestion commerciale**.
Il est installé sur le serveur Sage (`SERVER`, instance `localhost\SAGE100C2`) et s'exécute toutes les 5 minutes.

| Étape | Ce que fait le connecteur |
|---|---|
| 1. Catalogue | Envoie à l'application les **articles** et **fournisseurs** actifs de `GES_VALORISE` et `GES_ECO`, une fois par heure. |
| 2. Export | Pour chaque DA que l'admin a transmise à Sage, il crée un **fichier d'import** dans `C:\SageImport\<SOCIÉTÉ>\`. |
| 3. Contrôle | Il retrouve dans Sage la **Demande d'achat (type 10)** importée, grâce à sa *Référence* (= n° de la DA dans l'application, ex. `DA-2026-0001`), puis renvoie le **n° de pièce Sage** dans l'application. |

> 🔒 Le connecteur **ne modifie jamais la base Sage** : il ne fait que des lectures SQL.
> La création dans Sage passe par l'**import standard de Sage**.

---

## 1. Prérequis

1. **Accès Internet sortant** depuis le serveur vers `https://<votre-projet>.supabase.co` (port 443).
   Le diagnostic a montré que le serveur **n'y a pas accès** (`supabase.com NON joignable`) : à faire ouvrir par l'informaticien.
   Rien n'est à ouvrir en entrée.
2. **Supabase :** exécutez la section **« 8. Liaison Sage 100 »** de `supabase/schema.sql` dans le *SQL Editor*.
   Elle peut être exécutée seule, sur la base déjà en place.

## 2. Installation (une seule fois)

1. Créez le dossier `C:\ConnecteurDA` et copiez-y :
   `connecteur-sage.ps1`, `installer-tache.ps1`, `connecteur-config.exemple.json`.
2. Copiez `connecteur-config.exemple.json` sous le nom **`connecteur-config.json`**, ouvrez-le avec le Bloc-notes et complétez-le :
   - `SupabaseUrl` : l'URL du projet, par exemple `https://lcdetsremuoyyxmstdju.supabase.co` ;
   - `ServiceRoleKey` : la clé **service_role** (Supabase → Project Settings → API Keys → Legacy).
     ⚠️ Elle est secrète : elle ne doit se trouver que dans ce fichier, sur ce serveur ;
   - `SqlInstance` : `localhost\\SAGE100C2` (garder le double `\\`) ;
   - `Societes` : le code utilisé dans l'application et le nom de la base SQL du dossier Sage (déjà rempli pour `GES_VALORISE` et `GES_ECO`).
3. **Premier test, à la main** : ouvrez PowerShell en administrateur, puis tapez :
   ```
   cd C:\ConnecteurDA
   powershell -ExecutionPolicy Bypass -File .\connecteur-sage.ps1
   ```
   Le résultat attendu ressemble à : `Catalogue GES_VALORISE : 1027 articles, 756 fournisseurs envoyes`.
   Dans l'application, les articles Sage apparaissent alors dans la fiche de demande.
4. **Planification** : tapez la commande suivante, puis entrez le mot de passe du compte Windows qui exécutera le connecteur :
   ```
   powershell -ExecutionPolicy Bypass -File .\installer-tache.ps1
   ```
   Une tâche « Connecteur DA Sage » est créée ; elle s'exécute toutes les 5 minutes.

## 3. Créer le format d'import dans Sage (une fois par société)

Le fichier généré contient une ligne **E** (en-tête) par DA, suivie de ses lignes **L** (articles), avec `;` comme séparateur :

```
E;10;;021026;DA-2026-0001;ABPLAST;1
L;V009-001-0125;CLOUS 32;100;0,5
L;ACHATS_DES_EPI;Gants;20;0
```

| Enregistrement | Champs, dans l'ordre |
|---|---|
| **E** (en-tête du document) | Identifiant `E` · Type de document (`10` = Demande d'achat) · N° de pièce (vide → numérotation Sage) · Date (`JJMMAA`) · **Référence** (n° de la DA de l'application) · Code fournisseur (CT_Num) · N° de dépôt |
| **L** (ligne du document) | Identifiant `L` · Référence article (AR_Ref) · Désignation · Quantité · Prix unitaire (virgule décimale) |

Dans Sage 100 Gestion commerciale, sur une **copie du dossier**, pour commencer :

1. Ouvrez **Fichier → Format import/export paramétrable** (selon la version : *Formats paramétrables*), puis **Nouveau**.
2. Choisissez **Documents des achats**, un fichier **délimité** et le séparateur **`;`**.
3. Créez l'enregistrement **Entête** avec l'identifiant `E`, puis l'enregistrement **Ligne** avec l'identifiant `L`. Ajoutez les champs **dans l'ordre du tableau ci-dessus**.
4. Choisissez le format de date **JJMMAA**, puis enregistrez le format sous le nom **`DA_APP`**.
5. Testez l'import d'un fichier généré : **Fichier → Importer → Format paramétrable → `DA_APP`**.

> Si votre format Sage diffère (autre ordre des champs, autre format de date, etc.), il n'y a rien à reprogrammer.
> Il suffit d'ajuster `Fichier.Entete`, `Fichier.Ligne`, `FormatDate` et `SeparateurDecimal` dans `connecteur-config.json`.
> Champs disponibles :
> - en-tête : `{TYPE}`, `{PIECE}`, `{DATE}`, `{DATE_LIVRAISON}`, `{REFERENCE}`, `{FOURNISSEUR}`, `{DEPOT}`, `{DEMANDEUR}`, `{SERVICE}`, `{MOTIF}` ;
> - lignes : `{ARTICLE}`, `{DESIGNATION}`, `{QUANTITE}`, `{PRIX}`, `{UNITE}`, `{REF_CONSTRUCTEUR}`, `{REFERENCE}`.
>
> 💡 Pour vérifier le format, exportez une DA existante avec `DA_APP` (Fichier → Exporter) et comparez-la au fichier du connecteur.

## 4. Utilisation au quotidien

1. Le **demandeur** choisit la **société**, puis les **articles Sage**, et envoie sa DA.
2. L'**admin** passe la DA au statut **Validée**. Dans le bloc **Sage 100**, il choisit le **fournisseur Sage** et clique sur **« Préparer l'import Sage »**.
3. Dans les 5 minutes, le fichier apparaît dans `C:\SageImport\GES_VALORISE\` (ou `GES_ECO`). Le tableau de bord admin affiche « Sage : fichiers à importer ».
4. Dans Sage, importez le fichier : **Fichier → Importer → `DA_APP`**.
5. Dans les 5 minutes, l'application affiche **« Enregistrée dans Sage »** avec le **n° de pièce Sage**. Le demandeur reçoit une notification et le fichier est rangé dans le sous-dossier `importes`.

**Anti-doublon** : avant de générer un fichier, le connecteur vérifie que la DA n'existe pas déjà dans Sage (même *Référence*).

## 5. En cas de problème

Toute l'activité est écrite dans `C:\ConnecteurDA\connecteur.log`.

| Message | Cause probable |
|---|---|
| `Supabase … could not be resolved` | Le serveur n'a pas accès à Internet (voir les prérequis). |
| `Supabase … 401` | La clé `ServiceRoleKey` est incorrecte. |
| `Login failed for user` / `Cannot open database` | Le compte Windows de la tâche n'a pas accès à la base SQL de Sage. |
| Statut « Erreur Sage » dans l'application | Le message exact s'affiche dans le bloc Sage 100 de la DA. Corrigez, puis cliquez sur « Regénérer le fichier d'import ». |
