// Génère config.js à partir des variables d'environnement (build Vercel).
// Si les variables ne sont pas définies, config.js n'est pas modifié (mode local).
const fs = require("fs");
const path = require("path");

const url = process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_ANON_KEY || "";
const devise = process.env.DEVISE || "MAD";

if (!url || !key) {
  console.log("[gen-config] SUPABASE_URL / SUPABASE_ANON_KEY absents : config.js inchangé (mode local).");
  process.exit(0);
}

const content = `// Généré automatiquement par scripts/gen-config.js
window.APP_CONFIG = ${JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key, DEVISE: devise }, null, 2)};
`;
fs.writeFileSync(path.join(__dirname, "..", "config.js"), content);
console.log("[gen-config] config.js généré (mode Supabase).");
