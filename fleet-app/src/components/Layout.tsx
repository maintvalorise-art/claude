import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../lib/labels';
import { supabase } from '../lib/supabase';
import { cx } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  badge?: number;
}

export default function Layout() {
  const { profile, isStaff, isAdmin, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [counts, setCounts] = useState({ alertes: 0, demandes: 0 });
  const location = useLocation();

  useEffect(() => setMenuOpen(false), [location.pathname]);

  // Compteurs pour les badges du menu (échéances à traiter, demandes ouvertes).
  useEffect(() => {
    if (!isStaff) return;
    let cancelled = false;
    Promise.all([
      supabase.from('v_echeances').select('id', { count: 'exact', head: true }).in('niveau', ['expire', 'urgent', 'bientot']),
      supabase.from('interventions').select('id', { count: 'exact', head: true }).in('statut', ['nouvelle', 'en_cours']),
    ]).then(([a, d]) => {
      if (cancelled) return;
      const alertes = a.count ?? 0;
      setCounts({ alertes, demandes: d.count ?? 0 });
      notifyOnce(alertes);
    });
    return () => {
      cancelled = true;
    };
  }, [isStaff, location.pathname]);

  const nav: NavItem[] = isStaff
    ? [
        { to: '/', label: 'Tableau de bord', icon: '▦' },
        { to: '/vehicules', label: 'Parc (camions & engins)', icon: '🚚' },
        { to: '/echeances', label: 'Papiers & échéances', icon: '📅', badge: counts.alertes },
        { to: '/interventions', label: "Demandes d'intervention", icon: '🔧', badge: counts.demandes },
        { to: '/fiches', label: 'Fiches de contrôle', icon: '✅' },
        { to: '/chauffeurs', label: 'Chauffeurs & comptes', icon: '👤' },
        ...(isAdmin ? [{ to: '/parametres', label: 'Paramètres', icon: '⚙' }] : []),
        { to: '/ma-fiche', label: 'Remplir une fiche', icon: '📝' },
      ]
    : [
        { to: '/', label: 'Accueil · الرئيسية', icon: '🏠' },
        { to: '/ma-fiche', label: 'Fiche de contrôle · ورقة المراقبة', icon: '📝' },
        { to: '/mes-demandes', label: 'Mes demandes · طلباتي', icon: '🔧' },
        { to: '/mes-fiches', label: 'Mes fiches · أوراقي', icon: '✅' },
      ];

  const sidebar = (
    <nav className="flex flex-col gap-1">
      {nav.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/'}
          className={({ isActive }) =>
            cx(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
              isActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
            )
          }
        >
          <span className="w-5 text-center" aria-hidden>{n.icon}</span>
          <span className="flex-1">{n.label}</span>
          {!!n.badge && <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">{n.badge}</span>}
        </NavLink>
      ))}
    </nav>
  );

  const userBox = (
    <div className="border-t border-slate-800 pt-4">
      <div className="text-sm font-semibold text-white">{profile?.full_name}</div>
      <div className="text-xs text-slate-400">{profile ? ROLE_LABELS[profile.role] : ''}</div>
      <button type="button" onClick={signOut} className="mt-3 text-xs text-slate-300 underline hover:text-white">
        Se déconnecter · تسجيل الخروج
      </button>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Barre latérale (desktop) */}
      <aside className="hidden w-72 shrink-0 flex-col justify-between bg-slate-900 p-4 lg:flex lg:sticky lg:top-0 lg:h-screen">
        <div>
          <Brand />
          <div className="mt-6">{sidebar}</div>
        </div>
        {userBox}
      </aside>

      {/* Barre supérieure (mobile) */}
      <header className="sticky top-0 z-40 flex items-center justify-between bg-slate-900 px-4 py-3 lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="relative rounded-lg px-3 py-1 text-xl text-white"
          aria-label="Menu"
        >
          ☰
          {isStaff && counts.alertes > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-red-500" />}
        </button>
      </header>
      {menuOpen && (
        <div className="fixed inset-x-0 top-14 z-30 space-y-4 bg-slate-900 p-4 shadow-xl lg:hidden">
          {sidebar}
          {userBox}
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
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
        <div className="font-bold">Gestion de flotte</div>
        <div className="text-xs text-slate-400">Camions & engins</div>
      </div>
    </div>
  );
}

/** Notification navigateur une fois par session si des échéances sont à traiter. */
function notifyOnce(count: number) {
  if (count === 0 || !('Notification' in window)) return;
  try {
    if (sessionStorage.getItem('flotte-notified')) return;
    sessionStorage.setItem('flotte-notified', '1');
  } catch {
    return;
  }
  const show = () => new Notification('Gestion de flotte', { body: `${count} échéance(s) à traiter (papiers, vidanges…)`, icon: '/favicon.svg' });
  if (Notification.permission === 'granted') show();
  else if (Notification.permission === 'default') void Notification.requestPermission().then((p) => p === 'granted' && show());
}
