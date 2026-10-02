import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { fetchControlItems, fetchDriverNames, fetchVehicles, groupByCategory } from '../../lib/data';
import { fmtNumber, todayIso } from '../../lib/format';
import { errorMessage, supabase } from '../../lib/supabase';
import { useAsync } from '../../lib/useAsync';

type Answer = { ok: boolean | null; commentaire: string };

export default function ControlSheetForm() {
  const { profile } = useAuth();
  const { data, loading, error } = useAsync(async () => {
    const [vehicles, items, drivers] = await Promise.all([fetchVehicles(), fetchControlItems(), fetchDriverNames()]);
    return { vehicles: vehicles.filter((v) => v.statut !== 'hors_service'), items, drivers };
  });

  const [vehicleId, setVehicleId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [compteur, setCompteur] = useState('');
  const [prochaineVidange, setProchaineVidange] = useState('');
  const [precedentId, setPrecedentId] = useState('');
  const [remarques, setRemarques] = useState('');
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; nok: number } | null>(null);

  const vehicle = data?.vehicles.find((v) => v.id === vehicleId);
  const unite = vehicle?.unite_compteur ?? 'km';

  // Véhicule attitré présélectionné.
  useEffect(() => {
    if (!data || vehicleId) return;
    const mine = data.vehicles.find((v) => v.chauffeur_id === profile?.id);
    if (mine) setVehicleId(mine.id);
  }, [data, profile?.id, vehicleId]);

  // Préremplissage à partir du véhicule choisi.
  useEffect(() => {
    if (!vehicle) return;
    setProchaineVidange(vehicle.prochaine_vidange ? String(vehicle.prochaine_vidange) : '');
    let cancelled = false;
    supabase.rpc('vehicle_last_driver', { p_vehicle_id: vehicle.id }).then(({ data: last }) => {
      if (!cancelled) setPrecedentId((last as string | null) ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [vehicle]);

  const groups = useMemo(() => groupByCategory(data?.items ?? []), [data]);
  const total = data?.items.length ?? 0;
  const answered = Object.values(answers).filter((a) => a.ok !== null).length;
  const nok = Object.values(answers).filter((a) => a.ok === false).length;

  function setAnswer(id: number, patch: Partial<Answer>) {
    setAnswers((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { ok: null, commentaire: '' }), ...patch } }));
  }

  function allOk() {
    if (!data) return;
    setAnswers((prev) => {
      const next = { ...prev };
      for (const it of data.items) if (next[it.id]?.ok == null) next[it.id] = { ok: true, commentaire: '' };
      return next;
    });
  }

  function reset() {
    setCompteur('');
    setRemarques('');
    setAnswers({});
    setDone(null);
    setFormError(null);
    setDate(todayIso());
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!data || !vehicle) return;
    setFormError(null);

    const km = Number(compteur);
    if (!Number.isFinite(km) || km < 0) return setFormError('Compteur de départ invalide.');
    if (km < vehicle.compteur_actuel) {
      return setFormError(`Le compteur ne peut pas être inférieur au dernier relevé (${fmtNumber(vehicle.compteur_actuel)} ${unite}).`);
    }
    const missing = data.items.filter((it) => answers[it.id]?.ok == null);
    if (missing.length) {
      document.getElementById(`item-${missing[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return setFormError(`${missing.length} point(s) non renseigné(s) · نقاط غير مملوءة`);
    }

    setBusy(true);
    try {
      const { data: id, error: err } = await supabase.rpc('submit_control_sheet', {
        p_vehicle_id: vehicle.id,
        p_date: date,
        p_compteur: km,
        p_prochaine_vidange: prochaineVidange ? Number(prochaineVidange) : null,
        p_conducteur_precedent_id: precedentId || null,
        p_remarques: remarques,
        p_results: data.items.map((it) => ({ item_id: it.id, ok: answers[it.id].ok, commentaire: answers[it.id].commentaire })),
      });
      if (err) throw err;
      setDone({ id: id as string, nok });
      window.scrollTo({ top: 0 });
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;

  if (done) {
    return (
      <div className="mx-auto max-w-lg">
        <Card>
          <div className="space-y-4 text-center">
            <div className="text-5xl">{done.nok ? '⚠️' : '✅'}</div>
            <h1 className="text-xl font-bold">Fiche enregistrée · تم حفظ الورقة</h1>
            {done.nok > 0 ? (
              <p className="text-sm text-slate-600">
                {done.nok} point(s) NOK signalé(s). Une demande d'intervention a été envoyée automatiquement au service maintenance.
                <span className="ar mt-1 block">تم إرسال طلب تدخل تلقائيًا إلى مصلحة الصيانة.</span>
              </p>
            ) : (
              <p className="text-sm text-slate-600">Tous les points sont OK. Bonne route ! · طريق السلامة</p>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              <Link to={`/fiches/${done.id}`}><Button variant="secondary">Voir la fiche</Button></Link>
              <Button onClick={reset}>Nouvelle fiche</Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-4 pb-28">
      <PageHeader
        title={<>Fiche de contrôle avant départ <span className="ar mt-1 block text-lg font-semibold text-slate-600">ورقة مراقبة الشاحنة قبل الإقلاع</span></>}
      />

      <Card title="Informations · معلومات">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={<>Chauffeur <span className="ar">· اسم السائق</span></>}>
            <Input value={profile?.full_name ?? ''} disabled />
          </Field>
          <Field label={<>Matricule du véhicule * <span className="ar">· رقم التسجيل</span></>}>
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
              <option value="">— Choisir —</option>
              {data.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.matricule} {v.marque ? `· ${v.marque}` : ''} {v.modele ?? ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={<>Date * <span className="ar">· التاريخ</span></>}>
            <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field
            label={<>{unite === 'heures' ? 'Heures moteur au départ' : 'Km de départ'} * <span className="ar">· كيلومتراج الانطلاق</span></>}
            hint={vehicle ? `Dernier relevé : ${fmtNumber(vehicle.compteur_actuel)} ${unite}` : undefined}
          >
            <Input type="number" inputMode="numeric" min={vehicle?.compteur_actuel ?? 0} value={compteur} onChange={(e) => setCompteur(e.target.value)} required />
          </Field>
          <Field label={<>Prochaine vidange ({unite}) <span className="ar">· كيلومتراج تغيير الزيت القادم</span></>}>
            <Input
              type="number"
              inputMode="numeric"
              value={prochaineVidange}
              onChange={(e) => setProchaineVidange(e.target.value)}
              disabled={!!vehicle?.prochaine_vidange}
            />
          </Field>
          <Field label={<>Conducteur précédent <span className="ar">· اسم السائق السابق</span></>}>
            <Select value={precedentId} onChange={(e) => setPrecedentId(e.target.value)}>
              <option value="">—</option>
              {[...data.drivers].map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Points de contrôle · نقاط المراقبة</h2>
        <Button variant="secondary" onClick={allOk}>Marquer le reste OK</Button>
      </div>

      {groups.map((g) => (
        <Card key={g.categorie} title={g.categorie}>
          <ul className="-my-2 divide-y divide-slate-100">
            {g.items.map((it) => {
              const a = answers[it.id];
              return (
                <li key={it.id} id={`item-${it.id}`} className="py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{it.label_fr}</div>
                      {it.label_ar && <div className="ar text-sm text-slate-500" dir="rtl">{it.label_ar}</div>}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => setAnswer(it.id, { ok: true })}
                        className={cx(
                          'w-16 rounded-lg border py-2 text-sm font-bold',
                          a?.ok === true ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-slate-600',
                        )}
                      >
                        OK
                      </button>
                      <button
                        type="button"
                        onClick={() => setAnswer(it.id, { ok: false })}
                        className={cx(
                          'w-16 rounded-lg border py-2 text-sm font-bold',
                          a?.ok === false ? 'border-red-600 bg-red-600 text-white' : 'border-slate-300 text-slate-600',
                        )}
                      >
                        NOK
                      </button>
                    </div>
                  </div>
                  {a?.ok === false && (
                    <Input
                      className="mt-2"
                      placeholder="Décrire le problème · وصف المشكل"
                      value={a.commentaire}
                      onChange={(e) => setAnswer(it.id, { commentaire: e.target.value })}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}

      <Card title="Remarques · ملاحظات">
        <Textarea value={remarques} onChange={(e) => setRemarques(e.target.value)} />
      </Card>

      <ErrorBox>{formError}</ErrorBox>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:left-72">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-semibold">{answered}/{total}</span> renseignés
            {nok > 0 && <span className="ml-2 font-semibold text-red-600">· {nok} NOK</span>}
          </div>
          <Button type="submit" disabled={busy || !vehicle} className="px-6 py-3">
            {busy ? 'Envoi…' : 'Valider · إرسال'}
          </Button>
        </div>
      </div>
    </form>
  );
}
