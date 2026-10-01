-- =====================================================================
-- Demandes d'Achat – Procédure PR-ACH-001
-- Schéma Supabase : comptes (demandeur / admin), demandes, suivi, notifications.
-- À exécuter en une fois dans : Supabase > SQL Editor > New query > Run.
-- Le script peut être relancé sans erreur.
-- =====================================================================

create extension if not exists pgcrypto;

-- Si vous aviez exécuté la toute première version de test (tables offres / historique),
-- décommentez la ligne suivante pour repartir d'une base propre (supprime les données de test) :
-- drop table if exists public.historique, public.offres, public.demandes cascade;

-- ---------------------------------------------------------------------
-- 1. Profils utilisateurs (créés automatiquement à l'inscription)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  nom         text,
  service     text,
  role        text not null default 'demandeur' check (role in ('demandeur','admin')),
  actif       boolean not null default true,
  created_at  timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and actif);
$$;

create or replace function public.is_actif() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and actif);
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nom, service)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'nom', ''), split_part(new.email, '@', 1)),
          nullif(new.raw_user_meta_data->>'service', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Un utilisateur ne peut pas changer lui-même son rôle, son statut actif ou son email.
-- (auth.uid() est vide dans le SQL Editor : l'administrateur de la base peut tout modifier.)
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role  := old.role;
    new.actif := old.actif;
    new.email := old.email;
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------------
-- 2. Demandes d'achat
-- ---------------------------------------------------------------------
create sequence if not exists public.da_numero_seq;

create table if not exists public.demandes (
  id                   uuid primary key default gen_random_uuid(),
  numero               text unique,
  user_id              uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  date_envoi           timestamptz,

  -- Fiche de demande (rempli par le demandeur)
  demandeur_nom        text,
  service              text,
  centre_cout          text,
  categorie            text,
  date_souhaitee       date,
  urgence              text not null default 'Normal' check (urgence in ('Normal','Urgent','Critique')),
  impact               text check (impact in ('Production','Client','Sécurité')),
  motif                text,
  fournisseur_suggere  text,
  marque               text,
  modele               text,
  pieces_jointes       text,
  stock_verifie        boolean not null default false,
  commandes_verifiees  boolean not null default false,
  lignes               jsonb not null default '[]'::jsonb,   -- [{designation, reference, quantite, unite, prix_unitaire}]
  montant_estime       numeric not null default 0,

  -- Traitement (rempli par l'admin)
  statut               text not null default 'brouillon'
                       check (statut in ('brouillon','en_attente','en_cours','validee','refusee')),
  commentaire_admin    text,
  traite_par           text,
  traite_le            timestamptz,

  finance_statut       text not null default 'en_attente'
                       check (finance_statut in ('en_attente','validee','refusee','non_requise')),
  finance_commentaire  text,
  finance_par          text,
  finance_le           timestamptz,

  bc_numero            text,
  fournisseur_retenu   text,
  montant_reel         numeric,

  reception_statut     text not null default 'en_attente'
                       check (reception_statut in ('en_attente','partielle','recue','non_conforme')),
  reception_date       date,
  reception_remarque   text,
  reception_par        text
);

create index if not exists demandes_user_idx   on public.demandes(user_id);
create index if not exists demandes_statut_idx on public.demandes(statut);

create or replace function public.statut_label(s text) returns text language sql immutable as $$
  select case s
    when 'brouillon'    then 'Brouillon'
    when 'en_attente'   then 'En attente'
    when 'en_cours'     then 'En cours de traitement'
    when 'validee'      then 'Validée'
    when 'refusee'      then 'Refusée'
    when 'non_requise'  then 'Non requise'
    when 'partielle'    then 'Réception partielle'
    when 'recue'        then 'Reçue'
    when 'non_conforme' then 'Non conforme'
    else s end;
$$;

-- Règles avant écriture : numérotation, montant, protections des champs admin.
create or replace function public.demandes_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean := public.is_admin();
  v_user  boolean := auth.uid() is not null;
  v_nom   text;
begin
  select nom into v_nom from public.profiles where id = auth.uid();

  if tg_op = 'INSERT' then
    if v_user and not v_admin then new.user_id := auth.uid(); end if;
    if new.numero is null then
      new.numero := 'DA-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.da_numero_seq')::text, 4, '0');
    end if;
    if new.demandeur_nom is null then
      select nom into new.demandeur_nom from public.profiles where id = new.user_id;
    end if;
  end if;

  -- Demandeur : il ne peut créer / modifier que des brouillons, puis envoyer.
  if v_user and not v_admin then
    if tg_op = 'UPDATE' then
      if old.statut <> 'brouillon' then
        raise exception 'Cette demande a déjà été envoyée : elle ne peut plus être modifiée.';
      end if;
      new.user_id := old.user_id;
      new.numero  := old.numero;
    end if;
    if new.statut not in ('brouillon','en_attente') then
      raise exception 'Seul un administrateur peut changer le statut d''une demande.';
    end if;
    -- Champs réservés à l'admin : remis à leur valeur précédente / par défaut
    if tg_op = 'INSERT' then
      new.commentaire_admin := null; new.traite_par := null; new.traite_le := null;
      new.finance_statut := 'en_attente'; new.finance_commentaire := null; new.finance_par := null; new.finance_le := null;
      new.bc_numero := null; new.fournisseur_retenu := null; new.montant_reel := null;
      new.reception_statut := 'en_attente'; new.reception_date := null; new.reception_remarque := null; new.reception_par := null;
    else
      new.commentaire_admin := old.commentaire_admin; new.traite_par := old.traite_par; new.traite_le := old.traite_le;
      new.finance_statut := old.finance_statut; new.finance_commentaire := old.finance_commentaire;
      new.finance_par := old.finance_par; new.finance_le := old.finance_le;
      new.bc_numero := old.bc_numero; new.fournisseur_retenu := old.fournisseur_retenu; new.montant_reel := old.montant_reel;
      new.reception_statut := old.reception_statut; new.reception_date := old.reception_date;
      new.reception_remarque := old.reception_remarque; new.reception_par := old.reception_par;
    end if;
  end if;

  -- Admin : traçabilité automatique de qui a traité quoi
  if tg_op = 'UPDATE' and v_admin then
    if new.statut is distinct from old.statut or new.commentaire_admin is distinct from old.commentaire_admin then
      new.traite_par := v_nom; new.traite_le := now();
    end if;
    if new.statut = 'refusee' and old.statut <> 'refusee' and coalesce(trim(new.commentaire_admin), '') = '' then
      raise exception 'Un commentaire est obligatoire pour refuser une demande.';
    end if;
    if new.finance_statut is distinct from old.finance_statut then
      new.finance_par := v_nom; new.finance_le := now();
    end if;
    if new.reception_statut is distinct from old.reception_statut then
      new.reception_par := v_nom;
    end if;
  end if;

  -- Montant estimé = somme(quantité × prix unitaire)
  select coalesce(sum(
           coalesce(nullif(l->>'quantite', '')::numeric, 0) * coalesce(nullif(l->>'prix_unitaire', '')::numeric, 0)), 0)
    into new.montant_estime
    from jsonb_array_elements(coalesce(new.lignes, '[]'::jsonb)) l;

  if new.statut = 'en_attente' and (tg_op = 'INSERT' or old.statut = 'brouillon') then
    if jsonb_array_length(new.lignes) = 0 then
      raise exception 'Ajoutez au moins un article avant d''envoyer la demande.';
    end if;
    new.date_envoi := now();
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_demandes_before_write on public.demandes;
create trigger trg_demandes_before_write
  before insert or update on public.demandes
  for each row execute function public.demandes_before_write();

-- ---------------------------------------------------------------------
-- 3. Suivi (historique) et notifications
-- ---------------------------------------------------------------------
create table if not exists public.suivi (
  id          uuid primary key default gen_random_uuid(),
  demande_id  uuid not null references public.demandes(id) on delete cascade,
  created_at  timestamptz not null default now(),
  auteur_nom  text,
  type        text not null,          -- creation | envoi | statut | commentaire | finance | reception
  ancien      text,
  nouveau     text,
  commentaire text
);
create index if not exists suivi_demande_idx on public.suivi(demande_id);

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  demande_id  uuid references public.demandes(id) on delete cascade,
  created_at  timestamptz not null default now(),
  titre       text not null,
  message     text,
  lu          boolean not null default false
);
create index if not exists notifications_user_idx on public.notifications(user_id, lu);

create or replace function public.demandes_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_nom text;
  v_envoi boolean;
begin
  select nom into v_nom from public.profiles where id = auth.uid();
  v_nom := coalesce(v_nom, 'Système');

  if tg_op = 'INSERT' then
    insert into public.suivi(demande_id, auteur_nom, type, nouveau, commentaire)
    values (new.id, v_nom, 'creation', new.statut, 'Demande créée');
  end if;

  v_envoi := new.statut = 'en_attente' and (tg_op = 'INSERT' or old.statut = 'brouillon');

  if v_envoi then
    insert into public.suivi(demande_id, auteur_nom, type, ancien, nouveau, commentaire)
    values (new.id, v_nom, 'envoi', 'brouillon', 'en_attente', 'Demande validée et envoyée à l''administration');
    insert into public.notifications(user_id, demande_id, titre, message)
    select p.id, new.id,
           'Nouvelle demande ' || new.numero,
           coalesce(new.demandeur_nom, '') || ' (' || coalesce(new.service, '—') || ')' ||
           case when new.urgence <> 'Normal' then ' — ' || upper(new.urgence) else '' end
      from public.profiles p where p.role = 'admin' and p.actif;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.statut is distinct from old.statut and old.statut <> 'brouillon' then
      insert into public.suivi(demande_id, auteur_nom, type, ancien, nouveau, commentaire)
      values (new.id, v_nom, 'statut', old.statut, new.statut, new.commentaire_admin);
      insert into public.notifications(user_id, demande_id, titre, message)
      values (new.user_id, new.id, new.numero || ' : ' || public.statut_label(new.statut), new.commentaire_admin);
    elsif new.commentaire_admin is distinct from old.commentaire_admin and coalesce(new.commentaire_admin, '') <> '' then
      insert into public.suivi(demande_id, auteur_nom, type, commentaire)
      values (new.id, v_nom, 'commentaire', new.commentaire_admin);
      insert into public.notifications(user_id, demande_id, titre, message)
      values (new.user_id, new.id, new.numero || ' : nouveau commentaire', new.commentaire_admin);
    end if;

    if new.finance_statut is distinct from old.finance_statut then
      insert into public.suivi(demande_id, auteur_nom, type, ancien, nouveau, commentaire)
      values (new.id, v_nom, 'finance', old.finance_statut, new.finance_statut, new.finance_commentaire);
      insert into public.notifications(user_id, demande_id, titre, message)
      values (new.user_id, new.id, new.numero || ' : Finance — ' || public.statut_label(new.finance_statut), new.finance_commentaire);
    end if;

    if new.reception_statut is distinct from old.reception_statut then
      insert into public.suivi(demande_id, auteur_nom, type, ancien, nouveau, commentaire)
      values (new.id, v_nom, 'reception', old.reception_statut, new.reception_statut, new.reception_remarque);
      insert into public.notifications(user_id, demande_id, titre, message)
      values (new.user_id, new.id, new.numero || ' : Réception — ' || public.statut_label(new.reception_statut), new.reception_remarque);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_demandes_after_write on public.demandes;
create trigger trg_demandes_after_write
  after insert or update on public.demandes
  for each row execute function public.demandes_after_write();

-- ---------------------------------------------------------------------
-- 4. Sécurité : Row Level Security
--    Demandeur : voit et gère uniquement SES demandes.
--    Admin     : voit et traite toutes les demandes.
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.demandes      enable row level security;
alter table public.suivi         enable row level security;
alter table public.notifications enable row level security;

-- Nettoyage des politiques de la version de test précédente
drop policy if exists "test_acces_ouvert" on public.demandes;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists demandes_select on public.demandes;
drop policy if exists demandes_insert on public.demandes;
drop policy if exists demandes_update on public.demandes;
drop policy if exists demandes_delete on public.demandes;
create policy demandes_select on public.demandes for select to authenticated
  using ((user_id = auth.uid() and public.is_actif()) or public.is_admin());
create policy demandes_insert on public.demandes for insert to authenticated
  with check ((user_id = auth.uid() and public.is_actif()) or public.is_admin());
create policy demandes_update on public.demandes for update to authenticated
  using ((user_id = auth.uid() and statut = 'brouillon' and public.is_actif()) or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
create policy demandes_delete on public.demandes for delete to authenticated
  using ((user_id = auth.uid() and statut = 'brouillon') or public.is_admin());

drop policy if exists suivi_select on public.suivi;
create policy suivi_select on public.suivi for select to authenticated
  using (public.is_admin() or exists (select 1 from public.demandes d where d.id = demande_id and d.user_id = auth.uid()));

drop policy if exists notif_select on public.notifications;
drop policy if exists notif_update on public.notifications;
drop policy if exists notif_delete on public.notifications;
create policy notif_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid());
create policy notif_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.demandes, public.profiles, public.notifications to authenticated;
grant select on public.suivi to authenticated;
grant usage on sequence public.da_numero_seq to authenticated;

-- ---------------------------------------------------------------------
-- 5. Notifications en temps réel (cloche dans l'application)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. Premier administrateur
--    1) Créez votre compte depuis l'application (« Créer un compte »).
--    2) Exécutez ensuite cette ligne en remplaçant l'email :
--
--    update public.profiles set role = 'admin' where email = 'votre.email@exemple.com';
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 7. Emails : adresses des administrateurs (utilisée par api/notify.js)
--    Accessible uniquement aux utilisateurs connectés et actifs.
-- ---------------------------------------------------------------------
create or replace function public.emails_admins() returns setof text
language sql stable security definer set search_path = public as $$
  select email from public.profiles
   where role = 'admin' and actif and email is not null
     and (public.is_actif() or auth.role() = 'service_role');
$$;
revoke execute on function public.emails_admins() from public, anon;
grant execute on function public.emails_admins() to authenticated, service_role;
