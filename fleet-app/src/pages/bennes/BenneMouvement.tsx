import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import ScanInput from '../../components/ScanInput';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, StatusBadge, SuccessBox, cx } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { byId, fetchClients, fetchVehicles, vehicleLabel } from '../../lib/data';
import { daysSince } from '../../lib/format';
import { BENNE_MOTIF_AR, BENNE_MOTIF_LABELS, BENNE_STATUT } from '../../lib/labels';
import { errorMessage, supabase } from '../../lib/supabase';
import type { Benne, BenneMotif } from '../../lib/types';
import { useAsync } from '../../lib/useAsync';

const MOTIFS: BenneMotif[] = ['pose', 'enlevement', 'echange', 'vidage', 'retour_depot', 'reparation', 'verification'];

/** Saisie d'un déplacement de benne par scan (chauffeur ou exploitation). */
export default function BenneMouvement() {
  const { profile } = useAuth();
  const [params] = useSearchParams();
  const { data, loading } = useAsync(async () => {
    const [vehicles, clients, bennes] = await Promise.all([
      fetchVehicles(), fetchClients(),
      supabase.from('bennes').select('*').eq('actif', true).order('numero').then((r) => (r.data ?? []) as Benne[]),
    ]);
    return { vehicles, clients, cmap: byId(clients), bennes };
  });
  const [benne, setBenne] = useState<Benne | null>(null);
  const [motif, setMotif] = useState<BenneMotif>('pose');
  const [clientId, setClientId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [origine, setOrigine] = useState('');
  const [destination, setDestination] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    if (!vehicleId) setVehicleId(data.vehicles.find((v) => v.chauffeur_id === profile?.id)?.id ?? '');
    const id = params.get('benne');
    if (id && !benne) setBenne(data.bennes.find((b) => b.id === id) ?? null);
  }, [data, params, profile?.id, vehicleId, benne]);

  useEffect(() => {
    if (!benne || !data) return;
    // Motif proposé selon la situation actuelle de la benne.
    setMotif(benne.statut === 'chez_client' ? 'enlevement' : benne.statut === 'transit' ? 'vidage' : benne.statut === 'vidage' ? 'retour_depot' : 'pose');
    setOrigine(benne.client_id ? data.cmap.get(benne.client_id)?.nom ?? '' : BENNE_STATUT[benne.statut][0]);
    setClientId('');
    setDestination('');
  }, [benne, data]);

  function scan(code: string) {
    setError(null);
    setDone(null);
    const b = data?.bennes.find((x) => x.code_barres === code || x.numero.toLowerCase() === code.toLowerCase());
    if (!b) return setError(`Benne « ${code} » introuvable · الحاوية غير موجودة`);
    setBenne(b);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!benne) return;
    if (['pose', 'echange'].includes(motif) && !clientId) return setError('Choisissez le client · اختر الزبون');
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.from('mouvements_bennes').insert({
        benne_id: benne.id, motif, client_id: ['pose', 'echange', 'verification'].includes(motif) ? clientId || benne.client_id : benne.client_id,
        vehicle_id: vehicleId || null, chauffeur_id: profile!.role === 'chauffeur' ? profile!.id : null,
        origine: origine || null, destination: destination || (clientId ? data!.cmap.get(clientId)?.nom : null) || null, notes: notes || null, saisi_par: profile!.id,
      });
      if (err) throw err;
      setDone(`Benne ${benne.numero} : ${BENNE_MOTIF_LABELS[motif]}`);
      setBenne(null);
      setNotes('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !data) return <Spinner />;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title={<>Mouvement de benne <span className="ar block text-lg text-slate-500">حركة الحاوية</span></>} subtitle="Scannez le QR code de la benne · امسح رمز الحاوية" />
      <Card><ScanInput onScan={scan} placeholder="N° ou QR de la benne…" /></Card>
      <SuccessBox>{done && `✓ ${done}`}</SuccessBox>
      <ErrorBox>{error}</ErrorBox>
      {benne && (
        <form onSubmit={submit} className="space-y-4">
          <Card title={<span className="flex items-center gap-2">Benne {benne.numero} <StatusBadge map={BENNE_STATUT} value={benne.statut} /></span>}>
            <p className="mb-3 text-sm text-slate-600">
              {benne.client_id ? <>Chez <b>{data.cmap.get(benne.client_id)?.nom}</b> depuis {daysSince(benne.depuis)} j</> : <>Depuis {daysSince(benne.depuis)} j</>}
              {benne.etat !== 'bon' && <> · <Badge tone="orange">{benne.etat === 'a_reparer' ? 'À réparer' : 'Hors service'}</Badge></>}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {MOTIFS.map((m) => (
                <button key={m} type="button" onClick={() => setMotif(m)} className={cx('rounded-lg border px-2 py-2 text-xs font-medium', motif === m ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300')}>
                  {BENNE_MOTIF_LABELS[m]}<span className="ar block opacity-75">{BENNE_MOTIF_AR[m]}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card>
            <div className="space-y-4">
              {['pose', 'echange', 'verification'].includes(motif) && (
                <Field label={<>Client {motif !== 'verification' && '*'} <span className="ar text-slate-500">· الزبون</span></>}>
                  <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                    <option value="">—</option>
                    {data.clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </Select>
                </Field>
              )}
              <Field label={<>Camion <span className="ar text-slate-500">· الشاحنة</span></>}>
                <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                  <option value="">—</option>
                  {data.vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Origine · من"><Input value={origine} onChange={(e) => setOrigine(e.target.value)} /></Field>
                <Field label="Destination · إلى"><Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder={motif === 'vidage' ? 'Décharge, centre de tri…' : ''} /></Field>
              </div>
              <Field label="Remarque · ملاحظة"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </div>
          </Card>
          <Button type="submit" disabled={busy} className="w-full py-3">{busy ? '…' : 'Enregistrer · تسجيل'}</Button>
        </form>
      )}
    </div>
  );
}
