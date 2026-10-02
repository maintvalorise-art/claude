import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, Td } from '../../components/ui';
import { fetchVehicles } from '../../lib/data';
import { fmtDate, fmtDateTime, fmtNumber } from '../../lib/format';
import { fetchProfiles } from '../../lib/staff';
import { supabase } from '../../lib/supabase';
import type { ControlSheet } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

export default function ControlSheets() {
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [nokOnly, setNokOnly] = useState(false);

  const refs = useAsync(async () => {
    const [vehicles, profiles] = await Promise.all([fetchVehicles(false), fetchProfiles()]);
    return { vehicles, profiles, vmap: new Map(vehicles.map((v) => [v.id, v.matricule])), names: new Map(profiles.map((p) => [p.id, p.full_name])) };
  });

  const sheets = useAsync(async () => {
    let q = supabase.from('control_sheets').select('*').order('date_controle', { ascending: false }).order('created_at', { ascending: false }).limit(300);
    if (vehicleId) q = q.eq('vehicle_id', vehicleId);
    if (driverId) q = q.eq('chauffeur_id', driverId);
    if (from) q = q.gte('date_controle', from);
    if (to) q = q.lte('date_controle', to);
    if (nokOnly) q = q.gt('nb_nok', 0);
    return must(await q) as ControlSheet[];
  }, [vehicleId, driverId, from, to, nokOnly]);

  return (
    <div>
      <PageHeader title="Fiches de contrôle" subtitle="Historique des contrôles avant départ" />
      <Card>
        <div className="mb-4 grid gap-2 sm:grid-cols-5">
          <Field label="Véhicule">
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Tous</option>
              {refs.data?.vehicles.map((v) => <option key={v.id} value={v.id}>{v.matricule}</option>)}
            </Select>
          </Field>
          <Field label="Chauffeur">
            <Select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">Tous</option>
              {refs.data?.profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Du"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Au"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={nokOnly} onChange={(e) => setNokOnly(e.target.checked)} /> Avec NOK uniquement
          </label>
        </div>
        {sheets.loading || refs.loading ? <Spinner /> : sheets.error || refs.error ? <ErrorBox>{sheets.error ?? refs.error}</ErrorBox> : sheets.data!.length === 0 ? <Empty>Aucune fiche.</Empty> : (
          <Table head={['Date', 'Véhicule', 'Chauffeur', 'Compteur', 'Résultat', 'Saisie le', '']}>
            {sheets.data!.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <Td>{fmtDate(s.date_controle)}</Td>
                <Td className="font-medium">{refs.data!.vmap.get(s.vehicle_id)}</Td>
                <Td>{refs.data!.names.get(s.chauffeur_id)}</Td>
                <Td>{fmtNumber(s.compteur_depart)}</Td>
                <Td>{s.nb_nok ? <Badge tone="red">{s.nb_nok} NOK</Badge> : <Badge tone="green">Tout OK</Badge>}</Td>
                <Td className="whitespace-nowrap text-xs text-slate-500">{fmtDateTime(s.created_at)}</Td>
                <Td><Link to={`/fiches/${s.id}`} className="text-sky-700 underline">Voir</Link></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
