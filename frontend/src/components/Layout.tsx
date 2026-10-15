import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth';
import { Avatar, Img } from './ui';

// Phones: equal-width pills on their own row. Wider screens: pills inline in the bar.
const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-10 items-center justify-center rounded-lg px-3 text-sm font-semibold transition-colors ${
    isActive ? 'bg-teal-50 text-teal-800 ring-1 ring-teal-200' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
  }`;

export function Layout() {
  const { user, signOut } = useAuth();
  if (!user) return null;
  const role = user.role === 'staff' ? 'Staff' : 'Customer';

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-ink-100 bg-white/95 text-ink-900 shadow-sm backdrop-blur">
        {/* Phone: row 1 = logo left, user and Sign out right (one centre line); row 2 = menu across the full width.
            sm and up: one row = logo, menu, user. */}
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:flex sm:gap-x-6 sm:py-3">
          <NavLink to="/" className="flex min-w-0 items-center gap-2.5 sm:order-1">
            <Img k="app-logo" alt="" className="size-9 shrink-0 rounded-lg" />
            <span className="truncate text-[13px] font-bold tracking-tight min-[360px]:text-[15px] sm:text-base">Service Scheduler</span>
          </NavLink>

          <div className="flex items-center gap-2 sm:order-3 sm:ml-auto sm:gap-3">
            <div className="flex items-center gap-2" title={`${user.displayName} (${role})`}>
              <Avatar k={user.imageKey} name={user.displayName} size={36} />
              <div className="hidden leading-tight sm:block">
                <div className="text-sm font-semibold">{user.displayName}</div>
                <div className="text-xs text-ink-500">{role}</div>
              </div>
            </div>
            <button
              onClick={() => signOut(true)}
              className="min-h-10 rounded-lg bg-white px-3 text-sm font-semibold text-ink-700 ring-1 ring-ink-200 transition-colors hover:bg-ink-50"
            >
              Sign out
            </button>
          </div>

          <nav
            aria-label="Main"
            className="col-span-2 grid auto-cols-fr grid-flow-col gap-1.5 sm:order-2 sm:col-auto sm:flex sm:gap-1"
          >
            <NavLink to="/" end className={navClass}>
              {user.role === 'staff' ? 'All bookings' : 'My bookings'}
            </NavLink>
            {user.role === 'customer' && (
              <NavLink to="/book" className={navClass}>
                Book a service
              </NavLink>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
