// E-mail quotidien des alertes : chaque destinataire reçoit les alertes de ses modules.
//  - achats  : acheteurs, direction        - magasin : magasiniers, acheteurs
//  - flotte  : responsables flotte          - bennes  : exploitation
//  - tout    : administrateurs + adresses de ALERT_EMAILS
// Planifié via pg_cron (voir README). Envoi par Resend (https://resend.com).
import { createClient } from 'npm:@supabase/supabase-js@2';

type Alerte = { module: string; niveau: 'expire' | 'urgent' | 'bientot'; titre: string; cible: string | null; detail: string | null; lien: string | null };

const MODULE_ROLES: Record<string, string[]> = {
  achats: ['acheteur', 'direction'],
  magasin: ['magasinier', 'acheteur'],
  flotte: ['responsable_flotte'],
  bennes: ['exploitation'],
};
const MODULES: Record<string, string> = { achats: 'Achats', magasin: 'Magasin', flotte: 'Flotte', bennes: 'Bennes' };
const NIVEAUX = { expire: ['Dépassé', '#b91c1c'], urgent: ['Urgent', '#c2410c'], bientot: ['Bientôt', '#a16207'] } as const;
const DOCS: Record<string, string> = {
  carte_grise: 'Carte grise', assurance: 'Assurance', visite_technique: 'Visite technique', vignette: 'Vignette',
  autorisation_transport: 'Autorisation de transport', autorisation_dechets_dangereux: 'Autorisation déchets dangereux',
  carnet_entretien: "Carnet d'entretien", tachygraphe: 'Tachygraphe', extincteur: 'Extincteurs', permis: 'Permis',
  carte_professionnelle: 'Carte professionnelle', visite_medicale: 'Visite médicale', autre: 'Document',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function render(alertes: Alerte[], appUrl: string) {
  const order = { expire: 0, urgent: 1, bientot: 2 };
  const byModule = new Map<string, Alerte[]>();
  for (const a of [...alertes].sort((x, y) => order[x.niveau] - order[y.niveau])) byModule.set(a.module, [...(byModule.get(a.module) ?? []), a]);
  let html = '<div style="font-family:Arial,sans-serif;font-size:14px"><h2>Alertes du jour – Valorise Maroc</h2>';
  for (const [m, list] of byModule) {
    html += `<h3>${MODULES[m] ?? m} (${list.length})</h3><table style="border-collapse:collapse;border:1px solid #ddd">`;
    for (const a of list) {
      const [label, color] = NIVEAUX[a.niveau];
      const titre = DOCS[a.titre] ?? a.titre;
      const link = appUrl && a.lien ? `<a href="${esc(appUrl + a.lien)}">ouvrir</a>` : '';
      html += `<tr><td style="padding:4px 8px;color:${color};font-weight:600">${label}</td><td style="padding:4px 8px">${esc(titre)}</td>`
        + `<td style="padding:4px 8px">${esc(a.cible ?? '')}</td><td style="padding:4px 8px">${esc(a.detail ?? '')}</td><td style="padding:4px 8px">${link}</td></tr>`;
    }
    html += '</table>';
  }
  return html + '</div>';
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (auth !== `Bearer ${serviceKey}` && !(cronSecret && auth === `Bearer ${cronSecret}`)) {
    return new Response('Non autorisé', { status: 401 });
  }
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return Response.json({ sent: 0, reason: 'RESEND_API_KEY manquant' });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const [{ data: alertes, error }, { data: profiles }] = await Promise.all([
    supabase.from('v_alertes').select('module, niveau, titre, cible, detail, lien').neq('niveau', 'ok'),
    supabase.from('profiles').select('email, role').eq('active', true),
  ]);
  if (error) return new Response(error.message, { status: 500 });
  if (!alertes?.length) return Response.json({ sent: 0, alertes: 0 });

  // Destinataires et modules suivis.
  const loginDomain = Deno.env.get('LOGIN_DOMAIN') ?? 'flotte.local';
  const recipients = new Map<string, Set<string>>();
  const add = (email: string, modules: string[]) => {
    if (!email || email.endsWith('@' + loginDomain)) return;
    const set = recipients.get(email) ?? new Set<string>();
    modules.forEach((m) => set.add(m));
    recipients.set(email, set);
  };
  for (const p of profiles ?? []) {
    if (!p.email) continue;
    if (p.role === 'admin') add(p.email, Object.keys(MODULES));
    for (const [m, roles] of Object.entries(MODULE_ROLES)) if (roles.includes(p.role)) add(p.email, [m]);
  }
  (Deno.env.get('ALERT_EMAILS') ?? '').split(',').map((s) => s.trim()).filter(Boolean).forEach((e) => add(e, Object.keys(MODULES)));

  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
  let sent = 0;
  for (const [email, modules] of recipients) {
    const list = (alertes as Alerte[]).filter((a) => modules.has(a.module));
    if (!list.length) continue;
    const nbExp = list.filter((a) => a.niveau === 'expire').length;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('ALERT_FROM') ?? 'Valorise Maroc <onboarding@resend.dev>',
        to: [email],
        subject: `[Valorise] ${list.length} alerte(s)${nbExp ? ` dont ${nbExp} dépassée(s)` : ''}`,
        html: render(list, appUrl),
      }),
    });
    if (res.ok) sent++;
  }
  return Response.json({ sent, alertes: alertes.length });
});
