import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../lib/labels';
import { MODULES_ACTIFS, moduleOn } from '../lib/config';
import { can, canRequestPurchase, type Permission } from '../lib/roles';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';
import { cx } from './ui';

interface NavItem { to: string; label: string; icon: string; badge?: number }
interface NavSection { title: string; items: NavItem[] }

/** Menu construit selon les droits du profil connecté. */
function buildNav(p: Profile, alertes: number, hasTeam: boolean): NavSection[] {
  const has = (perm: Permission) => can(p, perm);
  const sections: NavSection[] = [
    { title: '', items: [
      { to: '/', label: 'Accueil', icon: '🏠' },
      ...(p.role !== 'chauffeur' ? [{ to: '/alertes', label: 'Alertes', icon: '🔔', badge: alertes }] : []),
    ] },
  ];
  if (has('terrain')) {
    sections.push({ title: 'Terrain · الميدان', items: [
      { to: '/ma-fiche', label: 'Fiche de contrôle', icon: '📝' },
      { to: '/mes-demandes', label: "Demande d'intervention", icon: '🔧' },
      { to: '/plein', label: 'Plein gasoil', icon: '⛽' },
      { to: '/trajet', label: 'Trajet', icon: '🛣' },
      ...(moduleOn('bennes') && has('bennesMouvement') ? [{ to: '/bennes/mouvement', label: 'Scanner une benne', icon: '📦' }] : []),
      { to: '/accident', label: 'Déclarer un accident', icon: '⚠️' },
      ...(p.role === 'chauffeur' ? [{ to: '/mes-fiches', label: 'Mes fiches', icon: '✅' }] : []),
    ] });
  }
  const achats: NavItem[] = [];
  if (moduleOn('achats') && (canRequestPurchase(p) || has('achatsVoirTout') || hasTeam)) achats.push({ to: '/achats', label: "Demandes d'achat", icon: '🛒' });
  if (moduleOn('achats') && has('fournisseursVoir')) achats.push({ to: '/fournisseurs', label: 'Fournisseurs & termes', icon: '🏢' });
  if (achats.length) sections.push({ title: 'Achats', items: achats });

  if (moduleOn('magasin') && has('magasinVoir')) {
    sections.push({ title: 'Magasin · Spare parts', items: [
      { to: '/magasin', label: 'Articles & stock', icon: '📦' },
      ...(has('magasinGerer') ? [{ to: '/magasin/mouvement', label: 'Entrée / sortie (scan)', icon: '🔁' }] : []),
      { to: '/magasin/mouvements', label: 'Historique mouvements', icon: '📜' },
      ...(has('magasinGerer') || p.role === 'direction' ? [{ to: '/magasin/inventaires', label: 'Inventaires', icon: '🧮' }] : []),
    ] });
  }
  if (moduleOn('flotte') && has('flotteVoir')) {
    sections.push({ title: 'Fleet management', items: [
      { to: '/vehicules', label: 'Véhicules & engins', icon: '🚚' },
      { to: '/planning', label: 'Planning (calendrier)', icon: '🗓' },
      { to: '/echeances', label: 'Papiers & échéances', icon: '📅' },
      { to: '/interventions', label: 'Maintenance en cours', icon: '🛠' },
      { to: '/historique-maintenance', label: 'Historique maintenance', icon: '📚' },
      { to: '/fiches', label: 'Fiches de contrôle', icon: '✅' },
      { to: '/accidents', label: 'Accidents', icon: '🚨' },
      { to: '/gasoil', label: 'Gasoil', icon: '⛽' },
      { to: '/trajets', label: 'Trajets', icon: '🛣' },
    ] });
  }
  if (moduleOn('bennes') && has('bennesVoir')) {
    sections.push({ title: 'Bennes', items: [
      { to: '/bennes', label: 'Parc de bennes', icon: '🗑' },
      { to: '/clients', label: 'Clients', icon: '🏭' },
      ...(has('bennesMouvement') && !has('terrain') ? [{ to: '/bennes/mouvement', label: 'Mouvement de benne', icon: '🔁' }] : []),
    ] });
  }
  const pilotage: NavItem[] = [];
  if (has('kpi')) pilotage.push({ to: '/kpi', label: 'Indicateurs (KPI)', icon: '📊' });
  if (has('admin')) {
    pilotage.push({ to: '/utilisateurs', label: 'Utilisateurs & accès', icon: '👤' });
    pilotage.push({ to: '/parametres', label: 'Paramètres', icon: '⚙' });
  }
  if (pilotage.length) sections.push({ title: 'Pilotage', items: pilotage });
  return sections;
}

export default function Layout() {
  const { profile, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [alertes, setAlertes] = useState(0);
  const [hasTeam, setHasTeam] = useState(false);
  const location = useLocation();

  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    Promise.all([
      supabase.from('v_alertes').select('ref_id', { count: 'exact', head: true }).in('niveau', ['expire', 'urgent']).in('module', [...MODULES_ACTIFS]),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('manager_id', profile.id),
    ]).then(([a, t]) => {
      if (cancelled) return;
      setAlertes(a.count ?? 0);
      setHasTeam((t.count ?? 0) > 0);
      notifyOnce(a.count ?? 0);
    });
    return () => {
      cancelled = true;
    };
  }, [profile, location.pathname]);

  if (!profile) return null;
  const nav = buildNav(profile, alertes, hasTeam);

  const sidebar: ReactNode = (
    <nav className="space-y-4">
      {nav.map((s, i) => (
        <div key={i}>
          {s.title && <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{s.title}</div>}
          <div className="flex flex-col gap-0.5">
            {s.items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/' || n.to === '/magasin' || n.to === '/bennes'}
                className={({ isActive }) =>
                  cx(
                    'flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium',
                    isActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
                  )
                }
              >
                <span className="w-5 text-center" aria-hidden>{n.icon}</span>
                <span className="flex-1">{n.label}</span>
                {!!n.badge && <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">{n.badge}</span>}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );

  const userBox = (
    <div className="border-t border-slate-800 pt-4">
      <div className="text-sm font-semibold text-white">{profile.full_name}</div>
      <div className="text-xs text-slate-400">{ROLE_LABELS[profile.role]}</div>
      <button type="button" onClick={signOut} className="mt-3 text-xs text-slate-300 underline hover:text-white">
        Se déconnecter · تسجيل الخروج
      </button>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-72 shrink-0 flex-col bg-slate-900 p-4 print:hidden lg:sticky lg:top-0 lg:flex lg:h-screen">
        <Brand />
        <div className="mt-6 flex-1 overflow-y-auto pr-1">{sidebar}</div>
        {userBox}
      </aside>

      <header className="sticky top-0 z-40 flex items-center justify-between bg-slate-900 px-4 py-3 print:hidden lg:hidden">
        <Brand />
        <button type="button" onClick={() => setMenuOpen((o) => !o)} className="relative rounded-lg px-3 py-1 text-xl text-white" aria-label="Menu">
          ☰
          {alertes > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-red-500" />}
        </button>
      </header>
      {menuOpen && (
        <div className="fixed inset-x-0 bottom-0 top-14 z-30 space-y-4 overflow-y-auto bg-slate-900 p-4 shadow-xl lg:hidden">
          {sidebar}
          {userBox}
        </div>
      )}

      <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6 sm:px-6 print:max-w-none print:p-0">
        <Outlet />
      </main>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 text-white">
      <img src="/favicon.svg" alt="" className="h-8 w-8" />
      <div className="leading-tight">
        <div className="font-bold">Valorise Maroc</div>
        <div className="text-xs text-slate-400">{moduleOn('achats') ? 'Achats · Magasin · Flotte · Bennes' : 'Fleet management'}</div>
      </div>
    </div>
  );
}

function notifyOnce(count: number) {
  if (count === 0 || !('Notification' in window)) return;
  try {
    if (sessionStorage.getItem('valorise-notified')) return;
    sessionStorage.setItem('valorise-notified', '1');
  } catch {
    return;
  }
  const show = () => new Notification('Valorise Maroc', { body: `${count} alerte(s) urgente(s) à traiter`, icon: '/favicon.svg' });
  if (Notification.permission === 'granted') show();
  else if (Notification.permission === 'default') void Notification.requestPermission().then((p) => p === 'granted' && show());
}
