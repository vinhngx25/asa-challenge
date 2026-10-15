import { useState } from 'react';
import { Link } from 'react-router';
import { AppointmentCard } from '../components/AppointmentCard';
import { Avatar, Button, EmptyState, ErrorNote, Spinner } from '../components/ui';
import { useAuth } from '../auth';
import { phaseOf, type Phase } from '../lib/format';
import { useAppointments } from '../queries';

const tabs: { id: Phase; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

export function Dashboard() {
  const { user } = useAuth();
  const { data, isLoading, error } = useAppointments();
  const [tab, setTab] = useState<Phase>('upcoming');

  if (!user) return null;
  const groups: Record<Phase, NonNullable<typeof data>> = { upcoming: [], past: [], cancelled: [] };
  for (const a of data ?? []) groups[phaseOf(a)].push(a);
  // Next appointment first; most recent history first.
  groups.past.reverse();
  groups.cancelled.reverse();
  const shown = groups[tab];

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-ink-900 p-5 text-white sm:p-6">
        <div className="flex items-center gap-4">
          <Avatar k={user.imageKey} name={user.displayName} size={64} />
          <div>
            <p className="text-sm text-ink-300">Welcome back</p>
            <h1 className="text-2xl font-bold leading-tight">{user.displayName}</h1>
            <p className="text-sm text-ink-200">
              {groups.upcoming.length} upcoming · {groups.past.length} completed
            </p>
          </div>
        </div>
        <Link
          to="/book"
          className="inline-flex min-h-11 items-center rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-bold text-ink-900 hover:bg-brand-400"
        >
          Book a service
        </Link>
      </section>

      <div role="tablist" aria-label="Booking status" className="inline-flex rounded-xl bg-ink-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.id ? 'bg-white shadow-sm' : 'text-ink-500 hover:text-ink-800'
            }`}
          >
            {t.label} <span className="ml-1 text-ink-500">{groups[t.id].length}</span>
          </button>
        ))}
      </div>

      {isLoading && <Spinner label="Loading your bookings" />}
      {error && <ErrorNote>Could not load your bookings. Please refresh.</ErrorNote>}

      {!isLoading && !error && shown.length === 0 && (
        <EmptyState
          title={tab === 'upcoming' ? 'Nothing booked yet' : `No ${tab} bookings`}
          text={
            tab === 'upcoming'
              ? 'Book a service and we will confirm a bay and technician straight away.'
              : 'They will appear here.'
          }
          action={
            tab === 'upcoming' ? (
              <Link to="/book">
                <Button>Book a service</Button>
              </Link>
            ) : undefined
          }
        />
      )}

      <div className="space-y-4">
        {shown.map((a) => (
          <AppointmentCard key={a.id} appt={a} />
        ))}
      </div>
    </div>
  );
}
