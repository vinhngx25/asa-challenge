import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { LIMITS } from '@asa/shared';
import { Button, ErrorNote, Img } from '../components/ui';

const inputClass =
  'w-full rounded-lg border-0 bg-white px-3 py-2.5 ring-1 ring-ink-200 focus:ring-2 focus:ring-brand-500';

export function Login() {
  const { user, signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  const from = (useLocation().state as { from?: string } | null)?.from;
  // Only same-site paths are honoured, never an address given from outside.
  const target = from && /^\/(?!\/)/.test(from) && !from.startsWith('/login') ? from : '/';
  if (user) return <Navigate to={target} replace />;

  const hasWhiteSpace = /\s/.test(password);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await signIn(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden bg-teal-50 lg:block">
        <Img k="app-hero" alt="A bright modern car workshop with mechanics and a booking calendar" className="absolute inset-0 size-full" />
        <div className="absolute inset-x-8 bottom-8 max-w-lg rounded-2xl bg-white/90 p-6 text-ink-900 shadow-lg ring-1 ring-white backdrop-blur">
          <h2 className="text-2xl font-bold leading-tight">A bay and a qualified technician, confirmed before you book.</h2>
          <p className="mt-2 text-ink-700">
            No more phone tag. Pick your vehicle, the service and a time, and see instantly what the dealership can serve.
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center lg:justify-center">
        {/* Phones and tablets get their own portrait picture as a banner; wide screens use the large picture on the left. */}
        <div className="relative h-52 w-full overflow-hidden sm:h-64 lg:hidden">
          <Img k="app-hero-mobile" alt="A friendly mechanic in a bright modern workshop" className="size-full object-[50%_30%]" />
        </div>
        <div className="w-full max-w-sm space-y-6 px-6 py-8 lg:py-10">
          <form onSubmit={submit} className="space-y-5" aria-label="Sign in">
            <div className="flex items-center gap-3">
              <Img k="app-logo" alt="" className="size-12 rounded-xl" />
              <div>
                <h1 className="text-2xl font-bold leading-tight">Service Scheduler</h1>
                <p className="text-sm text-ink-500">Sign in to manage your service bookings</p>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <label htmlFor="username" className="text-sm font-semibold">
                  Username
                </label>
                <span className="text-xs text-ink-500" aria-hidden="true">
                  {username.length} / {LIMITS.username}
                </span>
              </div>
              <input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                maxLength={LIMITS.username}
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby="username-hint"
                required
                className={inputClass}
              />
              <p id="username-hint" className="mt-1 text-xs text-ink-500">
                Up to {LIMITS.username} characters. Case sensitive.
              </p>
            </div>

            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <label htmlFor="password" className="text-sm font-semibold">
                  Password
                </label>
                <span className="text-xs text-ink-500" aria-hidden="true">
                  {password.length} / {LIMITS.password}
                </span>
              </div>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
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
                aria-invalid={hasWhiteSpace}
                required
                className={inputClass}
              />
              <p id="password-hint" className="mt-1 text-xs text-ink-500">
                Up to {LIMITS.password} characters, no spaces. Case sensitive.
              </p>
              {hasWhiteSpace && (
                <p role="status" className="mt-1 text-xs font-semibold text-bad-600">
                  Passwords cannot contain spaces. Remove the space to continue.
                </p>
              )}
              <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-sm text-ink-700">
                <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} className="size-4 accent-brand-600" />
                Show password
              </label>
            </div>

            {error && <ErrorNote>{error}</ErrorNote>}

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <section aria-labelledby="signin-help" className="rounded-xl bg-white p-4 text-sm text-ink-700 ring-1 ring-ink-100">
            <h2 id="signin-help" className="mb-2 font-semibold text-ink-900">
              Sign-in help
            </h2>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Customers and staff sign in on this page. Customers go to My bookings, staff to All bookings.</li>
              <li>You stay signed in for 8 hours. On a shared computer, use Sign out when you finish.</li>
              <li>This is a demo: accounts are fixed and cannot be created, changed or reset here. The demo accounts are listed in the project README.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
