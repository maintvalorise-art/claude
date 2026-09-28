# Demandes d'Achat – PR-ACH-001

Application web simple (HTML + JavaScript, sans framework) qui applique la procédure
**PR-ACH-001 v01** :

Besoin → DA → Validation → Consultation fournisseurs → Analyse des offres → Validation achat → BC → Réception → Contrôle → Facture / Clôture

## Fonctionnalités

| Procédure | Dans l'application |
|---|---|
| §4 Identification du besoin | Vérification du stock et des commandes en cours, champs spécifiques aux pièces de rechange (marque, modèle machine/véhicule) |
| §5 Création de la DA | Tous les champs obligatoires, numérotation automatique `DA-AAAA-0001`, brouillon ou soumission directe |
| §6 Validation | Liste des 6 points à contrôler, décision valider / refuser / renvoyer au demandeur, commentaire obligatoire en cas de refus |
| §7-8 Consultation & analyse | Saisie des offres (prix, transport, délai, paiement, garantie, disponibilité), tableau comparatif avec meilleur prix et meilleur délai mis en évidence, avis technique, justification du choix |
| §9 Validation achat | Matrice de validation configurable (par défaut ≤ 5 000 → Responsable service, ≤ 50 000 → Finance, au-delà → Direction) |
| §10 Bon de commande | Numéro `BC-AAAA-0001`, BC imprimable, confirmation du fournisseur avec date de livraison |
| §11 Réception | Contrôle de la quantité, de la conformité, de l'état, de la référence, de la qualité et des documents ; non-conformité transmise aux Achats puis traitée |
| §12 Clôture & traçabilité | Contrôle de la facture, clôture de la DA, chaîne DA → Devis → Validation → BC → Réception → Facture, historique horodaté |
| §13 Achats urgents | Niveau Urgent / Critique avec impact (Production, Client, Sécurité), bandeau `URGENT – IMPACT …`, circuit d'urgence ouvert à la Direction |
| §14 Responsabilités | Sélecteur de rôle : chaque acteur voit uniquement les actions qui le concernent |

Vous trouverez aussi un tableau de bord (DA à traiter, urgences, commandes en attente de réception,
montant engagé), des filtres, un export CSV / JSON et des données de démonstration.

## Phase 1 – Test en local (aucune installation)

1. Ouvrir `index.html` dans un navigateur (double-clic).
2. En haut à droite, saisir votre nom et choisir un rôle.
3. *Paramètres → Charger des données de démonstration* pour disposer d'exemples.
4. Pour tester tout le circuit, changer de rôle à chaque étape (Demandeur → Responsable service → Achats → …),
   ou choisir **Administrateur**, qui peut réaliser toutes les actions.

En mode local, les données restent **uniquement dans ce navigateur** (localStorage).

## Phase 2 – Base Supabase

1. Créer un projet sur <https://supabase.com>.
2. *SQL Editor* → coller puis exécuter le contenu de `supabase/schema.sql`.
3. *Project Settings → API* : copier l'**URL du projet** et la clé **anon public**.
4. Test local avec Supabase : les renseigner dans `config.js` :
   ```js
   window.APP_CONFIG = { SUPABASE_URL: "https://xxxx.supabase.co", SUPABASE_ANON_KEY: "eyJ...", DEVISE: "MAD" };
   ```
   Le badge en haut passe de « Mode test local » à « Supabase ».

## Phase 3 – Déploiement Vercel

1. Pousser le dépôt sur GitHub.
2. Sur <https://vercel.com> : *Add New → Project* → importer le dépôt.
3. **Root Directory** : `demande-achats`. Framework : *Other* (le fichier `vercel.json` gère le reste).
4. *Environment Variables* : `SUPABASE_URL` et `SUPABASE_ANON_KEY` (et, en option, `DEVISE`).
5. *Deploy*. Au build, `scripts/gen-config.js` génère `config.js` à partir de ces variables.

## ⚠️ Sécurité avant la mise en production

- Le schéma active des politiques RLS **ouvertes** (`test_acces_ouvert`) : n'importe qui ayant l'URL peut lire et écrire.
  C'est adapté au test uniquement.
- Le rôle est choisi librement dans l'interface : c'est une **simulation**. Pour la production, il faudra :
  1. activer Supabase Auth (email / mot de passe ou lien magique) ;
  2. créer une table `profils (user_id, nom, service, role)` ;
  3. remplacer les politiques par des règles basées sur `auth.uid()` et le rôle, en contrôlant les changements de statut côté base
     (fonctions RPC ou triggers) ;
  4. stocker les pièces jointes dans Supabase Storage (le champ « pièces jointes » est aujourd'hui un simple texte ou lien).

## Fichiers

```
demande-achats/
├── index.html            Application complète (UI + logique + stockage local/Supabase)
├── config.js             Configuration (vide = mode local)
├── supabase/schema.sql   Tables demandes, offres, historique + numérotation + RLS de test
├── scripts/gen-config.js Génère config.js depuis les variables Vercel
└── vercel.json           Configuration du déploiement statique
```
