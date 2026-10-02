import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import DocumentsPanel from '../../components/DocumentsPanel';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, SuccessBox, Table, Td } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fetchVehicles } from '../../lib/data';
import { delaiEcheance } from '../../lib/format';
import { ALERT_LEVEL, ROLE_LABELS } from '../../lib/labels';
import { adminUsers, fetchProfiles } from '../../lib/staff';
import { errorMessage, supabase } from '../../lib/supabase';
import type { Echeance, Profile, Role } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

export default function Drivers() {
  const { isAdmin, profile: me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [profiles, vehicles, ech] = await Promise.all([
      fetchProfiles(),
      fetchVehicles(),
      supabase.from('v_echeances').select('*').not('chauffeur_id', 'is', null).then(must),
    ]);
    const worst = new Map<string, Echeance>();
    const rank = { expire: 0, urgent: 1, bientot: 2, ok: 3 };
    for (const e of ech as Echeance[]) {
      const cur = worst.get(e.chauffeur_id!);
      if (!cur || rank[e.niveau] < rank[cur.niveau]) worst.set(e.chauffeur_id!, e);
    }
    return { profiles, vehicles, worst };
  });

  const papersFor = data?.profiles.find((p) => p.id === params.get('id'));

  async function toggleActive(p: Profile) {
    setActionError(null);
    try {
      await adminUsers({ action: 'set_active', user_id: p.id, active: !p.active });
      void reload();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }

  const list = data?.profiles.filter((p) => showInactive || p.active) ?? [];

  return (
    <div>
      <PageHeader
        title="Chauffeurs & comptes"
        subtitle="Comptes de connexion, rôles et papiers des chauffeurs (permis, visite médicale…)"
        actions={isAdmin && <Button onClick={() => setCreating(true)}>+ Créer un compte</Button>}
      />
      <div className="mb-4 space-y-2">
        <SuccessBox>{msg}</SuccessBox>
        <ErrorBox>{actionError}</ErrorBox>
      </div>
      <Card actions={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Afficher désactivés</label>} title={`${list.length} compte(s)`}>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : list.length === 0 ? <Empty>Aucun compte.</Empty> : (
          <Table head={['Nom', 'Identifiant', 'Rôle', 'Téléphone', 'Véhicule', 'Papiers', '']}>
            {list.map((p) => {
              const w = data!.worst.get(p.id);
              const veh = data!.vehicles.filter((v) => v.chauffeur_id === p.id).map((v) => v.matricule).join(', ');
              return (
                <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                  <Td className="font-medium">{p.full_name} {!p.active && <Badge>Désactivé</Badge>}</Td>
                  <Td className="text-slate-500">{p.username}</Td>
                  <Td><Badge tone={p.role === 'admin' ? 'red' : p.role === 'gestionnaire' ? 'blue' : 'gray'}>{ROLE_LABELS[p.role]}</Badge></Td>
                  <Td>{p.phone ? <a href={`tel:${p.phone}`} className="text-sky-700">{p.phone}</a> : '—'}</Td>
                  <Td>{veh || '—'}</Td>
                  <Td>
                    {w ? (
                      <span className="whitespace-nowrap"><StatusBadge map={ALERT_LEVEL} value={w.niveau} /> <span className="text-xs text-slate-500">{delaiEcheance(w)}</span></span>
                    ) : <span className="text-xs text-slate-400">Aucun</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setParams({ id: p.id })}>Papiers</Button>{' '}
                    {isAdmin && (
                      <>
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditing(p)}>Modifier</Button>
                        {p.id !== me?.id && (
                          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => toggleActive(p)}>{p.active ? 'Désactiver' : 'Réactiver'}</Button>
                        )}
                      </>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Modal open={!!papersFor} onClose={() => setParams({}, { replace: true })} title={`Papiers de ${papersFor?.full_name ?? ''}`} wide>
        {papersFor && <DocumentsPanel owner={{ chauffeur_id: papersFor.id }} title="Permis, carte professionnelle, visite médicale" />}
      </Modal>
      <Modal open={creating} onClose={() => setCreating(false)} title="Créer un compte">
        <CreateUserForm onDone={(login) => { setCreating(false); setMsg(`Compte créé. Identifiant de connexion : « ${login} »`); void reload(); }} />
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Modifier ${editing?.full_name ?? ''}`}>
        {editing && <EditUserForm user={editing} isSelf={editing.id === me?.id} onDone={() => { setEditing(null); void reload(); }} />}
      </Modal>
    </div>
  );
}

function CreateUserForm({ onDone }: { onDone: (login: string) => void }) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('chauffeur');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminUsers({ action: 'create', full_name: fullName, username, password, phone: phone || null, role });
      onDone(username);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nom complet *"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} required /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Identifiant *" hint="Ex. ahmed.b (sans espace)">
          <Input value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, '').toLowerCase())} required minLength={3} autoCapitalize="none" />
        </Field>
        <Field label="Mot de passe *" hint="6 caractères minimum"><Input value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></Field>
        <Field label="Téléphone"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Rôle">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        </Field>
      </div>
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" disabled={busy} className="w-full">{busy ? 'Création…' : 'Créer le compte'}</Button>
    </form>
  );
}

function EditUserForm({ user, isSelf, onDone }: { user: Profile; isSelf: boolean; onDone: () => void }) {
  const [fullName, setFullName] = useState(user.full_name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [role, setRole] = useState<Role>(user.role);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.from('profiles').update({ full_name: fullName.trim(), phone: phone.trim() || null, role }).eq('id', user.id);
      if (err) throw err;
      if (password) await adminUsers({ action: 'set_password', user_id: user.id, password });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nom complet"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} required /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Téléphone"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Rôle" hint={isSelf ? 'Vous ne pouvez pas changer votre propre rôle' : undefined}>
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isSelf}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Nouveau mot de passe" hint="Laisser vide pour ne pas changer"><Input value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} /></Field>
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" disabled={busy} className="w-full">{busy ? 'Enregistrement…' : 'Enregistrer'}</Button>
    </form>
  );
}
