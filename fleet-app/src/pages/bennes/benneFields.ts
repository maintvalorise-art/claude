import type { FieldDef } from '../../components/EntityForm';
import { BENNE_ETAT, BENNE_TYPE_LABELS, DECHET_LABELS, options } from '../../lib/labels';

export const BENNE_FIELDS: FieldDef[] = [
  { name: 'numero', label: 'N° peint', required: true, placeholder: 'B-001' },
  { name: 'code_barres', label: 'Code-barres / QR', hint: 'Laisser vide pour utiliser le numéro' },
  { name: 'type', label: 'Type', type: 'select', options: Object.entries(BENNE_TYPE_LABELS), required: true },
  { name: 'volume_m3', label: 'Volume (m³)', type: 'number', min: 0, step: '0.5' },
  { name: 'dechet', label: 'Déchet accepté', type: 'select', options: Object.entries(DECHET_LABELS) },
  { name: 'etat', label: 'État', type: 'select', options: options(BENNE_ETAT), required: true },
  { name: 'derniere_revision', label: 'Dernière révision', type: 'date' },
  { name: 'gps_lat', label: 'Latitude GPS (phase 2)', type: 'number', step: 'any' },
  { name: 'gps_lng', label: 'Longitude GPS (phase 2)', type: 'number', step: 'any' },
  { name: 'actif', label: 'Active', type: 'checkbox' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];
