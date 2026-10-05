import { useEffect, useState, type FormEvent } from 'react';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, cx } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fetchVehicles, vehicleLabel } from '../../lib/data';
import { fmtNumber } from '../../lib/format';
import { errorMessage, supabase } from '../../lib/supabase';
import { useAsync } from '../../lib/useAsync';
import { Done, L, defaultVehicle } from './shared';

export default function PleinForm() {
  const { profile } = useAuth();
  const { data: vehicles, loading } = useAsync(() => fetchVehicles());
  const [vehicleId, setVehicleId] = useState('');
  const [litres, setLitres] = useState('');
  const [prix, setPrix] = useState('');
  const [compteur, setCompteur] = useState('');
  const [source, setSource] = useState<'station' | 'cuve'>('station');
  const [station, setStation] = useState('');
  const [bon, setBon] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (vehicles && !vehicleId) setVehicleId(defaultVehicle(vehicles, profile?.id));
  }, [vehicles, profile?.id, vehicleId]);
  const v = vehicles?.find((x) => x.id === vehicleId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!v) return;
    if (Number(compteur) < v.compteur_actuel) return setError(`Le compteur ne peut pas être inférieur à ${fmtNumber(v.compteur_actuel)} ${v.unite_compteur}.`);
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.from('pleins').insert({
        vehicle_id: v.id, chauffeur_id: v.chauffeur_id === profile!.id || profile!.role === 'chauffeur' ? profile!.id : v.chauffeur_id,
        litres: Number(litres), prix_litre: prix ? Number(prix) : null, compteur: Number(compteur), source,
        station: source === 'station' ? station || null : null, bon_numero: bon || null, saisi_par: profile!.id,
      });
      if (err) throw err;
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !vehicles) return <Spinner />;
  if (done) return <Done title="Plein enregistré · تم التسجيل" onNew={() => { setDone(false); setLitres(''); setCompteur(''); setBon(''); }} />;

  return (
    <form onSubmit={submit} className="mx-auto max-w-lg space-y-4">
      <PageHeader title={<>Plein gasoil <span className="ar block text-lg text-slate-500">تعبئة الوقود</span></>} />
      <Card>
        <div className="space-y-4">
          <Field label={<L fr="Véhicule" ar="الشاحنة" req />}>
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
              <option value="">—</option>
              {vehicles.map((x) => <option key={x.id} value={x.id}>{vehicleLabel(x)}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={<L fr="Litres" ar="لتر" req />}><Input type="number" inputMode="decimal" min={1} step="0.01" value={litres} onChange={(e) => setLitres(e.target.value)} required /></Field>
            <Field label={<L fr="Prix / litre" ar="ثمن اللتر" />}><Input type="number" inputMode="decimal" min={0} step="0.001" value={prix} onChange={(e) => setPrix(e.target.value)} /></Field>
          </div>
          <Field label={<L fr={v?.unite_compteur === 'heures' ? 'Heures moteur' : 'Kilométrage'} ar="العداد" req />} hint={v ? `Dernier relevé : ${fmtNumber(v.compteur_actuel)} ${v.unite_compteur}` : undefined}>
            <Input type="number" inputMode="numeric" min={v?.compteur_actuel ?? 0} value={compteur} onChange={(e) => setCompteur(e.target.value)} required />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {(['station', 'cuve'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSource(s)} className={cx('rounded-lg border py-2 text-sm font-medium', source === s ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300')}>
                {s === 'station' ? 'Station · محطة' : 'Cuve interne · الخزان'}
              </button>
            ))}
          </div>
          {source === 'station' && <Field label={<L fr="Station" ar="المحطة" />}><Input value={station} onChange={(e) => setStation(e.target.value)} /></Field>}
          <Field label={<L fr="N° bon / carte carburant" ar="رقم البون" />}><Input value={bon} onChange={(e) => setBon(e.target.value)} /></Field>
        </div>
      </Card>
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" disabled={busy} className="w-full py-3">{busy ? '…' : 'Enregistrer · تسجيل'}</Button>
    </form>
  );
}
