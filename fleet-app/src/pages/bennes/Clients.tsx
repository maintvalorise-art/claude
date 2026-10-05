import { useState } from 'react';
import DataTable from '../../components/DataTable';
import EntityForm, { type FieldDef } from '../../components/EntityForm';
import { Badge, Button, Card, ErrorBox, Modal, PageHeader, Spinner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { Benne, Client } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

const FIELDS: FieldDef[] = [
  { name: 'nom', label: 'Nom', required: true, full: true },
  { name: 'adresse', label: 'Adresse / site', full: true },
  { name: 'contact', label: 'Contact' },
  { name: 'telephone', label: 'Téléphone', type: 'tel' },
  { name: 'strategique', label: 'Client stratégique (GPS prioritaire)', type: 'checkbox' },
  { name: 'actif', label: 'Actif', type: 'checkbox' },
];

export default function Clients() {
  const { profile } = useAuth();
  const gerer = can(profile, 'bennesGerer');
  const [edit, setEdit] = useState<Client | 'new' | null>(null);
  const { data, loading, error, reload } = useAsync(async () => {
    const [clients, bennes] = await Promise.all([
      supabase.from('clients').select('*').order('nom').then(must),
      supabase.from('bennes').select('client_id').eq('statut', 'chez_client').then(must),
    ]);
    const counts = new Map<string, number>();
    (bennes as Pick<Benne, 'client_id'>[]).forEach((b) => b.client_id && counts.set(b.client_id, (counts.get(b.client_id) ?? 0) + 1));
    return { clients: clients as Client[], counts };
  });

  return (
    <div>
      <PageHeader title="Clients" subtitle="Sites où sont placées les bennes" actions={gerer && <Button onClick={() => setEdit('new')}>+ Client</Button>} />
      <Card>
        {loading ? <Spinner /> : error || !data ? <ErrorBox>{error}</ErrorBox> : (
          <DataTable rows={data.clients} rowKey={(c) => c.id} onRowClick={gerer ? (c) => setEdit(c) : undefined} exportName="clients"
            rowClassName={(c) => (c.actif ? undefined : 'opacity-50')}
            columns={[
              { key: 'nom', label: 'Client', render: (c) => <b>{c.nom} {c.strategique && <Badge tone="violet">Stratégique</Badge>}</b> },
              { key: 'adresse', label: 'Adresse', value: (c) => c.adresse ?? '' },
              { key: 'contact', label: 'Contact', value: (c) => [c.contact, c.telephone].filter(Boolean).join(' · ') },
              { key: 'bennes', label: 'Bennes sur site', value: (c) => data.counts.get(c.id) ?? 0 },
            ]} />
        )}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Nouveau client' : 'Modifier le client'}>
        {edit && (
          <EntityForm fields={FIELDS} initial={edit === 'new' ? { actif: true } : (edit as unknown as Record<string, unknown>)} onSubmit={async (v) => {
            const { error: err } = edit === 'new' ? await supabase.from('clients').insert(v) : await supabase.from('clients').update(v).eq('id', edit.id);
            if (err) throw err;
            setEdit(null);
            void reload();
          }} />
        )}
      </Modal>
    </div>
  );
}
