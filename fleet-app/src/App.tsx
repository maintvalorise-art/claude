import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import { useAuth } from './context/AuthContext';
import { supabaseConfigured } from './lib/supabase';
import Login from './pages/Login';
import DriverHome from './pages/driver/DriverHome';
import ControlSheetForm from './pages/driver/ControlSheetForm';
import MyRequests from './pages/driver/MyRequests';
import MySheets from './pages/driver/MySheets';
import Dashboard from './pages/staff/Dashboard';
import Vehicles from './pages/staff/Vehicles';
import VehicleDetail from './pages/staff/VehicleDetail';
import Deadlines from './pages/staff/Deadlines';
import Interventions from './pages/staff/Interventions';
import ControlSheets from './pages/staff/ControlSheets';
import ControlSheetDetail from './pages/ControlSheetDetail';
import Drivers from './pages/staff/Drivers';
import Settings from './pages/staff/Settings';

export default function App() {
  const { session, profile, loading, isStaff, isAdmin, signOut } = useAuth();

  if (!supabaseConfigured) {
    return (
      <div className="mx-auto max-w-lg p-8 text-sm">
        <h1 className="mb-2 text-xl font-bold">Configuration manquante</h1>
        <p>
          Copiez <code>.env.example</code> vers <code>.env</code> et renseignez <code>VITE_SUPABASE_URL</code> et{' '}
          <code>VITE_SUPABASE_ANON_KEY</code>, puis relancez l'application.
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

  return (
    <Routes>
      <Route element={<Layout />}>
        {isStaff ? (
          <>
            <Route index element={<Dashboard />} />
            <Route path="vehicules" element={<Vehicles />} />
            <Route path="vehicules/:id" element={<VehicleDetail />} />
            <Route path="echeances" element={<Deadlines />} />
            <Route path="interventions" element={<Interventions />} />
            <Route path="fiches" element={<ControlSheets />} />
            <Route path="chauffeurs" element={<Drivers />} />
            {isAdmin && <Route path="parametres" element={<Settings />} />}
          </>
        ) : (
          <>
            <Route index element={<DriverHome />} />
            <Route path="mes-demandes" element={<MyRequests />} />
            <Route path="mes-fiches" element={<MySheets />} />
          </>
        )}
        <Route path="ma-fiche" element={<ControlSheetForm />} />
        <Route path="fiches/:id" element={<ControlSheetDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
