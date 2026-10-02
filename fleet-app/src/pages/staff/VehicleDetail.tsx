import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import DocumentsPanel from '../../components/DocumentsPanel';
import VehicleForm from '../../components/VehicleForm';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Spinner, StatusBadge, Table, Td, Textarea } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '../../lib/format';
import { INTERVENTION_STATUS, INTERVENTION_TYPE_LABELS, VEHICLE_STATUS, VEHICLE_TYPE_LABELS } from '../../lib/labels';
import { fetchProfiles } from '../../lib/staff';
import { errorMessage, supabase } from '../../lib/supabase';
import type { ControlSheet, Intervention, Vehicle } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

export default function VehicleDetail() {
  const { id } = useParams();
  const [editing, setEditing] = useState(false);
  const [vidange, setVidange] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const [vehicle, profiles, interventions, sheets] = await Promise.all([
      supabase.from('vehicles').select('*').eq('id', id!).single().then(must),
      fetchProfiles(),
      supabase.from('interventions').select('*').eq('vehicle_id', id!).order('created_at', { ascending: false }).limit(30).then(must),
      supabase.from('control_sheets').select('*').eq('vehicle_id', id!).order('created_at', { ascending: false }).limit(30).then(must),
    ]);
    return {
      vehicle: vehicle as Vehicle,
      profiles,
      names: new Map(profiles.map((p) => [p.id, p.full_name])),
      interventions: interventions as Intervention[],
      sheets: sheets as ControlSheet[],
    };
  }, [id]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBox>{error ?? 'Véhicule introuvable'}</ErrorBox>;
  const { vehicle: v, names } = data;
  const u = v.unite_compteur;
  const reste = v.prochaine_vidange != null ? v.prochaine_vidange - v.compteur_actuel : null;
  const totalCout = data.interventions.reduce((s, i) => s + (i.cout ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="text-sm"><Link to="/vehicules" className="text-sky-700 hover:underline">← Parc</Link></div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{v.matricule} <StatusBadge map={VEHICLE_STATUS} value={v.statut} />{!v.actif && <Badge>Inactif</Badge>}</span>}
        subtitle={`${VEHICLE_TYPE_LABELS[v.type]} · ${[v.marque, v.modele, v.annee].filter(Boolean).join(' ') || '—'}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setVidange(true)}>🛢 Vidange effectuée</Button>
            <Button onClick={() => setEditing(true)}>Modifier</Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Compteur" value={`${fmtNumber(v.compteur_actuel)} ${u}`} />
        <Stat
          label="Prochaine vidange"
          value={v.prochaine_vidange ? `${fmtNumber(v.prochaine_vidange)} ${u}` : 'Non définie'}
          hint={reste == null ? undefined : reste <= 0 ? `Dépassée de ${fmtNumber(-reste)} ${u}` : `Dans ${fmtNumber(reste)} ${u}`}
          danger={reste != null && reste <= v.alerte_vidange}
        />
        <Stat label="Chauffeur attitré" value={v.chauffeur_id ? names.get(v.chauffeur_id) ?? '—' : '—'} />
        <Stat label="Coût interventions (30 dern.)" value={fmtMoney(totalCout)} />
      </div>
      {v.notes && <Card><p className="whitespace-pre-line text-sm">{v.notes}</p></Card>}

      <DocumentsPanel owner={{ vehicle_id: v.id }} title="Papiers : visite technique, assurance, tachygraphe…" />

      <Card title="Interventions">
        {data.interventions.length === 0 ? <Empty>Aucune intervention.</Empty> : (
          <Table head={['N°', 'Date', 'Type', 'Objet', 'Demandeur', 'Statut', 'Coût']}>
            {data.interventions.map((i) => (
              <tr key={i.id}>
                <Td>{i.numero}</Td>
                <Td className="whitespace-nowrap">{fmtDateTime(i.created_at)}</Td>
                <Td>{INTERVENTION_TYPE_LABELS[i.type]}</Td>
                <Td>
                  <Link to={`/interventions?id=${i.id}`} className="text-sky-700 hover:underline">{i.titre}</Link>
                </Td>
                <Td>{i.demandeur_id ? names.get(i.demandeur_id) : '—'}</Td>
                <Td><StatusBadge map={INTERVENTION_STATUS} value={i.statut} /></Td>
                <Td className="whitespace-nowrap">{fmtMoney(i.cout)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Fiches de contrôle">
        {data.sheets.length === 0 ? <Empty>Aucune fiche.</Empty> : (
          <Table head={['Date', 'Chauffeur', 'Compteur', 'Résultat', '']}>
            {data.sheets.map((s) => (
              <tr key={s.id}>
                <Td>{fmtDate(s.date_controle)}</Td>
                <Td>{names.get(s.chauffeur_id)}</Td>
                <Td>{fmtNumber(s.compteur_depart)}</Td>
                <Td>{s.nb_nok ? <Badge tone="red">{s.nb_nok} NOK</Badge> : <Badge tone="green">OK</Badge>}</Td>
                <Td><Link to={`/fiches/${s.id}`} className="text-sky-700 underline">Voir</Link></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={editing} onClose={() => setEditing(false)} title={`Modifier ${v.matricule}`} wide>
        <VehicleForm vehicle={v} drivers={data.profiles.filter((p) => p.active)} onDone={() => { setEditing(false); void reload(); }} />
      </Modal>
      <Modal open={vidange} onClose={() => setVidange(false)} title="Enregistrer une vidange">
        <VidangeForm vehicle={v} onDone={() => { setVidange(false); void reload(); }} />
      </Modal>
    </div>
  );
}

function Stat({ label, value, hint, danger }: { label: string; value: string; hint?: string; danger?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${danger ? 'border-red-300' : 'border-slate-200'}`}>
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
      {hint && <div className={`text-xs ${danger ? 'font-semibold text-red-600' : 'text-slate-500'}`}>{hint}</div>}
    </div>
  );
}

/** Vidange : met à jour le compteur et la prochaine échéance, et l'historise comme intervention terminée. */
function VidangeForm({ vehicle, onDone }: { vehicle: Vehicle; onDone: () => void }) {
  const { profile } = useAuth();
  const defaultInterval = vehicle.unite_compteur === 'heures' ? 250 : 10000;
  const [compteur, setCompteur] = useState(String(vehicle.compteur_actuel));
  const [intervalle, setIntervalle] = useState(String(defaultInterval));
  const [cout, setCout] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const u = vehicle.unite_compteur;
  const prochaine = Number(compteur) + Number(intervalle);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const km = Number(compteur);
      const up = await supabase
        .from('vehicles')
        .update({ compteur_actuel: Math.max(km, vehicle.compteur_actuel), prochaine_vidange: prochaine })
        .eq('id', vehicle.id);
      if (up.error) throw up.error;
      const ins = await supabase.from('interventions').insert({
        vehicle_id: vehicle.id,
        demandeur_id: profile!.id,
        type: 'vidange',
        statut: 'terminee',
        titre: `Vidange à ${km.toLocaleString('fr-FR')} ${u}`,
        description: notes.trim() || null,
        compteur: km,
        cout: cout ? Number(cout) : null,
        reponse: `Prochaine vidange : ${prochaine.toLocaleString('fr-FR')} ${u}`,
      });
      if (ins.error) throw ins.error;
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Compteur à la vidange (${u})`}><Input type="number" min={0} value={compteur} onChange={(e) => setCompteur(e.target.value)} required /></Field>
        <Field label={`Intervalle (${u})`}><Input type="number" min={1} value={intervalle} onChange={(e) => setIntervalle(e.target.value)} required /></Field>
        <Field label="Coût (DH)"><Input type="number" min={0} step="0.01" value={cout} onChange={(e) => setCout(e.target.value)} /></Field>
        <div className="self-end pb-2 text-sm">Prochaine vidange : <b>{Number.isFinite(prochaine) ? prochaine.toLocaleString('fr-FR') : '—'} {u}</b></div>
      </div>
      <Field label="Notes (huile, filtres…)"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" disabled={busy} className="w-full">{busy ? 'Enregistrement…' : 'Enregistrer la vidange'}</Button>
    </form>
  );
}
