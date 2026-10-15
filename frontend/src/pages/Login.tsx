import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { LIMITS } from '@asa/shared';
import { Button, ErrorNote, Img } from '../components/ui';

export function Login() {
  const { user, signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden bg-ink-900 lg:block">
        <Img k="app-hero" alt="A car workshop with mechanics and a booking calendar" className="absolute inset-0 size-full opacity-90" />
        <div className="absolute inset-0 bg-linear-to-t from-ink-900 via-ink-900/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-10 text-white">
          <h2 className="max-w-md text-3xl font-bold leading-tight">A bay and a qualified technician, confirmed before you book.</h2>
          <p className="mt-3 max-w-md text-ink-200">
            No more phone tag. Pick your vehicle, the service and a time, and see instantly what the dealership can serve.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5" aria-label="Sign in">
          <div className="flex items-center gap-3">
            <Img k="app-logo" alt="" className="size-12 rounded-xl" />
            <div>
              <h1 className="text-2xl font-bold leading-tight">Service Scheduler</h1>
              <p className="text-sm text-ink-500">Sign in to manage your service bookings</p>
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              maxLength={LIMITS.username}
              autoCapitalize="none"
              spellCheck={false}
              required
              className="w-full rounded-lg border-0 bg-white px-3 py-2.5 ring-1 ring-ink-200 focus:ring-2 focus:ring-brand-500"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              maxLength={LIMITS.password}
              pattern="\S+"
              onInvalid={(e) => {
                const el = e.currentTarget;
                el.setCustomValidity(el.validity.patternMismatch ? 'Password cannot contain spaces' : '');
              }}
              onInput={(e) => e.currentTarget.setCustomValidity('')}
              aria-describedby="password-hint"
              required
              className="w-full rounded-lg border-0 bg-white px-3 py-2.5 ring-1 ring-ink-200 focus:ring-2 focus:ring-brand-500"
            />
            <span id="password-hint" className="mt-1 block text-xs text-ink-500">
              Up to {LIMITS.password} characters, no spaces.
            </span>
          </label>

          {error && <ErrorNote>{error}</ErrorNote>}

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Signing in...' : 'Sign in'}
          </Button>
          <p className="text-xs text-ink-500">Usernames and passwords are case sensitive.</p>
        </form>
      </div>
    </div>
  );
}
