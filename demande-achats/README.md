# Demandes d'Achat – PR-ACH-001

Application web de gestion des demandes d'achat :

- **HTML + JavaScript** (aucun framework) ;
- **Supabase** pour les comptes, la base de données et les notifications ;
- **Vercel** pour l'hébergement et l'envoi des emails.

## Ce que fait l'application

### Compte Demandeur
- **Fiche de demande d'achat :** service, centre de coût, catégorie, date souhaitée, articles (désignation, référence, quantité, unité, prix estimé), motif, urgence et impact, vérifications du stock et des commandes en cours, pièces jointes (liens).
- **Brouillon :** la demande peut être enregistrée, modifiée ou supprimée tant qu'elle n'est pas envoyée.
- **« Valider et envoyer » :**
  - le **PDF** de la fiche se télécharge ;
  - l'administration reçoit une **notification** dans l'application et un **email** avec le PDF en pièce jointe ;
  - la demande ne peut plus être modifiée.
- **« Mes demandes » :** la liste de toutes ses demandes, avec pour chacune :
  - le statut ;
  - la validation finance ;
  - la réception ;
  - le commentaire de l'administration ;
  - l'historique complet.
- **Notifications :** une cloche 🔔 et un email à chaque changement fait par l'administration.

### Compte Admin
- **Tableau de bord :**
  - nombre de demandes reçues, en attente, en cours, validées et refusées ;
  - validation finance : en attente / validées ;
  - réception : en attente / terminées ;
  - montant validé ;
  - répartition par service ;
  - liste « À traiter », avec les urgences en premier.
- **Traitement d'une demande :**
  - statut **En attente / En cours de traitement / Validée / Refusée**, avec un commentaire visible par le demandeur (obligatoire en cas de refus) ;
  - **validation finance** : en attente / validée / refusée / non requise, avec commentaire ;
  - **commande et réception** : n° BC, fournisseur retenu, montant réel, réception (en attente / partielle / reçue / non conforme), date et remarque.
- **Toutes les demandes :** recherche, filtres et export CSV.
- **Utilisateurs :** attribuer le rôle Admin, désactiver un compte.

### Sécurité
La sécurité est appliquée **dans la base de données** (Row Level Security), pas seulement dans l'interface :
- un demandeur ne voit que ses propres demandes ;
- un demandeur ne peut plus modifier une demande après l'envoi ;
- un demandeur ne peut ni changer un statut ni se donner le rôle admin ;
- l'historique et les notifications sont créés automatiquement par la base.

---

## Mise en place (environ 20 minutes)

### Étape 1 – Supabase (base de données et comptes)

1. Créez un compte sur <https://supabase.com>, puis cliquez sur **New project** (région : Europe, par exemple Frankfurt).
2. Ouvrez **SQL Editor → New query**, collez tout le contenu de `supabase/schema.sql`, puis cliquez sur **Run**.
3. Ouvrez **Authentication → Sign In / Providers → Email** :
   - pour les tests, vous pouvez désactiver **Confirm email** : les comptes sont alors actifs tout de suite ;
   - en production, laissez-le activé : chaque utilisateur confirme son adresse.
4. Ouvrez **Project Settings → API** et notez :
   - `Project URL` → `SUPABASE_URL`
   - `anon public` → `SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ **secrète** : uniquement dans Vercel, jamais dans `config.js`)

### Étape 2 – Emails (Resend, gratuit jusqu'à 3 000 emails par mois)

1. Créez un compte sur <https://resend.com>, puis ouvrez **API Keys → Create API Key** et notez la clé (`RESEND_API_KEY`).
2. Choisissez l'expéditeur :
   - **Pour tester :** utilisez `EMAIL_FROM = Achats <onboarding@resend.dev>`. Resend n'envoie alors **qu'à l'adresse de votre compte Resend**.
   - **Pour la production :** ouvrez **Domains → Add Domain**, ajoutez votre domaine (par ex. `valorise.ma`), créez les enregistrements DNS indiqués, puis utilisez `EMAIL_FROM = Achats <achats@valorise.ma>`.

Sans Resend, l'application fonctionne quand même : seules les notifications dans l'application (🔔) sont envoyées.

### Étape 3 – Vercel (mise en ligne)

1. Créez un compte sur <https://vercel.com> et connectez-le à GitHub.
2. Cliquez sur **Add New → Project** et importez ce dépôt.
3. **Root Directory** : `demande-achats`. **Framework Preset** : `Other`.
   Dans **Build and Output Settings**, laissez **Build Command** et **Output Directory** vides (pas de build).
4. Dans **Environment Variables**, ajoutez :

| Variable | Valeur |
|---|---|
| `SUPABASE_URL` | URL du projet Supabase |
| `SUPABASE_ANON_KEY` | clé `anon public` |
| `SUPABASE_SERVICE_ROLE_KEY` | clé `service_role` (secrète) |
| `RESEND_API_KEY` | clé Resend |
| `EMAIL_FROM` | ex. `Achats <onboarding@resend.dev>` |
| `APP_URL` | l'adresse Vercel, ex. `https://demande-achats.vercel.app` (pour le lien dans les emails) |
| `ENTREPRISE` | nom affiché sur l'application et le PDF, ex. `Valorise SARL` |
| `ADMIN_EMAILS` | *(optionnel)* adresses supplémentaires qui reçoivent les nouvelles demandes, séparées par des virgules |

5. Cliquez sur **Deploy**.
6. De retour dans Supabase, ouvrez **Authentication → URL Configuration** et mettez l'adresse Vercel dans **Site URL** et dans **Redirect URLs**. C'est nécessaire pour les liens de confirmation et de « mot de passe oublié ».

### Étape 4 – Créer le premier administrateur

1. Ouvrez l'application et cliquez sur **Créer un compte** avec votre email.
2. Dans Supabase, ouvrez **SQL Editor** et exécutez (en remplaçant l'email) :
   ```sql
   update public.profiles set role = 'admin' where email = 'votre.email@exemple.com';
   ```
3. Rechargez l'application : le menu **Tableau de bord / Toutes les demandes / Utilisateurs** apparaît.
   Les administrateurs suivants peuvent ensuite être nommés depuis la page **Utilisateurs**.

Les collaborateurs créent eux-mêmes leur compte : ils sont **Demandeurs** par défaut.

---

## Fichiers

```
demande-achats/
├── index.html            Interface (styles inclus)
├── app.js                Logique : comptes, fiche, PDF, tableau de bord, notifications
├── config.js             Configuration pour un test sur PC (vide sur Vercel)
├── api/config.js         Fonction Vercel : transmet SUPABASE_URL / ANON_KEY au navigateur
├── api/notify.js         Fonction Vercel : envoi des emails via Resend
├── supabase/schema.sql   Tables, règles de sécurité (RLS), historique, notifications
└── vercel.json           Configuration du déploiement
```

## Test sur votre PC (optionnel)

Pour tester sans Vercel, renseignez `SUPABASE_URL` et `SUPABASE_ANON_KEY` dans `config.js`, puis servez le dossier :

```
npx serve demande-achats
```

Ouvrir `index.html` directement par double-clic ne suffit pas, car la connexion à Supabase a besoin d'une adresse `http://`.

Dans ce mode, tout fonctionne sauf l'email : la fonction `/api` n'existe que sur Vercel.

## Évolutions possibles
- **Pièces jointes :** téléverser de vrais fichiers (photos, devis) avec Supabase Storage.
- **Rôles supplémentaires :** Responsable service, Finance, Magasin, Direction, chacun avec ses propres validations.
- **Inscriptions :** limiter la création de comptes aux adresses de l'entreprise (`@valorise.ma`).
