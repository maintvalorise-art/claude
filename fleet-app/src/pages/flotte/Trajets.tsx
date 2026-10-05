import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Spinner } from '../../components/ui';
import { byId, fetchClients, fetchPeople, fetchVehicles, vehicleLabel } from '../../lib/data';
import { daysAgoIso, fmtDate, fmtNumber, todayIso } from '../../lib/format';
import { DESTINATION_LABELS } from '../../lib/labels';
import { supabase } from '../../lib/supabase';
import type { Benne, Trajet } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

export default function Trajets() {
  const navigate = useNavigate();
  const [debut, setDebut] = useState(daysAgoIso(30));
  const [fin, setFin] = useState(todayIso());
  const { data, loading, error } = useAsync(async () => {
    const [trajets, vehicles, people, clients, bennes] = await Promise.all([
      supabase.from('trajets').select('*').gte('date_trajet', debut).lte('date_trajet', fin).order('date_trajet', { ascending: false }).then(must),
      fetchVehicles(false),
      fetchPeople(),
      fetchClients(),
      supabase.from('bennes').select('*').then((r) => (r.data ?? []) as Benne[]),
    ]);
    return { trajets: trajets as Trajet[], vmap: byId(vehicles), names: new Map(people.map((p) => [p.id, p.full_name])), cmap: byId(clients), bmap: byId(bennes) };
  }, [debut, fin]);

  return (
    <div>
      <PageHeader title="Journal des trajets" subtitle="Départ, destination, kilomètres, benne transportée, poids (pont bascule)"
        actions={
          <div className="flex items-end gap-2">
            <Field label="Du"><Input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} /></Field>
            <Field label="Au"><Input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></Field>
            <Button onClick={() => navigate('/trajet')}>+ Trajet</Button>
          </div>
        } />
      <Card>
        {loading ? <Spinner /> : error || !data ? <ErrorBox>{error}</ErrorBox> : (
          <DataTable rows={data.trajets} rowKey={(t) => t.id} exportName="trajets" columns={[
            { key: 'date', label: 'Date', value: (t) => t.date_trajet, render: (t) => fmtDate(t.date_trajet) },
            { key: 'vehicule', label: 'Véhicule', value: (t) => vehicleLabel(data.vmap.get(t.vehicle_id)) },
            { key: 'chauffeur', label: 'Chauffeur', value: (t) => (t.chauffeur_id ? data.names.get(t.chauffeur_id) ?? '' : '') },
            { key: 'trajet', label: 'Trajet', value: (t) => `${t.depart} → ${t.destination}` },
            { key: 'type', label: 'Destination', value: (t) => DESTINATION_LABELS[t.type_destination] + (t.client_id ? ` · ${data.cmap.get(t.client_id)?.nom ?? ''}` : '') },
            { key: 'distance', label: 'Distance', value: (t) => t.compteur_arrivee - t.compteur_depart, render: (t) => fmtNumber(t.compteur_arrivee - t.compteur_depart) },
            { key: 'benne', label: 'Benne', value: (t) => (t.benne_id ? data.bmap.get(t.benne_id)?.numero ?? '' : '') },
            { key: 'poids', label: 'Poids (kg)', value: (t) => t.poids_kg ?? '' },
            { key: 'ticket', label: 'Ticket pesée', value: (t) => t.ticket_pesee ?? '' },
          ]} />
        )}
      </Card>
    </div>
  );
}
