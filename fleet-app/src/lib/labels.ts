import type {
  AlertLevel, DocumentType, InterventionStatus, InterventionType, Priority, Role, VehicleStatus, VehicleType,
} from './types';

type Tone = 'gray' | 'green' | 'blue' | 'amber' | 'orange' | 'red';

export const ROLE_LABELS: Record<Role, string> = {
  chauffeur: 'Chauffeur',
  gestionnaire: 'Gestionnaire',
  admin: 'Administrateur',
};

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  camion: 'Camion',
  engin: 'Engin',
  vehicule_leger: 'Véhicule léger',
  remorque: 'Remorque',
  autre: 'Autre',
};

export const VEHICLE_STATUS: Record<VehicleStatus, [string, Tone]> = {
  disponible: ['Disponible', 'green'],
  en_service: ['En service', 'blue'],
  en_panne: ['En panne', 'red'],
  en_maintenance: ['En maintenance', 'amber'],
  hors_service: ['Hors service', 'gray'],
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType | 'vidange', string> = {
  visite_technique: 'Visite technique',
  assurance: 'Assurance',
  vignette: 'Vignette',
  carte_grise: 'Carte grise',
  tachygraphe: 'Contrôle tachygraphe',
  extincteur: 'Extincteurs',
  autorisation: 'Autorisation de circulation',
  permis: 'Permis de conduire',
  carte_professionnelle: 'Carte professionnelle',
  visite_medicale: 'Visite médicale',
  autre: 'Autre',
  vidange: 'Vidange',
};

export const VEHICLE_DOCUMENT_TYPES: DocumentType[] = [
  'visite_technique', 'assurance', 'vignette', 'carte_grise', 'tachygraphe', 'extincteur', 'autorisation', 'autre',
];
export const DRIVER_DOCUMENT_TYPES: DocumentType[] = ['permis', 'carte_professionnelle', 'visite_medicale', 'autre'];

export const INTERVENTION_TYPE_LABELS: Record<InterventionType, string> = {
  vidange: 'Vidange',
  panne: 'Panne',
  pneumatique: 'Pneumatique',
  freinage: 'Freinage',
  electrique: 'Électrique',
  hydraulique: 'Hydraulique',
  carrosserie: 'Carrosserie',
  controle: 'Fiche de contrôle (NOK)',
  autre: 'Autre',
};

export const INTERVENTION_TYPE_AR: Record<InterventionType, string> = {
  vidange: 'تغيير الزيت',
  panne: 'عطب',
  pneumatique: 'العجلات',
  freinage: 'الفرامل',
  electrique: 'الكهرباء',
  hydraulique: 'الهيدروليك',
  carrosserie: 'الهيكل',
  controle: 'مراقبة',
  autre: 'أخرى',
};

export const PRIORITY: Record<Priority, [string, Tone]> = {
  basse: ['Basse', 'gray'],
  normale: ['Normale', 'blue'],
  haute: ['Haute', 'orange'],
  urgente: ['Urgente', 'red'],
};

export const INTERVENTION_STATUS: Record<InterventionStatus, [string, Tone]> = {
  nouvelle: ['Nouvelle', 'blue'],
  en_cours: ['En cours', 'amber'],
  terminee: ['Terminée', 'green'],
  rejetee: ['Rejetée', 'gray'],
};

export const ALERT_LEVEL: Record<AlertLevel, [string, Tone]> = {
  expire: ['Expiré', 'red'],
  urgent: ['Urgent', 'orange'],
  bientot: ['Bientôt', 'amber'],
  ok: ['OK', 'green'],
};

export type { Tone };
