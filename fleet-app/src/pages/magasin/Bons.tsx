import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { byId, fetchVehicles, vehicleLabel } from '../../lib/data';
import { daysAgoIso, fmtDate, todayIso } from '../../lib/format';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { BonStock, BonType } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

export default function Bons() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const gerer = can(profile, 'magasinGerer');
  const [debut, setDebut] = useState(daysAgoIso(90));
  const [fin, setFin] = useState(todayIso());
  const [type, setType] = useState<BonType | ''>('');

  const { data, loading, error } = useAsync(async () => {
    const [bons, lignes, vehicles] = await Promise.all([
      supabase.from('bons_stock').select('*').gte('date_bon', debut).lte('date_bon', fin).order('created_at', { ascending: false }).limit(2000).then(must),
      supabase.from('mouvements_stock').select('bon_id').not('bon_id', 'is', null).gte('created_at', debut).then((r) => (r.data ?? []) as { bon_id: string }[]),
      fetchVehicles(false),
    ]);
    const nb = new Map<string, number>();
    for (const l of lignes) nb.set(l.bon_id, (nb.get(l.bon_id) ?? 0) + 1);
    return { bons: bons as BonStock[], nb, vmap: byId(vehicles) };
  }, [debut, fin]);

  const list = useMemo(() => (data?.bons ?? []).filter((b) => !type || b.type === type), [data, type]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bons de réception et de livraison"
        subtitle="Chaque bon a un numéro unique (BR-… pour les entrées, BL-… pour les sorties) et s'imprime au format A5."
        actions={gerer && (
          <>
            <Button onClick={() => navigate('/magasin/bon/reception')}>⬇ Bon de réception</Button>
            <Button variant="secondary" onClick={() => navigate('/magasin/bon/livraison')}>⬆ Bon de livraison</Button>
          </>
        )}
      />
      <Card>
        {loading ? <Spinner /> : error || !data ? <ErrorBox>{error}</ErrorBox> : (
          <DataTable
            rows={list}
            rowKey={(b) => b.id}
            onRowClick={(b) => navigate(`/magasin/bons/${b.id}`)}
            exportName="bons-stock"
            searchPlaceholder="N°, fournisseur, demandeur…"
            toolbar={
              <>
                <Field label="Du"><Input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} /></Field>
                <Field label="Au"><Input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></Field>
                <Select className="w-40 self-end" value={type} onChange={(e) => setType(e.target.value as BonType | '')}>
                  <option value="">Tous les bons</option>
                  <option value="reception">Réceptions</option>
                  <option value="livraison">Livraisons</option>
                </Select>
              </>
            }
            columns={[
              { key: 'numero', label: 'N°', render: (b) => <span className="font-mono font-semibold text-sky-700">{b.numero}</span> },
              { key: 'type', label: 'Type', value: (b) => (b.type === 'reception' ? 'Réception' : 'Livraison'), render: (b) => <Badge tone={b.type === 'reception' ? 'green' : 'amber'}>{b.type === 'reception' ? '⬇ Réception' : '⬆ Livraison'}</Badge> },
              { key: 'date', label: 'Date', value: (b) => b.date_bon, render: (b) => fmtDate(b.date_bon) },
              { key: 'tiers', label: 'Fournisseur / destinataire', value: (b) => [b.tiers, b.vehicle_id ? vehicleLabel(data.vmap.get(b.vehicle_id)) : null].filter(Boolean).join(' · ') },
              { key: 'reference', label: 'Réf. fournisseur', value: (b) => b.reference_tiers ?? '' },
              { key: 'demandeur', label: 'Demandeur / reçu par', value: (b) => b.demandeur ?? '' },
              { key: 'lignes', label: 'Articles', value: (b) => data.nb.get(b.id) ?? 0 },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
