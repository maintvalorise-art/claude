import type { Profile, Role } from './types';

/** Matrice des droits par profil (miroir des règles RLS de la base). */
const PERMISSIONS = {
  // Achats
  achatsVoirTout: ['admin', 'direction', 'acheteur', 'magasinier'],
  achatsTraiter: ['admin', 'acheteur'],
  fournisseursVoir: ['admin', 'direction', 'acheteur', 'magasinier', 'responsable_flotte'],
  fournisseursGerer: ['admin', 'acheteur'],
  // Magasin
  magasinVoir: ['admin', 'direction', 'magasinier', 'acheteur', 'responsable_flotte'],
  magasinGerer: ['admin', 'magasinier'],
  // Flotte
  flotteVoir: ['admin', 'direction', 'responsable_flotte'],
  flotteGerer: ['admin', 'responsable_flotte'],
  // Bennes
  bennesVoir: ['admin', 'direction', 'exploitation', 'responsable_flotte'],
  bennesGerer: ['admin', 'exploitation'],
  bennesMouvement: ['admin', 'exploitation', 'chauffeur', 'responsable_flotte'],
  // Terrain (chauffeurs et conducteurs d'engins)
  terrain: ['admin', 'chauffeur', 'responsable_flotte', 'exploitation'],
  // Pilotage
  kpi: ['admin', 'direction', 'acheteur', 'magasinier', 'responsable_flotte', 'exploitation'],
  admin: ['admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(profile: Profile | null | undefined, perm: Permission): boolean {
  if (!profile?.active) return false;
  return (PERMISSIONS[perm] as readonly Role[]).includes(profile.role);
}

/** Liste des demandeurs autorisés à émettre une demande d'achat. */
export function canRequestPurchase(profile: Profile | null | undefined): boolean {
  if (!profile?.active) return false;
  return (
    profile.demandeur_autorise ||
    ['admin', 'direction', 'acheteur', 'magasinier', 'responsable_flotte', 'demandeur'].includes(profile.role)
  );
}

/** Description courte des accès de chaque profil (affichée dans la gestion des comptes). */
export const ROLE_ACCESS: Record<Role, string> = {
  admin: 'Tous les modules, comptes et paramètres',
  direction: 'Lecture de tous les modules, validation des DA au-delà du seuil, indicateurs',
  acheteur: 'Traitement des DA, devis, bons de commande, fournisseurs et termes ; lecture du stock',
  magasinier: 'Articles, entrées/sorties par scan, inventaires, vérification stock des DA, réceptions',
  responsable_flotte: 'Véhicules, papiers, maintenance, pneus, fiches de contrôle, accidents, gasoil, trajets',
  exploitation: 'Bennes, clients et mouvements de bennes',
  chauffeur: 'Fiche de contrôle, demandes d\'intervention, gasoil, trajets, scan des bennes, déclaration d\'accident',
  demandeur: 'Émission et suivi de ses demandes d\'achat ; validation des DA de son équipe',
};
