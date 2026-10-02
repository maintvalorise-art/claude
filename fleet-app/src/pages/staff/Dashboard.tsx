import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, StatCard, StatusBadge } from '../../components/ui';
import { fetchVehicles } from '../../lib/data';
import { delaiEcheance, fmtDateTime, todayIso } from '../../lib/format';
import { ALERT_LEVEL, DOCUMENT_TYPE_LABELS, INTERVENTION_TYPE_LABELS, PRIORITY } from '../../lib/labels';
import { supabase } from '../../lib/supabase';
import type { ControlSheet, Echeance, Intervention } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

const ORDER = { expire: 0, urgent: 1, bientot: 2, ok: 3 } as const;
const PRIO = { urgente: 0, haute: 1, normale: 2, basse: 3 } as const;

export default function Dashboard() {
  const { data, loading, error } = useAsync(async () => {
    const today = todayIso();
    const [vehicles, ech, inter, sheets] = await Promise.all([
      fetchVehicles(),
      supabase.from('v_echeances').select('*').neq('niveau', 'ok').then(must),
      supabase.from('interventions').select('*').in('statut', ['nouvelle', 'en_cours']).then(must),
      supabase.from('control_sheets').select('*').eq('date_controle', today).then(must),
    ]);
    return { vehicles, ech: ech as Echeance[], inter: inter as Intervention[], sheets: sheets as ControlSheet[] };
  });

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;

  const { vehicles, ech, inter, sheets } = data;
  const vmap = new Map(vehicles.map((v) => [v.id, v]));
  const enPanne = vehicles.filter((v) => v.statut === 'en_panne').length;
  const enMaint = vehicles.filter((v) => v.statut === 'en_maintenance').length;
  const dispo = vehicles.filter((v) => v.statut === 'disponible' || v.statut === 'en_service').length;
  const expired = ech.filter((e) => e.niveau === 'expire').length;
  const checkedToday = new Set(sheets.map((s) => s.vehicle_id));
  const nokToday = sheets.filter((s) => s.nb_nok > 0).length;
  const sansFiche = vehicles.filter((v) => (v.statut === 'en_service' || v.statut === 'disponible') && v.chauffeur_id && !checkedToday.has(v.id));
  const topEch = [...ech].sort((a, b) => ORDER[a.niveau] - ORDER[b.niveau]).slice(0, 10);
  const topInter = [...inter]
    .sort((a, b) => Number(b.vehicule_immobilise) - Number(a.vehicule_immobilise) || PRIO[a.priorite] - PRIO[b.priorite])
    .slice(0, 8);

  return (
    <div className="space-y-5">
      <PageHeader title="Tableau de bord" subtitle={new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Véhicules opérationnels" value={`${dispo} / ${vehicles.length}`} tone="green" />
        <StatCard label="En panne / maintenance" value={`${enPanne} / ${enMaint}`} tone={enPanne ? 'red' : 'gray'} />
        <StatCard label="Demandes ouvertes" value={inter.length} tone={inter.length ? 'amber' : 'gray'} hint={`${inter.filter((i) => i.statut === 'nouvelle').length} nouvelle(s)`} />
        <StatCard label="Papiers expirés" value={expired} tone={expired ? 'red' : 'green'} hint={`${ech.length} échéance(s) à surveiller`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="⚠️ Échéances à traiter" actions={<Link to="/echeances" className="text-sm text-sky-700 hover:underline">Tout voir</Link>}>
          {topEch.length === 0 ? <Empty>Tous les papiers sont à jour 👍</Empty> : (
            <ul className="-my-2 divide-y divide-slate-100">
              {topEch.map((e) => (
                <li key={e.source + e.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <b>{DOCUMENT_TYPE_LABELS[e.type]}</b> · {e.matricule ?? e.chauffeur_nom}
                    <span className="block text-xs text-slate-500">{delaiEcheance(e, e.vehicle_id ? vmap.get(e.vehicle_id)?.unite_compteur : 'km')}</span>
                  </span>
                  <StatusBadge map={ALERT_LEVEL} value={e.niveau} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="🔧 Demandes d'intervention" actions={<Link to="/interventions" className="text-sm text-sky-700 hover:underline">Tout voir</Link>}>
          {topInter.length === 0 ? <Empty>Aucune demande ouverte.</Empty> : (
            <ul className="-my-2 divide-y divide-slate-100">
              {topInter.map((i) => (
                <li key={i.id} className="py-2 text-sm">
                  <Link to={`/interventions?id=${i.id}`} className="flex items-center justify-between gap-2 hover:underline">
                    <span>
                      <b>{vmap.get(i.vehicle_id)?.matricule}</b> · {i.titre}
                      <span className="block text-xs text-slate-500">{INTERVENTION_TYPE_LABELS[i.type]} · {fmtDateTime(i.created_at)}</span>
                    </span>
                    <span className="flex gap-1">
                      {i.vehicule_immobilise && <Badge tone="red">Immobilisé</Badge>}
                      <StatusBadge map={PRIORITY} value={i.priorite} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="✅ Fiches de contrôle aujourd'hui" actions={<Link to="/fiches" className="text-sm text-sky-700 hover:underline">Historique</Link>}>
          <div className="mb-3 flex gap-4 text-sm">
            <span><b>{sheets.length}</b> fiche(s)</span>
            <span className={nokToday ? 'font-semibold text-red-600' : ''}>{nokToday} avec NOK</span>
          </div>
          {sansFiche.length > 0 ? (
            <>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Véhicules attribués sans fiche aujourd'hui</div>
              <div className="flex flex-wrap gap-1">
                {sansFiche.map((v) => (
                  <Link key={v.id} to={`/vehicules/${v.id}`}><Badge tone="amber">{v.matricule}</Badge></Link>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">Tous les véhicules attribués ont leur fiche du jour.</p>
          )}
        </Card>

        <Card title="🚚 Véhicules immobilisés">
          {vehicles.filter((v) => v.statut === 'en_panne' || v.statut === 'en_maintenance').length === 0 ? <Empty>Aucun.</Empty> : (
            <ul className="-my-2 divide-y divide-slate-100">
              {vehicles
                .filter((v) => v.statut === 'en_panne' || v.statut === 'en_maintenance')
                .map((v) => (
                  <li key={v.id} className="flex justify-between py-2 text-sm">
                    <Link to={`/vehicules/${v.id}`} className="font-medium text-sky-700 hover:underline">{v.matricule}</Link>
                    <Badge tone={v.statut === 'en_panne' ? 'red' : 'amber'}>{v.statut === 'en_panne' ? 'En panne' : 'En maintenance'}</Badge>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
