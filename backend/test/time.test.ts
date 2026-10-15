import { describe, expect, it } from 'vitest';
import { iso, localDate, openingWindow, slotStarts, zonedToUtc } from '../src/lib/time.js';

const LONDON = 'Europe/London';
const hours = { timezone: LONDON, openDays: [1, 2, 3, 4, 5, 6], openTime: '08:00', closeTime: '18:00' };

describe('zonedToUtc', () => {
  it('uses UTC+0 in winter', () => {
    expect(iso(zonedToUtc(2026, 1, 14, 9, 0, LONDON))).toBe('2026-01-14T09:00:00.000Z');
  });

  it('uses UTC+1 in summer', () => {
    expect(iso(zonedToUtc(2026, 7, 14, 9, 0, LONDON))).toBe('2026-07-14T08:00:00.000Z');
  });

  it('follows the clock change on the last Sunday of March (2027-03-28)', () => {
    expect(iso(zonedToUtc(2027, 3, 27, 9, 0, LONDON))).toBe('2027-03-27T09:00:00.000Z');
    expect(iso(zonedToUtc(2027, 3, 29, 9, 0, LONDON))).toBe('2027-03-29T08:00:00.000Z');
  });

  it('follows the clock change on the last Sunday of October (2026-10-25)', () => {
    expect(iso(zonedToUtc(2026, 10, 24, 9, 0, LONDON))).toBe('2026-10-24T08:00:00.000Z');
    expect(iso(zonedToUtc(2026, 10, 26, 9, 0, LONDON))).toBe('2026-10-26T09:00:00.000Z');
  });
});

describe('localDate', () => {
  it('reports the local calendar day, not the UTC day', () => {
    // 23:30 UTC in July is 00:30 the next day in London.
    expect(localDate(Date.parse('2026-07-14T23:30:00Z'), LONDON)).toBe('2026-07-15');
    expect(localDate(Date.parse('2026-01-14T23:30:00Z'), LONDON)).toBe('2026-01-14');
  });
});

describe('openingWindow', () => {
  it('returns open and close instants for a working day', () => {
    const w = openingWindow(hours, '2026-07-15');
    expect(w && [iso(w.openMs), iso(w.closeMs)]).toEqual(['2026-07-15T07:00:00.000Z', '2026-07-15T17:00:00.000Z']);
  });

  it('returns null on Sunday', () => {
    expect(openingWindow(hours, '2026-07-19')).toBeNull();
  });

  it('keeps Saturday open', () => {
    expect(openingWindow(hours, '2026-07-18')).not.toBeNull();
  });
});

describe('slotStarts', () => {
  it('splits a service into 30 minute slots', () => {
    const start = Date.parse('2026-07-15T08:00:00Z');
    expect(slotStarts(start, 30).map(iso)).toEqual(['2026-07-15T08:00:00.000Z']);
    expect(slotStarts(start, 120)).toHaveLength(4);
    expect(slotStarts(start, 240)).toHaveLength(8);
  });

  it('covers the half-open interval: the end instant is not a slot', () => {
    const start = Date.parse('2026-07-15T08:00:00Z');
    const last = slotStarts(start, 60).at(-1)!;
    expect(iso(last)).toBe('2026-07-15T08:30:00.000Z');
  });
});
