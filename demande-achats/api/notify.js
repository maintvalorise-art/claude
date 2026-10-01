// Fonction serverless Vercel : envoi des emails de l'application Demandes d'Achat.
//
//  POST /api/notify  (en-tête Authorization: Bearer <jeton de session Supabase>)
//   { type: "envoi", demande_id, pdf_base64? }  -> email aux administrateurs (avec la fiche PDF en pièce jointe)
//   { type: "maj",   demande_id, quoi }         -> email au demandeur (statut / finance / réception mis à jour)
//
// Variables d'environnement (Vercel > Settings > Environment Variables) :
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY   (obligatoires)
//   RESEND_API_KEY, EMAIL_FROM                                   (emails via https://resend.com)
//   APP_URL       (ex : https://mon-app.vercel.app, pour le lien dans l'email)
//   ADMIN_EMAILS  (optionnel : adresses supplémentaires, séparées par des virgules)
// Sans RESEND_API_KEY, la fonction répond { email: false } : seules les notifications internes fonctionnent.

const LABELS = {
  brouillon: "Brouillon", en_attente: "En attente", en_cours: "En cours de traitement",
  validee: "Validée", refusee: "Refusée", non_requise: "Non requise",
  partielle: "Réception partielle", recue: "Reçue", non_conforme: "Non conforme"
};
const label = s => LABELS[s] || s || "—";
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n, devise) => n == null ? "—" :
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n)) + " " + devise;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  const env = process.env;
  const SUPABASE_URL = (env.SUPABASE_URL || "").replace(/\/$/, "");
  const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE || !env.SUPABASE_ANON_KEY) {
    return res.status(200).json({ email: false, raison: "Variables Supabase manquantes sur le serveur" });
  }
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return res.status(200).json({ email: false, raison: "Envoi d'emails non configuré (RESEND_API_KEY / EMAIL_FROM)" });
  }

  try {
    // 1. Identifier l'utilisateur à partir de son jeton de session
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!ur.ok) return res.status(401).json({ error: "Session invalide" });
    const user = await ur.json();

    const db = async path => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
      if (!r.ok) throw new Error("Lecture base : " + r.status + " " + (await r.text()));
      return r.json();
    };

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (!/^[0-9a-f-]{36}$/i.test(body.demande_id || "")) return res.status(400).json({ error: "demande_id invalide" });

    const [me] = await db(`profiles?id=eq.${user.id}&select=*`);
    const [da] = await db(`demandes?id=eq.${body.demande_id}&select=*`);
    if (!me || !me.actif) return res.status(403).json({ error: "Compte inactif" });
    if (!da) return res.status(404).json({ error: "Demande introuvable" });

    const devise = env.DEVISE || "MAD";
    const appUrl = (env.APP_URL || (req.headers.origin || "")).replace(/\/$/, "");
    const lien = appUrl ? `${appUrl}/#/da/${da.id}` : "";
    const lignes = Array.isArray(da.lignes) ? da.lignes : [];

    let to = [], subject = "", intro = "", attachments;

    if (body.type === "envoi") {
      // Seul le demandeur, juste après l'envoi, peut déclencher cet email
      if (da.user_id !== user.id) return res.status(403).json({ error: "Non autorisé" });
      if (da.statut !== "en_attente" || !da.date_envoi || Date.now() - new Date(da.date_envoi).getTime() > 15 * 60 * 1000) {
        return res.status(409).json({ error: "Email d'envoi déjà traité ou demande non envoyée" });
      }
      const admins = await db("profiles?role=eq.admin&actif=eq.true&select=email");
      to = admins.map(a => a.email).concat((env.ADMIN_EMAILS || "").split(",")).map(s => (s || "").trim()).filter(Boolean);
      subject = `Nouvelle demande d'achat ${da.numero} — ${da.demandeur_nom || ""}${da.urgence !== "Normal" ? " — " + da.urgence.toUpperCase() : ""}`;
      intro = `<p>Une nouvelle demande d'achat a été validée et envoyée par <b>${esc(da.demandeur_nom)}</b> (${esc(da.service)}).</p>`;
      const pdf = typeof body.pdf_base64 === "string" ? body.pdf_base64 : "";
      if (pdf.startsWith("JVBER") && pdf.length < 4_000_000) attachments = [{ filename: `${da.numero}.pdf`, content: pdf }];
    } else if (body.type === "maj") {
      if (me.role !== "admin") return res.status(403).json({ error: "Réservé aux administrateurs" });
      const [dem] = await db(`profiles?id=eq.${da.user_id}&select=email`);
      if (dem && dem.email) to = [dem.email];
      const quoi = body.quoi === "finance" ? `Finance : ${label(da.finance_statut)}`
                 : body.quoi === "reception" ? `Réception : ${label(da.reception_statut)}`
                 : label(da.statut);
      subject = `Votre demande d'achat ${da.numero} — ${quoi}`;
      intro = `<p>Bonjour ${esc(da.demandeur_nom)},</p><p>Votre demande d'achat <b>${esc(da.numero)}</b> a été mise à jour : <b>${esc(quoi)}</b>.</p>`;
    } else {
      return res.status(400).json({ error: "type inconnu" });
    }

    to = [...new Set(to)];
    if (!to.length) return res.status(200).json({ email: false, raison: "Aucun destinataire" });

    const ligneHtml = lignes.map(l => `<tr><td style="padding:4px 8px;border:1px solid #ddd">${esc(l.designation)}</td>
      <td style="padding:4px 8px;border:1px solid #ddd">${esc(l.reference || "")}</td>
      <td style="padding:4px 8px;border:1px solid #ddd">${esc(l.quantite)} ${esc(l.unite || "")}</td></tr>`).join("");
    const commentaire = da.commentaire_admin ? `<p style="background:#f4f6f9;padding:10px;border-left:4px solid #1f5fbf"><b>Commentaire de l'administration :</b><br>${esc(da.commentaire_admin)}</p>` : "";
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1d2733;max-width:640px">
      <h2 style="color:#1f5fbf;margin:0 0 12px">${esc(subject)}</h2>
      ${intro}
      <table style="border-collapse:collapse;margin:8px 0">
        <tr><td style="padding:3px 12px 3px 0;color:#66727f">N° DA</td><td><b>${esc(da.numero)}</b></td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#66727f">Statut</td><td>${esc(label(da.statut))}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#66727f">Validation finance</td><td>${esc(label(da.finance_statut))}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#66727f">Réception</td><td>${esc(label(da.reception_statut))}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#66727f">Urgence</td><td>${esc(da.urgence)}${da.impact ? " — impact " + esc(da.impact) : ""}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#66727f">Date souhaitée</td><td>${esc(da.date_souhaitee || "—")}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#66727f">Montant estimé</td><td>${esc(money(da.montant_estime, devise))}</td></tr>
      </table>
      ${commentaire}
      ${lignes.length ? `<table style="border-collapse:collapse;margin:8px 0"><tr style="background:#f4f6f9">
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Désignation</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Référence</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Quantité</th></tr>${ligneHtml}</table>` : ""}
      ${lien ? `<p><a href="${esc(lien)}" style="display:inline-block;background:#1f5fbf;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Ouvrir la demande</a></p>` : ""}
      <p style="color:#66727f;font-size:12px">Message automatique — procédure PR-ACH-001.</p></div>`;

    const r = await fetch(env.RESEND_API_URL || "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html, attachments })
    });
    if (!r.ok) return res.status(502).json({ email: false, raison: "Resend : " + r.status + " " + (await r.text()) });
    return res.status(200).json({ email: true, destinataires: to.length });
  } catch (err) {
    return res.status(500).json({ email: false, raison: err.message });
  }
};
