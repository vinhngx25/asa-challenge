import { randomUUID } from 'node:crypto';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
  MAX_DAYS_AHEAD,
  MIN_LEAD_MINUTES,
  type AppointmentDto,
  type AvailabilityDto,
  type AvailabilityQuery,
  type CreateAppointmentRequest,
  type DealershipDto,
  type ListAppointmentsQuery,
  type ServiceTypeDto,
} from '@asa/shared';
import { config } from '../lib/config.js';
import { db } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { GSI1, GSI2, key, type LockKind } from '../lib/keys.js';
import { logger } from '../lib/logger.js';
import { SLOT_MS, iso, localDate, openingWindow, slotStarts } from '../lib/time.js';
import type { Principal } from './auth.js';
import { getCatalog, getVehicle } from './catalog.js';

/** Test and seed hooks. Production calls leave every option unset. */
export interface BookingOptions {
  /** Current time in epoch ms. */
  now?: number;
  /** Seed only: allow start times in the past. */
  allowPast?: boolean;
}

const MAX_COMMIT_ATTEMPTS = 4;
const ALTERNATIVES_TO_OFFER = 4;
const ALTERNATIVE_DAYS_TO_SEARCH = 3;

interface Resource {
  kind: LockKind;
  id: string;
}

const resourceKey = (r: Resource) => `${r.kind}#${r.id}`;

/* ------------------------------------------------------------------ */
/* Reading the lock table                                              */
/* ------------------------------------------------------------------ */

/** Slot starts already locked for each resource within [fromMs, toMs). Consistent reads, so a just-committed booking is seen. */
async function loadBusy(resources: Resource[], fromMs: number, toMs: number): Promise<Map<string, Set<number>>> {
  const result = new Map<string, Set<number>>();
  await Promise.all(
    resources.map(async (r) => {
      const busy = new Set<number>();
      let startKey: Record<string, any> | undefined;
      do {
        const out = await db().send(
          new QueryCommand({
            TableName: config.tableName,
            KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
            ExpressionAttributeValues: {
              ':pk': key.lockPartition(r.kind, r.id),
              ':from': iso(fromMs),
              ':to': iso(toMs - SLOT_MS),
            },
            ProjectionExpression: 'SK',
            ConsistentRead: true,
            ExclusiveStartKey: startKey,
          }),
        );
        for (const item of out.Items ?? []) busy.add(Date.parse(item.SK));
        startKey = out.LastEvaluatedKey;
      } while (startKey);
      result.set(resourceKey(r), busy);
    }),
  );
  return result;
}

const isFree = (busy: Set<number> | undefined, startMs: number, durationMinutes: number): boolean =>
  slotStarts(startMs, durationMinutes).every((s) => !busy?.has(s));

interface Planning {
  dealership: DealershipDto;
  service: ServiceTypeDto;
  bays: Resource[];
  techs: Resource[];
}

function plan(dealership: DealershipDto, service: ServiceTypeDto): Planning {
  return {
    dealership,
    service,
    bays: dealership.bays.map((b) => ({ kind: 'BAY' as const, id: b.id })),
    techs: dealership.technicians
      .filter((t) => t.skills.includes(service.skill))
      .map((t) => ({ kind: 'TECH' as const, id: t.id })),
  };
}

/** The first bay and the first qualified technician free for the whole duration, or undefined. */
function pickResources(
  p: Planning,
  busy: Map<string, Set<number>>,
  startMs: number,
): { bayId: string; technicianId: string } | undefined {
  const bay = p.bays.find((b) => isFree(busy.get(resourceKey(b)), startMs, p.service.durationMinutes));
  const tech = p.techs.find((t) => isFree(busy.get(resourceKey(t)), startMs, p.service.durationMinutes));
  return bay && tech ? { bayId: bay.id, technicianId: tech.id } : undefined;
}

function checkStartRules(startMs: number, nowMs: number, allowPast: boolean): void {
  if (allowPast) return;
  if (startMs < nowMs + MIN_LEAD_MINUTES * 60_000) {
    throw new AppError('INVALID_START_TIME', `Bookings must start at least ${MIN_LEAD_MINUTES} minutes from now.`);
  }
  if (startMs > nowMs + MAX_DAYS_AHEAD * 24 * 3_600_000) {
    throw new AppError('INVALID_START_TIME', `Bookings can be made up to ${MAX_DAYS_AHEAD} days ahead.`);
  }
}

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

async function dayAvailability(
  p: Planning,
  date: string,
  vehicleId: string | undefined,
  nowMs: number,
): Promise<AvailabilityDto> {
  const { dealership, service } = p;
  const base = {
    dealershipId: dealership.id,
    serviceTypeId: service.id,
    date,
    timezone: dealership.timezone,
    durationMinutes: service.durationMinutes,
  };
  const window = openingWindow(dealership, date);
  if (!window) return { ...base, open: false, slots: [] };

  const resources: Resource[] = [...p.bays, ...p.techs, ...(vehicleId ? [{ kind: 'VEH' as const, id: vehicleId }] : [])];
  const busy = await loadBusy(resources, window.openMs, window.closeMs);
  const durationMs = service.durationMinutes * 60_000;

  const slots: AvailabilityDto['slots'] = [];
  for (let start = window.openMs; start + durationMs <= window.closeMs; start += SLOT_MS) {
    const inWindow =
      start >= nowMs + MIN_LEAD_MINUTES * 60_000 && start <= nowMs + MAX_DAYS_AHEAD * 24 * 3_600_000;
    const vehicleFree = !vehicleId || isFree(busy.get(`VEH#${vehicleId}`), start, service.durationMinutes);
    slots.push({
      startTime: iso(start),
      endTime: iso(start + durationMs),
      available: inWindow && vehicleFree && pickResources(p, busy, start) !== undefined,
    });
  }
  return { ...base, open: true, slots };
}

async function resolvePlan(dealershipId: string, serviceTypeId: string): Promise<Planning> {
  const catalog = await getCatalog();
  const dealership = catalog.dealerships.find((d) => d.id === dealershipId);
  const service = catalog.services.find((s) => s.id === serviceTypeId);
  if (!dealership) throw new AppError('NOT_FOUND', 'Dealership not found.');
  if (!service) throw new AppError('NOT_FOUND', 'Service type not found.');
  return plan(dealership, service);
}

export async function getAvailability(
  query: AvailabilityQuery,
  principal: Principal,
  options: BookingOptions = {},
): Promise<AvailabilityDto> {
  const p = await resolvePlan(query.dealershipId, query.serviceTypeId);
  if (query.vehicleId && !(await getVehicle(principal.username, query.vehicleId))) {
    throw new AppError('NOT_FOUND', 'Vehicle not found.');
  }
  return dayAvailability(p, query.date, query.vehicleId, options.now ?? Date.now());
}

/** Free start times closest to the requested one, searching the same day first and then the next few days. */
async function nearestAlternatives(p: Planning, vehicleId: string, requestedMs: number, nowMs: number): Promise<string[]> {
  const tz = p.dealership.timezone;
  for (let i = 0; i < ALTERNATIVE_DAYS_TO_SEARCH; i++) {
    const date = localDate(requestedMs + i * 24 * 3_600_000, tz);
    const day = await dayAvailability(p, date, vehicleId, nowMs);
    const free = day.slots.filter((s) => s.available).map((s) => Date.parse(s.startTime));
    if (free.length > 0) {
      return free
        .sort((a, b) => Math.abs(a - requestedMs) - Math.abs(b - requestedMs))
        .slice(0, ALTERNATIVES_TO_OFFER)
        .sort((a, b) => a - b)
        .map(iso);
    }
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransactionConflict(err: unknown): boolean {
  const name = (err as { name?: string } | undefined)?.name;
  return name === 'TransactionCanceledException' || name === 'TransactionConflictException';
}

export async function createAppointment(
  input: CreateAppointmentRequest,
  principal: Principal,
  options: BookingOptions = {},
): Promise<AppointmentDto> {
  const nowMs = options.now ?? Date.now();
  const startMs = Date.parse(input.startTime);

  if (!Number.isFinite(startMs) || startMs % SLOT_MS !== 0) {
    throw new AppError('INVALID_START_TIME', 'Start time must fall on a 30 minute boundary, for example 09:00 or 09:30.');
  }
  checkStartRules(startMs, nowMs, options.allowPast ?? false);

  const p = await resolvePlan(input.dealershipId, input.serviceTypeId);
  const vehicle = await getVehicle(principal.username, input.vehicleId);
  if (!vehicle) throw new AppError('NOT_FOUND', 'Vehicle not found.');

  const endMs = startMs + p.service.durationMinutes * 60_000;
  const window = openingWindow(p.dealership, localDate(startMs, p.dealership.timezone));
  if (!window || startMs < window.openMs || endMs > window.closeMs) {
    throw new AppError(
      'INVALID_START_TIME',
      `${p.dealership.name} is open ${p.dealership.openTime} to ${p.dealership.closeTime}, Monday to Saturday. The ${p.service.durationMinutes} minute service must finish before closing.`,
    );
  }

  for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt++) {
    const resources: Resource[] = [...p.bays, ...p.techs, { kind: 'VEH', id: vehicle.id }];
    const busy = await loadBusy(resources, startMs, endMs);
    if (!isFree(busy.get(`VEH#${vehicle.id}`), startMs, p.service.durationMinutes)) {
      throw new AppError('VEHICLE_BUSY', 'This vehicle already has an appointment that overlaps this time.');
    }
    const picked = pickResources(p, busy, startMs);

    if (!picked) break;

    const bay = p.dealership.bays.find((b) => b.id === picked.bayId)!;
    const tech = p.dealership.technicians.find((t) => t.id === picked.technicianId)!;
    const id = randomUUID();
    const item = {
      ...key.appointment(id),
      GSI1PK: `CUST#${principal.username}`,
      GSI1SK: `${iso(startMs)}#${id}`,
      GSI2PK: `DLR#${p.dealership.id}`,
      GSI2SK: `${iso(startMs)}#${id}`,
      type: 'APPOINTMENT',
      id,
      reference: `ASA-${id.slice(0, 8).toUpperCase()}`,
      status: 'BOOKED',
      customer: principal.username,
      customerName: principal.displayName,
      vehicleId: vehicle.id,
      vehicleLabel: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      vehiclePlate: vehicle.plate,
      vehicleImageKey: vehicle.imageKey,
      serviceTypeId: p.service.id,
      serviceName: p.service.name,
      skill: p.service.skill,
      durationMinutes: p.service.durationMinutes,
      dealershipId: p.dealership.id,
      dealershipName: p.dealership.name,
      technicianId: tech.id,
      technicianName: tech.name,
      technicianImageKey: tech.imageKey,
      bayId: bay.id,
      bayName: bay.name,
      startTime: iso(startMs),
      endTime: iso(endMs),
      createdAt: iso(nowMs),
    };

    try {
      await commit(item, startMs, p.service.durationMinutes);
      logger.info('Appointment booked', {
        appointmentId: id,
        dealershipId: p.dealership.id,
        bayId: bay.id,
        technicianId: tech.id,
        attempts: attempt,
      });
      return toDto(item);
    } catch (err) {
      if (!isTransactionConflict(err)) throw err;
      // Another booking took one of the slots between our read and our write.
      logger.info('Booking transaction conflict, retrying', { attempt });
      await sleep(15 + Math.random() * 60);
    }
  }

  const alternatives = await nearestAlternatives(p, vehicle.id, startMs, nowMs);
  throw new AppError(
    'SLOT_UNAVAILABLE',
    `No ${p.dealership.name} bay and qualified technician are both free from the requested time for ${p.service.durationMinutes} minutes.`,
    alternatives,
  );
}

/** One all-or-nothing write: the appointment plus a lock for every slot of the bay, the technician and the vehicle. */
async function commit(item: Record<string, any>, startMs: number, durationMinutes: number): Promise<void> {
  const locks: { kind: LockKind; id: string }[] = [
    { kind: 'BAY', id: item.bayId },
    { kind: 'TECH', id: item.technicianId },
    { kind: 'VEH', id: item.vehicleId },
  ];
  const lockPuts = locks.flatMap((r) =>
    slotStarts(startMs, durationMinutes).map((slot) => ({
      Put: {
        TableName: config.tableName,
        Item: { ...key.lock(r.kind, r.id, iso(slot)), type: 'LOCK', appointmentId: item.id },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    })),
  );
  await db().send(
    new TransactWriteCommand({
      TransactItems: [...lockPuts, { Put: { TableName: config.tableName, Item: item } }],
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Cancel                                                              */
/* ------------------------------------------------------------------ */

async function loadAppointment(id: string): Promise<Record<string, any> | undefined> {
  const out = await db().send(
    new GetCommand({ TableName: config.tableName, Key: key.appointment(id), ConsistentRead: true }),
  );
  return out.Item;
}

function assertCanAccess(item: Record<string, any>, principal: Principal): void {
  if (principal.role !== 'staff' && item.customer !== principal.username) {
    throw new AppError('FORBIDDEN', 'This appointment belongs to another customer.');
  }
}

export async function getAppointment(id: string, principal: Principal): Promise<AppointmentDto> {
  const item = await loadAppointment(id);
  if (!item) throw new AppError('NOT_FOUND', 'Appointment not found.');
  assertCanAccess(item, principal);
  return toDto(item);
}

export async function cancelAppointment(
  id: string,
  principal: Principal,
  options: BookingOptions & { force?: boolean } = {},
): Promise<AppointmentDto> {
  const item = await loadAppointment(id);
  if (!item) throw new AppError('NOT_FOUND', 'Appointment not found.');
  assertCanAccess(item, principal);
  if (item.status === 'CANCELLED') throw new AppError('ALREADY_CANCELLED', 'This appointment is already cancelled.');

  const nowMs = options.now ?? Date.now();
  if (!options.force && Date.parse(item.startTime) <= nowMs) {
    throw new AppError('CANNOT_CANCEL_PAST', 'Appointments that have started can no longer be cancelled.');
  }

  const cancelledAt = iso(nowMs);
  const startMs = Date.parse(item.startTime);
  const locks: { kind: LockKind; id: string }[] = [
    { kind: 'BAY', id: item.bayId },
    { kind: 'TECH', id: item.technicianId },
    { kind: 'VEH', id: item.vehicleId },
  ];
  const deletes = locks.flatMap((r) =>
    slotStarts(startMs, item.durationMinutes).map((slot) => ({
      Delete: {
        TableName: config.tableName,
        Key: key.lock(r.kind, r.id, iso(slot)),
        ConditionExpression: 'attribute_not_exists(PK) OR appointmentId = :id',
        ExpressionAttributeValues: { ':id': id },
      },
    })),
  );

  try {
    await db().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: config.tableName,
              Key: key.appointment(id),
              UpdateExpression: 'SET #s = :cancelled, cancelledAt = :at',
              ConditionExpression: '#s = :booked',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: { ':cancelled': 'CANCELLED', ':booked': 'BOOKED', ':at': cancelledAt },
            },
          },
          ...deletes,
        ],
      }),
    );
  } catch (err) {
    if (isTransactionConflict(err)) throw new AppError('ALREADY_CANCELLED', 'This appointment is already cancelled.');
    throw err;
  }

  logger.info('Appointment cancelled', { appointmentId: id, cancelledBy: principal.username });
  return toDto({ ...item, status: 'CANCELLED', cancelledAt });
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

export async function listAppointments(
  principal: Principal,
  query: ListAppointmentsQuery,
): Promise<AppointmentDto[]> {
  const from = query.from ?? '0000';
  const to = `${query.to ?? '9999'}~`;

  async function run(index: string, pkAttr: string, skAttr: string, pk: string): Promise<Record<string, any>[]> {
    const items: Record<string, any>[] = [];
    let startKey: Record<string, any> | undefined;
    do {
      const out = await db().send(
        new QueryCommand({
          TableName: config.tableName,
          IndexName: index,
          KeyConditionExpression: `${pkAttr} = :pk AND ${skAttr} BETWEEN :from AND :to`,
          ExpressionAttributeValues: { ':pk': pk, ':from': from, ':to': to },
          ExclusiveStartKey: startKey,
        }),
      );
      items.push(...(out.Items ?? []));
      startKey = out.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  let items: Record<string, any>[];
  if (principal.role === 'customer') {
    items = await run(GSI1, 'GSI1PK', 'GSI1SK', `CUST#${principal.username}`);
    if (query.dealershipId) items = items.filter((i) => i.dealershipId === query.dealershipId);
  } else {
    const dealershipIds = query.dealershipId
      ? [query.dealershipId]
      : (await getCatalog()).dealerships.map((d) => d.id);
    items = (await Promise.all(dealershipIds.map((d) => run(GSI2, 'GSI2PK', 'GSI2SK', `DLR#${d}`)))).flat();
  }

  return items
    .filter((i) => !query.status || i.status === query.status)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map(toDto);
}

/* ------------------------------------------------------------------ */

function toDto(i: Record<string, any>): AppointmentDto {
  return {
    id: i.id,
    reference: i.reference,
    status: i.status,
    customer: i.customer,
    customerName: i.customerName,
    vehicleId: i.vehicleId,
    vehicleLabel: i.vehicleLabel,
    vehiclePlate: i.vehiclePlate,
    vehicleImageKey: i.vehicleImageKey,
    serviceTypeId: i.serviceTypeId,
    serviceName: i.serviceName,
    skill: i.skill,
    durationMinutes: i.durationMinutes,
    dealershipId: i.dealershipId,
    dealershipName: i.dealershipName,
    technicianId: i.technicianId,
    technicianName: i.technicianName,
    technicianImageKey: i.technicianImageKey,
    bayId: i.bayId,
    bayName: i.bayName,
    startTime: i.startTime,
    endTime: i.endTime,
    createdAt: i.createdAt,
    ...(i.cancelledAt ? { cancelledAt: i.cancelledAt } : {}),
  };
}
