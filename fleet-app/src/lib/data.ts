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

/** Comptes (création, mot de passe, activation) via les fonctions SQL réservées aux admins. */
export async function adminUsers(body: Record<string, unknown>) {
  const str = (v: unknown) => (v == null || v === '' ? null : String(v));
  const call = (fn: string, args: Record<string, unknown>) => supabase.rpc(fn, args);
  const { data, error } = body.action === 'create'
    ? await call('admin_creer_compte', {
      p_username: str(body.username), p_password: str(body.password), p_full_name: str(body.full_name), p_role: str(body.role) ?? 'chauffeur',
      p_phone: str(body.phone), p_service: str(body.service), p_manager_id: str(body.manager_id), p_demandeur_autorise: Boolean(body.demandeur_autorise),
    })
    : body.action === 'set_password'
      ? await call('admin_mot_de_passe', { p_user_id: body.user_id, p_password: str(body.password) })
      : await call('admin_activer_compte', { p_user_id: body.user_id, p_active: Boolean(body.active) });
  if (error) throw new Error(error.code === 'PGRST202' ? "Lancez d'abord le script SQL des comptes dans Supabase." : error.message);
  return data;
}
