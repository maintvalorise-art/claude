// Fonction serverless Vercel : envoi des emails de l'application Demandes d'Achat.
//
//  POST /api/notify  (en-tête Authorization: Bearer <jeton de session Supabase>)
//   { type: "envoi", demande_id, pdf_base64? }  -> email aux administrateurs (avec la fiche PDF en pièce jointe)
//   { type: "maj",   demande_id, quoi }         -> email au demandeur (statut / finance / réception mis à jour)
//
// Variables d'environnement (Vercel > Settings > Environment Variables) :
//   RESEND_API_KEY   (obligatoire – clé https://resend.com)
//   EMAIL_FROM       (optionnel, défaut : "Achats <onboarding@resend.dev>")
//   SUPABASE_URL, SUPABASE_ANON_KEY (optionnels si renseignés dans api/_public-config.js)
//   SUPABASE_SERVICE_ROLE_KEY (optionnel)
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

// Valeurs publiques de secours (URL + clé anon), utilisées si les variables Vercel ne sont pas définies.
let PUB = {};
try { PUB = require("./_public-config.js"); } catch (e) { PUB = {}; }

module.exports = async (req, res) => {
  const env = process.env;
  const SUPABASE_URL = String(env.SUPABASE_URL || PUB.SUPABASE_URL || "").trim().replace(/\/(rest|auth)\/v1\/?$/, "").replace(/\/+$/, "");
  const ANON = String(env.SUPABASE_ANON_KEY || PUB.SUPABASE_ANON_KEY || "").trim();
  const SERVICE = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();          // optionnelle
  const RESEND = String(env.RESEND_API_KEY || "").trim();
  const FROM = String(env.EMAIL_FROM || "").trim() || "Achats <onboarding@resend.dev>";

  // Diagnostic : ouvrir /api/notify dans le navigateur indique ce qui est configuré (sans afficher les clés).
  if (req.method === "GET") {
    const manquantes = [];
    if (!SUPABASE_URL) manquantes.push("SUPABASE_URL");
    if (!ANON) manquantes.push("SUPABASE_ANON_KEY");
    if (!RESEND) manquantes.push("RESEND_API_KEY");
    let resend = null;
    if (RESEND) {
      try {
        const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${RESEND}` } });
        const j = await r.json().catch(() => ({}));
        if (r.ok) resend = { cle_valide: true, domaines: (j.data || []).map(d => `${d.name} (${d.status})`) };
        else if (/restricted to only send/i.test(j.message || "")) resend = { cle_valide: true, acces: "envoi uniquement (Sending access) : normal" };
        else resend = { cle_valide: (r.status === 401 || r.status === 403) ? false : null, statut_http: r.status, message: j.message };
      } catch (e) { resend = { erreur: e.message }; }
    }
    return res.status(200).json({
      emails_actives: manquantes.length === 0,
      variables_manquantes: manquantes,
      supabase: SUPABASE_URL || null,
      email_from: FROM,
      admin_emails_supplementaires: (env.ADMIN_EMAILS || "").split(",").map(x => x.trim()).filter(Boolean).length,
      resend
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  if (!SUPABASE_URL || !ANON) return res.status(200).json({ email: false, raison: "Configuration Supabase absente côté serveur" });
  if (!RESEND) return res.status(200).json({ email: false, raison: "Clé Resend absente : ajoutez la variable RESEND_API_KEY dans Vercel (Production) puis redéployez" });

  try {
    // 1. Identifier l'utilisateur à partir de son jeton de session
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
    if (!ur.ok) return res.status(401).json({ error: "Session invalide" });
    const user = await ur.json();

    // Lecture de la base : avec la clé service_role si elle existe, sinon avec les droits de l'utilisateur (règles RLS)
    const headers = SERVICE ? (SERVICE.startsWith("sb_") ? { apikey: SERVICE } : { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` })
                            : { apikey: ANON, Authorization: `Bearer ${token}` };
    const db = async (path, init) => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, Object.assign({ headers: Object.assign({ "Content-Type": "application/json" }, headers) }, init || {}));
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
      let admins = [];
      try { admins = await db("rpc/emails_admins", { method: "POST", body: "{}" }); }
      catch (e) { if (!env.ADMIN_EMAILS) return res.status(200).json({ email: false, raison: "Fonction SQL emails_admins absente : exécutez le complément SQL dans Supabase" }); }
      to = (admins || []).map(a => typeof a === "string" ? a : (a.emails_admins || a.email)).concat((env.ADMIN_EMAILS || "").split(",")).map(s => (s || "").trim()).filter(Boolean);
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
        ${da.societe ? `<tr><td style="padding:3px 12px 3px 0;color:#66727f">Société</td><td>${esc(da.societe)}</td></tr>` : ""}
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

    // Un envoi par destinataire : si Resend refuse une adresse (ex. mode test), les autres reçoivent quand même.
    const envoyes = [], refus = [];
    for (const dest of to) {
      const r = await fetch(env.RESEND_API_URL || "https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [dest], subject, html, attachments })
      });
      if (r.ok) envoyes.push(dest);
      else {
        const j = await r.json().catch(() => ({}));
        refus.push(`${dest} (${/testing emails/i.test(j.message || "") ? "mode test Resend : domaine non vérifié" : (j.message || "HTTP " + r.status)})`);
      }
    }
    if (!envoyes.length) return res.status(502).json({ email: false, raison: "Resend a refusé : " + refus.join(", ") });
    return res.status(200).json({ email: true, destinataires: envoyes, refus });
  } catch (err) {
    return res.status(500).json({ email: false, raison: err.message });
  }
};
