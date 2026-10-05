import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import EntityForm from '../../components/EntityForm';
import { Badge, Button, Card, ErrorBox, Modal, PageHeader, Select, Spinner, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fetchFournisseurs } from '../../lib/data';
import { fmtNumber } from '../../lib/format';
import { ACHAT_CATEGORIES, CLASSIFICATION, FOURNISSEUR_STATUT, options } from '../../lib/labels';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { Classification, FournisseurScore, FournisseurStatut } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';
import { FOURNISSEUR_FIELDS } from './fournisseurFields';

const CRITIQUES = ['Pneus', 'Huiles & lubrifiants', 'Filtres', 'Gasoil', 'Pièces mécaniques', 'Pièces hydrauliques', 'Bois', 'Clous'];

export default function Fournisseurs() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const gerer = can(profile, 'fournisseursGerer');
  const [adding, setAdding] = useState(false);
  const [statut, setStatut] = useState<FournisseurStatut | ''>('');
  const [classif, setClassif] = useState<Classification | ''>('');
  const [categorie, setCategorie] = useState('');

  const { data, loading, error } = useAsync(async () => {
    const [fournisseurs, scores] = await Promise.all([
      fetchFournisseurs(),
      supabase.from('v_fournisseurs_score').select('*').then(must),
    ]);
    return { fournisseurs, scores: new Map((scores as FournisseurScore[]).map((s) => [s.fournisseur_id, s])) };
  });

  const list = useMemo(() => (data?.fournisseurs ?? []).filter((f) =>
    (!statut || f.statut === statut) && (!classif || f.classification === classif) && (!categorie || f.categories.includes(categorie))), [data, statut, classif, categorie]);

  // Catégories critiques avec moins de 2 fournisseurs référencés (source unique).
  const sourceUnique = useMemo(() => CRITIQUES.map((c) => ({
    c, n: (data?.fournisseurs ?? []).filter((f) => f.statut === 'actif' && f.categories.includes(c)).length,
  })).filter((x) => x.n < 2), [data]);

  const aEvaluer = (data?.fournisseurs ?? []).filter((f) => {
    if (f.statut !== 'actif') return false;
    const last = data?.scores.get(f.id)?.derniere_evaluation_semestrielle;
    return !last || Date.now() - new Date(last).getTime() > 182 * 864e5;
  }).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Panel fournisseurs"
        subtitle="Fiches, vérification, classification, évaluation semestrielle, termes et historique des prix"
        actions={gerer && <Button onClick={() => setAdding(true)}>+ Nouveau fournisseur</Button>}
      />
      {data && (sourceUnique.length > 0 || aEvaluer > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {sourceUnique.length > 0 && (
            <Card title="⚠️ Catégories critiques à source unique">
              <div className="flex flex-wrap gap-1">{sourceUnique.map((x) => <Badge key={x.c} tone={x.n ? 'amber' : 'red'}>{x.c} : {x.n}</Badge>)}</div>
              <p className="mt-2 text-xs text-slate-500">Objectif : au moins 2 fournisseurs référencés par catégorie critique. Prospecter de nouveaux fournisseurs.</p>
            </Card>
          )}
          {aEvaluer > 0 && (
            <Card title="📋 Évaluation semestrielle">
              <p className="text-sm"><b>{aEvaluer}</b> fournisseur(s) référencé(s) sans évaluation depuis plus de 6 mois.</p>
            </Card>
          )}
        </div>
      )}
      <Card>
        {loading ? <Spinner /> : error || !data ? <ErrorBox>{error}</ErrorBox> : (
          <DataTable
            rows={list}
            rowKey={(f) => f.id}
            onRowClick={(f) => navigate(`/fournisseurs/${f.id}`)}
            exportName="fournisseurs"
            toolbar={
              <>
                <Select className="w-40" value={statut} onChange={(e) => setStatut(e.target.value as FournisseurStatut | '')}>
                  <option value="">Tous statuts</option>
                  {options(FOURNISSEUR_STATUT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <Select className="w-40" value={classif} onChange={(e) => setClassif(e.target.value as Classification | '')}>
                  <option value="">Toutes classes</option>
                  {options(CLASSIFICATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <Select className="w-44" value={categorie} onChange={(e) => setCategorie(e.target.value)}>
                  <option value="">Toutes catégories</option>
                  {ACHAT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </>
            }
            columns={[
              { key: 'raison_sociale', label: 'Raison sociale', render: (f) => <span className="font-semibold text-sky-700">{f.raison_sociale}</span> },
              { key: 'categories', label: 'Catégories', value: (f) => f.categories.join(', ') },
              { key: 'contact', label: 'Contact', value: (f) => [f.contact_nom, f.telephone].filter(Boolean).join(' · ') },
              { key: 'classification', label: 'Classe', value: (f) => CLASSIFICATION[f.classification][0], render: (f) => <StatusBadge map={CLASSIFICATION} value={f.classification} /> },
              { key: 'statut', label: 'Statut', value: (f) => FOURNISSEUR_STATUT[f.statut][0], render: (f) => <StatusBadge map={FOURNISSEUR_STATUT} value={f.statut} /> },
              { key: 'score', label: 'Note /5', value: (f) => data.scores.get(f.id)?.score ?? '', render: (f) => {
                const s = data.scores.get(f.id);
                return s?.score != null ? <span className={Number(s.score) < 3 ? 'font-semibold text-red-600' : ''}>{fmtNumber(s.score, 1)} <span className="text-xs text-slate-400">({s.nb_evaluations})</span></span> : '—';
              } },
              { key: 'verif', label: 'Vérifié', value: (f) => (f.docs_legaux_ok && f.references_ok ? 'Oui' : 'Non'), render: (f) => (f.docs_legaux_ok && f.references_ok ? '✓' : <Badge tone="amber">À vérifier</Badge>) },
            ]}
          />
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title="Nouveau fournisseur" wide>
        <EntityForm
          fields={FOURNISSEUR_FIELDS}
          initial={{ classification: 'occasionnel', statut: 'en_verification', categories: [] }}
          onSubmit={async (v) => {
            const { data: row, error: err } = await supabase.from('fournisseurs').insert(v).select('id').single();
            if (err) throw err;
            navigate(`/fournisseurs/${row.id}`);
          }}
        />
      </Modal>
    </div>
  );
}
