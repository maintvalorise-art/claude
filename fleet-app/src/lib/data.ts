import { supabase } from './supabase';
import { must } from './useAsync';
import type { ControlItem, Vehicle } from './types';

export async function fetchVehicles(onlyActive = true): Promise<Vehicle[]> {
  let q = supabase.from('vehicles').select('*').order('matricule');
  if (onlyActive) q = q.eq('actif', true);
  return must(await q) as Vehicle[];
}

/** id -> nom de tous les utilisateurs actifs (accessible à tous les rôles). */
export async function fetchDriverNames(): Promise<Map<string, string>> {
  const rows = must(await supabase.rpc('list_drivers')) as { id: string; full_name: string }[];
  return new Map(rows.map((r) => [r.id, r.full_name]));
}

export async function fetchControlItems(includeInactive = false): Promise<ControlItem[]> {
  let q = supabase.from('control_items').select('*').order('ordre');
  if (!includeInactive) q = q.eq('actif', true);
  return must(await q) as ControlItem[];
}

/** Regroupe les points de contrôle par catégorie en conservant l'ordre. */
export function groupByCategory(items: ControlItem[]) {
  const groups: { categorie: string; items: ControlItem[] }[] = [];
  for (const it of items) {
    const g = groups.find((x) => x.categorie === it.categorie);
    if (g) g.items.push(it);
    else groups.push({ categorie: it.categorie, items: [it] });
  }
  return groups;
}
