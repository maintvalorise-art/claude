export type Role = 'chauffeur' | 'gestionnaire' | 'admin';
export type VehicleType = 'camion' | 'engin' | 'vehicule_leger' | 'remorque' | 'autre';
export type VehicleStatus = 'disponible' | 'en_service' | 'en_panne' | 'en_maintenance' | 'hors_service';
export type DocumentType =
  | 'visite_technique' | 'assurance' | 'vignette' | 'carte_grise' | 'tachygraphe'
  | 'extincteur' | 'autorisation' | 'permis' | 'carte_professionnelle' | 'visite_medicale' | 'autre';
export type InterventionType =
  | 'vidange' | 'panne' | 'pneumatique' | 'freinage' | 'electrique'
  | 'hydraulique' | 'carrosserie' | 'controle' | 'autre';
export type Priority = 'basse' | 'normale' | 'haute' | 'urgente';
export type InterventionStatus = 'nouvelle' | 'en_cours' | 'terminee' | 'rejetee';
export type AlertLevel = 'expire' | 'urgent' | 'bientot' | 'ok';

export interface Profile {
  id: string;
  full_name: string;
  username: string | null;
  phone: string | null;
  role: Role;
  active: boolean;
  created_at: string;
}

export interface Vehicle {
  id: string;
  matricule: string;
  type: VehicleType;
  marque: string | null;
  modele: string | null;
  annee: number | null;
  unite_compteur: 'km' | 'heures';
  compteur_actuel: number;
  prochaine_vidange: number | null;
  alerte_vidange: number;
  statut: VehicleStatus;
  chauffeur_id: string | null;
  notes: string | null;
  actif: boolean;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  vehicle_id: string | null;
  chauffeur_id: string | null;
  type: DocumentType;
  libelle: string | null;
  reference: string | null;
  date_emission: string | null;
  date_expiration: string;
  rappel_jours: number;
  notes: string | null;
  archive: boolean;
  created_at: string;
}

export interface Echeance {
  id: string;
  source: 'document' | 'vidange';
  type: DocumentType | 'vidange';
  libelle: string | null;
  reference: string | null;
  vehicle_id: string | null;
  matricule: string | null;
  chauffeur_id: string | null;
  chauffeur_nom: string | null;
  date_expiration: string | null;
  jours_restants: number | null;
  reste_compteur: number | null;
  niveau: AlertLevel;
}

export interface ControlItem {
  id: number;
  categorie: string;
  label_fr: string;
  label_ar: string | null;
  ordre: number;
  actif: boolean;
}

export interface ControlSheet {
  id: string;
  vehicle_id: string;
  chauffeur_id: string;
  conducteur_precedent_id: string | null;
  date_controle: string;
  compteur_depart: number;
  prochaine_vidange: number | null;
  remarques: string | null;
  nb_nok: number;
  created_at: string;
}

export interface ControlResult {
  sheet_id: string;
  item_id: number;
  ok: boolean;
  commentaire: string | null;
}

export interface Intervention {
  id: string;
  numero: number;
  vehicle_id: string;
  demandeur_id: string | null;
  type: InterventionType;
  priorite: Priority;
  statut: InterventionStatus;
  titre: string;
  description: string | null;
  compteur: number | null;
  vehicule_immobilise: boolean;
  assigne_a: string | null;
  reponse: string | null;
  cout: number | null;
  fiche_id: string | null;
  date_cloture: string | null;
  created_at: string;
  updated_at: string;
}
