import { useNavigate } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fetchPeople } from '../../lib/data';
import { fmtDateTime, fmtNumber } from '../../lib/format';
import { can } from '../../lib/roles';
import { errorMessage, supabase } from '../../lib/supabase';
import type { Inventaire } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';
import { useState } from 'react';

export default function Inventaires() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const gerer = can(profile, 'magasinGerer');
  const [error, setError] = useState<string | null>(null);
  const { data, loading } = useAsync(async () => {
    const [inv, people] = await Promise.all([
      supabase.from('inventaires').select('*').order('created_at', { ascending: false }).then(must),
      fetchPeople(),
    ]);
    return { inv: inv as Inventaire[], names: new Map(people.map((p) => [p.id, p.full_name])) };
  });

  async function start(type: 'tournant' | 'complet') {
    setError(null);
    const { data: id, error: err } = await supabase.rpc('demarrer_inventaire', { p_type: type });
    if (err) setError(errorMessage(err));
    else navigate(`/magasin/inventaires/${id}`);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventaires"
        subtitle="Inventaire tournant mensuel des pièces A, inventaire complet annuel"
        actions={gerer && (
          <>
            <Button variant="secondary" onClick={() => start('tournant')}>Démarrer tournant (pièces A)</Button>
            <Button onClick={() => start('complet')}>Démarrer inventaire complet</Button>
          </>
        )}
      />
      <ErrorBox>{error}</ErrorBox>
      <Card>
        {loading || !data ? <Spinner /> : (
          <DataTable rows={data.inv} rowKey={(i) => i.id} onRowClick={(i) => navigate(`/magasin/inventaires/${i.id}`)} exportName="inventaires" columns={[
            { key: 'date', label: 'Démarré le', value: (i) => i.created_at, render: (i) => fmtDateTime(i.created_at) },
            { key: 'type', label: 'Type', value: (i) => (i.type === 'tournant' ? 'Tournant (A)' : 'Complet') },
            { key: 'statut', label: 'Statut', value: (i) => i.statut, render: (i) => (i.statut === 'cloture' ? <Badge tone="green">Clôturé</Badge> : <Badge tone="amber">En cours</Badge>) },
            { key: 'nb', label: 'Articles', value: (i) => i.nb_articles ?? '' },
            { key: 'ecarts', label: 'Écarts', value: (i) => i.nb_ecarts ?? '' },
            { key: 'fiabilite', label: 'Fiabilité', value: (i) => (i.nb_articles && i.nb_ecarts != null ? 100 * (i.nb_articles - i.nb_ecarts) / i.nb_articles : ''), render: (i) => (i.nb_articles && i.nb_ecarts != null ? `${fmtNumber(100 * (i.nb_articles - i.nb_ecarts) / i.nb_articles, 1)} %` : '—') },
            { key: 'auteur', label: 'Par', value: (i) => (i.auteur_id ? data.names.get(i.auteur_id) ?? '' : '') },
          ]} />
        )}
      </Card>
    </div>
  );
}
