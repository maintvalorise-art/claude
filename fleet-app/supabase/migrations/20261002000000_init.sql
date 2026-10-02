-- =====================================================================
-- Gestion de flotte : camions, engins, fiches de contrôle, interventions,
-- échéances (visite technique, assurance, tachygraphe, permis, vidange...)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type public.user_role as enum ('chauffeur', 'gestionnaire', 'admin');

create type public.vehicle_type as enum ('camion', 'engin', 'vehicule_leger', 'remorque', 'autre');

create type public.vehicle_status as enum ('disponible', 'en_service', 'en_panne', 'en_maintenance', 'hors_service');

create type public.document_type as enum (
  'visite_technique', 'assurance', 'vignette', 'carte_grise', 'tachygraphe',
  'extincteur', 'autorisation', 'permis', 'carte_professionnelle', 'visite_medicale', 'autre'
);

create type public.intervention_type as enum (
  'vidange', 'panne', 'pneumatique', 'freinage', 'electrique',
  'hydraulique', 'carrosserie', 'controle', 'autre'
);

create type public.intervention_priority as enum ('basse', 'normale', 'haute', 'urgente');

create type public.intervention_status as enum ('nouvelle', 'en_cours', 'terminee', 'rejetee');

-- ---------------------------------------------------------------------
-- Profils utilisateurs (1 ligne par compte auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  username    text unique,
  phone       text,
  role        public.user_role not null default 'chauffeur',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Le rôle n'est jamais lu depuis les métadonnées fournies par le client :
-- tout nouveau compte est « chauffeur », seul un admin peut le promouvoir.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := split_part(new.email, '@', 1);
begin
  -- Identifiant court (« ahmed ») s'il est libre, sinon l'e-mail complet.
  if exists (select 1 from public.profiles where username = v_username) then
    v_username := new.email;
  end if;
  insert into public.profiles (id, full_name, username)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    v_username
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.app_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active;
$$;

create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_role() in ('gestionnaire', 'admin'), false);
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_role() = 'admin', false);
$$;

-- ---------------------------------------------------------------------
-- Parc : camions, engins, véhicules
-- ---------------------------------------------------------------------
create table public.vehicles (
  id                 uuid primary key default gen_random_uuid(),
  matricule          text not null unique,
  type               public.vehicle_type not null default 'camion',
  marque             text,
  modele             text,
  annee              int,
  unite_compteur     text not null default 'km' check (unite_compteur in ('km', 'heures')),
  compteur_actuel    int not null default 0 check (compteur_actuel >= 0),
  prochaine_vidange  int check (prochaine_vidange >= 0),
  alerte_vidange     int not null default 1000 check (alerte_vidange >= 0),
  statut             public.vehicle_status not null default 'disponible',
  chauffeur_id       uuid references public.profiles (id) on delete set null,
  notes              text,
  actif              boolean not null default true,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Documents / échéances (véhicule OU chauffeur)
-- ---------------------------------------------------------------------
create table public.documents (
  id               uuid primary key default gen_random_uuid(),
  vehicle_id       uuid references public.vehicles (id) on delete cascade,
  chauffeur_id     uuid references public.profiles (id) on delete cascade,
  type             public.document_type not null,
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

create index documents_expiration_idx on public.documents (date_expiration) where not archive;

-- ---------------------------------------------------------------------
-- Fiche de contrôle avant départ
-- ---------------------------------------------------------------------
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
  vehicle_id               uuid not null references public.vehicles (id) on delete cascade,
  chauffeur_id             uuid not null references public.profiles (id) on delete cascade,
  conducteur_precedent_id  uuid references public.profiles (id) on delete set null,
  date_controle            date not null default current_date,
  compteur_depart          int not null check (compteur_depart >= 0),
  prochaine_vidange        int,
  remarques                text,
  nb_nok                   int not null default 0,
  created_at               timestamptz not null default now()
);

create index control_sheets_vehicle_idx on public.control_sheets (vehicle_id, created_at desc);
create index control_sheets_driver_idx on public.control_sheets (chauffeur_id, created_at desc);

create table public.control_results (
  sheet_id     uuid not null references public.control_sheets (id) on delete cascade,
  item_id      int not null references public.control_items (id),
  ok           boolean not null,
  commentaire  text,
  primary key (sheet_id, item_id)
);

-- ---------------------------------------------------------------------
-- Demandes d'intervention (vidange, panne, ...)
-- ---------------------------------------------------------------------
create table public.interventions (
  id                   uuid primary key default gen_random_uuid(),
  numero               bigint generated always as identity unique,
  vehicle_id           uuid not null references public.vehicles (id) on delete cascade,
  demandeur_id         uuid references public.profiles (id) on delete set null,
  type                 public.intervention_type not null,
  priorite             public.intervention_priority not null default 'normale',
  statut               public.intervention_status not null default 'nouvelle',
  titre                text not null,
  description          text,
  compteur             int,
  vehicule_immobilise  boolean not null default false,
  assigne_a            text,
  reponse              text,
  cout                 numeric(12, 2),
  fiche_id             uuid references public.control_sheets (id) on delete set null,
  date_cloture         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index interventions_statut_idx on public.interventions (statut, created_at desc);

create function public.interventions_touch()
returns trigger
language plpgsql
as $$
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

create trigger interventions_touch
  before insert or update on public.interventions
  for each row execute function public.interventions_touch();

-- Un véhicule déclaré immobilisé passe automatiquement « en panne ».
create function public.interventions_vehicle_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.vehicule_immobilise and new.statut in ('nouvelle', 'en_cours') then
    update public.vehicles set statut = 'en_panne'
     where id = new.vehicle_id and statut not in ('hors_service', 'en_maintenance');
  end if;
  return new;
end;
$$;

create trigger interventions_vehicle_status
  after insert on public.interventions
  for each row execute function public.interventions_vehicle_status();

-- ---------------------------------------------------------------------
-- Vue des échéances (documents + vidanges) avec niveau d'alerte
-- ---------------------------------------------------------------------
create view public.v_echeances
with (security_invoker = true)
as
select
  d.id,
  'document'::text                       as source,
  d.type::text                           as type,
  d.libelle,
  d.reference,
  d.vehicle_id,
  v.matricule,
  d.chauffeur_id,
  p.full_name                            as chauffeur_nom,
  d.date_expiration,
  (d.date_expiration - current_date)     as jours_restants,
  null::int                              as reste_compteur,
  case
    when d.date_expiration < current_date then 'expire'
    when d.date_expiration - current_date <= least(7, d.rappel_jours) then 'urgent'
    when d.date_expiration - current_date <= d.rappel_jours then 'bientot'
    else 'ok'
  end                                    as niveau
from public.documents d
left join public.vehicles v on v.id = d.vehicle_id
left join public.profiles p on p.id = d.chauffeur_id
where not d.archive
  and (v.id is null or v.actif)
union all
select
  v.id,
  'vidange',
  'vidange',
  null,
  null,
  v.id,
  v.matricule,
  null,
  null,
  null,
  null,
  v.prochaine_vidange - v.compteur_actuel,
  case
    when v.prochaine_vidange - v.compteur_actuel <= 0 then 'expire'
    when v.prochaine_vidange - v.compteur_actuel <= v.alerte_vidange / 2 then 'urgent'
    when v.prochaine_vidange - v.compteur_actuel <= v.alerte_vidange then 'bientot'
    else 'ok'
  end
from public.vehicles v
where v.actif and v.prochaine_vidange is not null;

-- ---------------------------------------------------------------------
-- Fonctions utilisées par l'application
-- ---------------------------------------------------------------------

-- Liste minimale des chauffeurs (nom seulement) pour les listes déroulantes.
create function public.list_drivers()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name
    from public.profiles p
   where p.active and auth.uid() is not null
   order by p.full_name;
$$;

-- Dernier chauffeur ayant rempli une fiche sur ce véhicule.
create function public.vehicle_last_driver(p_vehicle_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.chauffeur_id
    from public.control_sheets s
   where s.vehicle_id = p_vehicle_id and auth.uid() is not null
   order by s.created_at desc
   limit 1;
$$;

-- Enregistre une fiche de contrôle complète de façon atomique :
-- fiche + résultats, mise à jour du compteur, et création automatique
-- d'une demande d'intervention si des points sont NOK.
create function public.submit_control_sheet(
  p_vehicle_id               uuid,
  p_date                     date,
  p_compteur                 int,
  p_prochaine_vidange        int,
  p_conducteur_precedent_id  uuid,
  p_remarques                text,
  p_results                  jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_sheet_id  uuid;
  v_nok       int;
  v_missing   int;
  v_details   text;
begin
  if v_uid is null or public.app_role() is null then
    raise exception 'Utilisateur non autorisé';
  end if;

  if not exists (select 1 from public.vehicles where id = p_vehicle_id and actif) then
    raise exception 'Véhicule introuvable';
  end if;

  select count(*) into v_missing
    from public.control_items i
   where i.actif
     and not exists (
       select 1 from jsonb_array_elements(p_results) r
        where (r ->> 'item_id')::int = i.id and r ? 'ok'
     );
  if v_missing > 0 then
    raise exception 'Fiche incomplète : % point(s) non renseigné(s)', v_missing;
  end if;

  insert into public.control_sheets (
    vehicle_id, chauffeur_id, conducteur_precedent_id, date_controle,
    compteur_depart, prochaine_vidange, remarques
  ) values (
    p_vehicle_id, v_uid, p_conducteur_precedent_id, coalesce(p_date, current_date),
    p_compteur, p_prochaine_vidange, nullif(trim(p_remarques), '')
  )
  returning id into v_sheet_id;

  insert into public.control_results (sheet_id, item_id, ok, commentaire)
  select v_sheet_id, (r ->> 'item_id')::int, (r ->> 'ok')::boolean, nullif(trim(r ->> 'commentaire'), '')
    from jsonb_array_elements(p_results) r
    join public.control_items i on i.id = (r ->> 'item_id')::int and i.actif;

  select count(*) filter (where not ok) into v_nok
    from public.control_results where sheet_id = v_sheet_id;

  update public.control_sheets set nb_nok = v_nok where id = v_sheet_id;

  update public.vehicles
     set compteur_actuel   = greatest(compteur_actuel, p_compteur),
         prochaine_vidange = coalesce(prochaine_vidange, p_prochaine_vidange)
   where id = p_vehicle_id;

  if v_nok > 0 then
    select string_agg('- ' || i.label_fr || coalesce(' : ' || cr.commentaire, ''), E'\n' order by i.ordre)
      into v_details
      from public.control_results cr
      join public.control_items i on i.id = cr.item_id
     where cr.sheet_id = v_sheet_id and not cr.ok;

    insert into public.interventions (
      vehicle_id, demandeur_id, type, priorite, titre, description, compteur, fiche_id
    ) values (
      p_vehicle_id, v_uid, 'controle', 'haute',
      'Fiche de contrôle : ' || v_nok || ' point(s) NOK',
      v_details, p_compteur, v_sheet_id
    );
  end if;

  return v_sheet_id;
end;
$$;

revoke execute on function public.submit_control_sheet(uuid, date, int, int, uuid, text, jsonb) from public, anon;
grant execute on function public.submit_control_sheet(uuid, date, int, int, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.vehicles        enable row level security;
alter table public.documents       enable row level security;
alter table public.control_items   enable row level security;
alter table public.control_sheets  enable row level security;
alter table public.control_results enable row level security;
alter table public.interventions   enable row level security;

-- profiles
create policy "profil : lecture du sien ou staff" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_staff());
create policy "profil : modification admin" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- vehicles
create policy "véhicules : lecture" on public.vehicles
  for select to authenticated using (public.app_role() is not null);
create policy "véhicules : écriture staff" on public.vehicles
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- documents : le chauffeur voit ses propres papiers et ceux de son véhicule attitré
create policy "documents : lecture" on public.documents
  for select to authenticated using (
    public.is_staff()
    or chauffeur_id = auth.uid()
    or vehicle_id in (select id from public.vehicles where chauffeur_id = auth.uid())
  );
create policy "documents : écriture staff" on public.documents
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- control_items
create policy "points de contrôle : lecture" on public.control_items
  for select to authenticated using (public.app_role() is not null);
create policy "points de contrôle : écriture admin" on public.control_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- control_sheets (insertion uniquement via submit_control_sheet)
create policy "fiches : lecture" on public.control_sheets
  for select to authenticated using (chauffeur_id = auth.uid() or public.is_staff());
create policy "fiches : suppression admin" on public.control_sheets
  for delete to authenticated using (public.is_admin());

create policy "résultats : lecture" on public.control_results
  for select to authenticated using (
    exists (
      select 1 from public.control_sheets s
       where s.id = sheet_id and (s.chauffeur_id = auth.uid() or public.is_staff())
    )
  );

-- interventions
create policy "interventions : lecture" on public.interventions
  for select to authenticated using (demandeur_id = auth.uid() or public.is_staff());
create policy "interventions : création" on public.interventions
  for insert to authenticated with check (
    public.app_role() is not null
    and (
      public.is_staff()
      or (demandeur_id = auth.uid() and statut = 'nouvelle' and fiche_id is null
          and assigne_a is null and reponse is null and cout is null)
    )
  );
create policy "interventions : mise à jour staff" on public.interventions
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "interventions : suppression admin" on public.interventions
  for delete to authenticated using (public.is_admin());

grant select on public.v_echeances to authenticated;

-- ---------------------------------------------------------------------
-- Points de la fiche de contrôle avant départ
-- ---------------------------------------------------------------------
insert into public.control_items (categorie, label_fr, label_ar, ordre) values
  ('Chauffeur & documents', 'EPI du chauffeur (casque, chaussures, vêtements, gants, lunettes)', 'معدات الوقاية الشخصية للسائق (خوذة، أحذية، ملابس، قفازات، نظارات)', 10),
  ('Chauffeur & documents', 'Accès cabine', 'الوصول إلى المقصورة', 20),
  ('Chauffeur & documents', 'Permis de conduire valide', 'رخصة السياقة سارية المفعول', 30),
  ('Chauffeur & documents', 'Carte grise', 'البطاقة الرمادية', 40),
  ('Chauffeur & documents', 'Visite technique', 'الفحص التقني', 50),
  ('Chauffeur & documents', 'Vignette', 'الضريبة', 60),
  ('Chauffeur & documents', 'Assurance', 'التأمين', 70),
  ('Moteur & niveaux', 'Niveau de radiateur', 'فحص مستوى الرادياتير', 80),
  ('Moteur & niveaux', 'Niveau d''huile moteur', 'فحص مستوى زيت المحرك', 90),
  ('Moteur & niveaux', 'Niveau d''huile hydraulique', 'فحص مستوى الزيت الهيدروليكي', 100),
  ('Moteur & niveaux', 'État des flexibles hydrauliques et pneumatiques', 'حالة الخراطيم الهيدروليكية والهوائية', 110),
  ('Roulage & freinage', 'État des freins', 'حالة الفرامل', 120),
  ('Roulage & freinage', 'Disque tachygraphe sans anomalies', 'قرص تاكوغراف', 130),
  ('Roulage & freinage', 'État des pneus', 'حالة الإطارات', 140),
  ('Roulage & freinage', 'Roue de secours', 'العجلة الاحتياطية', 150),
  ('Roulage & freinage', 'Cales roues', 'حواجز العجلات', 160),
  ('Visibilité & éclairage', 'Pare-brise', 'الزجاج الأمامي للشاحنة', 170),
  ('Visibilité & éclairage', 'Essuie-glaces', 'مساحات الزجاج الأمامي', 180),
  ('Visibilité & éclairage', 'Visibilité rétroviseurs, vitres', 'الرؤية: المرايا، النوافذ', 190),
  ('Visibilité & éclairage', 'Feux de circulation avant', 'الإشارات الضوئية الأمامية', 200),
  ('Visibilité & éclairage', 'Feux latéraux', 'الإشارات الضوئية الجانبية', 210),
  ('Visibilité & éclairage', 'Feux arrière', 'الإشارات الضوئية الخلفية', 220),
  ('Visibilité & éclairage', 'Gyrophare', 'الجيروفار', 230),
  ('Équipements de sécurité', 'Ceinture de sécurité', 'حزام الأمان', 240),
  ('Équipements de sécurité', 'Extincteurs', 'طفايات الحريق', 250),
  ('Équipements de sécurité', 'Triangle de détresse', 'مثلث الاستغاثة', 260),
  ('Équipements de sécurité', 'Lampe de poche', 'مصباح يدوي', 270),
  ('Équipements de sécurité', 'Kit absorbant en cas de déversement + pelle', 'مجموعة امتصاص الانسكاب، مجرفة', 280),
  ('Équipements de sécurité', 'Boîte à pharmacie', 'صندوق الدواء', 290),
  ('Équipements de sécurité', 'Clé IVMS', 'مفتاح IVMS', 300),
  ('Général', 'État général du véhicule', 'الحالة العامة للشاحنة', 310);
