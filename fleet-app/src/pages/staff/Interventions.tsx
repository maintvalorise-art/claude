import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import InterventionRequestForm from '../../components/InterventionRequestForm';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea } from '../../components/ui';
import { fetchVehicles } from '../../lib/data';
import { fmtDateTime, fmtMoney, fmtNumber } from '../../lib/format';
import { INTERVENTION_STATUS, INTERVENTION_TYPE_LABELS, PRIORITY } from '../../lib/labels';
import { fetchProfiles } from '../../lib/staff';
import { errorMessage, supabase } from '../../lib/supabase';
import type { Intervention, InterventionStatus, InterventionType, Priority, Vehicle } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

const PRIO_ORDER: Record<Priority, number> = { urgente: 0, haute: 1, normale: 2, basse: 3 };

export default function Interventions() {
  const [params, setParams] = useSearchParams();
  const [statut, setStatut] = useState<'ouvertes' | InterventionStatus | ''>('ouvertes');
  const [type, setType] = useState<InterventionType | ''>('');
  const [vehicleId, setVehicleId] = useState('');
  const [creating, setCreating] = useState(false);
  const selectedId = params.get('id');

  const { data, loading, error, reload } = useAsync(async () => {
    const [items, vehicles, profiles] = await Promise.all([
      supabase.from('interventions').select('*').order('created_at', { ascending: false }).limit(500).then(must),
      fetchVehicles(false),
      fetchProfiles(),
    ]);
    return {
      items: items as Intervention[],
      vehicles,
      vmap: new Map(vehicles.map((v) => [v.id, v])),
      names: new Map(profiles.map((p) => [p.id, p.full_name])),
    };
  });

  const list = useMemo(() => {
    if (!data) return [];
    return data.items
      .filter(
        (i) =>
          (statut === '' || (statut === 'ouvertes' ? i.statut === 'nouvelle' || i.statut === 'en_cours' : i.statut === statut)) &&
          (!type || i.type === type) &&
          (!vehicleId || i.vehicle_id === vehicleId),
      )
      .sort((a, b) =>
        statut === 'ouvertes'
          ? Number(b.vehicule_immobilise) - Number(a.vehicule_immobilise) || PRIO_ORDER[a.priorite] - PRIO_ORDER[b.priorite] || b.created_at.localeCompare(a.created_at)
          : b.created_at.localeCompare(a.created_at),
      );
  }, [data, statut, type, vehicleId]);

  const selected = data?.items.find((i) => i.id === selectedId);
  const close = () => setParams({}, { replace: true });

  return (
    <div>
      <PageHeader
        title="Demandes d'intervention"
        subtitle="Vidanges, pannes et anomalies remontées par les chauffeurs"
        actions={<Button onClick={() => setCreating(true)}>+ Nouvelle intervention</Button>}
      />
      <Card>
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <Select value={statut} onChange={(e) => setStatut(e.target.value as typeof statut)}>
            <option value="ouvertes">Ouvertes (nouvelles + en cours)</option>
            <option value="">Toutes</option>
            {(Object.keys(INTERVENTION_STATUS) as InterventionStatus[]).map((s) => <option key={s} value={s}>{INTERVENTION_STATUS[s][0]}</option>)}
          </Select>
          <Select value={type} onChange={(e) => setType(e.target.value as InterventionType | '')}>
            <option value="">Tous les types</option>
            {(Object.keys(INTERVENTION_TYPE_LABELS) as InterventionType[]).map((t) => <option key={t} value={t}>{INTERVENTION_TYPE_LABELS[t]}</option>)}
          </Select>
          <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Tous les véhicules</option>
            {data?.vehicles.map((v) => <option key={v.id} value={v.id}>{v.matricule}</option>)}
          </Select>
        </div>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : list.length === 0 ? <Empty>Aucune demande.</Empty> : (
          <Table head={['N°', 'Date', 'Véhicule', 'Objet', 'Demandeur', 'Priorité', 'Statut']}>
            {list.map((i) => (
              <tr key={i.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setParams({ id: i.id })}>
                <Td>{i.numero}</Td>
                <Td className="whitespace-nowrap">{fmtDateTime(i.created_at)}</Td>
                <Td className="font-medium">{data!.vmap.get(i.vehicle_id)?.matricule}</Td>
                <Td>
                  <div className="font-medium">{i.titre}</div>
                  <div className="text-xs text-slate-500">{INTERVENTION_TYPE_LABELS[i.type]}</div>
                </Td>
                <Td>{i.demandeur_id ? data!.names.get(i.demandeur_id) : '—'}</Td>
                <Td className="whitespace-nowrap">
                  <StatusBadge map={PRIORITY} value={i.priorite} /> {i.vehicule_immobilise && <Badge tone="red">Immobilisé</Badge>}
                </Td>
                <Td><StatusBadge map={INTERVENTION_STATUS} value={i.statut} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={!!selected} onClose={close} title={selected ? `Intervention N° ${selected.numero}` : ''} wide>
        {selected && data && (
          <ManageIntervention
            key={selected.id}
            item={selected}
            vehicle={data.vmap.get(selected.vehicle_id)!}
            demandeur={selected.demandeur_id ? data.names.get(selected.demandeur_id) : undefined}
            onDone={() => { close(); void reload(); }}
          />
        )}
      </Modal>
      <Modal open={creating} onClose={() => setCreating(false)} title="Nouvelle intervention">
        {data && <InterventionRequestForm vehicles={data.vehicles.filter((v) => v.actif)} onDone={() => { setCreating(false); void reload(); }} />}
      </Modal>
    </div>
  );
}

function ManageIntervention({ item, vehicle, demandeur, onDone }: { item: Intervention; vehicle: Vehicle; demandeur?: string; onDone: () => void }) {
  const [statut, setStatut] = useState(item.statut);
  const [priorite, setPriorite] = useState(item.priorite);
  const [assigne, setAssigne] = useState(item.assigne_a ?? '');
  const [reponse, setReponse] = useState(item.reponse ?? '');
  const [cout, setCout] = useState(item.cout?.toString() ?? '');
  const [vehStatut, setVehStatut] = useState<'' | 'disponible' | 'en_maintenance' | 'en_panne'>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (statut === 'en_cours' && vehicle.statut === 'en_panne') setVehStatut('en_maintenance');
    else if ((statut === 'terminee' || statut === 'rejetee') && ['en_panne', 'en_maintenance'].includes(vehicle.statut)) setVehStatut('disponible');
    else setVehStatut('');
  }, [statut, vehicle.statut]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from('interventions')
        .update({ statut, priorite, assigne_a: assigne.trim() || null, reponse: reponse.trim() || null, cout: cout ? Number(cout) : null })
        .eq('id', item.id);
      if (err) throw err;
      if (vehStatut) {
        const { error: err2 } = await supabase.from('vehicles').update({ statut: vehStatut }).eq('id', vehicle.id);
        if (err2) throw err2;
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
          <Link to={`/vehicules/${vehicle.id}`} className="font-semibold text-sky-700 hover:underline">{vehicle.matricule}</Link>
          <span>·</span>
          <span>{INTERVENTION_TYPE_LABELS[item.type]}</span>
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Statut">
          <Select value={statut} onChange={(e) => setStatut(e.target.value as InterventionStatus)}>
            {(Object.keys(INTERVENTION_STATUS) as InterventionStatus[]).map((s) => <option key={s} value={s}>{INTERVENTION_STATUS[s][0]}</option>)}
          </Select>
        </Field>
        <Field label="Priorité">
          <Select value={priorite} onChange={(e) => setPriorite(e.target.value as Priority)}>
            {(Object.keys(PRIORITY) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY[p][0]}</option>)}
          </Select>
        </Field>
        <Field label="Pris en charge par" hint="Mécanicien, garage…"><Input value={assigne} onChange={(e) => setAssigne(e.target.value)} /></Field>
        <Field label="Coût (DH)"><Input type="number" min={0} step="0.01" value={cout} onChange={(e) => setCout(e.target.value)} /></Field>
      </div>
      <Field label="Réponse / travaux effectués" hint="Visible par le chauffeur"><Textarea value={reponse} onChange={(e) => setReponse(e.target.value)} /></Field>
      <Field label={`Statut du véhicule (actuellement : ${vehicle.statut.replace('_', ' ')})`}>
        <Select value={vehStatut} onChange={(e) => setVehStatut(e.target.value as typeof vehStatut)}>
          <option value="">Ne pas changer</option>
          <option value="disponible">Disponible</option>
          <option value="en_maintenance">En maintenance</option>
          <option value="en_panne">En panne</option>
        </Select>
      </Field>
      {item.type === 'vidange' && statut === 'terminee' && (
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          Pensez à mettre à jour la prochaine vidange depuis la fiche du véhicule (bouton « Vidange effectuée »).
        </p>
      )}
      <ErrorBox>{error}</ErrorBox>
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button>
      </div>
      {item.cout != null && <p className="text-right text-xs text-slate-500">Coût enregistré : {fmtMoney(item.cout)}</p>}
    </form>
  );
}
