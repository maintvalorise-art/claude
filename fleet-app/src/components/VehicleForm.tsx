import { VEHICLE_STATUS, VEHICLE_TYPE_LABELS, options } from '../lib/labels';
import { supabase } from '../lib/supabase';
import type { Person } from '../lib/data';
import type { Vehicle } from '../lib/types';
import EntityForm, { type FieldDef } from './EntityForm';

export default function VehicleForm({ vehicle, drivers, onDone }: { vehicle?: Vehicle; drivers: Person[]; onDone: (id: string) => void }) {
  const fields: FieldDef[] = [
    { name: 'code_interne', label: 'Code interne', placeholder: 'CAM-12, CHA-03…' },
    { name: 'matricule', label: 'Immatriculation / n° de série', required: true },
    { name: 'type', label: 'Type', type: 'select', options: options(VEHICLE_TYPE_LABELS), required: true },
    { name: 'statut', label: 'Statut', type: 'select', options: options(VEHICLE_STATUS), required: true },
    { name: 'marque', label: 'Marque' },
    { name: 'modele', label: 'Modèle' },
    { name: 'annee', label: 'Année', type: 'number', min: 1950 },
    { name: 'numero_serie', label: 'N° de série / châssis' },
    { name: 'unite_compteur', label: 'Compteur en', type: 'select', options: [['km', 'Kilomètres'], ['heures', 'Heures moteur (engins)']], required: true },
    { name: 'compteur_actuel', label: 'Compteur actuel', type: 'number', min: 0, required: true },
    { name: 'conso_reference', label: 'Consommation de référence', type: 'number', min: 0, step: '0.1', hint: 'L/100 km (camions) ou L/h (engins), pour détecter les écarts' },
    { name: 'chauffeur_id', label: 'Chauffeur / conducteur affecté', type: 'select', options: drivers.map((d) => [d.id, d.full_name]) },
    { name: 'actif', label: 'Actif dans le parc', type: 'checkbox' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  return (
    <EntityForm
      fields={fields}
      initial={(vehicle as unknown as Record<string, unknown>) ?? { type: 'camion_porte_benne', statut: 'disponible', unite_compteur: 'km', compteur_actuel: 0, actif: true }}
      onSubmit={async (v) => {
        const row = { ...v, matricule: String(v.matricule).toUpperCase() };
        const res = vehicle
          ? await supabase.from('vehicles').update(row).eq('id', vehicle.id).select('id').single()
          : await supabase.from('vehicles').insert(row).select('id').single();
        if (res.error) throw res.error.code === '23505' ? new Error('Cette immatriculation ou ce code existe déjà.') : res.error;
        onDone(res.data.id as string);
      }}
    />
  );
}
