import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import DocumentForm from '../../components/DocumentForm';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea, cx } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { byId, fetchVehicles, vehicleLabel } from '../../lib/data';
import { fmtDate, fmtNumber, todayIso } from '../../lib/format';
import { DOCUMENT_TYPE_LABELS } from '../../lib/labels';
import { can } from '../../lib/roles';
import { errorMessage, supabase } from '../../lib/supabase';
import type { AlertLevel, DocumentRow, Echeance, PlanMaintenance, PlanningRow, Plein, Vehicle } from '../../lib/types';
import { must, useAsync } from '../../lib/useAsync';

type Kind = 'echeance' | 'maintenance' | 'rdv';
interface CalEvent {
  key: string;
  date: string;
  kind: Kind;
  title: string;
  sub: string;
  niveau?: AlertLevel;
  estime?: boolean;
  rdv?: PlanningRow;
  doc?: Echeance;
  plan?: PlanMaintenance;
}

/** Une chose à planifier : un papier qui expire ou une maintenance qui arrive. */
interface ATraiter {
  key: string;
  type: 'document' | 'maintenance';
  titre: string;
  cible: string;
  deadline: string | null;
  detail: string;
  niveau: AlertLevel;
  doc?: Echeance;
  plan?: PlanMaintenance;
  vehicleId: string | null;
  chauffeurId: string | null;
}

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const parse = (s: string) => new Date(s + 'T00:00:00');
const addDays = (s: string, n: number) => iso(new Date(parse(s).getTime() + n * 864e5));
const diffDays = (a: string, b: string) => Math.round((parse(a).getTime() - parse(b).getTime()) / 864e5);

/** Date proposée : 2 semaines avant l'échéance, jamais dans le passé, jamais un dimanche ou un samedi. */
export function suggestDate(deadline: string | null) {
  const today = todayIso();
  let d = deadline ? addDays(deadline, -14) : addDays(today, 7);
  if (d <= today) d = addDays(today, 1);
  const wd = parse(d).getDay();
  if (wd === 6) d = deadline && addDays(d, -1) > today ? addDays(d, -1) : addDays(d, 2);
  else if (wd === 0) d = addDays(d, 1);
  return d;
}

export default function Planning() {
  const { profile } = useAuth();
  const gerer = can(profile, 'flotteGerer');
  const [vue, setVue] = useState<'mois' | 'liste'>(typeof window !== 'undefined' && window.innerWidth < 640 ? 'liste' : 'mois');
  const [mois, setMois] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [vehicleId, setVehicleId] = useState('');
  const [planifier, setPlanifier] = useState<ATraiter | null>(null);
  const [rdv, setRdv] = useState<PlanningRow | null>(null);
  const [libre, setLibre] = useState<string | null>(null);
  const [renew, setRenew] = useState<DocumentRow | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [ech, plans, planning, vehicles, pleins] = await Promise.all([
      supabase.from('v_echeances').select('*').then(must),
      supabase.from('v_plans_maintenance').select('*').then(must),
      supabase.from('planning').select('*').neq('statut', 'annule').gte('date_prevue', addDays(todayIso(), -400)).order('date_prevue').then(must),
      fetchVehicles(),
      supabase.from('v_pleins').select('vehicle_id, compteur, date_plein').gte('date_plein', addDays(todayIso(), -60)).then((r) => (r.data ?? []) as Plein[]),
    ]);
    // Utilisation moyenne par jour (km ou heures) sur 60 jours, pour estimer la date des maintenances au compteur.
    const usage = new Map<string, number>();
    for (const v of vehicles) {
      const pts = pleins.filter((p) => p.vehicle_id === v.id);
      if (pts.length < 2) continue;
      const min = pts.reduce((a, b) => (a.compteur < b.compteur ? a : b));
      const max = pts.reduce((a, b) => (a.compteur > b.compteur ? a : b));
      const jours = Math.max(1, (new Date(max.date_plein).getTime() - new Date(min.date_plein).getTime()) / 864e5);
      if (max.compteur > min.compteur) usage.set(v.id, (max.compteur - min.compteur) / jours);
    }
    return { ech: ech as Echeance[], plans: plans as PlanMaintenance[], planning: planning as PlanningRow[], vehicles, vmap: byId<Vehicle>(vehicles), usage };
  });

  /** Date estimée (compteur) ou prévue (calendrier) d'une maintenance. */
  function planDate(p: PlanMaintenance): { date: string | null; estime: boolean } {
    const byDate = p.prochaine_date ?? null;
    let byKm: string | null = null;
    const u = data?.usage.get(p.vehicle_id);
    if (p.reste_compteur != null && u) byKm = addDays(todayIso(), Math.max(0, Math.floor(p.reste_compteur / u)));
    if (byDate && byKm) return byDate <= byKm ? { date: byDate, estime: false } : { date: byKm, estime: true };
    return byDate ? { date: byDate, estime: false } : { date: byKm, estime: !!byKm };
  }

  const filtreV = (vid: string | null | undefined) => !vehicleId || vid === vehicleId;

  // Tous les événements du calendrier.
  const events = useMemo<CalEvent[]>(() => {
    if (!data) return [];
    const out: CalEvent[] = [];
    for (const e of data.ech) {
      if (!filtreV(e.vehicle_id) || (vehicleId && !e.vehicle_id)) continue;
      out.push({ key: 'd' + e.id, date: e.date_expiration, kind: 'echeance', title: `${DOCUMENT_TYPE_LABELS[e.type]}`, sub: e.matricule ?? e.chauffeur_nom ?? '', niveau: e.niveau, doc: e });
    }
    for (const p of data.plans) {
      if (!filtreV(p.vehicle_id)) continue;
      const { date, estime } = planDate(p);
      if (date) out.push({ key: 'p' + p.id, date, kind: 'maintenance', title: p.libelle, sub: vehicleLabel(data.vmap.get(p.vehicle_id)), estime, plan: p });
    }
    for (const r of data.planning) {
      if (!filtreV(r.vehicle_id)) continue;
      out.push({ key: 'r' + r.id, date: r.date_prevue, kind: 'rdv', title: r.titre, sub: r.vehicle_id ? vehicleLabel(data.vmap.get(r.vehicle_id)) : '', rdv: r });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, vehicleId]);

  // Ce qui reste à planifier (90 jours pour les papiers, fenêtre d'alerte ×2 pour la maintenance).
  const aTraiter = useMemo<ATraiter[]>(() => {
    if (!data) return [];
    const planned = new Set(data.planning.filter((r) => r.statut === 'planifie').flatMap((r) => [r.document_id, r.plan_id]).filter(Boolean) as string[]);
    const out: ATraiter[] = [];
    for (const e of data.ech) {
      if (planned.has(e.id) || e.jours_restants > 90 || !filtreV(e.vehicle_id) || (vehicleId && !e.vehicle_id)) continue;
      out.push({
        key: 'd' + e.id, type: 'document', titre: DOCUMENT_TYPE_LABELS[e.type], cible: e.matricule ?? e.chauffeur_nom ?? '',
        deadline: e.date_expiration, niveau: e.niveau, doc: e, vehicleId: e.vehicle_id, chauffeurId: e.chauffeur_id,
        detail: e.jours_restants < 0 ? `Expiré depuis ${-e.jours_restants} j` : `Expire le ${fmtDate(e.date_expiration)} (${e.jours_restants} j)`,
      });
    }
    for (const p of data.plans) {
      if (planned.has(p.id) || !filtreV(p.vehicle_id)) continue;
      const { date, estime } = planDate(p);
      const proche = (p.reste_compteur != null && p.reste_compteur <= p.alerte_compteur * 2) || (date != null && diffDays(date, todayIso()) <= 60);
      if (!proche) continue;
      const late = (p.reste_compteur ?? 1) <= 0 || (p.reste_jours ?? 1) <= 0;
      out.push({
        key: 'p' + p.id, type: 'maintenance', titre: p.libelle, cible: vehicleLabel(data.vmap.get(p.vehicle_id)), deadline: date, plan: p,
        niveau: late ? 'expire' : (p.reste_compteur ?? 1e9) <= p.alerte_compteur || (p.reste_jours ?? 1e9) <= p.alerte_jours ? 'urgent' : 'bientot',
        vehicleId: p.vehicle_id, chauffeurId: null,
        detail: [p.reste_compteur != null && `${fmtNumber(p.reste_compteur)} ${p.unite_compteur} restants`, date && `${estime ? 'estimée vers le' : 'prévue le'} ${fmtDate(date)}`].filter(Boolean).join(' · '),
      });
    }
    const rank = { expire: 0, urgent: 1, bientot: 2, ok: 3 };
    return out.sort((a, b) => rank[a.niveau] - rank[b.niveau] || (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, vehicleId]);

  function openEvent(ev: CalEvent) {
    if (ev.rdv) return setRdv(ev.rdv);
    const t = aTraiter.find((x) => x.key === ev.key);
    if (t && gerer) return setPlanifier(t);
    const existing = data?.planning.find((r) => r.statut === 'planifie' && (r.document_id === ev.doc?.id || r.plan_id === ev.plan?.id) && (ev.doc || ev.plan));
    if (existing) return setRdv(existing);
    if (gerer && (ev.doc || ev.plan)) {
      setPlanifier({
        key: ev.key, type: ev.doc ? 'document' : 'maintenance', titre: ev.title, cible: ev.sub, deadline: ev.date, niveau: ev.niveau ?? 'ok',
        doc: ev.doc, plan: ev.plan, vehicleId: ev.doc?.vehicle_id ?? ev.plan?.vehicle_id ?? null, chauffeurId: ev.doc?.chauffeur_id ?? null, detail: '',
      });
    }
  }

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;

  const aPlanifierEnRetard = data.planning.filter((r) => r.statut === 'planifie' && r.date_prevue < todayIso()).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Planning"
        subtitle="Échéances des papiers, maintenances prévues et vos rendez-vous planifiés à l'avance"
        actions={
          <>
            <Button variant="secondary" onClick={() => exportIcs(events)}>📤 Exporter (Google / Outlook)</Button>
            {gerer && <Button onClick={() => setLibre(todayIso())}>+ Rendez-vous</Button>}
          </>
        }
      />
      {aPlanifierEnRetard > 0 && <ErrorBox>{aPlanifierEnRetard} rendez-vous planifié(s) dépassé(s) : marquez-les faits ou reportez-les.</ErrorBox>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <Tabs<'mois' | 'liste'> value={vue} onChange={setVue} tabs={[['mois', 'Calendrier'], ['liste', 'Agenda']]} />
            <Select className="ml-auto w-48" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Tous les véhicules</option>
              {data.vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
            </Select>
          </div>
          {vue === 'mois'
            ? <MonthGrid mois={mois} setMois={setMois} events={events} onEvent={openEvent} onDay={gerer ? (d) => setLibre(d) : undefined} />
            : <Agenda events={events} onEvent={openEvent} />}
          <Legend />
        </div>

        <div className="space-y-5">
          <Card title={`À planifier (${aTraiter.length})`}>
            {aTraiter.length === 0 ? <Empty>Tout est planifié 👍</Empty> : (
              <ul className="-my-2 divide-y divide-slate-100">
                {aTraiter.map((t) => (
                  <li key={t.key} className="flex items-start justify-between gap-2 py-2 text-sm">
                    <span>
                      <span className="mr-1">{t.type === 'document' ? '📄' : '🛠'}</span>
                      <b>{t.titre}</b> · {t.cible}
                      <span className={cx('block text-xs', t.niveau === 'expire' ? 'font-semibold text-red-600' : t.niveau === 'urgent' ? 'text-orange-600' : 'text-slate-500')}>{t.detail}</span>
                    </span>
                    {gerer && <Button variant="secondary" className="shrink-0 px-2 py-1 text-xs" onClick={() => setPlanifier(t)}>Planifier</Button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Prochains rendez-vous">
            {(() => {
              const next = data.planning.filter((r) => r.statut === 'planifie' && filtreV(r.vehicle_id));
              return next.length === 0 ? <Empty>Aucun rendez-vous planifié.</Empty> : (
                <ul className="-my-2 divide-y divide-slate-100">
                  {next.slice(0, 12).map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => setRdv(r)} className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:bg-slate-50">
                        <span><b>{r.titre}</b>{r.notes && <span className="block text-xs text-slate-500">{r.notes}</span>}</span>
                        <span className={cx('whitespace-nowrap', r.date_prevue < todayIso() ? 'font-semibold text-red-600' : 'text-slate-600')}>{fmtJour(r.date_prevue)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </Card>
        </div>
      </div>

      <Modal open={!!planifier} onClose={() => setPlanifier(null)} title="Planifier">
        {planifier && (
          <PlanifierForm item={planifier} onDone={() => { setPlanifier(null); void reload(); }} />
        )}
      </Modal>
      <Modal open={libre !== null} onClose={() => setLibre(null)} title="Nouveau rendez-vous">
        {libre !== null && <LibreForm date={libre} vehicles={data.vehicles} onDone={() => { setLibre(null); void reload(); }} />}
      </Modal>
      <Modal open={!!rdv} onClose={() => setRdv(null)} title="Rendez-vous planifié">
        {rdv && (
          <RdvDetail
            rdv={rdv}
            gerer={gerer}
            vehicle={rdv.vehicle_id ? data.vmap.get(rdv.vehicle_id) : undefined}
            echeance={rdv.document_id ? data.ech.find((e) => e.id === rdv.document_id) : undefined}
            onRenew={async () => {
              const { data: doc } = await supabase.from('documents').select('*').eq('id', rdv.document_id!).single();
              setRdv(null);
              setRenew(doc as DocumentRow);
            }}
            onDone={() => { setRdv(null); void reload(); }}
          />
        )}
      </Modal>
      <Modal open={!!renew} onClose={() => setRenew(null)} title="Renouveler le papier">
        {renew && <DocumentForm doc={renew} renew owner={renew.vehicle_id ? { vehicle_id: renew.vehicle_id } : { chauffeur_id: renew.chauffeur_id! }} onDone={() => { setRenew(null); void reload(); }} />}
      </Modal>
    </div>
  );
}

function fmtJour(d: string) {
  return parse(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

const CHIP: Record<string, string> = {
  expire: 'bg-red-100 text-red-800 border-red-200',
  urgent: 'bg-orange-100 text-orange-800 border-orange-200',
  bientot: 'bg-amber-50 text-amber-800 border-amber-200',
  ok: 'bg-slate-100 text-slate-600 border-slate-200',
  maintenance: 'bg-violet-50 text-violet-800 border-violet-200',
  rdv: 'bg-sky-600 text-white border-sky-700',
  fait: 'bg-emerald-50 text-emerald-700 border-emerald-200 line-through',
};

function chipCls(ev: CalEvent) {
  if (ev.kind === 'rdv') return ev.rdv?.statut === 'fait' ? CHIP.fait : CHIP.rdv;
  if (ev.kind === 'maintenance') return CHIP.maintenance;
  return CHIP[ev.niveau ?? 'ok'];
}

function chipIcon(ev: CalEvent) {
  if (ev.kind === 'rdv') return ev.rdv?.statut === 'fait' ? '✓' : '📅';
  if (ev.kind === 'maintenance') return '🛠';
  return '⏰';
}

function MonthGrid({ mois, setMois, events, onEvent, onDay }: {
  mois: Date; setMois: (d: Date) => void; events: CalEvent[]; onEvent: (e: CalEvent) => void; onDay?: (d: string) => void;
}) {
  const first = new Date(mois.getFullYear(), mois.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => iso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
  const byDay = new Map<string, CalEvent[]>();
  events.forEach((e) => byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]));
  const today = todayIso();
  const lastWeekUsed = days.slice(35).some((d) => parse(d).getMonth() === mois.getMonth());

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <Button variant="ghost" onClick={() => setMois(new Date(mois.getFullYear(), mois.getMonth() - 1, 1))}>‹</Button>
        <div className="text-center">
          <div className="text-lg font-bold">{MOIS[mois.getMonth()]} {mois.getFullYear()}</div>
          <button type="button" className="text-xs text-sky-700 underline" onClick={() => { const d = new Date(); setMois(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Aujourd'hui</button>
        </div>
        <Button variant="ghost" onClick={() => setMois(new Date(mois.getFullYear(), mois.getMonth() + 1, 1))}>›</Button>
      </div>
      <div className="grid grid-cols-7 border-l border-t border-slate-200 text-xs">
        {JOURS.map((j) => <div key={j} className="border-b border-r border-slate-200 bg-slate-50 px-1 py-1 text-center font-semibold text-slate-500">{j}</div>)}
        {(lastWeekUsed ? days : days.slice(0, 35)).map((d) => {
          const evs = byDay.get(d) ?? [];
          const other = parse(d).getMonth() !== mois.getMonth();
          return (
            <div key={d} className={cx('min-h-24 border-b border-r border-slate-200 p-1', other && 'bg-slate-50/60', d === today && 'bg-sky-50')}>
              <button
                type="button"
                disabled={!onDay}
                onClick={() => onDay?.(d)}
                title={onDay ? 'Ajouter un rendez-vous' : undefined}
                className={cx('mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs', d === today ? 'bg-sky-600 font-bold text-white' : other ? 'text-slate-400' : 'text-slate-700', onDay && 'hover:bg-slate-200')}
              >
                {parse(d).getDate()}
              </button>
              <div className="space-y-0.5">
                {evs.slice(0, 3).map((e) => (
                  <button key={e.key} type="button" onClick={() => onEvent(e)} title={`${e.title} · ${e.sub}`}
                    className={cx('block w-full truncate rounded border px-1 py-0.5 text-left text-[11px] leading-tight', chipCls(e))}>
                    {chipIcon(e)} {e.title}{e.sub && <span className="opacity-75"> · {e.sub}</span>}
                  </button>
                ))}
                {evs.length > 3 && <div className="px-1 text-[11px] text-slate-500">+{evs.length - 3} autre(s)</div>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Agenda({ events, onEvent }: { events: CalEvent[]; onEvent: (e: CalEvent) => void }) {
  const today = todayIso();
  const from = addDays(today, -30);
  const to = addDays(today, 120);
  const list = events.filter((e) => e.date >= from && e.date <= to && !(e.kind === 'echeance' && e.niveau === 'ok' && e.date > addDays(today, 90)));
  const groups = new Map<string, CalEvent[]>();
  list.forEach((e) => groups.set(e.date, [...(groups.get(e.date) ?? []), e]));
  if (!groups.size) return <Card><Empty>Rien sur les 4 prochains mois.</Empty></Card>;
  return (
    <Card>
      <div className="space-y-4">
        {[...groups.entries()].map(([d, evs]) => (
          <div key={d}>
            <div className={cx('mb-1 text-xs font-semibold uppercase tracking-wide', d < today ? 'text-red-600' : d === today ? 'text-sky-700' : 'text-slate-500')}>
              {parse(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}{d === today && ' · aujourd\'hui'}
            </div>
            <div className="space-y-1">
              {evs.map((e) => (
                <button key={e.key} type="button" onClick={() => onEvent(e)} className={cx('block w-full rounded-lg border px-3 py-2 text-left text-sm', chipCls(e))}>
                  {chipIcon(e)} <b>{e.title}</b>{e.sub && <> · {e.sub}</>}
                  <span className="ml-1 text-xs opacity-75">
                    {e.kind === 'echeance' ? '(expiration)' : e.kind === 'maintenance' ? (e.estime ? '(maintenance, date estimée)' : '(maintenance prévue)') : e.rdv?.statut === 'fait' ? '(fait)' : '(planifié)'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <span className={cx('rounded border px-2 py-0.5', CHIP.expire)}>⏰ Papier expiré / urgent</span>
      <span className={cx('rounded border px-2 py-0.5', CHIP.bientot)}>⏰ Expiration à venir</span>
      <span className={cx('rounded border px-2 py-0.5', CHIP.maintenance)}>🛠 Maintenance due</span>
      <span className={cx('rounded border px-2 py-0.5', CHIP.rdv)}>📅 Votre rendez-vous</span>
      <span className={cx('rounded border px-2 py-0.5', CHIP.fait)}>✓ Fait</span>
    </div>
  );
}

function PlanifierForm({ item, onDone }: { item: ATraiter; onDone: () => void }) {
  const [date, setDate] = useState(suggestDate(item.deadline));
  const [titre, setTitre] = useState(`${item.type === 'document' ? 'Renouveler' : 'Maintenance'} ${item.titre} · ${item.cible}`);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apres = item.deadline && date > item.deadline;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('planning').insert({
      date_prevue: date, titre: titre.trim(), type: item.type, notes: notes.trim() || null,
      document_id: item.doc?.id ?? null, plan_id: item.plan?.id ?? null, vehicle_id: item.vehicleId, chauffeur_id: item.chauffeurId,
    });
    setBusy(false);
    if (err) setError(errorMessage(err));
    else onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        <b>{item.titre}</b> · {item.cible}
        {item.deadline && <div className="text-xs text-slate-500">{item.type === 'document' ? 'Expire le' : 'Échéance'} {fmtDate(item.deadline)}</div>}
      </div>
      <Field label="Date choisie *" hint={item.deadline ? `Proposition : 2 semaines avant l'échéance, un jour ouvré` : undefined}>
        <Input type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      {apres && <p className="text-sm font-medium text-red-600">⚠️ Cette date est après l'échéance du {fmtDate(item.deadline)}.</p>}
      <Field label="Intitulé *"><Input value={titre} onChange={(e) => setTitre(e.target.value)} required /></Field>
      <Field label="Notes" hint="Garage, centre de visite, assureur, personne à contacter…"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" disabled={busy} className="w-full">{busy ? '…' : 'Planifier'}</Button>
    </form>
  );
}

function LibreForm({ date, vehicles, onDone }: { date: string; vehicles: Vehicle[]; onDone: () => void }) {
  const [f, setF] = useState({ date, titre: '', vehicle_id: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error: err } = await supabase.from('planning').insert({
      date_prevue: f.date, titre: f.titre.trim(), type: 'autre', vehicle_id: f.vehicle_id || null, notes: f.notes.trim() || null,
    });
    if (err) setError(errorMessage(err));
    else onDone();
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date *"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
        <Field label="Véhicule">
          <Select value={f.vehicle_id} onChange={(e) => setF({ ...f, vehicle_id: e.target.value })}>
            <option value="">—</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Intitulé *"><Input value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} required placeholder="RDV centre de visite, passage garage…" /></Field>
      <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} /></Field>
      <ErrorBox>{error}</ErrorBox>
      <Button type="submit" className="w-full">Ajouter</Button>
    </form>
  );
}

function RdvDetail({ rdv, gerer, vehicle, echeance, onRenew, onDone }: {
  rdv: PlanningRow; gerer: boolean; vehicle?: Vehicle; echeance?: Echeance; onRenew: () => void; onDone: () => void;
}) {
  const [date, setDate] = useState(rdv.date_prevue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function update(patch: Partial<PlanningRow>) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('planning').update(patch).eq('id', rdv.id);
    setBusy(false);
    if (err) setError(errorMessage(err));
    else onDone();
  }

  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="text-lg font-semibold">{rdv.titre}</div>
        <div className="text-slate-500">{parse(rdv.date_prevue).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        {rdv.statut === 'fait' && <Badge tone="green">Fait le {fmtDate(rdv.fait_le)}</Badge>}
      </div>
      {vehicle && <p>Véhicule : <Link className="text-sky-700 underline" to={`/vehicules/${vehicle.id}`}>{vehicleLabel(vehicle)}</Link></p>}
      {echeance && <p>Papier : {DOCUMENT_TYPE_LABELS[echeance.type]} · expire le <b>{fmtDate(echeance.date_expiration)}</b></p>}
      {rdv.notes && <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3">{rdv.notes}</p>}
      {gerer && rdv.statut === 'planifie' && (
        <>
          <div className="flex flex-wrap gap-2">
            {rdv.document_id && <Button onClick={onRenew}>📄 Saisir le nouveau papier</Button>}
            {rdv.plan_id && vehicle && <Link to={`/vehicules/${vehicle.id}`}><Button>🛠 Enregistrer la maintenance</Button></Link>}
            <Button variant="secondary" disabled={busy} onClick={() => update({ statut: 'fait' })}>✓ Marquer fait</Button>
            <Button variant="ghost" disabled={busy} onClick={() => update({ statut: 'annule' })}>Annuler le rendez-vous</Button>
          </div>
          <div className="flex items-end gap-2">
            <Field label="Reporter au" className="flex-1"><Input type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Button variant="secondary" disabled={busy || date === rdv.date_prevue} onClick={() => update({ date_prevue: date })}>Reporter</Button>
          </div>
          {(rdv.document_id || rdv.plan_id) && <p className="text-xs text-slate-500">Le rendez-vous passe automatiquement à « fait » quand le nouveau papier ou la maintenance est enregistré.</p>}
        </>
      )}
      {gerer && rdv.statut === 'fait' && <Button variant="ghost" onClick={() => update({ statut: 'planifie' })}>Rouvrir</Button>}
      <ErrorBox>{error}</ErrorBox>
    </div>
  );
}

/** Export iCalendar (.ics) : rendez-vous planifiés + échéances, importable dans Google Agenda ou Outlook. */
function exportIcs(events: CalEvent[]) {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const from = addDays(todayIso(), -30);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Valorise Maroc//Fleet//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Fleet Valorise'];
  for (const e of events) {
    if (e.date < from || (e.kind === 'rdv' && e.rdv?.statut !== 'planifie')) continue;
    const d = e.date.replace(/-/g, '');
    const end = addDays(e.date, 1).replace(/-/g, '');
    const label = e.kind === 'echeance' ? `⏰ Expiration ${e.title}` : e.kind === 'maintenance' ? `🛠 ${e.title}` : `📅 ${e.title}`;
    lines.push('BEGIN:VEVENT', `UID:${e.key}@fleet-valorise`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${esc(label + (e.sub ? ' · ' + e.sub : ''))}`, ...(e.rdv?.notes ? [`DESCRIPTION:${esc(e.rdv.notes)}`] : []),
      ...(e.kind === 'rdv' ? ['BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:Rappel', 'END:VALARM'] : []), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'planning-flotte.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
