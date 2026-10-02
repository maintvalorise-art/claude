import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DocumentForm from '../../components/DocumentForm';
import { Button, Card, Empty, ErrorBox, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Td } from '../../components/ui';
import { fetchVehicles } from '../../lib/data';
import { delaiEcheance, fmtDate } from '../../lib/format';
import { ALERT_LEVEL, DOCUMENT_TYPE_LABELS } from '../../lib/labels';
import { fetchProfiles } from '../../lib/staff';
import { supabase } from '../../lib/supabase';
import type { AlertLevel, Echeance } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

const ORDER: Record<AlertLevel, number> = { expire: 0, urgent: 1, bientot: 2, ok: 3 };

export default function Deadlines() {
  const [niveau, setNiveau] = useState<'alertes' | AlertLevel | ''>('alertes');
  const [type, setType] = useState('');
  const [cible, setCible] = useState<'' | 'vehicule' | 'chauffeur'>('');
  const [adding, setAdding] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const [ech, vehicles, profiles] = await Promise.all([
      supabase.from('v_echeances').select('*').then(must),
      fetchVehicles(),
      fetchProfiles(),
    ]);
    const units = new Map(vehicles.map((v) => [v.id, v.unite_compteur]));
    return { ech: ech as Echeance[], vehicles, profiles: profiles.filter((p) => p.active), units };
  });

  const list = useMemo(() => {
    if (!data) return [];
    return data.ech
      .filter(
        (e) =>
          (niveau === '' || (niveau === 'alertes' ? e.niveau !== 'ok' : e.niveau === niveau)) &&
          (!type || e.type === type) &&
          (!cible || (cible === 'chauffeur' ? !!e.chauffeur_id : !!e.vehicle_id)),
      )
      .sort((a, b) => ORDER[a.niveau] - ORDER[b.niveau] || (a.jours_restants ?? a.reste_compteur ?? 0) - (b.jours_restants ?? b.reste_compteur ?? 0));
  }, [data, niveau, type, cible]);

  const counts = useMemo(() => {
    const c: Record<AlertLevel, number> = { expire: 0, urgent: 0, bientot: 0, ok: 0 };
    data?.ech.forEach((e) => c[e.niveau]++);
    return c;
  }, [data]);

  return (
    <div>
      <PageHeader
        title="Papiers & échéances"
        subtitle="Visite technique, assurance, vignette, tachygraphe, permis, vidanges…"
        actions={<Button onClick={() => setAdding(true)}>+ Ajouter un papier</Button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['expire', 'urgent', 'bientot', 'ok'] as AlertLevel[]).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setNiveau(niveau === n ? 'alertes' : n)}
            className={`rounded-xl border bg-white p-3 text-left shadow-sm ${niveau === n ? 'ring-2 ring-slate-900' : 'border-slate-200'}`}
          >
            <StatusBadge map={ALERT_LEVEL} value={n} />
            <div className="mt-1 text-2xl font-bold">{counts[n]}</div>
          </button>
        ))}
      </div>
      <Card>
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <Select value={niveau} onChange={(e) => setNiveau(e.target.value as typeof niveau)}>
            <option value="alertes">À traiter (expiré, urgent, bientôt)</option>
            <option value="">Tout</option>
            {(Object.keys(ALERT_LEVEL) as AlertLevel[]).map((n) => <option key={n} value={n}>{ALERT_LEVEL[n][0]}</option>)}
          </Select>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Tous les types</option>
            {Object.entries(DOCUMENT_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Select value={cible} onChange={(e) => setCible(e.target.value as typeof cible)}>
            <option value="">Véhicules & chauffeurs</option>
            <option value="vehicule">Véhicules</option>
            <option value="chauffeur">Chauffeurs</option>
          </Select>
        </div>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : list.length === 0 ? <Empty>Rien à signaler 👍</Empty> : (
          <Table head={['État', 'Échéance', 'Concerne', 'Date / seuil', 'Délai']}>
            {list.map((e) => (
              <tr key={e.source + e.id}>
                <Td><StatusBadge map={ALERT_LEVEL} value={e.niveau} /></Td>
                <Td>
                  <div className="font-medium">{DOCUMENT_TYPE_LABELS[e.type]}</div>
                  {(e.libelle || e.reference) && <div className="text-xs text-slate-500">{[e.libelle, e.reference].filter(Boolean).join(' · ')}</div>}
                </Td>
                <Td>
                  {e.vehicle_id ? (
                    <Link to={`/vehicules/${e.vehicle_id}`} className="text-sky-700 hover:underline">{e.matricule}</Link>
                  ) : (
                    <Link to={`/chauffeurs?id=${e.chauffeur_id}`} className="text-sky-700 hover:underline">{e.chauffeur_nom}</Link>
                  )}
                </Td>
                <Td>{e.source === 'vidange' ? 'Compteur' : fmtDate(e.date_expiration)}</Td>
                <Td className="whitespace-nowrap">{delaiEcheance(e, e.vehicle_id ? data!.units.get(e.vehicle_id) : 'km')}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title="Ajouter un papier">
        {data && (
          <DocumentForm vehicles={data.vehicles} drivers={data.profiles} onDone={() => { setAdding(false); void reload(); }} />
        )}
      </Modal>
    </div>
  );
}
