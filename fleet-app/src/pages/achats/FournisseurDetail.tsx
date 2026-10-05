import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import EntityForm, { type FieldDef } from '../../components/EntityForm';
import { Badge, Button, Card, ErrorBox, Info, Modal, PageHeader, Spinner, StatusBadge, Tabs } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fetchPeople } from '../../lib/data';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '../../lib/format';
import { CLASSIFICATION, CONTRAT_TYPES, DA_STATUT, FOURNISSEUR_STATUT } from '../../lib/labels';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { Contrat, DemandeAchat, Evaluation, Fournisseur, FournisseurScore, PrixHistorique } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';
import { CONTRAT_FIELDS, FOURNISSEUR_FIELDS } from './fournisseurFields';

type Tab = 'contrats' | 'commandes' | 'evaluations' | 'prix';

export default function FournisseurDetail() {
  const { id } = useParams();
  const { profile } = useAuth();
  const gerer = can(profile, 'fournisseursGerer');
  const evaluer = gerer || profile?.role === 'direction';
  const [tab, setTab] = useState<Tab>('contrats');
  const [editing, setEditing] = useState(false);
  const [contrat, setContrat] = useState<Contrat | 'new' | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const [f, score, contrats, das, evals, prix, people] = await Promise.all([
      supabase.from('fournisseurs').select('*').eq('id', id!).single().then(must),
      supabase.from('v_fournisseurs_score').select('*').eq('fournisseur_id', id!).maybeSingle().then((r) => r.data),
      supabase.from('contrats_fournisseurs').select('*').eq('fournisseur_id', id!).order('date_fin').then(must),
      supabase.from('demandes_achat').select('*').eq('fournisseur_id', id!).order('bc_date', { ascending: false }).then(must),
      supabase.from('evaluations_fournisseurs').select('*').eq('fournisseur_id', id!).order('created_at', { ascending: false }).then(must),
      supabase.from('prix_historique').select('*').eq('fournisseur_id', id!).order('date_prix', { ascending: false }).then(must),
      fetchPeople(),
    ]);
    return {
      f: f as Fournisseur, score: score as FournisseurScore | null, contrats: contrats as Contrat[], das: das as DemandeAchat[],
      evals: evals as Evaluation[], prix: prix as PrixHistorique[], names: new Map(people.map((x) => [x.id, x.full_name])),
    };
  }, [id]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBox>{error ?? 'Fournisseur introuvable'}</ErrorBox>;
  const { f, score } = data;
  const late = data.das.filter((d) => d.date_reception && d.date_livraison_prevue && d.date_reception.slice(0, 10) > d.date_livraison_prevue).length;
  const recues = data.das.filter((d) => d.date_reception).length;

  return (
    <div className="space-y-5">
      <div className="text-sm"><Link to="/fournisseurs" className="text-sky-700 hover:underline">← Fournisseurs</Link></div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{f.raison_sociale} <StatusBadge map={FOURNISSEUR_STATUT} value={f.statut} /> <StatusBadge map={CLASSIFICATION} value={f.classification} /></span>}
        subtitle={f.categories.join(' · ') || 'Aucune catégorie'}
        actions={
          <>
            {evaluer && <Button variant="secondary" onClick={() => setEvaluating(true)}>Évaluation semestrielle</Button>}
            {gerer && <Button onClick={() => setEditing(true)}>Modifier</Button>}
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <Card><Info label="Note globale">{score?.score != null ? `${fmtNumber(score.score, 2)} / 5` : '—'}</Info><p className="mt-1 text-xs text-slate-500">{score?.nb_evaluations ?? 0} évaluation(s)</p></Card>
        <Card><Info label="Délai · Qualité · Prix">{[score?.note_delai, score?.note_qualite, score?.note_prix].map((n) => (n == null ? '—' : fmtNumber(n, 1))).join(' · ')}</Info></Card>
        <Card><Info label="Commandes">{data.das.length}</Info><p className="mt-1 text-xs text-slate-500">{fmtMoney(data.das.reduce((s, d) => s + (d.montant_commande ?? 0), 0))}</p></Card>
        <Card><Info label="Taux de service">{recues ? `${fmtNumber(100 * (recues - late) / recues, 0)} %` : '—'}</Info><p className="mt-1 text-xs text-slate-500">{late} livraison(s) en retard</p></Card>
      </div>
      <Card title="Fiche fournisseur">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <Info label="ICE">{f.ice}</Info><Info label="RC">{f.rc}</Info><Info label="IF">{f.if_fiscal}</Info>
          <Info label="RIB">{f.rib}</Info>
          <Info label="Contact">{[f.contact_nom, f.telephone].filter(Boolean).join(' · ') || '—'}</Info>
          <Info label="E-mail">{f.email ? <a className="text-sky-700 underline" href={`mailto:${f.email}`}>{f.email}</a> : '—'}</Info>
          <Info label="Adresse">{f.adresse}</Info>
          <Info label="Paiement">{f.conditions_paiement}</Info>
          <Info label="Délai habituel">{f.delai_livraison_jours != null ? `${f.delai_livraison_jours} j` : '—'}</Info>
          <Info label="Certifications">{f.certifications}</Info>
          <Info label="Vérification avant référencement">
            {f.docs_legaux_ok ? '✓ Documents légaux' : <Badge tone="amber">Documents légaux à vérifier</Badge>}{' '}
            {f.references_ok ? '✓ Références' : <Badge tone="amber">Références à vérifier</Badge>}
          </Info>
          {f.notes && <Info label="Notes">{f.notes}</Info>}
        </dl>
      </Card>

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[['contrats', `Termes & contrats (${data.contrats.length})`], ['commandes', `Commandes (${data.das.length})`], ['evaluations', `Évaluations (${data.evals.length})`], ['prix', `Historique des prix (${data.prix.length})`]]} />
      {tab === 'contrats' && (
        <Card actions={gerer && <Button onClick={() => setContrat('new')}>+ Ajouter</Button>} title="Termes commerciaux (revue annuelle)">
          <DataTable
            rows={data.contrats} rowKey={(c) => c.id} exportName={`contrats-${f.raison_sociale}`}
            onRowClick={gerer ? (c) => setContrat(c) : undefined}
            rowClassName={(c) => (c.actif ? undefined : 'opacity-50')}
            columns={[
              { key: 'type', label: 'Type', value: (c) => CONTRAT_TYPES[c.type] },
              { key: 'objet', label: 'Objet' },
              { key: 'prix', label: 'Prix', value: (c) => c.prix ?? '', render: (c) => (c.prix != null ? `${fmtMoney(c.prix)}${c.unite ? ' / ' + c.unite : ''}` : '—') },
              { key: 'delai', label: 'Délai', value: (c) => c.delai_livraison_jours ?? '', render: (c) => (c.delai_livraison_jours != null ? `${c.delai_livraison_jours} j` : '—') },
              { key: 'paiement', label: 'Paiement', value: (c) => c.conditions_paiement ?? '' },
              { key: 'garantie', label: 'Garantie / pénalités', value: (c) => [c.garantie, c.penalites_retard].filter(Boolean).join(' · ') },
              { key: 'date_fin', label: 'Échéance', value: (c) => c.date_fin ?? '', render: (c) => {
                const exp = c.date_fin && c.date_fin < new Date().toISOString().slice(0, 10);
                return <span className={exp ? 'font-semibold text-red-600' : ''}>{fmtDate(c.date_fin)}</span>;
              } },
            ]}
          />
        </Card>
      )}
      {tab === 'commandes' && (
        <Card>
          <DataTable
            rows={data.das} rowKey={(d) => d.id} exportName={`commandes-${f.raison_sociale}`}
            columns={[
              { key: 'bc', label: 'BC', value: (d) => d.bc_numero ?? '', render: (d) => <Link className="text-sky-700 underline" to={`/achats/${d.id}`}>{d.bc_numero ?? d.numero}</Link> },
              { key: 'date', label: 'Date', value: (d) => d.bc_date ?? '', render: (d) => fmtDateTime(d.bc_date) },
              { key: 'motif', label: 'Objet', value: (d) => d.motif },
              { key: 'montant', label: 'Montant', value: (d) => d.montant_commande ?? '', render: (d) => fmtMoney(d.montant_commande) },
              { key: 'prevue', label: 'Promise', value: (d) => d.date_livraison_prevue ?? '', render: (d) => fmtDate(d.date_livraison_prevue) },
              { key: 'recue', label: 'Reçue', value: (d) => d.date_reception ?? '', render: (d) => fmtDate(d.date_reception) },
              { key: 'statut', label: 'Statut', value: (d) => DA_STATUT[d.statut][0], render: (d) => <StatusBadge map={DA_STATUT} value={d.statut} /> },
            ]}
          />
        </Card>
      )}
      {tab === 'evaluations' && (
        <Card>
          <DataTable
            rows={data.evals} rowKey={(e) => e.id} exportName={`evaluations-${f.raison_sociale}`}
            columns={[
              { key: 'date', label: 'Date', value: (e) => e.created_at, render: (e) => fmtDate(e.created_at) },
              { key: 'type', label: 'Type', value: (e) => (e.type === 'commande' ? 'Commande' : 'Semestrielle') },
              { key: 'notes', label: 'Délai · Qualité · Prix · Réactivité · Conformité', value: (e) => [e.note_delai, e.note_qualite, e.note_prix, e.note_reactivite, e.note_conformite].map((n) => n ?? '—').join(' · ') },
              { key: 'commentaire', label: 'Commentaire', value: (e) => e.commentaire ?? '' },
              { key: 'auteur', label: 'Par', value: (e) => (e.auteur_id ? data.names.get(e.auteur_id) ?? '' : '') },
            ]}
          />
          <p className="mt-2 text-xs text-slate-500">Sous une note de 3/5 : plan d'action avec le fournisseur ou déréférencement.</p>
        </Card>
      )}
      {tab === 'prix' && (
        <Card>
          <DataTable
            rows={data.prix} rowKey={(x) => String(x.id)} exportName={`prix-${f.raison_sociale}`}
            columns={[
              { key: 'date', label: 'Date', value: (x) => x.date_prix, render: (x) => fmtDate(x.date_prix) },
              { key: 'designation', label: 'Article', render: (x) => (x.article_id ? <Link className="text-sky-700 underline" to={`/magasin/${x.article_id}`}>{x.designation}</Link> : x.designation) },
              { key: 'prix', label: 'Prix unitaire', value: (x) => x.prix_unitaire, render: (x) => fmtMoney(x.prix_unitaire) },
              { key: 'source', label: 'Source' },
            ]}
          />
        </Card>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title="Modifier le fournisseur" wide>
        <EntityForm fields={FOURNISSEUR_FIELDS} initial={f as unknown as Record<string, unknown>} onSubmit={async (v) => {
          const { error: err } = await supabase.from('fournisseurs').update(v).eq('id', f.id);
          if (err) throw err;
          setEditing(false);
          void reload();
        }} />
      </Modal>
      <Modal open={!!contrat} onClose={() => setContrat(null)} title={contrat === 'new' ? 'Nouveaux termes' : 'Modifier les termes'} wide>
        {contrat && (
          <EntityForm fields={CONTRAT_FIELDS} initial={contrat === 'new' ? { type: 'accord_prix', actif: true } : (contrat as unknown as Record<string, unknown>)} onSubmit={async (v) => {
            const { error: err } = contrat === 'new'
              ? await supabase.from('contrats_fournisseurs').insert({ ...v, fournisseur_id: f.id })
              : await supabase.from('contrats_fournisseurs').update(v).eq('id', contrat.id);
            if (err) throw err;
            setContrat(null);
            void reload();
          }} />
        )}
      </Modal>
      <Modal open={evaluating} onClose={() => setEvaluating(false)} title="Évaluation semestrielle">
        <EntityForm
          fields={[
            ...(['note_delai', 'note_qualite', 'note_prix', 'note_reactivite'] as const).map((n): FieldDef => ({
              name: n, label: { note_delai: 'Délai', note_qualite: 'Qualité', note_prix: 'Prix', note_reactivite: 'Réactivité' }[n] + ' (1 à 5)',
              type: 'select', required: true, options: ['1', '2', '3', '4', '5'].map((x): [string, string] => [x, x]),
            })),
            { name: 'commentaire', label: "Commentaire / plan d'action", type: 'textarea' },
          ]}
          onSubmit={async (v) => {
            const { error: err } = await supabase.from('evaluations_fournisseurs').insert({
              fournisseur_id: f.id, type: 'semestrielle', auteur_id: profile!.id, commentaire: v.commentaire,
              note_delai: Number(v.note_delai), note_qualite: Number(v.note_qualite), note_prix: Number(v.note_prix), note_reactivite: Number(v.note_reactivite),
            });
            if (err) throw err;
            setEvaluating(false);
            void reload();
          }}
        />
      </Modal>
    </div>
  );
}
