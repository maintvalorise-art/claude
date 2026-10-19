import { useEffect, useState, type FormEvent } from 'react';
import ScanInput from '../../components/ScanInput';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fetchClients, fetchVehicles, vehicleLabel } from '../../lib/data';
import { fmtNumber, todayIso } from '../../lib/format';
import { DESTINATION_LABELS, options } from '../../lib/labels';
import { errorMessage, supabase } from '../../lib/supabase';
import type { Benne, DestinationType } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';
import { moduleOn } from '../../lib/config';
import { Done, L, defaultVehicle } from './shared';

export default function TrajetForm() {
  const { profile } = useAuth();
  const { data, loading } = useAsync(async () => {
    const [vehicles, clients, bennes] = await Promise.all([
      fetchVehicles(), fetchClients(),
      supabase.from('bennes').select('*').eq('actif', true).order('numero').then((r) => (r.data ?? []) as Benne[]),
    ]);
    return { vehicles, clients, bennes };
  });
  const [vehicleId, setVehicleId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [depart, setDepart] = useState('Dépôt Valorise');
  const [destination, setDestination] = useState('');
  const [type, setType] = useState<DestinationType>('client');
  const [clientId, setClientId] = useState('');
  const [kmDep, setKmDep] = useState('');
  const [kmArr, setKmArr] = useState('');
  const [benneId, setBenneId] = useState('');
  const [poids, setPoids] = useState('');
  const [ticket, setTicket] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (data && !vehicleId) setVehicleId(defaultVehicle(data.vehicles, profile?.id));
  }, [data, profile?.id, vehicleId]);
  const v = data?.vehicles.find((x) => x.id === vehicleId);
  useEffect(() => {
    if (v) setKmDep(String(v.compteur_actuel));
  }, [v]);
  useEffect(() => {
    const c = data?.clients.find((x) => x.id === clientId);
    if (c) setDestination(c.nom);
  }, [clientId, data]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!v) return;
    if (Number(kmArr) < Number(kmDep)) return setError("Le compteur d'arrivée doit être supérieur au départ.");
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.from('trajets').insert({
        vehicle_id: v.id, chauffeur_id: profile!.role === 'chauffeur' ? profile!.id : v.chauffeur_id, date_trajet: date,
        depart, destination, type_destination: type, client_id: type === 'client' ? clientId || null : null,
        compteur_depart: Number(kmDep), compteur_arrivee: Number(kmArr), benne_id: benneId || null,
        poids_kg: poids ? Number(poids) : null, ticket_pesee: ticket || null, saisi_par: profile!.id,
      });
      if (err) throw err;
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !data) return <Spinner />;
  if (done) return <Done title="Trajet enregistré · تم التسجيل" onNew={() => { setDone(false); setDestination(''); setKmArr(''); setBenneId(''); setPoids(''); setTicket(''); }} />;

  return (
    <form onSubmit={submit} className="mx-auto max-w-lg space-y-4">
      <PageHeader title={<>Trajet <span className="ar block text-lg text-slate-500">رحلة</span></>} />
      <Card>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={<L fr="Véhicule" ar="الشاحنة" req />}>
              <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
                <option value="">—</option>
                {data.vehicles.map((x) => <option key={x.id} value={x.id}>{vehicleLabel(x)}</option>)}
              </Select>
            </Field>
            <Field label={<L fr="Date" ar="التاريخ" req />}><Input type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          </div>
          <Field label={<L fr="Départ" ar="الانطلاق" req />}><Input value={depart} onChange={(e) => setDepart(e.target.value)} required /></Field>
          <Field label={<L fr="Type de destination" ar="نوع الوجهة" />}>
            <Select value={type} onChange={(e) => setType(e.target.value as DestinationType)}>
              {options(DESTINATION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          {type === 'client' && data.clients.length > 0 && (
            <Field label={<L fr="Client" ar="الزبون" />}>
              <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">—</option>
                {data.clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </Select>
            </Field>
          )}
          <Field label={<L fr="Destination" ar="الوجهة" req />}><Input value={destination} onChange={(e) => setDestination(e.target.value)} required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={<L fr="Km départ" ar="عداد الانطلاق" req />}><Input type="number" inputMode="numeric" min={0} value={kmDep} onChange={(e) => setKmDep(e.target.value)} required /></Field>
            <Field label={<L fr="Km arrivée" ar="عداد الوصول" req />} hint={kmArr && kmDep ? `${fmtNumber(Number(kmArr) - Number(kmDep))} ${v?.unite_compteur ?? 'km'}` : undefined}>
              <Input type="number" inputMode="numeric" min={Number(kmDep) || 0} value={kmArr} onChange={(e) => setKmArr(e.target.value)} required />
            </Field>
          </div>
          {moduleOn('bennes') && (
          <Field label={<L fr="Benne transportée (scan)" ar="الحاوية" />}>
            <ScanInput autoFocus={false} placeholder="Scanner le QR de la benne…" onScan={(code) => {
              const b = data.bennes.find((x) => x.code_barres === code || x.numero === code);
              if (b) setBenneId(b.id);
              else setError(`Benne « ${code} » introuvable`);
            }} />
            <Select className="mt-2" value={benneId} onChange={(e) => setBenneId(e.target.value)}>
              <option value="">Aucune</option>
              {data.bennes.map((b) => <option key={b.id} value={b.id}>{b.numero}</option>)}
            </Select>
          </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={<L fr="Poids (kg)" ar="الوزن" />}><Input type="number" inputMode="decimal" min={0} value={poids} onChange={(e) => setPoids(e.target.value)} /></Field>
            <Field label={<L fr="Ticket pont bascule" ar="تذكرة الميزان" />}><Input value={ticket} onChange={(e) => setTicket(e.target.value)} /></Field>
          </div>
        </div>
      </Card>
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" disabled={busy} className="w-full py-3">{busy ? '…' : 'Enregistrer · تسجيل'}</Button>
    </form>
  );
}
