import type {
  AccidentStatus, AlertLevel, ArticleCategorie, BenneMotif, BenneStatut, Classification, Criticite, DAStatut,
  DestinationType, DocumentType, FournisseurStatut, InterventionStatus, InterventionType, Module, MouvementType,
  PlanType, Priority, Role, Urgence, VehicleStatus, VehicleType,
} from './types';

export type Tone = 'gray' | 'green' | 'blue' | 'amber' | 'orange' | 'red' | 'violet';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  direction: 'Direction',
  acheteur: 'Acheteur',
  magasinier: 'Magasinier',
  responsable_flotte: 'Responsable flotte',
  exploitation: 'Exploitation / logistique',
  chauffeur: 'Chauffeur / conducteur',
  demandeur: 'Demandeur',
};

export const MODULE_LABELS: Record<Module, string> = {
  achats: 'Achats',
  magasin: 'Magasin',
  flotte: 'Flotte',
  bennes: 'Bennes',
};

// ---------- Flotte ----------
export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  camion_porte_benne: 'Camion porte-benne',
  camion_plateau: 'Camion plateau',
  camion: 'Camion',
  vehicule_leger: 'Véhicule léger',
  chariot_elevateur: 'Chariot élévateur',
  chargeuse: 'Chargeuse',
  engin: 'Engin',
  remorque: 'Remorque',
  autre: 'Autre',
};

export const VEHICLE_STATUS: Record<VehicleStatus, [string, Tone]> = {
  disponible: ['Disponible', 'green'],
  en_service: ['En service', 'blue'],
  en_panne: ['En panne', 'red'],
  en_maintenance: ['En maintenance', 'amber'],
  immobilise: ['Immobilisé', 'orange'],
  hors_service: ['Hors service', 'gray'],
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  carte_grise: 'Carte grise',
  assurance: 'Assurance',
  visite_technique: 'Visite technique',
  vignette: 'Vignette',
  autorisation_transport: 'Autorisation de transport',
  autorisation_dechets_dangereux: 'Autorisation déchets dangereux',
  carnet_entretien: "Carnet d'entretien",
  tachygraphe: 'Contrôle tachygraphe',
  extincteur: 'Extincteurs',
  permis: 'Permis de conduire',
  carte_professionnelle: 'Carte professionnelle',
  visite_medicale: 'Visite médicale',
  autre: 'Autre',
};

export const VEHICLE_DOCUMENT_TYPES: DocumentType[] = [
  'carte_grise', 'assurance', 'visite_technique', 'vignette', 'autorisation_transport',
  'autorisation_dechets_dangereux', 'carnet_entretien', 'tachygraphe', 'extincteur', 'autre',
];
export const DRIVER_DOCUMENT_TYPES: DocumentType[] = ['permis', 'carte_professionnelle', 'visite_medicale', 'autre'];

export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  vidange: 'Vidange moteur + filtres',
  preventive: 'Maintenance préventive',
  hydraulique: 'Hydraulique benne / bras',
  pneus: 'Pneus (permutation, contrôle)',
  autre: 'Autre',
};

export const INTERVENTION_TYPE_LABELS: Record<InterventionType, string> = {
  vidange: 'Vidange',
  preventive: 'Préventive',
  panne: 'Panne',
  pneumatique: 'Pneus',
  freinage: 'Freinage',
  electrique: 'Électrique',
  hydraulique: 'Hydraulique',
  carrosserie: 'Carrosserie',
  controle: 'Fiche de contrôle (non conforme)',
  accident: 'Accident',
  autre: 'Autre',
};

export const INTERVENTION_TYPE_AR: Record<InterventionType, string> = {
  vidange: 'تغيير الزيت',
  preventive: 'صيانة وقائية',
  panne: 'عطب',
  pneumatique: 'العجلات',
  freinage: 'الفرامل',
  electrique: 'الكهرباء',
  hydraulique: 'الهيدروليك',
  carrosserie: 'الهيكل',
  controle: 'مراقبة',
  accident: 'حادثة',
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

export const ACCIDENT_STATUS: Record<AccidentStatus, [string, Tone]> = {
  declare: ['Déclaré', 'red'],
  expertise: ['Expertise', 'orange'],
  indemnisation: ['Indemnisation', 'amber'],
  repare: ['Réparé', 'blue'],
  clos: ['Clos', 'green'],
};

export const DESTINATION_LABELS: Record<DestinationType, string> = {
  client: 'Client',
  decharge: 'Décharge',
  fournisseur: 'Fournisseur',
  depot: 'Dépôt',
  autre: 'Autre',
};

export const ALERT_LEVEL: Record<AlertLevel, [string, Tone]> = {
  expire: ['Dépassé', 'red'],
  urgent: ['Urgent', 'orange'],
  bientot: ['Bientôt', 'amber'],
  ok: ['OK', 'green'],
};

// ---------- Bennes ----------
export const BENNE_STATUT: Record<BenneStatut, [string, Tone]> = {
  depot: ['Au dépôt', 'green'],
  chez_client: ['Chez client', 'blue'],
  transit: ['En transit', 'violet'],
  vidage: ['En vidage', 'amber'],
  reparation: ['En réparation', 'red'],
};

export const BENNE_MOTIF_LABELS: Record<BenneMotif, string> = {
  pose: 'Pose chez client',
  enlevement: 'Enlèvement',
  echange: 'Échange (pose)',
  vidage: 'Vidage',
  retour_depot: 'Retour dépôt',
  reparation: 'Envoi en réparation',
  verification: 'Vérification (inventaire)',
};

export const BENNE_MOTIF_AR: Record<BenneMotif, string> = {
  pose: 'وضع عند الزبون',
  enlevement: 'سحب',
  echange: 'تبديل',
  vidage: 'إفراغ',
  retour_depot: 'رجوع للمستودع',
  reparation: 'إصلاح',
  verification: 'تحقق',
};

export const BENNE_TYPE_LABELS = { ampliroll: 'Ampliroll', chaines: 'À chaînes', compacteur: 'Compacteur', autre: 'Autre' } as const;
export const BENNE_ETAT: Record<'bon' | 'a_reparer' | 'hors_service', [string, Tone]> = {
  bon: ['Bon état', 'green'],
  a_reparer: ['À réparer', 'orange'],
  hors_service: ['Hors service', 'gray'],
};
export const DECHET_LABELS: Record<string, string> = {
  carton: 'Carton', plastique: 'Plastique', ferraille: 'Ferraille', aluminium: 'Aluminium',
  cuivre: 'Cuivre', bois: 'Bois', dangereux: 'Déchets dangereux', melange: 'Mélange', autre: 'Autre',
};

// ---------- Achats ----------
export const DA_STATUT: Record<DAStatut, [string, Tone]> = {
  soumise: ['Soumise', 'blue'],
  servie_stock: ['Servie (stock)', 'green'],
  attente_validation: ['À valider (responsable)', 'amber'],
  attente_direction: ['À valider (direction)', 'orange'],
  validee: ['Validée', 'violet'],
  commandee: ['Commandée', 'blue'],
  receptionnee: ['Réceptionnée', 'green'],
  cloturee: ['Clôturée', 'gray'],
  rejetee: ['Rejetée', 'red'],
  annulee: ['Annulée', 'gray'],
};

export const DA_OUVERTES: DAStatut[] = ['soumise', 'attente_validation', 'attente_direction', 'validee', 'commandee', 'receptionnee'];

export const URGENCE: Record<Urgence, [string, Tone]> = {
  normal: ['Normal', 'gray'],
  urgent: ['Urgent', 'orange'],
  arret_machine: ['Arrêt machine', 'red'],
};

export const DA_ACTION_LABELS: Record<string, string> = {
  creation: 'Création',
  prendre_en_charge: 'Prise en charge',
  servir_stock: 'Servie depuis le stock',
  envoyer_validation: 'Envoyée en validation',
  valider: 'Validation',
  rejeter: 'Rejet',
  commander: 'Bon de commande émis',
  receptionner: 'Réception',
  cloturer: 'Clôture',
  annuler: 'Annulation',
};

export const FOURNISSEUR_STATUT: Record<FournisseurStatut, [string, Tone]> = {
  prospect: ['Prospect', 'gray'],
  en_verification: ['En vérification', 'amber'],
  actif: ['Référencé', 'green'],
  dereference: ['Déréférencé', 'red'],
};

export const CLASSIFICATION: Record<Classification, [string, Tone]> = {
  strategique: ['Stratégique', 'violet'],
  regulier: ['Régulier', 'blue'],
  occasionnel: ['Occasionnel', 'gray'],
};

export const CONTRAT_TYPES = {
  contrat_cadre: 'Contrat-cadre',
  accord_prix: 'Accord de prix',
  conditions_generales: 'Conditions générales',
} as const;

export const ACHAT_CATEGORIES = [
  'Bois', 'Clous', 'Pneus', 'Huiles & lubrifiants', 'Filtres', 'Gasoil', 'Pièces mécaniques',
  'Pièces hydrauliques', 'Électricité', 'EPI', 'Consommables', 'Services', 'Autre',
];

// ---------- Magasin ----------
export const ARTICLE_CATEGORIE: Record<ArticleCategorie, string> = {
  mecanique: 'Mécanique',
  electrique: 'Électrique',
  hydraulique: 'Hydraulique',
  pneumatique: 'Pneumatique',
  filtration: 'Filtration',
  pneus: 'Pneus',
  consommables: 'Consommables',
  outillage: 'Outillage',
  epi: 'EPI (équipement de protection)',
  fournitures_bureau: 'Fournitures de bureau',
  matiere_premiere: 'Matière première',
  autre: 'Autre',
};

export const CRITICITE: Record<Criticite, [string, Tone]> = {
  A: ['A · Critique', 'red'],
  B: ['B · Importante', 'amber'],
  C: ['C · Courante', 'gray'],
};

export const MOUVEMENT_TYPE: Record<MouvementType, [string, Tone]> = {
  entree: ['Entrée', 'green'],
  sortie: ['Sortie', 'orange'],
  ajustement: ['Ajustement', 'violet'],
};

export const MOUVEMENT_MOTIF: Record<string, string> = {
  reception: 'Réception commande',
  reparation: 'Réparation',
  preventif: 'Préventif',
  consommation: 'Consommation',
  inventaire: 'Inventaire',
  retour: 'Retour',
  stock_initial: 'Stock initial',
  autre: 'Autre',
};

/** Options [valeur, libellé] pour un <Select> à partir d'un dictionnaire. */
export function options<K extends string>(map: Record<K, string | [string, Tone]>): [K, string][] {
  return (Object.keys(map) as K[]).map((k) => {
    const v: string | [string, Tone] = map[k];
    return [k, typeof v === 'string' ? v : v[0]];
  });
}

/** Titre lisible d'une alerte (les papiers arrivent avec leur code de type). */
export function alerteTitre(a: { categorie: string; titre: string }) {
  return a.categorie === 'document' ? DOCUMENT_TYPE_LABELS[a.titre as DocumentType] ?? a.titre : a.titre;
}
