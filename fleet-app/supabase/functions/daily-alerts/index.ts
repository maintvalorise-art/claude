// Envoie chaque jour un e-mail récapitulatif des échéances proches ou dépassées
// (visite technique, assurance, tachygraphe, permis, vidange...).
// Planifié via pg_cron (voir README). E-mail envoyé avec Resend (https://resend.com).
import { createClient } from 'npm:@supabase/supabase-js@2';

type Echeance = {
  type: string;
  libelle: string | null;
  matricule: string | null;
  chauffeur_nom: string | null;
  date_expiration: string | null;
  jours_restants: number | null;
  reste_compteur: number | null;
  niveau: 'expire' | 'urgent' | 'bientot' | 'ok';
};

const TYPES: Record<string, string> = {
  visite_technique: 'Visite technique',
  assurance: 'Assurance',
  vignette: 'Vignette',
  carte_grise: 'Carte grise',
  tachygraphe: 'Contrôle tachygraphe',
  extincteur: 'Extincteurs',
  autorisation: 'Autorisation de circulation',
  permis: 'Permis de conduire',
  carte_professionnelle: 'Carte professionnelle',
  visite_medicale: 'Visite médicale',
  vidange: 'Vidange',
  autre: 'Autre',
};

const NIVEAUX = { expire: ['Expiré', '#b91c1c'], urgent: ['Urgent', '#c2410c'], bientot: ['Bientôt', '#a16207'] } as const;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function echeanceTexte(e: Echeance) {
  if (e.type === 'vidange') {
    const r = e.reste_compteur ?? 0;
    return r <= 0 ? `dépassée de ${Math.abs(r)}` : `dans ${r}`;
  }
  const j = e.jours_restants ?? 0;
  const date = e.date_expiration ? new Date(e.date_expiration).toLocaleDateString('fr-FR') : '';
  if (j < 0) return `expiré depuis ${-j} j (${date})`;
  if (j === 0) return `expire aujourd'hui (${date})`;
  return `dans ${j} j (${date})`;
}

Deno.serve(async (req) => {
  // Protection simple : l'appel doit fournir la clé service_role (pg_cron) ou CRON_SECRET.
  const auth = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (auth !== `Bearer ${serviceKey}` && !(cronSecret && auth === `Bearer ${cronSecret}`)) {
    return new Response('Non autorisé', { status: 401 });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const { data, error } = await supabase
    .from('v_echeances')
    .select('type, libelle, matricule, chauffeur_nom, date_expiration, jours_restants, reste_compteur, niveau')
    .neq('niveau', 'ok');
  if (error) return new Response(error.message, { status: 500 });

  const rows = (data as Echeance[]).sort((a, b) => {
    const order = { expire: 0, urgent: 1, bientot: 2, ok: 3 };
    return order[a.niveau] - order[b.niveau];
  });
  if (rows.length === 0) return Response.json({ sent: false, count: 0 });

  // Destinataires : ALERT_EMAILS (séparés par des virgules).
  const to = (Deno.env.get('ALERT_EMAILS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey || to.length === 0) {
    return Response.json({ sent: false, count: rows.length, reason: 'RESEND_API_KEY ou ALERT_EMAILS manquant' });
  }

  const lignes = rows
    .map((e) => {
      const [label, color] = NIVEAUX[e.niveau as keyof typeof NIVEAUX];
      const cible = e.matricule ?? e.chauffeur_nom ?? '';
      return `<tr>
        <td style="padding:6px 10px;color:${color};font-weight:600">${label}</td>
        <td style="padding:6px 10px">${escapeHtml(TYPES[e.type] ?? e.type)}${e.libelle ? ' – ' + escapeHtml(e.libelle) : ''}</td>
        <td style="padding:6px 10px">${escapeHtml(cible)}</td>
        <td style="padding:6px 10px">${escapeHtml(echeanceTexte(e))}</td>
      </tr>`;
    })
    .join('');

  const nbExp = rows.filter((r) => r.niveau === 'expire').length;
  const html = `<div style="font-family:Arial,sans-serif">
    <h2>Échéances de la flotte</h2>
    <p>${rows.length} échéance(s) à traiter, dont <b>${nbExp}</b> déjà dépassée(s).</p>
    <table style="border-collapse:collapse;border:1px solid #ddd">
      <thead><tr style="background:#f3f4f6;text-align:left">
        <th style="padding:6px 10px">Niveau</th><th style="padding:6px 10px">Échéance</th>
        <th style="padding:6px 10px">Véhicule / chauffeur</th><th style="padding:6px 10px">Délai</th>
      </tr></thead>
      <tbody>${lignes}</tbody>
    </table>
  </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('ALERT_FROM') ?? 'Flotte <onboarding@resend.dev>',
      to,
      subject: `[Flotte] ${rows.length} échéance(s) à traiter${nbExp ? ` – ${nbExp} dépassée(s)` : ''}`,
      html,
    }),
  });
  if (!res.ok) return new Response(await res.text(), { status: 502 });
  return Response.json({ sent: true, count: rows.length });
});
