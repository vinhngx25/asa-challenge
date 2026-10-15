import { describe, expect, it } from 'vitest';
import { appointmentPhase } from '@asa/shared';

const start = Date.parse('2026-10-28T10:00:00.000Z');
const end = Date.parse('2026-10-28T11:00:00.000Z');
const booked = { status: 'BOOKED' as const, startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString() };

describe('appointmentPhase boundaries', () => {
  it('is upcoming until the start instant', () => {
    expect(appointmentPhase(booked, start - 60_000)).toBe('upcoming');
    expect(appointmentPhase(booked, start - 1)).toBe('upcoming');
  });

  it('is in progress from the start instant up to the end instant', () => {
    expect(appointmentPhase(booked, start)).toBe('in-progress');
    expect(appointmentPhase(booked, start + 1)).toBe('in-progress');
    expect(appointmentPhase(booked, end - 1)).toBe('in-progress');
  });

  it('is past from the end instant on', () => {
    expect(appointmentPhase(booked, end)).toBe('past');
    expect(appointmentPhase(booked, end + 1)).toBe('past');
  });

  it('stays cancelled whatever the clock says', () => {
    const cancelled = { ...booked, status: 'CANCELLED' as const };
    for (const now of [start - 1, start, end - 1, end, end + 1]) expect(appointmentPhase(cancelled, now)).toBe('cancelled');
  });
});
