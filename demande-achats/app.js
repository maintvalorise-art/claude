"use strict";
/* =====================================================================
   Demandes d'Achat – PR-ACH-001
   Comptes Demandeur / Admin – Supabase (Auth + Postgres + Realtime) – Vercel
   ===================================================================== */

const CFG = Object.assign({
  SUPABASE_URL: "", SUPABASE_ANON_KEY: "", ENTREPRISE: "Mon entreprise", DEVISE: "MAD", NOTIFY_URL: "/api/notify"
}, window.APP_CONFIG || {});

const SERVICES   = ["Production","Maintenance","Logistique","Qualité","HSE","Administration","Commercial","Achats","Informatique","Autre"];
const CATEGORIES = ["Matières premières","Pièces de rechange","Consommables","Équipements et outillages","Prestations de maintenance","Services externes","Fournitures administratives","EPI et équipements de sécurité","Achats clients / projets"];
const UNITES     = ["Pce","kg","L","m³","m","m²","Lot","Prestation","Heure","Jour"];
const URGENCES   = ["Normal","Urgent","Critique"];
const IMPACTS    = ["Production","Client","Sécurité"];

const STATUTS = {
  brouillon:  { l: "Brouillon",              c: "b-grey" },
  en_attente: { l: "En attente",             c: "b-warn" },
  en_cours:   { l: "En cours de traitement", c: "b-blue" },
  validee:    { l: "Validée",                c: "b-ok" },
  refusee:    { l: "Refusée",                c: "b-danger" }
};
const FINANCE = {
  en_attente:  { l: "En attente",  c: "b-warn" },
  validee:     { l: "Validée",     c: "b-ok" },
  refusee:     { l: "Refusée",     c: "b-danger" },
  non_requise: { l: "Non requise", c: "b-grey" }
};
const RECEPTION = {
  en_attente:   { l: "En attente",    c: "b-warn" },
  partielle:    { l: "Partielle",     c: "b-violet" },
  recue:        { l: "Reçue",         c: "b-ok" },
  non_conforme: { l: "Non conforme",  c: "b-danger" }
};
const ADMIN_STATUTS = ["en_attente","en_cours","validee","refusee"];

/* ---------------- Utilitaires ---------------- */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const num = v => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isNaN(n) ? 0 : n; };
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = d => d ? new Date(d).toLocaleDateString("fr-FR") : "—";
const fmtDT = d => d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";
const money = n => (n === null || n === undefined || n === "") ? "—" :
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num(n)) + " " + CFG.DEVISE;
const opts = (list, sel, empty) => (empty !== undefined ? `<option value="">${esc(empty)}</option>` : "") +
  list.map(v => `<option ${v === sel ? "selected" : ""}>${esc(v)}</option>`).join("");
const optsMap = (map, keys, sel) => keys.map(k => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(map[k].l)}</option>`).join("");
const badgeOf = (map, k) => `<span class="badge ${(map[k] || {}).c || "b-grey"}">${esc((map[k] || {}).l || k || "—")}</span>`;
const badge = s => badgeOf(STATUTS, s);
const urgBadge = u => u === "Critique" ? `<span class="badge b-danger">Critique</span>` : u === "Urgent" ? `<span class="badge b-warn">Urgent</span>` : `<span class="badge b-grey">Normal</span>`;
const objet = da => { const l = da.lignes || []; return l.length ? esc(l[0].designation) + (l.length > 1 ? ` <span class="muted">+${l.length - 1}</span>` : "") : `<span class="muted">—</span>`; };

function toast(msg, err){
  const t = $("#toast"), d = document.createElement("div");
  d.textContent = msg; if (err) d.className = "err";
  t.appendChild(d); while (t.children.length > 3) t.firstChild.remove();
  setTimeout(() => d.remove(), err ? 7000 : 3500);
}
function formObj(form){
  const o = {};
  for (const el of form.elements){
    if (!el.name || el.closest(".lines")) continue;
    if (el.type === "checkbox") o[el.name] = el.checked;
    else if (el.type !== "submit" && el.type !== "button") o[el.name] = el.value.trim() === "" ? null : el.value.trim();
  }
  return o;
}
const chk = ({ data, error }) => { if (error) throw new Error(traduireErreur(error.message)); return data; };
function traduireErreur(m){
  if (/Invalid login credentials/i.test(m)) return "Email ou mot de passe incorrect.";
  if (/Email not confirmed/i.test(m)) return "Email non confirmé : cliquez sur le lien reçu par email.";
  if (/already registered|already exists/i.test(m)) return "Un compte existe déjà avec cet email.";
  if (/Password should be at least/i.test(m)) return "Le mot de passe doit contenir au moins 6 caractères.";
  if (/JSON object requested, multiple \(or no\) rows/i.test(m)) return "Action impossible : demande introuvable ou déjà envoyée.";
  return m;
}

/* ---------------- État ---------------- */
let sb = null, session = null, profile = null;
let DA = [], NOTIFS = [], PROFILES = [];
let suiviCache = {};
let pollTimer = null, channel = null, recovering = false;
const isAdmin = () => profile && profile.role === "admin";

/* ---------------- Démarrage ---------------- */
(async function init(){
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) return renderSetup();
  if (!window.supabase){
    $("#app").innerHTML = `<div class="card auth"><h2>Erreur de chargement</h2><p>La bibliothèque Supabase n'a pas pu être chargée. Vérifiez votre connexion internet puis rechargez la page.</p></div>`;
    return;
  }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  $("#brand-sub").textContent = CFG.ENTREPRISE + " · PR-ACH-001";

  sb.auth.onAuthStateChange((event, s) => {
    if (event === "PASSWORD_RECOVERY"){ session = s; recovering = true; renderNewPassword(); return; }
    if (event === "SIGNED_OUT"){ session = null; profile = null; stopLive(); renderAuth("login"); }
    if (event === "TOKEN_REFRESHED" && s) session = s;
  });

  const { data } = await sb.auth.getSession();
  session = data.session;
  if (session && !/type=recovery/.test(location.hash)) await afterLogin();
  else if (!session) renderAuth("login");
})();

function renderSetup(){
  $("#app").innerHTML = `<div class="card" style="max-width:720px;margin:30px auto">
    <h1>Configuration requise</h1>
    <p>L'application n'est pas encore reliée à Supabase. Renseignez <code>SUPABASE_URL</code> et <code>SUPABASE_ANON_KEY</code>
    dans <code>config.js</code> (ou dans les variables d'environnement Vercel), puis rechargez la page.</p>
    <p>Le guide complet se trouve dans <code>README.md</code>.</p></div>`;
}

async function afterLogin(){
  const { data: { user } } = await sb.auth.getUser();
  if (!user){ renderAuth("login"); return; }
  const { data: p, error } = await sb.from("profiles").select("*").eq("id", user.id).single();
  if (error || !p){ toast("Profil introuvable : " + (error ? error.message : ""), true); await sb.auth.signOut(); return; }
  if (!p.actif){ toast("Votre compte est désactivé. Contactez l'administrateur.", true); await sb.auth.signOut(); return; }
  profile = p;
  $("#top").hidden = false;
  $("#user-name").textContent = (p.nom || p.email) + (isAdmin() ? " · Admin" : "");
  await reloadAll();
  startLive();
  if (!location.hash || location.hash === "#") location.hash = "#/";
  render();
}

async function reloadAll(){
  const [d, n] = await Promise.all([
    sb.from("demandes").select("*").order("created_at", { ascending: false }),
    sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(50)
  ]);
  DA = chk(d); NOTIFS = chk(n);
  if (isAdmin()) PROFILES = chk(await sb.from("profiles").select("*").order("nom"));
  suiviCache = {};
  renderBell();
}
const findDA = id => DA.find(d => d.id === id);

/* ---------------- Notifications (temps réel + relève périodique) ---------------- */
function startLive(){
  stopLive();
  try {
    channel = sb.channel("notif-" + profile.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + profile.id },
          payload => onNewNotifs([payload.new]))
      .subscribe();
  } catch(e){ console.warn("Realtime indisponible", e); }
  pollTimer = setInterval(pollNotifs, 30000);
}
function stopLive(){
  if (pollTimer) clearInterval(pollTimer);
  if (channel && sb) sb.removeChannel(channel);
  pollTimer = null; channel = null;
}
async function pollNotifs(){
  if (!profile) return;
  const { data } = await sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(50);
  if (data) onNewNotifs(data.filter(n => !NOTIFS.some(x => x.id === n.id)));
}
async function onNewNotifs(list){
  list = list.filter(n => !NOTIFS.some(x => x.id === n.id));
  if (!list.length) return;
  NOTIFS = list.concat(NOTIFS).sort((a, b) => b.created_at.localeCompare(a.created_at));
  list.forEach(n => {
    toast("🔔 " + n.titre);
    try { if ("Notification" in window && Notification.permission === "granted") new Notification(n.titre, { body: n.message || "" }); } catch(e){}
  });
  try { await reloadAll(); } catch(e){}
  const active = document.activeElement;
  if (!active || !/INPUT|TEXTAREA|SELECT/.test(active.tagName)) render();
  else renderBell();
}
function renderBell(){
  const unread = NOTIFS.filter(n => !n.lu).length;
  const c = $("#bell-count"); c.textContent = unread; c.hidden = !unread;
  const panel = $("#notif-panel");
  if (panel.hidden) return;
  panel.innerHTML = `<div class="head"><b>Notifications</b>
      <span>${"Notification" in window && Notification.permission === "default" ? `<button class="btn sm" data-act="notifPerm">Activer sur cet appareil</button>` : ""}
      ${unread ? `<button class="btn sm" data-act="toutLu">Tout marquer lu</button>` : ""}</span></div>
    ${NOTIFS.length ? NOTIFS.map(n => `<div class="notif ${n.lu ? "" : "unread"}" data-notif="${n.id}">
        <div><b>${esc(n.titre)}</b></div>${n.message ? `<div class="small">${esc(n.message)}</div>` : ""}<div class="m">${fmtDT(n.created_at)}</div></div>`).join("")
      : `<div class="empty">Aucune notification</div>`}`;
}

/* ---------------- Authentification ---------------- */
function renderAuth(tab){
  $("#top").hidden = true;
  const t = (k, l) => `<a href="javascript:void 0" data-auth="${k}" class="${tab === k ? "active" : ""}">${l}</a>`;
  let body = "";
  if (tab === "login") body = `
    <form data-form="login">
      <div style="margin-bottom:10px"><label class="req">Email</label><input type="email" name="email" required autocomplete="email"></div>
      <div style="margin-bottom:10px"><label class="req">Mot de passe</label><input type="password" name="password" required autocomplete="current-password"></div>
      <button class="btn primary" type="submit" style="width:100%;justify-content:center">Se connecter</button>
    </form>`;
  else if (tab === "signup") body = `
    <form data-form="signup">
      <div style="margin-bottom:10px"><label class="req">Nom et prénom</label><input name="nom" required></div>
      <div style="margin-bottom:10px"><label class="req">Service</label><select name="service" required>${opts(SERVICES, null, "— Choisir —")}</select></div>
      <div style="margin-bottom:10px"><label class="req">Email professionnel</label><input type="email" name="email" required autocomplete="email"></div>
      <div style="margin-bottom:10px"><label class="req">Mot de passe (6 caractères min.)</label><input type="password" name="password" minlength="6" required autocomplete="new-password"></div>
      <button class="btn primary" type="submit" style="width:100%;justify-content:center">Créer mon compte demandeur</button>
      <p class="small muted">Les nouveaux comptes sont des comptes <b>Demandeur</b>. Les droits administrateur sont attribués par un administrateur.</p>
    </form>`;
  else body = `
    <form data-form="forgot">
      <div style="margin-bottom:10px"><label class="req">Email</label><input type="email" name="email" required></div>
      <button class="btn primary" type="submit" style="width:100%;justify-content:center">Recevoir un lien de réinitialisation</button>
    </form>`;
  $("#app").innerHTML = `<div class="card auth">
    <h1 style="text-align:center">Demandes d'Achat</h1>
    <p class="muted small" style="text-align:center;margin-top:-8px">${esc(CFG.ENTREPRISE)} · Procédure PR-ACH-001</p>
    <div class="tabs">${t("login", "Connexion")}${t("signup", "Créer un compte")}${t("forgot", "Mot de passe oublié")}</div>
    ${body}</div>`;
}
function renderNewPassword(){
  $("#top").hidden = true;
  $("#app").innerHTML = `<div class="card auth"><h1>Nouveau mot de passe</h1>
    <form data-form="newPassword">
      <div style="margin-bottom:10px"><label class="req">Nouveau mot de passe</label><input type="password" name="password" minlength="6" required autocomplete="new-password"></div>
      <button class="btn primary" type="submit">Enregistrer</button>
    </form></div>`;
}

/* ---------------- Routeur ---------------- */
function route(){
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  return { name: parts[0] || "dash", id: parts[1], params: Object.fromEntries(new URLSearchParams(qs || "")) };
}
function renderMenu(r){
  const items = isAdmin()
    ? [["dash","#/","Tableau de bord"],["demandes","#/demandes","Toutes les demandes"],["mes","#/mes","Mes demandes"],["nouvelle","#/nouvelle","+ Nouvelle demande"],["utilisateurs","#/utilisateurs","Utilisateurs"]]
    : [["dash","#/","Mes demandes"],["nouvelle","#/nouvelle","+ Nouvelle demande"]];
  $("#menu").innerHTML = items.map(([k, h, l]) => `<a href="${h}" class="${r.name === k ? "active" : ""}">${l}</a>`).join("");
}
async function render(){
  if (!profile || recovering) return;
  const r = route();
  renderMenu(r);
  let html = "";
  try {
    switch (r.name){
      case "nouvelle": html = viewForm(null); break;
      case "modifier": { const da = findDA(r.id); html = da && da.statut === "brouillon" && da.user_id === profile.id ? viewForm(da) : await viewDetail(da); break; }
      case "da": html = await viewDetail(findDA(r.id)); break;
      case "demandes": html = isAdmin() ? viewAdminListe(r.params) : viewMesDemandes(); break;
      case "mes": html = viewMesDemandes(); break;
      case "utilisateurs": html = isAdmin() ? viewUsers() : viewMesDemandes(); break;
      case "profil": html = viewProfil(); break;
      default: html = isAdmin() ? viewAdminDashboard() : viewMesDemandes();
    }
  } catch(err){ html = `<div class="alert danger">${esc(err.message)}</div>`; }
  $("#app").innerHTML = html;
  bindView();
}
window.addEventListener("hashchange", () => { $("#notif-panel").hidden = true; render(); });

/* ---------------- Vues : demandeur ---------------- */
function kpi(v, l, href, hl){
  const tag = href ? "a" : "div";
  return `<${tag} class="card kpi ${hl ? "hl" : ""}" ${href ? `href="${href}"` : ""}><div class="v">${v}</div><div class="l">${esc(l)}</div></${tag}>`;
}
function viewMesDemandes(){
  const mine = DA.filter(d => d.user_id === profile.id);
  const c = s => mine.filter(d => d.statut === s).length;
  return `
  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
    <h1>Mes demandes d'achat</h1><a class="btn primary" href="#/nouvelle">+ Nouvelle demande d'achat</a>
  </div>
  <div class="grid g5" style="margin-bottom:14px">
    ${kpi(mine.filter(d => d.statut !== "brouillon").length, "Demandes envoyées")}
    ${kpi(c("en_attente"), "En attente", null, c("en_attente") > 0)}
    ${kpi(c("en_cours"), "En cours de traitement")}
    ${kpi(c("validee"), "Validées")}
    ${kpi(c("refusee"), "Refusées")}
  </div>
  <div class="card">
    ${mine.length ? `<div class="table-wrap"><table><thead><tr>
      <th>N° DA</th><th>Date</th><th>Objet</th><th class="num">Montant estimé</th><th>Urgence</th><th>Statut</th><th>Finance</th><th>Réception</th><th>Commentaire admin</th>
    </tr></thead><tbody>
    ${mine.map(d => `<tr class="click" data-go="#/da/${d.id}">
      <td><b>${esc(d.numero)}</b></td><td>${fmtDate(d.date_envoi || d.created_at)}</td><td>${objet(d)}</td>
      <td class="num">${money(d.montant_estime)}</td><td>${urgBadge(d.urgence)}</td><td>${badge(d.statut)}</td>
      <td>${d.statut === "brouillon" ? "—" : badgeOf(FINANCE, d.finance_statut)}</td>
      <td>${d.statut === "brouillon" ? "—" : badgeOf(RECEPTION, d.reception_statut)}</td>
      <td class="small">${esc((d.commentaire_admin || "").slice(0, 80))}${(d.commentaire_admin || "").length > 80 ? "…" : ""}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty">Vous n'avez encore aucune demande.<br><br><a class="btn primary" href="#/nouvelle">Créer ma première demande d'achat</a></div>`}
  </div>`;
}

function ligneRow(l){
  l = l || { unite: "Pce", quantite: 1 };
  return `<tr>
    <td><input name="designation" required value="${esc(l.designation)}" placeholder="Produit / service"></td>
    <td><input name="reference" value="${esc(l.reference)}" placeholder="Réf. constructeur"></td>
    <td style="width:90px"><input name="quantite" type="number" min="0.001" step="any" required value="${esc(l.quantite)}"></td>
    <td style="width:110px"><select name="unite">${opts(UNITES, l.unite)}</select></td>
    <td style="width:130px"><input name="prix_unitaire" type="number" min="0" step="any" value="${esc(l.prix_unitaire)}" placeholder="optionnel"></td>
    <td class="num ltotal" style="width:120px;padding-top:10px">—</td>
    <td style="width:40px"><button type="button" class="btn sm ghost" data-act="supprLigne" title="Supprimer la ligne">✕</button></td>
  </tr>`;
}
function viewForm(da){
  const d = da || { service: profile.service, urgence: "Normal", lignes: [] };
  const lignes = (d.lignes && d.lignes.length) ? d.lignes : [null];
  return `
  <h1>${da ? "Modifier la demande " + esc(da.numero) : "Fiche de demande d'achat"}</h1>
  <form data-form="saveDA" data-id="${da ? da.id : ""}" novalidate>
  <div class="card">
    <h2>1. Demandeur et besoin</h2>
    <div class="grid g3">
      <div><label>Demandeur</label><input value="${esc(profile.nom)}" disabled></div>
      <div><label class="req">Service</label><select name="service" required>${opts(SERVICES, d.service, "— Choisir —")}</select></div>
      <div><label class="req">Centre de coût</label><input name="centre_cout" required value="${esc(d.centre_cout)}" placeholder="ex : CC-PROD-01"></div>
      <div><label class="req">Catégorie</label><select name="categorie" id="categorie" required>${opts(CATEGORIES, d.categorie, "— Choisir —")}</select></div>
      <div><label class="req">Date souhaitée de disponibilité</label><input name="date_souhaitee" type="date" required min="${today()}" value="${esc(d.date_souhaitee)}"></div>
      <div><label>Fournisseur suggéré (si connu)</label><input name="fournisseur_suggere" value="${esc(d.fournisseur_suggere)}"></div>
    </div>
    <div id="bloc-pdr" class="grid g2" style="margin-top:12px" ${d.categorie === "Pièces de rechange" ? "" : "hidden"}>
      <div><label>Marque</label><input name="marque" value="${esc(d.marque)}"></div>
      <div><label>Modèle machine / véhicule</label><input name="modele" value="${esc(d.modele)}"></div>
    </div>
  </div>

  <div class="card">
    <h2>2. Articles demandés</h2>
    <div class="table-wrap"><table class="lines"><thead><tr>
      <th>Désignation *</th><th>Référence</th><th>Quantité *</th><th>Unité</th><th>Prix unit. estimé</th><th class="num">Total estimé</th><th></th>
    </tr></thead><tbody id="lignes">${lignes.map(ligneRow).join("")}</tbody></table></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;flex-wrap:wrap;gap:8px">
      <button type="button" class="btn sm" data-act="ajoutLigne">+ Ajouter un article</button>
      <div>Total estimé : <b id="total-estime">—</b></div>
    </div>
  </div>

  <div class="card">
    <h2>3. Justification et urgence</h2>
    <div class="grid g2">
      <div><label class="req">Motif (pourquoi l'achat est nécessaire)</label><textarea name="motif" required>${esc(d.motif)}</textarea></div>
      <div><label>Pièces jointes (liens vers devis, photos, fiches techniques…)</label><textarea name="pieces_jointes">${esc(d.pieces_jointes)}</textarea></div>
      <div><label class="req">Niveau d'urgence</label><select name="urgence" id="urgence">${opts(URGENCES, d.urgence)}</select></div>
      <div id="bloc-impact" ${d.urgence && d.urgence !== "Normal" ? "" : "hidden"}><label class="req">Impact</label><select name="impact">${opts(IMPACTS, d.impact, "— Choisir —")}</select></div>
    </div>
    <h3>Vérifications préalables</h3>
    <label class="check"><input type="checkbox" name="stock_verifie" ${d.stock_verifie ? "checked" : ""}> J'ai vérifié le stock disponible (pas d'alternative en stock)</label>
    <label class="check"><input type="checkbox" name="commandes_verifiees" ${d.commandes_verifiees ? "checked" : ""}> J'ai vérifié les commandes déjà en cours</label>
  </div>

  <div class="alert info">« Valider et envoyer » télécharge la fiche en PDF et l'envoie à l'administration (notification + email). Après l'envoi, la demande ne peut plus être modifiée.</div>
  <div class="btns">
    <button class="btn" type="submit" value="brouillon">Enregistrer en brouillon</button>
    <button class="btn primary" type="submit" value="envoyer">Valider et envoyer</button>
    <a class="btn ghost" href="${da ? "#/da/" + da.id : "#/"}">Annuler</a>
  </div>
  </form>`;
}
function updateTotals(){
  let total = 0;
  document.querySelectorAll("#lignes tr").forEach(tr => {
    const q = num(tr.querySelector("[name=quantite]").value), p = num(tr.querySelector("[name=prix_unitaire]").value);
    total += q * p; tr.querySelector(".ltotal").textContent = p ? money(q * p) : "—";
  });
  const t = $("#total-estime"); if (t) t.textContent = total ? money(total) : "—";
}

async function loadSuivi(id){
  if (!suiviCache[id]) suiviCache[id] = chk(await sb.from("suivi").select("*").eq("demande_id", id).order("created_at"));
  return suiviCache[id];
}
function field(label, v){ return `<div><dt>${esc(label)}</dt><dd>${v === null || v === undefined || v === "" ? "—" : v}</dd></div>`; }
const SUIVI_TXT = {
  creation: "Demande créée", envoi: "Validée et envoyée à l'administration",
  statut: "Statut", commentaire: "Commentaire de l'administration", finance: "Validation finance", reception: "Réception"
};
function suiviLabel(s){
  const map = s.type === "finance" ? FINANCE : s.type === "reception" ? RECEPTION : STATUTS;
  if (["statut","finance","reception"].includes(s.type)) return `${SUIVI_TXT[s.type]} : ${badgeOf(map, s.nouveau)}`;
  return esc(SUIVI_TXT[s.type] || s.type);
}

async function viewDetail(da){
  if (!da) return `<div class="empty">Demande introuvable. <a href="#/">Retour</a></div>`;
  const suivi = await loadSuivi(da.id);
  const mine = da.user_id === profile.id;
  const envoyee = da.statut !== "brouillon";
  const lignes = da.lignes || [];
  return `
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
    <h1 style="margin:0 auto 0 0">${esc(da.numero)}</h1>
    ${badge(da.statut)} ${urgBadge(da.urgence)}
    <button class="btn sm" data-act="pdf" data-id="${da.id}">⬇ Télécharger le PDF</button>
  </div>
  <p class="muted small" style="margin-top:0">Par ${esc(da.demandeur_nom)} · ${esc(da.service)} · créée le ${fmtDate(da.created_at)}${da.date_envoi ? " · envoyée le " + fmtDT(da.date_envoi) : ""}</p>
  ${da.urgence !== "Normal" ? `<div class="urgent-banner">${esc(da.urgence.toUpperCase())} – IMPACT ${esc((da.impact || "NON PRÉCISÉ").toUpperCase())}</div>` : ""}

  ${mine && da.statut === "brouillon" ? `<div class="card action">
    <h2>Brouillon — pas encore envoyé</h2>
    <div class="btns" style="margin:0">
      <a class="btn" href="#/modifier/${da.id}">Modifier</a>
      <button class="btn primary" data-act="envoyer" data-id="${da.id}">Valider et envoyer</button>
      <button class="btn danger" data-act="supprimer" data-id="${da.id}">Supprimer</button>
    </div></div>` : ""}

  ${envoyee ? `<div class="card">
    <h2>Suivi de la demande</h2>
    <div class="track">
      <div><div class="t">Statut de la demande</div>${badge(da.statut)}<div class="small muted" style="margin-top:4px">${da.traite_par ? "Par " + esc(da.traite_par) + " · " + fmtDT(da.traite_le) : "En attente de traitement"}</div></div>
      <div><div class="t">Validation finance</div>${badgeOf(FINANCE, da.finance_statut)}<div class="small muted" style="margin-top:4px">${da.finance_par ? "Par " + esc(da.finance_par) + " · " + fmtDT(da.finance_le) : ""}</div>
        ${da.finance_commentaire ? `<div class="small" style="margin-top:4px">${esc(da.finance_commentaire)}</div>` : ""}</div>
      <div><div class="t">Réception</div>${badgeOf(RECEPTION, da.reception_statut)}<div class="small muted" style="margin-top:4px">${da.reception_date ? "Le " + fmtDate(da.reception_date) : ""}${da.bc_numero ? " · BC " + esc(da.bc_numero) : ""}</div>
        ${da.reception_remarque ? `<div class="small" style="margin-top:4px">${esc(da.reception_remarque)}</div>` : ""}</div>
    </div>
    ${da.commentaire_admin ? `<div class="comment ${da.statut === "refusee" ? "refus" : ""}"><b>Commentaire de l'administration :</b>\n${esc(da.commentaire_admin)}</div>` : ""}
  </div>` : ""}

  ${isAdmin() && envoyee ? viewAdminPanels(da) : ""}

  <div class="card info">
    <h2>Fiche de demande</h2>
    <dl>
      ${field("Demandeur", esc(da.demandeur_nom))}${field("Service", esc(da.service))}${field("Centre de coût", esc(da.centre_cout))}
      ${field("Catégorie", esc(da.categorie))}${field("Date souhaitée", fmtDate(da.date_souhaitee))}${field("Fournisseur suggéré", esc(da.fournisseur_suggere))}
      ${da.categorie === "Pièces de rechange" ? field("Marque", esc(da.marque)) + field("Modèle machine / véhicule", esc(da.modele)) : ""}
      ${field("Stock vérifié", da.stock_verifie ? "Oui" : "Non")}${field("Commandes en cours vérifiées", da.commandes_verifiees ? "Oui" : "Non")}
      <div style="grid-column:1/-1"><dt>Motif</dt><dd style="white-space:pre-wrap">${esc(da.motif) || "—"}</dd></div>
      ${da.pieces_jointes ? `<div style="grid-column:1/-1"><dt>Pièces jointes</dt><dd style="white-space:pre-wrap">${linkify(da.pieces_jointes)}</dd></div>` : ""}
    </dl>
    <h3>Articles</h3>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Désignation</th><th>Référence</th><th class="num">Qté</th><th>Unité</th><th class="num">PU estimé</th><th class="num">Total estimé</th></tr></thead><tbody>
      ${lignes.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.designation)}</td><td>${esc(l.reference)}</td><td class="num">${esc(l.quantite)}</td><td>${esc(l.unite)}</td>
        <td class="num">${l.prix_unitaire ? money(l.prix_unitaire) : "—"}</td><td class="num">${l.prix_unitaire ? money(num(l.quantite) * num(l.prix_unitaire)) : "—"}</td></tr>`).join("")}
      <tr><td colspan="6" class="num"><b>Total estimé</b></td><td class="num"><b>${money(da.montant_estime)}</b></td></tr>
    </tbody></table></div>
  </div>

  <div class="card"><h2>Historique</h2>
    ${suivi.length ? `<ul class="timeline">${suivi.map(s => `<li>${suiviLabel(s)} <span class="muted small">— ${esc(s.auteur_nom)} · ${fmtDT(s.created_at)}</span>
      ${s.commentaire && !["creation","envoi"].includes(s.type) ? `<div class="small" style="white-space:pre-wrap">${esc(s.commentaire)}</div>` : ""}</li>`).join("")}</ul>` : `<div class="empty">Aucun événement.</div>`}
  </div>`;
}
function linkify(t){
  return esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

/* ---------------- Vues : admin ---------------- */
function viewAdminPanels(da){
  return `
  <div class="grid g3">
    <form class="card action" data-form="adminStatut" data-id="${da.id}" style="margin:0">
      <h2>Traitement de la demande</h2>
      <label class="req">Statut</label>
      <select name="statut">${optsMap(STATUTS, ADMIN_STATUTS, da.statut)}</select>
      <div style="margin-top:10px"><label>Commentaire pour le demandeur <span class="muted">(obligatoire si refus)</span></label>
        <textarea name="commentaire_admin" placeholder="Visible par le demandeur">${esc(da.commentaire_admin)}</textarea></div>
      <div class="btns"><button class="btn primary" type="submit">Enregistrer et notifier</button></div>
    </form>
    <form class="card action" data-form="adminFinance" data-id="${da.id}" style="margin:0">
      <h2>Validation finance</h2>
      <label>Statut finance</label>
      <select name="finance_statut">${optsMap(FINANCE, Object.keys(FINANCE), da.finance_statut)}</select>
      <div style="margin-top:10px"><label>Commentaire finance</label><textarea name="finance_commentaire">${esc(da.finance_commentaire)}</textarea></div>
      <div class="btns"><button class="btn primary" type="submit">Enregistrer</button></div>
    </form>
    <form class="card action" data-form="adminReception" data-id="${da.id}" style="margin:0">
      <h2>Commande et réception</h2>
      <div class="grid g2">
        <div><label>N° BC</label><input name="bc_numero" value="${esc(da.bc_numero)}"></div>
        <div><label>Montant réel HT</label><input name="montant_reel" type="number" step="any" min="0" value="${esc(da.montant_reel)}"></div>
      </div>
      <div style="margin-top:8px"><label>Fournisseur retenu</label><input name="fournisseur_retenu" value="${esc(da.fournisseur_retenu)}"></div>
      <div class="grid g2" style="margin-top:8px">
        <div><label>Réception</label><select name="reception_statut">${optsMap(RECEPTION, Object.keys(RECEPTION), da.reception_statut)}</select></div>
        <div><label>Date de réception</label><input type="date" name="reception_date" value="${esc(da.reception_date)}"></div>
      </div>
      <div style="margin-top:8px"><label>Remarque réception</label><input name="reception_remarque" value="${esc(da.reception_remarque)}"></div>
      <div class="btns"><button class="btn primary" type="submit">Enregistrer</button></div>
    </form>
  </div><div style="height:14px"></div>`;
}

function viewAdminDashboard(){
  const env = DA.filter(d => d.statut !== "brouillon");
  const c = s => env.filter(d => d.statut === s).length;
  const actives = env.filter(d => ["en_cours","validee"].includes(d.statut));
  const finAtt = actives.filter(d => d.finance_statut === "en_attente").length;
  const finOk = env.filter(d => d.finance_statut === "validee").length;
  const recAtt = env.filter(d => d.statut === "validee" && !["recue"].includes(d.reception_statut)).length;
  const recOk = env.filter(d => d.reception_statut === "recue").length;
  const montantValide = env.filter(d => d.statut === "validee").reduce((s, d) => s + num(d.montant_reel || d.montant_estime), 0);
  const aTraiter = env.filter(d => d.statut === "en_attente")
    .sort((a, b) => (b.urgence === "Critique") - (a.urgence === "Critique") || (b.urgence === "Urgent") - (a.urgence === "Urgent") || (a.date_envoi || "").localeCompare(b.date_envoi || ""));
  const attRecep = env.filter(d => d.statut === "validee" && d.reception_statut !== "recue");
  const parService = SERVICES.map(s => [s, env.filter(d => d.service === s)]).filter(x => x[1].length);
  return `
  <h1>Tableau de bord — Administration</h1>
  <div class="grid g5" style="margin-bottom:12px">
    ${kpi(env.length, "Demandes reçues", "#/demandes")}
    ${kpi(c("en_attente"), "En attente", "#/demandes?statut=en_attente", c("en_attente") > 0)}
    ${kpi(c("en_cours"), "En cours de traitement", "#/demandes?statut=en_cours")}
    ${kpi(c("validee"), "Validées", "#/demandes?statut=validee")}
    ${kpi(c("refusee"), "Refusées", "#/demandes?statut=refusee")}
  </div>
  <div class="grid g5" style="margin-bottom:14px">
    ${kpi(finAtt, "Finance : validation en attente", "#/demandes?finance=en_attente")}
    ${kpi(finOk, "Finance : validées", "#/demandes?finance=validee")}
    ${kpi(recAtt, "Validées, non encore reçues", "#/demandes?statut=validee&reception=en_attente")}
    ${kpi(recOk, "Réceptions terminées", "#/demandes?reception=recue")}
    ${kpi(money(montantValide), "Montant des DA validées")}
  </div>
  <div class="card"><h2>À traiter (${aTraiter.length})</h2>${tableAdmin(aTraiter, "Aucune demande en attente. 👍")}</div>
  <div class="grid g2">
    <div class="card"><h2>Validées en attente de réception (${attRecep.length})</h2>${tableAdmin(attRecep, "Rien en attente de réception.", true)}</div>
    <div class="card"><h2>Par service</h2>
      ${parService.length ? `<div class="table-wrap"><table><thead><tr><th>Service</th><th class="num">Total</th><th class="num">En attente</th><th class="num">Validées</th><th class="num">Montant estimé</th></tr></thead><tbody>
      ${parService.map(([s, l]) => `<tr><td>${esc(s)}</td><td class="num">${l.length}</td><td class="num">${l.filter(d => d.statut === "en_attente").length}</td>
        <td class="num">${l.filter(d => d.statut === "validee").length}</td><td class="num">${money(l.reduce((a, d) => a + num(d.montant_estime), 0))}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">Aucune donnée.</div>`}
    </div>
  </div>`;
}
function tableAdmin(list, emptyMsg, compact){
  if (!list.length) return `<div class="empty">${esc(emptyMsg)}</div>`;
  return `<div class="table-wrap"><table><thead><tr>
    <th>N° DA</th><th>Envoyée le</th><th>Demandeur</th>${compact ? "" : "<th>Service</th>"}<th>Objet</th><th class="num">Montant estimé</th><th>Urgence</th><th>Statut</th><th>Finance</th><th>Réception</th>
  </tr></thead><tbody>
  ${list.map(d => `<tr class="click" data-go="#/da/${d.id}">
    <td><b>${esc(d.numero)}</b></td><td>${fmtDate(d.date_envoi)}</td><td>${esc(d.demandeur_nom)}</td>${compact ? "" : `<td>${esc(d.service)}</td>`}
    <td>${objet(d)}</td><td class="num">${money(d.montant_estime)}</td><td>${urgBadge(d.urgence)}</td><td>${badge(d.statut)}</td>
    <td>${badgeOf(FINANCE, d.finance_statut)}</td><td>${badgeOf(RECEPTION, d.reception_statut)}</td></tr>`).join("")}
  </tbody></table></div>`;
}

let filters = { q: "", statut: "", finance: "", reception: "", service: "" };
function viewAdminListe(params){
  if (Object.keys(params).length) filters = Object.assign({ q: "", statut: "", finance: "", reception: "", service: "" }, params);
  const q = filters.q.toLowerCase();
  const list = DA.filter(d => d.statut !== "brouillon" &&
    (!filters.statut || d.statut === filters.statut) &&
    (!filters.finance || d.finance_statut === filters.finance) &&
    (!filters.reception || d.reception_statut === filters.reception) &&
    (!filters.service || d.service === filters.service) &&
    (!q || [d.numero, d.demandeur_nom, d.motif, d.bc_numero, d.fournisseur_retenu, ...(d.lignes || []).map(l => l.designation + " " + (l.reference || ""))].join(" ").toLowerCase().includes(q)));
  const sel = (id, map, keys, v, all) => `<select id="${id}"><option value="">${all}</option>${keys.map(k => `<option value="${k}" ${k === v ? "selected" : ""}>${esc(map[k].l)}</option>`).join("")}</select>`;
  return `
  <h1>Toutes les demandes</h1>
  <div class="card">
    <div class="filters">
      <input id="f-q" placeholder="Rechercher (n°, demandeur, article, BC…)" value="${esc(filters.q)}">
      ${sel("f-statut", STATUTS, ADMIN_STATUTS, filters.statut, "Tous statuts")}
      ${sel("f-finance", FINANCE, Object.keys(FINANCE), filters.finance, "Finance : tout")}
      ${sel("f-reception", RECEPTION, Object.keys(RECEPTION), filters.reception, "Réception : tout")}
      <select id="f-service">${opts(SERVICES, filters.service, "Tous services")}</select>
      <button class="btn" data-act="exportCSV">Export CSV</button>
    </div>
    <div class="small muted" style="margin-bottom:8px">${list.length} demande(s)</div>
    ${tableAdmin(list, "Aucune demande ne correspond aux filtres.")}
  </div>`;
}

function viewUsers(){
  return `
  <h1>Utilisateurs</h1>
  <div class="alert info">Les collaborateurs créent leur compte eux-mêmes (« Créer un compte ») : ils sont <b>Demandeurs</b> par défaut.
    Ici, vous pouvez attribuer le rôle <b>Admin</b> ou désactiver un compte.</div>
  <div class="card"><div class="table-wrap"><table><thead><tr><th>Nom</th><th>Email</th><th>Service</th><th class="num">Demandes</th><th>Rôle</th><th>Actif</th><th>Inscrit le</th></tr></thead><tbody>
  ${PROFILES.map(p => `<tr>
    <td>${esc(p.nom)}${p.id === profile.id ? ' <span class="badge b-blue">vous</span>' : ""}</td><td>${esc(p.email)}</td><td>${esc(p.service || "—")}</td>
    <td class="num">${DA.filter(d => d.user_id === p.id && d.statut !== "brouillon").length}</td>
    <td><select data-user="${p.id}" data-field="role" ${p.id === profile.id ? "disabled" : ""}>
      <option value="demandeur" ${p.role === "demandeur" ? "selected" : ""}>Demandeur</option><option value="admin" ${p.role === "admin" ? "selected" : ""}>Admin</option></select></td>
    <td><input type="checkbox" data-user="${p.id}" data-field="actif" ${p.actif ? "checked" : ""} ${p.id === profile.id ? "disabled" : ""} style="width:auto"></td>
    <td>${fmtDate(p.created_at)}</td></tr>`).join("")}
  </tbody></table></div></div>`;
}

function viewProfil(){
  return `
  <h1>Mon profil</h1>
  <div class="grid g2">
    <form class="card" data-form="saveProfil">
      <h2>Informations</h2>
      <div style="margin-bottom:10px"><label>Email</label><input value="${esc(profile.email)}" disabled></div>
      <div style="margin-bottom:10px"><label class="req">Nom et prénom</label><input name="nom" required value="${esc(profile.nom)}"></div>
      <div style="margin-bottom:10px"><label>Service</label><select name="service">${opts(SERVICES, profile.service, "—")}</select></div>
      <div class="small muted">Rôle : <b>${isAdmin() ? "Administrateur" : "Demandeur"}</b></div>
      <div class="btns"><button class="btn primary" type="submit">Enregistrer</button></div>
    </form>
    <form class="card" data-form="newPassword">
      <h2>Changer de mot de passe</h2>
      <div style="margin-bottom:10px"><label class="req">Nouveau mot de passe</label><input type="password" name="password" minlength="6" required autocomplete="new-password"></div>
      <div class="btns"><button class="btn" type="submit">Mettre à jour</button></div>
    </form>
  </div>`;
}

function bindView(){
  const cat = $("#categorie"), urg = $("#urgence");
  if (cat) cat.onchange = () => { $("#bloc-pdr").hidden = cat.value !== "Pièces de rechange"; };
  if (urg) urg.onchange = () => { $("#bloc-impact").hidden = urg.value === "Normal"; };
  if ($("#lignes")){ $("#lignes").oninput = updateTotals; updateTotals(); }
  const fq = $("#f-q");
  if (fq){
    const upd = () => {
      filters = { q: $("#f-q").value, statut: $("#f-statut").value, finance: $("#f-finance").value, reception: $("#f-reception").value, service: $("#f-service").value };
      history.replaceState(null, "", "#/demandes");
      const pos = fq.selectionStart; render().then(() => { const n = $("#f-q"); n.focus(); n.setSelectionRange(pos, pos); });
    };
    fq.oninput = upd; ["#f-statut","#f-finance","#f-reception","#f-service"].forEach(s => $(s).onchange = upd);
  }
}

/* ---------------- PDF de la fiche ---------------- */
function makePDF(da){
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) throw new Error("Générateur PDF indisponible (connexion internet ?)");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const T = s => String(s ?? "").replace(/[  ]/g, " ");     // espaces fines non gérées par la police PDF
  const M = n => T(money(n));
  const W = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text(T(CFG.ENTREPRISE), 14, 16);
  doc.setFontSize(15); doc.text("FICHE DE DEMANDE D'ACHAT", W - 14, 16, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text("Procédure PR-ACH-001 - v01", W - 14, 21, { align: "right" });
  doc.setFontSize(11); doc.setFont("helvetica", "bold");
  doc.text(T(da.numero || "BROUILLON"), W - 14, 28, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text("Date : " + fmtDate(da.date_envoi || da.created_at), W - 14, 33, { align: "right" });
  doc.setLineWidth(0.6); doc.line(14, 37, W - 14, 37);

  if (da.urgence && da.urgence !== "Normal"){
    doc.setFillColor(253, 236, 235); doc.setDrawColor(192, 54, 44); doc.rect(14, 40, W - 28, 8, "FD");
    doc.setTextColor(192, 54, 44); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text(T(`${da.urgence.toUpperCase()} - IMPACT ${(da.impact || "NON PRECISE").toUpperCase()}`), 18, 45.5);
    doc.setTextColor(0); doc.setFont("helvetica", "normal");
  }
  const y0 = da.urgence && da.urgence !== "Normal" ? 51 : 41;
  const pairs = [
    ["Demandeur", da.demandeur_nom], ["Service", da.service],
    ["Centre de coût", da.centre_cout], ["Catégorie", da.categorie],
    ["Date souhaitée", fmtDate(da.date_souhaitee)], ["Urgence", da.urgence + (da.impact ? " - " + da.impact : "")],
    ["Fournisseur suggéré", da.fournisseur_suggere || "-"], ["Statut", (STATUTS[da.statut] || {}).l]
  ];
  if (da.categorie === "Pièces de rechange") pairs.push(["Marque", da.marque || "-"], ["Modèle machine / véhicule", da.modele || "-"]);
  const body = [];
  for (let i = 0; i < pairs.length; i += 2) body.push([pairs[i][0], T(pairs[i][1]), (pairs[i + 1] || [""])[0], T((pairs[i + 1] || ["", ""])[1])]);
  doc.autoTable({
    startY: y0, body, theme: "grid", styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: "bold", fillColor: [244, 246, 249], cellWidth: 38 }, 2: { fontStyle: "bold", fillColor: [244, 246, 249], cellWidth: 38 } }
  });

  let y = doc.lastAutoTable.finalY + 6;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text("Motif / justification", 14, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  const motif = doc.splitTextToSize(T(da.motif || "-"), W - 28); doc.text(motif, 14, y + 5); y += 5 + motif.length * 4.2 + 3;

  const lignes = da.lignes || [];
  doc.autoTable({
    startY: y, theme: "striped", headStyles: { fillColor: [31, 95, 191] }, styles: { fontSize: 9 },
    head: [["#", "Désignation", "Référence", "Qté", "Unité", "PU estimé", "Total estimé"]],
    body: lignes.map((l, i) => [i + 1, T(l.designation), T(l.reference || ""), T(l.quantite), T(l.unite),
      l.prix_unitaire ? M(l.prix_unitaire) : "-", l.prix_unitaire ? M(num(l.quantite) * num(l.prix_unitaire)) : "-"]),
    foot: [["", "", "", "", "", "Total estimé", M(da.montant_estime)]],
    footStyles: { fillColor: [244, 246, 249], textColor: 20, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 8 }, 3: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } }
  });
  y = doc.lastAutoTable.finalY + 6;

  doc.setFontSize(9);
  doc.text(`[${da.stock_verifie ? "X" : " "}] Stock disponible vérifié      [${da.commandes_verifiees ? "X" : " "}] Commandes en cours vérifiées`, 14, y); y += 6;
  if (da.pieces_jointes){
    const pj = doc.splitTextToSize("Pièces jointes : " + T(da.pieces_jointes), W - 28); doc.text(pj, 14, y); y += pj.length * 4.2 + 2;
  }
  if (da.statut !== "brouillon" && (da.commentaire_admin || da.traite_par)){
    doc.autoTable({
      startY: y, theme: "grid", styles: { fontSize: 9 }, head: [["Suivi", ""]], headStyles: { fillColor: [102, 114, 127] },
      body: [["Statut", T((STATUTS[da.statut] || {}).l)], ["Validation finance", T((FINANCE[da.finance_statut] || {}).l)],
             ["Réception", T((RECEPTION[da.reception_statut] || {}).l)], ["Commentaire", T(da.commentaire_admin || "-")]],
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 38 } }
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  if (y > 245){ doc.addPage(); y = 20; }
  const boxes = ["Demandeur", "Responsable service", "Finance", "Direction"];
  const bw = (W - 28 - 9) / 4;
  doc.setFontSize(9);
  boxes.forEach((b, i) => {
    const x = 14 + i * (bw + 3);
    doc.setDrawColor(150); doc.rect(x, y, bw, 26);
    doc.setFont("helvetica", "bold"); doc.text(b, x + 2, y + 5);
    doc.setFont("helvetica", "normal"); doc.text(i === 0 ? T(da.demandeur_nom) : "Visa :", x + 2, y + 10);
  });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++){
    doc.setPage(p); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Généré le ${fmtDT(new Date())} - ${T(da.numero || "")} - page ${p}/${pages}`, W / 2, 290, { align: "center" });
    doc.setTextColor(0);
  }
  return doc;
}

async function notifyServer(payload){
  try {
    const { data } = await sb.auth.getSession();
    const r = await fetch(CFG.NOTIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (data.session ? data.session.access_token : "") },
      body: JSON.stringify(payload)
    });
    if (!r.ok && r.status !== 200) return { email: false, raison: "HTTP " + r.status };
    return await r.json();
  } catch(e){ return { email: false, raison: e.message }; }
}

/* ---------------- Actions ---------------- */
async function envoyerDA(da){
  const updated = chk(await sb.from("demandes").update({ statut: "en_attente" }).eq("id", da.id).select().single());
  let pdfB64 = null;
  try {
    const doc = makePDF(updated);
    doc.save(updated.numero + ".pdf");
    pdfB64 = doc.output("datauristring").split(",")[1];
  } catch(e){ toast("PDF non généré : " + e.message, true); }
  const res = await notifyServer({ type: "envoi", demande_id: updated.id, pdf_base64: pdfB64 });
  toast(res.email ? `Demande ${updated.numero} envoyée : PDF téléchargé, administration notifiée par email.`
                  : `Demande ${updated.numero} envoyée : PDF téléchargé, administration notifiée dans l'application.`);
  await reloadAll();
  location.hash = "#/da/" + updated.id;
  render();
}

const ACTIONS = {
  ajoutLigne(){ $("#lignes").insertAdjacentHTML("beforeend", ligneRow()); updateTotals(); },
  supprLigne(el){ if (document.querySelectorAll("#lignes tr").length > 1){ el.closest("tr").remove(); updateTotals(); } },
  async envoyer(el, da){
    if (!confirm(`Envoyer la demande ${da.numero} à l'administration ?\nElle ne pourra plus être modifiée.`)) return;
    await envoyerDA(da);
  },
  async supprimer(el, da){
    if (!confirm(`Supprimer définitivement le brouillon ${da.numero} ?`)) return;
    chk(await sb.from("demandes").delete().eq("id", da.id).select());
    await reloadAll(); toast("Brouillon supprimé"); location.hash = "#/";
  },
  pdf(el, da){ makePDF(da).save(da.numero + ".pdf"); },
  exportCSV(){
    const cols = [["numero","N° DA"],["date_envoi","Envoyée le"],["demandeur_nom","Demandeur"],["service","Service"],["centre_cout","Centre de coût"],["categorie","Catégorie"],
      ["objet","Articles"],["montant_estime","Montant estimé"],["urgence","Urgence"],["statut","Statut"],["commentaire_admin","Commentaire"],["finance_statut","Finance"],
      ["bc_numero","N° BC"],["fournisseur_retenu","Fournisseur"],["montant_reel","Montant réel"],["reception_statut","Réception"],["reception_date","Date réception"]];
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const val = (d, k) => k === "objet" ? (d.lignes || []).map(l => `${l.quantite} ${l.unite} ${l.designation}`).join(" | ")
      : k === "statut" ? (STATUTS[d.statut] || {}).l : k === "finance_statut" ? (FINANCE[d.finance_statut] || {}).l
      : k === "reception_statut" ? (RECEPTION[d.reception_statut] || {}).l : k === "date_envoi" ? fmtDT(d.date_envoi) : d[k];
    const rows = DA.filter(d => d.statut !== "brouillon");
    const csv = "﻿" + cols.map(c => q(c[1])).join(";") + "\n" + rows.map(d => cols.map(c => q(val(d, c[0]))).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "demandes_achat_" + today() + ".csv"; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500);
  },
  async notifPerm(){ await Notification.requestPermission(); renderBell(); },
  async toutLu(){
    chk(await sb.from("notifications").update({ lu: true }).eq("user_id", profile.id).eq("lu", false));
    NOTIFS.forEach(n => n.lu = true); renderBell();
  }
};

const FORMS = {
  async login(form, d){
    chk(await sb.auth.signInWithPassword({ email: d.email, password: form.password.value }));
    await afterLogin();
  },
  async signup(form, d){
    if (!d.service) throw new Error("Choisissez votre service.");
    const res = chk(await sb.auth.signUp({ email: d.email, password: form.password.value,
      options: { data: { nom: d.nom, service: d.service }, emailRedirectTo: location.origin + location.pathname } }));
    if (res.session) await afterLogin();
    else { renderAuth("login"); toast("Compte créé. Confirmez votre adresse via le lien reçu par email, puis connectez-vous."); }
  },
  async forgot(form, d){
    chk(await sb.auth.resetPasswordForEmail(d.email, { redirectTo: location.origin + location.pathname }));
    toast("Si un compte existe pour cet email, un lien de réinitialisation vient d'être envoyé.");
  },
  async newPassword(form){
    chk(await sb.auth.updateUser({ password: form.password.value }));
    toast("Mot de passe mis à jour.");
    form.reset();
    if (recovering){ recovering = false; history.replaceState(null, "", location.pathname + "#/"); if (profile) return render(); }
    if (!profile){ history.replaceState(null, "", location.pathname + "#/"); await afterLogin(); }
  },
  async saveProfil(form, d){
    profile = chk(await sb.from("profiles").update({ nom: d.nom, service: d.service }).eq("id", profile.id).select().single());
    $("#user-name").textContent = (profile.nom || profile.email) + (isAdmin() ? " · Admin" : "");
    toast("Profil enregistré");
  },
  async saveDA(form, d, mode){
    // Lignes d'articles
    const lignes = [...document.querySelectorAll("#lignes tr")].map(tr => {
      const g = n => tr.querySelector(`[name=${n}]`).value.trim();
      return { designation: g("designation"), reference: g("reference") || null, quantite: num(g("quantite")), unite: g("unite"),
               prix_unitaire: g("prix_unitaire") === "" ? null : num(g("prix_unitaire")) };
    }).filter(l => l.designation || l.quantite);
    const envoyer = mode === "envoyer";
    if (envoyer){
      const manquants = [];
      if (!d.service) manquants.push("service");
      if (!d.centre_cout) manquants.push("centre de coût");
      if (!d.categorie) manquants.push("catégorie");
      if (!d.date_souhaitee) manquants.push("date souhaitée");
      if (!d.motif) manquants.push("motif");
      if (!lignes.length) manquants.push("au moins un article");
      if (lignes.some(l => !l.designation || !(l.quantite > 0))) manquants.push("désignation et quantité de chaque article");
      if (d.urgence !== "Normal" && !d.impact) manquants.push("impact de l'urgence");
      if (manquants.length) throw new Error("À compléter avant l'envoi : " + manquants.join(", ") + ".");
    }
    if (d.urgence === "Normal") d.impact = null;
    if (d.categorie !== "Pièces de rechange"){ d.marque = null; d.modele = null; }
    const row = Object.assign(d, { lignes, demandeur_nom: profile.nom });
    const id = form.dataset.id;
    const saved = id
      ? chk(await sb.from("demandes").update(row).eq("id", id).select().single())
      : chk(await sb.from("demandes").insert(Object.assign(row, { user_id: profile.id, statut: "brouillon" })).select().single());
    if (envoyer){
      if (!confirm(`Valider et envoyer la demande ${saved.numero} ?\nElle ne pourra plus être modifiée.`)){
        await reloadAll(); toast("Brouillon enregistré"); location.hash = "#/da/" + saved.id; return;
      }
      await envoyerDA(saved);
    } else {
      await reloadAll(); toast(`Brouillon ${saved.numero} enregistré`); location.hash = "#/da/" + saved.id;
    }
  },
  async adminStatut(form, d, _m, da){
    if (d.statut === "refusee" && !d.commentaire_admin) throw new Error("Un commentaire est obligatoire pour refuser une demande.");
    if (d.statut === da.statut && (d.commentaire_admin || null) === (da.commentaire_admin || null)) return toast("Aucun changement.");
    chk(await sb.from("demandes").update({ statut: d.statut, commentaire_admin: d.commentaire_admin }).eq("id", da.id).select().single());
    const res = await notifyServer({ type: "maj", demande_id: da.id, quoi: "statut" });
    toast(`Demande ${da.numero} : ${STATUTS[d.statut].l}. Demandeur notifié${res.email ? " (notification + email)" : ""}.`);
    await reloadAll(); render();
  },
  async adminFinance(form, d, _m, da){
    const changed = d.finance_statut !== da.finance_statut;
    chk(await sb.from("demandes").update({ finance_statut: d.finance_statut, finance_commentaire: d.finance_commentaire }).eq("id", da.id).select().single());
    if (changed) await notifyServer({ type: "maj", demande_id: da.id, quoi: "finance" });
    toast("Validation finance enregistrée"); await reloadAll(); render();
  },
  async adminReception(form, d, _m, da){
    const changed = d.reception_statut !== da.reception_statut;
    if (["recue","partielle","non_conforme"].includes(d.reception_statut) && !d.reception_date) d.reception_date = today();
    chk(await sb.from("demandes").update({
      bc_numero: d.bc_numero, fournisseur_retenu: d.fournisseur_retenu, montant_reel: d.montant_reel === null ? null : num(d.montant_reel),
      reception_statut: d.reception_statut, reception_date: d.reception_date, reception_remarque: d.reception_remarque
    }).eq("id", da.id).select().single());
    if (changed) await notifyServer({ type: "maj", demande_id: da.id, quoi: "reception" });
    toast("Commande / réception enregistrée"); await reloadAll(); render();
  }
};

/* ---------------- Événements ---------------- */
document.addEventListener("click", async e => {
  const auth = e.target.closest("[data-auth]");
  if (auth){ e.preventDefault(); renderAuth(auth.dataset.auth); return; }
  if (e.target.closest("#bell-btn")){
    const p = $("#notif-panel"); p.hidden = !p.hidden; renderBell(); return;
  }
  const n = e.target.closest("[data-notif]");
  if (n){
    const notif = NOTIFS.find(x => x.id === n.dataset.notif);
    $("#notif-panel").hidden = true;
    if (notif && !notif.lu){ notif.lu = true; renderBell(); sb.from("notifications").update({ lu: true }).eq("id", notif.id).then(() => {}); }
    if (notif && notif.demande_id) location.hash = "#/da/" + notif.demande_id;
    return;
  }
  if (!e.target.closest("#notif-panel") && !$("#notif-panel").hidden){ $("#notif-panel").hidden = true; }
  const go = e.target.closest("[data-go]");
  if (go){ location.hash = go.dataset.go; return; }
  const b = e.target.closest("[data-act]");
  if (!b) return;
  e.preventDefault();
  b.disabled = true;
  try { await ACTIONS[b.dataset.act](b, b.dataset.id ? findDA(b.dataset.id) : null); }
  catch(err){ console.error(err); toast(err.message, true); }
  finally { b.disabled = false; }
});
document.addEventListener("change", async e => {
  const el = e.target.closest("[data-user]");
  if (!el) return;
  const patch = { [el.dataset.field]: el.type === "checkbox" ? el.checked : el.value };
  try {
    chk(await sb.from("profiles").update(patch).eq("id", el.dataset.user).select().single());
    toast("Utilisateur mis à jour"); await reloadAll();
  } catch(err){ toast(err.message, true); render(); }
});
document.addEventListener("submit", async e => {
  const f = e.target.closest("form[data-form]");
  if (!f) return;
  e.preventDefault();
  const mode = e.submitter ? e.submitter.value : null;
  if (f.dataset.form === "saveDA" && mode === "brouillon"){ /* brouillon : pas de contrôle des champs obligatoires */ }
  else if (!f.reportValidity()) return;
  const btns = f.querySelectorAll("button"); btns.forEach(x => x.disabled = true);
  try {
    const da = f.dataset.id ? findDA(f.dataset.id) : null;
    await FORMS[f.dataset.form](f, formObj(f), mode, da);
  } catch(err){ console.error(err); toast(err.message, true); }
  finally { btns.forEach(x => x.disabled = false); }
});
$("#logout").addEventListener("click", async () => { await sb.auth.signOut(); location.hash = ""; });
