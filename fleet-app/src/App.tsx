import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import { useAuth } from './context/AuthContext';
import { moduleOn } from './lib/config';
import { can, type Permission } from './lib/roles';
import type { Module } from './lib/types';
import { supabaseConfigured } from './lib/supabase';
import Login from './pages/Login';
import Home from './pages/Home';
import Alertes from './pages/Alertes';
import Kpi from './pages/Kpi';
import ControlSheetDetail from './pages/ControlSheetDetail';
import ControlSheetForm from './pages/terrain/ControlSheetForm';
import MyRequests from './pages/terrain/MyRequests';
import MySheets from './pages/terrain/MySheets';
import PleinForm from './pages/terrain/PleinForm';
import TrajetForm from './pages/terrain/TrajetForm';
import AccidentForm from './pages/terrain/AccidentForm';
import DemandesList from './pages/achats/DemandesList';
import DemandeNew from './pages/achats/DemandeNew';
import DemandeDetail from './pages/achats/DemandeDetail';
import Fournisseurs from './pages/achats/Fournisseurs';
import FournisseurDetail from './pages/achats/FournisseurDetail';
import Articles from './pages/magasin/Articles';
import ArticleDetail from './pages/magasin/ArticleDetail';
import MouvementForm from './pages/magasin/MouvementForm';
import Mouvements from './pages/magasin/Mouvements';
import Inventaires from './pages/magasin/Inventaires';
import InventaireDetail from './pages/magasin/InventaireDetail';
import Vehicles from './pages/flotte/Vehicles';
import VehicleDetail from './pages/flotte/VehicleDetail';
import Deadlines from './pages/flotte/Deadlines';
import Interventions from './pages/flotte/Interventions';
import ControlSheets from './pages/flotte/ControlSheets';
import Accidents from './pages/flotte/Accidents';
import AccidentDetail from './pages/flotte/AccidentDetail';
import Gasoil from './pages/flotte/Gasoil';
import Trajets from './pages/flotte/Trajets';
import Bennes from './pages/bennes/Bennes';
import BenneDetail from './pages/bennes/BenneDetail';
import Clients from './pages/bennes/Clients';
import BenneMouvement from './pages/bennes/BenneMouvement';
import Planning from './pages/flotte/Planning';
import HistoriqueMaintenance from './pages/flotte/HistoriqueMaintenance';
import Users from './pages/admin/Users';
import Settings from './pages/admin/Settings';

export default function App() {
  const { session, profile, loading, signOut } = useAuth();

  if (!supabaseConfigured) {
    return (
      <div className="mx-auto max-w-lg p-8 text-sm">
        <h1 className="mb-2 text-xl font-bold">Configuration manquante</h1>
        <p>
          Renseignez <code>VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_ANON_KEY</code> (fichier <code>.env</code> en local,
          ou « Environment Variables » sur Vercel), puis relancez / redéployez l'application.
        </p>
      </div>
    );
  }

  if (loading) return <Spinner />;
  if (!session) return <Login />;
  if (!profile || !profile.active) {
    return (
      <div className="mx-auto max-w-md p-8 text-center text-sm">
        <p className="mb-4">Votre compte est désactivé ou incomplet. Contactez l'administrateur.</p>
        <button type="button" className="underline" onClick={signOut}>Se déconnecter</button>
      </div>
    );
  }

  const guard = (perm: Permission, el: ReactNode) => (can(profile, perm) ? el : <Navigate to="/" replace />);
  // Module désactivé : ses pages renvoient à l'accueil.
  const mod = (m: Module, el: ReactNode) => (moduleOn(m) ? el : <Navigate to="/" replace />);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="alertes" element={<Alertes />} />
        <Route path="kpi" element={guard('kpi', <Kpi />)} />

        {/* Terrain */}
        <Route path="ma-fiche" element={<ControlSheetForm />} />
        <Route path="mes-demandes" element={<MyRequests />} />
        <Route path="mes-fiches" element={<MySheets />} />
        <Route path="plein" element={<PleinForm />} />
        <Route path="trajet" element={<TrajetForm />} />
        <Route path="accident" element={<AccidentForm />} />
        <Route path="fiches/:id" element={<ControlSheetDetail />} />

        {/* Achats (les droits fins sont appliqués par la base) */}
        <Route path="achats" element={mod('achats', <DemandesList />)} />
        <Route path="achats/nouvelle" element={mod('achats', <DemandeNew />)} />
        <Route path="achats/:id" element={mod('achats', <DemandeDetail />)} />
        <Route path="fournisseurs" element={mod('achats', guard('fournisseursVoir', <Fournisseurs />))} />
        <Route path="fournisseurs/:id" element={mod('achats', guard('fournisseursVoir', <FournisseurDetail />))} />

        {/* Magasin */}
        <Route path="magasin" element={mod('magasin', guard('magasinVoir', <Articles />))} />
        <Route path="magasin/mouvement" element={mod('magasin', guard('magasinGerer', <MouvementForm />))} />
        <Route path="magasin/mouvements" element={mod('magasin', guard('magasinVoir', <Mouvements />))} />
        <Route path="magasin/inventaires" element={mod('magasin', guard('magasinVoir', <Inventaires />))} />
        <Route path="magasin/inventaires/:id" element={mod('magasin', guard('magasinVoir', <InventaireDetail />))} />
        <Route path="magasin/:id" element={mod('magasin', guard('magasinVoir', <ArticleDetail />))} />

        {/* Flotte */}
        <Route path="vehicules" element={guard('flotteVoir', <Vehicles />)} />
        <Route path="vehicules/:id" element={guard('flotteVoir', <VehicleDetail />)} />
        <Route path="echeances" element={guard('flotteVoir', <Deadlines />)} />
        <Route path="planning" element={guard('flotteVoir', <Planning />)} />
        <Route path="historique-maintenance" element={guard('flotteVoir', <HistoriqueMaintenance />)} />
        <Route path="interventions" element={guard('flotteVoir', <Interventions />)} />
        <Route path="fiches" element={guard('flotteVoir', <ControlSheets />)} />
        <Route path="accidents" element={<Accidents />} />
        <Route path="accidents/:id" element={<AccidentDetail />} />
        <Route path="gasoil" element={guard('flotteVoir', <Gasoil />)} />
        <Route path="trajets" element={<Trajets />} />

        {/* Bennes */}
        <Route path="bennes" element={mod('bennes', guard('bennesVoir', <Bennes />))} />
        <Route path="bennes/mouvement" element={mod('bennes', guard('bennesMouvement', <BenneMouvement />))} />
        <Route path="bennes/:id" element={mod('bennes', guard('bennesVoir', <BenneDetail />))} />
        <Route path="clients" element={mod('bennes', guard('bennesVoir', <Clients />))} />

        {/* Administration */}
        <Route path="utilisateurs" element={guard('admin', <Users />)} />
        <Route path="parametres" element={guard('admin', <Settings />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
