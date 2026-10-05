import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import { Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, StatusBadge, Table, Td } from '../../components/ui';
import { byId, fetchArticles, fetchPeople, fetchVehicles, vehicleLabel } from '../../lib/data';
import { daysAgoIso, fmtDateTime, fmtMoney, todayIso } from '../../lib/format';
import { MOUVEMENT_MOTIF, MOUVEMENT_TYPE, options } from '../../lib/labels';
import { supabase } from '../../lib/supabase';
import type { MouvementStock, MouvementType } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

export default function Mouvements() {
  const [debut, setDebut] = useState(daysAgoIso(30));
  const [fin, setFin] = useState(todayIso());
  const [type, setType] = useState<MouvementType | ''>('');
  const [vehicleId, setVehicleId] = useState('');

  const refs = useAsync(async () => {
    const [articles, vehicles, people] = await Promise.all([fetchArticles(false), fetchVehicles(false), fetchPeople()]);
    return { amap: byId(articles), vehicles, vmap: byId(vehicles), names: new Map(people.map((p) => [p.id, p.full_name])) };
  });
  const mv = useAsync(async () => must(await supabase.from('mouvements_stock').select('*')
    .gte('created_at', debut).lt('created_at', new Date(new Date(fin).getTime() + 864e5).toISOString())
    .order('created_at', { ascending: false }).limit(2000)) as MouvementStock[], [debut, fin]);

  const list = useMemo(() => (mv.data ?? []).filter((m) => (!type || m.type === type) && (!vehicleId || m.vehicle_id === vehicleId)), [mv.data, type, vehicleId]);

  // Consommation (valeur des sorties) par véhicule / machine.
  const parEquipement = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of mv.data ?? []) {
      if (m.type !== 'sortie') continue;
      const k = m.vehicle_id ? vehicleLabel(refs.data?.vmap.get(m.vehicle_id)) : m.equipement || 'Non affecté';
      map.set(k, (map.get(k) ?? 0) + m.quantite * (m.prix_unitaire ?? 0));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [mv.data, refs.data]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mouvements de stock"
        actions={
          <div className="flex items-end gap-2 print:hidden">
            <Field label="Du"><Input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} /></Field>
            <Field label="Au"><Input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></Field>
          </div>
        }
      />
      {parEquipement.length > 0 && (
        <Card title="Consommation de pièces par véhicule / machine (valeur)">
          <Table head={['Équipement', 'Valeur des sorties']}>
            {parEquipement.map(([k, v]) => <tr key={k}><Td>{k}</Td><Td>{fmtMoney(v)}</Td></tr>)}
          </Table>
        </Card>
      )}
      <Card>
        {mv.loading || refs.loading ? <Spinner /> : mv.error || refs.error ? <ErrorBox>{mv.error ?? refs.error}</ErrorBox> : (
          <DataTable
            rows={list} rowKey={(m) => m.id} exportName="mouvements-stock"
            toolbar={
              <>
                <Select className="w-36" value={type} onChange={(e) => setType(e.target.value as MouvementType | '')}>
                  <option value="">Tous types</option>
                  {options(MOUVEMENT_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <Select className="w-44" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                  <option value="">Tous véhicules</option>
                  {refs.data!.vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
                </Select>
              </>
            }
            columns={[
              { key: 'date', label: 'Date', value: (m) => m.created_at, render: (m) => <span className="whitespace-nowrap">{fmtDateTime(m.created_at)}</span> },
              { key: 'article', label: 'Article', value: (m) => { const a = refs.data!.amap.get(m.article_id); return a ? `${a.code} ${a.designation}` : ''; }, render: (m) => {
                const a = refs.data!.amap.get(m.article_id);
                return a ? <Link className="text-sky-700 underline" to={`/magasin/${a.id}`}>{a.code}</Link> : '—';
              } },
              { key: 'designation', label: 'Désignation', value: (m) => refs.data!.amap.get(m.article_id)?.designation ?? '' },
              { key: 'type', label: 'Type', value: (m) => MOUVEMENT_TYPE[m.type][0], render: (m) => <StatusBadge map={MOUVEMENT_TYPE} value={m.type} /> },
              { key: 'quantite', label: 'Qté', value: (m) => (m.type === 'sortie' ? -m.quantite : m.quantite) },
              { key: 'valeur', label: 'Valeur', value: (m) => m.quantite * (m.prix_unitaire ?? 0), render: (m) => fmtMoney(m.quantite * (m.prix_unitaire ?? 0)) },
              { key: 'motif', label: 'Motif', value: (m) => MOUVEMENT_MOTIF[m.motif] ?? m.motif },
              { key: 'pour', label: 'Pour', value: (m) => [m.vehicle_id ? vehicleLabel(refs.data!.vmap.get(m.vehicle_id)) : m.equipement, m.demandeur].filter(Boolean).join(' · ') },
              { key: 'auteur', label: 'Par', value: (m) => (m.auteur_id ? refs.data!.names.get(m.auteur_id) ?? '' : '') },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
