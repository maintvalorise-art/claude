import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/** Plan du magasin : racks A à G le long des murs, 4 étages (1 = en bas), N cases par étage selon le rack. */
export const RACKS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
export type Rack = (typeof RACKS)[number];
export const ETAGES = 4;

/**
 * Disposition d'après le plan du magasin (vue de dessus, entrée en bas) :
 *        C          D
 *   B                    E
 *        A  [entrée]  G    F
 * cx / cz : centre du rack en mètres (x vers la droite, z vers l'entrée) ;
 * angle : rotation pour que la face avant du rack regarde le centre du magasin ;
 * cases : nombre de cases par étage par défaut (réglable dans Paramètres).
 */
export const PLAN: Record<Rack, { cx: number; cz: number; angle: number; cases: number }> = {
  A: { cx: -5.1, cz: 3.3, angle: Math.PI, cases: 6 },
  B: { cx: -7.6, cz: -0.4, angle: Math.PI / 2, cases: 4 },
  C: { cx: -4.6, cz: -3.6, angle: 0, cases: 5 },
  D: { cx: 3.6, cz: -3.6, angle: 0, cases: 8 },
  E: { cx: 7.9, cz: -0.2, angle: -Math.PI / 2, cases: 4 },
  F: { cx: 6.6, cz: 3.3, angle: Math.PI, cases: 4 },
  G: { cx: 2.2, cz: 3.3, angle: Math.PI, cases: 3 },
};
/** Ouverture de l'entrée dans le mur du bas, entre A et G (x en mètres). */
export const ENTREE = { x: -0.8, largeur: 2.4 };

export type CasesParRack = Record<Rack, number>;
export const CASES_DEFAUT = Object.fromEntries(RACKS.map((r) => [r, PLAN[r].cases])) as CasesParRack;

export interface Emplacement { rack: Rack; etage: number; case: number }

/** « A-2-3 » → rack A, étage 2, case 3. Renvoie null si l'emplacement n'est pas au format du plan. */
export function parseEmplacement(s: string | null | undefined): Emplacement | null {
  const m = /^\s*([A-G])\s*-\s*([1-9])\s*-\s*(\d{1,2})\s*$/i.exec(s ?? '');
  if (!m) return null;
  const etage = Number(m[2]);
  const c = Number(m[3]);
  if (etage > ETAGES || c < 1) return null;
  return { rack: m[1].toUpperCase() as Rack, etage, case: c };
}

export function formatEmplacement(e: Emplacement) {
  return `${e.rack}-${e.etage}-${e.case}`;
}

export function libelleEmplacement(s: string | null | undefined) {
  const e = parseEmplacement(s);
  return e ? `Rack ${e.rack} · étage ${e.etage} · case ${e.case}` : s ?? '';
}

let casesCache: CasesParRack | null = null;

/** Nombre de cases par étage de chaque rack (paramètres magasin_cases_A … magasin_cases_G). */
export function useCasesParRack() {
  const [cases, setCases] = useState<CasesParRack>(casesCache ?? CASES_DEFAUT);
  useEffect(() => {
    if (casesCache) return;
    let cancelled = false;
    supabase.from('parametres').select('cle, valeur').like('cle', 'magasin_cases_%').then(({ data }) => {
      const out = { ...CASES_DEFAUT };
      for (const p of (data ?? []) as { cle: string; valeur: number }[]) {
        const r = p.cle.slice(-1).toUpperCase() as Rack;
        if (RACKS.includes(r)) out[r] = Math.min(30, Math.max(1, Math.round(Number(p.valeur) || out[r])));
      }
      casesCache = out;
      if (!cancelled) setCases(out);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return cases;
}
