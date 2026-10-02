import { Link } from 'react-router-dom';
import { Card, ErrorBox, Spinner, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fetchVehicles } from '../../lib/data';
import { delaiEcheance, fmtDate, fmtDateTime, todayIso } from '../../lib/format';
import { ALERT_LEVEL, DOCUMENT_TYPE_LABELS, INTERVENTION_STATUS } from '../../lib/labels';
import { supabase } from '../../lib/supabase';
import type { ControlSheet, Echeance, Intervention } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

export default function DriverHome() {
  const { profile } = useAuth();
  const { data, loading, error } = useAsync(async () => {
    const [vehicles, echeances, demandes, fiches] = await Promise.all([
      fetchVehicles(),
      supabase.from('v_echeances').select('*').neq('niveau', 'ok').then(must),
      supabase.from('interventions').select('*').eq('demandeur_id', profile!.id).in('statut', ['nouvelle', 'en_cours']).order('created_at', { ascending: false }).then(must),
      supabase.from('control_sheets').select('*').eq('chauffeur_id', profile!.id).order('created_at', { ascending: false }).limit(1).then(must),
    ]);
    const myVehicles = vehicles.filter((v) => v.chauffeur_id === profile!.id);
    const myIds = new Set(myVehicles.map((v) => v.id));
    const alerts = (echeances as Echeance[]).filter(
      (e) => e.chauffeur_id === profile!.id || (e.vehicle_id && myIds.has(e.vehicle_id)),
    );
    return { myVehicles, alerts, demandes: demandes as Intervention[], last: (fiches as ControlSheet[])[0] };
  });

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;
  const today = todayIso();
  const doneToday = data.last?.date_controle === today;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Bonjour {profile?.full_name} 👋</h1>
        <p className="ar text-slate-500">مرحبا {profile?.full_name}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/ma-fiche" className="rounded-2xl bg-slate-900 p-5 text-white shadow hover:bg-slate-800">
          <div className="text-3xl">📝</div>
          <div className="mt-2 text-lg font-bold">Remplir la fiche de contrôle</div>
          <div className="ar text-slate-300">ملء ورقة المراقبة قبل الإقلاع</div>
          <div className="mt-2 text-xs text-slate-400">
            {doneToday ? '✓ Fiche déjà remplie aujourd\'hui' : data.last ? `Dernière fiche : ${fmtDate(data.last.date_controle)}` : 'Aucune fiche encore'}
          </div>
        </Link>
        <Link to="/mes-demandes" className="rounded-2xl bg-amber-500 p-5 text-slate-900 shadow hover:bg-amber-400">
          <div className="text-3xl">🔧</div>
          <div className="mt-2 text-lg font-bold">Demande d'intervention</div>
          <div className="ar">طلب تدخل: تغيير الزيت، عطب…</div>
          <div className="mt-2 text-xs">{data.demandes.length} demande(s) en cours</div>
        </Link>
      </div>

      {data.myVehicles.length > 0 && (
        <Card title="Mon véhicule · شاحنتي">
          {data.myVehicles.map((v) => (
            <div key={v.id} className="flex flex-wrap justify-between gap-2 text-sm">
              <b>{v.matricule}</b>
              <span>{v.marque} {v.modele}</span>
              <span>Compteur : {v.compteur_actuel.toLocaleString('fr-FR')} {v.unite_compteur}</span>
            </div>
          ))}
        </Card>
      )}

      {data.alerts.length > 0 && (
        <Card title="⚠️ Papiers & entretien à surveiller · وثائق يجب تجديدها">
          <ul className="divide-y divide-slate-100">
            {data.alerts.map((e) => (
              <li key={e.source + e.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <b>{DOCUMENT_TYPE_LABELS[e.type]}</b> {e.matricule && `· ${e.matricule}`}
                  <span className="block text-xs text-slate-500">{e.date_expiration ? fmtDate(e.date_expiration) : ''} {delaiEcheance(e)}</span>
                </span>
                <StatusBadge map={ALERT_LEVEL} value={e.niveau} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.demandes.length > 0 && (
        <Card title="Mes demandes en cours">
          <ul className="divide-y divide-slate-100">
            {data.demandes.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <b>{d.titre}</b>
                  <span className="block text-xs text-slate-500">N° {d.numero} · {fmtDateTime(d.created_at)}</span>
                </span>
                <StatusBadge map={INTERVENTION_STATUS} value={d.statut} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
