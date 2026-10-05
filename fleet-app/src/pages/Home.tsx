import { Link } from 'react-router-dom';
import { Card, Empty, ErrorBox, Spinner, StatCard, StatusBadge } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { fmtDateTime } from '../lib/format';
import { ALERT_LEVEL, DA_OUVERTES, DA_STATUT, MODULE_LABELS, ROLE_LABELS, alerteTitre } from '../lib/labels';
import { can, canRequestPurchase } from '../lib/roles';
import { supabase } from '../lib/supabase';
import type { Alerte, DemandeAchat, Intervention, Vehicle } from '../lib/types';
import { must, useAsync } from '../lib/useAsync';

const ORDER = { expire: 0, urgent: 1, bientot: 2, ok: 3 } as const;

export default function Home() {
  const { profile } = useAuth();
  const p = profile!;
  const terrain = can(p, 'terrain');
  const demandeur = canRequestPurchase(p);

  const { data, loading, error } = useAsync(async () => {
    const [alertes, mesDa, mesInter, monVehicule, stats] = await Promise.all([
      supabase.from('v_alertes').select('*').then(must),
      demandeur
        ? supabase.from('demandes_achat').select('*').eq('demandeur_id', p.id).in('statut', DA_OUVERTES).order('created_at', { ascending: false }).limit(5).then(must)
        : Promise.resolve([]),
      terrain
        ? supabase.from('interventions').select('*').eq('demandeur_id', p.id).in('statut', ['nouvelle', 'en_cours']).order('created_at', { ascending: false }).limit(5).then(must)
        : Promise.resolve([]),
      supabase.from('vehicles').select('*').eq('chauffeur_id', p.id).eq('actif', true).then(must),
      loadStats(),
    ]);
    return {
      alertes: (alertes as Alerte[]).sort((a, b) => ORDER[a.niveau] - ORDER[b.niveau]),
      mesDa: mesDa as DemandeAchat[],
      mesInter: mesInter as Intervention[],
      monVehicule: monVehicule as Vehicle[],
      stats,
    };
  });

  async function loadStats() {
    const out: { label: string; value: string | number; tone: 'green' | 'red' | 'amber' | 'blue' | 'gray'; to: string }[] = [];
    if (can(p, 'achatsVoirTout')) {
      const { count } = await supabase.from('demandes_achat').select('id', { count: 'exact', head: true }).in('statut', DA_OUVERTES);
      out.push({ label: "Demandes d'achat ouvertes", value: count ?? 0, tone: 'blue', to: '/achats' });
    }
    if (can(p, 'magasinVoir')) {
      const { data: arts } = await supabase.from('articles').select('stock_actuel, stock_min').eq('actif', true);
      const sous = (arts ?? []).filter((a) => Number(a.stock_actuel) < Number(a.stock_min)).length;
      out.push({ label: 'Articles sous stock min', value: sous, tone: sous ? 'red' : 'green', to: '/magasin' });
    }
    if (can(p, 'flotteVoir')) {
      const { data: v } = await supabase.from('vehicles').select('statut').eq('actif', true);
      const total = (v ?? []).filter((x) => x.statut !== 'hors_service').length;
      const dispo = (v ?? []).filter((x) => x.statut === 'disponible' || x.statut === 'en_service').length;
      out.push({ label: 'Véhicules disponibles', value: `${dispo} / ${total}`, tone: dispo < total ? 'amber' : 'green', to: '/vehicules' });
    }
    if (can(p, 'bennesVoir')) {
      const { data: b } = await supabase.from('bennes').select('statut').eq('actif', true);
      const chez = (b ?? []).filter((x) => x.statut === 'chez_client').length;
      out.push({ label: 'Bennes chez les clients', value: `${chez} / ${(b ?? []).length}`, tone: 'blue', to: '/bennes' });
    }
    return out;
  }

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox>{error}</ErrorBox>;

  const tiles = [
    ...(terrain ? [
      { to: '/ma-fiche', icon: '📝', fr: 'Fiche de contrôle', ar: 'ورقة المراقبة', cls: 'bg-slate-900 text-white' },
      { to: '/mes-demandes', icon: '🔧', fr: "Demande d'intervention", ar: 'طلب تدخل', cls: 'bg-amber-500 text-slate-900' },
      { to: '/plein', icon: '⛽', fr: 'Plein gasoil', ar: 'تعبئة الوقود', cls: 'bg-sky-600 text-white' },
      { to: '/trajet', icon: '🛣', fr: 'Trajet', ar: 'رحلة', cls: 'bg-emerald-600 text-white' },
      ...(can(p, 'bennesMouvement') ? [{ to: '/bennes/mouvement', icon: '📦', fr: 'Scanner une benne', ar: 'مسح الحاوية', cls: 'bg-violet-600 text-white' }] : []),
      { to: '/accident', icon: '⚠️', fr: 'Déclarer un accident', ar: 'التصريح بحادثة', cls: 'bg-red-600 text-white' },
    ] : []),
    ...(demandeur ? [{ to: '/achats/nouvelle', icon: '🛒', fr: "Nouvelle demande d'achat", ar: 'طلب شراء جديد', cls: 'bg-white text-slate-900 border border-slate-200' }] : []),
  ];

  const byModule = data.alertes.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.module]: (acc[a.module] ?? 0) + 1 }), {});

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Bonjour {p.full_name} 👋</h1>
        <p className="text-sm text-slate-500">{ROLE_LABELS[p.role]} · {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      {tiles.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {tiles.map((t) => (
            <Link key={t.to} to={t.to} className={`rounded-2xl p-4 shadow-sm hover:opacity-90 ${t.cls}`}>
              <div className="text-2xl">{t.icon}</div>
              <div className="mt-1 font-bold">{t.fr}</div>
              <div className="ar text-sm opacity-80">{t.ar}</div>
            </Link>
          ))}
        </div>
      )}

      {data.stats.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {data.stats.map((s) => (
            <Link key={s.label} to={s.to}><StatCard label={s.label} value={s.value} tone={s.tone} /></Link>
          ))}
        </div>
      )}

      {data.monVehicule.length > 0 && (
        <Card title="Mon véhicule · شاحنتي">
          {data.monVehicule.map((v) => (
            <div key={v.id} className="flex flex-wrap justify-between gap-2 text-sm">
              <b>{v.code_interne ?? ''} {v.matricule}</b>
              <span>{v.marque} {v.modele}</span>
              <span>Compteur : {v.compteur_actuel.toLocaleString('fr-FR')} {v.unite_compteur}</span>
            </div>
          ))}
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title={<>🔔 Alertes {Object.entries(byModule).map(([m, n]) => <span key={m} className="ml-2 text-xs font-normal text-slate-500">{MODULE_LABELS[m as keyof typeof MODULE_LABELS]} {n}</span>)}</>}
          actions={p.role !== 'chauffeur' && <Link to="/alertes" className="text-sm text-sky-700 hover:underline">Tout voir</Link>}
        >
          {data.alertes.length === 0 ? <Empty>Rien à signaler 👍</Empty> : (
            <ul className="-my-2 divide-y divide-slate-100">
              {data.alertes.slice(0, 10).map((a) => (
                <li key={a.categorie + a.ref_id} className="py-2 text-sm">
                  <Link to={a.lien ?? '/'} className="flex items-center justify-between gap-2 hover:underline">
                    <span>
                      <b>{alerteTitre(a)}</b> {a.cible && <>· {a.cible}</>}
                      <span className="block text-xs text-slate-500">{MODULE_LABELS[a.module]} · {a.detail}</span>
                    </span>
                    <StatusBadge map={ALERT_LEVEL} value={a.niveau} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {data.mesDa.length > 0 && (
          <Card title="Mes demandes d'achat en cours" actions={<Link to="/achats" className="text-sm text-sky-700 hover:underline">Tout voir</Link>}>
            <ul className="-my-2 divide-y divide-slate-100">
              {data.mesDa.map((d) => (
                <li key={d.id} className="py-2 text-sm">
                  <Link to={`/achats/${d.id}`} className="flex items-center justify-between gap-2 hover:underline">
                    <span><b>{d.numero}</b> · {d.motif}<span className="block text-xs text-slate-500">{fmtDateTime(d.created_at)}</span></span>
                    <StatusBadge map={DA_STATUT} value={d.statut} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {data.mesInter.length > 0 && (
          <Card title="Mes demandes d'intervention" actions={<Link to="/mes-demandes" className="text-sm text-sky-700 hover:underline">Tout voir</Link>}>
            <ul className="-my-2 divide-y divide-slate-100">
              {data.mesInter.map((i) => (
                <li key={i.id} className="flex justify-between py-2 text-sm">
                  <span><b>{i.titre}</b><span className="block text-xs text-slate-500">N° {i.numero} · {fmtDateTime(i.created_at)}</span></span>
                  <span className="text-xs">{i.statut === 'nouvelle' ? 'Nouvelle' : 'En cours'}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
