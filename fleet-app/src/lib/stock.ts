import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/** Plan du magasin : racks A à G, 4 étages (1 = en bas), N cases par étage (paramètre). */
export const RACKS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
export const ETAGES = 4;
export const CASES_DEFAUT = 8;

export interface Emplacement { rack: string; etage: number; case: number }

/** « A-2-3 » → rack A, étage 2, case 3. Renvoie null si l'emplacement n'est pas au format du plan. */
export function parseEmplacement(s: string | null | undefined): Emplacement | null {
  const m = /^\s*([A-G])\s*-\s*([1-9])\s*-\s*(\d{1,2})\s*$/i.exec(s ?? '');
  if (!m) return null;
  const etage = Number(m[2]);
  const c = Number(m[3]);
  if (etage > ETAGES || c < 1) return null;
  return { rack: m[1].toUpperCase(), etage, case: c };
}

export function formatEmplacement(e: Emplacement) {
  return `${e.rack}-${e.etage}-${e.case}`;
}

export function libelleEmplacement(s: string | null | undefined) {
  const e = parseEmplacement(s);
  return e ? `Rack ${e.rack} · étage ${e.etage} · case ${e.case}` : s ?? '';
}

let casesCache: number | null = null;

/** Nombre de cases par étage, réglable dans Paramètres. */
export function useCasesParEtage() {
  const [n, setN] = useState(casesCache ?? CASES_DEFAUT);
  useEffect(() => {
    if (casesCache != null) return;
    let cancelled = false;
    supabase.from('parametres').select('valeur').eq('cle', 'magasin_cases_par_etage').maybeSingle().then(({ data }) => {
      const v = Math.min(30, Math.max(1, Math.round(Number(data?.valeur) || CASES_DEFAUT)));
      casesCache = v;
      if (!cancelled) setN(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return n;
}
