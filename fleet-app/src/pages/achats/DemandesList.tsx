import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import { Badge, Button, Card, ErrorBox, PageHeader, Select, Spinner, StatusBadge, Tabs } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { byId, fetchPeople, fetchVehicles, vehicleLabel } from '../../lib/data';
import { fmtDateTime, fmtMoney } from '../../lib/format';
import { DA_OUVERTES, DA_STATUT, URGENCE, options } from '../../lib/labels';
import { can, canRequestPurchase } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { DADelai, DAStatut, DemandeAchat, Urgence } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

type Vue = 'ouvertes' | 'mes' | 'a_valider' | 'toutes';

export default function DemandesList() {
  const { profile } = useAuth();
  const p = profile!;
  const navigate = useNavigate();
  const voirTout = can(p, 'achatsVoirTout');
  const [vue, setVue] = useState<Vue>(voirTout ? 'ouvertes' : 'mes');
  const [statut, setStatut] = useState<DAStatut | ''>('');
  const [urgence, setUrgence] = useState<Urgence | ''>('');

  const { data, loading, error } = useAsync(async () => {
    const [das, delais, people, vehicles, team] = await Promise.all([
      supabase.from('demandes_achat').select('*').order('created_at', { ascending: false }).limit(1000).then(must),
      supabase.from('v_da_delais').select('id, limite_prise_en_charge, limite_commande').then(must),
      fetchPeople(),
      fetchVehicles(false),
      supabase.from('profiles').select('id').eq('manager_id', p.id).then(must),
    ]);
    return {
      das: das as DemandeAchat[],
      delais: byId(delais as DADelai[]),
      names: new Map(people.map((x) => [x.id, x.full_name])),
      vehicles: byId(vehicles),
      team: new Set((team as { id: string }[]).map((t) => t.id)),
    };
  });

  const aValider = (d: DemandeAchat) =>
    (d.statut === 'attente_validation' && (data?.team.has(d.demandeur_id) || ['direction', 'admin'].includes(p.role)))
    || (d.statut === 'attente_direction' && ['direction', 'admin'].includes(p.role));

  const list = useMemo(() => {
    if (!data) return [];
    return data.das.filter((d) =>
      (vue === 'toutes'
        || (vue === 'ouvertes' && DA_OUVERTES.includes(d.statut))
        || (vue === 'mes' && d.demandeur_id === p.id)
        || (vue === 'a_valider' && aValider(d)))
      && (!statut || d.statut === statut) && (!urgence || d.urgence === urgence));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, vue, statut, urgence]);

  const nbAValider = data?.das.filter(aValider).length ?? 0;
  const tabs: [Vue, string][] = [
    ...(voirTout ? [['ouvertes', 'En cours'] as [Vue, string]] : []),
    ['mes', 'Mes demandes'],
    ...((nbAValider > 0 || (data?.team.size ?? 0) > 0 || ['direction', 'admin'].includes(p.role)) ? [['a_valider', `À valider (${nbAValider})`] as [Vue, string]] : []),
    ['toutes', 'Toutes'],
  ];

  function retard(d: DemandeAchat) {
    const x = data?.delais.get(d.id);
    if (!x) return null;
    const now = Date.now();
    if (d.statut === 'soumise' && !d.prise_en_charge_le && now > new Date(x.limite_prise_en_charge).getTime()) return 'Prise en charge en retard';
    if (['soumise', 'attente_validation', 'attente_direction', 'validee'].includes(d.statut) && now > new Date(x.limite_commande).getTime()) return 'Commande en retard';
    if (d.statut === 'commandee' && d.date_livraison_prevue && new Date(d.date_livraison_prevue + 'T23:59:59').getTime() < now) return 'Livraison en retard';
    return null;
  }

  return (
    <div>
      <PageHeader
        title="Demandes d'achat"
        subtitle="Émission → vérification magasin → validation → devis → bon de commande → réception → clôture"
        actions={canRequestPurchase(p) && <Link to="/achats/nouvelle"><Button>+ Nouvelle demande</Button></Link>}
      />
      <Tabs tabs={tabs} value={vue} onChange={setVue} />
      <Card>
        {loading ? <Spinner /> : error || !data ? <ErrorBox>{error}</ErrorBox> : (
          <DataTable
            rows={list}
            rowKey={(d) => d.id}
            onRowClick={(d) => navigate(`/achats/${d.id}`)}
            exportName="demandes-achat"
            toolbar={
              <>
                <Select className="w-48" value={statut} onChange={(e) => setStatut(e.target.value as DAStatut | '')}>
                  <option value="">Tous les statuts</option>
                  {options(DA_STATUT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <Select className="w-40" value={urgence} onChange={(e) => setUrgence(e.target.value as Urgence | '')}>
                  <option value="">Toutes urgences</option>
                  {options(URGENCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </>
            }
            columns={[
              { key: 'numero', label: 'N°', render: (d) => <span className="font-semibold text-sky-700">{d.numero}</span> },
              { key: 'created_at', label: 'Date', value: (d) => d.created_at, render: (d) => <span className="whitespace-nowrap">{fmtDateTime(d.created_at)}</span> },
              { key: 'demandeur', label: 'Demandeur', value: (d) => data.names.get(d.demandeur_id) ?? '' },
              { key: 'motif', label: 'Motif', render: (d) => <>{d.motif}{d.auto && <> <Badge tone="violet">Auto stock min</Badge></>}</> },
              { key: 'vehicule', label: 'Véhicule / machine', value: (d) => (d.vehicle_id ? vehicleLabel(data.vehicles.get(d.vehicle_id)) : d.equipement) ?? '' },
              { key: 'urgence', label: 'Urgence', value: (d) => URGENCE[d.urgence][0], render: (d) => <StatusBadge map={URGENCE} value={d.urgence} /> },
              { key: 'statut', label: 'Statut', value: (d) => DA_STATUT[d.statut][0], render: (d) => (
                <span className="flex flex-col gap-1">
                  <StatusBadge map={DA_STATUT} value={d.statut} />
                  {retard(d) && <Badge tone="red">{retard(d)}</Badge>}
                </span>
              ) },
              { key: 'montant', label: 'Montant', value: (d) => d.montant_commande ?? d.montant_estime ?? '', render: (d) => <span className="whitespace-nowrap">{fmtMoney(d.montant_commande ?? d.montant_estime)}</span> },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
