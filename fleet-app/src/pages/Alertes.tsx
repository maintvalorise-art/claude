import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DataTable from '../components/DataTable';
import { Card, ErrorBox, PageHeader, Select, Spinner, StatusBadge } from '../components/ui';
import { ALERT_LEVEL, MODULE_LABELS, alerteTitre, options } from '../lib/labels';
import { supabase } from '../lib/supabase';
import type { AlertLevel, Alerte, Module } from '../lib/types';
import { must, useAsync } from '../lib/useAsync';

const ORDER: Record<AlertLevel, number> = { expire: 0, urgent: 1, bientot: 2, ok: 3 };

export default function Alertes() {
  const navigate = useNavigate();
  const [module, setModule] = useState<Module | ''>('');
  const [niveau, setNiveau] = useState<AlertLevel | ''>('');
  const { data, loading, error } = useAsync(async () => must(await supabase.from('v_alertes').select('*')) as Alerte[]);

  const list = useMemo(
    () => (data ?? [])
      .filter((a) => (!module || a.module === module) && (!niveau || a.niveau === niveau))
      .sort((a, b) => ORDER[a.niveau] - ORDER[b.niveau]),
    [data, module, niveau],
  );

  return (
    <div>
      <PageHeader
        title="Alertes"
        subtitle="Papiers, maintenance, stock min, retards fournisseurs, consommation anormale, bennes immobiles…"
      />
      <Card>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : (
          <DataTable
            rows={list}
            rowKey={(a) => a.categorie + a.ref_id}
            onRowClick={(a) => a.lien && navigate(a.lien)}
            exportName="alertes"
            toolbar={
              <>
                <Select className="w-40" value={module} onChange={(e) => setModule(e.target.value as Module | '')}>
                  <option value="">Tous les modules</option>
                  {options(MODULE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <Select className="w-36" value={niveau} onChange={(e) => setNiveau(e.target.value as AlertLevel | '')}>
                  <option value="">Tous niveaux</option>
                  {(['expire', 'urgent', 'bientot'] as AlertLevel[]).map((n) => <option key={n} value={n}>{ALERT_LEVEL[n][0]}</option>)}
                </Select>
              </>
            }
            empty="Rien à signaler 👍"
            columns={[
              { key: 'niveau', label: 'Niveau', render: (a) => <StatusBadge map={ALERT_LEVEL} value={a.niveau} />, value: (a) => ALERT_LEVEL[a.niveau][0] },
              { key: 'module', label: 'Module', value: (a) => MODULE_LABELS[a.module] },
              { key: 'titre', label: 'Alerte', value: (a) => alerteTitre(a), render: (a) => <b>{alerteTitre(a)}</b> },
              { key: 'cible', label: 'Concerne' },
              { key: 'detail', label: 'Détail' },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
