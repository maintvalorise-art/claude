import { supabase } from './supabase';
import { must } from './useAsync';
import type { Article, Client, ControlItem, Fournisseur, Profile, Role, Vehicle } from './types';

export async function fetchVehicles(onlyActive = true): Promise<Vehicle[]> {
  let q = supabase.from('vehicles').select('*').order('matricule');
  if (onlyActive) q = q.eq('actif', true);
  return must(await q) as Vehicle[];
}

export interface Person { id: string; full_name: string; role: Role }

/** Tous les utilisateurs actifs (nom + rôle), accessible à tous. */
export async function fetchPeople(): Promise<Person[]> {
  return must(await supabase.rpc('list_drivers')) as Person[];
}

export async function fetchDriverNames(): Promise<Map<string, string>> {
  return new Map((await fetchPeople()).map((r) => [r.id, r.full_name]));
}

/** Profils complets (selon les droits : soi-même, son équipe ou tous pour les responsables). */
export async function fetchProfiles(): Promise<Profile[]> {
  return must(await supabase.from('profiles').select('*').order('full_name')) as Profile[];
}

export async function fetchFournisseurs(): Promise<Fournisseur[]> {
  return must(await supabase.from('fournisseurs').select('*').order('raison_sociale')) as Fournisseur[];
}

export async function fetchClients(): Promise<Client[]> {
  return must(await supabase.from('clients').select('*').eq('actif', true).order('nom')) as Client[];
}

export async function fetchArticles(onlyActive = true): Promise<Article[]> {
  let q = supabase.from('articles').select('*').order('code');
  if (onlyActive) q = q.eq('actif', true);
  return must(await q) as Article[];
}

export async function fetchControlItems(includeInactive = false): Promise<ControlItem[]> {
  let q = supabase.from('control_items').select('*').order('ordre');
  if (!includeInactive) q = q.eq('actif', true);
  return must(await q) as ControlItem[];
}

export function groupByCategory(items: ControlItem[]) {
  const groups: { categorie: string; items: ControlItem[] }[] = [];
  for (const it of items) {
    const g = groups.find((x) => x.categorie === it.categorie);
    if (g) g.items.push(it);
    else groups.push({ categorie: it.categorie, items: [it] });
  }
  return groups;
}

export function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

/** Libellé court d'un véhicule : « CAM-12 · 12345-A-6 ». */
export function vehicleLabel(v: Vehicle | undefined | null) {
  if (!v) return '—';
  return [v.code_interne, v.matricule].filter(Boolean).join(' · ');
}

/** Téléverse des photos dans le stockage Supabase et renvoie leurs chemins. */
export async function uploadPhotos(bucket: string, folder: string, files: FileList | File[]): Promise<string[]> {
  const paths: string[] = [];
  for (const file of Array.from(files)) {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type || 'image/jpeg' });
    if (error) throw error;
    paths.push(path);
  }
  return paths;
}

/** Appelle la fonction Edge « admin-users » (création de comptes, mots de passe, activation). */
export async function adminUsers(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let msg = error.message;
    if (ctx && typeof ctx.json === 'function') {
      try {
        msg = ((await ctx.json()) as { error?: string }).error ?? msg;
      } catch {
        /* réponse non JSON */
      }
    }
    throw new Error(msg);
  }
  return data;
}
