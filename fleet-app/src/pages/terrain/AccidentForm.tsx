import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Textarea } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fetchVehicles, uploadPhotos, vehicleLabel } from '../../lib/data';
import { errorMessage, supabase } from '../../lib/supabase';
import { useAsync } from '../../lib/useAsync';
import { Done, L, defaultVehicle } from './shared';

function nowLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function AccidentForm() {
  const { profile } = useAuth();
  const { data: vehicles, loading } = useAsync(() => fetchVehicles());
  const [vehicleId, setVehicleId] = useState('');
  const [date, setDate] = useState(nowLocal());
  const [lieu, setLieu] = useState('');
  const [tiers, setTiers] = useState('');
  const [description, setDescription] = useState('');
  const [constat, setConstat] = useState(false);
  const [blesses, setBlesses] = useState(false);
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [numero, setNumero] = useState<{ id: string; numero: string } | null>(null);

  useEffect(() => {
    if (vehicles && !vehicleId) setVehicleId(defaultVehicle(vehicles, profile?.id));
  }, [vehicles, profile?.id, vehicleId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const v = vehicles!.find((x) => x.id === vehicleId)!;
      const photos = files?.length ? await uploadPhotos('accidents', `${new Date().getFullYear()}/${v.id}`, files) : [];
      const { data, error: err } = await supabase.from('accidents').insert({
        vehicle_id: v.id, chauffeur_id: profile!.role === 'chauffeur' ? profile!.id : v.chauffeur_id, declare_par: profile!.id,
        date_accident: new Date(date).toISOString(), lieu, tiers: tiers || null, description, constat_amiable: constat, blesses, photos,
      }).select('id, numero').single();
      if (err) throw err;
      setNumero(data as { id: string; numero: string });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !vehicles) return <Spinner />;
  if (numero) {
    return (
      <Done title={`Accident déclaré : ${numero.numero}`} onNew={() => setNumero(null)}>
        <p className="text-sm text-slate-600">Le responsable flotte est informé et une intervention de réparation a été créée.</p>
        <Link className="text-sm text-sky-700 underline" to={`/accidents/${numero.id}`}>Voir le dossier</Link>
      </Done>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-lg space-y-4">
      <PageHeader title={<>Déclarer un accident <span className="ar block text-lg text-slate-500">التصريح بحادثة</span></>} subtitle="À déclarer dans les 24 heures · خلال 24 ساعة" />
      <Card>
        <div className="space-y-4">
          <Field label={<L fr="Véhicule" ar="الشاحنة" req />}>
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
              <option value="">—</option>
              {vehicles.map((x) => <option key={x.id} value={x.id}>{vehicleLabel(x)}</option>)}
            </Select>
          </Field>
          <Field label={<L fr="Date et heure" ar="التاريخ والساعة" req />}><Input type="datetime-local" value={date} max={nowLocal()} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label={<L fr="Lieu" ar="المكان" req />}><Input value={lieu} onChange={(e) => setLieu(e.target.value)} required /></Field>
          <Field label={<L fr="Tiers impliqués" ar="الأطراف الأخرى" />}><Input value={tiers} onChange={(e) => setTiers(e.target.value)} placeholder="Nom, immatriculation, assurance…" /></Field>
          <Field label={<L fr="Ce qui s'est passé" ar="ماذا وقع" req />}><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} required /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={constat} onChange={(e) => setConstat(e.target.checked)} /> Constat amiable rempli · محضر ودي</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={blesses} onChange={(e) => setBlesses(e.target.checked)} /> Blessés · جرحى</label>
          <Field label={<L fr="Photos (véhicule, constat, lieu)" ar="صور" />}>
            <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => setFiles(e.target.files)} className="block w-full text-sm" />
          </Field>
        </div>
      </Card>
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" variant="danger" disabled={busy} className="w-full py-3">{busy ? 'Envoi…' : 'Déclarer · تصريح'}</Button>
    </form>
  );
}
