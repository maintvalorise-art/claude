import { useNavigate } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import { Button, Card, ErrorBox, PageHeader, Spinner, StatusBadge } from '../../components/ui';
import { byId, fetchPeople, fetchVehicles, vehicleLabel } from '../../lib/data';
import { fmtDateTime, fmtMoney } from '../../lib/format';
import { ACCIDENT_STATUS } from '../../lib/labels';
import { supabase } from '../../lib/supabase';
import type { Accident } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

export default function Accidents() {
  const navigate = useNavigate();
  const { data, loading, error } = useAsync(async () => {
    const [acc, vehicles, people] = await Promise.all([
      supabase.from('accidents').select('*').order('date_accident', { ascending: false }).then(must),
      fetchVehicles(false),
      fetchPeople(),
    ]);
    return { acc: acc as Accident[], vmap: byId(vehicles), names: new Map(people.map((p) => [p.id, p.full_name])) };
  });

  const parChauffeur = new Map<string, number>();
  data?.acc.forEach((a) => a.chauffeur_id && parChauffeur.set(a.chauffeur_id, (parChauffeur.get(a.chauffeur_id) ?? 0) + 1));

  return (
    <div>
      <PageHeader title="Accidents & sinistres" subtitle="Déclaration sous 24 h, dossier assurance, réparation, analyse des causes"
        actions={<Button onClick={() => navigate('/accident')}>+ Déclarer un accident</Button>} />
      <Card>
        {loading ? <Spinner /> : error || !data ? <ErrorBox>{error}</ErrorBox> : (
          <DataTable rows={data.acc} rowKey={(a) => a.id} onRowClick={(a) => navigate(`/accidents/${a.id}`)} exportName="accidents" columns={[
            { key: 'numero', label: 'N°', render: (a) => <span className="font-semibold text-sky-700">{a.numero}</span> },
            { key: 'date', label: 'Date', value: (a) => a.date_accident, render: (a) => <span className="whitespace-nowrap">{fmtDateTime(a.date_accident)}</span> },
            { key: 'vehicule', label: 'Véhicule', value: (a) => vehicleLabel(data.vmap.get(a.vehicle_id)) },
            { key: 'chauffeur', label: 'Chauffeur', value: (a) => (a.chauffeur_id ? `${data.names.get(a.chauffeur_id) ?? ''} (${parChauffeur.get(a.chauffeur_id)} sinistre(s))` : '') },
            { key: 'lieu', label: 'Lieu' },
            { key: 'tiers', label: 'Tiers', value: (a) => a.tiers ?? '' },
            { key: 'cout', label: 'Coût réparation', value: (a) => a.cout_reparation ?? '', render: (a) => fmtMoney(a.cout_reparation) },
            { key: 'statut', label: 'Dossier', value: (a) => ACCIDENT_STATUS[a.statut][0], render: (a) => <StatusBadge map={ACCIDENT_STATUS} value={a.statut} /> },
          ]} />
        )}
      </Card>
    </div>
  );
}
