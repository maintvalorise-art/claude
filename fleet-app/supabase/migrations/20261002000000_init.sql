-- =====================================================================
-- Valorise Maroc : Achats, Spare Parts (magasin), Fleet Management, Bennes
-- Schéma complet : tables, numérotation, historique, alertes, KPI, RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Profils, rôles et paramètres
-- ---------------------------------------------------------------------
create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  full_name           text not null default '',
  username            text unique,
  email               text,
  phone               text,
  role                text not null default 'chauffeur' check (role in (
                        'admin', 'direction', 'acheteur', 'magasinier',
                        'responsable_flotte', 'exploitation', 'chauffeur', 'demandeur')),
  service             text,
  manager_id          uuid references public.profiles (id) on delete set null,
  demandeur_autorise  boolean not null default false,
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

-- Le rôle n'est jamais lu depuis les métadonnées du client : tout nouveau compte
-- est « chauffeur » ; seul un admin peut le modifier.
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_username text := split_part(new.email, '@', 1);
begin
  if exists (select 1 from public.profiles where username = v_username) then
    v_username := new.email;
  end if;
  insert into public.profiles (id, full_name, username, email)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
          v_username, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Comptes déjà existants (installation sur un projet qui a des utilisateurs).
insert into public.profiles (id, full_name, username, email)
select u.id,
       coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)),
       case when row_number() over (partition by split_part(u.email, '@', 1) order by u.created_at) = 1
            then split_part(u.email, '@', 1) else u.email end,
       u.email
  from auth.users u
on conflict (id) do nothing;

create function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active;
$$;

create function public.has_role(variadic p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = any (p_roles), false);
$$;

create function public.is_admin()
returns boolean language sql stable as $$ select public.has_role('admin'); $$;

-- Peut émettre une demande d'achat (liste des demandeurs autorisés).
create function public.can_request_purchase()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select active and (role in ('admin', 'direction', 'acheteur', 'magasinier', 'responsable_flotte', 'demandeur')
                       or demandeur_autorise)
      from public.profiles where id = auth.uid()), false);
$$;

create table public.parametres (
  cle      text primary key,
  valeur   numeric not null,
  libelle  text not null
);

insert into public.parametres (cle, valeur, libelle) values
  ('seuil_validation_direction', 10000, 'Montant (DH) à partir duquel la direction valide la DA'),
  ('seuil_trois_devis', 5000, 'Montant (DH) à partir duquel 3 devis sont obligatoires'),
  ('benne_immobile_jours', 30, 'Alerte benne immobile chez un client (jours)'),
  ('conso_tolerance_pct', 20, 'Écart de consommation toléré (%)'),
  ('contrat_alerte_jours', 60, 'Alerte avant fin de contrat fournisseur (jours)'),
  ('fiche_controle_jours', 7, 'Périodicité de la fiche de contrôle (jours)');

create function public.param(p_cle text)
returns numeric language sql stable security definer set search_path = public as $$
  select valeur from public.parametres where cle = p_cle;
$$;

-- Numérotation annuelle : DA-2026-0001, BC-2026-0001, ACC-2026-0001...
create table public.compteurs (
  prefixe  text not null,
  annee    int not null,
  dernier  int not null default 0,
  primary key (prefixe, annee)
);

create function public.next_numero(p_prefixe text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_annee int := extract(year from now())::int;
  v_n int;
begin
  insert into public.compteurs (prefixe, annee, dernier) values (p_prefixe, v_annee, 1)
  on conflict (prefixe, annee) do update set dernier = public.compteurs.dernier + 1
  returning dernier into v_n;
  return p_prefixe || '-' || v_annee || '-' || lpad(v_n::text, 4, '0');
end;
$$;

-- Journal : chaque opération horodatée avec son auteur.
create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   text not null,
  action      text not null,
  auteur_id   uuid,
  donnees     jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_record_idx on public.audit_log (table_name, record_id, created_at desc);

create function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_diff jsonb;
begin
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    select coalesce(jsonb_object_agg(k, v_new -> k), '{}'::jsonb) into v_diff
      from jsonb_object_keys(v_new) k
     where v_new -> k is distinct from v_old -> k and k not in ('updated_at', 'stock_actuel');
    if v_diff = '{}'::jsonb then return new; end if;
  else
    v_diff := v_new;
  end if;
  insert into public.audit_log (table_name, record_id, action, auteur_id, donnees)
  values (tg_table_name, coalesce(v_new ->> 'id', v_new ->> 'cle'), lower(tg_op), auth.uid(), v_diff);
  return new;
end;
$$;

create function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Fournisseurs (module Achats)
-- ---------------------------------------------------------------------
create table public.fournisseurs (
  id                     uuid primary key default gen_random_uuid(),
  raison_sociale         text not null,
  ice                    text,
  rc                     text,
  if_fiscal              text,
  rib                    text,
  adresse                text,
  contact_nom            text,
  telephone              text,
  email                  text,
  categories             text[] not null default '{}',
  certifications         text,
  conditions_paiement    text,
  delai_livraison_jours  int,
  classification         text not null default 'occasionnel' check (classification in ('strategique', 'regulier', 'occasionnel')),
  statut                 text not null default 'en_verification' check (statut in ('prospect', 'en_verification', 'actif', 'dereference')),
  docs_legaux_ok         boolean not null default false,
  references_ok          boolean not null default false,
  notes                  text,
  created_at             timestamptz not null default now()
);

create table public.contrats_fournisseurs (
  id                     uuid primary key default gen_random_uuid(),
  fournisseur_id         uuid not null references public.fournisseurs (id),
  type                   text not null default 'accord_prix' check (type in ('contrat_cadre', 'accord_prix', 'conditions_generales')),
  objet                  text not null,
  categorie              text,
  prix                   numeric(12, 2),
  unite                  text,
  delai_livraison_jours  int,
  conditions_paiement    text,
  garantie               text,
  penalites_retard       text,
  conditions_retour      text,
  date_debut             date,
  date_fin               date,
  actif                  boolean not null default true,
  created_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Parc : véhicules, camions, engins
-- ---------------------------------------------------------------------
create table public.vehicles (
  id               uuid primary key default gen_random_uuid(),
  code_interne     text unique,
  matricule        text not null unique,
  numero_serie     text,
  type             text not null default 'camion_porte_benne' check (type in (
                     'camion_porte_benne', 'camion_plateau', 'camion', 'vehicule_leger',
                     'chariot_elevateur', 'chargeuse', 'engin', 'remorque', 'autre')),
  marque           text,
  modele           text,
  annee            int,
  unite_compteur   text not null default 'km' check (unite_compteur in ('km', 'heures')),
  compteur_actuel  int not null default 0 check (compteur_actuel >= 0),
  conso_reference  numeric(6, 2),
  statut           text not null default 'disponible' check (statut in (
                     'disponible', 'en_service', 'en_panne', 'en_maintenance', 'immobilise', 'hors_service')),
  chauffeur_id     uuid references public.profiles (id) on delete set null,
  notes            text,
  actif            boolean not null default true,
  created_at       timestamptz not null default now()
);

create table public.documents (
  id               uuid primary key default gen_random_uuid(),
  vehicle_id       uuid references public.vehicles (id),
  chauffeur_id     uuid references public.profiles (id),
  type             text not null check (type in (
                     'carte_grise', 'assurance', 'visite_technique', 'vignette', 'autorisation_transport',
                     'autorisation_dechets_dangereux', 'carnet_entretien', 'tachygraphe', 'extincteur',
                     'permis', 'carte_professionnelle', 'visite_medicale', 'autre')),
  libelle          text,
  reference        text,
  date_emission    date,
  date_expiration  date not null,
  rappel_jours     int not null default 30 check (rappel_jours >= 0),
  notes            text,
  archive          boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint documents_owner check ((vehicle_id is not null) <> (chauffeur_id is not null))
);

-- Planning de maintenance : vidange, préventif constructeur, hydraulique...
create table public.plans_maintenance (
  id                   uuid primary key default gen_random_uuid(),
  vehicle_id           uuid not null references public.vehicles (id),
  type                 text not null check (type in ('vidange', 'preventive', 'hydraulique', 'pneus', 'autre')),
  libelle              text not null,
  intervalle_compteur  int check (intervalle_compteur > 0),
  intervalle_jours     int check (intervalle_jours > 0),
  dernier_compteur     int,
  derniere_date        date,
  alerte_compteur      int not null default 500,
  alerte_jours         int not null default 15,
  actif                boolean not null default true,
  created_at           timestamptz not null default now(),
  check (intervalle_compteur is not null or intervalle_jours is not null)
);

create table public.pneus (
  id                uuid primary key default gen_random_uuid(),
  vehicle_id        uuid references public.vehicles (id),
  position          text,
  marque            text,
  dimension         text,
  numero_serie      text,
  date_montage      date,
  compteur_montage  int,
  statut            text not null default 'monte' check (statut in ('monte', 'stock', 'rebut')),
  motif_retrait     text,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Magasin : articles, mouvements, inventaires
-- ---------------------------------------------------------------------
create table public.articles (
  id                         uuid primary key default gen_random_uuid(),
  code                       text not null unique,
  code_barres                text unique,
  designation                text not null,
  categorie                  text not null default 'mecanique' check (categorie in (
                               'mecanique', 'electrique', 'hydraulique', 'pneumatique', 'filtration',
                               'pneus', 'consommables', 'autre')),
  equipement                 text,
  vehicle_id                 uuid references public.vehicles (id),
  ref_fabricant              text,
  criticite                  text not null default 'C' check (criticite in ('A', 'B', 'C')),
  stock_min                  numeric not null default 0 check (stock_min >= 0),
  stock_max                  numeric not null default 0 check (stock_max >= 0),
  unite                      text not null default 'pce',
  emplacement                text,
  fournisseur_principal_id   uuid references public.fournisseurs (id),
  fournisseur_secondaire_id  uuid references public.fournisseurs (id),
  prix_unitaire              numeric(12, 2),
  stock_actuel               numeric not null default 0,
  actif                      boolean not null default true,
  created_at                 timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. Demandes d'achat, devis, commandes
-- ---------------------------------------------------------------------
create table public.demandes_achat (
  id                     uuid primary key default gen_random_uuid(),
  numero                 text not null unique,
  demandeur_id           uuid not null references public.profiles (id),
  service                text,
  vehicle_id             uuid references public.vehicles (id),
  equipement             text,
  motif                  text not null,
  urgence                text not null default 'normal' check (urgence in ('normal', 'urgent', 'arret_machine')),
  date_souhaitee         date,
  statut                 text not null default 'soumise' check (statut in (
                           'soumise', 'servie_stock', 'attente_validation', 'attente_direction', 'validee',
                           'commandee', 'receptionnee', 'cloturee', 'rejetee', 'annulee')),
  auto                   boolean not null default false,
  montant_estime         numeric(12, 2),
  acheteur_id            uuid references public.profiles (id),
  prise_en_charge_le     timestamptz,
  valideur_id            uuid references public.profiles (id),
  valide_le              timestamptz,
  valideur_direction_id  uuid references public.profiles (id),
  valide_direction_le    timestamptz,
  fournisseur_id         uuid references public.fournisseurs (id),
  bc_numero              text unique,
  bc_date                timestamptz,
  montant_commande       numeric(12, 2),
  date_livraison_prevue  date,
  date_reception         timestamptz,
  bl_numero              text,
  facture_numero         text,
  rapprochement_ok       boolean,
  motif_rejet            text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index demandes_achat_statut_idx on public.demandes_achat (statut, created_at desc);
create index demandes_achat_demandeur_idx on public.demandes_achat (demandeur_id, created_at desc);

create trigger demandes_achat_touch before update on public.demandes_achat
  for each row execute function public.touch_updated_at();

create table public.da_lignes (
  id              uuid primary key default gen_random_uuid(),
  da_id           uuid not null references public.demandes_achat (id),
  article_id      uuid references public.articles (id),
  designation     text not null,
  reference       text,
  quantite        numeric not null check (quantite > 0),
  unite           text not null default 'pce',
  prix_unitaire   numeric(12, 2),
  quantite_recue  numeric not null default 0
);

create table public.devis (
  id              uuid primary key default gen_random_uuid(),
  da_id           uuid not null references public.demandes_achat (id),
  fournisseur_id  uuid not null references public.fournisseurs (id),
  reference       text,
  montant         numeric(12, 2) not null check (montant >= 0),
  delai_jours     int,
  conditions      text,
  retenu          boolean not null default false,
  created_at      timestamptz not null default now()
);

create table public.da_historique (
  id            bigint generated always as identity primary key,
  da_id         uuid not null references public.demandes_achat (id),
  action        text not null,
  statut_avant  text,
  statut_apres  text,
  commentaire   text,
  auteur_id     uuid references public.profiles (id),
  created_at    timestamptz not null default now()
);

create table public.evaluations_fournisseurs (
  id               uuid primary key default gen_random_uuid(),
  fournisseur_id   uuid not null references public.fournisseurs (id),
  da_id            uuid references public.demandes_achat (id),
  type             text not null default 'commande' check (type in ('commande', 'semestrielle')),
  note_delai       int check (note_delai between 1 and 5),
  note_qualite     int check (note_qualite between 1 and 5),
  note_prix        int check (note_prix between 1 and 5),
  note_reactivite  int check (note_reactivite between 1 and 5),
  note_conformite  int check (note_conformite between 1 and 5),
  commentaire      text,
  auteur_id        uuid references public.profiles (id) default auth.uid(),
  created_at       timestamptz not null default now()
);

create table public.prix_historique (
  id              bigint generated always as identity primary key,
  article_id      uuid references public.articles (id),
  designation     text not null,
  fournisseur_id  uuid references public.fournisseurs (id),
  prix_unitaire   numeric(12, 2) not null,
  source          text not null default 'commande' check (source in ('commande', 'devis', 'contrat', 'manuel')),
  da_id           uuid references public.demandes_achat (id),
  date_prix       date not null default current_date
);
create index prix_historique_article_idx on public.prix_historique (article_id, date_prix desc);

-- ---------------------------------------------------------------------
-- 5. Interventions (maintenance), fiches de contrôle, accidents, gasoil, trajets
-- ---------------------------------------------------------------------
create table public.interventions (
  id                     uuid primary key default gen_random_uuid(),
  numero                 bigint generated always as identity unique,
  vehicle_id             uuid not null references public.vehicles (id),
  demandeur_id           uuid references public.profiles (id),
  type                   text not null check (type in (
                           'vidange', 'preventive', 'panne', 'pneumatique', 'freinage', 'electrique',
                           'hydraulique', 'carrosserie', 'controle', 'accident', 'autre')),
  nature                 text not null default 'corrective' check (nature in ('preventive', 'corrective')),
  priorite               text not null default 'normale' check (priorite in ('basse', 'normale', 'haute', 'urgente')),
  statut                 text not null default 'nouvelle' check (statut in ('nouvelle', 'en_cours', 'terminee', 'rejetee')),
  titre                  text not null,
  description            text,
  compteur               int,
  vehicule_immobilise    boolean not null default false,
  cause                  text,
  assigne_a              text,
  reponse                text,
  cout                   numeric(12, 2),
  duree_immobilisation_h numeric(8, 1),
  plan_id                uuid references public.plans_maintenance (id),
  fiche_id               uuid,
  date_cloture           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index interventions_statut_idx on public.interventions (statut, created_at desc);

create table public.control_items (
  id         serial primary key,
  categorie  text not null,
  label_fr   text not null,
  label_ar   text,
  ordre      int not null default 0,
  actif      boolean not null default true
);

create table public.control_sheets (
  id                       uuid primary key default gen_random_uuid(),
  vehicle_id               uuid not null references public.vehicles (id),
  chauffeur_id             uuid not null references public.profiles (id),
  conducteur_precedent_id  uuid references public.profiles (id),
  date_controle            date not null default current_date,
  compteur_depart          int not null check (compteur_depart >= 0),
  prochaine_vidange        int,
  remarques                text,
  nb_nok                   int not null default 0,
  valide_par               uuid references public.profiles (id),
  valide_le                timestamptz,
  commentaire_validation   text,
  created_at               timestamptz not null default now()
);
create index control_sheets_vehicle_idx on public.control_sheets (vehicle_id, created_at desc);
create index control_sheets_driver_idx on public.control_sheets (chauffeur_id, created_at desc);

alter table public.interventions
  add constraint interventions_fiche_fk foreign key (fiche_id) references public.control_sheets (id);

create table public.control_results (
  sheet_id     uuid not null references public.control_sheets (id),
  item_id      int not null references public.control_items (id),
  ok           boolean not null,
  commentaire  text,
  primary key (sheet_id, item_id)
);

create table public.accidents (
  id                     uuid primary key default gen_random_uuid(),
  numero                 text not null unique,
  vehicle_id             uuid not null references public.vehicles (id),
  chauffeur_id           uuid references public.profiles (id),
  declare_par            uuid references public.profiles (id) default auth.uid(),
  date_accident          timestamptz not null,
  lieu                   text not null,
  tiers                  text,
  description            text not null,
  constat_amiable        boolean not null default false,
  blesses                boolean not null default false,
  photos                 text[] not null default '{}',
  statut                 text not null default 'declare' check (statut in ('declare', 'expertise', 'indemnisation', 'repare', 'clos')),
  assurance_reference    text,
  montant_indemnisation  numeric(12, 2),
  franchise              numeric(12, 2),
  cout_reparation        numeric(12, 2),
  immobilisation_jours   numeric(6, 1),
  causes                 text,
  actions_correctives    text,
  created_at             timestamptz not null default now()
);

create table public.pleins (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references public.vehicles (id),
  chauffeur_id uuid references public.profiles (id),
  date_plein   timestamptz not null default now(),
  litres       numeric(8, 2) not null check (litres > 0),
  prix_litre   numeric(8, 3),
  compteur     int not null check (compteur >= 0),
  source       text not null default 'station' check (source in ('station', 'cuve')),
  station      text,
  bon_numero   text,
  saisi_par    uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now()
);
create index pleins_vehicle_idx on public.pleins (vehicle_id, compteur);

-- ---------------------------------------------------------------------
-- 6. Bennes et clients
-- ---------------------------------------------------------------------
create table public.clients (
  id           uuid primary key default gen_random_uuid(),
  nom          text not null unique,
  adresse      text,
  contact      text,
  telephone    text,
  strategique  boolean not null default false,
  actif        boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.bennes (
  id                     uuid primary key default gen_random_uuid(),
  numero                 text not null unique,
  code_barres            text unique,
  type                   text not null default 'ampliroll' check (type in ('ampliroll', 'chaines', 'compacteur', 'autre')),
  volume_m3              numeric(6, 1),
  dechet                 text check (dechet in ('carton', 'plastique', 'ferraille', 'aluminium', 'cuivre', 'bois', 'dangereux', 'melange', 'autre')),
  etat                   text not null default 'bon' check (etat in ('bon', 'a_reparer', 'hors_service')),
  derniere_revision      date,
  statut                 text not null default 'depot' check (statut in ('depot', 'chez_client', 'transit', 'vidage', 'reparation')),
  client_id              uuid references public.clients (id),
  depuis                 timestamptz not null default now(),
  derniere_verification  date,
  gps_lat                numeric(9, 6),
  gps_lng                numeric(9, 6),
  gps_maj                timestamptz,
  actif                  boolean not null default true,
  notes                  text,
  created_at             timestamptz not null default now()
);

create table public.mouvements_bennes (
  id              uuid primary key default gen_random_uuid(),
  benne_id        uuid not null references public.bennes (id),
  date_mouvement  timestamptz not null default now(),
  motif           text not null check (motif in ('pose', 'enlevement', 'echange', 'vidage', 'retour_depot', 'reparation', 'verification')),
  vehicle_id      uuid references public.vehicles (id),
  chauffeur_id    uuid references public.profiles (id),
  client_id       uuid references public.clients (id),
  origine         text,
  destination     text,
  saisi_par       uuid references public.profiles (id) default auth.uid(),
  notes           text,
  created_at      timestamptz not null default now()
);
create index mouvements_bennes_benne_idx on public.mouvements_bennes (benne_id, date_mouvement desc);

create table public.trajets (
  id                uuid primary key default gen_random_uuid(),
  vehicle_id        uuid not null references public.vehicles (id),
  chauffeur_id      uuid references public.profiles (id),
  date_trajet       date not null default current_date,
  depart            text not null,
  destination       text not null,
  type_destination  text not null default 'client' check (type_destination in ('client', 'decharge', 'fournisseur', 'depot', 'autre')),
  client_id         uuid references public.clients (id),
  compteur_depart   int not null check (compteur_depart >= 0),
  compteur_arrivee  int not null,
  benne_id          uuid references public.bennes (id),
  poids_kg          numeric(10, 1),
  ticket_pesee      text,
  saisi_par         uuid references public.profiles (id) default auth.uid(),
  created_at        timestamptz not null default now(),
  check (compteur_arrivee >= compteur_depart)
);
create index trajets_vehicle_idx on public.trajets (vehicle_id, date_trajet desc);

-- ---------------------------------------------------------------------
-- 7. Mouvements de stock (après demandes_achat / interventions pour les FK)
-- ---------------------------------------------------------------------
create table public.mouvements_stock (
  id               uuid primary key default gen_random_uuid(),
  article_id       uuid not null references public.articles (id),
  type             text not null check (type in ('entree', 'sortie', 'ajustement')),
  quantite         numeric not null,
  stock_apres      numeric,
  prix_unitaire    numeric(12, 2),
  vehicle_id       uuid references public.vehicles (id),
  equipement       text,
  demandeur        text,
  motif            text not null default 'autre' check (motif in ('reception', 'reparation', 'preventif', 'consommation', 'inventaire', 'retour', 'stock_initial', 'autre')),
  da_id            uuid references public.demandes_achat (id),
  intervention_id  uuid references public.interventions (id),
  auteur_id        uuid references public.profiles (id) default auth.uid(),
  commentaire      text,
  created_at       timestamptz not null default now(),
  check (type = 'ajustement' or quantite > 0)
);
create index mouvements_stock_article_idx on public.mouvements_stock (article_id, created_at desc);
create index mouvements_stock_vehicle_idx on public.mouvements_stock (vehicle_id, created_at desc);

create table public.inventaires (
  id           uuid primary key default gen_random_uuid(),
  type         text not null default 'tournant' check (type in ('tournant', 'complet')),
  statut       text not null default 'en_cours' check (statut in ('en_cours', 'cloture')),
  auteur_id    uuid references public.profiles (id) default auth.uid(),
  nb_articles  int,
  nb_ecarts    int,
  date_cloture timestamptz,
  created_at   timestamptz not null default now()
);

create table public.inventaire_lignes (
  inventaire_id  uuid not null references public.inventaires (id),
  article_id     uuid not null references public.articles (id),
  qte_theorique  numeric not null,
  qte_comptee    numeric,
  primary key (inventaire_id, article_id)
);

-- =====================================================================
-- Logique métier (triggers)
-- =====================================================================

-- Interventions : horodatage, clôture, immobilisation et mise à jour du plan.
create function public.interventions_before()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.statut in ('terminee', 'rejetee') and (tg_op = 'INSERT' or old.statut not in ('terminee', 'rejetee')) then
    new.date_cloture := now();
  elsif new.statut not in ('terminee', 'rejetee') then
    new.date_cloture := null;
  end if;
  return new;
end;
$$;
create trigger interventions_before before insert or update on public.interventions
  for each row execute function public.interventions_before();

create function public.interventions_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.vehicule_immobilise and new.statut in ('nouvelle', 'en_cours')
     and (tg_op = 'INSERT' or not old.vehicule_immobilise) then
    update public.vehicles set statut = 'en_panne'
     where id = new.vehicle_id and statut not in ('hors_service', 'en_maintenance', 'immobilise');
  end if;
  -- Une intervention terminée liée à un plan remet le compteur du plan à zéro.
  if new.statut = 'terminee' and new.plan_id is not null and (tg_op = 'INSERT' or old.statut <> 'terminee') then
    update public.plans_maintenance
       set dernier_compteur = coalesce(new.compteur, (select compteur_actuel from public.vehicles where id = new.vehicle_id)),
           derniere_date = current_date
     where id = new.plan_id;
  end if;
  return new;
end;
$$;
create trigger interventions_after after insert or update on public.interventions
  for each row execute function public.interventions_after();

-- Compteur véhicule : un relevé (plein, trajet, fiche) fait avancer le compteur.
create function public.bump_compteur(p_vehicle uuid, p_valeur int)
returns void language sql security definer set search_path = public as $$
  update public.vehicles set compteur_actuel = p_valeur where id = p_vehicle and compteur_actuel < p_valeur;
$$;

create function public.pleins_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.bump_compteur(new.vehicle_id, new.compteur);
  return new;
end;
$$;
create trigger pleins_after after insert on public.pleins for each row execute function public.pleins_after();

create function public.trajets_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.bump_compteur(new.vehicle_id, new.compteur_arrivee);
  return new;
end;
$$;
create trigger trajets_after after insert on public.trajets for each row execute function public.trajets_after();

-- Accidents : numéro ACC-AAAA-NNNN + intervention de réparation.
create function public.accidents_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.numero := public.next_numero('ACC');
  return new;
end;
$$;
create trigger accidents_before before insert on public.accidents for each row execute function public.accidents_before();

create function public.accidents_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.interventions (vehicle_id, demandeur_id, type, nature, priorite, titre, description)
  values (new.vehicle_id, coalesce(new.declare_par, new.chauffeur_id), 'accident', 'corrective', 'haute',
          'Accident ' || new.numero || ' : ' || new.lieu, new.description);
  return new;
end;
$$;
create trigger accidents_after after insert on public.accidents for each row execute function public.accidents_after();

-- Bennes : chaque mouvement met à jour le statut, le client et la date.
create function public.mouvements_bennes_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.motif = 'verification' then
    update public.bennes set derniere_verification = new.date_mouvement::date where id = new.benne_id;
    return new;
  end if;
  update public.bennes b
     set statut = case new.motif
                    when 'pose' then 'chez_client'
                    when 'echange' then 'chez_client'
                    when 'enlevement' then 'transit'
                    when 'vidage' then 'vidage'
                    when 'retour_depot' then 'depot'
                    when 'reparation' then 'reparation'
                  end,
         client_id = case when new.motif in ('pose', 'echange') then new.client_id
                          when new.motif in ('enlevement', 'retour_depot', 'reparation') then null
                          else b.client_id end,
         etat = case when new.motif = 'reparation' and b.etat = 'bon' then 'a_reparer' else b.etat end,
         depuis = new.date_mouvement,
         derniere_verification = new.date_mouvement::date
   where b.id = new.benne_id;
  return new;
end;
$$;
create trigger mouvements_bennes_after after insert on public.mouvements_bennes
  for each row execute function public.mouvements_bennes_after();

-- Stock : calcule le stock après mouvement, refuse une sortie supérieure au stock,
-- et crée automatiquement une DA quand un article passe sous son stock min.
create function public.mouvements_stock_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_stock numeric;
begin
  select stock_actuel into v_stock from public.articles where id = new.article_id for update;
  if not found then raise exception 'Article introuvable'; end if;
  if new.type = 'sortie' and new.quantite > v_stock then
    raise exception 'Stock insuffisant : % disponible(s)', v_stock;
  end if;
  new.stock_apres := v_stock + case new.type when 'entree' then new.quantite
                                             when 'sortie' then -new.quantite
                                             else new.quantite end;
  if new.stock_apres < 0 then raise exception 'Le stock ne peut pas devenir négatif'; end if;
  if new.prix_unitaire is null then
    select prix_unitaire into new.prix_unitaire from public.articles where id = new.article_id;
  end if;
  update public.articles
     set stock_actuel = new.stock_apres,
         prix_unitaire = case when new.type = 'entree' and new.prix_unitaire is not null then new.prix_unitaire else prix_unitaire end
   where id = new.article_id;
  return new;
end;
$$;
create trigger mouvements_stock_before before insert on public.mouvements_stock
  for each row execute function public.mouvements_stock_before();

create function public.mouvements_stock_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a public.articles;
  v_da uuid;
  v_demandeur uuid;
begin
  select * into a from public.articles where id = new.article_id;
  if a.actif and a.stock_min > 0 and a.stock_actuel < a.stock_min
     and not exists (
       select 1 from public.da_lignes l join public.demandes_achat d on d.id = l.da_id
        where l.article_id = a.id
          and d.statut not in ('servie_stock', 'receptionnee', 'cloturee', 'rejetee', 'annulee')) then
    v_demandeur := coalesce(new.auteur_id,
                            (select id from public.profiles where role = 'magasinier' and active order by created_at limit 1),
                            (select id from public.profiles where role = 'admin' and active order by created_at limit 1));
    if v_demandeur is null then return new; end if;
    insert into public.demandes_achat (numero, demandeur_id, service, motif, urgence, auto, vehicle_id, equipement)
    values (public.next_numero('DA'), v_demandeur, 'Magasin',
            'Réapprovisionnement automatique : ' || a.code || ' sous le stock minimum',
            case when a.criticite = 'A' then 'urgent' else 'normal' end, true, a.vehicle_id, a.equipement)
    returning id into v_da;
    insert into public.da_lignes (da_id, article_id, designation, reference, quantite, unite, prix_unitaire)
    values (v_da, a.id, a.designation, coalesce(a.ref_fabricant, a.code),
            greatest(a.stock_max - a.stock_actuel, a.stock_min - a.stock_actuel, 1), a.unite, a.prix_unitaire);
    insert into public.da_historique (da_id, action, statut_apres, commentaire, auteur_id)
    values (v_da, 'creation', 'soumise', 'Créée automatiquement (stock ' || a.stock_actuel || ' < min ' || a.stock_min || ')', v_demandeur);
  end if;
  return new;
end;
$$;
create trigger mouvements_stock_after after insert on public.mouvements_stock
  for each row execute function public.mouvements_stock_after();

-- Historique (audit) sur les référentiels et dossiers.
create trigger audit_profiles after insert or update on public.profiles for each row execute function public.audit_trigger();
create trigger audit_parametres after insert or update on public.parametres for each row execute function public.audit_trigger();
create trigger audit_fournisseurs after insert or update on public.fournisseurs for each row execute function public.audit_trigger();
create trigger audit_contrats after insert or update on public.contrats_fournisseurs for each row execute function public.audit_trigger();
create trigger audit_vehicles after insert or update on public.vehicles for each row execute function public.audit_trigger();
create trigger audit_documents after insert or update on public.documents for each row execute function public.audit_trigger();
create trigger audit_plans after insert or update on public.plans_maintenance for each row execute function public.audit_trigger();
create trigger audit_pneus after insert or update on public.pneus for each row execute function public.audit_trigger();
create trigger audit_articles after insert or update on public.articles for each row execute function public.audit_trigger();
create trigger audit_interventions after insert or update on public.interventions for each row execute function public.audit_trigger();
create trigger audit_accidents after insert or update on public.accidents for each row execute function public.audit_trigger();
create trigger audit_pleins after insert or update on public.pleins for each row execute function public.audit_trigger();
create trigger audit_trajets after insert or update on public.trajets for each row execute function public.audit_trigger();
create trigger audit_clients after insert or update on public.clients for each row execute function public.audit_trigger();
create trigger audit_bennes after insert or update on public.bennes for each row execute function public.audit_trigger();
create trigger audit_control_sheets after update on public.control_sheets for each row execute function public.audit_trigger();

-- =====================================================================
-- Fonctions appelées par l'application
-- =====================================================================

create function public.list_drivers()
returns table (id uuid, full_name text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role from public.profiles p
   where p.active and auth.uid() is not null
   order by p.full_name;
$$;

create function public.vehicle_last_driver(p_vehicle_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.chauffeur_id from public.control_sheets s
   where s.vehicle_id = p_vehicle_id and auth.uid() is not null
   order by s.created_at desc limit 1;
$$;

-- Fiche de contrôle : enregistrement atomique, compteur, et intervention si NOK.
create function public.submit_control_sheet(
  p_vehicle_id uuid, p_date date, p_compteur int, p_prochaine_vidange int,
  p_conducteur_precedent_id uuid, p_remarques text, p_results jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sheet_id uuid;
  v_nok int;
  v_missing int;
  v_details text;
begin
  if v_uid is null or public.app_role() is null then raise exception 'Utilisateur non autorisé'; end if;
  if not exists (select 1 from public.vehicles where id = p_vehicle_id and actif) then
    raise exception 'Véhicule introuvable';
  end if;
  select count(*) into v_missing from public.control_items i
   where i.actif and not exists (
     select 1 from jsonb_array_elements(p_results) r where (r ->> 'item_id')::int = i.id and r ? 'ok');
  if v_missing > 0 then
    raise exception 'Fiche incomplète : % point(s) non renseigné(s)', v_missing;
  end if;

  insert into public.control_sheets (vehicle_id, chauffeur_id, conducteur_precedent_id, date_controle,
                                     compteur_depart, prochaine_vidange, remarques)
  values (p_vehicle_id, v_uid, p_conducteur_precedent_id, coalesce(p_date, current_date),
          p_compteur, p_prochaine_vidange, nullif(trim(p_remarques), ''))
  returning id into v_sheet_id;

  insert into public.control_results (sheet_id, item_id, ok, commentaire)
  select v_sheet_id, (r ->> 'item_id')::int, (r ->> 'ok')::boolean, nullif(trim(r ->> 'commentaire'), '')
    from jsonb_array_elements(p_results) r
    join public.control_items i on i.id = (r ->> 'item_id')::int and i.actif;

  select count(*) filter (where not ok) into v_nok from public.control_results where sheet_id = v_sheet_id;
  update public.control_sheets set nb_nok = v_nok where id = v_sheet_id;
  perform public.bump_compteur(p_vehicle_id, p_compteur);

  if v_nok > 0 then
    select string_agg('- ' || i.label_fr || coalesce(' : ' || cr.commentaire, ''), E'\n' order by i.ordre)
      into v_details
      from public.control_results cr join public.control_items i on i.id = cr.item_id
     where cr.sheet_id = v_sheet_id and not cr.ok;
    insert into public.interventions (vehicle_id, demandeur_id, type, priorite, titre, description, compteur, fiche_id)
    values (p_vehicle_id, v_uid, 'controle', 'haute', 'Fiche de contrôle : ' || v_nok || ' point(s) non conforme(s)',
            v_details, p_compteur, v_sheet_id);
  end if;
  return v_sheet_id;
end;
$$;

-- Création d'une demande d'achat (demandeurs autorisés uniquement).
create function public.creer_demande_achat(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
begin
  if not public.can_request_purchase() then
    raise exception 'Vous ne faites pas partie des demandeurs autorisés';
  end if;
  if coalesce(jsonb_array_length(p -> 'lignes'), 0) = 0 then raise exception 'Ajoutez au moins une ligne'; end if;
  if nullif(trim(p ->> 'motif'), '') is null then raise exception 'Le motif est obligatoire'; end if;

  insert into public.demandes_achat (numero, demandeur_id, service, vehicle_id, equipement, motif, urgence, date_souhaitee, montant_estime)
  values (public.next_numero('DA'), v_uid,
          coalesce(nullif(p ->> 'service', ''), (select service from public.profiles where id = v_uid)),
          nullif(p ->> 'vehicle_id', '')::uuid, nullif(p ->> 'equipement', ''), trim(p ->> 'motif'),
          coalesce(nullif(p ->> 'urgence', ''), 'normal'), nullif(p ->> 'date_souhaitee', '')::date,
          nullif(p ->> 'montant_estime', '')::numeric)
  returning id into v_id;

  insert into public.da_lignes (da_id, article_id, designation, reference, quantite, unite)
  select v_id, nullif(l ->> 'article_id', '')::uuid, trim(l ->> 'designation'), nullif(l ->> 'reference', ''),
         (l ->> 'quantite')::numeric, coalesce(nullif(l ->> 'unite', ''), 'pce')
    from jsonb_array_elements(p -> 'lignes') l;

  insert into public.da_historique (da_id, action, statut_apres, auteur_id) values (v_id, 'creation', 'soumise', v_uid);
  return v_id;
end;
$$;

-- Circuit de la demande d'achat. Chaque action vérifie le rôle et le statut.
create function public.da_action(p_da_id uuid, p_action text, p jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  d public.demandes_achat;
  v_uid uuid := auth.uid();
  v_role text := public.app_role();
  v_new text;
  v_manager uuid;
  v_nb_devis int;
  v_requis int;
  v_montant numeric;
  l jsonb;
  ligne public.da_lignes;
  v_qte numeric;
begin
  if v_role is null then raise exception 'Utilisateur non autorisé'; end if;
  select * into d from public.demandes_achat where id = p_da_id for update;
  if not found then raise exception 'Demande introuvable'; end if;
  select manager_id into v_manager from public.profiles where id = d.demandeur_id;

  case p_action
  when 'prendre_en_charge' then
    if v_role not in ('acheteur', 'admin') then raise exception 'Réservé aux acheteurs'; end if;
    if d.statut not in ('soumise', 'attente_validation', 'attente_direction', 'validee') then raise exception 'Statut incompatible'; end if;
    update public.demandes_achat set acheteur_id = v_uid, prise_en_charge_le = coalesce(prise_en_charge_le, now()) where id = d.id;
    v_new := d.statut;

  when 'servir_stock' then
    if v_role not in ('magasinier', 'admin') then raise exception 'Réservé au magasin'; end if;
    if d.statut <> 'soumise' then raise exception 'Seule une DA soumise peut être servie depuis le stock'; end if;
    for ligne in select * from public.da_lignes where da_id = d.id loop
      if ligne.article_id is null then raise exception 'La ligne « % » n''est pas un article du magasin', ligne.designation; end if;
      insert into public.mouvements_stock (article_id, type, quantite, vehicle_id, equipement, demandeur, motif, da_id, auteur_id)
      values (ligne.article_id, 'sortie', ligne.quantite, d.vehicle_id, d.equipement,
              (select full_name from public.profiles where id = d.demandeur_id), 'consommation', d.id, v_uid);
    end loop;
    v_new := 'servie_stock';
    update public.demandes_achat set statut = v_new, prise_en_charge_le = coalesce(prise_en_charge_le, now()) where id = d.id;

  when 'envoyer_validation' then
    if v_role not in ('acheteur', 'magasinier', 'admin') then raise exception 'Réservé aux achats et au magasin'; end if;
    if d.statut <> 'soumise' then raise exception 'Statut incompatible'; end if;
    v_new := 'attente_validation';
    update public.demandes_achat
       set statut = v_new,
           montant_estime = coalesce(nullif(p ->> 'montant_estime', '')::numeric, montant_estime),
           acheteur_id = case when v_role = 'acheteur' then coalesce(acheteur_id, v_uid) else acheteur_id end,
           prise_en_charge_le = coalesce(prise_en_charge_le, now())
     where id = d.id;

  when 'valider' then
    if d.statut = 'attente_validation' then
      if not (v_uid = v_manager or v_role in ('direction', 'admin')
              or (v_manager is null and v_role in ('acheteur'))) then
        raise exception 'Seul le responsable hiérarchique ou la direction peut valider';
      end if;
      v_new := case when coalesce(d.montant_estime, 0) >= public.param('seuil_validation_direction')
                         and v_role not in ('direction', 'admin')
                    then 'attente_direction' else 'validee' end;
      update public.demandes_achat
         set statut = v_new, valideur_id = v_uid, valide_le = now(),
             valideur_direction_id = case when v_new = 'validee' and v_role in ('direction', 'admin') then v_uid else valideur_direction_id end,
             valide_direction_le = case when v_new = 'validee' and v_role in ('direction', 'admin') then now() else valide_direction_le end
       where id = d.id;
    elsif d.statut = 'attente_direction' then
      if v_role not in ('direction', 'admin') then raise exception 'Validation réservée à la direction'; end if;
      v_new := 'validee';
      update public.demandes_achat set statut = v_new, valideur_direction_id = v_uid, valide_direction_le = now() where id = d.id;
    else
      raise exception 'Cette demande n''est pas en attente de validation';
    end if;

  when 'rejeter' then
    if d.statut not in ('soumise', 'attente_validation', 'attente_direction', 'validee') then raise exception 'Statut incompatible'; end if;
    if not (v_uid = v_manager or v_role in ('direction', 'admin', 'acheteur')) then raise exception 'Action non autorisée'; end if;
    if nullif(trim(p ->> 'commentaire'), '') is null then raise exception 'Indiquez le motif du rejet'; end if;
    v_new := 'rejetee';
    update public.demandes_achat set statut = v_new, motif_rejet = trim(p ->> 'commentaire') where id = d.id;

  when 'commander' then
    if v_role not in ('acheteur', 'admin') then raise exception 'Réservé aux acheteurs'; end if;
    if d.statut <> 'validee' then raise exception 'La demande doit être validée avant la commande'; end if;
    select count(*) into v_nb_devis from public.devis where da_id = d.id;
    select montant into v_montant from public.devis where da_id = d.id and retenu limit 1;
    if v_montant is null then raise exception 'Sélectionnez le devis retenu'; end if;
    v_requis := case when d.urgence = 'arret_machine' or v_montant < public.param('seuil_trois_devis') then 1 else 3 end;
    if v_nb_devis < v_requis then
      raise exception '% devis requis pour ce montant (% saisi(s))', v_requis, v_nb_devis;
    end if;
    if nullif(p ->> 'date_livraison_prevue', '') is null then raise exception 'Indiquez la date de livraison promise'; end if;
    v_new := 'commandee';
    update public.demandes_achat
       set statut = v_new,
           fournisseur_id = (select fournisseur_id from public.devis where da_id = d.id and retenu limit 1),
           montant_commande = v_montant,
           bc_numero = public.next_numero('BC'), bc_date = now(),
           date_livraison_prevue = (p ->> 'date_livraison_prevue')::date,
           acheteur_id = coalesce(acheteur_id, v_uid),
           prise_en_charge_le = coalesce(prise_en_charge_le, now())
     where id = d.id;
    for l in select * from jsonb_array_elements(coalesce(p -> 'lignes', '[]'::jsonb)) loop
      update public.da_lignes set prix_unitaire = nullif(l ->> 'prix_unitaire', '')::numeric
       where id = (l ->> 'id')::uuid and da_id = d.id;
    end loop;

  when 'receptionner' then
    if v_role not in ('magasinier', 'acheteur', 'admin') then raise exception 'Réservé au magasin et aux achats'; end if;
    if d.statut <> 'commandee' then raise exception 'Seule une commande en cours peut être réceptionnée'; end if;
    for l in select * from jsonb_array_elements(coalesce(p -> 'lignes', '[]'::jsonb)) loop
      v_qte := coalesce(nullif(l ->> 'quantite_recue', '')::numeric, 0);
      select * into ligne from public.da_lignes where id = (l ->> 'id')::uuid and da_id = d.id;
      if not found or v_qte <= 0 then continue; end if;
      update public.da_lignes
         set quantite_recue = quantite_recue + v_qte,
             prix_unitaire = coalesce(nullif(l ->> 'prix_unitaire', '')::numeric, prix_unitaire)
       where id = ligne.id
       returning * into ligne;
      if ligne.article_id is not null then
        insert into public.mouvements_stock (article_id, type, quantite, prix_unitaire, motif, da_id, auteur_id, commentaire)
        values (ligne.article_id, 'entree', v_qte, ligne.prix_unitaire, 'reception', d.id, v_uid, 'BC ' || d.bc_numero);
      end if;
      if ligne.prix_unitaire is not null then
        insert into public.prix_historique (article_id, designation, fournisseur_id, prix_unitaire, source, da_id)
        values (ligne.article_id, ligne.designation, d.fournisseur_id, ligne.prix_unitaire, 'commande', d.id);
      end if;
    end loop;
    v_new := case when exists (select 1 from public.da_lignes where da_id = d.id and quantite_recue < quantite)
                  then 'commandee' else 'receptionnee' end;
    update public.demandes_achat
       set statut = v_new,
           date_reception = case when v_new = 'receptionnee' then now() else date_reception end,
           bl_numero = coalesce(nullif(p ->> 'bl_numero', ''), bl_numero),
           facture_numero = coalesce(nullif(p ->> 'facture_numero', ''), facture_numero),
           rapprochement_ok = coalesce((p ->> 'rapprochement_ok')::boolean, rapprochement_ok)
     where id = d.id;

  when 'cloturer' then
    if v_role not in ('acheteur', 'admin') then raise exception 'Réservé aux acheteurs'; end if;
    if d.statut <> 'receptionnee' then raise exception 'La commande doit être réceptionnée'; end if;
    if d.fournisseur_id is not null and p ? 'note_delai' then
      insert into public.evaluations_fournisseurs (fournisseur_id, da_id, type, note_delai, note_qualite, note_conformite, commentaire, auteur_id)
      values (d.fournisseur_id, d.id, 'commande', (p ->> 'note_delai')::int, (p ->> 'note_qualite')::int,
              (p ->> 'note_conformite')::int, nullif(p ->> 'commentaire', ''), v_uid);
    end if;
    v_new := 'cloturee';
    update public.demandes_achat set statut = v_new where id = d.id;

  when 'annuler' then
    if d.statut in ('servie_stock', 'receptionnee', 'cloturee', 'rejetee', 'annulee') then raise exception 'Statut incompatible'; end if;
    if not ((v_uid = d.demandeur_id and d.statut = 'soumise') or v_role in ('acheteur', 'admin')) then
      raise exception 'Action non autorisée';
    end if;
    if nullif(trim(p ->> 'commentaire'), '') is null then raise exception 'Une annulation doit être justifiée'; end if;
    v_new := 'annulee';
    update public.demandes_achat set statut = v_new, motif_rejet = trim(p ->> 'commentaire') where id = d.id;

  else
    raise exception 'Action inconnue : %', p_action;
  end case;

  insert into public.da_historique (da_id, action, statut_avant, statut_apres, commentaire, auteur_id)
  values (d.id, p_action, d.statut, v_new, nullif(trim(p ->> 'commentaire'), ''), v_uid);
  return v_new;
end;
$$;

-- Inventaire : démarrage (articles A pour un tournant, tous pour un complet) et clôture.
create function public.demarrer_inventaire(p_type text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.has_role('magasinier', 'admin') then raise exception 'Réservé au magasin'; end if;
  insert into public.inventaires (type) values (p_type) returning id into v_id;
  insert into public.inventaire_lignes (inventaire_id, article_id, qte_theorique)
  select v_id, id, stock_actuel from public.articles
   where actif and (p_type = 'complet' or criticite = 'A');
  update public.inventaires set nb_articles = (select count(*) from public.inventaire_lignes where inventaire_id = v_id) where id = v_id;
  return v_id;
end;
$$;

create function public.cloturer_inventaire(p_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_ecarts int := 0;
begin
  if not public.has_role('magasinier', 'admin') then raise exception 'Réservé au magasin'; end if;
  if not exists (select 1 from public.inventaires where id = p_id and statut = 'en_cours') then
    raise exception 'Inventaire introuvable ou déjà clôturé';
  end if;
  if exists (select 1 from public.inventaire_lignes where inventaire_id = p_id and qte_comptee is null) then
    raise exception 'Tous les articles doivent être comptés';
  end if;
  for r in select l.article_id, l.qte_comptee, a.stock_actuel
             from public.inventaire_lignes l join public.articles a on a.id = l.article_id
            where l.inventaire_id = p_id loop
    if r.qte_comptee <> r.stock_actuel then
      v_ecarts := v_ecarts + 1;
      insert into public.mouvements_stock (article_id, type, quantite, motif, commentaire)
      values (r.article_id, 'ajustement', r.qte_comptee - r.stock_actuel, 'inventaire', 'Écart d''inventaire');
    end if;
  end loop;
  update public.inventaires set statut = 'cloture', nb_ecarts = v_ecarts, date_cloture = now() where id = p_id;
  return v_ecarts;
end;
$$;

-- =====================================================================
-- Vues : échéances, consommation, coûts, alertes
-- =====================================================================

create view public.v_echeances with (security_invoker = true) as
select
  d.id, d.type, d.libelle, d.reference, d.vehicle_id, v.matricule, d.chauffeur_id, p.full_name as chauffeur_nom,
  d.date_expiration, (d.date_expiration - current_date) as jours_restants,
  case
    when d.date_expiration < current_date then 'expire'
    when d.date_expiration - current_date <= least(7, d.rappel_jours) then 'urgent'
    when d.date_expiration - current_date <= d.rappel_jours then 'bientot'
    else 'ok'
  end as niveau
from public.documents d
left join public.vehicles v on v.id = d.vehicle_id
left join public.profiles p on p.id = d.chauffeur_id
where not d.archive and (v.id is null or v.actif);

create view public.v_plans_maintenance with (security_invoker = true) as
select
  pm.*, v.matricule, v.unite_compteur, v.compteur_actuel,
  case when pm.intervalle_compteur is not null
       then coalesce(pm.dernier_compteur, 0) + pm.intervalle_compteur end as prochain_compteur,
  case when pm.intervalle_jours is not null
       then coalesce(pm.derniere_date, pm.created_at::date) + pm.intervalle_jours end as prochaine_date,
  case when pm.intervalle_compteur is not null
       then coalesce(pm.dernier_compteur, 0) + pm.intervalle_compteur - v.compteur_actuel end as reste_compteur,
  case when pm.intervalle_jours is not null
       then coalesce(pm.derniere_date, pm.created_at::date) + pm.intervalle_jours - current_date end as reste_jours
from public.plans_maintenance pm
join public.vehicles v on v.id = pm.vehicle_id
where pm.actif and v.actif;

create view public.v_pleins with (security_invoker = true) as
select
  x.*,
  case when x.compteur_precedent is not null and x.compteur > x.compteur_precedent
       then round(x.litres / (x.compteur - x.compteur_precedent) * case when x.unite_compteur = 'km' then 100 else 1 end, 2)
  end as consommation,
  (x.litres * coalesce(x.prix_litre, 0))::numeric(12, 2) as montant
from (
  select pl.*, v.matricule, v.unite_compteur, v.conso_reference,
         lag(pl.compteur) over (partition by pl.vehicle_id order by pl.compteur, pl.date_plein) as compteur_precedent
    from public.pleins pl join public.vehicles v on v.id = pl.vehicle_id
) x;

create view public.v_fournisseurs_score with (security_invoker = true) as
select f.id as fournisseur_id,
       round(avg(e.note_delai), 1) as note_delai,
       round(avg(e.note_qualite), 1) as note_qualite,
       round(avg(e.note_prix), 1) as note_prix,
       round(avg(e.note_reactivite), 1) as note_reactivite,
       round(avg(e.note_conformite), 1) as note_conformite,
       round(avg((coalesce(e.note_delai, 0) + coalesce(e.note_qualite, 0) + coalesce(e.note_prix, 0)
                  + coalesce(e.note_reactivite, 0) + coalesce(e.note_conformite, 0))::numeric
                 / nullif((e.note_delai is not null)::int + (e.note_qualite is not null)::int + (e.note_prix is not null)::int
                          + (e.note_reactivite is not null)::int + (e.note_conformite is not null)::int, 0)), 2) as score,
       count(e.id) as nb_evaluations,
       max(e.created_at) filter (where e.type = 'semestrielle') as derniere_evaluation_semestrielle
  from public.fournisseurs f
  left join public.evaluations_fournisseurs e on e.fournisseur_id = f.id
 group by f.id;

-- Délais cibles de traitement des DA (prise en charge / commande).
create view public.v_da_delais with (security_invoker = true) as
select d.id, d.numero, d.urgence, d.statut, d.created_at, d.prise_en_charge_le, d.bc_date,
       d.created_at + case d.urgence when 'arret_machine' then interval '2 hours'
                                     when 'urgent' then interval '24 hours'
                                     else interval '48 hours' end as limite_prise_en_charge,
       case d.urgence when 'arret_machine' then date_trunc('day', d.created_at) + interval '1 day'
                      when 'urgent' then d.created_at + interval '48 hours'
                      else d.created_at + interval '7 days' end as limite_commande
  from public.demandes_achat d;

-- Toutes les alertes, filtrées automatiquement par les droits de lecture (RLS).
create view public.v_alertes with (security_invoker = true) as
select module, niveau, categorie, ref_id, titre, cible, detail, lien
from (
-- Papiers véhicules / chauffeurs
select 'flotte'::text as module, e.niveau, 'document'::text as categorie, e.id::text as ref_id,
       e.type as titre, coalesce(e.matricule, e.chauffeur_nom) as cible,
       case when e.jours_restants < 0 then 'Expiré depuis ' || -e.jours_restants || ' j'
            else 'Expire dans ' || e.jours_restants || ' j' end as detail,
       case when e.vehicle_id is not null then '/vehicules/' || e.vehicle_id else '/utilisateurs' end as lien,
       e.vehicle_id
  from public.v_echeances e where e.niveau <> 'ok'
union all
-- Maintenance due (compteur ou date)
select 'flotte', case when least(coalesce(p.reste_compteur, 999999), coalesce(p.reste_jours, 999999)) <= 0 then 'expire'
                      when coalesce(p.reste_compteur, 999999) <= p.alerte_compteur / 2
                           or coalesce(p.reste_jours, 999999) <= p.alerte_jours / 2 then 'urgent'
                      else 'bientot' end,
       'maintenance', p.id::text, p.libelle, p.matricule,
       concat_ws(' · ',
         case when p.reste_compteur is not null then
           case when p.reste_compteur <= 0 then 'Dépassée de ' || -p.reste_compteur || ' ' || p.unite_compteur
                else p.reste_compteur || ' ' || p.unite_compteur || ' restants' end end,
         case when p.reste_jours is not null then
           case when p.reste_jours <= 0 then 'Date dépassée de ' || -p.reste_jours || ' j'
                else 'Dans ' || p.reste_jours || ' j' end end),
       '/vehicules/' || p.vehicle_id, p.vehicle_id
  from public.v_plans_maintenance p
 where coalesce(p.reste_compteur, 999999) <= p.alerte_compteur or coalesce(p.reste_jours, 999999) <= p.alerte_jours
union all
-- Fiche de contrôle non faite sur un véhicule attribué
select 'flotte', 'bientot', 'fiche_controle', v.id::text, 'Fiche de contrôle manquante', v.matricule,
       'Aucune fiche depuis ' || public.param('fiche_controle_jours') || ' j', '/vehicules/' || v.id, v.id
  from public.vehicles v
 where v.actif and v.chauffeur_id is not null and v.statut in ('disponible', 'en_service')
   and not exists (select 1 from public.control_sheets s
                    where s.vehicle_id = v.id and s.date_controle > current_date - public.param('fiche_controle_jours')::int)
union all
-- Consommation anormale (30 derniers jours)
select 'flotte', 'bientot', 'consommation', p.id::text, 'Consommation anormale', p.matricule,
       p.consommation || case when p.unite_compteur = 'km' then ' L/100 km' else ' L/h' end
         || ' (référence ' || p.conso_reference || ')', '/gasoil', p.vehicle_id
  from public.v_pleins p
 where p.date_plein > now() - interval '30 days' and p.conso_reference is not null and p.consommation is not null
   and p.consommation > p.conso_reference * (1 + public.param('conso_tolerance_pct') / 100)
union all
-- Stock sous le minimum
select 'magasin', case when a.criticite = 'A' and a.stock_actuel <= 0 then 'expire'
                       when a.criticite = 'A' or a.stock_actuel <= 0 then 'urgent' else 'bientot' end,
       'stock_min', a.id::text, a.designation, a.code,
       'Stock ' || a.stock_actuel || ' / min ' || a.stock_min || ' (classe ' || a.criticite || ')', '/magasin/' || a.id, null::uuid
  from public.articles a where a.actif and a.stock_actuel < a.stock_min
union all
-- Retard fournisseur
select 'achats', case when d.date_livraison_prevue < current_date - 7 then 'expire' else 'urgent' end,
       'retard_fournisseur', d.id::text, 'Livraison en retard', d.numero || coalesce(' · ' || f.raison_sociale, ''),
       'Prévue le ' || to_char(d.date_livraison_prevue, 'DD/MM/YYYY'), '/achats/' || d.id, null::uuid
  from public.demandes_achat d left join public.fournisseurs f on f.id = d.fournisseur_id
 where d.statut = 'commandee' and d.date_livraison_prevue < current_date
union all
-- DA non prise en charge dans le délai cible
select 'achats', case when x.urgence = 'arret_machine' then 'expire' else 'urgent' end,
       'delai_da', x.id::text, 'DA non prise en charge', x.numero,
       'Délai cible dépassé (' || x.urgence || ')', '/achats/' || x.id, null::uuid
  from public.v_da_delais x
 where x.statut = 'soumise' and x.prise_en_charge_le is null and now() > x.limite_prise_en_charge
union all
-- DA en attente de validation
select 'achats', 'bientot', 'validation_da', d.id::text, 'DA à valider', d.numero,
       case d.statut when 'attente_direction' then 'Validation direction' else 'Validation hiérarchique' end,
       '/achats/' || d.id, null::uuid
  from public.demandes_achat d where d.statut in ('attente_validation', 'attente_direction')
union all
-- Fin de contrat fournisseur
select 'achats', case when c.date_fin < current_date then 'expire' else 'bientot' end,
       'contrat', c.id::text, 'Contrat à renouveler', f.raison_sociale,
       c.objet || ' · fin ' || to_char(c.date_fin, 'DD/MM/YYYY'), '/fournisseurs/' || f.id, null::uuid
  from public.contrats_fournisseurs c join public.fournisseurs f on f.id = c.fournisseur_id
 where c.actif and c.date_fin is not null and c.date_fin < current_date + public.param('contrat_alerte_jours')::int
union all
-- Benne immobile chez un client
select 'bennes', case when b.depuis < now() - make_interval(days => 2 * public.param('benne_immobile_jours')::int)
                      then 'urgent' else 'bientot' end,
       'benne_immobile', b.id::text, 'Benne immobile', b.numero || coalesce(' · ' || c.nom, ''),
       'Chez le client depuis ' || (current_date - b.depuis::date) || ' j', '/bennes/' || b.id, null::uuid
  from public.bennes b left join public.clients c on c.id = b.client_id
 where b.actif and b.statut = 'chez_client'
   and b.depuis < now() - make_interval(days => public.param('benne_immobile_jours')::int)
) a
-- Chaque profil ne reçoit que les alertes de ses modules ; le chauffeur, celles de son véhicule.
-- La fonction d'e-mail (clé service_role) voit tout.
where current_user in ('service_role', 'postgres') or case a.module
        when 'achats' then public.has_role('admin', 'direction', 'acheteur', 'magasinier')
             or (a.categorie = 'validation_da' and exists (
                   select 1 from public.demandes_achat d join public.profiles p on p.id = d.demandeur_id
                    where d.id::text = a.ref_id and p.manager_id = auth.uid()))
        when 'magasin' then public.has_role('admin', 'direction', 'magasinier', 'acheteur')
        when 'bennes' then public.has_role('admin', 'direction', 'exploitation', 'responsable_flotte')
        else public.has_role('admin', 'direction', 'responsable_flotte')
             or a.categorie = 'document'
             or a.vehicle_id in (select id from public.vehicles where chauffeur_id = auth.uid())
      end;

-- Indicateurs de performance (direction).
create function public.kpis(p_debut date, p_fin date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb := '{}'::jsonb;
  v_fin timestamptz := p_fin + 1;
begin
  if not public.has_role('direction', 'admin', 'acheteur', 'magasinier', 'responsable_flotte', 'exploitation') then
    raise exception 'Accès réservé';
  end if;

  r := r || jsonb_build_object('achats', (
    select jsonb_build_object(
      'nb_da', count(*),
      'delai_moyen_commande_h', round(avg(extract(epoch from (d.bc_date - d.created_at)) / 3600) filter (where d.bc_date is not null), 1),
      'pct_prise_en_charge_delai', round(100.0 * count(*) filter (where d.prise_en_charge_le <= x.limite_prise_en_charge)
                                         / nullif(count(*) filter (where d.prise_en_charge_le is not null), 0), 1),
      'pct_commande_delai', round(100.0 * count(*) filter (where d.bc_date <= x.limite_commande)
                                  / nullif(count(*) filter (where d.bc_date is not null), 0), 1),
      'taux_service_fournisseurs', round(100.0 * count(*) filter (where d.date_reception::date <= d.date_livraison_prevue)
                                         / nullif(count(*) filter (where d.date_reception is not null), 0), 1),
      'economies_negociees', coalesce(sum(d.montant_estime - d.montant_commande)
                                      filter (where d.montant_estime is not null and d.montant_commande is not null), 0),
      'montant_commande', coalesce(sum(d.montant_commande), 0))
    from public.demandes_achat d join public.v_da_delais x on x.id = d.id
    where d.created_at >= p_debut and d.created_at < v_fin));

  r := r || jsonb_build_object('magasin', jsonb_build_object(
    'valeur_stock', (select coalesce(sum(stock_actuel * coalesce(prix_unitaire, 0)), 0) from public.articles where actif),
    'ruptures_a', (select count(*) from public.articles where actif and criticite = 'A' and stock_actuel <= 0),
    'sous_minimum', (select count(*) from public.articles where actif and stock_actuel < stock_min),
    'fiabilite_inventaire', (select round(100.0 * (nb_articles - nb_ecarts) / nullif(nb_articles, 0), 1)
                               from public.inventaires where statut = 'cloture' order by date_cloture desc limit 1),
    'articles_dormants', (select count(*) from public.articles a where a.actif and a.stock_actuel > 0
                            and not exists (select 1 from public.mouvements_stock m where m.article_id = a.id
                                             and m.type = 'sortie' and m.created_at > now() - interval '180 days'))));

  r := r || jsonb_build_object('flotte', jsonb_build_object(
    'nb_vehicules', (select count(*) from public.vehicles where actif),
    'disponibilite_pct', (select round(100.0 * count(*) filter (where statut in ('disponible', 'en_service')) / nullif(count(*), 0), 1)
                            from public.vehicles where actif and statut <> 'hors_service'),
    'cout_maintenance', (select coalesce(sum(cout), 0) from public.interventions where created_at >= p_debut and created_at < v_fin)
                        + (select coalesce(sum(quantite * coalesce(prix_unitaire, 0)), 0) from public.mouvements_stock
                            where type = 'sortie' and vehicle_id is not null and created_at >= p_debut and created_at < v_fin),
    'conso_l_100km', (select round(sum(litres) * 100 / nullif(sum(compteur - compteur_precedent), 0), 2) from public.v_pleins
                       where unite_compteur = 'km' and compteur_precedent is not null and date_plein >= p_debut and date_plein < v_fin),
    'conso_l_h', (select round(sum(litres) / nullif(sum(compteur - compteur_precedent), 0), 2) from public.v_pleins
                   where unite_compteur = 'heures' and compteur_precedent is not null and date_plein >= p_debut and date_plein < v_fin),
    'gasoil_litres', (select coalesce(sum(litres), 0) from public.pleins where date_plein >= p_debut and date_plein < v_fin),
    'accidents', (select count(*) from public.accidents where date_accident >= p_debut and date_accident < v_fin),
    'documents_expires', (select count(*) from public.v_echeances where niveau = 'expire'),
    'taux_fiches_controle', (select round(100.0 * count(*) filter (where exists (
                                select 1 from public.control_sheets s where s.vehicle_id = v.id
                                   and s.date_controle > current_date - public.param('fiche_controle_jours')::int))
                              / nullif(count(*), 0), 1)
                              from public.vehicles v where v.actif and v.chauffeur_id is not null)));

  r := r || jsonb_build_object('bennes', jsonb_build_object(
    'nb_bennes', (select count(*) from public.bennes where actif),
    'chez_client', (select count(*) from public.bennes where actif and statut = 'chez_client'),
    'au_depot', (select count(*) from public.bennes where actif and statut = 'depot' and etat = 'bon'),
    'rotations', (select count(*) from public.mouvements_bennes where motif in ('pose', 'echange')
                   and date_mouvement >= p_debut and date_mouvement < v_fin),
    'taux_rotation', (select round(count(*)::numeric / nullif((select count(*) from public.bennes where actif), 0), 2)
                       from public.mouvements_bennes where motif in ('pose', 'echange') and date_mouvement >= p_debut and date_mouvement < v_fin),
    'duree_moyenne_client_j', (select round(avg(current_date - depuis::date), 1) from public.bennes where actif and statut = 'chez_client'),
    'non_localisees', (select count(*) from public.bennes where actif
                        and coalesce(derniere_verification, depuis::date) < current_date - 30)));
  return r;
end;
$$;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.profiles                 enable row level security;
alter table public.parametres               enable row level security;
alter table public.compteurs                enable row level security;
alter table public.audit_log                enable row level security;
alter table public.fournisseurs             enable row level security;
alter table public.contrats_fournisseurs    enable row level security;
alter table public.vehicles                 enable row level security;
alter table public.documents                enable row level security;
alter table public.plans_maintenance        enable row level security;
alter table public.pneus                    enable row level security;
alter table public.articles                 enable row level security;
alter table public.demandes_achat           enable row level security;
alter table public.da_lignes                enable row level security;
alter table public.devis                    enable row level security;
alter table public.da_historique            enable row level security;
alter table public.evaluations_fournisseurs enable row level security;
alter table public.prix_historique          enable row level security;
alter table public.interventions            enable row level security;
alter table public.control_items            enable row level security;
alter table public.control_sheets           enable row level security;
alter table public.control_results          enable row level security;
alter table public.accidents                enable row level security;
alter table public.pleins                   enable row level security;
alter table public.clients                  enable row level security;
alter table public.bennes                   enable row level security;
alter table public.mouvements_bennes        enable row level security;
alter table public.trajets                  enable row level security;
alter table public.mouvements_stock         enable row level security;
alter table public.inventaires              enable row level security;
alter table public.inventaire_lignes        enable row level security;

-- Aucune politique DELETE : rien ne se supprime, on annule / archive / désactive.

-- Profils
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or manager_id = auth.uid() or public.app_role() not in ('chauffeur', 'demandeur'));
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Paramètres
create policy parametres_select on public.parametres for select to authenticated using (public.app_role() is not null);
create policy parametres_update on public.parametres for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Journal
create policy audit_select on public.audit_log for select to authenticated
  using (public.has_role('admin', 'direction', 'acheteur', 'magasinier', 'responsable_flotte', 'exploitation'));

-- Fournisseurs et termes : achats en écriture ; magasin, flotte, direction en lecture
create policy fournisseurs_select on public.fournisseurs for select to authenticated
  using (public.has_role('admin', 'direction', 'acheteur', 'magasinier', 'responsable_flotte'));
create policy fournisseurs_insert on public.fournisseurs for insert to authenticated with check (public.has_role('admin', 'acheteur'));
create policy fournisseurs_update on public.fournisseurs for update to authenticated
  using (public.has_role('admin', 'acheteur')) with check (public.has_role('admin', 'acheteur'));
create policy contrats_select on public.contrats_fournisseurs for select to authenticated
  using (public.has_role('admin', 'direction', 'acheteur', 'magasinier'));
create policy contrats_insert on public.contrats_fournisseurs for insert to authenticated with check (public.has_role('admin', 'acheteur'));
create policy contrats_update on public.contrats_fournisseurs for update to authenticated
  using (public.has_role('admin', 'acheteur')) with check (public.has_role('admin', 'acheteur'));
create policy evaluations_select on public.evaluations_fournisseurs for select to authenticated
  using (public.has_role('admin', 'direction', 'acheteur', 'magasinier'));
create policy evaluations_insert on public.evaluations_fournisseurs for insert to authenticated
  with check (public.has_role('admin', 'direction', 'acheteur') and auteur_id = auth.uid());
create policy prix_select on public.prix_historique for select to authenticated
  using (public.has_role('admin', 'direction', 'acheteur', 'magasinier'));
create policy prix_insert on public.prix_historique for insert to authenticated with check (public.has_role('admin', 'acheteur'));

-- Véhicules : lecture par tous (sélection dans les formulaires), écriture flotte
create policy vehicles_select on public.vehicles for select to authenticated using (public.app_role() is not null);
create policy vehicles_insert on public.vehicles for insert to authenticated with check (public.has_role('admin', 'responsable_flotte'));
create policy vehicles_update on public.vehicles for update to authenticated
  using (public.has_role('admin', 'responsable_flotte')) with check (public.has_role('admin', 'responsable_flotte'));

create policy documents_select on public.documents for select to authenticated
  using (public.has_role('admin', 'direction', 'responsable_flotte') or chauffeur_id = auth.uid()
         or vehicle_id in (select id from public.vehicles where chauffeur_id = auth.uid()));
create policy documents_insert on public.documents for insert to authenticated with check (public.has_role('admin', 'responsable_flotte'));
create policy documents_update on public.documents for update to authenticated
  using (public.has_role('admin', 'responsable_flotte')) with check (public.has_role('admin', 'responsable_flotte'));

create policy plans_select on public.plans_maintenance for select to authenticated
  using (public.has_role('admin', 'direction', 'responsable_flotte', 'magasinier')
         or vehicle_id in (select id from public.vehicles where chauffeur_id = auth.uid()));
create policy plans_insert on public.plans_maintenance for insert to authenticated with check (public.has_role('admin', 'responsable_flotte'));
create policy plans_update on public.plans_maintenance for update to authenticated
  using (public.has_role('admin', 'responsable_flotte')) with check (public.has_role('admin', 'responsable_flotte'));

create policy pneus_select on public.pneus for select to authenticated
  using (public.has_role('admin', 'direction', 'responsable_flotte', 'magasinier'));
create policy pneus_insert on public.pneus for insert to authenticated with check (public.has_role('admin', 'responsable_flotte'));
create policy pneus_update on public.pneus for update to authenticated
  using (public.has_role('admin', 'responsable_flotte')) with check (public.has_role('admin', 'responsable_flotte'));

-- Magasin : écriture magasinier ; lecture achats, flotte, direction ; liste pour les demandeurs
create policy articles_select on public.articles for select to authenticated using (public.app_role() is not null);
create policy articles_insert on public.articles for insert to authenticated with check (public.has_role('admin', 'magasinier'));
create policy articles_update on public.articles for update to authenticated
  using (public.has_role('admin', 'magasinier')) with check (public.has_role('admin', 'magasinier'));

create policy mouvements_stock_select on public.mouvements_stock for select to authenticated
  using (public.has_role('admin', 'direction', 'magasinier', 'acheteur', 'responsable_flotte'));
create policy mouvements_stock_insert on public.mouvements_stock for insert to authenticated
  with check (public.has_role('admin', 'magasinier') and auteur_id = auth.uid() and da_id is null);

create policy inventaires_select on public.inventaires for select to authenticated
  using (public.has_role('admin', 'direction', 'magasinier'));
create policy inventaire_lignes_select on public.inventaire_lignes for select to authenticated
  using (public.has_role('admin', 'direction', 'magasinier'));
create policy inventaire_lignes_update on public.inventaire_lignes for update to authenticated
  using (public.has_role('admin', 'magasinier')
         and exists (select 1 from public.inventaires i where i.id = inventaire_id and i.statut = 'en_cours'))
  with check (public.has_role('admin', 'magasinier'));

-- Demandes d'achat : création et transitions via les fonctions ; lecture selon le profil
create policy da_select on public.demandes_achat for select to authenticated
  using (demandeur_id = auth.uid()
         or public.has_role('admin', 'direction', 'acheteur', 'magasinier')
         or demandeur_id in (select id from public.profiles where manager_id = auth.uid()));
create policy da_lignes_select on public.da_lignes for select to authenticated
  using (exists (select 1 from public.demandes_achat d where d.id = da_id));
create policy da_historique_select on public.da_historique for select to authenticated
  using (exists (select 1 from public.demandes_achat d where d.id = da_id));
create policy devis_select on public.devis for select to authenticated
  using (public.has_role('admin', 'direction', 'acheteur')
         or exists (select 1 from public.demandes_achat d where d.id = da_id and d.demandeur_id in (
              select id from public.profiles where manager_id = auth.uid())));
create policy devis_insert on public.devis for insert to authenticated
  with check (public.has_role('admin', 'acheteur')
              and exists (select 1 from public.demandes_achat d where d.id = da_id and d.statut in ('soumise', 'attente_validation', 'attente_direction', 'validee')));
create policy devis_update on public.devis for update to authenticated
  using (public.has_role('admin', 'acheteur')
         and exists (select 1 from public.demandes_achat d where d.id = da_id and d.statut in ('soumise', 'attente_validation', 'attente_direction', 'validee')))
  with check (public.has_role('admin', 'acheteur'));

-- Interventions
create policy interventions_select on public.interventions for select to authenticated
  using (demandeur_id = auth.uid() or public.has_role('admin', 'direction', 'responsable_flotte', 'magasinier'));
create policy interventions_insert on public.interventions for insert to authenticated
  with check (public.app_role() is not null and (
    public.has_role('admin', 'responsable_flotte')
    or (demandeur_id = auth.uid() and statut = 'nouvelle' and fiche_id is null and plan_id is null
        and assigne_a is null and reponse is null and cout is null)));
create policy interventions_update on public.interventions for update to authenticated
  using (public.has_role('admin', 'responsable_flotte')) with check (public.has_role('admin', 'responsable_flotte'));

-- Fiches de contrôle (création via submit_control_sheet, validation par la flotte)
create policy control_items_select on public.control_items for select to authenticated using (public.app_role() is not null);
create policy control_items_insert on public.control_items for insert to authenticated with check (public.is_admin());
create policy control_items_update on public.control_items for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy control_sheets_select on public.control_sheets for select to authenticated
  using (chauffeur_id = auth.uid() or public.has_role('admin', 'direction', 'responsable_flotte'));
create policy control_sheets_update on public.control_sheets for update to authenticated
  using (public.has_role('admin', 'responsable_flotte')) with check (public.has_role('admin', 'responsable_flotte'));
create policy control_results_select on public.control_results for select to authenticated
  using (exists (select 1 from public.control_sheets s where s.id = sheet_id));

-- Accidents
create policy accidents_select on public.accidents for select to authenticated
  using (declare_par = auth.uid() or chauffeur_id = auth.uid() or public.has_role('admin', 'direction', 'responsable_flotte'));
create policy accidents_insert on public.accidents for insert to authenticated
  with check (public.app_role() is not null and declare_par = auth.uid() and statut = 'declare');
create policy accidents_update on public.accidents for update to authenticated
  using (public.has_role('admin', 'responsable_flotte')) with check (public.has_role('admin', 'responsable_flotte'));

-- Gasoil et trajets : saisis par les chauffeurs, gérés par la flotte
create policy pleins_select on public.pleins for select to authenticated
  using (saisi_par = auth.uid() or chauffeur_id = auth.uid() or public.has_role('admin', 'direction', 'responsable_flotte'));
create policy pleins_insert on public.pleins for insert to authenticated
  with check (public.app_role() is not null and saisi_par = auth.uid());
create policy pleins_update on public.pleins for update to authenticated
  using (public.has_role('admin', 'responsable_flotte')) with check (public.has_role('admin', 'responsable_flotte'));

create policy trajets_select on public.trajets for select to authenticated
  using (saisi_par = auth.uid() or chauffeur_id = auth.uid() or public.has_role('admin', 'direction', 'responsable_flotte', 'exploitation'));
create policy trajets_insert on public.trajets for insert to authenticated
  with check (public.app_role() is not null and saisi_par = auth.uid());
create policy trajets_update on public.trajets for update to authenticated
  using (public.has_role('admin', 'responsable_flotte', 'exploitation')) with check (public.has_role('admin', 'responsable_flotte', 'exploitation'));

-- Bennes et clients : exploitation en écriture ; mouvements saisis aussi par les chauffeurs
create policy clients_select on public.clients for select to authenticated using (public.app_role() is not null);
create policy clients_insert on public.clients for insert to authenticated with check (public.has_role('admin', 'exploitation'));
create policy clients_update on public.clients for update to authenticated
  using (public.has_role('admin', 'exploitation')) with check (public.has_role('admin', 'exploitation'));
create policy bennes_select on public.bennes for select to authenticated using (public.app_role() is not null);
create policy bennes_insert on public.bennes for insert to authenticated with check (public.has_role('admin', 'exploitation'));
create policy bennes_update on public.bennes for update to authenticated
  using (public.has_role('admin', 'exploitation')) with check (public.has_role('admin', 'exploitation'));
create policy mouvements_bennes_select on public.mouvements_bennes for select to authenticated
  using (saisi_par = auth.uid() or public.has_role('admin', 'direction', 'exploitation', 'responsable_flotte'));
create policy mouvements_bennes_insert on public.mouvements_bennes for insert to authenticated
  with check (public.has_role('admin', 'exploitation', 'chauffeur', 'responsable_flotte') and saisi_par = auth.uid());

grant select on public.v_echeances, public.v_plans_maintenance, public.v_pleins, public.v_fournisseurs_score,
                public.v_da_delais, public.v_alertes to authenticated;

revoke execute on function public.submit_control_sheet(uuid, date, int, int, uuid, text, jsonb) from public, anon;
revoke execute on function public.creer_demande_achat(jsonb) from public, anon;
revoke execute on function public.da_action(uuid, text, jsonb) from public, anon;
revoke execute on function public.demarrer_inventaire(text) from public, anon;
revoke execute on function public.cloturer_inventaire(uuid) from public, anon;
revoke execute on function public.kpis(date, date) from public, anon;
grant execute on function public.submit_control_sheet(uuid, date, int, int, uuid, text, jsonb) to authenticated;
grant execute on function public.creer_demande_achat(jsonb) to authenticated;
grant execute on function public.da_action(uuid, text, jsonb) to authenticated;
grant execute on function public.demarrer_inventaire(text) to authenticated;
grant execute on function public.cloturer_inventaire(uuid) to authenticated;
grant execute on function public.kpis(date, date) to authenticated;
revoke execute on function public.next_numero(text) from public, anon, authenticated;
revoke execute on function public.bump_compteur(uuid, int) from public, anon, authenticated;

-- =====================================================================
-- Photos des accidents (Supabase Storage)
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('accidents', 'accidents', false) on conflict (id) do nothing;
    execute $p$create policy "accidents photos insert" on storage.objects for insert to authenticated
               with check (bucket_id = 'accidents')$p$;
    execute $p$create policy "accidents photos select" on storage.objects for select to authenticated
               using (bucket_id = 'accidents' and (owner = auth.uid() or public.has_role('admin', 'direction', 'responsable_flotte')))$p$;
  end if;
end;
$$;

-- =====================================================================
-- Fiche de contrôle : points (fiche avant départ + fiche hebdomadaire)
-- =====================================================================
insert into public.control_items (categorie, label_fr, label_ar, ordre) values
  ('Chauffeur & documents', 'EPI du chauffeur (casque, chaussures, vêtements, gants, lunettes)', 'معدات الوقاية الشخصية للسائق', 10),
  ('Chauffeur & documents', 'Accès cabine', 'الوصول إلى المقصورة', 20),
  ('Chauffeur & documents', 'Permis de conduire valide', 'رخصة السياقة سارية المفعول', 30),
  ('Chauffeur & documents', 'Documents à bord à jour (carte grise, assurance, visite, vignette)', 'الوثائق على متن الشاحنة', 40),
  ('Chauffeur & documents', 'Clé IVMS', 'مفتاح IVMS', 50),
  ('Niveaux', 'Niveau d''huile moteur', 'مستوى زيت المحرك', 60),
  ('Niveaux', 'Liquide de refroidissement (radiateur)', 'سائل التبريد', 70),
  ('Niveaux', 'Niveau d''huile hydraulique', 'مستوى الزيت الهيدروليكي', 80),
  ('Niveaux', 'Liquide de frein', 'سائل الفرامل', 90),
  ('Niveaux', 'Absence de fuites (huile, gasoil, hydraulique)', 'لا توجد تسربات', 100),
  ('Niveaux', 'État des flexibles hydrauliques et pneumatiques', 'حالة الخراطيم', 110),
  ('Pneus', 'Pression des pneus', 'ضغط الإطارات', 120),
  ('Pneus', 'Usure et dégâts visibles des pneus', 'تآكل الإطارات', 130),
  ('Pneus', 'Roue de secours', 'العجلة الاحتياطية', 140),
  ('Pneus', 'Cales roues', 'حواجز العجلات', 150),
  ('Freins & direction', 'État des freins', 'حالة الفرامل', 160),
  ('Freins & direction', 'Direction', 'المقود', 170),
  ('Freins & direction', 'Disque tachygraphe sans anomalies', 'قرص تاكوغراف', 180),
  ('Éclairage & visibilité', 'Feux avant', 'الأضواء الأمامية', 190),
  ('Éclairage & visibilité', 'Feux latéraux et clignotants', 'الأضواء الجانبية والإشارات', 200),
  ('Éclairage & visibilité', 'Feux arrière', 'الأضواء الخلفية', 210),
  ('Éclairage & visibilité', 'Gyrophare', 'الجيروفار', 220),
  ('Éclairage & visibilité', 'Avertisseur de recul', 'منبه الرجوع إلى الخلف', 230),
  ('Éclairage & visibilité', 'Pare-brise', 'الزجاج الأمامي', 240),
  ('Éclairage & visibilité', 'Essuie-glaces', 'المساحات', 250),
  ('Éclairage & visibilité', 'Rétroviseurs et vitres', 'المرايا والنوافذ', 260),
  ('Sécurité', 'Ceinture de sécurité', 'حزام الأمان', 270),
  ('Sécurité', 'Extincteur', 'طفاية الحريق', 280),
  ('Sécurité', 'Trousse de secours', 'صندوق الإسعافات', 290),
  ('Sécurité', 'Triangle de détresse', 'مثلث الاستغاثة', 300),
  ('Sécurité', 'Gilet haute visibilité', 'سترة عاكسة', 310),
  ('Sécurité', 'Lampe de poche', 'مصباح يدوي', 320),
  ('Sécurité', 'Kit absorbant en cas de déversement + pelle', 'مجموعة امتصاص الانسكاب ومجرفة', 330),
  ('Carrosserie & levage', 'Carrosserie', 'الهيكل', 340),
  ('Carrosserie & levage', 'Système de levage benne / bras', 'نظام رفع الحاوية', 350),
  ('Carrosserie & levage', 'Sangles et chaînes', 'الأحزمة والسلاسل', 360),
  ('Carrosserie & levage', 'État général du véhicule', 'الحالة العامة للشاحنة', 370);
