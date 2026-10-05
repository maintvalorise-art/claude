import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, StatCard } from '../../components/ui';
import { byId, fetchPeople, fetchVehicles, vehicleLabel } from '../../lib/data';
import { daysAgoIso, fmtDateTime, fmtMoney, fmtNumber, todayIso } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { Parametre, Plein, Trajet } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

export default function Gasoil() {
  const navigate = useNavigate();
  const [debut, setDebut] = useState(daysAgoIso(30));
  const [fin, setFin] = useState(todayIso());
  const [vehicleId, setVehicleId] = useState('');
  const [anomalies, setAnomalies] = useState(false);

  const { data, loading, error } = useAsync(async () => {
    const finX = new Date(new Date(fin).getTime() + 864e5).toISOString();
    const [pleins, trajets, vehicles, people, params] = await Promise.all([
      supabase.from('v_pleins').select('*').gte('date_plein', debut).lt('date_plein', finX).order('date_plein', { ascending: false }).then(must),
      supabase.from('trajets').select('*').gte('date_trajet', debut).lte('date_trajet', fin).then(must),
      fetchVehicles(false),
      fetchPeople(),
      supabase.from('parametres').select('*').eq('cle', 'conso_tolerance_pct').then(must),
    ]);
    return {
      pleins: pleins as Plein[], trajets: trajets as Trajet[], vehicles, vmap: byId(vehicles),
      names: new Map(people.map((p) => [p.id, p.full_name])),
      tol: Number((params as Parametre[])[0]?.valeur ?? 20),
    };
  }, [debut, fin]);

  const anormal = (p: Plein) => p.consommation != null && p.conso_reference != null && p.consommation > p.conso_reference * (1 + (data?.tol ?? 20) / 100);
  const list = useMemo(() => (data?.pleins ?? []).filter((p) => (!vehicleId || p.vehicle_id === vehicleId) && (!anomalies || anormal(p))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, vehicleId, anomalies]);

  // Rapprochement : distance des trajets × consommation de référence vs litres déclarés.
  const rappro = useMemo(() => {
    if (!data) return [];
    return data.vehicles.filter((v) => v.actif).map((v) => {
      const litres = data.pleins.filter((p) => p.vehicle_id === v.id).reduce((s, p) => s + Number(p.litres), 0);
      const distance = data.trajets.filter((t) => t.vehicle_id === v.id).reduce((s, t) => s + (t.compteur_arrivee - t.compteur_depart), 0);
      const attendu = v.conso_reference != null ? distance * Number(v.conso_reference) / (v.unite_compteur === 'km' ? 100 : 1) : null;
      const ecart = attendu ? (litres - attendu) / attendu * 100 : null;
      return { v, litres, distance, attendu, ecart };
    }).filter((x) => x.litres > 0 || x.distance > 0);
  }, [data]);

  const totalL = list.reduce((s, p) => s + Number(p.litres), 0);
  const totalDH = list.reduce((s, p) => s + Number(p.montant ?? 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Gasoil" subtitle="Pleins, consommation L/100 km ou L/h, anomalies et rapprochement avec les trajets"
        actions={<Button onClick={() => navigate('/plein')}>+ Saisir un plein</Button>} />
      <Card>
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="Du"><Input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} /></Field>
          <Field label="Au"><Input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></Field>
          <Field label="Véhicule">
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Tous</option>
              {data?.vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
            </Select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={anomalies} onChange={(e) => setAnomalies(e.target.checked)} /> Anomalies uniquement</label>
        </div>
      </Card>
      {loading ? <Spinner /> : error || !data ? <ErrorBox>{error}</ErrorBox> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Litres" value={fmtNumber(totalL)} tone="blue" />
            <StatCard label="Montant" value={fmtMoney(totalDH)} />
            <StatCard label="Pleins" value={list.length} />
            <StatCard label="Consommations anormales" value={data.pleins.filter(anormal).length} tone={data.pleins.some(anormal) ? 'red' : 'green'} hint={`Tolérance ${data.tol} %`} />
          </div>
          <Card title="Pleins">
            <DataTable rows={list} rowKey={(p) => p.id} exportName="gasoil" rowClassName={(p) => (anormal(p) ? 'bg-red-50' : undefined)} columns={[
              { key: 'date', label: 'Date', value: (p) => p.date_plein, render: (p) => <span className="whitespace-nowrap">{fmtDateTime(p.date_plein)}</span> },
              { key: 'vehicule', label: 'Véhicule', value: (p) => vehicleLabel(data.vmap.get(p.vehicle_id)) },
              { key: 'chauffeur', label: 'Chauffeur', value: (p) => (p.chauffeur_id ? data.names.get(p.chauffeur_id) ?? '' : '') },
              { key: 'litres', label: 'Litres', value: (p) => p.litres },
              { key: 'prix', label: 'Prix/L', value: (p) => p.prix_litre ?? '' },
              { key: 'montant', label: 'Montant', value: (p) => p.montant ?? '', render: (p) => fmtMoney(p.montant) },
              { key: 'compteur', label: 'Compteur', value: (p) => p.compteur, render: (p) => `${fmtNumber(p.compteur)} ${p.unite_compteur}` },
              { key: 'conso', label: 'Conso', value: (p) => p.consommation ?? '', render: (p) => (p.consommation == null ? '—' : <span>{fmtNumber(p.consommation, 1)} {p.unite_compteur === 'km' ? 'L/100' : 'L/h'} {anormal(p) && <Badge tone="red">Anormale</Badge>}</span>) },
              { key: 'source', label: 'Source', value: (p) => (p.source === 'cuve' ? 'Cuve interne' : p.station ?? 'Station') },
              { key: 'bon', label: 'Bon / carte', value: (p) => p.bon_numero ?? '' },
            ]} />
          </Card>
          <Card title="Rapprochement trajets × consommation attendue vs litres déclarés">
            <DataTable rows={rappro} rowKey={(r) => r.v.id} exportName="rapprochement-gasoil" columns={[
              { key: 'vehicule', label: 'Véhicule', value: (r) => vehicleLabel(r.v) },
              { key: 'distance', label: 'Distance trajets', value: (r) => r.distance, render: (r) => `${fmtNumber(r.distance)} ${r.v.unite_compteur}` },
              { key: 'ref', label: 'Conso. référence', value: (r) => r.v.conso_reference ?? '' },
              { key: 'attendu', label: 'Litres attendus', value: (r) => r.attendu ?? '', render: (r) => (r.attendu == null ? 'Référence manquante' : fmtNumber(r.attendu, 0)) },
              { key: 'litres', label: 'Litres déclarés', value: (r) => r.litres, render: (r) => fmtNumber(r.litres, 0) },
              { key: 'ecart', label: 'Écart', value: (r) => r.ecart ?? '', render: (r) => (r.ecart == null ? '—' : <Badge tone={Math.abs(r.ecart) > data.tol ? 'red' : 'green'}>{r.ecart > 0 ? '+' : ''}{fmtNumber(r.ecart, 0)} %</Badge>) },
            ]} />
            <p className="mt-2 text-xs text-slate-500">Un écart important peut signaler des trajets non saisis, une fuite ou une anomalie de carburant.</p>
          </Card>
        </>
      )}
    </div>
  );
}
