// Gestion des comptes (réservé aux admins) : création, mot de passe, activation.
// Les chauffeurs se connectent avec un identifiant simple (ex. « ahmed ») qui est
// converti en e-mail technique « ahmed@<LOGIN_DOMAIN> ».
import { createClient } from 'npm:@supabase/supabase-js@2';

const LOGIN_DOMAIN = Deno.env.get('LOGIN_DOMAIN') ?? 'flotte.local';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function toEmail(username: string) {
  const u = username.trim().toLowerCase();
  return u.includes('@') ? u : `${u}@${LOGIN_DOMAIN}`;
}

const ROLES = ['chauffeur', 'gestionnaire', 'admin'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Vérifie que l'appelant est un admin actif.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller.user) return json({ error: 'Non authentifié' }, 401);
  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role, active')
    .eq('id', caller.user.id)
    .single();
  if (!callerProfile?.active || callerProfile.role !== 'admin') return json({ error: 'Accès réservé aux administrateurs' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }
  const action = body.action as string;

  if (action === 'create') {
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    const fullName = String(body.full_name ?? '').trim();
    const role = String(body.role ?? 'chauffeur');
    if (!/^[a-zA-Z0-9._@-]{3,}$/.test(username)) return json({ error: 'Identifiant invalide (3 caractères min., lettres/chiffres/._-)' }, 400);
    if (password.length < 6) return json({ error: 'Mot de passe : 6 caractères minimum' }, 400);
    if (!ROLES.includes(role)) return json({ error: 'Rôle invalide' }, 400);

    const { data, error } = await admin.auth.admin.createUser({
      email: toEmail(username),
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) return json({ error: error.message }, 400);

    const { error: upErr } = await admin
      .from('profiles')
      .update({ full_name: fullName || username, role, phone: body.phone ?? null })
      .eq('id', data.user.id);
    if (upErr) return json({ error: upErr.message }, 400);
    return json({ id: data.user.id });
  }

  if (action === 'set_password') {
    const password = String(body.password ?? '');
    if (password.length < 6) return json({ error: 'Mot de passe : 6 caractères minimum' }, 400);
    const { error } = await admin.auth.admin.updateUserById(String(body.user_id), { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === 'set_active') {
    const userId = String(body.user_id);
    if (userId === caller.user.id) return json({ error: 'Impossible de désactiver votre propre compte' }, 400);
    const active = Boolean(body.active);
    const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : '876000h' });
    if (error) return json({ error: error.message }, 400);
    await admin.from('profiles').update({ active }).eq('id', userId);
    return json({ ok: true });
  }

  return json({ error: 'Action inconnue' }, 400);
});
