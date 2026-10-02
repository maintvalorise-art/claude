# Gestion de flotte : camions & engins

Application web (mobile + bureau) pour gérer un parc de camions et d'engins avec **Supabase**.

## Fonctionnalités

### Espace chauffeur (FR + عربية, pensé pour le téléphone)
- **Fiche de contrôle avant départ** : les 31 points de la fiche Jotform (OK / NOK + commentaire), km de départ,
  prochaine vidange, conducteur précédent (prérempli), remarques.
  - Le compteur ne peut pas reculer, et la fiche est refusée si un point n'est pas renseigné.
  - **Un point NOK crée automatiquement une demande d'intervention** pour la maintenance.
- **Demandes d'intervention** : vidange, panne, pneus, freins, électrique, hydraulique… avec priorité et option
  « véhicule immobilisé » (le véhicule passe alors automatiquement *en panne*). Le chauffeur suit le statut et la réponse.
- Alertes sur ses propres papiers (permis…) et ceux de son véhicule attitré.

### Espace gestion (gestionnaire + admin)
- **Tableau de bord** : véhicules opérationnels / en panne, demandes ouvertes, papiers expirés, fiches du jour,
  véhicules attribués sans fiche aujourd'hui.
- **Parc** : camions, engins (compteur en km ou en heures), véhicules légers, remorques. Fiche détaillée avec
  papiers, interventions, historique des fiches, bouton « Vidange effectuée ».
- **Papiers & échéances** : visite technique, assurance, vignette, carte grise, contrôle tachygraphe, extincteurs,
  autorisation, + papiers chauffeur (permis, carte pro, visite médicale). Délai d'alerte réglable par papier,
  renouvellement avec historique.
- **Vidanges** suivies au compteur (alerte X km/heures avant).
- **Demandes d'intervention** : statut, priorité, mécanicien/garage, réponse, coût, statut du véhicule.
- **Historique des fiches** avec filtres et impression.
- **Comptes** (admin) : création des chauffeurs avec un identifiant simple (`ahmed`) et un mot de passe, rôles,
  désactivation, réinitialisation du mot de passe.
- **Paramètres** (admin) : ajouter, modifier ou désactiver les points de la fiche de contrôle.

### Notifications
| Niveau | Papiers | Vidange |
|---|---|---|
| **Bientôt** | moins de *N* jours (30 par défaut, réglable) | moins de *alerte_vidange* km/h |
| **Urgent** | 7 jours ou moins | moins de la moitié du seuil |
| **Expiré** | date dépassée | compteur dépassé |

- Dans l'application : badges dans le menu, tableau de bord, et une notification du navigateur à l'ouverture.
- **E-mail quotidien** (optionnel) : la fonction `daily-alerts` envoie chaque matin le récapitulatif via Resend.

## Rôles et sécurité
Toutes les règles sont appliquées **dans la base** (Row Level Security), pas seulement dans l'interface :

| | Chauffeur | Gestionnaire | Admin |
|---|---|---|---|
| Remplir une fiche / faire une demande | ✓ | ✓ | ✓ |
| Voir ses fiches et ses demandes | ✓ | tout | tout |
| Gérer le parc, les papiers et les interventions | – | ✓ | ✓ |
| Créer des comptes, changer les rôles, paramètres | – | – | ✓ |

Un nouveau compte est toujours *chauffeur* ; seul un admin peut changer un rôle.

## Installation

### 1. Créer le projet Supabase
1. Créez un projet sur <https://supabase.com>.
2. **SQL Editor** : collez et exécutez `supabase/migrations/20261002000000_init.sql`.
   (Ou avec la CLI : `supabase link --project-ref <ref>` puis `supabase db push`.)
3. **Authentication → Sign In / Providers** : désactivez **« Allow new users to sign up »**. Les comptes sont créés
   par l'admin depuis l'application.

### 2. Déployer les fonctions Edge
```bash
npm i -g supabase            # ou: npx supabase ...
supabase login
supabase link --project-ref <ref>
supabase functions deploy admin-users
supabase functions deploy daily-alerts --no-verify-jwt
```

### 3. Créer le premier administrateur
1. **Authentication → Users → Add user** : e-mail `admin@flotte.local` (ou votre vrai e-mail), mot de passe,
   cochez *Auto confirm*.
2. Dans le **SQL Editor** :
   ```sql
   update public.profiles set role = 'admin', full_name = 'Votre nom' where username = 'admin';
   ```
3. Connectez-vous avec l'identifiant `admin` (ou l'e-mail complet). Les autres comptes se créent ensuite depuis
   **Chauffeurs & comptes**.

### 4. Lancer l'application
```bash
cp .env.example .env   # renseigner VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (Project Settings → API)
npm install
npm run dev            # http://localhost:5173
npm run build          # version de production dans dist/
```
Hébergement : Vercel, Netlify ou Cloudflare Pages (les fichiers `vercel.json` et `public/_redirects` gèrent les routes).
N'oubliez pas d'y définir les mêmes variables `VITE_…`.

### 5. (Optionnel) E-mail d'alerte quotidien
1. Créez une clé API sur <https://resend.com> (et vérifiez votre domaine d'envoi).
2. Définissez les secrets :
   ```bash
   supabase secrets set RESEND_API_KEY=re_xxx ALERT_EMAILS="chef@societe.ma,atelier@societe.ma" \
     ALERT_FROM="Flotte <alertes@societe.ma>" CRON_SECRET="$(openssl rand -hex 24)"
   ```
3. **Database → Extensions** : activez `pg_cron` et `pg_net`, puis dans le SQL Editor (tous les jours à 7 h UTC) :
   ```sql
   select cron.schedule('alertes-flotte', '0 7 * * *', $$
     select net.http_post(
       url     := 'https://<ref>.supabase.co/functions/v1/daily-alerts',
       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>', 'Content-Type', 'application/json')
     );
   $$);
   ```

## Structure
```
supabase/
  migrations/…_init.sql      tables, vues, fonctions, RLS, 31 points de contrôle
  functions/admin-users      création de comptes, mot de passe, activation (admin)
  functions/daily-alerts     e-mail récapitulatif des échéances
src/
  pages/driver/              accueil, fiche de contrôle, demandes, fiches (chauffeur)
  pages/staff/               tableau de bord, parc, échéances, interventions, fiches, comptes, paramètres
  components/                UI, formulaires véhicule / papier / demande
  lib/                       client Supabase, types, libellés
```

## Modèle de données
- `profiles` : utilisateurs (rôle chauffeur / gestionnaire / admin)
- `vehicles` : parc (matricule, type, compteur km/heures, prochaine vidange, statut, chauffeur attitré)
- `documents` : papiers d'un véhicule **ou** d'un chauffeur, avec date d'expiration et délai d'alerte
- `control_items`, `control_sheets`, `control_results` : fiches de contrôle avant départ
- `interventions` : demandes (vidange, panne…), liées à la fiche si elles viennent d'un NOK
- `v_echeances` : vue qui calcule le niveau d'alerte de chaque papier et de chaque vidange
