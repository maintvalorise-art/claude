import { useState, type FormEvent } from 'react';
import { Button, ErrorBox, Field, Input } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../lib/supabase';

export default function Login() {
  const { signIn } = useAuth();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(login, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-10 w-10" />
          <div>
            <h1 className="text-lg font-bold">Gestion de flotte</h1>
            <p className="text-xs text-slate-500">Camions, engins & fiches de contrôle</p>
          </div>
        </div>
        <Field label={<>Identifiant <span className="ar text-slate-500">· اسم المستخدم</span></>}>
          <Input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        </Field>
        <Field label={<>Mot de passe <span className="ar text-slate-500">· كلمة السر</span></>}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <ErrorBox>{error}</ErrorBox>
        <Button type="submit" disabled={busy} className="w-full py-3">
          {busy ? 'Connexion…' : 'Se connecter · دخول'}
        </Button>
      </form>
    </div>
  );
}
