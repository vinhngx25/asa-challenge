import { describe, expect, it } from 'vitest';
import { fmtDate, fmtTime } from '../src/lib/format';

describe('times are shown in the dealership time zone', () => {
  it('summer (BST, UTC+1): 09:00 UTC reads 10:00', () => {
    expect(fmtTime('2026-07-01T09:00:00.000Z', 'Europe/London')).toBe('10:00');
  });

  it('winter (GMT): 09:00 UTC reads 09:00', () => {
    expect(fmtTime('2026-12-01T09:00:00.000Z', 'Europe/London')).toBe('09:00');
  });

  it('the last hour of the UTC day can already be the next local day in summer', () => {
    expect(fmtTime('2026-07-01T23:30:00.000Z', 'Europe/London')).toBe('00:30');
    expect(fmtDate('2026-07-01T23:30:00.000Z', 'Europe/London')).toBe('Thu, 2 Jul 2026');
  });

  it('the same instant reads differently in another zone', () => {
    expect(fmtTime('2026-07-01T09:00:00.000Z', 'Asia/Singapore')).toBe('17:00');
  });
});
