// Fonction Vercel : fournit la configuration du navigateur à partir des variables d'environnement.
// Chargée par index.html via <script src="/api/config">. Aucune étape de build n'est nécessaire.
// Seules des valeurs publiques sont exposées (la clé "anon" est publique, protégée par les règles RLS).
module.exports = (req, res) => {
  const e = process.env;
  const cfg = {};
  if (e.SUPABASE_URL) cfg.SUPABASE_URL = e.SUPABASE_URL;
  if (e.SUPABASE_ANON_KEY) cfg.SUPABASE_ANON_KEY = e.SUPABASE_ANON_KEY;
  if (e.ENTREPRISE) cfg.ENTREPRISE = e.ENTREPRISE;
  if (e.DEVISE) cfg.DEVISE = e.DEVISE;
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send("window.APP_CONFIG = Object.assign(window.APP_CONFIG || {}, " + JSON.stringify(cfg) + ");\n");
};
