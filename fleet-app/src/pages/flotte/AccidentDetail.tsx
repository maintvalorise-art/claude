import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import EntityForm from '../../components/EntityForm';
import { Badge, Card, ErrorBox, Info, PageHeader, Spinner, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fetchDriverNames, vehicleLabel } from '../../lib/data';
import { fmtDateTime, fmtMoney, fmtNumber } from '../../lib/format';
import { ACCIDENT_STATUS, options } from '../../lib/labels';
import { can } from '../../lib/roles';
import { supabase } from '../../lib/supabase';
import type { Accident, Vehicle } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

export default function AccidentDetail() {
  const { id } = useParams();
  const { profile } = useAuth();
  const gerer = can(profile, 'flotteGerer');
  const [photos, setPhotos] = useState<string[]>([]);
  const { data, loading, error, reload } = useAsync(async () => {
    const a = must(await supabase.from('accidents').select('*').eq('id', id!).single()) as Accident;
    const [v, names] = await Promise.all([
      supabase.from('vehicles').select('*').eq('id', a.vehicle_id).single().then(must),
      fetchDriverNames(),
    ]);
    return { a, v: v as Vehicle, names };
  }, [id]);

  useEffect(() => {
    if (!data?.a.photos.length) return;
    supabase.storage.from('accidents').createSignedUrls(data.a.photos, 3600).then(({ data: urls }) => setPhotos((urls ?? []).map((u) => u.signedUrl).filter(Boolean) as string[]));
  }, [data]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBox>{error ?? 'Accident introuvable'}</ErrorBox>;
  const { a, v, names } = data;

  return (
    <div className="space-y-5">
      <div className="text-sm print:hidden"><Link to="/accidents" className="text-sky-700 hover:underline">← Accidents</Link></div>
      <PageHeader title={<span className="flex items-center gap-3">{a.numero} <StatusBadge map={ACCIDENT_STATUS} value={a.statut} /></span>}
        subtitle={`${fmtDateTime(a.date_accident)} · ${a.lieu}`} />
      <Card title="Déclaration">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <Info label="Véhicule"><Link className="text-sky-700 underline" to={`/vehicules/${v.id}`}>{vehicleLabel(v)}</Link></Info>
          <Info label="Chauffeur">{a.chauffeur_id ? names.get(a.chauffeur_id) : '—'}</Info>
          <Info label="Déclaré par">{a.declare_par ? names.get(a.declare_par) : '—'} · {fmtDateTime(a.created_at)}</Info>
          <Info label="Tiers impliqués">{a.tiers}</Info>
          <Info label="Constat amiable">{a.constat_amiable ? 'Oui' : 'Non'}</Info>
          <Info label="Blessés">{a.blesses ? <Badge tone="red">Oui</Badge> : 'Non'}</Info>
          <div className="sm:col-span-3"><Info label="Description"><span className="whitespace-pre-line">{a.description}</span></Info></div>
        </dl>
        {photos.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="h-32 w-full rounded-lg object-cover" /></a>)}
          </div>
        )}
      </Card>
      <Card title="Dossier assurance, réparation et analyse">
        {gerer ? (
          <EntityForm
            fields={[
              { name: 'statut', label: 'Statut du dossier', type: 'select', options: options(ACCIDENT_STATUS), required: true },
              { name: 'assurance_reference', label: 'Référence assurance' },
              { name: 'montant_indemnisation', label: 'Indemnisation (DH)', type: 'number', min: 0, step: '0.01' },
              { name: 'franchise', label: 'Franchise (DH)', type: 'number', min: 0, step: '0.01' },
              { name: 'cout_reparation', label: 'Coût de réparation (DH)', type: 'number', min: 0, step: '0.01' },
              { name: 'immobilisation_jours', label: "Durée d'immobilisation (jours)", type: 'number', min: 0, step: '0.5' },
              { name: 'causes', label: 'Analyse des causes', type: 'textarea' },
              { name: 'actions_correctives', label: 'Actions correctives (formation, sanction, équipement)', type: 'textarea' },
            ]}
            initial={a as unknown as Record<string, unknown>}
            onSubmit={async (x) => {
              const { error: err } = await supabase.from('accidents').update(x).eq('id', a.id);
              if (err) throw err;
              void reload();
            }}
          />
        ) : (
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <Info label="Assurance">{a.assurance_reference}</Info>
            <Info label="Indemnisation">{fmtMoney(a.montant_indemnisation)}</Info>
            <Info label="Coût réparation">{fmtMoney(a.cout_reparation)}</Info>
            <Info label="Immobilisation">{a.immobilisation_jours != null ? `${fmtNumber(a.immobilisation_jours, 1)} j` : '—'}</Info>
          </dl>
        )}
      </Card>
    </div>
  );
}
