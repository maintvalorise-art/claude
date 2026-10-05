import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import InterventionRequestForm from '../../components/InterventionRequestForm';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Textarea } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { byId, fetchArticles, fetchPeople, fetchVehicles, vehicleLabel } from '../../lib/data';
import { fmtDateTime, fmtMoney, fmtNumber } from '../../lib/format';
import { INTERVENTION_STATUS, INTERVENTION_TYPE_LABELS, PRIORITY, options } from '../../lib/labels';
import { can } from '../../lib/roles';
import { errorMessage, supabase } from '../../lib/supabase';
import type { Article, Intervention, InterventionStatus, InterventionType, MouvementStock, Priority, Vehicle } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

const PRIO: Record<Priority, number> = { urgente: 0, haute: 1, normale: 2, basse: 3 };

export default function Interventions() {
  const { profile } = useAuth();
  const gerer = can(profile, 'flotteGerer');
  const [params, setParams] = useSearchParams();
  const [statut, setStatut] = useState<'ouvertes' | InterventionStatus | ''>('ouvertes');
  const [type, setType] = useState<InterventionType | ''>('');
  const [vehicleId, setVehicleId] = useState(params.get('vehicle') ?? '');
  const [creating, setCreating] = useState(false);
  const selectedId = params.get('id');

  const { data, loading, error, reload } = useAsync(async () => {
    const [items, vehicles, people] = await Promise.all([
      supabase.from('interventions').select('*').order('created_at', { ascending: false }).limit(1000).then(must),
      fetchVehicles(false),
      fetchPeople(),
    ]);
    return { items: items as Intervention[], vehicles, vmap: byId(vehicles), names: new Map(people.map((p) => [p.id, p.full_name])) };
  });

  const list = useMemo(() => (data?.items ?? [])
    .filter((i) => (statut === '' || (statut === 'ouvertes' ? ['nouvelle', 'en_cours'].includes(i.statut) : i.statut === statut))
      && (!type || i.type === type) && (!vehicleId || i.vehicle_id === vehicleId))
    .sort((a, b) => (statut === 'ouvertes'
      ? Number(b.vehicule_immobilise) - Number(a.vehicule_immobilise) || PRIO[a.priorite] - PRIO[b.priorite] || b.created_at.localeCompare(a.created_at)
      : b.created_at.localeCompare(a.created_at))), [data, statut, type, vehicleId]);

  const selected = data?.items.find((i) => i.id === selectedId);
  const close = () => setParams(vehicleId ? { vehicle: vehicleId } : {}, { replace: true });

  return (
    <div>
      <PageHeader
        title="Maintenance & demandes d'intervention"
        subtitle="Préventif, correctif, pannes, non-conformités des fiches de contrôle, accidents"
        actions={<Button onClick={() => setCreating(true)}>+ Nouvelle intervention</Button>}
      />
      <Card>
        {loading ? <Spinner /> : error || !data ? <ErrorBox>{error}</ErrorBox> : (
          <DataTable
            rows={list} rowKey={(i) => i.id} exportName="interventions"
            onRowClick={(i) => setParams({ id: i.id, ...(vehicleId ? { vehicle: vehicleId } : {}) })}
            toolbar={
              <>
                <Select className="w-44" value={statut} onChange={(e) => setStatut(e.target.value as typeof statut)}>
                  <option value="ouvertes">Ouvertes</option>
                  <option value="">Toutes</option>
                  {options(INTERVENTION_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <Select className="w-40" value={type} onChange={(e) => setType(e.target.value as InterventionType | '')}>
                  <option value="">Tous types</option>
                  {options(INTERVENTION_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <Select className="w-44" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                  <option value="">Tous véhicules</option>
                  {data.vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
                </Select>
              </>
            }
            columns={[
              { key: 'numero', label: 'N°' },
              { key: 'date', label: 'Date', value: (i) => i.created_at, render: (i) => <span className="whitespace-nowrap">{fmtDateTime(i.created_at)}</span> },
              { key: 'vehicule', label: 'Véhicule', value: (i) => vehicleLabel(data.vmap.get(i.vehicle_id)) },
              { key: 'titre', label: 'Objet', render: (i) => <><b>{i.titre}</b><span className="block text-xs text-slate-500">{INTERVENTION_TYPE_LABELS[i.type]} · {i.nature === 'preventive' ? 'préventive' : 'corrective'}</span></>, value: (i) => i.titre },
              { key: 'demandeur', label: 'Demandeur', value: (i) => (i.demandeur_id ? data.names.get(i.demandeur_id) ?? '' : '') },
              { key: 'priorite', label: 'Priorité', value: (i) => PRIORITY[i.priorite][0], render: (i) => <span className="whitespace-nowrap"><StatusBadge map={PRIORITY} value={i.priorite} /> {i.vehicule_immobilise && <Badge tone="red">Immobilisé</Badge>}</span> },
              { key: 'statut', label: 'Statut', value: (i) => INTERVENTION_STATUS[i.statut][0], render: (i) => <StatusBadge map={INTERVENTION_STATUS} value={i.statut} /> },
              { key: 'cout', label: 'Coût MO', value: (i) => i.cout ?? '', render: (i) => fmtMoney(i.cout) },
            ]}
          />
        )}
      </Card>
      <Modal open={!!selected} onClose={close} title={selected ? `Intervention N° ${selected.numero}` : ''} wide>
        {selected && data && (
          <ManageIntervention key={selected.id} item={selected} vehicle={data.vmap.get(selected.vehicle_id)!} gerer={gerer}
            demandeur={selected.demandeur_id ? data.names.get(selected.demandeur_id) : undefined}
            onDone={() => { close(); void reload(); }} />
        )}
      </Modal>
      <Modal open={creating} onClose={() => setCreating(false)} title="Nouvelle intervention">
        {data && <InterventionRequestForm vehicles={data.vehicles.filter((v) => v.actif)} onDone={() => { setCreating(false); void reload(); }} />}
      </Modal>
    </div>
  );
}

function ManageIntervention({ item, vehicle, demandeur, gerer, onDone }: { item: Intervention; vehicle: Vehicle; demandeur?: string; gerer: boolean; onDone: () => void }) {
  const [f, setF] = useState({
    statut: item.statut, priorite: item.priorite, nature: item.nature, assigne_a: item.assigne_a ?? '', reponse: item.reponse ?? '',
    cause: item.cause ?? '', cout: item.cout?.toString() ?? '', duree: item.duree_immobilisation_h?.toString() ?? '', compteur: item.compteur?.toString() ?? '',
  });
  const [vehStatut, setVehStatut] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: pieces } = useAsync(async () => {
    const [mv, articles] = await Promise.all([
      supabase.from('mouvements_stock').select('*').eq('intervention_id', item.id).then((r) => (r.data ?? []) as MouvementStock[]),
      fetchArticles(false),
    ]);
    return { mv, amap: byId<Article>(articles) };
  }, [item.id]);
  const coutPieces = (pieces?.mv ?? []).reduce((s, m) => s + m.quantite * (m.prix_unitaire ?? 0), 0);

  useEffect(() => {
    if (f.statut === 'en_cours' && vehicle.statut === 'en_panne') setVehStatut('en_maintenance');
    else if (['terminee', 'rejetee'].includes(f.statut) && ['en_panne', 'en_maintenance', 'immobilise'].includes(vehicle.statut)) setVehStatut('disponible');
    else setVehStatut('');
  }, [f.statut, vehicle.statut]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.from('interventions').update({
        statut: f.statut, priorite: f.priorite, nature: f.nature, assigne_a: f.assigne_a.trim() || null, reponse: f.reponse.trim() || null,
        cause: f.cause.trim() || null, cout: f.cout ? Number(f.cout) : null, duree_immobilisation_h: f.duree ? Number(f.duree) : null,
        compteur: f.compteur ? Number(f.compteur) : null,
      }).eq('id', item.id);
      if (err) throw err;
      if (vehStatut) {
        const { error: e2 } = await supabase.from('vehicles').update({ statut: vehStatut }).eq('id', vehicle.id);
        if (e2) throw e2;
      }
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-lg bg-slate-50 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/vehicules/${vehicle.id}`} className="font-semibold text-sky-700 hover:underline">{vehicleLabel(vehicle)}</Link>
          <span>· {INTERVENTION_TYPE_LABELS[item.type]}</span>
          {item.vehicule_immobilise && <Badge tone="red">Véhicule immobilisé</Badge>}
        </div>
        <div className="mt-1 text-lg font-semibold">{item.titre}</div>
        {item.description && <p className="mt-1 whitespace-pre-line">{item.description}</p>}
        <div className="mt-2 text-xs text-slate-500">
          Demandé par {demandeur ?? '—'} le {fmtDateTime(item.created_at)}
          {item.compteur != null && ` · compteur ${fmtNumber(item.compteur)} ${vehicle.unite_compteur}`}
          {item.date_cloture && ` · clôturée le ${fmtDateTime(item.date_cloture)}`}
        </div>
        {item.fiche_id && <Link to={`/fiches/${item.fiche_id}`} className="mt-2 inline-block text-sky-700 underline">Voir la fiche de contrôle</Link>}
      </div>
      {gerer ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Statut"><Select value={f.statut} onChange={(e) => setF({ ...f, statut: e.target.value as InterventionStatus })}>{options(INTERVENTION_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Priorité"><Select value={f.priorite} onChange={(e) => setF({ ...f, priorite: e.target.value as Priority })}>{options(PRIORITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Nature"><Select value={f.nature} onChange={(e) => setF({ ...f, nature: e.target.value as 'preventive' | 'corrective' })}><option value="corrective">Corrective</option><option value="preventive">Préventive</option></Select></Field>
            <Field label="Intervenant (mécanicien, garage)"><Input value={f.assigne_a} onChange={(e) => setF({ ...f, assigne_a: e.target.value })} /></Field>
            <Field label="Coût main-d'œuvre (DH)"><Input type="number" min={0} step="0.01" value={f.cout} onChange={(e) => setF({ ...f, cout: e.target.value })} /></Field>
            <Field label="Immobilisation (heures)"><Input type="number" min={0} step="0.5" value={f.duree} onChange={(e) => setF({ ...f, duree: e.target.value })} /></Field>
            <Field label={`Compteur (${vehicle.unite_compteur})`}><Input type="number" min={0} value={f.compteur} onChange={(e) => setF({ ...f, compteur: e.target.value })} /></Field>
            <Field label="Cause" className="sm:col-span-2"><Input value={f.cause} onChange={(e) => setF({ ...f, cause: e.target.value })} /></Field>
          </div>
          <Field label="Travaux effectués / réponse" hint="Visible par le chauffeur"><Textarea value={f.reponse} onChange={(e) => setF({ ...f, reponse: e.target.value })} /></Field>
          <Field label={`Statut du véhicule (actuellement : ${vehicle.statut.replace('_', ' ')})`}>
            <Select value={vehStatut} onChange={(e) => setVehStatut(e.target.value)}>
              <option value="">Ne pas changer</option>
              <option value="disponible">Disponible</option>
              <option value="en_maintenance">En maintenance</option>
              <option value="en_panne">En panne</option>
              <option value="immobilise">Immobilisé</option>
            </Select>
          </Field>
        </>
      ) : (
        <div className="text-sm">{item.reponse && <p className="whitespace-pre-line">{item.reponse}</p>}</div>
      )}
      {pieces && pieces.mv.length > 0 && (
        <div className="rounded-lg border border-slate-200 p-3 text-sm">
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Pièces sorties du magasin</div>
          {pieces.mv.map((m) => <div key={m.id}>{pieces.amap.get(m.article_id)?.designation} × {fmtNumber(m.quantite)} · {fmtMoney(m.quantite * (m.prix_unitaire ?? 0))}</div>)}
          <div className="mt-1 font-semibold">Total pièces : {fmtMoney(coutPieces)}</div>
        </div>
      )}
      <ErrorBox>{error}</ErrorBox>
      {gerer && <div className="flex justify-end"><Button type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button></div>}
    </form>
  );
}
