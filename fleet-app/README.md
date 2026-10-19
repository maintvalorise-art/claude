# Valorise Maroc : Achats, Spare Parts, Fleet & Bennes

Plateforme unique (PC + téléphone) construite d'après le cahier des charges « Projet Achats, Spare Parts & Fleet
Management ».

> **Affichage actuel : Fleet management uniquement** (avec l'espace terrain des chauffeurs). Les modules Achats,
> Magasin et Bennes restent dans la base mais sont masqués. Pour les réafficher, définissez la variable
> `VITE_MODULES=flotte,achats,magasin,bennes` (Vercel → Environment Variables), puis faites Redeploy.

Les quatre modules partagent la même base **Supabase** (articles, fournisseurs, équipements,
bennes). Chaque profil n'accède qu'à son module, et ces droits sont appliqués **dans la base**
(Row Level Security), pas seulement dans l'interface.

## Profils et accès

| Profil | Accès |
|---|---|
| **Administrateur** | Tout, plus comptes, profils et paramètres |
| **Direction** | Lecture de tous les modules, validation des DA au-delà du seuil, indicateurs |
| **Acheteur** | Traitement des DA, devis, bons de commande, réceptions, fournisseurs, termes, prix ; lecture du stock |
| **Magasinier** (Salah) | Articles, entrées/sorties par scan, inventaires, vérification stock des DA, réceptions |
| **Responsable flotte** | Véhicules, papiers, maintenance, pneus, validation des fiches, accidents, gasoil, trajets |
| **Exploitation / logistique** | Bennes, clients, mouvements de bennes |
| **Chauffeur / conducteur** | Fiche de contrôle, demande d'intervention, plein, trajet, scan de benne, déclaration d'accident |
| **Demandeur** | Émet et suit ses demandes d'achat ; valide celles de son équipe s'il en est le responsable |

La case **« Demandeur autorisé »** ajoute n'importe quel compte à la liste des demandeurs d'achat. Le
**responsable hiérarchique** de chaque compte valide ses DA.

## Modules

### 1. Achats
- **Demande d'achat** émise uniquement par un demandeur autorisé, avec un numéro **DA-AAAA-NNNN**. Elle
  contient la désignation, la référence, la quantité, l'unité, la machine ou le véhicule, le motif, l'urgence
  (normal, urgent, arrêt machine) et la date souhaitée.
- **Circuit de la DA :**
  1. Vérification du stock par le magasin. Si la pièce est en stock, elle est servie et la DA est clôturée.
  2. Validation par le responsable hiérarchique.
  3. Validation par la direction au-delà du seuil.
  4. Consultation fournisseurs : 3 devis au-delà du seuil, 1 en dessous ou en cas d'arrêt machine.
  5. Bon de commande **BC-AAAA-NNNN**.
  6. Réception partielle ou totale, avec entrée automatique en stock et rapprochement BC / BL / facture.
  7. Clôture avec évaluation du fournisseur.
- **Délais cibles :** arrêt machine 2 h / même jour ; urgent 24 h / 48 h ; normal 48 h / 5 jours ouvrés. Les
  DA en retard sont signalées, de même que les relances fournisseurs (livraison en retard).
- **Panel fournisseurs :**
  - fiche complète (ICE, RC, IF, RIB, contacts, catégories, certifications, conditions) ;
  - vérification avant référencement ;
  - classification stratégique, régulier ou occasionnel ;
  - évaluation semestrielle ;
  - alerte sur les catégories critiques à source unique.
- **Termes :** contrats-cadres et accords de prix (prix, délais, paiement, garantie, pénalités, retour), avec
  une alerte avant la fin du contrat et l'**historique des prix** par article.

### 2. Spare parts / Magasin
- **Référentiel** : code article, code-barres, catégorie, équipement, référence OEM, criticité **A/B/C**,
  stock min/max, emplacement, fournisseurs principal et secondaire, prix.
- **Scan** à chaque entrée et sortie, avec douchette USB ou caméra du téléphone. Une sortie ne peut pas
  dépasser le stock, et chaque sortie est imputée au véhicule ou à la machine.
- **DA automatique** dès qu'un article passe sous son stock min (urgente pour une pièce A).
- **Inventaire** tournant (pièces A) ou complet, avec ajustement des écarts et calcul de la fiabilité.
- **Tableaux de bord** : valeur du stock, articles sous le min, ruptures A, consommation par équipement,
  articles dormants.

### 3. Fleet management
- **Fiche équipement** : code interne, type, immatriculation ou n° de série, compteur en km ou en heures,
  conducteur affecté, statut.
- **Papiers** : carte grise, assurance, visite technique, vignette, autorisations (transport, déchets
  dangereux), carnet d'entretien. Alerte **30 j et 7 j** avant échéance.
- **Planning de maintenance** déclenché au compteur ou à la date (vidange, préventif, hydraulique).
  Interventions préventives et correctives avec cause, durée d'immobilisation et coût. Les pièces sorties du
  magasin donnent le **coût réel par véhicule**.
- **Pneus** : position, marque, montage, compteur, permutation, remplacement.
- **Fiche de contrôle** bilingue FR/AR, validée par le responsable flotte. Un point non conforme crée une
  intervention automatiquement.
- **Accidents** :
  - déclaration avec photos par le chauffeur ;
  - suivi du dossier assurance (expertise, indemnisation, franchise) ;
  - réparation, analyse des causes, actions correctives ;
  - historique par véhicule et par chauffeur.
- **Gasoil et trajets** :
  - pleins (station ou cuve, bon ou carte) ;
  - consommation L/100 km ou L/h avec alerte en cas d'écart ;
  - journal des trajets (client, décharge, fournisseur ; benne ; poids du ticket de pont bascule) ;
  - **rapprochement** km × consommation attendue avec les litres déclarés.

### Planning et historique (Fleet)
- **Planning (calendrier)** : le calendrier mensuel (ou la vue agenda) affiche :
  - les dates d'expiration des papiers ;
  - les maintenances dues, avec une date estimée d'après l'utilisation réelle pour celles au compteur ;
  - vos rendez-vous.
- **À planifier** : la liste des papiers expirant sous 90 jours et des maintenances proches. Un clic sur
  « Planifier » propose une date 2 semaines avant l'échéance (un jour ouvré), que vous pouvez changer.
- **Rendez-vous** :
  - Vous pouvez reporter un rendez-vous, le marquer fait ou l'annuler. Il passe automatiquement à « fait »
    quand le nouveau papier ou la maintenance est enregistré.
  - Une alerte s'affiche la veille, le jour même et en cas de retard.
- **Export .ics** vers Google Agenda ou Outlook.
- **Historique de maintenance** : toutes les interventions de la flotte, filtrées par période, véhicule, type et
  nature. La synthèse par véhicule donne le nombre d'interventions, le coût, l'immobilisation et la part
  préventive. Export Excel et PDF.

### 4. Bennes
- Référentiel avec n° peint et QR : type, volume, déchet, état, révision.
- **Phase 1** : chaque mouvement (pose, enlèvement, échange, vidage, retour dépôt, réparation, vérification)
  est saisi par scan. Le statut et le client de la benne se mettent à jour automatiquement.
- Tableau de bord : bennes par client, durée de stationnement, disponibles au dépôt, rotations, alerte de
  **benne immobile**.
- **Phase 2 (GPS)** : les champs latitude et longitude sont prêts, avec un lien vers la carte.

### Transverse
- **Traçabilité :** chaque opération est horodatée avec son auteur (journal d'audit, historique des DA).
  **Aucune suppression** n'est possible : uniquement des annulations justifiées ou des archivages.
- **Alertes :** page Alertes et badge dans le menu. Un **e-mail quotidien** envoie à chaque profil les
  alertes de ses modules : stock min, échéance de document, maintenance due, retard fournisseur,
  consommation anormale, benne immobile.
- **Exports** Excel (CSV) et PDF (impression) sur toutes les listes.
- **KPI** par période, pour la direction et les responsables.

## Installation

### 1. Base de données Supabase
1. Créez un projet sur <https://supabase.com> (région Europe).
2. **SQL Editor** : exécutez dans l'ordre `supabase/migrations/20261002000000_init.sql`, puis
   `supabase/migrations/20261019000000_planning.sql` (ce second fichier peut être relancé sans risque).
   > ⚠️ Si une **ancienne version** a déjà été installée, exécutez d'abord `supabase/reset.sql`. Il efface
   > les données de l'application ; les comptes de connexion sont conservés.
3. **Authentication → Sign In / Providers** : désactivez « Allow new users to sign up ».

### 2. Premier administrateur
1. **Authentication → Users → Add user** : saisissez votre e-mail et un mot de passe, et cochez *Auto confirm*.
2. Dans le SQL Editor :
   ```sql
   update public.profiles set role = 'admin', full_name = 'Votre nom' where email = 'votre@email.com';
   ```

### 3. Fonctions Edge (création des comptes, e-mails d'alerte)
Vous pouvez les créer depuis le tableau de bord : **Edge Functions → Deploy a new function → Via Editor**.
Collez le contenu de `supabase/functions/admin-users/index.ts` sous le nom `admin-users`, puis faites de même
pour `daily-alerts` en désactivant « Verify JWT ».

Ou avec la CLI :
```bash
npx supabase login && npx supabase link --project-ref <ref>
npx supabase functions deploy admin-users
npx supabase functions deploy daily-alerts --no-verify-jwt
```

### 4. Application (Vercel)
1. Importez le dépôt GitHub sur <https://vercel.com>. La « Root Directory » doit pointer vers le dossier qui
   contient `package.json`.
2. Ajoutez les variables suivantes (Supabase → Project Settings → API) :
   - `VITE_SUPABASE_URL` (ex. `https://abcd.supabase.co`, sans `/rest/v1`)
   - `VITE_SUPABASE_ANON_KEY` (clé **anon public**)
   - `VITE_LOGIN_DOMAIN` = `flotte.local`
3. Cliquez sur **Deploy**. Après toute modification de variable, faites **Redeploy**.

En local : `cp .env.example .env`, puis `npm install && npm run dev`.

### 5. E-mails d'alerte (optionnel)
1. Créez une clé sur <https://resend.com>, puis définissez les secrets des fonctions (Edge Functions →
   Secrets) :
   - `RESEND_API_KEY`
   - `ALERT_FROM` (ex. `Valorise <alertes@votre-domaine.ma>`)
   - `APP_URL` (lien Vercel)
   - `CRON_SECRET` (texte aléatoire)
   - `ALERT_EMAILS` (optionnel : adresses en copie de toutes les alertes)
2. Activez les extensions `pg_cron` et `pg_net`, puis exécutez la requête suivante (envoi chaque jour à 7 h UTC) :
   ```sql
   select cron.schedule('alertes-valorise', '0 7 * * *', $$
     select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/daily-alerts',
       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>', 'Content-Type', 'application/json'));
   $$);
   ```
   Les profils dont l'e-mail est réel reçoivent les alertes de leurs modules. Les identifiants courts
   (`ahmed@flotte.local`) n'en reçoivent pas.

### 6. Paramétrage
**Paramètres** :
- seuil de validation direction ;
- seuil des 3 devis ;
- benne immobile (jours) ;
- tolérance de consommation ;
- alerte de fin de contrat ;
- périodicité de la fiche de contrôle ;
- points de la fiche de contrôle.

## Structure
```
supabase/migrations/…_init.sql   tables, numérotation, triggers, vues d'alertes, KPI, RLS
supabase/reset.sql               remise à zéro avant réinstallation
supabase/functions/              admin-users (comptes), daily-alerts (e-mails)
src/pages/achats|magasin|flotte|bennes|terrain|admin
src/lib/roles.ts                 matrice des droits (miroir des règles RLS)
```

## Hors périmètre (à brancher plus tard)
- Intégrations avec les outils existants : gestion de stock, pont bascule, RH.
- Traceurs GPS (phase 2) : les champs sont prêts et peuvent être alimentés par une API du fournisseur GPS.
