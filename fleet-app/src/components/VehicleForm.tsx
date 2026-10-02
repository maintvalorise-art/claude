import { useState, type FormEvent } from 'react';
import { VEHICLE_STATUS, VEHICLE_TYPE_LABELS } from '../lib/labels';
import { errorMessage, supabase } from '../lib/supabase';
import type { Profile, Vehicle, VehicleStatus, VehicleType } from '../lib/types';
import { Button, ErrorBox, Field, Input, Select, Textarea } from './ui';

export default function VehicleForm({ vehicle, drivers, onDone }: { vehicle?: Vehicle; drivers: Profile[]; onDone: (id: string) => void }) {
  const [f, setF] = useState({
    matricule: vehicle?.matricule ?? '',
    type: vehicle?.type ?? ('camion' as VehicleType),
    marque: vehicle?.marque ?? '',
    modele: vehicle?.modele ?? '',
    annee: vehicle?.annee?.toString() ?? '',
    unite_compteur: vehicle?.unite_compteur ?? 'km',
    compteur_actuel: vehicle?.compteur_actuel?.toString() ?? '0',
    prochaine_vidange: vehicle?.prochaine_vidange?.toString() ?? '',
    alerte_vidange: vehicle?.alerte_vidange?.toString() ?? '1000',
    statut: vehicle?.statut ?? ('disponible' as VehicleStatus),
    chauffeur_id: vehicle?.chauffeur_id ?? '',
    notes: vehicle?.notes ?? '',
    actif: vehicle?.actif ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const num = (s: string) => (s.trim() === '' ? null : Number(s));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const row = {
      matricule: f.matricule.trim().toUpperCase(),
      type: f.type,
      marque: f.marque.trim() || null,
      modele: f.modele.trim() || null,
      annee: num(f.annee),
      unite_compteur: f.unite_compteur,
      compteur_actuel: num(f.compteur_actuel) ?? 0,
      prochaine_vidange: num(f.prochaine_vidange),
      alerte_vidange: num(f.alerte_vidange) ?? 1000,
      statut: f.statut,
      chauffeur_id: f.chauffeur_id || null,
      notes: f.notes.trim() || null,
      actif: f.actif,
    };
    try {
      const res = vehicle
        ? await supabase.from('vehicles').update(row).eq('id', vehicle.id).select('id').single()
        : await supabase.from('vehicles').insert(row).select('id').single();
      if (res.error) throw res.error.code === '23505' ? new Error('Ce matricule existe déjà.') : res.error;
      onDone(res.data.id as string);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const unite = f.unite_compteur;
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Matricule *"><Input value={f.matricule} onChange={(e) => set('matricule', e.target.value)} required /></Field>
        <Field label="Type">
          <Select value={f.type} onChange={(e) => set('type', e.target.value as VehicleType)}>
            {(Object.keys(VEHICLE_TYPE_LABELS) as VehicleType[]).map((t) => <option key={t} value={t}>{VEHICLE_TYPE_LABELS[t]}</option>)}
          </Select>
        </Field>
        <Field label="Marque"><Input value={f.marque} onChange={(e) => set('marque', e.target.value)} /></Field>
        <Field label="Modèle"><Input value={f.modele} onChange={(e) => set('modele', e.target.value)} /></Field>
        <Field label="Année"><Input type="number" min={1950} max={2100} value={f.annee} onChange={(e) => set('annee', e.target.value)} /></Field>
        <Field label="Compteur en">
          <Select value={f.unite_compteur} onChange={(e) => set('unite_compteur', e.target.value as 'km' | 'heures')}>
            <option value="km">Kilomètres</option>
            <option value="heures">Heures moteur (engins)</option>
          </Select>
        </Field>
        <Field label={`Compteur actuel (${unite})`}><Input type="number" min={0} value={f.compteur_actuel} onChange={(e) => set('compteur_actuel', e.target.value)} /></Field>
        <Field label={`Prochaine vidange à (${unite})`}><Input type="number" min={0} value={f.prochaine_vidange} onChange={(e) => set('prochaine_vidange', e.target.value)} /></Field>
        <Field label={`Alerter la vidange avant (${unite})`}><Input type="number" min={0} value={f.alerte_vidange} onChange={(e) => set('alerte_vidange', e.target.value)} /></Field>
        <Field label="Statut">
          <Select value={f.statut} onChange={(e) => set('statut', e.target.value as VehicleStatus)}>
            {(Object.keys(VEHICLE_STATUS) as VehicleStatus[]).map((s) => <option key={s} value={s}>{VEHICLE_STATUS[s][0]}</option>)}
          </Select>
        </Field>
        <Field label="Chauffeur attitré">
          <Select value={f.chauffeur_id} onChange={(e) => set('chauffeur_id', e.target.value)}>
            <option value="">— Aucun —</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
          </Select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={f.actif} onChange={(e) => set('actif', e.target.checked)} /> Actif dans le parc
        </label>
      </div>
      <Field label="Notes"><Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={2} /></Field>
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" disabled={busy} className="w-full">{busy ? 'Enregistrement…' : 'Enregistrer'}</Button>
    </form>
  );
}
