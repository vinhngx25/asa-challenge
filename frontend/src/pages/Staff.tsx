import { useMemo, useState } from 'react';
import type { AppointmentStatus } from '@asa/shared';
import { AppointmentCard } from '../components/AppointmentCard';
import { Card, EmptyState, ErrorNote, Img, Spinner } from '../components/ui';
import { phaseOf } from '../lib/format';
import { useAppointments, useCatalog } from '../queries';

const selectClass = 'rounded-lg border-0 bg-white px-3 py-2 text-sm ring-1 ring-ink-200';

export function Staff() {
  const catalog = useCatalog();
  const [dealershipId, setDealershipId] = useState('');
  const [status, setStatus] = useState<AppointmentStatus | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');

  // Date inputs are calendar days; widen to whole days in UTC for the API range.
  const filters = useMemo(
    () => ({
      ...(dealershipId ? { dealershipId } : {}),
      ...(status ? { status } : {}),
      ...(from ? { from: `${from}T00:00:00.000Z` } : {}),
      ...(to ? { to: `${to}T23:59:59.999Z` } : {}),
    }),
    [dealershipId, status, from, to],
  );
  const { data, isLoading, error } = useAppointments(filters);
  const all = useAppointments();

  // Upcoming first (soonest on top), then everything else, most recent first.
  const ordered = useMemo(() => {
    const rows = data ?? [];
    const upcoming = rows.filter((a) => phaseOf(a) === 'upcoming');
    const rest = rows.filter((a) => phaseOf(a) !== 'upcoming').reverse();
    const all = [...upcoming, ...rest];
    // Free-text search on what a caller usually quotes: reference, name, plate, car, service or technician.
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return all;
    return all.filter((a) => {
      const hay = [a.reference, a.customerName, a.customer, a.vehiclePlate, a.vehicleLabel, a.serviceName, a.technicianName, a.dealershipName]
        .join(' ')
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [data, query]);

  const stats = useMemo(() => {
    const rows = all.data ?? [];
    const upcoming = rows.filter((a) => phaseOf(a) === 'upcoming').length;
    return {
      total: rows.length,
      upcoming,
      completed: rows.filter((a) => phaseOf(a) === 'past').length,
      cancelled: rows.filter((a) => a.status === 'CANCELLED').length,
    };
  }, [all.data]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">All bookings</h1>
        <p className="text-ink-500">Every appointment across all dealerships.</p>
      </header>

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total" value={stats.total} />
        <Stat label="Upcoming" value={stats.upcoming} accent />
        <Stat label="Completed" value={stats.completed} />
        <Stat label="Cancelled" value={stats.cancelled} />
      </section>

      <section aria-label="Dealerships" className="grid gap-3 sm:grid-cols-3">
        {catalog.data?.dealerships.map((d) => {
          const rows = (all.data ?? []).filter((a) => a.dealershipId === d.id && phaseOf(a) === 'upcoming');
          return (
            <button
              key={d.id}
              onClick={() => setDealershipId(dealershipId === d.id ? '' : d.id)}
              aria-pressed={dealershipId === d.id}
              className={`flex items-center gap-3 overflow-hidden rounded-2xl bg-white p-3 text-left ring-1 ${
                dealershipId === d.id ? 'ring-2 ring-brand-500' : 'ring-ink-100 hover:shadow-md'
              }`}
            >
              <Img k={d.imageKey} alt="" className="size-16 shrink-0 rounded-xl" />
              <div className="min-w-0">
                <div className="truncate font-semibold">{d.name}</div>
                <div className="text-sm text-ink-500">
                  {d.bays.length} bay{d.bays.length > 1 ? 's' : ''} · {d.technicians.length} technicians
                </div>
                <div className="text-sm font-semibold text-brand-700">{rows.length} upcoming</div>
              </div>
            </button>
          );
        })}
      </section>

      <Card className="flex flex-wrap items-end gap-4">
        <label className="min-w-56 flex-1 text-sm font-semibold">
          <span className="mb-1 block">Search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Reference, customer, plate, car, service or technician"
            className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm font-normal ring-1 ring-ink-200"
          />
        </label>
        <label className="text-sm font-semibold">
          <span className="mb-1 block">Dealership</span>
          <select className={selectClass} value={dealershipId} onChange={(e) => setDealershipId(e.target.value)}>
            <option value="">All dealerships</option>
            {catalog.data?.dealerships.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          <span className="mb-1 block">Status</span>
          <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as AppointmentStatus | '')}>
            <option value="">Any</option>
            <option value="BOOKED">Booked</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </label>
        <label className="text-sm font-semibold">
          <span className="mb-1 block">From</span>
          <input type="date" className={selectClass} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm font-semibold">
          <span className="mb-1 block">To</span>
          <input type="date" className={selectClass} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(dealershipId || status || from || to || query) && (
          <button
            className="pb-2 text-sm font-semibold text-brand-700 underline"
            onClick={() => {
              setDealershipId('');
              setStatus('');
              setFrom('');
              setTo('');
              setQuery('');
            }}
          >
            Clear filters
          </button>
        )}
      </Card>

      {isLoading && <Spinner label="Loading bookings" />}
      {error && <ErrorNote>Could not load bookings. Please refresh.</ErrorNote>}
      {data && ordered.length === 0 && <EmptyState title="No bookings match" text="Try changing or clearing the filters and the search." />}

      {query && ordered.length > 0 && (
        <p className="text-sm text-ink-500" role="status">
          {ordered.length} of {data?.length ?? 0} bookings match "{query}"
        </p>
      )}

      <div className="space-y-4">
        {ordered.map((a) => (
          <AppointmentCard key={a.id} appt={a} showCustomer />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 ring-1 ${accent ? 'bg-brand-50 ring-brand-100' : 'bg-white ring-ink-100'}`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm text-ink-500">{label}</div>
    </div>
  );
}
