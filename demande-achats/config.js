// Configuration de l'application Demandes d'Achat (PR-ACH-001).
// Sur Vercel, laissez ce fichier tel quel : la configuration vient des variables d'environnement
// SUPABASE_URL, SUPABASE_ANON_KEY, ENTREPRISE et DEVISE, via la fonction api/config.js.
// Pour un test sur votre PC (sans Vercel), renseignez directement les valeurs ci-dessous.
// La clé "anon public" peut être publique : la sécurité est assurée par les règles RLS de la base.
// Ne mettez JAMAIS la clé "service_role" dans ce fichier.
window.APP_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  ENTREPRISE: "Mon entreprise",
  DEVISE: "MAD"
};
