/**
 * Boundary value analysis. For every rule the test touches the value just inside, exactly on, and just outside the limit.
 *   Opening hours     per duration (30, 60, 120, 240): first start, one slot before, last start that fits, one slot after
 *   30 minute grid    on grid, +/-1 ms, +/-1 min, +/-29 min
 *   Lead time         exactly 60 min, one millisecond short, one slot short
 *   Horizon           exactly 60 days, one slot beyond
 *   Cancel cut-off    one millisecond before the start, exactly at the start
 *   Clock change      the day opening hours shift between BST and GMT
 *   Capacity          every slot of a one-bay day, then one more
 *   Locks written     exactly one lock per slot and resource
 *   Inputs            date strings, field lengths, body shapes
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/lib/config.js';
import { db } from '../src/lib/db.js';
import { AppError } from '../src/lib/errors.js';
import { iso, localParts, zonedToUtc } from '../src/lib/time.js';
import type { Principal } from '../src/services/auth.js';
import { cancelAppointment, createAppointment, getAvailability } from '../src/services/booking.js';
import { clearCatalogCache } from '../src/services/catalog.js';
import { ensureTable, seed } from '../src/seed/seed.js';

const wick: Principal = { username: 'JoinWick', displayName: 'John Wick', role: 'customer' };
const MIN = 60_000;
const SLOT = 30 * MIN;

/** A working Wednesday about five weeks ahead, as a local date. */
function testDay(): { y: number; m: number; d: number } {
  const t = localParts(Date.now() + 35 * 24 * 3_600_000, 'Europe/London');
  const base = new Date(Date.UTC(t.year, t.month - 1, t.day));
  base.setUTCDate(base.getUTCDate() + ((3 - base.getUTCDay() + 7) % 7));
  return { y: base.getUTCFullYear(), m: base.getUTCMonth() + 1, d: base.getUTCDate() };
}
const localMs = (hh: number, mm = 0, shiftDays = 0): number => {
  const { y, m, d } = testDay();
  return zonedToUtc(y, m, d + shiftDays, hh, mm, 'Europe/London');
};

const book = (
  vehicleId: string,
  serviceTypeId: string,
  dealershipId: string,
  startMs: number,
  opts: { now?: number; allowPast?: boolean } = {},
) =>
  createAppointment({ vehicleId, serviceTypeId, dealershipId, startTime: iso(startMs) }, wick, opts);

async function outcome(p: Promise<unknown>): Promise<string> {
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

describe('opening hours: first start, one slot before, last start that fits, one slot after', () => {
  // Kensington is open 08:00 to 18:00. One service of each duration.
  const cases = [
    { service: 'fluid-check', minutes: 30 },
    { service: 'mot', minutes: 60 },
    { service: 'front-pads', minutes: 120 },
    { service: 'full-service', minutes: 240 },
  ];
  for (const { service, minutes } of cases) {
    it(`${minutes} minute service`, async () => {
      const open = localMs(8);
      const close = localMs(18);
      const dur = minutes * MIN;
      expect(await outcome(book('wick-mustang', service, 'kensington', open - SLOT))).toBe('INVALID_START_TIME');
      expect(await outcome(book('wick-mustang', service, 'kensington', close - dur + SLOT))).toBe('INVALID_START_TIME');
      expect(await outcome(book('wick-mustang', service, 'kensington', close))).toBe('INVALID_START_TIME');
      expect(await outcome(book('wick-mustang', service, 'kensington', open))).toBe('OK');
      expect(await outcome(book('wick-mustang', service, 'kensington', close - dur))).toBe('OK');
    });
  }

  it('a Saturday follows the same hours and Sunday is closed from the first to the last minute', async () => {
    expect(await outcome(book('wick-mustang', 'mot', 'kensington', localMs(8, 0, 3)))).toBe('OK'); // Saturday 08:00
    expect(await outcome(book('wick-charger', 'mot', 'kensington', localMs(8, 0, 4)))).toBe('INVALID_START_TIME'); // Sunday open
    expect(await outcome(book('wick-charger', 'mot', 'kensington', localMs(17, 0, 4)))).toBe('INVALID_START_TIME'); // Sunday close-60
    expect(await outcome(book('wick-charger', 'mot', 'kensington', localMs(8, 0, 5)))).toBe('OK'); // Monday 08:00
  });

  it('manchester opens on a half hour (08:30) and closes 17:30', async () => {
    expect(await outcome(book('wick-mustang', 'fluid-check', 'manchester', localMs(8)))).toBe('INVALID_START_TIME');
    expect(await outcome(book('wick-mustang', 'fluid-check', 'manchester', localMs(8, 30)))).toBe('OK');
    expect(await outcome(book('wick-charger', 'fluid-check', 'manchester', localMs(17, 30)))).toBe('INVALID_START_TIME');
    expect(await outcome(book('wick-charger', 'fluid-check', 'manchester', localMs(17)))).toBe('OK');
  });
});

describe('30 minute grid', () => {
  it('accepts only exact slot starts', async () => {
    const base = localMs(10);
    for (const off of [-29 * MIN, -MIN, -1, 1, MIN, 29 * MIN]) {
      expect(await outcome(book('wick-mustang', 'fluid-check', 'kensington', base + off)), `offset ${off} ms`).toBe(
        'INVALID_START_TIME',
      );
    }
    expect(await outcome(book('wick-mustang', 'fluid-check', 'kensington', base))).toBe('OK');
    expect(await outcome(book('wick-mustang', 'fluid-check', 'kensington', base + SLOT))).toBe('OK');
  });
});

describe('lead time (60 minutes) and horizon (60 days)', () => {
  const now = () => localMs(9); // 09:00 on the test day, an exact slot start

  it('allows exactly 60 minutes ahead and rejects one slot or one millisecond less', async () => {
    const n = now();
    expect(await outcome(book('wick-mustang', 'fluid-check', 'kensington', n + SLOT, { now: n }))).toBe('INVALID_START_TIME');
    expect(await outcome(book('wick-mustang', 'fluid-check', 'kensington', n + 60 * MIN, { now: n }))).toBe('OK');
  });

  it('one millisecond after the boundary moment, the same start is already too soon', async () => {
    const n = now();
    expect(await outcome(book('wick-mustang', 'fluid-check', 'kensington', n + 60 * MIN, { now: n + 1 }))).toBe('INVALID_START_TIME');
    expect(await outcome(book('wick-mustang', 'fluid-check', 'kensington', n + 90 * MIN, { now: n + 1 }))).toBe('OK');
  });

  it('a start in the past is rejected', async () => {
    const n = now();
    expect(await outcome(book('wick-mustang', 'fluid-check', 'kensington', n - SLOT, { now: n }))).toBe('INVALID_START_TIME');
  });

  it('allows exactly 60 days ahead and rejects one slot beyond', async () => {
    const start = zonedToUtc(2027, 6, 2, 10, 0, 'Europe/London'); // Wednesday
    const n = start - 60 * 24 * 3_600_000;
    expect(await outcome(book('wick-mustang', 'fluid-check', 'kensington', start + SLOT, { now: n }))).toBe('INVALID_START_TIME');
    expect(await outcome(book('wick-mustang', 'fluid-check', 'kensington', start, { now: n }))).toBe('OK');
  });
});

describe('cancel cut-off', () => {
  it('works one millisecond before the start and is refused exactly at the start', async () => {
    const startA = localMs(10);
    const startB = localMs(12);
    const a = await book('wick-mustang', 'mot', 'kensington', startA);
    const b = await book('wick-charger', 'mot', 'kensington', startB);
    expect(await outcome(cancelAppointment(a.id, wick, { now: startA - 1 }))).toBe('OK');
    expect(await outcome(cancelAppointment(b.id, wick, { now: startB }))).toBe('CANNOT_CANCEL_PAST');
    expect(await outcome(cancelAppointment(b.id, wick, { now: startB + 1 }))).toBe('CANNOT_CANCEL_PAST');
  });
});

describe('clock change: opening hours move by an hour in UTC', () => {
  it('Saturday 24 Oct 2026 (BST) opens at 07:00Z, Monday 26 Oct 2026 (GMT) opens at 08:00Z', async () => {
    const now = Date.parse('2026-10-01T00:00:00Z');
    const opts = { now };
    expect(await outcome(createAppointment({ vehicleId: 'wick-mustang', serviceTypeId: 'fluid-check', dealershipId: 'kensington', startTime: '2026-10-24T06:30:00.000Z' }, wick, opts))).toBe('INVALID_START_TIME');
    expect(await outcome(createAppointment({ vehicleId: 'wick-mustang', serviceTypeId: 'fluid-check', dealershipId: 'kensington', startTime: '2026-10-24T07:00:00.000Z' }, wick, opts))).toBe('OK');
    expect(await outcome(createAppointment({ vehicleId: 'wick-charger', serviceTypeId: 'fluid-check', dealershipId: 'kensington', startTime: '2026-10-26T07:00:00.000Z' }, wick, opts))).toBe('INVALID_START_TIME');
    expect(await outcome(createAppointment({ vehicleId: 'wick-charger', serviceTypeId: 'fluid-check', dealershipId: 'kensington', startTime: '2026-10-26T08:00:00.000Z' }, wick, opts))).toBe('OK');
  });

  it('spring change: Saturday 27 Mar 2027 (GMT) opens 08:00Z, Monday 29 Mar 2027 (BST) opens 07:00Z', async () => {
    const opts = { now: Date.parse('2027-03-01T00:00:00Z') };
    const at = (v: string, startTime: string) => createAppointment({ vehicleId: v, serviceTypeId: 'fluid-check', dealershipId: 'kensington', startTime }, wick, opts);
    expect(await outcome(at('wick-mustang', '2027-03-27T07:30:00.000Z'))).toBe('INVALID_START_TIME');
    expect(await outcome(at('wick-mustang', '2027-03-27T08:00:00.000Z'))).toBe('OK');
    expect(await outcome(at('wick-charger', '2027-03-29T06:30:00.000Z'))).toBe('INVALID_START_TIME');
    expect(await outcome(at('wick-charger', '2027-03-29T07:00:00.000Z'))).toBe('OK');
  });

  it('availability lists the same number of slots on both sides of the change', async () => {
    const opts = { now: Date.parse('2026-10-01T00:00:00Z') };
    const sat = await getAvailability({ dealershipId: 'kensington', serviceTypeId: 'mot', date: '2026-10-24' }, wick, opts);
    const mon = await getAvailability({ dealershipId: 'kensington', serviceTypeId: 'mot', date: '2026-10-26' }, wick, opts);
    expect(sat.slots).toHaveLength(mon.slots.length);
    expect(sat.slots[0]!.startTime).toBe('2026-10-24T07:00:00.000Z');
    expect(mon.slots[0]!.startTime).toBe('2026-10-26T08:00:00.000Z');
  });
});

describe('capacity: a one-bay day fills exactly, then refuses', () => {
  it('manchester 08:30 to 17:30 holds 18 thirty-minute jobs and refuses the 19th', async () => {
    const open = localMs(8, 30);
    for (let i = 0; i < 18; i++) {
      const vehicle = ['wick-mustang', 'wick-chevelle', 'wick-charger'][i % 3]!;
      expect(await outcome(book(vehicle, 'fluid-check', 'manchester', open + i * SLOT)), `job ${i + 1}`).toBe('OK');
    }
    const day = await getAvailability(
      { dealershipId: 'manchester', serviceTypeId: 'fluid-check', date: iso(open).slice(0, 10) },
      wick,
    );
    expect(day.slots.filter((s) => s.available)).toHaveLength(0);
    // wick-mustang is busy at the first slot itself, so use a vehicle that is free then: the bay is the only blocker.
    expect(await outcome(book('wick-chevelle', 'fluid-check', 'manchester', open))).toBe('SLOT_UNAVAILABLE');
    expect(await outcome(book('wick-mustang', 'fluid-check', 'manchester', open + 18 * SLOT))).toBe('INVALID_START_TIME');
  });
});

describe('locks written: exactly one per slot and resource', () => {
  async function lockCount(): Promise<number> {
    let n = 0;
    let startKey: Record<string, any> | undefined;
    do {
      const out = await db().send(
        new ScanCommand({
          TableName: config.tableName,
          FilterExpression: '#t = :lock',
          ExpressionAttributeNames: { '#t': 'type' },
          ExpressionAttributeValues: { ':lock': 'LOCK' },
          ExclusiveStartKey: startKey,
        }),
      );
      n += out.Count ?? 0;
      startKey = out.LastEvaluatedKey;
    } while (startKey);
    return n;
  }

  for (const [service, slots] of [
    ['fluid-check', 1],
    ['mot', 2],
    ['front-pads', 4],
    ['full-service', 8],
  ] as const) {
    it(`${service}: ${slots} slot(s) x 3 resources`, async () => {
      expect(await lockCount()).toBe(0);
      const appt = await book('wick-mustang', service, 'kensington', localMs(9));
      expect(await lockCount()).toBe(slots * 3);
      await cancelAppointment(appt.id, wick);
      expect(await lockCount()).toBe(0);
    });
  }

  it('lock partitions hold exactly the slots of the booking, in order', async () => {
    const appt = await book('wick-mustang', 'front-pads', 'kensington', localMs(9));
    const out = await db().send(
      new QueryCommand({
        TableName: config.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `LOCK#BAY#${appt.bayId}` },
      }),
    );
    expect(out.Items!.map((i) => i.SK)).toEqual([0, 1, 2, 3].map((n) => iso(localMs(9) + n * SLOT)));
  });
});

function testDateString(): string {
  const { y, m, d } = testDay();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

describe('request inputs through the HTTP layer', () => {
  const app = createApp();
  let token = '';

  async function call(method: string, path: string, body?: unknown, withToken = true) {
    const res = await app.request(`/api${path}`, {
      method,
      headers: {
        ...(withToken && token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  }

  beforeAll(async () => {
    await seed({ bookings: false });
    const r = await call('POST', '/auth/login', { username: 'JoinWick', password: 'JoinWick' }, false);
    token = r.body.token;
  });

  it('login field lengths: 0 and over 32 are invalid input, 1 to 32 are just wrong credentials', async () => {
    const login = (username: string, password: string) => call('POST', '/auth/login', { username, password }, false);
    expect((await login('', 'x')).status).toBe(400);
    expect((await login('x', '')).status).toBe(400);
    expect((await login('a', 'b')).status).toBe(401);
    expect((await login('a'.repeat(31), 'b')).status).toBe(401);
    expect((await login('a'.repeat(32), 'b')).status).toBe(401);
    expect((await login('a'.repeat(33), 'b')).status).toBe(400);
    expect((await login('a', 'b'.repeat(31))).status).toBe(401);
    expect((await login('a', 'b'.repeat(32))).status).toBe(401);
    expect((await login('a', 'b'.repeat(33))).status).toBe(400);
    // The server counts characters (code points): 32 emoji fit, 33 do not. The browser box counts UTF-16 units, so it
    // stops at 16 emoji; that is stricter than the server, never looser.
    expect((await login('\u{1F697}'.repeat(32), 'b')).status).toBe(401);
    expect((await login('\u{1F697}'.repeat(33), 'b')).status).toBe(400);
  });

  it('password: no white space at all (space, tab, new line, non-breaking space), in any position', async () => {
    const login = (password: string, username = 'JoinWick') => call('POST', '/auth/login', { username, password }, false);
    for (const bad of ['a b', ' ab', 'ab ', ' ', '   ', 'a\tb', 'a\nb', 'a\r\nb', 'a\u00a0b', 'a\u2003b', 'Join Wick']) {
      const r = await login(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.error.message).toMatch(/Password cannot contain spaces/);
    }
    // Without white space the password is just checked: wrong is 401, right is 200, 32 characters long is fine.
    expect((await login('JoinWick1')).status).toBe(401);
    expect((await login('x'.repeat(32))).status).toBe(401);
    expect((await login('JoinWick')).status).toBe(200);
    // The username may still contain a space: it is just not an existing account.
    expect((await login('x', 'Join Wick')).status).toBe(401);
  });

  it('record ids: up to 64 characters are looked up (404), 65 or more are invalid input (400), in every position', async () => {
    const ok = 'a'.repeat(64);
    const bad = 'a'.repeat(65);
    const book = (vehicleId: string, serviceTypeId: string, dealershipId: string) =>
      call('POST', '/appointments', { vehicleId, serviceTypeId, dealershipId, startTime: iso(localMs(10)) });
    expect((await book(ok, 'mot', 'kensington')).status).toBe(404);
    expect((await book(bad, 'mot', 'kensington')).status).toBe(400);
    expect((await book('wick-mustang', ok, 'kensington')).status).toBe(404);
    expect((await book('wick-mustang', bad, 'kensington')).status).toBe(400);
    expect((await book('wick-mustang', 'mot', ok)).status).toBe(404);
    expect((await book('wick-mustang', 'mot', bad)).status).toBe(400);
    const avail = (q: string) => call('GET', `/availability?${q}&date=${testDateString()}`);
    expect((await avail(`dealershipId=${ok}&serviceTypeId=mot`)).status).toBe(404);
    expect((await avail(`dealershipId=${bad}&serviceTypeId=mot`)).status).toBe(400);
    expect((await avail(`dealershipId=kensington&serviceTypeId=${bad}`)).status).toBe(400);
    expect((await avail(`dealershipId=kensington&serviceTypeId=mot&vehicleId=${ok}`)).status).toBe(404);
    expect((await avail(`dealershipId=kensington&serviceTypeId=mot&vehicleId=${bad}`)).status).toBe(400);
    expect((await call('GET', `/appointments/${ok}`)).status).toBe(404);
    expect((await call('GET', `/appointments/${bad}`)).status).toBe(400);
    expect((await call('POST', `/appointments/${bad}/cancel`)).status).toBe(400);
    // Far past DynamoDB's key limits: still a clean 400, never a server error.
    expect((await call('GET', `/appointments/${'a'.repeat(3000)}`)).status).toBe(400);
    expect((await avail(`dealershipId=kensington&serviceTypeId=mot&vehicleId=${'a'.repeat(1500)}`)).status).toBe(400);
  });

  it('body shapes: malformed JSON, array, null, wrong types and missing fields are 400', async () => {
    expect((await call('POST', '/auth/login', '{not json', false)).status).toBe(400);
    expect((await call('POST', '/auth/login', [], false)).status).toBe(400);
    expect((await call('POST', '/auth/login', 'null', false)).status).toBe(400);
    expect((await call('POST', '/auth/login', { username: 1, password: 2 }, false)).status).toBe(400);
    expect((await call('POST', '/auth/login', { username: 'JoinWick' }, false)).status).toBe(400);
    // Unknown extra fields are ignored.
    expect((await call('POST', '/auth/login', { username: 'JoinWick', password: 'JoinWick', extra: true }, false)).status).toBe(200);
  });

  it('availability date: only real calendar days in YYYY-MM-DD are accepted', async () => {
    const q = (date: string) =>
      call('GET', `/availability?dealershipId=kensington&serviceTypeId=mot&date=${encodeURIComponent(date)}`);
    for (const bad of ['', '2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-1', '26-01-01', 'abcd-ef-gh', '2026/01/01', '0000-01-01']) {
      expect((await q(bad)).status, `date ${JSON.stringify(bad)}`).toBe(400);
    }
    for (const good of ['2028-02-29', '2026-12-31', '2027-01-01', '1999-12-31', '2100-01-03']) {
      expect((await q(good)).status, `date ${good}`).toBe(200);
    }
    expect((await q('1999-12-31')).body.slots.every((s: { available: boolean }) => !s.available)).toBe(true);
  });

  it('start time format: only ISO 8601 UTC instants are accepted', async () => {
    const post = (startTime: unknown) =>
      call('POST', '/appointments', { vehicleId: 'wick-mustang', serviceTypeId: 'fluid-check', dealershipId: 'kensington', startTime });
    for (const bad of ['', 'tomorrow', '2026-10-21', '2026-10-21T10:00', '2026-10-21 10:00:00Z', 20261021, null, '2026-10-21T10:00:00+01:00']) {
      expect((await post(bad)).status, `startTime ${JSON.stringify(bad)}`).toBe(400);
    }
  });

  it('list filters: malformed dates and unknown status are 400', async () => {
    expect((await call('GET', '/appointments?from=yesterday')).status).toBe(400);
    expect((await call('GET', '/appointments?status=DONE')).status).toBe(400);
    expect((await call('GET', '/appointments?from=2026-01-01T00:00:00Z&to=2030-01-01T00:00:00Z')).status).toBe(200);
  });
});
