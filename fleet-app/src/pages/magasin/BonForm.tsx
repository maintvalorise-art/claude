import { useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import EmplacementPicker from '../../components/EmplacementPicker';
import ScanInput from '../../components/ScanInput';
import { Button, Card, Empty, ErrorBox, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from '../../components/ui';
import { fetchArticles, fetchVehicles, vehicleLabel } from '../../lib/data';
import { fmtMoney, fmtNumber, todayIso } from '../../lib/format';
import { MOUVEMENT_MOTIF } from '../../lib/labels';
import { libelleEmplacement } from '../../lib/stock';
import { errorMessage, supabase } from '../../lib/supabase';
import type { Article, BonType } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';

interface Ligne { article: Article; quantite: string; prix: string; emplacement: string }

const MOTIFS_SORTIE = ['reparation', 'preventif', 'consommation', 'autre'];

/** Saisie d'un bon de réception (entrée) ou de livraison (sortie), avec plusieurs articles. */
export default function BonForm() {
  const { type } = useParams<{ type: BonType }>();
  const navigate = useNavigate();
  const reception = type === 'reception';
  const { data, loading, error: loadError } = useAsync(async () => {
    const [articles, vehicles] = await Promise.all([fetchArticles(true), fetchVehicles(true)]);
    return { articles, vehicles };
  });
  const [date, setDate] = useState(todayIso());
  const [tiers, setTiers] = useState('');
  const [refTiers, setRefTiers] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [demandeur, setDemandeur] = useState('');
  const [motif, setMotif] = useState('reparation');
  const [commentaire, setCommentaire] = useState('');
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [recherche, setRecherche] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trouves = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q || !data) return [];
    return data.articles.filter((a) => `${a.code} ${a.code_barres ?? ''} ${a.designation} ${a.ref_fabricant ?? ''}`.toLowerCase().includes(q)).slice(0, 8);
  }, [recherche, data]);

  if (type !== 'reception' && type !== 'livraison') return <Navigate to="/magasin" replace />;
  if (loading) return <Spinner />;
  if (loadError || !data) return <ErrorBox>{loadError}</ErrorBox>;

  function ajouter(a: Article) {
    setError(null);
    setRecherche('');
    setLignes((ls) => {
      const i = ls.findIndex((l) => l.article.id === a.id);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, quantite: String(Number(l.quantite || 0) + 1) } : l));
      return [...ls, { article: a, quantite: '1', prix: a.prix_unitaire?.toString() ?? '', emplacement: a.emplacement ?? '' }];
    });
  }

  function scan(code: string) {
    const c = code.trim().toLowerCase();
    const a = data!.articles.find((x) => x.code.toLowerCase() === c || (x.code_barres ?? '').toLowerCase() === c);
    if (a) ajouter(a);
    else setError(`Aucun article pour le code « ${code} »`);
  }

  const maj = (i: number, patch: Partial<Ligne>) => setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lignes.reduce((s, l) => s + Number(l.quantite || 0) * Number(l.prix || 0), 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!lignes.length) return setError('Ajoutez au moins un article.');
    const trop = !reception && lignes.find((l) => Number(l.quantite) > l.article.stock_actuel);
    if (trop) return setError(`Stock insuffisant pour ${trop.article.code} : ${fmtNumber(trop.article.stock_actuel)} ${trop.article.unite} disponible(s).`);
    setBusy(true);
    setError(null);
    try {
      const { data: id, error: err } = await supabase.rpc('creer_bon_stock', {
        p_type: type,
        p_entete: { date_bon: date, tiers, reference_tiers: refTiers, vehicle_id: vehicleId, demandeur, motif, commentaire },
        p_lignes: lignes.map((l) => ({
          article_id: l.article.id,
          quantite: Number(l.quantite),
          prix_unitaire: reception && l.prix ? Number(l.prix) : null,
          emplacement: reception ? l.emplacement : null,
        })),
      });
      if (err) throw err;
      navigate(`/magasin/bons/${id as string}?imprimer=1`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-sm"><Link to="/magasin/bons" className="text-sky-700 hover:underline">← Bons</Link></div>
      <PageHeader
        title={reception ? '⬇ Bon de réception' : '⬆ Bon de livraison (sortie)'}
        subtitle={reception
          ? 'Entrée en stock : scannez ou cherchez chaque article, indiquez la quantité et la case où il est rangé.'
          : 'Sortie de stock : scannez ou cherchez chaque article et indiquez la quantité remise.'}
      />
      <form onSubmit={submit} className="space-y-4">
        <Card title="En-tête du bon">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Date *"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
            {reception ? (
              <>
                <Field label="Fournisseur *"><Input value={tiers} onChange={(e) => setTiers(e.target.value)} required placeholder="Nom du fournisseur" /></Field>
                <Field label="N° BL / facture fournisseur"><Input value={refTiers} onChange={(e) => setRefTiers(e.target.value)} /></Field>
                <Field label="Réceptionné par"><Input value={demandeur} onChange={(e) => setDemandeur(e.target.value)} placeholder="Nom" /></Field>
              </>
            ) : (
              <>
                <Field label="Véhicule / engin">
                  <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                    <option value="">—</option>
                    {data.vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
                  </Select>
                </Field>
                <Field label="Destinataire / atelier"><Input value={tiers} onChange={(e) => setTiers(e.target.value)} placeholder="Atelier, machine, service…" /></Field>
                <Field label="Demandeur (reçu par) *"><Input value={demandeur} onChange={(e) => setDemandeur(e.target.value)} required placeholder="Nom du mécanicien / demandeur" /></Field>
                <Field label="Motif *">
                  <Select value={motif} onChange={(e) => setMotif(e.target.value)}>
                    {MOTIFS_SORTIE.map((m) => <option key={m} value={m}>{MOUVEMENT_MOTIF[m]}</option>)}
                  </Select>
                </Field>
              </>
            )}
            <Field label="Observation" className="sm:col-span-2 lg:col-span-3"><Textarea rows={2} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} /></Field>
          </div>
        </Card>

        <Card title={`Articles (${lignes.length})`}>
          <div className="grid gap-3 lg:grid-cols-2">
            <ScanInput onScan={scan} autoFocus={false} placeholder="Scanner le code-barres…" />
            <div className="relative">
              <Input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="🔎 Chercher : code, désignation, référence…" />
              {trouves.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {trouves.map((a) => (
                    <li key={a.id}>
                      <button type="button" onClick={() => ajouter(a)} className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                        <span><b>{a.code}</b> · {a.designation}</span>
                        <span className="whitespace-nowrap text-xs text-slate-500">{fmtNumber(a.stock_actuel)} {a.unite}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <ErrorBox>{error}</ErrorBox>
          {lignes.length === 0 ? <div className="mt-3"><Empty>Aucun article. Scannez ou cherchez un article pour l'ajouter.</Empty></div> : (
            <div className="mt-3 space-y-2">
              {lignes.map((l, i) => {
                const depasse = !reception && Number(l.quantite) > l.article.stock_actuel;
                return (
                  <div key={l.article.id} className="grid items-end gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-12">
                    <div className={reception ? 'sm:col-span-12 lg:col-span-4' : 'sm:col-span-5'}>
                      <div className="text-sm font-semibold">{l.article.code} · {l.article.designation}</div>
                      <div className="text-xs text-slate-500">Stock : {fmtNumber(l.article.stock_actuel)} {l.article.unite}{l.article.emplacement && <> · 📍 {libelleEmplacement(l.article.emplacement)}</>}</div>
                    </div>
                    <Field label={`Qté (${l.article.unite})`} className={reception ? 'sm:col-span-3 lg:col-span-2' : 'sm:col-span-3'}>
                      <Input type="number" min={0.01} step="any" value={l.quantite} onChange={(e) => maj(i, { quantite: e.target.value })} required className={cx(depasse && 'border-red-500')} />
                    </Field>
                    {reception && (
                      <>
                        <Field label="PU (DH)" className="sm:col-span-3 lg:col-span-2"><Input type="number" min={0} step="0.01" value={l.prix} onChange={(e) => maj(i, { prix: e.target.value })} /></Field>
                        <Field label="Rangé en (rack · étage · case)" className="sm:col-span-5 lg:col-span-3"><EmplacementPicker compact value={l.emplacement} onChange={(v) => maj(i, { emplacement: v })} /></Field>
                      </>
                    )}
                    <div className={cx('flex justify-end', reception ? 'sm:col-span-1' : 'sm:col-span-4')}>
                      <Button type="button" variant="secondary" onClick={() => setLignes((ls) => ls.filter((_, j) => j !== i))}>✕</Button>
                    </div>
                    {depasse && <p className="text-xs text-red-600 sm:col-span-12">Quantité supérieure au stock disponible.</p>}
                  </div>
                );
              })}
              {reception && total > 0 && <p className="text-right text-sm">Total : <b>{fmtMoney(total)}</b></p>}
            </div>
          )}
        </Card>
        <Button type="submit" disabled={busy || !lignes.length} className="w-full py-3">
          {busy ? '…' : reception ? 'Valider la réception et imprimer le bon' : 'Valider la sortie et imprimer le bon'}
        </Button>
      </form>
    </div>
  );
}
