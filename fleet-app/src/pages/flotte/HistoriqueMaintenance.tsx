import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import { Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, StatCard, StatusBadge } from '../../components/ui';
import { byId, fetchVehicles, vehicleLabel } from '../../lib/data';
import { daysAgoIso, fmtDate, fmtMoney, fmtNumber, todayIso } from '../../lib/format';
import { INTERVENTION_STATUS, INTERVENTION_TYPE_LABELS, options } from '../../lib/labels';
import { supabase } from '../../lib/supabase';
import type { Intervention, InterventionType, Vehicle } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

/** Historique des interventions de maintenance de toute la flotte. */
export default function HistoriqueMaintenance() {
  const navigate = useNavigate();
  const [debut, setDebut] = useState(daysAgoIso(365));
  const [fin, setFin] = useState(todayIso());
  const [vehicleId, setVehicleId] = useState('');
  const [type, setType] = useState<InterventionType | ''>('');
  const [nature, setNature] = useState<'' | 'preventive' | 'corrective'>('');
  const [enCours, setEnCours] = useState(false);

  const { data, loading, error } = useAsync(async () => {
    const finX = new Date(new Date(fin).getTime() + 864e5).toISOString();
    const [items, vehicles] = await Promise.all([
      supabase.from('interventions').select('*').gte('created_at', debut).lt('created_at', finX).order('created_at', { ascending: false }).limit(5000).then(must),
      fetchVehicles(false),
    ]);
    return { items: items as Intervention[], vehicles, vmap: byId<Vehicle>(vehicles) };
  }, [debut, fin]);

  const list = useMemo(() => (data?.items ?? []).filter((i) =>
    (enCours ? i.statut !== 'rejetee' : i.statut === 'terminee')
    && (!vehicleId || i.vehicle_id === vehicleId) && (!type || i.type === type) && (!nature || i.nature === nature)), [data, vehicleId, type, nature, enCours]);

  const total = list.reduce((s, i) => s + (i.cout ?? 0), 0);
  const immob = list.reduce((s, i) => s + (i.duree_immobilisation_h ?? 0), 0);
  const prev = list.filter((i) => i.nature === 'preventive').length;

  // Synthèse par véhicule.
  const parVehicule = useMemo(() => {
    const m = new Map<string, { v: Vehicle | undefined; nb: number; prev: number; corr: number; cout: number; immob: number; derniere: string }>();
    for (const i of list) {
      const x = m.get(i.vehicle_id) ?? { v: data?.vmap.get(i.vehicle_id), nb: 0, prev: 0, corr: 0, cout: 0, immob: 0, derniere: '' };
      x.nb++;
      if (i.nature === 'preventive') x.prev++;
      else x.corr++;
      x.cout += i.cout ?? 0;
      x.immob += i.duree_immobilisation_h ?? 0;
      const d = i.date_cloture ?? i.created_at;
      if (d > x.derniere) x.derniere = d;
      m.set(i.vehicle_id, x);
    }
    return [...m.entries()].map(([id, x]) => ({ id, ...x })).sort((a, b) => b.cout - a.cout);
  }, [list, data]);

  return (
    <div className="space-y-5">
      <PageHeader title="Historique de maintenance" subtitle="Toutes les interventions réalisées sur la flotte : vidanges, préventif, pannes, pneus, accidents…" />
      <Card>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Du"><Input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} /></Field>
          <Field label="Au"><Input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></Field>
          <Field label="Véhicule">
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Tous</option>
              {data?.vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as InterventionType | '')}>
              <option value="">Tous</option>
              {options(INTERVENTION_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Nature">
            <Select value={nature} onChange={(e) => setNature(e.target.value as typeof nature)}>
              <option value="">Toutes</option>
              <option value="preventive">Préventive</option>
              <option value="corrective">Corrective</option>
            </Select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={enCours} onChange={(e) => setEnCours(e.target.checked)} /> Inclure en cours</label>
        </div>
      </Card>

      {loading ? <Spinner /> : error || !data ? <ErrorBox>{error}</ErrorBox> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Interventions" value={list.length} tone="blue" />
            <StatCard label="Coût total" value={fmtMoney(total)} hint={parVehicule.length ? `${fmtMoney(total / parVehicule.length)} / véhicule` : undefined} />
            <StatCard label="Immobilisation" value={`${fmtNumber(immob, 1)} h`} tone={immob ? 'amber' : 'green'} />
            <StatCard label="Part préventive" value={list.length ? `${fmtNumber((100 * prev) / list.length, 0)} %` : '—'} tone="green" hint={`${prev} préventive(s) · ${list.length - prev} corrective(s)`} />
          </div>

          <Card title="Par véhicule">
            <DataTable rows={parVehicule} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/vehicules/${r.id}`)} exportName="maintenance-par-vehicule" columns={[
              { key: 'vehicule', label: 'Véhicule', value: (r) => vehicleLabel(r.v), render: (r) => <span className="font-semibold text-sky-700">{vehicleLabel(r.v)}</span> },
              { key: 'nb', label: 'Interventions', value: (r) => r.nb },
              { key: 'prev', label: 'Préventives', value: (r) => r.prev },
              { key: 'corr', label: 'Correctives', value: (r) => r.corr },
              { key: 'cout', label: 'Coût', value: (r) => r.cout, render: (r) => fmtMoney(r.cout) },
              { key: 'immob', label: 'Immobilisation (h)', value: (r) => r.immob, render: (r) => fmtNumber(r.immob, 1) },
              { key: 'derniere', label: 'Dernière', value: (r) => r.derniere, render: (r) => fmtDate(r.derniere) },
            ]} />
          </Card>

          <Card title="Détail des interventions">
            <DataTable rows={list} rowKey={(i) => i.id} exportName="historique-maintenance"
              onRowClick={(i) => navigate(`/interventions?id=${i.id}`)}
              columns={[
                { key: 'date', label: 'Date', value: (i) => i.date_cloture ?? i.created_at, render: (i) => fmtDate(i.date_cloture ?? i.created_at) },
                { key: 'vehicule', label: 'Véhicule', className: 'whitespace-nowrap', value: (i) => vehicleLabel(data.vmap.get(i.vehicle_id)), render: (i) => <Link className="text-sky-700 underline" to={`/vehicules/${i.vehicle_id}`} onClick={(e) => e.stopPropagation()}>{vehicleLabel(data.vmap.get(i.vehicle_id))}</Link> },
                { key: 'type', label: 'Type', value: (i) => INTERVENTION_TYPE_LABELS[i.type] },
                { key: 'nature', label: 'Nature', value: (i) => (i.nature === 'preventive' ? 'Préventive' : 'Corrective') },
                { key: 'titre', label: 'Objet', render: (i) => <><b>{i.titre}</b>{i.description && <span className="block max-w-xs truncate text-xs text-slate-500">{i.description}</span>}</>, value: (i) => i.titre },
                { key: 'cause', label: 'Cause', value: (i) => i.cause ?? '' },
                { key: 'travaux', label: 'Travaux effectués', value: (i) => i.reponse ?? '', render: (i) => <span className="block max-w-xs whitespace-pre-line text-xs">{i.reponse ?? '—'}</span> },
                { key: 'intervenant', label: 'Intervenant', value: (i) => i.assigne_a ?? '' },
                { key: 'compteur', label: 'Compteur', value: (i) => i.compteur ?? '', render: (i) => (i.compteur != null ? `${fmtNumber(i.compteur)} ${data.vmap.get(i.vehicle_id)?.unite_compteur ?? ''}` : '—') },
                { key: 'immob', label: 'Immob. (h)', value: (i) => i.duree_immobilisation_h ?? '' },
                { key: 'cout', label: 'Coût', value: (i) => i.cout ?? '', render: (i) => fmtMoney(i.cout) },
                { key: 'statut', label: 'Statut', value: (i) => INTERVENTION_STATUS[i.statut][0], render: (i) => <StatusBadge map={INTERVENTION_STATUS} value={i.statut} /> },
              ]} />
          </Card>
        </>
      )}
    </div>
  );
}
