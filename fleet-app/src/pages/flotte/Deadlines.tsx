import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import DocumentForm from '../../components/DocumentForm';
import { delaiDoc } from '../../components/DocumentsPanel';
import { Button, Card, ErrorBox, Modal, PageHeader, Select, Spinner, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fetchProfiles, fetchVehicles } from '../../lib/data';
import { fmtDate } from '../../lib/format';
import { ALERT_LEVEL, DOCUMENT_TYPE_LABELS, options } from '../../lib/labels';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { AlertLevel, Echeance } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

const ORDER: Record<AlertLevel, number> = { expire: 0, urgent: 1, bientot: 2, ok: 3 };

export default function Deadlines() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const gerer = can(profile, 'flotteGerer');
  const [niveau, setNiveau] = useState<'alertes' | AlertLevel | ''>('alertes');
  const [type, setType] = useState('');
  const [adding, setAdding] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const [ech, vehicles, profiles] = await Promise.all([
      supabase.from('v_echeances').select('*').then(must),
      fetchVehicles(),
      fetchProfiles(),
    ]);
    return { ech: ech as Echeance[], vehicles, profiles: profiles.filter((p) => p.active) };
  });

  const list = useMemo(() => (data?.ech ?? [])
    .filter((e) => (niveau === '' || (niveau === 'alertes' ? e.niveau !== 'ok' : e.niveau === niveau)) && (!type || e.type === type))
    .sort((a, b) => ORDER[a.niveau] - ORDER[b.niveau] || a.jours_restants - b.jours_restants), [data, niveau, type]);

  const counts = useMemo(() => {
    const c: Record<AlertLevel, number> = { expire: 0, urgent: 0, bientot: 0, ok: 0 };
    data?.ech.forEach((e) => c[e.niveau]++);
    return c;
  }, [data]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Papiers & échéances"
        subtitle="Alerte 30 jours et 7 jours avant expiration (délai réglable par papier)"
        actions={gerer && <Button onClick={() => setAdding(true)}>+ Ajouter un papier</Button>}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['expire', 'urgent', 'bientot', 'ok'] as AlertLevel[]).map((n) => (
          <button key={n} type="button" onClick={() => setNiveau(niveau === n ? 'alertes' : n)}
            className={`rounded-xl border bg-white p-3 text-left shadow-sm ${niveau === n ? 'ring-2 ring-slate-900' : 'border-slate-200'}`}>
            <StatusBadge map={ALERT_LEVEL} value={n} />
            <div className="mt-1 text-2xl font-bold">{counts[n]}</div>
          </button>
        ))}
      </div>
      <Card>
        {loading ? <Spinner /> : error || !data ? <ErrorBox>{error}</ErrorBox> : (
          <DataTable
            rows={list} rowKey={(e) => e.id} exportName="echeances"
            onRowClick={(e) => navigate(e.vehicle_id ? `/vehicules/${e.vehicle_id}` : `/utilisateurs?id=${e.chauffeur_id}`)}
            toolbar={
              <>
                <Select className="w-52" value={niveau} onChange={(e) => setNiveau(e.target.value as typeof niveau)}>
                  <option value="alertes">À traiter (dépassé, urgent, bientôt)</option>
                  <option value="">Tout</option>
                  {options(ALERT_LEVEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <Select className="w-52" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">Tous les papiers</option>
                  {options(DOCUMENT_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </>
            }
            columns={[
              { key: 'niveau', label: 'État', value: (e) => ALERT_LEVEL[e.niveau][0], render: (e) => <StatusBadge map={ALERT_LEVEL} value={e.niveau} /> },
              { key: 'type', label: 'Papier', value: (e) => DOCUMENT_TYPE_LABELS[e.type], render: (e) => <><b>{DOCUMENT_TYPE_LABELS[e.type]}</b>{(e.libelle || e.reference) && <span className="block text-xs text-slate-500">{[e.libelle, e.reference].filter(Boolean).join(' · ')}</span>}</> },
              { key: 'cible', label: 'Concerne', value: (e) => e.matricule ?? e.chauffeur_nom ?? '' },
              { key: 'date', label: 'Expiration', value: (e) => e.date_expiration, render: (e) => fmtDate(e.date_expiration) },
              { key: 'delai', label: 'Délai', value: (e) => e.jours_restants, render: (e) => delaiDoc(e.jours_restants) },
            ]}
          />
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title="Ajouter un papier">
        {data && <DocumentForm vehicles={data.vehicles} drivers={data.profiles} onDone={() => { setAdding(false); void reload(); }} />}
      </Modal>
    </div>
  );
}
