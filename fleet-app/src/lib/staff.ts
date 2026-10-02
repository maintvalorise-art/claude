import { supabase } from './supabase';
import { must } from './useAsync';
import type { Profile } from './types';

/** Tous les profils (réservé au staff via RLS). */
export async function fetchProfiles(): Promise<Profile[]> {
  return must(await supabase.from('profiles').select('*').order('full_name')) as Profile[];
}

/** Appelle la fonction Edge « admin-users » et renvoie un message d'erreur lisible. */
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
