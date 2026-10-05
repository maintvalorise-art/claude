import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Textarea } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fetchArticles, fetchVehicles, vehicleLabel } from '../../lib/data';
import { todayIso } from '../../lib/format';
import { URGENCE, options } from '../../lib/labels';
import { canRequestPurchase } from '../../lib/roles';
import { errorMessage, supabase } from '../../lib/supabase';
import type { Urgence } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';

interface Ligne { article_id: string; designation: string; reference: string; quantite: string; unite: string }
const vide = (): Ligne => ({ article_id: '', designation: '', reference: '', quantite: '1', unite: 'pce' });

export default function DemandeNew() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { data, loading } = useAsync(async () => {
    const [vehicles, articles] = await Promise.all([fetchVehicles(), fetchArticles()]);
    return { vehicles, articles };
  });
  const [service, setService] = useState(profile?.service ?? '');
  const [vehicleId, setVehicleId] = useState('');
  const [equipement, setEquipement] = useState('');
  const [motif, setMotif] = useState('');
  const [urgence, setUrgence] = useState<Urgence>('normal');
  const [dateSouhaitee, setDateSouhaitee] = useState('');
  const [montant, setMontant] = useState('');
  const [lignes, setLignes] = useState<Ligne[]>([vide()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canRequestPurchase(profile)) {
    return (
      <Card>
        <p className="text-sm">
          Vous ne faites pas partie de la <b>liste des demandeurs autorisés</b>. Les demandes orales, WhatsApp ou depuis un email
          personnel ne sont pas traitées : contactez l'administrateur pour être ajouté à la liste.
        </p>
      </Card>
    );
  }
  if (loading || !data) return <Spinner />;

  const setLigne = (i: number, patch: Partial<Ligne>) => setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function pickArticle(i: number, id: string) {
    const a = data!.articles.find((x) => x.id === id);
    setLigne(i, a ? { article_id: a.id, designation: a.designation, reference: a.ref_fabricant ?? a.code, unite: a.unite } : { article_id: '' });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data: id, error: err } = await supabase.rpc('creer_demande_achat', {
        p: {
          service, vehicle_id: vehicleId, equipement, motif, urgence, date_souhaitee: dateSouhaitee, montant_estime: montant,
          lignes: lignes.filter((l) => l.designation.trim()).map((l) => ({ ...l, quantite: Number(l.quantite) })),
        },
      });
      if (err) throw err;
      navigate(`/achats/${id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Nouvelle demande d'achat" subtitle="Un numéro DA-AAAA-NNNN est attribué à l'enregistrement et un accusé est visible dans « Mes demandes »." />
      <Card title="Informations">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Demandeur"><Input value={profile?.full_name ?? ''} disabled /></Field>
          <Field label="Service"><Input value={service} onChange={(e) => setService(e.target.value)} placeholder="Production, déchets, administration…" /></Field>
          <Field label="Véhicule / engin concerné">
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">—</option>
              {data.vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleLabel(v)} {v.marque ?? ''}</option>)}
            </Select>
          </Field>
          <Field label="Ou machine / équipement"><Input value={equipement} onChange={(e) => setEquipement(e.target.value)} placeholder="Clouteuse ligne 1, chariot 03…" /></Field>
          <Field label="Degré d'urgence *">
            <Select value={urgence} onChange={(e) => setUrgence(e.target.value as Urgence)}>
              {options(URGENCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Date souhaitée"><Input type="date" min={todayIso()} value={dateSouhaitee} onChange={(e) => setDateSouhaitee(e.target.value)} /></Field>
          <Field label="Montant estimé (DH)" hint="Facultatif : aide l'acheteur et le circuit de validation"><Input type="number" min={0} step="0.01" value={montant} onChange={(e) => setMontant(e.target.value)} /></Field>
          <Field label="Motif *" className="sm:col-span-2"><Textarea value={motif} onChange={(e) => setMotif(e.target.value)} required /></Field>
        </div>
      </Card>

      <Card title="Articles demandés" actions={<Button variant="secondary" onClick={() => setLignes((l) => [...l, vide()])}>+ Ligne</Button>}>
        <div className="space-y-3">
          {lignes.map((l, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-12">
              <Select className="sm:col-span-4" value={l.article_id} onChange={(e) => pickArticle(i, e.target.value)}>
                <option value="">Article hors magasin (saisie libre)</option>
                {data.articles.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.designation} (stock {a.stock_actuel})</option>)}
              </Select>
              <Input className="sm:col-span-3" placeholder="Désignation *" value={l.designation} onChange={(e) => setLigne(i, { designation: e.target.value })} required={i === 0} />
              <Input className="sm:col-span-2" placeholder="Référence / code" value={l.reference} onChange={(e) => setLigne(i, { reference: e.target.value })} />
              <Input className="sm:col-span-1" type="number" min={0.01} step="any" placeholder="Qté" value={l.quantite} onChange={(e) => setLigne(i, { quantite: e.target.value })} required />
              <Input className="sm:col-span-1" placeholder="Unité" value={l.unite} onChange={(e) => setLigne(i, { unite: e.target.value })} />
              <Button variant="ghost" className="sm:col-span-1" onClick={() => setLignes((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))}>✕</Button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Pour une pièce de rechange, choisissez l'article du magasin : il sera vérifié en stock avant tout achat.</p>
      </Card>

      <ErrorBox>{error}</ErrorBox>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy} className="px-6 py-3">{busy ? 'Envoi…' : 'Envoyer la demande'}</Button>
      </div>
    </form>
  );
}
