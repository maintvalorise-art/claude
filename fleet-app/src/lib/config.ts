import type { Module } from './types';

/**
 * Modules affichés dans l'application. Par défaut : Fleet management et Gestion de stock.
 * Pour réactiver d'autres modules (déjà présents dans la base), définir par exemple
 * VITE_MODULES=flotte,achats,magasin,bennes dans les variables d'environnement.
 */
const raw = ((import.meta.env.VITE_MODULES as string | undefined) ?? 'flotte,magasin').split(',').map((s) => s.trim()).filter(Boolean);
export const MODULES_ACTIFS = new Set<Module>(raw.length ? (raw as Module[]) : ['flotte', 'magasin']);

export function moduleOn(m: Module) {
  return MODULES_ACTIFS.has(m);
}
