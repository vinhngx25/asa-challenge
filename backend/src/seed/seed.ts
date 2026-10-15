import {
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
  waitUntilTableExists,
  type DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { Principal } from '../services/auth.js';
import { hashPassword } from '../services/auth.js';
import { cancelAppointment, createAppointment } from '../services/booking.js';
import { clearCatalogCache } from '../services/catalog.js';
import { config } from '../lib/config.js';
import { db } from '../lib/db.js';
import { CATALOG_DEALERSHIPS, CATALOG_SERVICES, key } from '../lib/keys.js';
import { localParts, zonedToUtc } from '../lib/time.js';
import { BOOKINGS, DEALERSHIPS, SERVICES, USERS, VEHICLES } from './data.js';

/** Table definition used for DynamoDB Local. The CDK stack defines the same shape for AWS. */
export async function ensureTable(client: DynamoDBClient): Promise<void> {
  try {
    await client.send(new DescribeTableCommand({ TableName: config.tableName }));
    return;
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }
  await client.send(
    new CreateTableCommand({
      TableName: config.tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
        { AttributeName: 'GSI2PK', AttributeType: 'S' },
        { AttributeName: 'GSI2SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI2',
          KeySchema: [
            { AttributeName: 'GSI2PK', KeyType: 'HASH' },
            { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: config.tableName });
}

/** Deletes every item so a seed run always starts from the same state. */
async function wipe(): Promise<number> {
  let deleted = 0;
  let startKey: Record<string, any> | undefined;
  do {
    const out = await db().send(
      new ScanCommand({ TableName: config.tableName, ProjectionExpression: 'PK, SK', ExclusiveStartKey: startKey }),
    );
    const items = out.Items ?? [];
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25).map((k) => ({ DeleteRequest: { Key: { PK: k.PK, SK: k.SK } } }));
      await db().send(new BatchWriteCommand({ RequestItems: { [config.tableName]: batch } }));
    }
    deleted += items.length;
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return deleted;
}

const put = (Item: Record<string, any>) => db().send(new PutCommand({ TableName: config.tableName, Item }));

/** Local calendar date (Europe/London) `offset` days from today, with Sundays moved to Monday. */
function bookingStart(offsetDays: number, time: string, timezone: string, nowMs: number): number {
  const today = localParts(nowMs, timezone);
  const base = new Date(Date.UTC(today.year, today.month - 1, today.day + offsetDays));
  if (base.getUTCDay() === 0) base.setUTCDate(base.getUTCDate() + 1);
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour, minute, timezone);
}

export interface SeedSummary {
  wiped: number;
  dealerships: number;
  bays: number;
  technicians: number;
  services: number;
  users: number;
  vehicles: number;
  appointments: number;
  cancelled: number;
}

export async function seed(options: { bookings?: boolean } = {}): Promise<SeedSummary> {
  const wiped = await wipe();
  clearCatalogCache();

  let bays = 0;
  let technicians = 0;
  for (const d of DEALERSHIPS) {
    const { bayCount, technicians: techs, ...fields } = d;
    await put({ ...key.dealership(d.id), GSI1PK: CATALOG_DEALERSHIPS, GSI1SK: d.id, type: 'DEALERSHIP', ...fields });
    for (let n = 1; n <= bayCount; n++) {
      const id = `${d.id}-bay-${n}`;
      await put({ ...key.bay(d.id, id), type: 'BAY', id, name: `Bay ${n}`, dealershipId: d.id });
      bays++;
    }
    for (const t of techs) {
      await put({
        ...key.tech(d.id, t.id),
        type: 'TECH',
        id: t.id,
        name: t.name,
        skills: t.skills,
        imageKey: `tech-${t.id}`,
        dealershipId: d.id,
      });
      technicians++;
    }
  }

  for (const s of SERVICES) {
    await put({ ...key.service(s.id), GSI1PK: CATALOG_SERVICES, GSI1SK: s.id, type: 'SERVICE', ...s });
  }

  for (const u of USERS) {
    const { password, ...fields } = u;
    await put({ ...key.user(u.username), type: 'USER', ...fields, passwordHash: await hashPassword(password) });
  }

  for (const { owner, ...v } of VEHICLES) {
    await put({ ...key.vehicle(owner, v.id), type: 'VEHICLE', owner, ...v });
  }

  const nowMs = Date.now();
  let appointments = 0;
  let cancelled = 0;
  for (const b of options.bookings === false ? [] : BOOKINGS) {
    const user = USERS.find((u) => u.username === b.username)!;
    const dealership = DEALERSHIPS.find((d) => d.id === b.dealershipId)!;
    const principal: Principal = { username: user.username, displayName: user.displayName, role: user.role };
    const startMs = bookingStart(b.dayOffset, b.time, dealership.timezone, nowMs);
    const appt = await createAppointment(
      {
        vehicleId: b.vehicleId,
        serviceTypeId: b.serviceId,
        dealershipId: b.dealershipId,
        startTime: new Date(startMs).toISOString(),
      },
      principal,
      { now: nowMs, allowPast: b.dayOffset < 0 },
    );
    appointments++;
    if (b.cancel) {
      await cancelAppointment(appt.id, principal, { now: nowMs });
      cancelled++;
    }
  }

  return {
    wiped,
    dealerships: DEALERSHIPS.length,
    bays,
    technicians,
    services: SERVICES.length,
    users: USERS.length,
    vehicles: VEHICLES.length,
    appointments,
    cancelled,
  };
}
