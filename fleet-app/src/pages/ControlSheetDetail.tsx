import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner, cx } from '../components/ui';
import { fetchControlItems, fetchDriverNames, groupByCategory } from '../lib/data';
import { fmtDate, fmtDateTime, fmtNumber } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { ControlResult, ControlSheet, Vehicle } from '../lib/types';
import { must, useAsync } from '../lib/useAsync';

export default function ControlSheetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error } = useAsync(async () => {
    const sheet = must(await supabase.from('control_sheets').select('*').eq('id', id!).single()) as ControlSheet;
    const [vehicle, results, items, names] = await Promise.all([
      supabase.from('vehicles').select('*').eq('id', sheet.vehicle_id).single().then(must),
      supabase.from('control_results').select('*').eq('sheet_id', sheet.id).then(must),
      fetchControlItems(true),
      fetchDriverNames(),
    ]);
    const res = new Map((results as ControlResult[]).map((r) => [r.item_id, r]));
    return { sheet, vehicle: vehicle as Vehicle, res, items: items.filter((i) => res.has(i.id)), names };
  }, [id]);

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox>{error ?? 'Fiche introuvable'}</ErrorBox>;
  const { sheet, vehicle, res, items, names } = data;

  return (
    <div className="mx-auto max-w-3xl space-y-4 print:max-w-none">
      <PageHeader
        title={<>Fiche de contrôle · {vehicle.matricule}</>}
        subtitle={`${fmtDate(sheet.date_controle)} · enregistrée le ${fmtDateTime(sheet.created_at)}`}
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="secondary" onClick={() => window.print()}>Imprimer</Button>
            <Button variant="ghost" onClick={() => navigate(-1)}>Retour</Button>
          </div>
        }
      />
      <Card>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <Info label="Chauffeur · السائق" value={names.get(sheet.chauffeur_id) ?? '—'} />
          <Info label="Conducteur précédent" value={sheet.conducteur_precedent_id ? names.get(sheet.conducteur_precedent_id) ?? '—' : '—'} />
          <Info label="Véhicule" value={`${vehicle.matricule} ${vehicle.marque ?? ''} ${vehicle.modele ?? ''}`} />
          <Info label={`Compteur départ (${vehicle.unite_compteur})`} value={fmtNumber(sheet.compteur_depart)} />
          <Info label="Prochaine vidange" value={fmtNumber(sheet.prochaine_vidange)} />
          <Info label="Résultat" value={sheet.nb_nok ? <Badge tone="red">{sheet.nb_nok} NOK</Badge> : <Badge tone="green">Tout OK</Badge>} />
        </dl>
      </Card>
      {groupByCategory(items).map((g) => (
        <Card key={g.categorie} title={g.categorie}>
          <ul className="-my-2 divide-y divide-slate-100">
            {g.items.map((it) => {
              const r = res.get(it.id)!;
              return (
                <li key={it.id} className={cx('flex items-start justify-between gap-3 py-2 text-sm', !r.ok && 'text-red-700')}>
                  <span>
                    {it.label_fr}
                    {it.label_ar && <span className="ar block text-xs text-slate-500" dir="rtl">{it.label_ar}</span>}
                    {r.commentaire && <span className="block text-xs font-medium">→ {r.commentaire}</span>}
                  </span>
                  <Badge tone={r.ok ? 'green' : 'red'}>{r.ok ? 'OK' : 'NOK'}</Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
      {sheet.remarques && (
        <Card title="Remarques · ملاحظات">
          <p className="whitespace-pre-line text-sm">{sheet.remarques}</p>
        </Card>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
