import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import DocumentsPanel from '../../components/DocumentsPanel';
import EntityForm, { type FieldDef } from '../../components/EntityForm';
import VehicleForm from '../../components/VehicleForm';
import { Badge, Button, Card, ErrorBox, Info, Modal, PageHeader, Spinner, StatusBadge, Tabs } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { byId, fetchArticles, fetchPeople, vehicleLabel } from '../../lib/data';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '../../lib/format';
import {
  ACCIDENT_STATUS, DESTINATION_LABELS, INTERVENTION_STATUS, INTERVENTION_TYPE_LABELS, PLAN_TYPE_LABELS,
  VEHICLE_STATUS, VEHICLE_TYPE_LABELS, options,
} from '../../lib/labels';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type {
  Accident, AuditEntry, ControlSheet, Intervention, MouvementStock, PlanMaintenance, Plein, Pneu, Trajet, Vehicle,
} from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

type Tab = 'papiers' | 'maintenance' | 'pneus' | 'pieces' | 'gasoil' | 'trajets' | 'accidents' | 'fiches' | 'historique';

const PLAN_FIELDS: FieldDef[] = [
  { name: 'type', label: 'Type', type: 'select', options: options(PLAN_TYPE_LABELS), required: true },
  { name: 'libelle', label: 'Libellé', required: true, placeholder: 'Vidange moteur + filtres' },
  { name: 'intervalle_compteur', label: 'Tous les … (km ou heures)', type: 'number', min: 1 },
  { name: 'intervalle_jours', label: 'Ou tous les … jours', type: 'number', min: 1 },
  { name: 'dernier_compteur', label: 'Dernière réalisation au compteur', type: 'number', min: 0 },
  { name: 'derniere_date', label: 'Dernière réalisation le', type: 'date' },
  { name: 'alerte_compteur', label: 'Alerter … km/h avant', type: 'number', min: 0 },
  { name: 'alerte_jours', label: 'Alerter … jours avant', type: 'number', min: 0 },
  { name: 'actif', label: 'Actif', type: 'checkbox' },
];

const PNEU_FIELDS: FieldDef[] = [
  { name: 'position', label: 'Position', placeholder: 'AV G, AR D int…' },
  { name: 'marque', label: 'Marque' },
  { name: 'dimension', label: 'Dimension', placeholder: '315/80 R22.5' },
  { name: 'numero_serie', label: 'N° de série' },
  { name: 'date_montage', label: 'Date de montage', type: 'date' },
  { name: 'compteur_montage', label: 'Compteur au montage', type: 'number', min: 0 },
  { name: 'statut', label: 'Statut', type: 'select', options: [['monte', 'Monté'], ['stock', 'En stock'], ['rebut', 'Remplacé / rebut']], required: true },
  { name: 'motif_retrait', label: 'Motif (permutation, crevaison, usure…)' },
];

export default function VehicleDetail() {
  const { id } = useParams();
  const { profile } = useAuth();
  const gerer = can(profile, 'flotteGerer');
  const [tab, setTab] = useState<Tab>('papiers');
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState<PlanMaintenance | 'new' | null>(null);
  const [realiser, setRealiser] = useState<PlanMaintenance | null>(null);
  const [pneu, setPneu] = useState<Pneu | 'new' | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const opt = <T,>(r: { data: T[] | null }) => r.data ?? [];
    const [v, people, plans, inter, pneus, pieces, pleins, trajets, accidents, fiches, audit, articles] = await Promise.all([
      supabase.from('vehicles').select('*').eq('id', id!).single().then(must),
      fetchPeople(),
      supabase.from('v_plans_maintenance').select('*').eq('vehicle_id', id!).then(opt),
      supabase.from('interventions').select('*').eq('vehicle_id', id!).order('created_at', { ascending: false }).limit(200).then(opt),
      supabase.from('pneus').select('*').eq('vehicle_id', id!).order('statut').then(opt),
      supabase.from('mouvements_stock').select('*').eq('vehicle_id', id!).order('created_at', { ascending: false }).limit(300).then(opt),
      supabase.from('v_pleins').select('*').eq('vehicle_id', id!).order('date_plein', { ascending: false }).limit(200).then(opt),
      supabase.from('trajets').select('*').eq('vehicle_id', id!).order('date_trajet', { ascending: false }).limit(200).then(opt),
      supabase.from('accidents').select('*').eq('vehicle_id', id!).order('date_accident', { ascending: false }).then(opt),
      supabase.from('control_sheets').select('*').eq('vehicle_id', id!).order('created_at', { ascending: false }).limit(100).then(opt),
      supabase.from('audit_log').select('*').eq('table_name', 'vehicles').eq('record_id', id!).order('created_at', { ascending: false }).limit(50).then(opt),
      fetchArticles(false),
    ]);
    return {
      v: v as Vehicle, names: new Map(people.map((p) => [p.id, p.full_name])), people,
      plans: plans as PlanMaintenance[], inter: inter as Intervention[], pneus: pneus as Pneu[],
      pieces: pieces as MouvementStock[], pleins: pleins as Plein[], trajets: trajets as Trajet[],
      accidents: accidents as Accident[], fiches: fiches as ControlSheet[], audit: audit as AuditEntry[], amap: byId(articles),
    };
  }, [id]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBox>{error ?? 'Véhicule introuvable'}</ErrorBox>;
  const { v, names } = data;
  const u = v.unite_compteur;
  const coutMO = data.inter.reduce((s, i) => s + (i.cout ?? 0), 0);
  const coutPieces = data.pieces.filter((m) => m.type === 'sortie').reduce((s, m) => s + m.quantite * (m.prix_unitaire ?? 0), 0);
  const consos = data.pleins.filter((p) => p.consommation != null);
  const consoMoy = consos.length ? consos.reduce((s, p) => s + Number(p.consommation), 0) / consos.length : null;
  const immobH = data.inter.reduce((s, i) => s + (i.duree_immobilisation_h ?? 0), 0);

  const tabs: [Tab, string][] = [
    ['papiers', 'Papiers'], ['maintenance', `Maintenance (${data.inter.length})`], ['pneus', `Pneus (${data.pneus.filter((p) => p.statut === 'monte').length})`],
    ['pieces', `Pièces (${data.pieces.length})`], ['gasoil', `Gasoil (${data.pleins.length})`], ['trajets', `Trajets (${data.trajets.length})`],
    ['accidents', `Accidents (${data.accidents.length})`], ['fiches', `Fiches (${data.fiches.length})`], ['historique', 'Historique'],
  ];

  return (
    <div className="space-y-5">
      <div className="text-sm print:hidden"><Link to="/vehicules" className="text-sky-700 hover:underline">← Véhicules</Link></div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{vehicleLabel(v)} <StatusBadge map={VEHICLE_STATUS} value={v.statut} />{!v.actif && <Badge>Inactif</Badge>}</span>}
        subtitle={`${VEHICLE_TYPE_LABELS[v.type]} · ${[v.marque, v.modele, v.annee].filter(Boolean).join(' ') || '—'}${v.numero_serie ? ' · N° ' + v.numero_serie : ''}`}
        actions={gerer && <Button onClick={() => setEditing(true)}>Modifier</Button>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card><Info label="Compteur">{fmtNumber(v.compteur_actuel)} {u}</Info></Card>
        <Card><Info label="Affecté à">{v.chauffeur_id ? names.get(v.chauffeur_id) : '—'}</Info></Card>
        <Card><Info label="Coût maintenance">{fmtMoney(coutMO + coutPieces)}</Info><p className="text-xs text-slate-500">MO {fmtMoney(coutMO)} · pièces {fmtMoney(coutPieces)}</p></Card>
        <Card><Info label="Consommation moyenne">{consoMoy == null ? '—' : `${fmtNumber(consoMoy, 1)} ${u === 'km' ? 'L/100 km' : 'L/h'}`}</Info><p className="text-xs text-slate-500">Référence {v.conso_reference ?? '—'}</p></Card>
        <Card><Info label="Immobilisation cumulée">{fmtNumber(immobH, 1)} h</Info></Card>
      </div>
      {v.notes && <Card><p className="whitespace-pre-line text-sm">{v.notes}</p></Card>}

      <Tabs<Tab> tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'papiers' && <DocumentsPanel owner={{ vehicle_id: v.id }} readOnly={!gerer} title="Carte grise, assurance, visite technique, vignette, autorisations…" />}

      {tab === 'maintenance' && (
        <>
          <Card title="Planning de maintenance" actions={gerer && <Button onClick={() => setPlan('new')}>+ Plan</Button>}>
            <DataTable rows={data.plans} rowKey={(p) => p.id} onRowClick={gerer ? (p) => setPlan(p) : undefined} columns={[
              { key: 'libelle', label: 'Intervention', render: (p) => <><b>{p.libelle}</b><span className="block text-xs text-slate-500">{PLAN_TYPE_LABELS[p.type]}</span></> },
              { key: 'periodicite', label: 'Périodicité', value: (p) => [p.intervalle_compteur && `${fmtNumber(p.intervalle_compteur)} ${u}`, p.intervalle_jours && `${p.intervalle_jours} j`].filter(Boolean).join(' / ') },
              { key: 'dernier', label: 'Dernière', value: (p) => [p.dernier_compteur != null && `${fmtNumber(p.dernier_compteur)} ${u}`, p.derniere_date && fmtDate(p.derniere_date)].filter(Boolean).join(' · ') },
              { key: 'prochaine', label: 'Prochaine', value: (p) => [p.prochain_compteur != null && `${fmtNumber(p.prochain_compteur)} ${u}`, p.prochaine_date && fmtDate(p.prochaine_date)].filter(Boolean).join(' · ') },
              { key: 'reste', label: 'Reste', value: (p) => Math.min(p.reste_compteur ?? 1e9, p.reste_jours ?? 1e9), render: (p) => {
                const late = (p.reste_compteur ?? 1) <= 0 || (p.reste_jours ?? 1) <= 0;
                const soon = (p.reste_compteur ?? 1e9) <= p.alerte_compteur || (p.reste_jours ?? 1e9) <= p.alerte_jours;
                return <Badge tone={late ? 'red' : soon ? 'amber' : 'green'}>{[p.reste_compteur != null && `${fmtNumber(p.reste_compteur)} ${u}`, p.reste_jours != null && `${p.reste_jours} j`].filter(Boolean).join(' / ')}</Badge>;
              } },
              { key: 'action', label: '', noExport: true, render: (p) => gerer && <Button variant="secondary" className="px-2 py-1 text-xs" onClick={(e) => { e.stopPropagation(); setRealiser(p); }}>Réalisée</Button> },
            ]} />
          </Card>
          <Card title="Interventions (préventives et correctives)" actions={<Link to={`/interventions?vehicle=${v.id}`} className="text-sm text-sky-700 underline">Gérer</Link>}>
            <DataTable rows={data.inter} rowKey={(i) => i.id} exportName={`interventions-${v.matricule}`} columns={[
              { key: 'numero', label: 'N°' },
              { key: 'date', label: 'Date', value: (i) => i.created_at, render: (i) => <span className="whitespace-nowrap">{fmtDate(i.created_at)}</span> },
              { key: 'type', label: 'Type', value: (i) => INTERVENTION_TYPE_LABELS[i.type] },
              { key: 'nature', label: 'Nature', value: (i) => (i.nature === 'preventive' ? 'Préventive' : 'Corrective') },
              { key: 'titre', label: 'Objet', render: (i) => <Link className="text-sky-700 underline" to={`/interventions?id=${i.id}`}>{i.titre}</Link>, value: (i) => i.titre },
              { key: 'cause', label: 'Cause', value: (i) => i.cause ?? '' },
              { key: 'immob', label: 'Immob. (h)', value: (i) => i.duree_immobilisation_h ?? '' },
              { key: 'cout', label: 'Coût MO', value: (i) => i.cout ?? '', render: (i) => fmtMoney(i.cout) },
              { key: 'statut', label: 'Statut', value: (i) => INTERVENTION_STATUS[i.statut][0], render: (i) => <StatusBadge map={INTERVENTION_STATUS} value={i.statut} /> },
            ]} />
          </Card>
        </>
      )}

      {tab === 'pneus' && (
        <Card title="Pneus : position, montage, permutation, remplacement" actions={gerer && <Button onClick={() => setPneu('new')}>+ Pneu</Button>}>
          <DataTable rows={data.pneus} rowKey={(p) => p.id} onRowClick={gerer ? (p) => setPneu(p) : undefined} exportName={`pneus-${v.matricule}`}
            rowClassName={(p) => (p.statut === 'rebut' ? 'opacity-50' : undefined)}
            columns={[
              { key: 'position', label: 'Position', value: (p) => p.position ?? '' },
              { key: 'marque', label: 'Marque / dimension', value: (p) => [p.marque, p.dimension].filter(Boolean).join(' · ') },
              { key: 'numero_serie', label: 'N° série', value: (p) => p.numero_serie ?? '' },
              { key: 'montage', label: 'Monté le', value: (p) => p.date_montage ?? '', render: (p) => fmtDate(p.date_montage) },
              { key: 'km', label: `Parcouru (${u})`, value: (p) => (p.compteur_montage != null && p.statut === 'monte' ? v.compteur_actuel - p.compteur_montage : ''), render: (p) => (p.compteur_montage != null && p.statut === 'monte' ? fmtNumber(v.compteur_actuel - p.compteur_montage) : '—') },
              { key: 'statut', label: 'Statut', value: (p) => p.statut, render: (p) => <Badge tone={p.statut === 'monte' ? 'green' : p.statut === 'stock' ? 'blue' : 'gray'}>{{ monte: 'Monté', stock: 'Stock', rebut: 'Rebut' }[p.statut]}</Badge> },
              { key: 'motif', label: 'Motif', value: (p) => p.motif_retrait ?? '' },
            ]} />
        </Card>
      )}

      {tab === 'pieces' && (
        <Card title="Pièces consommées (sorties magasin imputées au véhicule)">
          <DataTable rows={data.pieces} rowKey={(m) => m.id} exportName={`pieces-${v.matricule}`} columns={[
            { key: 'date', label: 'Date', value: (m) => m.created_at, render: (m) => fmtDate(m.created_at) },
            { key: 'article', label: 'Article', value: (m) => { const a = data.amap.get(m.article_id); return a ? `${a.code} · ${a.designation}` : ''; } },
            { key: 'quantite', label: 'Qté', value: (m) => (m.type === 'sortie' ? m.quantite : -m.quantite) },
            { key: 'valeur', label: 'Valeur', value: (m) => m.quantite * (m.prix_unitaire ?? 0), render: (m) => fmtMoney(m.quantite * (m.prix_unitaire ?? 0)) },
            { key: 'motif', label: 'Motif' },
            { key: 'demandeur', label: 'Demandeur', value: (m) => m.demandeur ?? '' },
          ]} />
        </Card>
      )}

      {tab === 'gasoil' && (
        <Card title="Pleins de gasoil">
          <DataTable rows={data.pleins} rowKey={(p) => p.id} exportName={`gasoil-${v.matricule}`} columns={[
            { key: 'date', label: 'Date', value: (p) => p.date_plein, render: (p) => fmtDateTime(p.date_plein) },
            { key: 'litres', label: 'Litres', value: (p) => p.litres },
            { key: 'compteur', label: `Compteur (${u})`, value: (p) => p.compteur },
            { key: 'conso', label: u === 'km' ? 'L/100 km' : 'L/h', value: (p) => p.consommation ?? '', render: (p) => {
              const anormal = p.consommation != null && v.conso_reference != null && p.consommation > v.conso_reference * 1.2;
              return <span className={anormal ? 'font-semibold text-red-600' : ''}>{p.consommation ?? '—'}</span>;
            } },
            { key: 'montant', label: 'Montant', value: (p) => p.montant ?? '', render: (p) => fmtMoney(p.montant) },
            { key: 'source', label: 'Source', value: (p) => (p.source === 'cuve' ? 'Cuve interne' : p.station ?? 'Station') },
            { key: 'chauffeur', label: 'Chauffeur', value: (p) => (p.chauffeur_id ? names.get(p.chauffeur_id) ?? '' : '') },
          ]} />
        </Card>
      )}

      {tab === 'trajets' && (
        <Card title="Journal des trajets">
          <DataTable rows={data.trajets} rowKey={(t) => t.id} exportName={`trajets-${v.matricule}`} columns={[
            { key: 'date', label: 'Date', value: (t) => t.date_trajet, render: (t) => fmtDate(t.date_trajet) },
            { key: 'trajet', label: 'Trajet', value: (t) => `${t.depart} → ${t.destination}` },
            { key: 'type', label: 'Destination', value: (t) => DESTINATION_LABELS[t.type_destination] },
            { key: 'km', label: `Distance (${u})`, value: (t) => t.compteur_arrivee - t.compteur_depart },
            { key: 'poids', label: 'Poids (kg)', value: (t) => t.poids_kg ?? '' },
            { key: 'chauffeur', label: 'Chauffeur', value: (t) => (t.chauffeur_id ? names.get(t.chauffeur_id) ?? '' : '') },
          ]} />
        </Card>
      )}

      {tab === 'accidents' && (
        <Card title="Sinistres">
          <DataTable rows={data.accidents} rowKey={(a) => a.id} columns={[
            { key: 'numero', label: 'N°', render: (a) => <Link className="text-sky-700 underline" to={`/accidents/${a.id}`}>{a.numero}</Link> },
            { key: 'date', label: 'Date', value: (a) => a.date_accident, render: (a) => fmtDateTime(a.date_accident) },
            { key: 'lieu', label: 'Lieu' },
            { key: 'chauffeur', label: 'Chauffeur', value: (a) => (a.chauffeur_id ? names.get(a.chauffeur_id) ?? '' : '') },
            { key: 'cout', label: 'Coût', value: (a) => a.cout_reparation ?? '', render: (a) => fmtMoney(a.cout_reparation) },
            { key: 'statut', label: 'Statut', value: (a) => ACCIDENT_STATUS[a.statut][0], render: (a) => <StatusBadge map={ACCIDENT_STATUS} value={a.statut} /> },
          ]} />
        </Card>
      )}

      {tab === 'fiches' && (
        <Card title="Fiches de contrôle">
          <DataTable rows={data.fiches} rowKey={(s) => s.id} columns={[
            { key: 'date', label: 'Date', value: (s) => s.date_controle, render: (s) => <Link className="text-sky-700 underline" to={`/fiches/${s.id}`}>{fmtDate(s.date_controle)}</Link> },
            { key: 'chauffeur', label: 'Chauffeur', value: (s) => names.get(s.chauffeur_id) ?? '' },
            { key: 'compteur', label: 'Compteur', value: (s) => s.compteur_depart },
            { key: 'resultat', label: 'Résultat', value: (s) => s.nb_nok, render: (s) => (s.nb_nok ? <Badge tone="red">{s.nb_nok} NOK</Badge> : <Badge tone="green">OK</Badge>) },
            { key: 'valide', label: 'Validée', value: (s) => (s.valide_le ? 'Oui' : 'Non'), render: (s) => (s.valide_le ? `✓ ${names.get(s.valide_par ?? '') ?? ''}` : <Badge tone="amber">À valider</Badge>) },
          ]} />
        </Card>
      )}

      {tab === 'historique' && (
        <Card title="Historique des modifications">
          <DataTable rows={data.audit} rowKey={(a) => String(a.id)} columns={[
            { key: 'date', label: 'Date', value: (a) => a.created_at, render: (a) => fmtDateTime(a.created_at) },
            { key: 'action', label: 'Action', value: (a) => (a.action === 'insert' ? 'Création' : 'Modification') },
            { key: 'auteur', label: 'Par', value: (a) => (a.auteur_id ? names.get(a.auteur_id) ?? '' : 'Système') },
            { key: 'donnees', label: 'Champs', value: (a) => Object.entries(a.donnees ?? {}).filter(([k]) => !['id', 'created_at'].includes(k)).map(([k, x]) => `${k} = ${x ?? '—'}`).join(' · ') },
          ]} />
        </Card>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title={`Modifier ${vehicleLabel(v)}`} wide>
        <VehicleForm vehicle={v} drivers={data.people} onDone={() => { setEditing(false); void reload(); }} />
      </Modal>
      <Modal open={!!plan} onClose={() => setPlan(null)} title={plan === 'new' ? 'Nouveau plan de maintenance' : 'Modifier le plan'} wide>
        {plan && (
          <EntityForm fields={PLAN_FIELDS}
            initial={plan === 'new' ? { type: 'vidange', libelle: 'Vidange moteur + filtres', intervalle_compteur: u === 'km' ? 10000 : 250, dernier_compteur: v.compteur_actuel, alerte_compteur: u === 'km' ? 1000 : 25, alerte_jours: 15, actif: true } : (plan as unknown as Record<string, unknown>)}
            onSubmit={async (x) => {
              if (x.intervalle_compteur == null && x.intervalle_jours == null) throw new Error('Indiquez une périodicité (compteur ou jours).');
              const { error: err } = plan === 'new'
                ? await supabase.from('plans_maintenance').insert({ ...x, vehicle_id: v.id })
                : await supabase.from('plans_maintenance').update(x).eq('id', plan.id);
              if (err) throw err;
              setPlan(null);
              void reload();
            }} />
        )}
      </Modal>
      <Modal open={!!realiser} onClose={() => setRealiser(null)} title={`Réalisée : ${realiser?.libelle ?? ''}`}>
        {realiser && (
          <EntityForm
            fields={[
              { name: 'compteur', label: `Compteur (${u})`, type: 'number', min: 0, required: true },
              { name: 'cout', label: 'Coût main-d\'œuvre (DH)', type: 'number', min: 0, step: '0.01' },
              { name: 'assigne_a', label: 'Intervenant' },
              { name: 'description', label: 'Huile, filtres et pièces utilisés', type: 'textarea' },
            ]}
            initial={{ compteur: v.compteur_actuel }}
            submitLabel="Enregistrer l'intervention"
            onSubmit={async (x) => {
              const { error: err } = await supabase.from('interventions').insert({
                vehicle_id: v.id, demandeur_id: profile!.id, type: realiser.type === 'vidange' ? 'vidange' : realiser.type === 'hydraulique' ? 'hydraulique' : realiser.type === 'pneus' ? 'pneumatique' : 'preventive',
                nature: 'preventive', statut: 'terminee', titre: realiser.libelle, plan_id: realiser.id, ...x,
              });
              if (err) throw err;
              setRealiser(null);
              void reload();
            }}
          >
            <p className="text-xs text-slate-500">Les pièces sorties du magasin pour ce véhicule sont imputées automatiquement à son coût.</p>
          </EntityForm>
        )}
      </Modal>
      <Modal open={!!pneu} onClose={() => setPneu(null)} title={pneu === 'new' ? 'Nouveau pneu' : 'Modifier le pneu'} wide>
        {pneu && (
          <EntityForm fields={PNEU_FIELDS} initial={pneu === 'new' ? { statut: 'monte', compteur_montage: v.compteur_actuel, date_montage: new Date().toISOString().slice(0, 10) } : (pneu as unknown as Record<string, unknown>)}
            onSubmit={async (x) => {
              const { error: err } = pneu === 'new'
                ? await supabase.from('pneus').insert({ ...x, vehicle_id: v.id })
                : await supabase.from('pneus').update(x).eq('id', pneu.id);
              if (err) throw err;
              setPneu(null);
              void reload();
            }} />
        )}
      </Modal>
    </div>
  );
}
