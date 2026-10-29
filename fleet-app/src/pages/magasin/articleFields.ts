import type { FieldDef } from '../../components/EntityForm';
import { ARTICLE_CATEGORIE, CRITICITE, options } from '../../lib/labels';
import type { Fournisseur, Vehicle } from '../../lib/types';
import { vehicleLabel } from '../../lib/data';

export function articleFields(vehicles: Vehicle[], fournisseurs: Fournisseur[], creation: boolean): FieldDef[] {
  const fopts: [string, string][] = fournisseurs.map((f) => [f.id, f.raison_sociale]);
  return [
    { name: 'code', label: 'Code article', required: true, placeholder: 'SP-HYD-0142' },
    { name: 'code_barres', label: 'Code-barres', hint: 'Laisser vide pour utiliser le code article' },
    { name: 'designation', label: 'Désignation', required: true, full: true },
    { name: 'categorie', label: 'Catégorie', type: 'select', options: options(ARTICLE_CATEGORIE), required: true },
    { name: 'criticite', label: 'Criticité', type: 'select', options: options(CRITICITE), required: true, hint: 'A : arrête une ligne / un camion ; toujours en stock, 2 fournisseurs' },
    { name: 'vehicle_id', label: 'Véhicule / engin', type: 'select', options: vehicles.map((v) => [v.id, vehicleLabel(v)]) },
    { name: 'equipement', label: 'Ou machine', placeholder: 'Clouteuse ligne 1…' },
    { name: 'ref_fabricant', label: 'Référence fabricant (OEM)' },
    { name: 'emplacement', label: 'Emplacement dans le magasin', type: 'emplacement', full: true, hint: 'Rack A à G, étage 1 (bas) à 4 (haut), case' },
    { name: 'stock_min', label: 'Stock min', type: 'number', min: 0, required: true },
    { name: 'stock_max', label: 'Stock max', type: 'number', min: 0, required: true },
    { name: 'unite', label: 'Unité', required: true },
    { name: 'prix_unitaire', label: 'Dernier prix d\'achat (DH)', type: 'number', min: 0, step: '0.01' },
    { name: 'fournisseur_principal_id', label: 'Fournisseur principal', type: 'select', options: fopts },
    { name: 'fournisseur_secondaire_id', label: 'Fournisseur secondaire', type: 'select', options: fopts },
    ...(creation ? [{ name: 'stock_initial', label: 'Stock initial', type: 'number' as const, min: 0 }] : [{ name: 'actif', label: 'Article actif', type: 'checkbox' as const }]),
  ];
}
