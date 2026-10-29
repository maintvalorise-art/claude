import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ScanInput from '../../components/ScanInput';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Select, StatusBadge, SuccessBox, cx } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fetchVehicles, vehicleLabel } from '../../lib/data';
import { fmtNumber } from '../../lib/format';
import { CRITICITE, MOUVEMENT_MOTIF } from '../../lib/labels';
import { errorMessage, supabase } from '../../lib/supabase';
import type { Article, Intervention, MouvementType } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';

const MOTIFS: Record<'entree' | 'sortie', string[]> = {
  sortie: ['reparation', 'preventif', 'consommation', 'autre'],
  entree: ['retour', 'stock_initial', 'reception', 'autre'],
};

/** Entrées / sorties magasin par scan du code-barres. */
export default function MouvementForm() {
  const { profile } = useAuth();
  const [params] = useSearchParams();
  const { data: vehicles } = useAsync(() => fetchVehicles());
  const [article, setArticle] = useState<Article | null>(null);
  const [type, setType] = useState<Exclude<MouvementType, 'ajustement'>>('sortie');
  const [quantite, setQuantite] = useState('1');
  const [vehicleId, setVehicleId] = useState('');
  const [equipement, setEquipement] = useState('');
  const [demandeur, setDemandeur] = useState('');
  const [motif, setMotif] = useState('reparation');
  const [interventionId, setInterventionId] = useState('');
  const [prix, setPrix] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function lookup(code: string) {
    setError(null);
    const v = `"${code.replace(/["\\]/g, '')}"`;
    const { data } = await supabase.from('articles').select('*').or(`code_barres.eq.${v},code.eq.${v}`).limit(1);
    const a = (data?.[0] as Article | undefined) ?? null;
    if (!a) setError(`Aucun article pour le code « ${code} »`);
    setArticle(a);
    setQuantite('1');
    setPrix(a?.prix_unitaire?.toString() ?? '');
    if (a?.vehicle_id) setVehicleId(a.vehicle_id);
  }

  useEffect(() => {
    const code = params.get('code');
    if (code) void lookup(code);
  }, [params]);

  useEffect(() => {
    setMotif(MOTIFS[type][0]);
  }, [type]);

  useEffect(() => {
    if (!vehicleId) return setInterventions([]);
    supabase.from('interventions').select('*').eq('vehicle_id', vehicleId).in('statut', ['nouvelle', 'en_cours']).then(({ data }) => setInterventions((data ?? []) as Intervention[]));
  }, [vehicleId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!article) return;
    setBusy(true);
    setError(null);
    try {
      const q = Number(quantite);
      const { error: err } = await supabase.from('mouvements_stock').insert({
        article_id: article.id, type, quantite: q, motif, auteur_id: profile!.id,
        vehicle_id: type === 'sortie' ? vehicleId || null : null,
        equipement: type === 'sortie' ? equipement || null : null,
        demandeur: demandeur || null,
        intervention_id: interventionId || null,
        prix_unitaire: type === 'entree' && prix ? Number(prix) : null,
        commentaire: commentaire || null,
      });
      if (err) throw err;
      setDone((d) => [`${type === 'sortie' ? '−' : '+'}${q} ${article.unite} · ${article.code} ${article.designation}`, ...d].slice(0, 10));
      setArticle(null);
      setCommentaire('');
      setInterventionId('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Entrée / sortie magasin" subtitle="Scannez le code-barres de la pièce (douchette ou caméra). Aucune sortie sans scan." />
      <Card>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {(['sortie', 'entree'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setType(t)} className={cx('rounded-lg border py-3 text-sm font-bold', type === t ? (t === 'sortie' ? 'border-orange-600 bg-orange-600 text-white' : 'border-emerald-600 bg-emerald-600 text-white') : 'border-slate-300')}>
              {t === 'sortie' ? '⬆ Sortie' : '⬇ Entrée (hors commande)'}
            </button>
          ))}
        </div>
        <ScanInput onScan={lookup} />
        {type === 'entree' && <p className="mt-2 text-xs text-slate-500">Pour une livraison fournisseur avec plusieurs articles, utilisez le <Link className="underline" to="/magasin/bon/reception">bon de réception</Link> (numéroté, imprimable A5).</p>}
      </Card>
      <ErrorBox>{error}</ErrorBox>
      {article && (
        <Card title={<span className="flex items-center gap-2">{article.code} <StatusBadge map={CRITICITE} value={article.criticite} /></span>}>
          <div className="mb-4 flex flex-wrap justify-between gap-2 text-sm">
            <span className="font-medium">{article.designation}</span>
            <span>Stock : <b className={article.stock_actuel < article.stock_min ? 'text-red-600' : ''}>{fmtNumber(article.stock_actuel)} {article.unite}</b> {article.emplacement && <>· 📍 {article.emplacement}</>}</span>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Quantité *"><Input type="number" min={0.01} step="any" max={type === 'sortie' ? article.stock_actuel : undefined} value={quantite} onChange={(e) => setQuantite(e.target.value)} required autoFocus /></Field>
              <Field label="Motif *">
                <Select value={motif} onChange={(e) => setMotif(e.target.value)}>
                  {MOTIFS[type].map((m) => <option key={m} value={m}>{MOUVEMENT_MOTIF[m]}</option>)}
                </Select>
              </Field>
              {type === 'sortie' ? (
                <>
                  <Field label="Véhicule / engin">
                    <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                      <option value="">—</option>
                      {vehicles?.map((v) => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
                    </Select>
                  </Field>
                  <Field label="Ou machine"><Input value={equipement} onChange={(e) => setEquipement(e.target.value)} /></Field>
                  <Field label="Demandeur *"><Input value={demandeur} onChange={(e) => setDemandeur(e.target.value)} required placeholder="Nom du mécanicien / demandeur" /></Field>
                  {interventions.length > 0 && (
                    <Field label="Intervention liée" hint="Le coût de la pièce est imputé au véhicule">
                      <Select value={interventionId} onChange={(e) => setInterventionId(e.target.value)}>
                        <option value="">—</option>
                        {interventions.map((i) => <option key={i.id} value={i.id}>N° {i.numero} · {i.titre}</option>)}
                      </Select>
                    </Field>
                  )}
                </>
              ) : (
                <Field label="Prix unitaire (DH)"><Input type="number" min={0} step="0.01" value={prix} onChange={(e) => setPrix(e.target.value)} /></Field>
              )}
              <Field label="Commentaire" className="sm:col-span-2"><Input value={commentaire} onChange={(e) => setCommentaire(e.target.value)} /></Field>
            </div>
            <Button type="submit" disabled={busy} className="w-full py-3">{busy ? '…' : type === 'sortie' ? 'Valider la sortie' : "Valider l'entrée"}</Button>
          </form>
        </Card>
      )}
      {done.length > 0 && (
        <Card title="Mouvements de la session">
          <SuccessBox>Enregistré. Scannez l'article suivant.</SuccessBox>
          <ul className="mt-2 space-y-1 text-sm">{done.map((d, i) => <li key={i}><Badge tone="green">✓</Badge> {d}</li>)}</ul>
          <Link to="/magasin/mouvements" className="mt-2 inline-block text-sm text-sky-700 underline">Historique complet</Link>
        </Card>
      )}
    </div>
  );
}
