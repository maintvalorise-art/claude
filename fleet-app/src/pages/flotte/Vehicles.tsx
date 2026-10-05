import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import VehicleForm from '../../components/VehicleForm';
import { Badge, Button, Card, ErrorBox, Modal, PageHeader, Select, Spinner, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fetchPeople, fetchVehicles } from '../../lib/data';
import { fmtNumber } from '../../lib/format';
import { VEHICLE_STATUS, VEHICLE_TYPE_LABELS, options } from '../../lib/labels';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { Alerte, VehicleStatus, VehicleType } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

export default function Vehicles() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const gerer = can(profile, 'flotteGerer');
  const [type, setType] = useState<VehicleType | ''>('');
  const [statut, setStatut] = useState<VehicleStatus | ''>('');
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);

  const { data, loading, error } = useAsync(async () => {
    const [vehicles, people, alertes] = await Promise.all([
      fetchVehicles(false),
      fetchPeople(),
      supabase.from('v_alertes').select('*').eq('module', 'flotte').then(must),
    ]);
    const alerts = new Map<string, { expire: number; autres: number }>();
    for (const a of alertes as Alerte[]) {
      const vid = a.lien?.startsWith('/vehicules/') ? a.lien.slice(11) : null;
      if (!vid) continue;
      const x = alerts.get(vid) ?? { expire: 0, autres: 0 };
      if (a.niveau === 'expire') x.expire++;
      else x.autres++;
      alerts.set(vid, x);
    }
    return { vehicles, people, names: new Map(people.map((p) => [p.id, p.full_name])), alerts };
  });

  const list = useMemo(() => (data?.vehicles ?? []).filter((v) =>
    (showInactive || v.actif) && (!type || v.type === type) && (!statut || v.statut === statut)), [data, type, statut, showInactive]);

  return (
    <div>
      <PageHeader
        title="Véhicules & engins"
        subtitle={data ? `${data.vehicles.filter((v) => v.actif).length} équipement(s) actif(s)` : undefined}
        actions={gerer && <Button onClick={() => setAdding(true)}>+ Ajouter</Button>}
      />
      <Card>
        {loading ? <Spinner /> : error || !data ? <ErrorBox>{error}</ErrorBox> : (
          <DataTable
            rows={list} rowKey={(v) => v.id} onRowClick={(v) => navigate(`/vehicules/${v.id}`)} exportName="parc-vehicules"
            rowClassName={(v) => (v.actif ? undefined : 'opacity-50')}
            toolbar={
              <>
                <Select className="w-44" value={type} onChange={(e) => setType(e.target.value as VehicleType | '')}>
                  <option value="">Tous les types</option>
                  {options(VEHICLE_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <Select className="w-40" value={statut} onChange={(e) => setStatut(e.target.value as VehicleStatus | '')}>
                  <option value="">Tous les statuts</option>
                  {options(VEHICLE_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Inactifs</label>
              </>
            }
            columns={[
              { key: 'code_interne', label: 'Code', value: (v) => v.code_interne ?? '', render: (v) => <span className="font-semibold text-sky-700">{v.code_interne ?? '—'}</span> },
              { key: 'matricule', label: 'Immatriculation' },
              { key: 'type', label: 'Type', value: (v) => VEHICLE_TYPE_LABELS[v.type] },
              { key: 'marque', label: 'Marque / modèle', value: (v) => [v.marque, v.modele, v.annee].filter(Boolean).join(' ') },
              { key: 'compteur', label: 'Compteur', value: (v) => v.compteur_actuel, render: (v) => <span className="whitespace-nowrap">{fmtNumber(v.compteur_actuel)} {v.unite_compteur}</span> },
              { key: 'chauffeur', label: 'Affecté à', value: (v) => (v.chauffeur_id ? data.names.get(v.chauffeur_id) ?? '' : '') },
              { key: 'statut', label: 'Statut', value: (v) => VEHICLE_STATUS[v.statut][0], render: (v) => <StatusBadge map={VEHICLE_STATUS} value={v.statut} /> },
              { key: 'alertes', label: 'Alertes', value: (v) => (data.alerts.get(v.id)?.expire ?? 0) * 100 + (data.alerts.get(v.id)?.autres ?? 0), render: (v) => {
                const a = data.alerts.get(v.id);
                return <span className="whitespace-nowrap">{a?.expire ? <Badge tone="red">{a.expire} dépassée(s)</Badge> : null} {a?.autres ? <Badge tone="amber">{a.autres}</Badge> : null}</span>;
              } },
            ]}
          />
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title="Nouveau véhicule / engin" wide>
        {data && <VehicleForm drivers={data.people} onDone={(id) => navigate(`/vehicules/${id}`)} />}
      </Modal>
    </div>
  );
}
