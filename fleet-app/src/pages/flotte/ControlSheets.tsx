import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import { Badge, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { byId, fetchPeople, fetchVehicles, vehicleLabel } from '../../lib/data';
import { daysAgoIso, fmtDate, fmtDateTime, fmtNumber } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { ControlSheet } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

export default function ControlSheets() {
  const navigate = useNavigate();
  const [vehicleId, setVehicleId] = useState('');
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState('');
  const [filtre, setFiltre] = useState<'' | 'nok' | 'a_valider'>('');

  const refs = useAsync(async () => {
    const [vehicles, people] = await Promise.all([fetchVehicles(false), fetchPeople()]);
    return { vehicles, vmap: byId(vehicles), names: new Map(people.map((p) => [p.id, p.full_name])) };
  });

  const sheets = useAsync(async () => {
    let q = supabase.from('control_sheets').select('*').order('date_controle', { ascending: false }).order('created_at', { ascending: false }).limit(1000);
    if (vehicleId) q = q.eq('vehicle_id', vehicleId);
    if (from) q = q.gte('date_controle', from);
    if (to) q = q.lte('date_controle', to);
    if (filtre === 'nok') q = q.gt('nb_nok', 0);
    if (filtre === 'a_valider') q = q.is('valide_le', null);
    return must(await q) as ControlSheet[];
  }, [vehicleId, from, to, filtre]);

  return (
    <div>
      <PageHeader title="Fiches de contrôle" subtitle="Remplies par les chauffeurs, validées par le responsable flotte. Un point non conforme crée une intervention." />
      <Card>
        <div className="mb-3 grid gap-2 sm:grid-cols-4">
          <Field label="Véhicule">
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Tous</option>
              {refs.data?.vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
            </Select>
          </Field>
          <Field label="Du"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Au"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Filtre">
            <Select value={filtre} onChange={(e) => setFiltre(e.target.value as typeof filtre)}>
              <option value="">Toutes</option>
              <option value="a_valider">À valider</option>
              <option value="nok">Avec non-conformités</option>
            </Select>
          </Field>
        </div>
        {sheets.loading || refs.loading ? <Spinner /> : sheets.error || refs.error ? <ErrorBox>{sheets.error ?? refs.error}</ErrorBox> : (
          <DataTable
            rows={sheets.data!} rowKey={(s) => s.id} onRowClick={(s) => navigate(`/fiches/${s.id}`)} exportName="fiches-controle"
            columns={[
              { key: 'date', label: 'Date', value: (s) => s.date_controle, render: (s) => fmtDate(s.date_controle) },
              { key: 'vehicule', label: 'Véhicule', value: (s) => vehicleLabel(refs.data!.vmap.get(s.vehicle_id)) },
              { key: 'chauffeur', label: 'Chauffeur', value: (s) => refs.data!.names.get(s.chauffeur_id) ?? '' },
              { key: 'compteur', label: 'Compteur', value: (s) => s.compteur_depart, render: (s) => fmtNumber(s.compteur_depart) },
              { key: 'resultat', label: 'Résultat', value: (s) => s.nb_nok, render: (s) => (s.nb_nok ? <Badge tone="red">{s.nb_nok} NOK</Badge> : <Badge tone="green">Conforme</Badge>) },
              { key: 'validation', label: 'Validation', value: (s) => (s.valide_le ? 'Validée' : 'À valider'), render: (s) => (s.valide_le ? <span className="text-xs">✓ {refs.data!.names.get(s.valide_par ?? '')}</span> : <Badge tone="amber">À valider</Badge>) },
              { key: 'saisie', label: 'Saisie le', value: (s) => s.created_at, render: (s) => <span className="text-xs text-slate-500">{fmtDateTime(s.created_at)}</span> },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
