import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import DocumentsPanel, { delaiDoc } from '../../components/DocumentsPanel';
import EntityForm, { type FieldDef } from '../../components/EntityForm';
import { Badge, Button, Card, ErrorBox, Modal, PageHeader, Spinner, StatusBadge, SuccessBox, Table, Td } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { adminUsers, fetchProfiles, fetchVehicles, vehicleLabel } from '../../lib/data';
import { ALERT_LEVEL, ROLE_LABELS, options } from '../../lib/labels';
import { ROLE_ACCESS } from '../../lib/roles';
import { errorMessage, supabase } from '../../lib/supabase';
import type { Echeance, Profile, Role } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

const RANK = { expire: 0, urgent: 1, bientot: 2, ok: 3 };

export default function Users() {
  const { profile: me, reloadProfile } = useAuth();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [showMatrix, setShowMatrix] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [profiles, vehicles, ech] = await Promise.all([
      fetchProfiles(),
      fetchVehicles(),
      supabase.from('v_echeances').select('*').not('chauffeur_id', 'is', null).then(must),
    ]);
    const worst = new Map<string, Echeance>();
    for (const e of ech as Echeance[]) {
      const cur = worst.get(e.chauffeur_id!);
      if (!cur || RANK[e.niveau] < RANK[cur.niveau]) worst.set(e.chauffeur_id!, e);
    }
    return { profiles, pmap: new Map(profiles.map((p) => [p.id, p])), vehicles, worst };
  });

  const papersFor = data?.profiles.find((p) => p.id === params.get('id'));
  const list = data?.profiles.filter((p) => showInactive || p.active) ?? [];

  const fields = (creation: boolean, self = false): FieldDef[] => [
    { name: 'full_name', label: 'Nom complet', required: true, full: true },
    ...(creation ? [
      { name: 'username', label: 'Identifiant de connexion', required: true, hint: 'Ex. ahmed.b — ou une adresse e-mail professionnelle' } as FieldDef,
      { name: 'password', label: 'Mot de passe', required: true, hint: '6 caractères minimum' } as FieldDef,
    ] : []),
    { name: 'role', label: 'Profil d\'accès', type: 'select', options: options(ROLE_LABELS), required: true, disabled: self, hint: self ? 'Vous ne pouvez pas changer votre propre profil' : undefined },
    { name: 'service', label: 'Service', placeholder: 'Production, déchets, administration…' },
    { name: 'phone', label: 'Téléphone', type: 'tel' },
    { name: 'manager_id', label: 'Responsable hiérarchique', type: 'select', options: (data?.profiles ?? []).filter((p) => p.active).map((p) => [p.id, `${p.full_name} (${ROLE_LABELS[p.role]})`]), hint: 'Valide ses demandes d\'achat' },
    { name: 'demandeur_autorise', label: 'Demandeur autorisé (peut émettre des demandes d\'achat)', type: 'checkbox', full: true },
    ...(!creation ? [{ name: 'password', label: 'Nouveau mot de passe', hint: 'Laisser vide pour ne pas changer' } as FieldDef] : []),
  ];

  async function toggleActive(p: Profile) {
    setActionError(null);
    try {
      await adminUsers({ action: 'set_active', user_id: p.id, active: !p.active });
      void reload();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Utilisateurs & accès"
        subtitle="Chaque profil n'accède qu'à son module ; les droits sont appliqués par la base de données."
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowMatrix((s) => !s)}>{showMatrix ? 'Masquer' : 'Voir'} la matrice des accès</Button>
            <Button onClick={() => setCreating(true)}>+ Créer un compte</Button>
          </>
        }
      />
      {showMatrix && (
        <Card title="Matrice des accès par profil">
          <Table head={['Profil', 'Accès']}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <tr key={r}><Td className="whitespace-nowrap font-medium">{ROLE_LABELS[r]}</Td><Td>{ROLE_ACCESS[r]}</Td></tr>)}
          </Table>
          <p className="mt-2 text-xs text-slate-500">« Demandeur autorisé » peut être coché pour n'importe quel profil (ex. chef d'équipe production) afin de l'ajouter à la liste des demandeurs d'achat.</p>
        </Card>
      )}
      <SuccessBox>{msg}</SuccessBox>
      <ErrorBox>{actionError}</ErrorBox>
      <Card>
        {loading ? <Spinner /> : error || !data ? <ErrorBox>{error}</ErrorBox> : (
          <DataTable rows={list} rowKey={(p) => p.id} exportName="utilisateurs"
            rowClassName={(p) => (p.active ? undefined : 'opacity-50')}
            toolbar={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Désactivés</label>}
            columns={[
              { key: 'full_name', label: 'Nom', render: (p) => <b>{p.full_name} {!p.active && <Badge>Désactivé</Badge>}</b> },
              { key: 'username', label: 'Identifiant', value: (p) => p.username ?? '' },
              { key: 'role', label: 'Profil', value: (p) => ROLE_LABELS[p.role], render: (p) => <Badge tone={p.role === 'admin' ? 'red' : p.role === 'chauffeur' ? 'gray' : p.role === 'direction' ? 'violet' : 'blue'}>{ROLE_LABELS[p.role]}</Badge> },
              { key: 'service', label: 'Service', value: (p) => p.service ?? '' },
              { key: 'manager', label: 'Responsable', value: (p) => (p.manager_id ? data.pmap.get(p.manager_id)?.full_name ?? '' : '') },
              { key: 'da', label: 'DA', value: (p) => (p.demandeur_autorise || ['admin', 'direction', 'acheteur', 'magasinier', 'responsable_flotte', 'demandeur'].includes(p.role) ? 'Oui' : 'Non') },
              { key: 'vehicule', label: 'Véhicule', value: (p) => data.vehicles.filter((v) => v.chauffeur_id === p.id).map(vehicleLabel).join(', ') },
              { key: 'papiers', label: 'Papiers', value: (p) => data.worst.get(p.id)?.niveau ?? '', render: (p) => {
                const w = data.worst.get(p.id);
                return w ? <span className="whitespace-nowrap"><StatusBadge map={ALERT_LEVEL} value={w.niveau} /> <span className="text-xs text-slate-500">{delaiDoc(w.jours_restants)}</span></span> : <span className="text-xs text-slate-400">—</span>;
              } },
              { key: 'actions', label: '', noExport: true, render: (p) => (
                <span className="whitespace-nowrap">
                  <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setParams({ id: p.id })}>Papiers</Button>{' '}
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditing(p)}>Modifier</Button>
                  {p.id !== me?.id && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => toggleActive(p)}>{p.active ? 'Désactiver' : 'Réactiver'}</Button>}
                </span>
              ) },
            ]} />
        )}
      </Card>

      <Modal open={!!papersFor} onClose={() => setParams({}, { replace: true })} title={`Papiers de ${papersFor?.full_name ?? ''}`} wide>
        {papersFor && <DocumentsPanel owner={{ chauffeur_id: papersFor.id }} title="Permis, carte professionnelle, visite médicale" />}
      </Modal>
      <Modal open={creating} onClose={() => setCreating(false)} title="Créer un compte" wide>
        <EntityForm fields={fields(true)} initial={{ role: 'chauffeur' }} submitLabel="Créer le compte" onSubmit={async (v) => {
          await adminUsers({ action: 'create', ...v, username: String(v.username).replace(/\s/g, '').toLowerCase() });
          setCreating(false);
          setMsg(`Compte créé. Identifiant de connexion : « ${String(v.username).toLowerCase()} »`);
          void reload();
        }} />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Modifier ${editing?.full_name ?? ''}`} wide>
        {editing && (
          <EntityForm fields={fields(false, editing.id === me?.id)} initial={editing as unknown as Record<string, unknown>} onSubmit={async (v) => {
            const { password, ...row } = v;
            const { error: err } = await supabase.from('profiles').update(row).eq('id', editing.id);
            if (err) throw err;
            if (password) await adminUsers({ action: 'set_password', user_id: editing.id, password });
            setEditing(null);
            if (editing.id === me?.id) reloadProfile();
            void reload();
          }} />
        )}
      </Modal>
    </div>
  );
}
