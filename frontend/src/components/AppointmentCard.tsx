import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { appointmentPhase, type AppointmentDto } from '@asa/shared';
import { ApiError, api } from '../api';
import { fmtDate, fmtDuration, fmtTime } from '../lib/format';
import { useCatalog } from '../queries';
import { Avatar, Badge, Button, ErrorNote, Img } from './ui';

const phaseBadge = {
  upcoming: { tone: 'upcoming', label: 'Upcoming' },
  'in-progress': { tone: 'ok', label: 'In progress' },
  past: { tone: 'past', label: 'Completed' },
  cancelled: { tone: 'cancelled', label: 'Cancelled' },
} as const;

export function AppointmentCard({ appt, showCustomer = false }: { appt: AppointmentDto; showCustomer?: boolean }) {
  const catalog = useCatalog();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const inFlight = useRef(false);

  const tz = catalog.data?.dealerships.find((d) => d.id === appt.dealershipId)?.timezone ?? 'Europe/London';
  const phase = appointmentPhase(appt);
  const badge = phaseBadge[phase];
  const canCancel = phase === 'upcoming';

  const cancel = useMutation({
    mutationFn: () => api.cancel(appt.id),
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: () => {
      setConfirming(false);
      return queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
  });

  return (
    <article
      aria-label={`${appt.serviceName}, ${fmtDate(appt.startTime, tz)}`}
      className={`overflow-hidden rounded-2xl shadow-sm ring-1 ring-ink-100 ${phase === 'cancelled' ? 'bg-ink-50' : 'bg-white'}`}
    >
      <div className="flex flex-col sm:flex-row">
        <Img
          k={appt.vehicleImageKey}
          alt={appt.vehicleLabel}
          className={`h-40 w-full sm:h-auto sm:w-52 ${phase === 'cancelled' ? 'grayscale' : ''}`}
        />
        <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-lg font-bold leading-tight">{appt.serviceName}</h3>
              <p className="text-sm text-ink-500">
                {appt.vehicleLabel} · <span className="font-mono">{appt.vehiclePlate}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={badge.tone}>{badge.label}</Badge>
              <span className="font-mono text-xs text-ink-500">{appt.reference}</span>
            </div>
          </div>

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">When</dt>
              <dd className="font-semibold">
                {fmtDate(appt.startTime, tz)}, {fmtTime(appt.startTime, tz)} to {fmtTime(appt.endTime, tz)}
                <span className="font-normal text-ink-500"> ({fmtDuration(appt.durationMinutes)})</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Where</dt>
              <dd className="font-semibold">
                {appt.dealershipName} <span className="font-normal text-ink-500">· {appt.bayName}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Technician</dt>
              <dd className="flex items-center gap-2 font-semibold">
                <Avatar k={appt.technicianImageKey} name={appt.technicianName} size={28} />
                {appt.technicianName}
              </dd>
            </div>
            {showCustomer && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Customer</dt>
                <dd className="flex items-center gap-2 font-semibold">
                  <Avatar k={`user-${appt.customer.toLowerCase()}`} name={appt.customerName} size={28} />
                  {appt.customerName}
                </dd>
              </div>
            )}
          </dl>

          {cancel.error && (
            <ErrorNote>{cancel.error instanceof ApiError ? cancel.error.message : 'Could not cancel.'}</ErrorNote>
          )}

          {canCancel && (
            <div className="mt-auto flex flex-wrap items-center gap-2">
              {confirming ? (
                <>
                  <span className="text-sm text-ink-600">
                    Cancel {showCustomer ? `${appt.customerName}'s booking` : 'this booking'} and release the bay and technician?
                  </span>
                  <Button variant="danger" disabled={cancel.isPending} onClick={() => {
                      if (inFlight.current) return;
                      inFlight.current = true;
                      cancel.mutate();
                    }}>
                    {cancel.isPending ? 'Cancelling...' : 'Yes, cancel'}
                  </Button>
                  <Button variant="secondary" onClick={() => { setConfirming(false); cancel.reset(); }}>
                    Keep it
                  </Button>
                </>
              ) : (
                <Button variant="secondary" onClick={() => setConfirming(true)}>
                  Cancel booking
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
