import { createClient } from '@supabase/supabase-js';

// Tolère les copier-coller imparfaits : espaces, « / » final ou « /rest/v1 » en trop.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/(rest|auth)\/v1\/?$/, '').replace(/\/+$/, '');
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-key');

const LOGIN_DOMAIN = (import.meta.env.VITE_LOGIN_DOMAIN as string | undefined) ?? 'flotte.local';

/** « ahmed » -> « ahmed@flotte.local » ; une adresse e-mail complète est laissée telle quelle. */
export function loginToEmail(login: string) {
  const l = login.trim().toLowerCase();
  return l.includes('@') ? l : `${l}@${LOGIN_DOMAIN}`;
}

/** Message d'erreur lisible depuis une erreur Supabase / JS. */
export function errorMessage(e: unknown): string {
  if (!e) return 'Erreur inconnue';
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}
