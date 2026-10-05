import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, ErrorBox, Field, Info, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Td, Textarea } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { byId, fetchPeople, fetchVehicles, vehicleLabel } from '../../lib/data';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber, todayIso } from '../../lib/format';
import { DA_ACTION_LABELS, DA_STATUT, URGENCE } from '../../lib/labels';
import { can } from '../../lib/roles';
import { errorMessage, supabase } from '../../lib/supabase';
import type { Article, DADelai, DAHistorique, DALigne, DemandeAchat, Devis, Fournisseur, Parametre } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

type Dialog = 'envoyer_validation' | 'valider' | 'rejeter' | 'commander' | 'receptionner' | 'cloturer' | 'annuler' | 'devis' | null;

export default function DemandeDetail() {
  const { id } = useParams();
  const { profile } = useAuth();
  const p = profile!;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const da = must(await supabase.from('demandes_achat').select('*').eq('id', id!).single()) as DemandeAchat;
    const [lignes, devis, hist, people, vehicles, delai, params, manager] = await Promise.all([
      supabase.from('da_lignes').select('*').eq('da_id', da.id).order('designation').then(must),
      supabase.from('devis').select('*').eq('da_id', da.id).order('montant').then((r) => (r.error ? [] : r.data ?? [])),
      supabase.from('da_historique').select('*').eq('da_id', da.id).order('id').then(must),
      fetchPeople(),
      fetchVehicles(false),
      supabase.from('v_da_delais').select('*').eq('id', da.id).single().then(must),
      supabase.from('parametres').select('*').then(must),
      supabase.from('profiles').select('manager_id').eq('id', da.demandeur_id).maybeSingle(),
    ]);
    const l = lignes as DALigne[];
    const artIds = l.map((x) => x.article_id).filter(Boolean) as string[];
    const articles = artIds.length ? (must(await supabase.from('articles').select('*').in('id', artIds)) as Article[]) : [];
    const fournisseurs = can(p, 'fournisseursVoir')
      ? (must(await supabase.from('fournisseurs').select('*').order('raison_sociale')) as Fournisseur[])
      : [];
    return {
      da, lignes: l, devis: devis as Devis[], hist: hist as DAHistorique[],
      names: new Map(people.map((x) => [x.id, x.full_name])),
      vehicles: byId(vehicles), delai: delai as DADelai,
      params: new Map((params as Parametre[]).map((x) => [x.cle, Number(x.valeur)])),
      managerId: (manager.data as { manager_id: string | null } | null)?.manager_id ?? null,
      articles: byId(articles), fournisseurs, fmap: byId(fournisseurs),
    };
  }, [id]);

  async function run(action: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    setActionError(null);
    try {
      const { error: err } = await supabase.rpc('da_action', { p_da_id: id, p_action: action, p: payload });
      if (err) throw err;
      setDialog(null);
      await reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBox>{error ?? 'Demande introuvable'}</ErrorBox>;
  const { da, lignes, devis, hist, names, fmap } = data;
  const role = p.role;
  const acheteur = ['acheteur', 'admin'].includes(role);
  const magasin = ['magasinier', 'admin'].includes(role);
  const direction = ['direction', 'admin'].includes(role);
  const estManager = data.managerId === p.id;
  const seuilDir = data.params.get('seuil_validation_direction') ?? 0;
  const seuil3 = data.params.get('seuil_trois_devis') ?? 0;
  const montantRef = devis.find((d) => d.retenu)?.montant ?? da.montant_estime ?? 0;
  const devisRequis = da.urgence === 'arret_machine' || montantRef < seuil3 ? 1 : 3;
  const enStock = lignes.length > 0 && lignes.every((l) => l.article_id && (data.articles.get(l.article_id)?.stock_actuel ?? 0) >= l.quantite);
  const fournisseur = da.fournisseur_id ? fmap.get(da.fournisseur_id) : undefined;

  // Actions possibles selon le profil et le statut.
  const actions: ReactNode[] = [];
  const btn = (key: string, label: string, onClick: () => void, variant: 'primary' | 'secondary' | 'danger' = 'primary') =>
    actions.push(<Button key={key} variant={variant} disabled={busy} onClick={onClick}>{label}</Button>);

  if (da.statut === 'soumise') {
    if (acheteur && !da.acheteur_id) btn('pec', 'Prendre en charge', () => run('prendre_en_charge'), 'secondary');
    if (magasin) btn('stock', enStock ? '✓ Servir depuis le stock' : 'Servir depuis le stock', () => run('servir_stock'), enStock ? 'primary' : 'secondary');
    if (acheteur || magasin) btn('val', 'Envoyer en validation', () => setDialog('envoyer_validation'));
  }
  if (da.statut === 'attente_validation' && (estManager || direction || (acheteur && !data.managerId))) {
    btn('ok', 'Valider', () => setDialog('valider'));
    btn('ko', 'Rejeter', () => setDialog('rejeter'), 'danger');
  }
  if (da.statut === 'attente_direction' && direction) {
    btn('ok', 'Valider (direction)', () => setDialog('valider'));
    btn('ko', 'Rejeter', () => setDialog('rejeter'), 'danger');
  }
  if (['soumise', 'attente_validation', 'attente_direction', 'validee'].includes(da.statut) && acheteur) {
    btn('devis', '+ Devis', () => setDialog('devis'), 'secondary');
  }
  if (da.statut === 'validee' && acheteur) {
    if (!da.acheteur_id) btn('pec', 'Prendre en charge', () => run('prendre_en_charge'), 'secondary');
    btn('bc', 'Émettre le bon de commande', () => setDialog('commander'));
    btn('ko', 'Rejeter', () => setDialog('rejeter'), 'danger');
  }
  if (da.statut === 'commandee' && (magasin || acheteur)) btn('rec', 'Réceptionner', () => setDialog('receptionner'));
  if (da.statut === 'receptionnee' && acheteur) btn('clo', 'Clôturer & évaluer', () => setDialog('cloturer'));
  if (['soumise', 'attente_validation', 'attente_direction', 'validee', 'commandee'].includes(da.statut)
      && (acheteur || (da.demandeur_id === p.id && da.statut === 'soumise'))) {
    btn('ann', 'Annuler', () => setDialog('annuler'), 'secondary');
  }

  const total = lignes.reduce((s, l) => s + (l.prix_unitaire ?? 0) * l.quantite, 0);
  const now = Date.now();
  const lateTake = da.statut === 'soumise' && !da.prise_en_charge_le && now > new Date(data.delai.limite_prise_en_charge).getTime();
  const lateOrder = ['soumise', 'attente_validation', 'attente_direction', 'validee'].includes(da.statut) && now > new Date(data.delai.limite_commande).getTime();

  return (
    <div className="space-y-5">
      <div className="text-sm print:hidden"><Link to="/achats" className="text-sky-700 hover:underline">← Demandes d'achat</Link></div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{da.numero} <StatusBadge map={DA_STATUT} value={da.statut} /> <StatusBadge map={URGENCE} value={da.urgence} />{da.auto && <Badge tone="violet">Auto stock min</Badge>}</span>}
        subtitle={`Demandée par ${names.get(da.demandeur_id) ?? '—'} le ${fmtDateTime(da.created_at)}`}
        actions={<div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
      />
      <ErrorBox>{actionError}</ErrorBox>
      {(lateTake || lateOrder) && (
        <ErrorBox>
          {lateTake ? `Délai de prise en charge dépassé (limite ${fmtDateTime(data.delai.limite_prise_en_charge)}).` : ''}
          {lateOrder ? ` Délai de commande dépassé (limite ${fmtDateTime(data.delai.limite_commande)}).` : ''}
        </ErrorBox>
      )}

      <Card>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <Info label="Motif">{da.motif}</Info>
          <Info label="Service">{da.service}</Info>
          <Info label="Véhicule / machine">{da.vehicle_id ? vehicleLabel(data.vehicles.get(da.vehicle_id)) : da.equipement}</Info>
          <Info label="Date souhaitée">{fmtDate(da.date_souhaitee)}</Info>
          <Info label="Montant estimé">{fmtMoney(da.montant_estime)}</Info>
          <Info label="Acheteur">{da.acheteur_id ? names.get(da.acheteur_id) : '—'}{da.prise_en_charge_le && <span className="block text-xs text-slate-500">pris en charge {fmtDateTime(da.prise_en_charge_le)}</span>}</Info>
          <Info label="Validation responsable">{da.valideur_id ? `${names.get(da.valideur_id)} · ${fmtDateTime(da.valide_le)}` : '—'}</Info>
          <Info label="Validation direction">{da.valideur_direction_id ? `${names.get(da.valideur_direction_id)} · ${fmtDateTime(da.valide_direction_le)}` : (da.montant_estime ?? 0) >= seuilDir ? 'Requise' : 'Non requise'}</Info>
          <Info label="Limites cibles">Prise en charge {fmtDateTime(data.delai.limite_prise_en_charge)}<br />Commande {fmtDateTime(data.delai.limite_commande)}</Info>
          {da.bc_numero && <Info label="Bon de commande">{da.bc_numero} · {fmtDateTime(da.bc_date)}</Info>}
          {da.bc_numero && <Info label="Fournisseur">{fournisseur ? <Link className="text-sky-700 underline" to={`/fournisseurs/${fournisseur.id}`}>{fournisseur.raison_sociale}</Link> : '—'}</Info>}
          {da.bc_numero && <Info label="Livraison promise">{fmtDate(da.date_livraison_prevue)}</Info>}
          {da.date_reception && <Info label="Réception">{fmtDateTime(da.date_reception)} · BL {da.bl_numero ?? '—'} · Facture {da.facture_numero ?? '—'} {da.rapprochement_ok ? '✓ rapproché' : ''}</Info>}
          {da.motif_rejet && <Info label="Motif rejet / annulation"><span className="text-red-700">{da.motif_rejet}</span></Info>}
        </dl>
      </Card>

      <Card title="Lignes" actions={da.bc_numero && <BcActions da={da} fournisseur={fournisseur} />}>
        <Table head={['Désignation', 'Référence', 'Qté', 'Stock magasin', 'Prix unitaire', 'Total', 'Reçu']}>
          {lignes.map((l) => {
            const a = l.article_id ? data.articles.get(l.article_id) : undefined;
            return (
              <tr key={l.id}>
                <Td>{a ? <Link className="text-sky-700 underline" to={`/magasin/${a.id}`}>{l.designation}</Link> : l.designation}</Td>
                <Td>{l.reference ?? '—'}</Td>
                <Td className="whitespace-nowrap">{fmtNumber(l.quantite)} {l.unite}</Td>
                <Td>{a ? <span className={a.stock_actuel >= l.quantite ? 'text-emerald-700' : 'text-red-600'}>{fmtNumber(a.stock_actuel)} {a.unite}</span> : 'Hors magasin'}</Td>
                <Td className="whitespace-nowrap">{fmtMoney(l.prix_unitaire)}</Td>
                <Td className="whitespace-nowrap">{l.prix_unitaire != null ? fmtMoney(l.prix_unitaire * l.quantite) : '—'}</Td>
                <Td>{fmtNumber(l.quantite_recue)} / {fmtNumber(l.quantite)}</Td>
              </tr>
            );
          })}
        </Table>
        {total > 0 && <p className="mt-2 text-right text-sm font-semibold">Total : {fmtMoney(total)}</p>}
      </Card>

      {(can(p, 'achatsTraiter') || devis.length > 0) && (
        <Card title={`Consultation fournisseurs · ${devis.length} devis (${devisRequis} requis)`}>
          {devis.length === 0 ? <p className="text-sm text-slate-500">Aucun devis. Minimum {devisRequis} devis {devisRequis === 1 ? '(montant sous le seuil ou arrêt machine)' : `au-delà de ${fmtMoney(seuil3)}`}.</p> : (
            <Table head={['Fournisseur', 'Référence', 'Montant', 'Délai', 'Conditions', 'Retenu']}>
              {devis.map((d) => (
                <tr key={d.id} className={d.retenu ? 'bg-emerald-50' : ''}>
                  <Td>{fmap.get(d.fournisseur_id)?.raison_sociale ?? '—'}</Td>
                  <Td>{d.reference ?? '—'}</Td>
                  <Td className="whitespace-nowrap font-medium">{fmtMoney(d.montant)}</Td>
                  <Td>{d.delai_jours != null ? `${d.delai_jours} j` : '—'}</Td>
                  <Td>{d.conditions ?? '—'}</Td>
                  <Td>
                    {d.retenu ? <Badge tone="green">Retenu</Badge> : acheteur && ['soumise', 'attente_validation', 'attente_direction', 'validee'].includes(da.statut) ? (
                      <Button variant="secondary" className="px-2 py-1 text-xs" onClick={async () => {
                        await supabase.from('devis').update({ retenu: false }).eq('da_id', da.id);
                        await supabase.from('devis').update({ retenu: true }).eq('id', d.id);
                        void reload();
                      }}>Retenir</Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      <Card title="Historique">
        <ol className="relative space-y-3 border-l border-slate-200 pl-5 text-sm">
          {hist.map((h) => (
            <li key={h.id}>
              <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-slate-400" />
              <b>{DA_ACTION_LABELS[h.action] ?? h.action}</b>
              {h.statut_apres && h.statut_apres !== h.statut_avant && <> → <StatusBadge map={DA_STATUT} value={h.statut_apres} /></>}
              <span className="block text-xs text-slate-500">{fmtDateTime(h.created_at)} · {h.auteur_id ? names.get(h.auteur_id) : 'Système'}</span>
              {h.commentaire && <span className="block text-slate-700">« {h.commentaire} »</span>}
            </li>
          ))}
        </ol>
      </Card>

      {/* Dialogues d'action */}
      <Modal open={dialog === 'envoyer_validation'} onClose={() => setDialog(null)} title="Envoyer en validation">
        <SimpleAction busy={busy} error={actionError} submitLabel="Envoyer" fields={[{ name: 'montant_estime', label: 'Montant estimé (DH)', type: 'number', initial: da.montant_estime?.toString() ?? '' }]}
          note={`Au-delà de ${fmtMoney(seuilDir)}, la direction valide après le responsable hiérarchique.`}
          onSubmit={(v) => run('envoyer_validation', v)} />
      </Modal>
      <Modal open={dialog === 'valider'} onClose={() => setDialog(null)} title="Valider la demande">
        <SimpleAction busy={busy} error={actionError} submitLabel="Valider" fields={[{ name: 'commentaire', label: 'Commentaire', type: 'textarea' }]} onSubmit={(v) => run('valider', v)} />
      </Modal>
      <Modal open={dialog === 'rejeter'} onClose={() => setDialog(null)} title="Rejeter la demande">
        <SimpleAction busy={busy} error={actionError} submitLabel="Rejeter" danger fields={[{ name: 'commentaire', label: 'Motif du rejet', type: 'textarea', required: true }]} onSubmit={(v) => run('rejeter', v)} />
      </Modal>
      <Modal open={dialog === 'annuler'} onClose={() => setDialog(null)} title="Annuler la demande">
        <SimpleAction busy={busy} error={actionError} submitLabel="Annuler la demande" danger fields={[{ name: 'commentaire', label: "Justification de l'annulation", type: 'textarea', required: true }]} onSubmit={(v) => run('annuler', v)} />
      </Modal>
      <Modal open={dialog === 'devis'} onClose={() => setDialog(null)} title="Ajouter un devis">
        <DevisForm daId={da.id} fournisseurs={data.fournisseurs.filter((f) => f.statut !== 'dereference')} onDone={() => { setDialog(null); void reload(); }} />
      </Modal>
      <Modal open={dialog === 'commander'} onClose={() => setDialog(null)} title="Émettre le bon de commande" wide>
        <CommandeForm lignes={lignes} devis={devis} busy={busy} error={actionError} fournisseurNom={(fid) => fmap.get(fid)?.raison_sociale ?? '—'} onSubmit={(v) => run('commander', v)} />
      </Modal>
      <Modal open={dialog === 'receptionner'} onClose={() => setDialog(null)} title="Réception de la commande" wide>
        <ReceptionForm lignes={lignes} busy={busy} error={actionError} onSubmit={(v) => run('receptionner', v)} />
      </Modal>
      <Modal open={dialog === 'cloturer'} onClose={() => setDialog(null)} title="Clôture et évaluation fournisseur">
        <SimpleAction busy={busy} error={actionError} submitLabel="Clôturer"
          fields={[
            { name: 'note_delai', label: 'Respect du délai (1 à 5)', type: 'note', required: true },
            { name: 'note_qualite', label: 'Qualité (1 à 5)', type: 'note', required: true },
            { name: 'note_conformite', label: 'Conformité (1 à 5)', type: 'note', required: true },
            { name: 'commentaire', label: 'Commentaire', type: 'textarea' },
          ]}
          note="Le demandeur est notifié dans son espace (statut « Clôturée »)."
          onSubmit={(v) => run('cloturer', v)} />
      </Modal>
    </div>
  );
}

type SimpleField = { name: string; label: string; type: 'text' | 'number' | 'textarea' | 'note' | 'date'; required?: boolean; initial?: string };

function SimpleAction({ fields, onSubmit, submitLabel, busy, error, note, danger }: {
  fields: SimpleField[]; onSubmit: (v: Record<string, unknown>) => void; submitLabel: string; busy: boolean; error: string | null; note?: string; danger?: boolean;
}) {
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.name, f.initial ?? (f.type === 'note' ? '4' : '')])));
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fields.find((f) => f.name === k)?.type === 'note' ? Number(x) : x]))); }}>
      {fields.map((f) => (
        <Field key={f.name} label={f.label + (f.required ? ' *' : '')}>
          {f.type === 'textarea' ? <Textarea value={v[f.name]} required={f.required} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
            : f.type === 'note' ? (
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setV({ ...v, [f.name]: String(n) })}
                    className={`h-10 w-10 rounded-lg border text-sm font-bold ${v[f.name] === String(n) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'}`}>{n}</button>
                ))}
              </div>
            )
            : <Input type={f.type} value={v[f.name]} required={f.required} step="any" onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />}
        </Field>
      ))}
      {note && <p className="text-xs text-slate-500">{note}</p>}
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy} className="w-full">{busy ? '…' : submitLabel}</Button>
    </form>
  );
}

function DevisForm({ daId, fournisseurs, onDone }: { daId: string; fournisseurs: Fournisseur[]; onDone: () => void }) {
  const [f, setF] = useState({ fournisseur_id: '', reference: '', montant: '', delai_jours: '', conditions: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('devis').insert({
      da_id: daId, fournisseur_id: f.fournisseur_id, reference: f.reference || null, montant: Number(f.montant),
      delai_jours: f.delai_jours ? Number(f.delai_jours) : null, conditions: f.conditions || null,
    });
    setBusy(false);
    if (err) setError(errorMessage(err));
    else onDone();
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Fournisseur *">
        <Select value={f.fournisseur_id} onChange={(e) => setF({ ...f, fournisseur_id: e.target.value })} required>
          <option value="">—</option>
          {fournisseurs.map((x) => <option key={x.id} value={x.id}>{x.raison_sociale}</option>)}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Montant TTC (DH) *"><Input type="number" min={0} step="0.01" value={f.montant} onChange={(e) => setF({ ...f, montant: e.target.value })} required /></Field>
        <Field label="Délai (jours)"><Input type="number" min={0} value={f.delai_jours} onChange={(e) => setF({ ...f, delai_jours: e.target.value })} /></Field>
        <Field label="Référence devis"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      </div>
      <Field label="Conditions (paiement, garantie…)"><Textarea value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} /></Field>
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" disabled={busy} className="w-full">Ajouter le devis</Button>
    </form>
  );
}

function CommandeForm({ lignes, devis, busy, error, onSubmit, fournisseurNom }: {
  lignes: DALigne[]; devis: Devis[]; busy: boolean; error: string | null; onSubmit: (v: Record<string, unknown>) => void; fournisseurNom: (id: string) => string;
}) {
  const retenu = devis.find((d) => d.retenu);
  const [date, setDate] = useState(retenu?.delai_jours != null ? new Date(Date.now() + retenu.delai_jours * 864e5).toISOString().slice(0, 10) : '');
  const [prix, setPrix] = useState<Record<string, string>>(Object.fromEntries(lignes.map((l) => [l.id, l.prix_unitaire?.toString() ?? ''])));
  if (!retenu) return <p className="text-sm text-red-600">Ajoutez les devis puis cliquez « Retenir » sur le devis choisi.</p>;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit({ date_livraison_prevue: date, lignes: lignes.map((l) => ({ id: l.id, prix_unitaire: prix[l.id] })) }); }}>
      <p className="text-sm">Fournisseur retenu : <b>{fournisseurNom(retenu.fournisseur_id)}</b> · {fmtMoney(retenu.montant)}</p>
      <Field label="Date de livraison promise *"><Input type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
      <Table head={['Désignation', 'Qté', 'Prix unitaire (DH)']}>
        {lignes.map((l) => (
          <tr key={l.id}>
            <Td>{l.designation}</Td>
            <Td>{fmtNumber(l.quantite)} {l.unite}</Td>
            <Td><Input type="number" min={0} step="0.01" value={prix[l.id]} onChange={(e) => setPrix({ ...prix, [l.id]: e.target.value })} /></Td>
          </tr>
        ))}
      </Table>
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" disabled={busy} className="w-full">Émettre le BC</Button>
    </form>
  );
}

function ReceptionForm({ lignes, busy, error, onSubmit }: { lignes: DALigne[]; busy: boolean; error: string | null; onSubmit: (v: Record<string, unknown>) => void }) {
  const restant = (l: DALigne) => Math.max(0, l.quantite - l.quantite_recue);
  const [q, setQ] = useState<Record<string, string>>(Object.fromEntries(lignes.map((l) => [l.id, String(restant(l))])));
  const [bl, setBl] = useState('');
  const [facture, setFacture] = useState('');
  const [rappro, setRappro] = useState(false);
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit({ bl_numero: bl, facture_numero: facture, rapprochement_ok: rappro, lignes: lignes.map((l) => ({ id: l.id, quantite_recue: q[l.id] })) }); }}>
      <p className="text-xs text-slate-500">Contrôle quantité et qualité. Les articles du magasin entrent automatiquement en stock.</p>
      <Table head={['Désignation', 'Commandé', 'Déjà reçu', 'Reçu maintenant']}>
        {lignes.map((l) => (
          <tr key={l.id}>
            <Td>{l.designation}{l.article_id && <Badge tone="blue">Magasin</Badge>}</Td>
            <Td>{fmtNumber(l.quantite)}</Td>
            <Td>{fmtNumber(l.quantite_recue)}</Td>
            <Td><Input type="number" min={0} max={restant(l)} step="any" value={q[l.id]} onChange={(e) => setQ({ ...q, [l.id]: e.target.value })} /></Td>
          </tr>
        ))}
      </Table>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="N° bon de livraison"><Input value={bl} onChange={(e) => setBl(e.target.value)} /></Field>
        <Field label="N° facture"><Input value={facture} onChange={(e) => setFacture(e.target.value)} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rappro} onChange={(e) => setRappro(e.target.checked)} /> Rapprochement BC / BL / facture conforme</label>
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" disabled={busy} className="w-full">Valider la réception</Button>
    </form>
  );
}

/** Impression / envoi par e-mail du bon de commande. */
function BcActions({ da, fournisseur }: { da: DemandeAchat; fournisseur?: Fournisseur }) {
  const subject = encodeURIComponent(`Bon de commande ${da.bc_numero} – Valorise Maroc`);
  const body = encodeURIComponent(
    `Bonjour,\n\nVeuillez trouver ci-joint notre bon de commande ${da.bc_numero} (réf. ${da.numero}).\n`
    + `Montant : ${fmtMoney(da.montant_commande)}\nLivraison attendue le : ${fmtDate(da.date_livraison_prevue)}\n\n`
    + `Merci de confirmer la bonne réception et le délai.\n\nCordialement,\nService Achats – Valorise Maroc`,
  );
  return (
    <div className="flex gap-2 print:hidden">
      <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => window.print()}>🖨 Imprimer le BC</Button>
      {fournisseur?.email && <a href={`mailto:${fournisseur.email}?subject=${subject}&body=${body}`}><Button variant="secondary" className="px-3 py-1.5 text-xs">✉ Envoyer au fournisseur</Button></a>}
    </div>
  );
}
