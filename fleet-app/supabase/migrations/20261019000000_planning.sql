-- =====================================================================
-- Planning des échéances (papiers, maintenance) + historique de maintenance
-- À exécuter APRÈS 20261002000000_init.sql. Peut être relancé sans risque.
-- =====================================================================

create table if not exists public.planning (
  id           uuid primary key default gen_random_uuid(),
  date_prevue  date not null,
  titre        text not null,
  type         text not null default 'autre' check (type in ('document', 'maintenance', 'autre')),
  document_id  uuid references public.documents (id),
  plan_id      uuid references public.plans_maintenance (id),
  vehicle_id   uuid references public.vehicles (id),
  chauffeur_id uuid references public.profiles (id),
  statut       text not null default 'planifie' check (statut in ('planifie', 'fait', 'annule')),
  notes        text,
  cree_par     uuid references public.profiles (id) default auth.uid(),
  fait_le      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists planning_date_idx on public.planning (date_prevue) where statut = 'planifie';
create index if not exists planning_document_idx on public.planning (document_id);
create index if not exists planning_plan_idx on public.planning (plan_id);

-- Date de réalisation renseignée automatiquement.
create or replace function public.planning_before()
returns trigger language plpgsql as $$
begin
  if new.statut = 'fait' and (tg_op = 'INSERT' or old.statut <> 'fait') then
    new.fait_le := coalesce(new.fait_le, now());
  elsif new.statut <> 'fait' then
    new.fait_le := null;
  end if;
  return new;
end;
$$;
drop trigger if exists planning_before on public.planning;
create trigger planning_before before insert or update on public.planning
  for each row execute function public.planning_before();

drop trigger if exists audit_planning on public.planning;
create trigger audit_planning after insert or update on public.planning
  for each row execute function public.audit_trigger();

-- Un papier renouvelé (l'ancien est archivé) clôture son rendez-vous planifié.
create or replace function public.documents_planning_done()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.archive and not old.archive then
    update public.planning set statut = 'fait' where document_id = new.id and statut = 'planifie';
  end if;
  return new;
end;
$$;
drop trigger if exists documents_planning_done on public.documents;
create trigger documents_planning_done after update on public.documents
  for each row execute function public.documents_planning_done();

-- Une maintenance réalisée (plan remis à zéro) clôture son rendez-vous planifié.
create or replace function public.plans_planning_done()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.derniere_date is distinct from old.derniere_date or new.dernier_compteur is distinct from old.dernier_compteur then
    update public.planning set statut = 'fait' where plan_id = new.id and statut = 'planifie';
  end if;
  return new;
end;
$$;
drop trigger if exists plans_planning_done on public.plans_maintenance;
create trigger plans_planning_done after update on public.plans_maintenance
  for each row execute function public.plans_planning_done();

alter table public.planning enable row level security;
drop policy if exists planning_select on public.planning;
drop policy if exists planning_insert on public.planning;
drop policy if exists planning_update on public.planning;
create policy planning_select on public.planning for select to authenticated
  using (public.has_role('admin', 'direction', 'responsable_flotte'));
create policy planning_insert on public.planning for insert to authenticated
  with check (public.has_role('admin', 'responsable_flotte'));
create policy planning_update on public.planning for update to authenticated
  using (public.has_role('admin', 'responsable_flotte')) with check (public.has_role('admin', 'responsable_flotte'));

-- Alertes : ajoute les rendez-vous du planning et la date planifiée des papiers.
create or replace view public.v_alertes with (security_invoker = true) as
select module, niveau, categorie, ref_id, titre, cible, detail, lien
from (
-- Papiers véhicules / chauffeurs
select 'flotte'::text as module, e.niveau, 'document'::text as categorie, e.id::text as ref_id,
       e.type as titre, coalesce(e.matricule, e.chauffeur_nom) as cible,
       (case when e.jours_restants < 0 then 'Expiré depuis ' || -e.jours_restants || ' j'
             else 'Expire dans ' || e.jours_restants || ' j' end)
         || coalesce(' · planifié le ' || (select to_char(min(pl.date_prevue), 'DD/MM/YYYY') from public.planning pl
                                           where pl.document_id = e.id and pl.statut = 'planifie'), '') as detail,
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
union all
-- Planning : rendez-vous du jour, du lendemain ou en retard
select 'flotte', case when p.date_prevue < current_date then 'urgent' else 'bientot' end,
       'planning', p.id::text, p.titre, coalesce(v.matricule, pr.full_name),
       case when p.date_prevue < current_date then 'Prévu le ' || to_char(p.date_prevue, 'DD/MM/YYYY') || ' (en retard)'
            when p.date_prevue = current_date then 'Aujourd''hui'
            else 'Demain' end,
       '/planning', p.vehicle_id
  from public.planning p
  left join public.vehicles v on v.id = p.vehicle_id
  left join public.profiles pr on pr.id = p.chauffeur_id
 where p.statut = 'planifie' and p.date_prevue <= current_date + 1
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

grant select on public.v_alertes to authenticated;
