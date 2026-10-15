import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/lib/config.js';
import { iso, localParts, zonedToUtc } from '../src/lib/time.js';
import { clearCatalogCache } from '../src/services/catalog.js';
import { ensureTable, seed } from '../src/seed/seed.js';

const app = createApp();

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: {
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
}

const tokens: Record<string, string> = {};

async function signIn(username: string): Promise<string> {
  const r = await call('POST', '/auth/login', { body: { username, password: username } });
  expect(r.status).toBe(200);
  return r.body.token;
}

function nextWednesdayAt(hour: number): string {
  const t = localParts(Date.now() + 35 * 24 * 3_600_000, 'Europe/London');
  const base = new Date(Date.UTC(t.year, t.month - 1, t.day));
  base.setUTCDate(base.getUTCDate() + ((3 - base.getUTCDay() + 7) % 7));
  return iso(zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour, 0, 'Europe/London'));
}

beforeAll(async () => {
  await ensureTable(
    new DynamoDBClient({
      region: config.region,
      endpoint: config.dynamoEndpoint,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  );
  clearCatalogCache();
  await seed();
  for (const u of ['JoinWick', 'JamesBond', 'Winston']) tokens[u] = await signIn(u);
});

describe('login', () => {
  it('is case sensitive for both fields', async () => {
    expect((await call('POST', '/auth/login', { body: { username: 'joinwick', password: 'JoinWick' } })).status).toBe(401);
    expect((await call('POST', '/auth/login', { body: { username: 'JoinWick', password: 'joinwick' } })).status).toBe(401);
    expect((await call('POST', '/auth/login', { body: { username: 'JoinWick', password: 'Join Wick' } })).status).toBe(401);
  });

  it('returns a uniform error for wrong user and wrong password', async () => {
    const unknown = await call('POST', '/auth/login', { body: { username: 'Nobody', password: 'x' } });
    const wrong = await call('POST', '/auth/login', { body: { username: 'JoinWick', password: 'x' } });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
    expect(unknown.body.error.requestId).toBeTruthy();
  });

  it('rejects an invalid body with INVALID_INPUT', async () => {
    const r = await call('POST', '/auth/login', { body: { username: '' } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_INPUT');
  });

  it('reports the signed-in user and role', async () => {
    const me = await call('GET', '/me', { token: tokens.Winston! });
    expect(me.body).toMatchObject({ username: 'Winston', role: 'staff', displayName: 'Winston Scott' });
  });
});

describe('access control', () => {
  it('keeps the data API closed without a token or with a bad one', async () => {
    expect((await call('GET', '/catalog')).status).toBe(401);
    expect((await call('GET', '/appointments')).status).toBe(401);
    expect((await call('GET', '/appointments', { token: 'not.a.token' })).status).toBe(401);
  });

  it('leaves only health public', async () => {
    const r = await call('GET', '/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(r.headers.get('x-request-id')).toBeTruthy();
  });

  it('shows each customer only their own appointments', async () => {
    const wick = await call('GET', '/appointments', { token: tokens.JoinWick! });
    const bond = await call('GET', '/appointments', { token: tokens.JamesBond! });
    expect(wick.body.length).toBeGreaterThan(0);
    expect(wick.body.every((a: { customer: string }) => a.customer === 'JoinWick')).toBe(true);
    expect(bond.body.every((a: { customer: string }) => a.customer === 'JamesBond')).toBe(true);
  });

  it('shows staff every appointment, with the dealership filter', async () => {
    const all = await call('GET', '/appointments', { token: tokens.Winston! });
    const customers = new Set(all.body.map((a: { customer: string }) => a.customer));
    expect(customers).toEqual(new Set(['JoinWick', 'JamesBond']));
    const filtered = await call('GET', '/appointments?dealershipId=birmingham', { token: tokens.Winston! });
    expect(filtered.body.length).toBeGreaterThan(0);
    expect(filtered.body.every((a: { dealershipId: string }) => a.dealershipId === 'birmingham')).toBe(true);
  });

  it('forbids staff from booking and customers from the others vehicles', async () => {
    const body = { vehicleId: 'wick-mustang', serviceTypeId: 'mot', dealershipId: 'kensington', startTime: nextWednesdayAt(9) };
    expect((await call('POST', '/appointments', { token: tokens.Winston!, body })).status).toBe(403);
    expect((await call('POST', '/appointments', { token: tokens.JamesBond!, body })).status).toBe(404);
    expect((await call('GET', '/vehicles', { token: tokens.Winston! })).status).toBe(403);
  });

  it('hides one customer appointment from another', async () => {
    const wick = await call('GET', '/appointments', { token: tokens.JoinWick! });
    const id = wick.body[0].id;
    expect((await call('GET', `/appointments/${id}`, { token: tokens.JamesBond! })).status).toBe(403);
    expect((await call('POST', `/appointments/${id}/cancel`, { token: tokens.JamesBond! })).status).toBe(403);
    expect((await call('GET', `/appointments/${id}`, { token: tokens.JoinWick! })).status).toBe(200);
  });
});

describe('booking through the API', () => {
  it('books, returns 201 with the full record, and answers 409 with alternatives on a clash', async () => {
    const body = { vehicleId: 'wick-chevelle', serviceTypeId: 'oil-change', dealershipId: 'manchester', startTime: nextWednesdayAt(10) };
    const first = await call('POST', '/appointments', { token: tokens.JoinWick!, body });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      status: 'BOOKED',
      customer: 'JoinWick',
      vehicleId: 'wick-chevelle',
      dealershipId: 'manchester',
      bayId: 'manchester-bay-1',
    });
    expect(first.body.technicianId).toBeTruthy();

    const clash = await call('POST', '/appointments', {
      token: tokens.JamesBond!,
      body: { ...body, vehicleId: 'bond-db5' },
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('SLOT_UNAVAILABLE');
    expect(clash.body.error.alternatives.length).toBeGreaterThan(0);

    const cancel = await call('POST', `/appointments/${first.body.id}/cancel`, { token: tokens.JoinWick! });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');

    const retry = await call('POST', '/appointments', { token: tokens.JamesBond!, body: { ...body, vehicleId: 'bond-db5' } });
    expect(retry.status).toBe(201);
  });

  it('validates the request body', async () => {
    const r = await call('POST', '/appointments', {
      token: tokens.JoinWick!,
      body: { vehicleId: 'wick-mustang', serviceTypeId: 'mot', dealershipId: 'kensington', startTime: 'tomorrow' },
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_INPUT');
  });

  it('serves the catalog with 3 dealerships, 5 bays, 13 technicians and 24 services', async () => {
    const r = await call('GET', '/catalog', { token: tokens.JoinWick! });
    expect(r.body.dealerships).toHaveLength(3);
    expect(r.body.dealerships.flatMap((d: { bays: unknown[] }) => d.bays)).toHaveLength(5);
    expect(r.body.dealerships.flatMap((d: { technicians: unknown[] }) => d.technicians)).toHaveLength(13);
    expect(r.body.services).toHaveLength(24);
  });
});
