export type Role =
  | 'admin' | 'direction' | 'acheteur' | 'magasinier'
  | 'responsable_flotte' | 'exploitation' | 'chauffeur' | 'demandeur';
export type AlertLevel = 'expire' | 'urgent' | 'bientot' | 'ok';
export type Module = 'achats' | 'magasin' | 'flotte' | 'bennes';

export interface Profile {
  id: string;
  full_name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  role: Role;
  service: string | null;
  manager_id: string | null;
  demandeur_autorise: boolean;
  active: boolean;
  created_at: string;
}

// ---------- Flotte ----------
export type VehicleType =
  | 'camion_porte_benne' | 'camion_plateau' | 'camion' | 'vehicule_leger'
  | 'chariot_elevateur' | 'chargeuse' | 'engin' | 'remorque' | 'autre';
export type VehicleStatus = 'disponible' | 'en_service' | 'en_panne' | 'en_maintenance' | 'immobilise' | 'hors_service';

export interface Vehicle {
  id: string;
  code_interne: string | null;
  matricule: string;
  numero_serie: string | null;
  type: VehicleType;
  marque: string | null;
  modele: string | null;
  annee: number | null;
  unite_compteur: 'km' | 'heures';
  compteur_actuel: number;
  conso_reference: number | null;
  statut: VehicleStatus;
  chauffeur_id: string | null;
  notes: string | null;
  actif: boolean;
  created_at: string;
}

export type DocumentType =
  | 'carte_grise' | 'assurance' | 'visite_technique' | 'vignette' | 'autorisation_transport'
  | 'autorisation_dechets_dangereux' | 'carnet_entretien' | 'tachygraphe' | 'extincteur'
  | 'permis' | 'carte_professionnelle' | 'visite_medicale' | 'autre';

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
  type: DocumentType;
  libelle: string | null;
  reference: string | null;
  vehicle_id: string | null;
  matricule: string | null;
  chauffeur_id: string | null;
  chauffeur_nom: string | null;
  date_expiration: string;
  jours_restants: number;
  niveau: AlertLevel;
}

export interface Alerte {
  module: Module;
  niveau: AlertLevel;
  categorie: string;
  ref_id: string;
  titre: string;
  cible: string | null;
  detail: string | null;
  lien: string | null;
}

export type PlanType = 'vidange' | 'preventive' | 'hydraulique' | 'pneus' | 'autre';
export interface PlanMaintenance {
  id: string;
  vehicle_id: string;
  type: PlanType;
  libelle: string;
  intervalle_compteur: number | null;
  intervalle_jours: number | null;
  dernier_compteur: number | null;
  derniere_date: string | null;
  alerte_compteur: number;
  alerte_jours: number;
  actif: boolean;
  // vue v_plans_maintenance
  matricule?: string;
  unite_compteur?: 'km' | 'heures';
  prochain_compteur?: number | null;
  prochaine_date?: string | null;
  reste_compteur?: number | null;
  reste_jours?: number | null;
}

export interface Pneu {
  id: string;
  vehicle_id: string | null;
  position: string | null;
  marque: string | null;
  dimension: string | null;
  numero_serie: string | null;
  date_montage: string | null;
  compteur_montage: number | null;
  statut: 'monte' | 'stock' | 'rebut';
  motif_retrait: string | null;
  created_at: string;
}

export type InterventionType =
  | 'vidange' | 'preventive' | 'panne' | 'pneumatique' | 'freinage' | 'electrique'
  | 'hydraulique' | 'carrosserie' | 'controle' | 'accident' | 'autre';
export type Priority = 'basse' | 'normale' | 'haute' | 'urgente';
export type InterventionStatus = 'nouvelle' | 'en_cours' | 'terminee' | 'rejetee';

export interface Intervention {
  id: string;
  numero: number;
  vehicle_id: string;
  demandeur_id: string | null;
  type: InterventionType;
  nature: 'preventive' | 'corrective';
  priorite: Priority;
  statut: InterventionStatus;
  titre: string;
  description: string | null;
  compteur: number | null;
  vehicule_immobilise: boolean;
  cause: string | null;
  assigne_a: string | null;
  reponse: string | null;
  cout: number | null;
  duree_immobilisation_h: number | null;
  plan_id: string | null;
  fiche_id: string | null;
  date_cloture: string | null;
  created_at: string;
  updated_at: string;
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
  valide_par: string | null;
  valide_le: string | null;
  commentaire_validation: string | null;
  created_at: string;
}

export interface ControlResult {
  sheet_id: string;
  item_id: number;
  ok: boolean;
  commentaire: string | null;
}

export type AccidentStatus = 'declare' | 'expertise' | 'indemnisation' | 'repare' | 'clos';
export interface Accident {
  id: string;
  numero: string;
  vehicle_id: string;
  chauffeur_id: string | null;
  declare_par: string | null;
  date_accident: string;
  lieu: string;
  tiers: string | null;
  description: string;
  constat_amiable: boolean;
  blesses: boolean;
  photos: string[];
  statut: AccidentStatus;
  assurance_reference: string | null;
  montant_indemnisation: number | null;
  franchise: number | null;
  cout_reparation: number | null;
  immobilisation_jours: number | null;
  causes: string | null;
  actions_correctives: string | null;
  created_at: string;
}

export interface Plein {
  id: string;
  vehicle_id: string;
  chauffeur_id: string | null;
  date_plein: string;
  litres: number;
  prix_litre: number | null;
  compteur: number;
  source: 'station' | 'cuve';
  station: string | null;
  bon_numero: string | null;
  saisi_par: string | null;
  created_at: string;
  // vue v_pleins
  matricule?: string;
  unite_compteur?: 'km' | 'heures';
  conso_reference?: number | null;
  compteur_precedent?: number | null;
  consommation?: number | null;
  montant?: number;
}

export type DestinationType = 'client' | 'decharge' | 'fournisseur' | 'depot' | 'autre';
export interface Trajet {
  id: string;
  vehicle_id: string;
  chauffeur_id: string | null;
  date_trajet: string;
  depart: string;
  destination: string;
  type_destination: DestinationType;
  client_id: string | null;
  compteur_depart: number;
  compteur_arrivee: number;
  benne_id: string | null;
  poids_kg: number | null;
  ticket_pesee: string | null;
  saisi_par: string | null;
  created_at: string;
}

// ---------- Bennes ----------
export interface Client {
  id: string;
  nom: string;
  adresse: string | null;
  contact: string | null;
  telephone: string | null;
  strategique: boolean;
  actif: boolean;
  created_at: string;
}

export type BenneStatut = 'depot' | 'chez_client' | 'transit' | 'vidage' | 'reparation';
export type BenneMotif = 'pose' | 'enlevement' | 'echange' | 'vidage' | 'retour_depot' | 'reparation' | 'verification';
export interface Benne {
  id: string;
  numero: string;
  code_barres: string | null;
  type: 'ampliroll' | 'chaines' | 'compacteur' | 'autre';
  volume_m3: number | null;
  dechet: string | null;
  etat: 'bon' | 'a_reparer' | 'hors_service';
  derniere_revision: string | null;
  statut: BenneStatut;
  client_id: string | null;
  depuis: string;
  derniere_verification: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_maj: string | null;
  actif: boolean;
  notes: string | null;
  created_at: string;
}

export interface MouvementBenne {
  id: string;
  benne_id: string;
  date_mouvement: string;
  motif: BenneMotif;
  vehicle_id: string | null;
  chauffeur_id: string | null;
  client_id: string | null;
  origine: string | null;
  destination: string | null;
  saisi_par: string | null;
  notes: string | null;
  created_at: string;
}

// ---------- Achats ----------
export type FournisseurStatut = 'prospect' | 'en_verification' | 'actif' | 'dereference';
export type Classification = 'strategique' | 'regulier' | 'occasionnel';
export interface Fournisseur {
  id: string;
  raison_sociale: string;
  ice: string | null;
  rc: string | null;
  if_fiscal: string | null;
  rib: string | null;
  adresse: string | null;
  contact_nom: string | null;
  telephone: string | null;
  email: string | null;
  categories: string[];
  certifications: string | null;
  conditions_paiement: string | null;
  delai_livraison_jours: number | null;
  classification: Classification;
  statut: FournisseurStatut;
  docs_legaux_ok: boolean;
  references_ok: boolean;
  notes: string | null;
  created_at: string;
}

export interface FournisseurScore {
  fournisseur_id: string;
  note_delai: number | null;
  note_qualite: number | null;
  note_prix: number | null;
  note_reactivite: number | null;
  note_conformite: number | null;
  score: number | null;
  nb_evaluations: number;
  derniere_evaluation_semestrielle: string | null;
}

export interface Contrat {
  id: string;
  fournisseur_id: string;
  type: 'contrat_cadre' | 'accord_prix' | 'conditions_generales';
  objet: string;
  categorie: string | null;
  prix: number | null;
  unite: string | null;
  delai_livraison_jours: number | null;
  conditions_paiement: string | null;
  garantie: string | null;
  penalites_retard: string | null;
  conditions_retour: string | null;
  date_debut: string | null;
  date_fin: string | null;
  actif: boolean;
  created_at: string;
}

export interface Evaluation {
  id: string;
  fournisseur_id: string;
  da_id: string | null;
  type: 'commande' | 'semestrielle';
  note_delai: number | null;
  note_qualite: number | null;
  note_prix: number | null;
  note_reactivite: number | null;
  note_conformite: number | null;
  commentaire: string | null;
  auteur_id: string | null;
  created_at: string;
}

export type Urgence = 'normal' | 'urgent' | 'arret_machine';
export type DAStatut =
  | 'soumise' | 'servie_stock' | 'attente_validation' | 'attente_direction' | 'validee'
  | 'commandee' | 'receptionnee' | 'cloturee' | 'rejetee' | 'annulee';

export interface DemandeAchat {
  id: string;
  numero: string;
  demandeur_id: string;
  service: string | null;
  vehicle_id: string | null;
  equipement: string | null;
  motif: string;
  urgence: Urgence;
  date_souhaitee: string | null;
  statut: DAStatut;
  auto: boolean;
  montant_estime: number | null;
  acheteur_id: string | null;
  prise_en_charge_le: string | null;
  valideur_id: string | null;
  valide_le: string | null;
  valideur_direction_id: string | null;
  valide_direction_le: string | null;
  fournisseur_id: string | null;
  bc_numero: string | null;
  bc_date: string | null;
  montant_commande: number | null;
  date_livraison_prevue: string | null;
  date_reception: string | null;
  bl_numero: string | null;
  facture_numero: string | null;
  rapprochement_ok: boolean | null;
  motif_rejet: string | null;
  created_at: string;
  updated_at: string;
}

export interface DALigne {
  id: string;
  da_id: string;
  article_id: string | null;
  designation: string;
  reference: string | null;
  quantite: number;
  unite: string;
  prix_unitaire: number | null;
  quantite_recue: number;
}

export interface Devis {
  id: string;
  da_id: string;
  fournisseur_id: string;
  reference: string | null;
  montant: number;
  delai_jours: number | null;
  conditions: string | null;
  retenu: boolean;
  created_at: string;
}

export interface DAHistorique {
  id: number;
  da_id: string;
  action: string;
  statut_avant: DAStatut | null;
  statut_apres: DAStatut | null;
  commentaire: string | null;
  auteur_id: string | null;
  created_at: string;
}

export interface DADelai {
  id: string;
  limite_prise_en_charge: string;
  limite_commande: string;
}

export interface PrixHistorique {
  id: number;
  article_id: string | null;
  designation: string;
  fournisseur_id: string | null;
  prix_unitaire: number;
  source: string;
  da_id: string | null;
  date_prix: string;
}

// ---------- Magasin ----------
export type Criticite = 'A' | 'B' | 'C';
export type ArticleCategorie =
  | 'mecanique' | 'electrique' | 'hydraulique' | 'pneumatique' | 'filtration' | 'pneus' | 'consommables' | 'autre';
export interface Article {
  id: string;
  code: string;
  code_barres: string | null;
  designation: string;
  categorie: ArticleCategorie;
  equipement: string | null;
  vehicle_id: string | null;
  ref_fabricant: string | null;
  criticite: Criticite;
  stock_min: number;
  stock_max: number;
  unite: string;
  emplacement: string | null;
  fournisseur_principal_id: string | null;
  fournisseur_secondaire_id: string | null;
  prix_unitaire: number | null;
  stock_actuel: number;
  actif: boolean;
  created_at: string;
}

export type MouvementType = 'entree' | 'sortie' | 'ajustement';
export interface MouvementStock {
  id: string;
  article_id: string;
  type: MouvementType;
  quantite: number;
  stock_apres: number | null;
  prix_unitaire: number | null;
  vehicle_id: string | null;
  equipement: string | null;
  demandeur: string | null;
  motif: string;
  da_id: string | null;
  intervention_id: string | null;
  auteur_id: string | null;
  commentaire: string | null;
  created_at: string;
}

export interface Inventaire {
  id: string;
  type: 'tournant' | 'complet';
  statut: 'en_cours' | 'cloture';
  auteur_id: string | null;
  nb_articles: number | null;
  nb_ecarts: number | null;
  date_cloture: string | null;
  created_at: string;
}

export interface InventaireLigne {
  inventaire_id: string;
  article_id: string;
  qte_theorique: number;
  qte_comptee: number | null;
}

export interface Parametre {
  cle: string;
  valeur: number;
  libelle: string;
}

export interface AuditEntry {
  id: number;
  table_name: string;
  record_id: string;
  action: string;
  auteur_id: string | null;
  donnees: Record<string, unknown> | null;
  created_at: string;
}

export interface Kpis {
  achats: {
    nb_da: number; delai_moyen_commande_h: number | null; pct_prise_en_charge_delai: number | null;
    pct_commande_delai: number | null; taux_service_fournisseurs: number | null;
    economies_negociees: number; montant_commande: number;
  };
  magasin: {
    valeur_stock: number; ruptures_a: number; sous_minimum: number;
    fiabilite_inventaire: number | null; articles_dormants: number;
  };
  flotte: {
    nb_vehicules: number; disponibilite_pct: number | null; cout_maintenance: number;
    conso_l_100km: number | null; conso_l_h: number | null; gasoil_litres: number;
    accidents: number; documents_expires: number; taux_fiches_controle: number | null;
  };
  bennes: {
    nb_bennes: number; chez_client: number; au_depot: number; rotations: number;
    taux_rotation: number | null; duree_moyenne_client_j: number | null; non_localisees: number;
  };
}
