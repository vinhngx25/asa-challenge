import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppointmentDto } from '@asa/shared';
import { AppError } from '../src/lib/errors.js';
import { iso, localParts, zonedToUtc } from '../src/lib/time.js';
import type { Principal } from '../src/services/auth.js';
import {
  cancelAppointment,
  createAppointment,
  getAppointment,
  getAvailability,
  listAppointments,
} from '../src/services/booking.js';
import { clearCatalogCache } from '../src/services/catalog.js';
import { ensureTable, seed } from '../src/seed/seed.js';
import { config } from '../src/lib/config.js';

const wick: Principal = { username: 'JoinWick', displayName: 'John Wick', role: 'customer' };
const bond: Principal = { username: 'JamesBond', displayName: 'James Bond', role: 'customer' };
const winston: Principal = { username: 'Winston', displayName: 'Winston Scott', role: 'staff' };

const WICK_VEHICLES = ['wick-mustang', 'wick-chevelle', 'wick-charger'];
const BOND_VEHICLES = ['bond-db5', 'bond-esprit', 'bond-dbs', 'bond-2000gt'];

/** A working Wednesday about five weeks ahead, so seeded and test bookings never meet the booking window edges. */
function testDay(): { y: number; m: number; d: number } {
  const t = localParts(Date.now() + 35 * 24 * 3_600_000, 'Europe/London');
  const base = new Date(Date.UTC(t.year, t.month - 1, t.day));
  base.setUTCDate(base.getUTCDate() + ((3 - base.getUTCDay() + 7) % 7));
  return { y: base.getUTCFullYear(), m: base.getUTCMonth() + 1, d: base.getUTCDate() };
}

const at = (hour: number, minute = 0, dayShift = 0): string => {
  const { y, m, d } = testDay();
  return iso(zonedToUtc(y, m, d + dayShift, hour, minute, 'Europe/London'));
};

const book = (
  who: Principal,
  vehicleId: string,
  serviceTypeId: string,
  dealershipId: string,
  startTime: string,
): Promise<AppointmentDto> => createAppointment({ vehicleId, serviceTypeId, dealershipId, startTime }, who);

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (err) {
    return err instanceof AppError ? err.code : `ERR:${String(err)}`;
  }
}

beforeAll(async () => {
  await ensureTable(
    new DynamoDBClient({
      region: config.region,
      endpoint: config.dynamoEndpoint,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  );
});

beforeEach(async () => {
  clearCatalogCache();
  await seed({ bookings: false });
});

describe('booking happy path', () => {
  it('assigns a free bay and a qualified technician and stores the appointment', async () => {
    const appt = await book(wick, 'wick-mustang', 'oil-change', 'kensington', at(9));
    expect(appt.status).toBe('BOOKED');
    expect(appt.customer).toBe('JoinWick');
    expect(appt.vehicleId).toBe('wick-mustang');
    expect(['oliver-hughes', 'priya-patel']).toContain(appt.technicianId); // the oil specialists at Kensington
    expect(appt.bayId).toMatch(/^kensington-bay-/);
    expect(appt.startTime).toBe(at(9));
    expect(appt.endTime).toBe(at(10));

    const stored = await getAppointment(appt.id, wick);
    expect(stored).toEqual(appt);
  });

  it('uses the second bay and another technician for a parallel booking, then refuses a third', async () => {
    const a = await book(wick, 'wick-mustang', 'mot', 'kensington', at(9));
    const b = await book(bond, 'bond-db5', 'mot', 'kensington', at(9));
    expect(a.bayId).not.toBe(b.bayId);
    expect(a.technicianId).not.toBe(b.technicianId);
    expect(await codeOf(book(wick, 'wick-charger', 'mot', 'kensington', at(9)))).toBe('SLOT_UNAVAILABLE');
  });
});

describe('time boundaries', () => {
  it('treats intervals as half open: back-to-back bookings do not conflict', async () => {
    await book(wick, 'wick-mustang', 'front-pads', 'manchester', at(9)); // 120 min, 09:00 to 11:00, single bay
    expect(await codeOf(book(bond, 'bond-db5', 'oil-change', 'manchester', at(10)))).toBe('SLOT_UNAVAILABLE');
    expect(await codeOf(book(bond, 'bond-db5', 'oil-change', 'manchester', at(10, 30)))).toBe('SLOT_UNAVAILABLE');
    expect(await codeOf(book(bond, 'bond-db5', 'oil-change', 'manchester', at(11)))).toBe('OK');
  });

  it('blocks a booking that starts before an existing one but runs into it', async () => {
    await book(wick, 'wick-mustang', 'oil-change', 'manchester', at(10)); // 10:00 to 11:00
    expect(await codeOf(book(bond, 'bond-db5', 'front-pads', 'manchester', at(9)))).toBe('SLOT_UNAVAILABLE'); // 09:00 to 11:00
    expect(await codeOf(book(bond, 'bond-db5', 'oil-change', 'manchester', at(9)))).toBe('OK'); // 09:00 to 10:00
  });

  it('rejects start times off the 30 minute grid, outside hours, on Sundays and too soon', async () => {
    expect(await codeOf(book(wick, 'wick-mustang', 'mot', 'kensington', at(9, 15)))).toBe('INVALID_START_TIME');
    expect(await codeOf(book(wick, 'wick-mustang', 'mot', 'kensington', at(7, 30)))).toBe('INVALID_START_TIME');
    expect(await codeOf(book(wick, 'wick-mustang', 'full-service', 'kensington', at(15)))).toBe('INVALID_START_TIME'); // would end 19:00
    expect(await codeOf(book(wick, 'wick-mustang', 'mot', 'kensington', at(10, 0, 4)))).toBe('INVALID_START_TIME'); // Sunday
    expect(await codeOf(book(wick, 'wick-mustang', 'mot', 'kensington', iso(Date.now() + 10 * 60_000)))).toBe(
      'INVALID_START_TIME',
    );
  });

  it('lets the last 30 minute service end exactly at closing time', async () => {
    expect(await codeOf(book(wick, 'wick-mustang', 'fluid-check', 'kensington', at(17, 30)))).toBe('OK');
  });
});

describe('resource constraints', () => {
  it('fails when no qualified technician is free even though a bay is', async () => {
    // Birmingham has two bays but only one tyre specialist (Joseph Bennett).
    await book(wick, 'wick-mustang', 'alignment', 'birmingham', at(10));
    const err = await book(bond, 'bond-db5', 'rotation', 'birmingham', at(10)).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('SLOT_UNAVAILABLE');
  });

  it('fails when no bay is free even though technicians are', async () => {
    // Manchester has one bay but four technicians.
    await book(wick, 'wick-mustang', 'oil-change', 'manchester', at(10));
    expect(await codeOf(book(bond, 'bond-db5', 'brake-fluid', 'manchester', at(10)))).toBe('SLOT_UNAVAILABLE');
  });

  it('offers free alternative times when a slot is unavailable', async () => {
    await book(wick, 'wick-mustang', 'oil-change', 'manchester', at(10));
    const err = await book(bond, 'bond-db5', 'oil-change', 'manchester', at(10)).catch((e) => e);
    expect(err.code).toBe('SLOT_UNAVAILABLE');
    expect(err.alternatives.length).toBeGreaterThan(0);
    expect(await codeOf(book(bond, 'bond-db5', 'oil-change', 'manchester', err.alternatives[0]))).toBe('OK');
  });

  it('refuses to put one vehicle in two places at once', async () => {
    await book(wick, 'wick-mustang', 'oil-change', 'kensington', at(10));
    expect(await codeOf(book(wick, 'wick-mustang', 'mot', 'birmingham', at(10)))).toBe('VEHICLE_BUSY');
  });

  it('only allows a customer to book their own vehicles', async () => {
    expect(await codeOf(book(wick, 'bond-db5', 'mot', 'kensington', at(9)))).toBe('NOT_FOUND');
  });
});

describe('concurrency: simultaneous requests never double book', () => {
  it('one bay, seven vehicles, one slot: exactly one booking wins', async () => {
    const attempts: [Principal, string][] = [
      ...WICK_VEHICLES.map((v): [Principal, string] => [wick, v]),
      ...BOND_VEHICLES.map((v): [Principal, string] => [bond, v]),
    ];
    const results = await Promise.all(
      attempts.map(([who, v]) => codeOf(book(who, v, 'oil-change', 'manchester', at(10)))),
    );
    expect(results.filter((r) => r === 'OK')).toHaveLength(1);
    expect(results.filter((r) => r === 'SLOT_UNAVAILABLE')).toHaveLength(6);
  });

  it('two bays and two qualified technicians, seven vehicles: exactly two win, on different bays and technicians', async () => {
    const attempts: [Principal, string][] = [
      ...WICK_VEHICLES.map((v): [Principal, string] => [wick, v]),
      ...BOND_VEHICLES.map((v): [Principal, string] => [bond, v]),
    ];
    const settled = await Promise.allSettled(
      attempts.map(([who, v]) => book(who, v, 'mot', 'kensington', at(9))),
    );
    const won = settled.filter((s): s is PromiseFulfilledResult<AppointmentDto> => s.status === 'fulfilled').map((s) => s.value);
    expect(won).toHaveLength(2);
    expect(new Set(won.map((w) => w.bayId)).size).toBe(2);
    expect(new Set(won.map((w) => w.technicianId)).size).toBe(2);
  });

  it('the same vehicle submitted five times at once books once', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => codeOf(book(wick, 'wick-mustang', 'oil-change', 'kensington', at(10)))),
    );
    expect(results.filter((r) => r === 'OK')).toHaveLength(1);
    expect(results.filter((r) => r === 'VEHICLE_BUSY' || r === 'SLOT_UNAVAILABLE')).toHaveLength(4);
  });

  it('overlapping long and short bookings racing for one bay never both succeed', async () => {
    const results = await Promise.all([
      codeOf(book(wick, 'wick-mustang', 'full-service', 'manchester', at(9))), // 09:00 to 13:00
      codeOf(book(bond, 'bond-db5', 'oil-change', 'manchester', at(12))), // 12:00 to 13:00
      codeOf(book(bond, 'bond-esprit', 'mot', 'manchester', at(11, 30))), // 11:30 to 12:30
    ]);
    expect(results.filter((r) => r === 'OK')).toHaveLength(1);
  });
});

describe('cancel', () => {
  it('frees the bay, technician and vehicle so the slot can be rebooked', async () => {
    const first = await book(wick, 'wick-mustang', 'oil-change', 'manchester', at(10));
    expect(await codeOf(book(bond, 'bond-db5', 'oil-change', 'manchester', at(10)))).toBe('SLOT_UNAVAILABLE');

    const cancelled = await cancelAppointment(first.id, wick);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelledAt).toBeDefined();

    expect(await codeOf(book(bond, 'bond-db5', 'oil-change', 'manchester', at(10)))).toBe('OK');
    // The vehicle is free again too.
    expect(await codeOf(book(wick, 'wick-mustang', 'mot', 'kensington', at(10)))).toBe('OK');
  });

  it('cannot be done twice', async () => {
    const a = await book(wick, 'wick-mustang', 'oil-change', 'manchester', at(10));
    await cancelAppointment(a.id, wick);
    expect(await codeOf(cancelAppointment(a.id, wick))).toBe('ALREADY_CANCELLED');
  });

  it('is limited to the owner, while staff can cancel anything', async () => {
    const a = await book(wick, 'wick-mustang', 'oil-change', 'manchester', at(10));
    expect(await codeOf(cancelAppointment(a.id, bond))).toBe('FORBIDDEN');
    expect(await codeOf(getAppointment(a.id, bond))).toBe('FORBIDDEN');
    expect(await codeOf(cancelAppointment(a.id, winston))).toBe('OK');
  });

  it('refuses appointments that have already started', async () => {
    const a = await book(wick, 'wick-mustang', 'oil-change', 'manchester', at(10));
    expect(await codeOf(cancelAppointment(a.id, wick, { now: Date.parse(at(10, 30)) }))).toBe('CANNOT_CANCEL_PAST');
  });

  it('reports a missing appointment', async () => {
    expect(await codeOf(cancelAppointment('00000000-0000-0000-0000-000000000000', wick))).toBe('NOT_FOUND');
  });
});

describe('availability', () => {
  const date = () => {
    const { y, m, d } = testDay();
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  it('marks booked times unavailable and releases them on cancel', async () => {
    const q = { dealershipId: 'manchester', serviceTypeId: 'oil-change', date: date() };
    const before = await getAvailability(q, wick);
    expect(before.open).toBe(true);
    expect(before.slots.find((s) => s.startTime === at(10))?.available).toBe(true);

    const a = await book(wick, 'wick-mustang', 'oil-change', 'manchester', at(10));
    const during = await getAvailability(q, bond);
    expect(during.slots.find((s) => s.startTime === at(10))?.available).toBe(false);
    expect(during.slots.find((s) => s.startTime === at(9, 30))?.available).toBe(false); // would run into 10:00
    expect(during.slots.find((s) => s.startTime === at(9))?.available).toBe(true); // ends at 10:00 sharp
    expect(during.slots.find((s) => s.startTime === at(11))?.available).toBe(true);

    await cancelAppointment(a.id, wick);
    const after = await getAvailability(q, bond);
    expect(after.slots.find((s) => s.startTime === at(10))?.available).toBe(true);
  });

  it('never offers a start that cannot finish before closing', async () => {
    const day = await getAvailability({ dealershipId: 'manchester', serviceTypeId: 'full-service', date: date() }, wick);
    const last = day.slots.at(-1)!;
    expect(last.startTime).toBe(at(13, 30)); // 240 minutes must end by 17:30
  });

  it('reports a closed day on Sunday', async () => {
    const { y, m, d } = testDay();
    const sunday = new Date(Date.UTC(y, m - 1, d + 4)).toISOString().slice(0, 10);
    const day = await getAvailability({ dealershipId: 'kensington', serviceTypeId: 'mot', date: sunday }, wick);
    expect(day.open).toBe(false);
    expect(day.slots).toHaveLength(0);
  });

  it('marks times unavailable for a vehicle that is already booked elsewhere', async () => {
    await book(wick, 'wick-mustang', 'oil-change', 'kensington', at(10));
    const day = await getAvailability(
      { dealershipId: 'birmingham', serviceTypeId: 'mot', date: date(), vehicleId: 'wick-mustang' },
      wick,
    );
    expect(day.slots.find((s) => s.startTime === at(10))?.available).toBe(false);
  });
});

describe('listing and roles', () => {
  it('shows customers only their own appointments and staff everything, with filters', async () => {
    await book(wick, 'wick-mustang', 'oil-change', 'manchester', at(10));
    await book(bond, 'bond-db5', 'mot', 'kensington', at(10));
    const cancelled = await book(bond, 'bond-esprit', 'mot', 'birmingham', at(11));
    await cancelAppointment(cancelled.id, bond);

    expect((await listAppointments(wick, {})).map((a) => a.customer)).toEqual(['JoinWick']);
    expect((await listAppointments(bond, {})).map((a) => a.customer)).toEqual(['JamesBond', 'JamesBond']);

    expect(await listAppointments(winston, {})).toHaveLength(3);
    expect((await listAppointments(winston, { dealershipId: 'kensington' })).map((a) => a.dealershipId)).toEqual(['kensington']);
    expect((await listAppointments(winston, { status: 'CANCELLED' })).map((a) => a.id)).toEqual([cancelled.id]);
    expect(await listAppointments(winston, { from: at(10, 30), to: at(23) })).toHaveLength(1);
  });
});
