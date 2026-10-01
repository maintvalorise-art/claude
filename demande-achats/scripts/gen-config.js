// Génère config.js à partir des variables d'environnement (build Vercel).
// Si SUPABASE_URL / SUPABASE_ANON_KEY ne sont pas définies, config.js n'est pas modifié.
const fs = require("fs");
const path = require("path");

const e = process.env;
if (!e.SUPABASE_URL || !e.SUPABASE_ANON_KEY) {
  console.log("[gen-config] SUPABASE_URL / SUPABASE_ANON_KEY absents : config.js inchangé.");
  process.exit(0);
}
const cfg = {
  SUPABASE_URL: e.SUPABASE_URL,
  SUPABASE_ANON_KEY: e.SUPABASE_ANON_KEY,
  ENTREPRISE: e.ENTREPRISE || "Mon entreprise",
  DEVISE: e.DEVISE || "MAD"
};
fs.writeFileSync(path.join(__dirname, "..", "config.js"),
  "// Généré automatiquement par scripts/gen-config.js\nwindow.APP_CONFIG = " + JSON.stringify(cfg, null, 2) + ";\n");
console.log("[gen-config] config.js généré.");
