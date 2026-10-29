-- =====================================================================
-- Gestion de stock : bons de réception / de livraison numérotés et
-- emplacements du magasin (racks A à G, 4 étages).
-- Script sans risque : il n'efface rien et peut être relancé.
-- =====================================================================

-- Bon de réception (BR-AAAA-NNNN) ou de livraison / sortie (BL-AAAA-NNNN).
create table if not exists public.bons_stock (
  id               uuid primary key default gen_random_uuid(),
  numero           text not null unique,
  type             text not null check (type in ('reception', 'livraison')),
  date_bon         date not null default current_date,
  tiers            text,   -- fournisseur (réception) ou destinataire (livraison)
  reference_tiers  text,   -- n° du BL ou de la facture du fournisseur
  vehicle_id       uuid references public.vehicles (id),
  demandeur        text,
  commentaire      text,
  auteur_id        uuid references public.profiles (id) default auth.uid(),
  created_at       timestamptz not null default now()
);
create index if not exists bons_stock_date_idx on public.bons_stock (date_bon desc);

alter table public.mouvements_stock add column if not exists bon_id uuid references public.bons_stock (id);
create index if not exists mouvements_stock_bon_idx on public.mouvements_stock (bon_id);

-- Emplacement d'un article : "A-2-3" = rack A, étage 2 (1 = en bas), case 3.
-- Racks le long des murs du magasin : nombre de cases par étage de chaque rack.
insert into public.parametres (cle, valeur, libelle) values
  ('magasin_cases_A', 6, 'Magasin : nombre de cases par étage du rack A (mur de l''entrée, à gauche)'),
  ('magasin_cases_B', 4, 'Magasin : nombre de cases par étage du rack B (mur de gauche)'),
  ('magasin_cases_C', 5, 'Magasin : nombre de cases par étage du rack C (mur du fond, à gauche)'),
  ('magasin_cases_D', 8, 'Magasin : nombre de cases par étage du rack D (mur du fond, à droite)'),
  ('magasin_cases_E', 4, 'Magasin : nombre de cases par étage du rack E (mur de droite)'),
  ('magasin_cases_F', 4, 'Magasin : nombre de cases par étage du rack F (mur de l''entrée, au bout à droite)'),
  ('magasin_cases_G', 3, 'Magasin : nombre de cases par étage du rack G (mur de l''entrée, à droite de la porte)')
on conflict (cle) do nothing;
-- Réglage unique de la première version, remplacé par un réglage par rack.
delete from public.parametres where cle = 'magasin_cases_par_etage';

-- Crée le bon et tous ses mouvements en une seule opération : si une ligne
-- est refusée (stock insuffisant…), rien n'est enregistré.
create or replace function public.creer_bon_stock(p_type text, p_entete jsonb, p_lignes jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_vehicle uuid := nullif(p_entete ->> 'vehicle_id', '')::uuid;
  v_motif text := coalesce(nullif(p_entete ->> 'motif', ''), 'consommation');
  l jsonb;
begin
  if not public.has_role('admin', 'magasinier') then
    raise exception 'Accès refusé : réservé au magasin';
  end if;
  if p_type not in ('reception', 'livraison') then
    raise exception 'Type de bon inconnu : %', p_type;
  end if;
  if p_lignes is null or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Ajoutez au moins un article au bon';
  end if;
  if p_type = 'livraison' and v_motif not in ('reparation', 'preventif', 'consommation', 'autre') then
    raise exception 'Motif de sortie invalide : %', v_motif;
  end if;

  insert into public.bons_stock (numero, type, date_bon, tiers, reference_tiers, vehicle_id, demandeur, commentaire, auteur_id)
  values (public.next_numero(case p_type when 'reception' then 'BR' else 'BL' end), p_type,
          coalesce(nullif(p_entete ->> 'date_bon', '')::date, current_date),
          nullif(trim(p_entete ->> 'tiers'), ''), nullif(trim(p_entete ->> 'reference_tiers'), ''),
          v_vehicle, nullif(trim(p_entete ->> 'demandeur'), ''), nullif(trim(p_entete ->> 'commentaire'), ''),
          auth.uid())
  returning id into v_id;

  for l in select * from jsonb_array_elements(p_lignes) loop
    if coalesce((l ->> 'quantite')::numeric, 0) <= 0 then
      raise exception 'Quantité invalide sur une ligne du bon';
    end if;
    insert into public.mouvements_stock (article_id, type, quantite, prix_unitaire, vehicle_id, equipement, demandeur,
                                         motif, auteur_id, commentaire, bon_id)
    values ((l ->> 'article_id')::uuid,
            case p_type when 'reception' then 'entree' else 'sortie' end,
            (l ->> 'quantite')::numeric,
            nullif(l ->> 'prix_unitaire', '')::numeric,
            case p_type when 'livraison' then v_vehicle end,
            case p_type when 'livraison' then nullif(trim(p_entete ->> 'tiers'), '') end,
            nullif(trim(p_entete ->> 'demandeur'), ''),
            case p_type when 'reception' then 'reception' else v_motif end,
            auth.uid(), nullif(trim(l ->> 'commentaire'), ''), v_id);
    -- À la réception, la pièce est rangée à l'emplacement indiqué.
    if p_type = 'reception' and nullif(l ->> 'emplacement', '') is not null then
      update public.articles set emplacement = l ->> 'emplacement'
       where id = (l ->> 'article_id')::uuid and emplacement is distinct from l ->> 'emplacement';
    end if;
  end loop;
  return v_id;
end;
$$;
grant execute on function public.creer_bon_stock(text, jsonb, jsonb) to authenticated;

alter table public.bons_stock enable row level security;
grant select on public.bons_stock to authenticated;
drop policy if exists bons_stock_select on public.bons_stock;
create policy bons_stock_select on public.bons_stock for select to authenticated
  using (public.has_role('admin', 'direction', 'magasinier', 'acheteur', 'responsable_flotte'));
-- Pas d'insertion directe ni de suppression : uniquement via creer_bon_stock.

drop trigger if exists audit_bons_stock on public.bons_stock;
create trigger audit_bons_stock after insert or update on public.bons_stock
  for each row execute function public.audit_trigger();

notify pgrst, 'reload schema';
