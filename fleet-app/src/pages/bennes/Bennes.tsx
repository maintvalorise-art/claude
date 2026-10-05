import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import EntityForm from '../../components/EntityForm';
import { Badge, Button, Card, ErrorBox, Modal, PageHeader, Select, Spinner, StatCard, StatusBadge, Table, Td } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { byId, fetchClients } from '../../lib/data';
import { daysSince, fmtDate, fmtNumber } from '../../lib/format';
import { BENNE_ETAT, BENNE_STATUT, BENNE_TYPE_LABELS, DECHET_LABELS, options } from '../../lib/labels';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { Benne, BenneStatut, Parametre } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';
import { BENNE_FIELDS } from './benneFields';

export default function Bennes() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const gerer = can(profile, 'bennesGerer');
  const [adding, setAdding] = useState(false);
  const [statut, setStatut] = useState<BenneStatut | ''>('');
  const [clientId, setClientId] = useState('');

  const { data, loading, error } = useAsync(async () => {
    const [bennes, clients, rot, params] = await Promise.all([
      supabase.from('bennes').select('*').order('numero').then(must),
      fetchClients(),
      supabase.from('mouvements_bennes').select('benne_id').in('motif', ['pose', 'echange']).gte('date_mouvement', new Date(Date.now() - 30 * 864e5).toISOString()).then(must),
      supabase.from('parametres').select('*').eq('cle', 'benne_immobile_jours').then(must),
    ]);
    return {
      bennes: bennes as Benne[], clients, cmap: byId(clients), rotations: (rot as unknown[]).length,
      seuil: Number((params as Parametre[])[0]?.valeur ?? 30),
    };
  });

  const actives = (data?.bennes ?? []).filter((b) => b.actif);
  const list = useMemo(() => actives.filter((b) => (!statut || b.statut === statut) && (!clientId || b.client_id === clientId)), [actives, statut, clientId]);
  const parClient = useMemo(() => {
    const m = new Map<string, Benne[]>();
    actives.filter((b) => b.statut === 'chez_client' && b.client_id).forEach((b) => m.set(b.client_id!, [...(m.get(b.client_id!) ?? []), b]));
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [actives]);

  const chez = actives.filter((b) => b.statut === 'chez_client');
  const dispo = actives.filter((b) => b.statut === 'depot' && b.etat === 'bon').length;
  const immobiles = chez.filter((b) => (daysSince(b.depuis) ?? 0) > (data?.seuil ?? 30)).length;
  const nonVerif = actives.filter((b) => (daysSince(b.derniere_verification ?? b.depuis) ?? 0) > 30).length;

  return (
    <div className="space-y-5">
      <PageHeader title="Parc de bennes" subtitle="Phase 1 : traçage manuel par scan · Phase 2 : GPS"
        actions={
          <>
            {can(profile, 'bennesMouvement') && <Button variant="secondary" onClick={() => navigate('/bennes/mouvement')}>📦 Mouvement</Button>}
            {gerer && <Button onClick={() => setAdding(true)}>+ Nouvelle benne</Button>}
          </>
        } />
      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button type="button" className="text-left" onClick={() => setStatut('chez_client')}><StatCard label="Chez les clients" value={`${chez.length} / ${actives.length}`} tone="blue" /></button>
          <button type="button" className="text-left" onClick={() => setStatut('depot')}><StatCard label="Disponibles au dépôt" value={dispo} tone="green" /></button>
          <StatCard label="Rotations (30 j)" value={data.rotations} hint={actives.length ? `${fmtNumber(data.rotations / actives.length, 2)} par benne` : undefined} />
          <StatCard label={`Immobiles > ${data.seuil} j`} value={immobiles} tone={immobiles ? 'red' : 'green'} hint={`${nonVerif} non vérifiée(s) depuis 30 j`} />
        </div>
      )}
      {parClient.length > 0 && (
        <Card title="Bennes par client">
          <Table head={['Client', 'Bennes', 'Plus ancienne pose']}>
            {parClient.map(([cid, bs]) => {
              const max = Math.max(...bs.map((b) => daysSince(b.depuis) ?? 0));
              return (
                <tr key={cid} className="cursor-pointer hover:bg-slate-50" onClick={() => { setClientId(cid); setStatut('chez_client'); }}>
                  <Td className="font-medium">{data!.cmap.get(cid)?.nom}{data!.cmap.get(cid)?.strategique && <> <Badge tone="violet">Stratégique</Badge></>}</Td>
                  <Td>{bs.map((b) => b.numero).join(', ')}</Td>
                  <Td><span className={max > (data!.seuil) ? 'font-semibold text-red-600' : ''}>{max} j</span></Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}
      <Card>
        {loading ? <Spinner /> : error || !data ? <ErrorBox>{error}</ErrorBox> : (
          <DataTable rows={list} rowKey={(b) => b.id} onRowClick={(b) => navigate(`/bennes/${b.id}`)} exportName="bennes"
            toolbar={
              <>
                <Select className="w-40" value={statut} onChange={(e) => setStatut(e.target.value as BenneStatut | '')}>
                  <option value="">Tous statuts</option>
                  {options(BENNE_STATUT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <Select className="w-48" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">Tous clients</option>
                  {data.clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </Select>
              </>
            }
            columns={[
              { key: 'numero', label: 'N°', render: (b) => <span className="font-semibold text-sky-700">{b.numero}</span> },
              { key: 'type', label: 'Type', value: (b) => `${BENNE_TYPE_LABELS[b.type]}${b.volume_m3 ? ` ${b.volume_m3} m³` : ''}` },
              { key: 'dechet', label: 'Déchet', value: (b) => (b.dechet ? DECHET_LABELS[b.dechet] ?? b.dechet : '') },
              { key: 'statut', label: 'Statut', value: (b) => BENNE_STATUT[b.statut][0], render: (b) => <StatusBadge map={BENNE_STATUT} value={b.statut} /> },
              { key: 'client', label: 'Client', value: (b) => (b.client_id ? data.cmap.get(b.client_id)?.nom ?? '' : '') },
              { key: 'depuis', label: 'Depuis', value: (b) => daysSince(b.depuis) ?? 0, render: (b) => {
                const j = daysSince(b.depuis) ?? 0;
                return <span className={b.statut === 'chez_client' && j > data.seuil ? 'font-semibold text-red-600' : ''}>{j} j</span>;
              } },
              { key: 'etat', label: 'État', value: (b) => BENNE_ETAT[b.etat][0], render: (b) => <StatusBadge map={BENNE_ETAT} value={b.etat} /> },
              { key: 'verif', label: 'Vérifiée', value: (b) => b.derniere_verification ?? '', render: (b) => fmtDate(b.derniere_verification) },
            ]} />
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title="Nouvelle benne" wide>
        <EntityForm fields={BENNE_FIELDS} initial={{ type: 'ampliroll', etat: 'bon', actif: true }} onSubmit={async (v) => {
          if (!v.code_barres) v.code_barres = v.numero;
          const { data: b, error: err } = await supabase.from('bennes').insert(v).select('id').single();
          if (err) throw err.code === '23505' ? new Error('Ce numéro ou code existe déjà.') : err;
          navigate(`/bennes/${b.id}`);
        }} />
      </Modal>
    </div>
  );
}
