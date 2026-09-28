-- =====================================================================
-- Demandes d'Achat – Procédure PR-ACH-001
-- Schéma Supabase (PostgreSQL). À exécuter dans : Supabase > SQL Editor.
-- =====================================================================

create extension if not exists pgcrypto;

-- Numérotation automatique DA-AAAA-0001
create sequence if not exists da_numero_seq;

create table if not exists public.demandes (
  id                            uuid primary key default gen_random_uuid(),
  numero                        text unique,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  statut                        text not null default 'brouillon'
    check (statut in ('brouillon','soumise','validee','consultation','attente_validation_achat',
                      'achat_valide','bc_emis','non_conforme','receptionnee','cloturee','refusee','annulee')),

  -- Étapes 1 & 2 : identification du besoin / création de la DA
  demandeur                     text not null,
  service                       text not null,
  date_creation                 date not null default current_date,
  categorie                     text,
  designation                   text not null,
  reference                     text,
  marque                        text,
  modele                        text,
  quantite                      numeric not null check (quantite >= 0),
  unite                         text not null,
  motif                         text not null,
  centre_cout                   text not null,
  date_souhaitee                date,
  urgence                       text not null default 'Normal' check (urgence in ('Normal','Urgent','Critique')),
  impact                        text check (impact in ('Production','Client','Sécurité')),
  fournisseur_propose           text,
  budget_estimatif              numeric,
  pieces_jointes                text,
  stock_verifie                 boolean default false,
  commandes_verifiees           boolean default false,

  -- Étape 3 : validation du besoin
  validation_besoin_par         text,
  validation_besoin_date        timestamptz,
  validation_besoin_commentaire text,

  -- Étapes 4-5 : consultation / analyse
  offre_retenue_id              uuid,
  justification_choix           text,

  -- Étape 6 : validation de l'achat (matrice)
  validation_achat_niveau       text,
  validation_achat_par          text,
  validation_achat_date         timestamptz,
  validation_achat_commentaire  text,

  -- Étape 7 : bon de commande
  bc_numero                     text unique,
  bc_date                       date,
  bc_fournisseur                text,
  bc_montant                    numeric,
  bc_confirme                   boolean default false,
  bc_delai_confirme             date,

  -- Étape 8 : réception
  reception_date                date,
  reception_par                 text,
  quantite_recue                numeric,
  reception_controles           jsonb,
  reception_conforme            boolean,
  reception_remarque            text,
  nc_signalee                   boolean default false,
  nc_traitement                 text,
  reserves_traitees             boolean default false,

  -- Étape 9 : facture / clôture
  facture_numero                text,
  facture_date                  date,
  facture_montant               numeric,
  facture_conforme              boolean,
  cloture_date                  timestamptz
);

create table if not exists public.offres (
  id                    uuid primary key default gen_random_uuid(),
  demande_id            uuid not null references public.demandes(id) on delete cascade,
  created_at            timestamptz not null default now(),
  fournisseur           text not null,
  prix_unitaire_ht      numeric not null check (prix_unitaire_ht >= 0),
  cout_transport        numeric,
  delai_jours           integer,
  conditions_paiement   text,
  garantie              text,
  disponibilite         text,
  conformite_technique  text default 'À vérifier' check (conformite_technique in ('À vérifier','Conforme','Non conforme')),
  remarques             text
);

alter table public.demandes drop constraint if exists demandes_offre_retenue_fk;
alter table public.demandes add constraint demandes_offre_retenue_fk
  foreign key (offre_retenue_id) references public.offres(id) on delete set null;

create table if not exists public.historique (
  id           uuid primary key default gen_random_uuid(),
  demande_id   uuid not null references public.demandes(id) on delete cascade,
  created_at   timestamptz not null default now(),
  acteur       text,
  role         text,
  action       text not null,
  commentaire  text
);

create index if not exists offres_demande_idx     on public.offres(demande_id);
create index if not exists historique_demande_idx on public.historique(demande_id);
create index if not exists demandes_statut_idx    on public.demandes(statut);

-- Numéro DA automatique + updated_at
create or replace function public.demandes_before_write() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' and new.numero is null then
    new.numero := 'DA-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('da_numero_seq')::text, 4, '0');
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_demandes_before_write on public.demandes;
create trigger trg_demandes_before_write
  before insert or update on public.demandes
  for each row execute function public.demandes_before_write();

-- =====================================================================
-- Sécurité (RLS)
-- PHASE DE TEST : accès ouvert avec la clé "anon" (toute personne ayant
-- l'URL de l'application peut lire/écrire). À remplacer par des politiques
-- basées sur Supabase Auth avant une mise en production.
-- =====================================================================
alter table public.demandes   enable row level security;
alter table public.offres     enable row level security;
alter table public.historique enable row level security;

drop policy if exists "test_acces_ouvert" on public.demandes;
drop policy if exists "test_acces_ouvert" on public.offres;
drop policy if exists "test_acces_ouvert" on public.historique;

create policy "test_acces_ouvert" on public.demandes   for all to anon, authenticated using (true) with check (true);
create policy "test_acces_ouvert" on public.offres     for all to anon, authenticated using (true) with check (true);
create policy "test_acces_ouvert" on public.historique for all to anon, authenticated using (true) with check (true);
