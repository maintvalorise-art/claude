import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import EntityForm from '../../components/EntityForm';
import { Badge, Button, Card, ErrorBox, Info, Modal, PageHeader, Spinner, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { byId, fetchClients, fetchPeople, fetchVehicles, vehicleLabel } from '../../lib/data';
import { daysSince, fmtDate, fmtDateTime } from '../../lib/format';
import { BENNE_ETAT, BENNE_MOTIF_LABELS, BENNE_STATUT, BENNE_TYPE_LABELS, DECHET_LABELS } from '../../lib/labels';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { Benne, MouvementBenne } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';
import { BENNE_FIELDS } from './benneFields';

export default function BenneDetail() {
  const { id } = useParams();
  const { profile } = useAuth();
  const gerer = can(profile, 'bennesGerer');
  const [editing, setEditing] = useState(false);
  const { data, loading, error, reload } = useAsync(async () => {
    const [b, mv, clients, vehicles, people] = await Promise.all([
      supabase.from('bennes').select('*').eq('id', id!).single().then(must),
      supabase.from('mouvements_bennes').select('*').eq('benne_id', id!).order('date_mouvement', { ascending: false }).then(must),
      fetchClients(),
      fetchVehicles(false),
      fetchPeople(),
    ]);
    return { b: b as Benne, mv: mv as MouvementBenne[], cmap: byId(clients), vmap: byId(vehicles), names: new Map(people.map((p) => [p.id, p.full_name])) };
  }, [id]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBox>{error ?? 'Benne introuvable'}</ErrorBox>;
  const { b } = data;

  return (
    <div className="space-y-5">
      <div className="text-sm"><Link to="/bennes" className="text-sky-700 hover:underline">← Bennes</Link></div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">Benne {b.numero} <StatusBadge map={BENNE_STATUT} value={b.statut} /> <StatusBadge map={BENNE_ETAT} value={b.etat} />{!b.actif && <Badge>Inactive</Badge>}</span>}
        subtitle={`${BENNE_TYPE_LABELS[b.type]}${b.volume_m3 ? ` · ${b.volume_m3} m³` : ''}${b.dechet ? ` · ${DECHET_LABELS[b.dechet] ?? b.dechet}` : ''}`}
        actions={
          <>
            {can(profile, 'bennesMouvement') && <Link to={`/bennes/mouvement?benne=${b.id}`}><Button variant="secondary">📦 Mouvement</Button></Link>}
            {gerer && <Button onClick={() => setEditing(true)}>Modifier</Button>}
          </>
        } />
      <Card>
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <Info label="Client">{b.client_id ? data.cmap.get(b.client_id)?.nom : '—'}</Info>
          <Info label="Depuis">{fmtDateTime(b.depuis)} ({daysSince(b.depuis)} j)</Info>
          <Info label="Dernière vérification">{fmtDate(b.derniere_verification)}</Info>
          <Info label="Dernière révision">{fmtDate(b.derniere_revision)}</Info>
          <Info label="Code-barres / QR">{b.code_barres ?? b.numero}</Info>
          <Info label="Position GPS">
            {b.gps_lat != null && b.gps_lng != null
              ? <a className="text-sky-700 underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${b.gps_lat}&mlon=${b.gps_lng}#map=17/${b.gps_lat}/${b.gps_lng}`}>Voir sur la carte</a>
              : 'Traceur non installé (phase 2)'}
          </Info>
          {b.notes && <Info label="Notes">{b.notes}</Info>}
        </dl>
      </Card>
      <Card title="Historique des déplacements">
        <DataTable rows={data.mv} rowKey={(m) => m.id} exportName={`benne-${b.numero}`} columns={[
          { key: 'date', label: 'Date', value: (m) => m.date_mouvement, render: (m) => <span className="whitespace-nowrap">{fmtDateTime(m.date_mouvement)}</span> },
          { key: 'motif', label: 'Motif', value: (m) => BENNE_MOTIF_LABELS[m.motif] },
          { key: 'client', label: 'Client', value: (m) => (m.client_id ? data.cmap.get(m.client_id)?.nom ?? '' : '') },
          { key: 'trajet', label: 'Origine → destination', value: (m) => [m.origine, m.destination].filter(Boolean).join(' → ') },
          { key: 'camion', label: 'Camion', value: (m) => (m.vehicle_id ? vehicleLabel(data.vmap.get(m.vehicle_id)) : '') },
          { key: 'chauffeur', label: 'Chauffeur', value: (m) => (m.chauffeur_id ? data.names.get(m.chauffeur_id) ?? '' : '') },
          { key: 'saisi', label: 'Saisi par', value: (m) => (m.saisi_par ? data.names.get(m.saisi_par) ?? '' : '') },
          { key: 'notes', label: 'Notes', value: (m) => m.notes ?? '' },
        ]} />
      </Card>
      <Modal open={editing} onClose={() => setEditing(false)} title={`Modifier la benne ${b.numero}`} wide>
        <EntityForm fields={BENNE_FIELDS} initial={b as unknown as Record<string, unknown>} onSubmit={async (v) => {
          const { error: err } = await supabase.from('bennes').update({ ...v, gps_maj: v.gps_lat != null ? new Date().toISOString() : null }).eq('id', b.id);
          if (err) throw err;
          setEditing(false);
          void reload();
        }} />
      </Modal>
    </div>
  );
}
