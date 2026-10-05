import { useState } from 'react';
import InterventionRequestForm from '../../components/InterventionRequestForm';
import { Badge, Button, Card, Empty, ErrorBox, Modal, PageHeader, Spinner, StatusBadge, SuccessBox } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fetchVehicles } from '../../lib/data';
import { fmtDateTime, fmtMoney } from '../../lib/format';
import { INTERVENTION_STATUS, INTERVENTION_TYPE_LABELS, PRIORITY } from '../../lib/labels';
import { supabase } from '../../lib/supabase';
import type { Intervention } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

export default function MyRequests() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const { data, loading, error, reload } = useAsync(async () => {
    const [vehicles, items] = await Promise.all([
      fetchVehicles(),
      supabase.from('interventions').select('*').eq('demandeur_id', profile!.id).order('created_at', { ascending: false }).limit(100).then(must),
    ]);
    return { vehicles, items: items as Intervention[] };
  });

  const matricule = (id: string) => data?.vehicles.find((v) => v.id === id)?.matricule ?? '—';

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={<>Mes demandes <span className="ar text-slate-500">· طلباتي</span></>}
        subtitle="Vidange, panne, pneus, freins… · تغيير الزيت، عطب، العجلات…"
        actions={<Button onClick={() => { setSent(false); setOpen(true); }}>+ Nouvelle demande · طلب جديد</Button>}
      />
      {sent && <div className="mb-4"><SuccessBox>Demande envoyée. Vous serez informé de son avancement ici. · تم إرسال الطلب</SuccessBox></div>}
      {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : (
        <div className="space-y-3">
          {data!.items.length === 0 && <Card><Empty>Aucune demande pour le moment.</Empty></Card>}
          {data!.items.map((it) => (
            <Card key={it.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-500">N° {it.numero} · {fmtDateTime(it.created_at)} · {matricule(it.vehicle_id)}</div>
                  <div className="font-semibold">{it.titre}</div>
                  <div className="text-sm text-slate-600">{INTERVENTION_TYPE_LABELS[it.type]}</div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {it.vehicule_immobilise && <Badge tone="red">Immobilisé</Badge>}
                  <StatusBadge map={PRIORITY} value={it.priorite} />
                  <StatusBadge map={INTERVENTION_STATUS} value={it.statut} />
                </div>
              </div>
              {it.description && <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{it.description}</p>}
              {(it.reponse || it.assigne_a) && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                  <div className="text-xs font-semibold uppercase text-slate-500">Réponse maintenance · رد الصيانة</div>
                  {it.assigne_a && <div>Pris en charge par : {it.assigne_a}</div>}
                  {it.reponse && <div className="whitespace-pre-line">{it.reponse}</div>}
                  {it.cout != null && <div className="text-slate-500">Coût : {fmtMoney(it.cout)}</div>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Nouvelle demande d'intervention">
        {data && (
          <InterventionRequestForm
            vehicles={data.vehicles}
            onDone={() => { setOpen(false); setSent(true); void reload(); }}
          />
        )}
      </Modal>
    </div>
  );
}
