import type { FieldDef } from '../../components/EntityForm';
import { ACHAT_CATEGORIES, CLASSIFICATION, CONTRAT_TYPES, FOURNISSEUR_STATUT, options } from '../../lib/labels';

export const FOURNISSEUR_FIELDS: FieldDef[] = [
  { name: 'raison_sociale', label: 'Raison sociale', required: true, full: true },
  { name: 'ice', label: 'ICE' },
  { name: 'rc', label: 'RC' },
  { name: 'if_fiscal', label: 'IF' },
  { name: 'rib', label: 'RIB' },
  { name: 'contact_nom', label: 'Contact' },
  { name: 'telephone', label: 'Téléphone', type: 'tel' },
  { name: 'email', label: 'E-mail', type: 'email' },
  { name: 'adresse', label: 'Adresse' },
  { name: 'categories', label: 'Catégories fournies', type: 'tags', choices: ACHAT_CATEGORIES },
  { name: 'certifications', label: 'Certifications' },
  { name: 'conditions_paiement', label: 'Conditions de paiement', placeholder: '60 jours fin de mois…' },
  { name: 'delai_livraison_jours', label: 'Délai de livraison habituel (j)', type: 'number', min: 0 },
  { name: 'classification', label: 'Classification', type: 'select', options: options(CLASSIFICATION), required: true },
  { name: 'statut', label: 'Statut', type: 'select', options: options(FOURNISSEUR_STATUT), required: true },
  { name: 'docs_legaux_ok', label: 'Documents légaux vérifiés', type: 'checkbox' },
  { name: 'references_ok', label: 'Visite / références clients vérifiées', type: 'checkbox' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

export const CONTRAT_FIELDS: FieldDef[] = [
  { name: 'type', label: 'Type', type: 'select', options: Object.entries(CONTRAT_TYPES), required: true },
  { name: 'objet', label: 'Objet', required: true, placeholder: 'Pneus 315/80 R22.5, huile 15W40…' },
  { name: 'categorie', label: 'Catégorie', type: 'select', options: ACHAT_CATEGORIES.map((c) => [c, c]) },
  { name: 'prix', label: 'Prix (DH)', type: 'number', min: 0, step: '0.01' },
  { name: 'unite', label: 'Unité', placeholder: 'pce, L, kg…' },
  { name: 'delai_livraison_jours', label: 'Délai de livraison (j)', type: 'number', min: 0 },
  { name: 'conditions_paiement', label: 'Conditions de paiement' },
  { name: 'garantie', label: 'Garantie' },
  { name: 'penalites_retard', label: 'Pénalités de retard' },
  { name: 'conditions_retour', label: 'Conditions de retour' },
  { name: 'date_debut', label: 'Début', type: 'date' },
  { name: 'date_fin', label: 'Fin / prochaine revue', type: 'date' },
  { name: 'actif', label: 'Actif', type: 'checkbox' },
];
