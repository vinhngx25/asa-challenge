import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth';
import { Avatar, Badge, Img } from './ui';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
    isActive ? 'bg-white/15 text-white' : 'text-ink-200 hover:bg-white/10 hover:text-white'
  }`;

export function Layout() {
  const { user, signOut } = useAuth();
  if (!user) return null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-ink-900 text-white shadow-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-3">
            <Img k="app-logo" alt="" className="size-9 rounded-lg" />
            <span className="text-base font-bold tracking-tight">Service Scheduler</span>
          </NavLink>

          <nav aria-label="Main" className="flex items-center gap-1">
            <NavLink to="/" end className={navClass}>
              {user.role === 'staff' ? 'All bookings' : 'My bookings'}
            </NavLink>
            {user.role === 'customer' && (
              <NavLink to="/book" className={navClass}>
                Book a service
              </NavLink>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Avatar k={user.imageKey} name={user.displayName} size={36} />
              <div className="hidden leading-tight sm:block">
                <div className="text-sm font-semibold">{user.displayName}</div>
                <div className="text-xs text-ink-300">{user.role === 'staff' ? 'Staff' : 'Customer'}</div>
              </div>
              {user.role === 'staff' && (
                <span className="sm:hidden">
                  <Badge tone="upcoming">Staff</Badge>
                </span>
              )}
            </div>
            <button
              onClick={signOut}
              className="min-h-10 rounded-lg px-3 py-2 text-sm font-semibold text-ink-100 ring-1 ring-white/25 transition-colors hover:bg-white/10"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
