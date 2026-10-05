import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import EntityForm from '../../components/EntityForm';
import { Badge, Button, Card, ErrorBox, Info, Modal, PageHeader, Spinner, StatusBadge, Tabs } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { byId, fetchPeople, fetchVehicles, vehicleLabel } from '../../lib/data';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '../../lib/format';
import { ARTICLE_CATEGORIE, CRITICITE, DA_STATUT, MOUVEMENT_MOTIF, MOUVEMENT_TYPE } from '../../lib/labels';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { Article, DemandeAchat, Fournisseur, MouvementStock, PrixHistorique } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';
import { articleFields } from './articleFields';

type Tab = 'mouvements' | 'prix' | 'da';

export default function ArticleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const gerer = can(profile, 'magasinGerer');
  const [tab, setTab] = useState<Tab>('mouvements');
  const [editing, setEditing] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const [a, mouvements, prix, vehicles, fournisseurs, people, lignes] = await Promise.all([
      supabase.from('articles').select('*').eq('id', id!).single().then(must),
      supabase.from('mouvements_stock').select('*').eq('article_id', id!).order('created_at', { ascending: false }).limit(500).then((r) => r.data ?? []),
      supabase.from('prix_historique').select('*').eq('article_id', id!).order('date_prix', { ascending: false }).then((r) => r.data ?? []),
      fetchVehicles(false),
      supabase.from('fournisseurs').select('*').order('raison_sociale').then((r) => (r.data ?? []) as Fournisseur[]),
      fetchPeople(),
      supabase.from('da_lignes').select('da_id').eq('article_id', id!).then((r) => r.data ?? []),
    ]);
    const daIds = [...new Set((lignes as { da_id: string }[]).map((l) => l.da_id))];
    const das = daIds.length ? ((await supabase.from('demandes_achat').select('*').in('id', daIds).order('created_at', { ascending: false })).data ?? []) : [];
    return {
      a: a as Article, mouvements: mouvements as MouvementStock[], prix: prix as PrixHistorique[], das: das as DemandeAchat[],
      vehicles, vmap: byId(vehicles), fournisseurs, fmap: byId(fournisseurs), names: new Map(people.map((x) => [x.id, x.full_name])),
    };
  }, [id]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBox>{error ?? 'Article introuvable'}</ErrorBox>;
  const { a } = data;
  const sorties12m = data.mouvements.filter((m) => m.type === 'sortie' && Date.now() - new Date(m.created_at).getTime() < 365 * 864e5);
  const conso = sorties12m.reduce((s, m) => s + Number(m.quantite), 0);

  return (
    <div className="space-y-5">
      <div className="text-sm print:hidden"><Link to="/magasin" className="text-sky-700 hover:underline">← Magasin</Link></div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{a.code} <StatusBadge map={CRITICITE} value={a.criticite} />{!a.actif && <Badge>Inactif</Badge>}</span>}
        subtitle={`${a.designation} · ${ARTICLE_CATEGORIE[a.categorie]}`}
        actions={gerer && (
          <>
            <Button variant="secondary" onClick={() => navigate(`/magasin/mouvement?code=${encodeURIComponent(a.code_barres ?? a.code)}`)}>🔁 Mouvement</Button>
            <Button onClick={() => setEditing(true)}>Modifier</Button>
          </>
        )}
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <Card><Info label="Stock actuel"><span className={a.stock_actuel < a.stock_min ? 'text-red-600' : ''}>{fmtNumber(a.stock_actuel)} {a.unite}</span></Info><p className="text-xs text-slate-500">min {fmtNumber(a.stock_min)} · max {fmtNumber(a.stock_max)}</p></Card>
        <Card><Info label="Valeur">{fmtMoney(a.stock_actuel * (a.prix_unitaire ?? 0))}</Info><p className="text-xs text-slate-500">PU {fmtMoney(a.prix_unitaire)}</p></Card>
        <Card><Info label="Consommation 12 mois">{fmtNumber(conso)} {a.unite}</Info><p className="text-xs text-slate-500">{sorties12m.length} sortie(s)</p></Card>
        <Card><Info label="Emplacement">{a.emplacement}</Info><p className="text-xs text-slate-500">Code-barres : {a.code_barres ?? a.code}</p></Card>
      </div>
      <Card>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <Info label="Équipement">{a.vehicle_id ? <Link className="text-sky-700 underline" to={`/vehicules/${a.vehicle_id}`}>{vehicleLabel(data.vmap.get(a.vehicle_id))}</Link> : a.equipement}</Info>
          <Info label="Référence fabricant">{a.ref_fabricant}</Info>
          <Info label="Fournisseur principal">{a.fournisseur_principal_id ? data.fmap.get(a.fournisseur_principal_id)?.raison_sociale : '—'}</Info>
          <Info label="Fournisseur secondaire">{a.fournisseur_secondaire_id ? data.fmap.get(a.fournisseur_secondaire_id)?.raison_sociale : a.criticite === 'A' ? <Badge tone="amber">Requis (pièce A)</Badge> : '—'}</Info>
        </dl>
      </Card>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[['mouvements', `Mouvements (${data.mouvements.length})`], ['prix', `Historique des prix (${data.prix.length})`], ['da', `Demandes d'achat (${data.das.length})`]]} />
      {tab === 'mouvements' && (
        <Card>
          <DataTable rows={data.mouvements} rowKey={(m) => m.id} exportName={`mouvements-${a.code}`} columns={[
            { key: 'date', label: 'Date', value: (m) => m.created_at, render: (m) => <span className="whitespace-nowrap">{fmtDateTime(m.created_at)}</span> },
            { key: 'type', label: 'Type', value: (m) => MOUVEMENT_TYPE[m.type][0], render: (m) => <StatusBadge map={MOUVEMENT_TYPE} value={m.type} /> },
            { key: 'quantite', label: 'Qté', value: (m) => (m.type === 'sortie' ? -m.quantite : m.quantite) },
            { key: 'stock_apres', label: 'Stock après', value: (m) => m.stock_apres ?? '' },
            { key: 'motif', label: 'Motif', value: (m) => MOUVEMENT_MOTIF[m.motif] ?? m.motif },
            { key: 'pour', label: 'Pour', value: (m) => [m.vehicle_id ? vehicleLabel(data.vmap.get(m.vehicle_id)) : m.equipement, m.demandeur].filter(Boolean).join(' · ') },
            { key: 'auteur', label: 'Par', value: (m) => (m.auteur_id ? data.names.get(m.auteur_id) ?? '' : '') },
            { key: 'commentaire', label: 'Commentaire', value: (m) => m.commentaire ?? '' },
          ]} />
        </Card>
      )}
      {tab === 'prix' && (
        <Card>
          <DataTable rows={data.prix} rowKey={(x) => String(x.id)} exportName={`prix-${a.code}`} columns={[
            { key: 'date', label: 'Date', value: (x) => x.date_prix, render: (x) => fmtDate(x.date_prix) },
            { key: 'fournisseur', label: 'Fournisseur', value: (x) => (x.fournisseur_id ? data.fmap.get(x.fournisseur_id)?.raison_sociale ?? '' : '') },
            { key: 'prix', label: 'Prix unitaire', value: (x) => x.prix_unitaire, render: (x) => fmtMoney(x.prix_unitaire) },
            { key: 'source', label: 'Source' },
          ]} />
        </Card>
      )}
      {tab === 'da' && (
        <Card>
          <DataTable rows={data.das} rowKey={(d) => d.id} onRowClick={(d) => navigate(`/achats/${d.id}`)} columns={[
            { key: 'numero', label: 'N°' },
            { key: 'date', label: 'Date', value: (d) => d.created_at, render: (d) => fmtDate(d.created_at) },
            { key: 'motif', label: 'Motif' },
            { key: 'statut', label: 'Statut', value: (d) => DA_STATUT[d.statut][0], render: (d) => <StatusBadge map={DA_STATUT} value={d.statut} /> },
          ]} />
        </Card>
      )}
      <Modal open={editing} onClose={() => setEditing(false)} title={`Modifier ${a.code}`} wide>
        <EntityForm fields={articleFields(data.vehicles, data.fournisseurs, false)} initial={a as unknown as Record<string, unknown>} onSubmit={async (v) => {
          const { error: err } = await supabase.from('articles').update(v).eq('id', a.id);
          if (err) throw err;
          setEditing(false);
          void reload();
        }} />
      </Modal>
    </div>
  );
}
