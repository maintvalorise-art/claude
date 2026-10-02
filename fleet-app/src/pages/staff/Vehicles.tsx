import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import VehicleForm from '../../components/VehicleForm';
import { Badge, Button, Card, Empty, ErrorBox, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Td } from '../../components/ui';
import { fetchVehicles } from '../../lib/data';
import { fmtNumber } from '../../lib/format';
import { VEHICLE_STATUS, VEHICLE_TYPE_LABELS } from '../../lib/labels';
import { fetchProfiles } from '../../lib/staff';
import { supabase } from '../../lib/supabase';
import type { Echeance, VehicleStatus, VehicleType } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

export default function Vehicles() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [type, setType] = useState<VehicleType | ''>('');
  const [statut, setStatut] = useState<VehicleStatus | ''>('');
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);

  const { data, loading, error } = useAsync(async () => {
    const [vehicles, profiles, ech] = await Promise.all([
      fetchVehicles(false),
      fetchProfiles(),
      supabase.from('v_echeances').select('vehicle_id, niveau').neq('niveau', 'ok').not('vehicle_id', 'is', null).then(must),
    ]);
    const alerts = new Map<string, { expire: number; autres: number }>();
    for (const e of ech as Pick<Echeance, 'vehicle_id' | 'niveau'>[]) {
      const a = alerts.get(e.vehicle_id!) ?? { expire: 0, autres: 0 };
      if (e.niveau === 'expire') a.expire++;
      else a.autres++;
      alerts.set(e.vehicle_id!, a);
    }
    return { vehicles, profiles, names: new Map(profiles.map((p) => [p.id, p.full_name])), alerts };
  });

  const list = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    return data.vehicles.filter(
      (v) =>
        (showInactive || v.actif) &&
        (!type || v.type === type) &&
        (!statut || v.statut === statut) &&
        (!s || [v.matricule, v.marque, v.modele].some((x) => x?.toLowerCase().includes(s))),
    );
  }, [data, q, type, statut, showInactive]);

  return (
    <div>
      <PageHeader
        title="Parc : camions & engins"
        subtitle={data ? `${data.vehicles.filter((v) => v.actif).length} véhicule(s) actif(s)` : undefined}
        actions={<Button onClick={() => setAdding(true)}>+ Ajouter un véhicule</Button>}
      />
      <Card>
        <div className="mb-4 grid gap-2 sm:grid-cols-4">
          <Input placeholder="Rechercher matricule, marque…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={type} onChange={(e) => setType(e.target.value as VehicleType | '')}>
            <option value="">Tous les types</option>
            {(Object.keys(VEHICLE_TYPE_LABELS) as VehicleType[]).map((t) => <option key={t} value={t}>{VEHICLE_TYPE_LABELS[t]}</option>)}
          </Select>
          <Select value={statut} onChange={(e) => setStatut(e.target.value as VehicleStatus | '')}>
            <option value="">Tous les statuts</option>
            {(Object.keys(VEHICLE_STATUS) as VehicleStatus[]).map((s) => <option key={s} value={s}>{VEHICLE_STATUS[s][0]}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Inclure les inactifs
          </label>
        </div>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : list.length === 0 ? <Empty>Aucun véhicule.</Empty> : (
          <Table head={['Matricule', 'Type', 'Marque / modèle', 'Compteur', 'Vidange', 'Chauffeur', 'Statut', 'Alertes']}>
            {list.map((v) => {
              const reste = v.prochaine_vidange != null ? v.prochaine_vidange - v.compteur_actuel : null;
              const a = data!.alerts.get(v.id);
              return (
                <tr key={v.id} className={v.actif ? 'hover:bg-slate-50' : 'opacity-50'}>
                  <Td><Link to={`/vehicules/${v.id}`} className="font-semibold text-sky-700 hover:underline">{v.matricule}</Link></Td>
                  <Td>{VEHICLE_TYPE_LABELS[v.type]}</Td>
                  <Td>{[v.marque, v.modele].filter(Boolean).join(' ') || '—'}</Td>
                  <Td className="whitespace-nowrap">{fmtNumber(v.compteur_actuel)} {v.unite_compteur}</Td>
                  <Td className="whitespace-nowrap">
                    {reste == null ? '—' : reste <= 0 ? <span className="font-semibold text-red-600">Dépassée</span> : `${fmtNumber(reste)} ${v.unite_compteur}`}
                  </Td>
                  <Td>{v.chauffeur_id ? data!.names.get(v.chauffeur_id) : '—'}</Td>
                  <Td><StatusBadge map={VEHICLE_STATUS} value={v.statut} /></Td>
                  <Td className="whitespace-nowrap">
                    {a?.expire ? <Badge tone="red">{a.expire} expiré</Badge> : null} {a?.autres ? <Badge tone="amber">{a.autres}</Badge> : null}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title="Nouveau véhicule" wide>
        {data && <VehicleForm drivers={data.profiles.filter((p) => p.active)} onDone={(id) => navigate(`/vehicules/${id}`)} />}
      </Modal>
    </div>
  );
}
