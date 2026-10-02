import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { INTERVENTION_TYPE_AR, INTERVENTION_TYPE_LABELS, PRIORITY } from '../lib/labels';
import { errorMessage, supabase } from '../lib/supabase';
import type { InterventionType, Priority, Vehicle } from '../lib/types';
import { Button, ErrorBox, Field, Input, Select, Textarea } from './ui';

const TYPES = (Object.keys(INTERVENTION_TYPE_LABELS) as InterventionType[]).filter((t) => t !== 'controle');

/** Formulaire de demande d'intervention (vidange, panne, ...). */
export default function InterventionRequestForm({
  vehicles, defaultVehicleId, onDone,
}: {
  vehicles: Vehicle[];
  defaultVehicleId?: string;
  onDone: () => void;
}) {
  const { profile } = useAuth();
  const [vehicleId, setVehicleId] = useState(defaultVehicleId ?? '');
  const [type, setType] = useState<InterventionType>('panne');
  const [priorite, setPriorite] = useState<Priority>('normale');
  const [titre, setTitre] = useState('');
  const [description, setDescription] = useState('');
  const [compteur, setCompteur] = useState('');
  const [immobilise, setImmobilise] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (vehicleId) return;
    const mine = vehicles.find((v) => v.chauffeur_id === profile?.id);
    if (mine) setVehicleId(mine.id);
  }, [vehicles, profile?.id, vehicleId]);

  useEffect(() => {
    if (immobilise) setPriorite('urgente');
  }, [immobilise]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.from('interventions').insert({
        vehicle_id: vehicleId,
        demandeur_id: profile!.id,
        type,
        priorite,
        titre: titre.trim() || INTERVENTION_TYPE_LABELS[type],
        description: description.trim() || null,
        compteur: compteur ? Number(compteur) : null,
        vehicule_immobilise: immobilise,
      });
      if (err) throw err;
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={<>Véhicule * <span className="ar">· الشاحنة</span></>}>
        <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
          <option value="">— Choisir —</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>{v.matricule} {v.marque ? `· ${v.marque}` : ''}</option>
          ))}
        </Select>
      </Field>
      <Field label={<>Type de demande * <span className="ar">· نوع الطلب</span></>}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded-lg border px-2 py-2 text-xs font-medium ${type === t ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700'}`}
            >
              {INTERVENTION_TYPE_LABELS[t]}
              <span className="ar block opacity-75">{INTERVENTION_TYPE_AR[t]}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label={<>Objet <span className="ar">· الموضوع</span></>}>
        <Input value={titre} onChange={(e) => setTitre(e.target.value)} placeholder={INTERVENTION_TYPE_LABELS[type]} maxLength={120} />
      </Field>
      <Field label={<>Description du problème <span className="ar">· وصف المشكل</span></>}>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={<>Compteur actuel <span className="ar">· الكيلومتراج</span></>}>
          <Input type="number" inputMode="numeric" min={0} value={compteur} onChange={(e) => setCompteur(e.target.value)} />
        </Field>
        <Field label={<>Priorité <span className="ar">· الأولوية</span></>}>
          <Select value={priorite} onChange={(e) => setPriorite(e.target.value as Priority)}>
            {(Object.keys(PRIORITY) as Priority[]).map((p) => (
              <option key={p} value={p}>{PRIORITY[p][0]}</option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={immobilise} onChange={(e) => setImmobilise(e.target.checked)} />
        <span>
          <b>Véhicule immobilisé</b> — ne peut pas rouler
          <span className="ar block text-slate-600">الشاحنة متوقفة ولا يمكنها السير</span>
        </span>
      </label>
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" disabled={busy || !vehicleId} className="w-full py-3">
        {busy ? 'Envoi…' : 'Envoyer la demande · إرسال الطلب'}
      </Button>
    </form>
  );
}
