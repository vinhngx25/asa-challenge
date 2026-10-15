/**
 * Pairwise (all-pairs) test of the booking decision.
 *
 * Six parameters would need 3 x 7 x 3 x 5 x 5 x 2 = 3,150 combinations. The generator picks a small set in which every
 * pair of values from any two parameters appears at least once. Each row is executed against DynamoDB Local on a freshly
 * seeded table, and the result is compared with an oracle written from the rules, not from the code:
 *
 *   closed day or start outside opening hours -> INVALID_START_TIME
 *   otherwise by contention:
 *     none                      -> booked
 *     one bay already taken     -> booked when the dealership has another bay, else SLOT_UNAVAILABLE
 *     all qualified technicians taken -> SLOT_UNAVAILABLE
 *     all bays taken            -> SLOT_UNAVAILABLE
 *     vehicle already taken     -> VEHICLE_BUSY
 *
 * Rows that pass the opening-hours rules are also compared with the availability endpoint.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DealershipDto, ServiceTypeDto } from '@asa/shared';
import { config } from '../src/lib/config.js';
import { db } from '../src/lib/db.js';
import { AppError } from '../src/lib/errors.js';
import { key } from '../src/lib/keys.js';
import { iso, localDate, localParts, parseHm, zonedToUtc } from '../src/lib/time.js';
import type { Principal } from '../src/services/auth.js';
import { createAppointment, getAvailability } from '../src/services/booking.js';
import { clearCatalogCache, getCatalog } from '../src/services/catalog.js';
import { ensureTable, seed } from '../src/seed/seed.js';
import { allPairsCovered, pairwise } from './helpers/pairwise.js';

const SLOT = 30 * 60_000;

const PARAMETERS = {
  dealership: ['kensington', 'birmingham', 'manchester'],
  service: ['fluid-check', 'alignment', 'front-pads', 'clutch', 'mot', 'aircon', 'alternator'], // 30, 60, 120, 240, 60, 60, 120 minutes across 6 skills
  day: ['monday', 'saturday', 'sunday'],
  position: ['first', 'middle', 'lastFit', 'afterClose', 'beforeOpen'],
  contention: ['none', 'oneBayTaken', 'qualifiedTechsTaken', 'allBaysTaken', 'vehicleTaken'],
  customer: ['wick', 'bond'],
} as const;

const customers: Record<string, { principal: Principal; vehicle: string }> = {
  wick: { principal: { username: 'JoinWick', displayName: 'John Wick', role: 'customer' }, vehicle: 'wick-mustang' },
  bond: { principal: { username: 'JamesBond', displayName: 'James Bond', role: 'customer' }, vehicle: 'bond-db5' },
};

/** The next date with the wanted weekday that is between 14 and 28 days ahead (inside the 60 day horizon). */
function dateFor(day: string): { y: number; m: number; d: number } {
  const wanted = { monday: 1, saturday: 6, sunday: 0 }[day]!;
  const t = localParts(Date.now() + 14 * 24 * 3_600_000, 'Europe/London');
  const base = new Date(Date.UTC(t.year, t.month - 1, t.day));
  base.setUTCDate(base.getUTCDate() + ((wanted - base.getUTCDay() + 7) % 7));
  return { y: base.getUTCFullYear(), m: base.getUTCMonth() + 1, d: base.getUTCDate() };
}

function startFor(position: string, dealership: DealershipDto, durationMinutes: number, day: string): number {
  const { y, m, d } = dateFor(day);
  const open = parseHm(dealership.openTime);
  const close = parseHm(dealership.closeTime);
  const openMs = zonedToUtc(y, m, d, open.hour, open.minute, dealership.timezone);
  const closeMs = zonedToUtc(y, m, d, close.hour, close.minute, dealership.timezone);
  const dur = durationMinutes * 60_000;
  switch (position) {
    case 'first':
      return openMs;
    case 'middle':
      return openMs + Math.floor((closeMs - openMs - dur) / 2 / SLOT) * SLOT;
    case 'lastFit':
      return closeMs - dur;
    case 'afterClose':
      return closeMs - dur + SLOT;
    default:
      return openMs - SLOT; // beforeOpen
  }
}

async function lock(kind: 'BAY' | 'TECH' | 'VEH', id: string, startMs: number, durationMinutes: number): Promise<void> {
  for (let t = startMs; t < startMs + durationMinutes * 60_000; t += SLOT) {
    await db().send(
      new PutCommand({
        TableName: config.tableName,
        Item: { ...key.lock(kind, id, iso(t)), type: 'LOCK', appointmentId: 'pairwise-setup' },
      }),
    );
  }
}

function expected(row: Record<string, string>, dealership: DealershipDto): string {
  if (row.day === 'sunday') return 'INVALID_START_TIME';
  if (row.position === 'afterClose' || row.position === 'beforeOpen') return 'INVALID_START_TIME';
  switch (row.contention) {
    case 'none':
      return 'OK';
    case 'oneBayTaken':
      return dealership.bays.length > 1 ? 'OK' : 'SLOT_UNAVAILABLE';
    case 'vehicleTaken':
      return 'VEHICLE_BUSY';
    default:
      return 'SLOT_UNAVAILABLE';
  }
}

const rows = pairwise(PARAMETERS);

describe('pairwise design', () => {
  it('covers every pair of parameter values', () => {
    expect(allPairsCovered(PARAMETERS, rows)).toBe(true);
    console.log(`pairwise: ${rows.length} rows instead of 3,150 full combinations`);
    expect(rows.length).toBeLessThan(60);
  });
});

describe('pairwise execution against DynamoDB Local', () => {
  beforeAll(async () => {
    await ensureTable(
      new DynamoDBClient({
        region: config.region,
        endpoint: config.dynamoEndpoint,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    );
  });

  rows.forEach((row, index) => {
    const label = `#${String(index + 1).padStart(2, '0')} ${row.dealership} / ${row.service} / ${row.day} / ${row.position} / ${row.contention} / ${row.customer}`;
    it(label, async () => {
      clearCatalogCache();
      await seed({ bookings: false });
      const catalog = await getCatalog();
      const dealership = catalog.dealerships.find((d) => d.id === row.dealership)!;
      const service = catalog.services.find((s) => s.id === row.service) as ServiceTypeDto;
      const { principal, vehicle } = customers[row.customer!]!;
      const startMs = startFor(row.position!, dealership, service.durationMinutes, row.day!);

      // Arrange the contention on exactly the slots the request needs.
      const qualified = dealership.technicians.filter((t) => t.skills.includes(service.skill));
      if (row.contention === 'oneBayTaken') await lock('BAY', dealership.bays[0]!.id, startMs, service.durationMinutes);
      if (row.contention === 'allBaysTaken') for (const b of dealership.bays) await lock('BAY', b.id, startMs, service.durationMinutes);
      if (row.contention === 'qualifiedTechsTaken') for (const t of qualified) await lock('TECH', t.id, startMs, service.durationMinutes);
      if (row.contention === 'vehicleTaken') await lock('VEH', vehicle, startMs, service.durationMinutes);

      const want = expected(row, dealership);

      // The availability endpoint must agree with the booking decision whenever the start is inside opening hours.
      if (want !== 'INVALID_START_TIME') {
        const day = await getAvailability(
          { dealershipId: dealership.id, serviceTypeId: service.id, date: localDate(startMs, dealership.timezone), vehicleId: vehicle },
          principal,
        );
        const slot = day.slots.find((s) => s.startTime === iso(startMs));
        expect(slot, 'start should be listed by availability').toBeDefined();
        expect(slot!.available, 'availability agrees with the expected booking outcome').toBe(want === 'OK');
      }

      let got = 'OK';
      let booked;
      try {
        booked = await createAppointment(
          { vehicleId: vehicle, serviceTypeId: service.id, dealershipId: dealership.id, startTime: iso(startMs) },
          principal,
        );
      } catch (err) {
        got = err instanceof AppError ? err.code : `ERR:${String(err)}`;
      }
      expect(got).toBe(want);

      if (booked) {
        // A booked result must respect the constraints it was asked to respect.
        expect(qualified.map((t) => t.id)).toContain(booked.technicianId);
        expect(dealership.bays.map((b) => b.id)).toContain(booked.bayId);
        if (row.contention === 'oneBayTaken') expect(booked.bayId).not.toBe(dealership.bays[0]!.id);
        expect(booked.endTime).toBe(iso(startMs + service.durationMinutes * 60_000));
      }
    });
  });
});
