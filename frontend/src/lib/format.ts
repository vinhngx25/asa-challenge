import { appointmentPhase, type AppointmentDto } from '@asa/shared';

const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(timeZone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = timeZone + JSON.stringify(opts);
  let f = cache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, ...opts });
    cache.set(k, f);
  }
  return f;
}

/** 24-hour clock time in the dealership's time zone, for example 14:30. */
export const fmtTime = (iso: string, tz: string): string =>
  fmt(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/** For example Wed 21 Oct 2026. */
export const fmtDate = (iso: string, tz: string): string =>
  fmt(tz, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

export const fmtDay = (iso: string, tz: string): { weekday: string; day: string; month: string } => ({
  weekday: fmt(tz, { weekday: 'short' }).format(new Date(iso)),
  day: fmt(tz, { day: 'numeric' }).format(new Date(iso)),
  month: fmt(tz, { month: 'short' }).format(new Date(iso)),
});

export const fmtDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
};

export const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Dashboard groups: a booking that has started but not ended still counts as upcoming. */
export type Phase = 'upcoming' | 'past' | 'cancelled';

export function phaseOf(a: AppointmentDto, now = Date.now()): Phase {
  const p = appointmentPhase(a, now);
  return p === 'in-progress' ? 'upcoming' : p;
}

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
