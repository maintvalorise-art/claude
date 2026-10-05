-- =====================================================================
-- RÉINITIALISATION : supprime toutes les tables de l'application.
-- À exécuter UNIQUEMENT si une ancienne version a déjà été installée,
-- AVANT de relancer migrations/20261002000000_init.sql.
-- Les comptes de connexion (Authentication) sont conservés.
-- ⚠️ Toutes les données de l'application sont effacées.
-- =====================================================================
drop trigger if exists on_auth_user_created on auth.users;

drop view if exists public.v_alertes, public.v_da_delais, public.v_fournisseurs_score, public.v_pleins,
  public.v_plans_maintenance, public.v_echeances cascade;

drop table if exists
  public.inventaire_lignes, public.inventaires, public.mouvements_stock, public.trajets,
  public.mouvements_bennes, public.bennes, public.clients, public.pleins, public.accidents,
  public.control_results, public.control_sheets, public.control_items, public.interventions,
  public.prix_historique, public.evaluations_fournisseurs, public.da_historique, public.devis,
  public.da_lignes, public.demandes_achat, public.articles, public.pneus, public.plans_maintenance,
  public.documents, public.vehicles, public.contrats_fournisseurs, public.fournisseurs,
  public.audit_log, public.compteurs, public.parametres, public.profiles cascade;

drop function if exists
  public.handle_new_user, public.app_role, public.has_role, public.is_admin, public.is_staff,
  public.can_request_purchase, public.param, public.next_numero, public.audit_trigger,
  public.touch_updated_at, public.interventions_before, public.interventions_after,
  public.interventions_touch, public.interventions_vehicle_status, public.bump_compteur,
  public.pleins_after, public.trajets_after, public.accidents_before, public.accidents_after,
  public.mouvements_bennes_after, public.mouvements_stock_before, public.mouvements_stock_after,
  public.list_drivers, public.vehicle_last_driver, public.submit_control_sheet,
  public.creer_demande_achat, public.da_action, public.demarrer_inventaire,
  public.cloturer_inventaire, public.kpis cascade;

drop type if exists public.user_role, public.vehicle_type, public.vehicle_status, public.document_type,
  public.intervention_type, public.intervention_priority, public.intervention_status cascade;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    drop policy if exists "accidents photos insert" on storage.objects;
    drop policy if exists "accidents photos select" on storage.objects;
  end if;
end;
$$;
