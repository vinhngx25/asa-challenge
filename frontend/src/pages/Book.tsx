import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { AppointmentDto, DealershipDto, ServiceTypeDto, SkillId, VehicleDto } from '@asa/shared';
import { ApiError, api } from '../api';
import { Avatar, Badge, Button, Card, ErrorNote, Img, Spinner } from '../components/ui';
import { fmtDate, fmtDuration, fmtTime, isoDate } from '../lib/format';
import { useCatalog, useVehicles } from '../queries';

function Step({ n, title, done, disabled, children }: { n: number; title: string; done: boolean; disabled: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`} className={disabled ? 'pointer-events-none opacity-45' : ''}>
      <h2 id={`step-${n}`} className="mb-3 flex items-center gap-3 text-lg font-bold">
        <span
          className={`flex size-7 items-center justify-center rounded-full text-sm ${
            done ? 'bg-ok-600 text-white' : 'bg-teal-700 text-white'
          }`}
        >
          {done ? '✓' : n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

const choiceClass = (selected: boolean) =>
  `text-left rounded-2xl bg-white ring-1 transition-shadow focus-visible:ring-2 ${
    selected ? 'ring-2 ring-brand-500 shadow-md' : 'ring-ink-100 hover:shadow-md'
  }`;

export function Book() {
  const catalog = useCatalog();
  const vehicles = useVehicles();
  const queryClient = useQueryClient();

  const [vehicle, setVehicle] = useState<VehicleDto | null>(null);
  const [skill, setSkill] = useState<SkillId | 'all'>('all');
  const [service, setService] = useState<ServiceTypeDto | null>(null);
  const [dealership, setDealership] = useState<DealershipDto | null>(null);
  const [date, setDate] = useState(() => isoDate(new Date(Date.now() + 24 * 3_600_000)));
  // Until the customer picks a date themselves, move the suggestion to the next day the dealership is open.
  const [dateChosen, setDateChosen] = useState(false);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<AppointmentDto | null>(null);
  // Set the moment Confirm is clicked, so a double click cannot send a second request before the button re-renders as disabled.
  const inFlight = useRef(false);

  const ready = Boolean(service && dealership && date);
  const availability = useQuery({
    queryKey: ['availability', dealership?.id, service?.id, date, vehicle?.id],
    queryFn: () =>
      api.availability({
        dealershipId: dealership!.id,
        serviceTypeId: service!.id,
        date,
        ...(vehicle ? { vehicleId: vehicle.id } : {}),
      }),
    enabled: ready,
  });

  useEffect(() => {
    if (!dealership || dateChosen) return;
    const next = new Date(`${date}T00:00:00Z`);
    for (let i = 0; i < 7 && !dealership.openDays.includes(next.getUTCDay()); i++) next.setUTCDate(next.getUTCDate() + 1);
    const nextDate = next.toISOString().slice(0, 10);
    if (nextDate !== date) setDate(nextDate);
  }, [dealership, date, dateChosen]);

  // A change of service, place, day or vehicle invalidates the chosen time.
  useEffect(() => setStartTime(null), [service?.id, dealership?.id, date, vehicle?.id]);

  const book = useMutation({
    mutationFn: () =>
      api.book({ vehicleId: vehicle!.id, serviceTypeId: service!.id, dealershipId: dealership!.id, startTime: startTime! }),
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: async (appt) => {
      setConfirmed(appt);
      await queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: () => {
      // Whatever the reason, show the current truth about free times.
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });

  const services = useMemo(
    () => (catalog.data?.services ?? []).filter((s) => skill === 'all' || s.skill === skill),
    [catalog.data, skill],
  );

  const tz = dealership?.timezone ?? 'Europe/London';
  const today = isoDate(new Date());
  const maxDate = isoDate(new Date(Date.now() + 60 * 24 * 3_600_000));

  if (confirmed) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <Card className="space-y-5 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-ok-50 text-3xl text-ok-600">✓</div>
          <div>
            <h1 className="text-2xl font-bold">Booking confirmed</h1>
            <p className="text-ink-500">
              Reference <span className="font-mono font-semibold text-ink-800">{confirmed.reference}</span>
            </p>
          </div>
          <div className="grid gap-4 rounded-xl bg-ink-50 p-4 text-left sm:grid-cols-2">
            <Fact label="Service" value={`${confirmed.serviceName} (${fmtDuration(confirmed.durationMinutes)})`} />
            <Fact label="Vehicle" value={`${confirmed.vehicleLabel} · ${confirmed.vehiclePlate}`} />
            <Fact
              label="When"
              value={`${fmtDate(confirmed.startTime, tz)}, ${fmtTime(confirmed.startTime, tz)} to ${fmtTime(confirmed.endTime, tz)}`}
            />
            <Fact label="Where" value={`${confirmed.dealershipName} · ${confirmed.bayName}`} />
            <div className="sm:col-span-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">Your technician</div>
              <div className="mt-1 flex items-center gap-3">
                <Avatar k={confirmed.technicianImageKey} name={confirmed.technicianName} size={48} />
                <span className="font-semibold">{confirmed.technicianName}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/">
              <Button>View my bookings</Button>
            </Link>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmed(null);
                setService(null);
                setSkill('all');
                setDealership(null);
                setDateChosen(false);
                setDate(isoDate(new Date(Date.now() + 24 * 3_600_000)));
                setStartTime(null);
                book.reset();
              }}
            >
              Book another
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const conflict = book.error instanceof ApiError ? book.error : null;
  const whenText =
    startTime && service
      ? `${fmtDate(startTime, tz)}, ${fmtTime(startTime, tz)} to ${fmtTime(new Date(Date.parse(startTime) + service.durationMinutes * 60_000).toISOString(), tz)}`
      : null;
  const nextStep = !vehicle
    ? 'Step 1: choose your vehicle.'
    : !service
      ? 'Step 2: choose what it needs.'
      : !dealership
        ? 'Step 3: choose a dealership.'
        : 'Step 4: pick a date and a start time.';

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {/* min-w-0 lets the scrolling category chips shrink instead of widening the whole page on a phone */}
      <div className="min-w-0 space-y-10">
        <header>
          <h1 className="text-2xl font-bold">Book a service</h1>
          <p className="text-ink-500">We confirm a free bay and a qualified technician for the whole service before you book.</p>
        </header>

        <Step n={1} title="Choose your vehicle" done={Boolean(vehicle)} disabled={false}>
          {vehicles.isLoading && <Spinner />}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {vehicles.data?.map((v) => (
              <button key={v.id} onClick={() => setVehicle(v)} aria-pressed={vehicle?.id === v.id} className={`overflow-hidden ${choiceClass(vehicle?.id === v.id)}`}>
                <Img k={v.imageKey} alt={`${v.year} ${v.make} ${v.model}`} className="h-32 w-full" />
                <div className="p-3">
                  <div className="font-semibold leading-tight">
                    {v.year} {v.make} {v.model}
                  </div>
                  <div className="font-mono text-sm text-ink-500">{v.plate}</div>
                </div>
              </button>
            ))}
          </div>
        </Step>

        <Step n={2} title="What does it need?" done={Boolean(service)} disabled={!vehicle}>
          {catalog.isLoading && <Spinner />}
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Service categories">
            <CategoryChip active={skill === 'all'} onClick={() => setSkill('all')} label="All" />
            {catalog.data?.skills.map((s) => (
              <CategoryChip key={s.id} active={skill === s.id} onClick={() => setSkill(s.id)} label={s.name} imageKey={`category-${s.id}`} />
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {services.map((s) => (
              <button key={s.id} onClick={() => setService(s)} aria-pressed={service?.id === s.id} className={`flex min-w-0 items-center gap-3 p-3 ${choiceClass(service?.id === s.id)}`}>
                <Img k={`category-${s.skill}`} alt="" className="size-14 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold leading-tight">{s.name}</div>
                  <div className="truncate text-sm text-ink-500">{s.description}</div>
                </div>
                <Badge tone="upcoming">{fmtDuration(s.durationMinutes)}</Badge>
              </button>
            ))}
          </div>
        </Step>

        <Step n={3} title="Where?" done={Boolean(dealership)} disabled={!service}>
          <div className="grid gap-3 sm:grid-cols-3">
            {catalog.data?.dealerships.map((d) => (
              <button key={d.id} onClick={() => setDealership(d)} aria-pressed={dealership?.id === d.id} className={`overflow-hidden ${choiceClass(dealership?.id === d.id)}`}>
                <Img k={d.imageKey} alt={d.name} className="h-32 w-full" />
                <div className="p-3">
                  <div className="font-semibold leading-tight">{d.name}</div>
                  <div className="text-sm text-ink-500">{d.city}</div>
                  <div className="mt-1 text-xs text-ink-500">
                    Mon to Sat {d.openTime}-{d.closeTime} · {d.bays.length} bay{d.bays.length > 1 ? 's' : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Step>

        <Step n={4} title="When?" done={Boolean(startTime)} disabled={!service || !dealership}>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold" htmlFor="date">
              Date
            </label>
            <input
              id="date"
              type="date"
              value={date}
              min={today}
              max={maxDate}
              onChange={(e) => {
                if (!e.target.value) return;
                setDateChosen(true);
                setDate(e.target.value);
              }}
              className="rounded-lg border-0 bg-white px-3 py-2 ring-1 ring-ink-200"
            />
            <span className="text-sm text-ink-500">
              Times shown in {tz === 'Europe/London' ? 'UK local time' : (dealership?.city ?? 'local') + ' time'}
            </span>
          </div>

          {availability.isLoading && <Spinner label="Checking bays and technicians" />}
          {availability.error && <ErrorNote>Could not check availability. Please try again.</ErrorNote>}
          {availability.data && !availability.data.open && (
            <p className="rounded-xl bg-white p-4 text-sm text-ink-600 ring-1 ring-ink-100">
              {dealership?.name} is closed on this day. Pick another date.
            </p>
          )}
          {availability.data?.open && (
            <>
              <div role="group" aria-label="Available start times" className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
                {availability.data.slots.map((s) => (
                  <button
                    key={s.startTime}
                    disabled={!s.available}
                    aria-pressed={startTime === s.startTime}
                    onClick={() => setStartTime(s.startTime)}
                    className={`rounded-lg px-2 py-2 text-sm font-semibold ring-1 transition-colors ${
                      startTime === s.startTime
                        ? 'bg-brand-500 text-ink-900 ring-brand-500'
                        : s.available
                          ? 'bg-white ring-ink-200 hover:bg-brand-50'
                          : 'cursor-not-allowed bg-ink-100 text-ink-300 line-through ring-ink-100'
                    }`}
                  >
                    {fmtTime(s.startTime, tz)}
                  </button>
                ))}
              </div>
              {availability.data.slots.every((s) => !s.available) && (
                <p className="mt-3 text-sm text-ink-600">
                  Nothing is free on this day for a {fmtDuration(availability.data.durationMinutes)} service. Try another date or dealership.
                </p>
              )}
            </>
          )}
        </Step>
      </div>

      {/* Below the lg breakpoint this is a bar pinned to the bottom of the screen (one-line summary and Confirm), so
          Confirm is always in reach on a phone. From lg up it is the sticky card on the right. */}
      <aside className="sticky bottom-0 z-10 -mx-4 lg:bottom-auto lg:top-24 lg:mx-0 lg:self-start" aria-label="Your booking">
        <Card className="space-y-3 rounded-b-none border-t border-ink-100 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(11,31,58,0.14)] lg:space-y-4 lg:rounded-2xl lg:border-t-0 lg:pb-5 lg:shadow-sm">
          <h2 className="hidden text-lg font-bold lg:block">Your booking</h2>
          <dl className="hidden space-y-3 text-sm lg:block">
            <Row label="Vehicle" value={vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : null} />
            <Row label="Service" value={service ? `${service.name} · ${fmtDuration(service.durationMinutes)}` : null} />
            <Row label="Dealership" value={dealership?.name ?? null} />
            <Row label="When" value={whenText} />
          </dl>

          <div className={`lg:hidden ${conflict ? 'hidden' : ''}`} data-testid="booking-bar-summary">
            {whenText && service && dealership ? (
              <p className="text-sm font-semibold leading-snug">
                {service.name} · {dealership.name}
                <span className="block font-normal text-ink-600">{whenText}</span>
              </p>
            ) : (
              <p className="text-sm text-ink-600">{nextStep}</p>
            )}
          </div>

          {conflict && (
            <div role="alert" className="max-h-[34vh] space-y-2 overflow-y-auto rounded-xl bg-bad-50 p-3 text-sm text-bad-600 ring-1 ring-red-200 lg:max-h-none">
              <p className="font-semibold">{conflict.message}</p>
              {conflict.alternatives.length > 0 && (
                <div>
                  <p className="mb-1 text-ink-700">Nearest free times:</p>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                    {conflict.alternatives.map((alt) => (
                      <button
                        key={alt}
                        onClick={() => {
                          const altDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(alt));
                          setDateChosen(true);
                          setDate(altDate);
                          // The date effect clears the time, so select after it runs.
                          setTimeout(() => setStartTime(alt), 0);
                          book.reset();
                        }}
                        className="min-h-9 rounded-lg bg-white px-2 py-1 text-xs font-semibold text-ink-800 ring-1 ring-ink-200 hover:bg-brand-50 sm:px-2.5 sm:text-sm"
                      >
                        {fmtDate(alt, tz)} {fmtTime(alt, tz)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <Button
            className="min-h-11 w-full"
            disabled={!vehicle || !service || !dealership || !startTime || book.isPending}
            onClick={() => {
              if (inFlight.current) return;
              inFlight.current = true;
              book.mutate();
            }}
          >
            {book.isPending ? 'Confirming...' : 'Confirm booking'}
          </Button>
        </Card>
      </aside>
    </div>
  );
}

function CategoryChip({ active, onClick, label, imageKey }: { active: boolean; onClick: () => void; label: string; imageKey?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-2 rounded-full py-1.5 pr-4 text-sm font-semibold ring-1 transition-colors ${imageKey ? 'pl-1.5' : 'pl-4'} ${
        active ? 'bg-teal-700 text-white ring-teal-700' : 'bg-white ring-ink-200 hover:bg-ink-50'
      }`}
    >
      {imageKey && <Img k={imageKey} alt="" className="size-7 rounded-full" />}
      {label}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className={value ? 'font-semibold' : 'text-ink-300'}>{value ?? 'Not chosen yet'}</dd>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
