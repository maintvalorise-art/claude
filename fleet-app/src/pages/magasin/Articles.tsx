import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import EntityForm from '../../components/EntityForm';
import { Badge, Button, Card, ErrorBox, Modal, PageHeader, Select, Spinner, StatCard, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { byId, fetchArticles, fetchVehicles, vehicleLabel } from '../../lib/data';
import { fmtMoney, fmtNumber } from '../../lib/format';
import { ARTICLE_CATEGORIE, CRITICITE, options } from '../../lib/labels';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { ArticleCategorie, Criticite, Fournisseur } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';
import { articleFields } from './articleFields';

export default function Articles() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const gerer = can(profile, 'magasinGerer');
  const [adding, setAdding] = useState(false);
  const [categorie, setCategorie] = useState<ArticleCategorie | ''>('');
  const [criticite, setCriticite] = useState<Criticite | ''>('');
  const [filtre, setFiltre] = useState<'' | 'sous_min' | 'rupture' | 'inactifs'>('');

  const { data, loading, error } = useAsync(async () => {
    const [articles, vehicles, fournisseurs] = await Promise.all([
      fetchArticles(false),
      fetchVehicles(false),
      supabase.from('fournisseurs').select('*').order('raison_sociale').then((r) => (r.data ?? []) as Fournisseur[]),
    ]);
    return { articles, vehicles, vmap: byId(vehicles), fournisseurs, fmap: byId(fournisseurs) };
  });

  const list = useMemo(() => (data?.articles ?? []).filter((a) =>
    (filtre === 'inactifs' ? !a.actif : a.actif)
    && (!categorie || a.categorie === categorie) && (!criticite || a.criticite === criticite)
    && (filtre !== 'sous_min' || a.stock_actuel < a.stock_min)
    && (filtre !== 'rupture' || a.stock_actuel <= 0)), [data, categorie, criticite, filtre]);

  const actifs = (data?.articles ?? []).filter((a) => a.actif);
  const valeur = actifs.reduce((s, a) => s + a.stock_actuel * (a.prix_unitaire ?? 0), 0);
  const sousMin = actifs.filter((a) => a.stock_actuel < a.stock_min).length;
  const rupturesA = actifs.filter((a) => a.criticite === 'A' && a.stock_actuel <= 0).length;
  const aSansDeuxFournisseurs = actifs.filter((a) => a.criticite === 'A' && !(a.fournisseur_principal_id && a.fournisseur_secondaire_id)).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Magasin · Pièces de rechange"
        subtitle="Référentiel codifié, stock min/max, criticité A/B/C"
        actions={gerer && (
          <>
            <Button variant="secondary" onClick={() => navigate('/magasin/mouvement')}>🔁 Entrée / sortie</Button>
            <Button onClick={() => setAdding(true)}>+ Nouvel article</Button>
          </>
        )}
      />
      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Valeur du stock" value={fmtMoney(valeur)} tone="blue" hint={`${actifs.length} article(s)`} />
          <button type="button" className="text-left" onClick={() => setFiltre('sous_min')}><StatCard label="Sous stock min" value={sousMin} tone={sousMin ? 'amber' : 'green'} /></button>
          <button type="button" className="text-left" onClick={() => { setFiltre('rupture'); setCriticite('A'); }}><StatCard label="Ruptures pièces A" value={rupturesA} tone={rupturesA ? 'red' : 'green'} /></button>
          <StatCard label="Pièces A sans 2 fournisseurs" value={aSansDeuxFournisseurs} tone={aSansDeuxFournisseurs ? 'amber' : 'green'} />
        </div>
      )}
      <Card>
        {loading ? <Spinner /> : error || !data ? <ErrorBox>{error}</ErrorBox> : (
          <DataTable
            rows={list}
            rowKey={(a) => a.id}
            onRowClick={(a) => navigate(`/magasin/${a.id}`)}
            exportName="articles-stock"
            searchPlaceholder="Code, désignation, emplacement…"
            toolbar={
              <>
                <Select className="w-40" value={categorie} onChange={(e) => setCategorie(e.target.value as ArticleCategorie | '')}>
                  <option value="">Toutes catégories</option>
                  {options(ARTICLE_CATEGORIE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <Select className="w-36" value={criticite} onChange={(e) => setCriticite(e.target.value as Criticite | '')}>
                  <option value="">Criticité</option>
                  {options(CRITICITE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <Select className="w-40" value={filtre} onChange={(e) => setFiltre(e.target.value as typeof filtre)}>
                  <option value="">Tous les articles</option>
                  <option value="sous_min">Sous stock min</option>
                  <option value="rupture">En rupture</option>
                  <option value="inactifs">Inactifs</option>
                </Select>
              </>
            }
            columns={[
              { key: 'code', label: 'Code', render: (a) => <span className="font-semibold text-sky-700">{a.code}</span> },
              { key: 'designation', label: 'Désignation' },
              { key: 'categorie', label: 'Catégorie', value: (a) => ARTICLE_CATEGORIE[a.categorie] },
              { key: 'criticite', label: 'Crit.', render: (a) => <StatusBadge map={CRITICITE} value={a.criticite} /> },
              { key: 'equipement', label: 'Équipement', value: (a) => (a.vehicle_id ? vehicleLabel(data.vmap.get(a.vehicle_id)) : a.equipement) ?? '' },
              { key: 'emplacement', label: 'Emplacement', value: (a) => a.emplacement ?? '' },
              { key: 'stock', label: 'Stock', value: (a) => a.stock_actuel, render: (a) => (
                <span className="whitespace-nowrap">
                  <b className={a.stock_actuel <= 0 ? 'text-red-600' : a.stock_actuel < a.stock_min ? 'text-amber-600' : ''}>{fmtNumber(a.stock_actuel)}</b>
                  <span className="text-xs text-slate-500"> {a.unite} · min {fmtNumber(a.stock_min)} / max {fmtNumber(a.stock_max)}</span>
                  {a.stock_actuel < a.stock_min && <> <Badge tone="red">Réappro</Badge></>}
                </span>
              ) },
              { key: 'valeur', label: 'Valeur', value: (a) => a.stock_actuel * (a.prix_unitaire ?? 0), render: (a) => <span className="whitespace-nowrap">{fmtMoney(a.stock_actuel * (a.prix_unitaire ?? 0))}</span> },
              { key: 'fournisseur', label: 'Fournisseurs', value: (a) => [a.fournisseur_principal_id, a.fournisseur_secondaire_id].map((id) => (id ? data.fmap.get(id)?.raison_sociale : null)).filter(Boolean).join(' / ') },
            ]}
          />
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title="Nouvel article" wide>
        {data && (
          <EntityForm
            fields={articleFields(data.vehicles, data.fournisseurs, true)}
            initial={{ categorie: 'mecanique', criticite: 'C', stock_min: 0, stock_max: 0, unite: 'pce' }}
            onSubmit={async (v) => {
              const { stock_initial, ...row } = v;
              if (!row.code_barres) row.code_barres = row.code;
              const { data: a, error: err } = await supabase.from('articles').insert(row).select('id').single();
              if (err) throw err.code === '23505' ? new Error('Ce code article ou code-barres existe déjà.') : err;
              if (Number(stock_initial) > 0) {
                const { error: e2 } = await supabase.from('mouvements_stock').insert({
                  article_id: a.id, type: 'entree', quantite: Number(stock_initial), motif: 'stock_initial', auteur_id: profile!.id, prix_unitaire: row.prix_unitaire,
                });
                if (e2) throw e2;
              }
              navigate(`/magasin/${a.id}`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
