import { SLOT_MINUTES } from '@asa/shared';

export const SLOT_MS = SLOT_MINUTES * 60_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
}

/** Wall-clock parts of an instant in a time zone. */
export function localParts(utcMs: number, timeZone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0 } = parts;
  return { year, month, day, hour, minute, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

function offsetMs(utcMs: number, timeZone: string): number {
  const p = localParts(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(utcMs / 60_000) * 60_000;
}

/** The instant at which the wall clock in `timeZone` shows the given date and time. */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(guess, timeZone);
  return guess - offsetMs(first, timeZone);
}

export function localDate(utcMs: number, timeZone: string): string {
  const p = localParts(utcMs, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function parseHm(hm: string): { hour: number; minute: number } {
  const [h = '0', m = '0'] = hm.split(':');
  return { hour: Number(h), minute: Number(m) };
}

export interface OpeningHours {
  timezone: string;
  openDays: number[];
  openTime: string;
  closeTime: string;
}

/** Opening and closing instants for a local calendar date, or null when closed that day. */
export function openingWindow(hours: OpeningHours, date: string): { openMs: number; closeMs: number } | null {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (!hours.openDays.includes(weekday)) return null;
  const open = parseHm(hours.openTime);
  const close = parseHm(hours.closeTime);
  return {
    openMs: zonedToUtc(y, m, d, open.hour, open.minute, hours.timezone),
    closeMs: zonedToUtc(y, m, d, close.hour, close.minute, hours.timezone),
  };
}

/** Start instants of every 30 minute slot in [startMs, startMs + durationMinutes). */
export function slotStarts(startMs: number, durationMinutes: number): number[] {
  const count = Math.ceil((durationMinutes * 60_000) / SLOT_MS);
  return Array.from({ length: count }, (_, i) => startMs + i * SLOT_MS);
}

export const iso = (ms: number): string => new Date(ms).toISOString();
