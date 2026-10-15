import { QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SKILLS, type CatalogDto, type DealershipDto, type ServiceTypeDto, type VehicleDto } from '@asa/shared';
import { config } from '../lib/config.js';
import { db } from '../lib/db.js';
import { CATALOG_DEALERSHIPS, CATALOG_SERVICES, GSI1, key } from '../lib/keys.js';

const CACHE_MS = 60_000;
let cache: { at: number; value: CatalogDto } | undefined;

export function clearCatalogCache(): void {
  cache = undefined;
}

async function queryAll(input: ConstructorParameters<typeof QueryCommand>[0]): Promise<Record<string, any>[]> {
  const items: Record<string, any>[] = [];
  let startKey: Record<string, any> | undefined;
  do {
    const out = await db().send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }));
    items.push(...(out.Items ?? []));
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return items;
}

async function loadCatalog(): Promise<CatalogDto> {
  const [dealershipItems, serviceItems] = await Promise.all([
    queryAll({
      TableName: config.tableName,
      IndexName: GSI1,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': CATALOG_DEALERSHIPS },
    }),
    queryAll({
      TableName: config.tableName,
      IndexName: GSI1,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': CATALOG_SERVICES },
    }),
  ]);

  const dealerships: DealershipDto[] = await Promise.all(
    dealershipItems.map(async (d) => {
      const children = await queryAll({
        TableName: config.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `DLR#${d.id}` },
      });
      return {
        id: d.id,
        name: d.name,
        city: d.city,
        address: d.address,
        timezone: d.timezone,
        openDays: d.openDays,
        openTime: d.openTime,
        closeTime: d.closeTime,
        imageKey: d.imageKey,
        bays: children
          .filter((c) => c.type === 'BAY')
          .map((c) => ({ id: c.id, name: c.name }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        technicians: children
          .filter((c) => c.type === 'TECH')
          .map((c) => ({ id: c.id, name: c.name, skills: c.skills, imageKey: c.imageKey }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      };
    }),
  );

  const services: ServiceTypeDto[] = serviceItems.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    skill: s.skill,
    durationMinutes: s.durationMinutes,
  }));

  return {
    dealerships: dealerships.sort((a, b) => a.name.localeCompare(b.name)),
    services: services.sort((a, b) => a.durationMinutes - b.durationMinutes || a.name.localeCompare(b.name)),
    skills: SKILLS.map((s) => ({ id: s.id, name: s.name })),
  };
}

/** The catalog changes only when the seed runs, so a short in-memory cache saves reads on every request. */
export async function getCatalog(): Promise<CatalogDto> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = await loadCatalog();
  cache = { at: Date.now(), value };
  return value;
}

export async function listVehicles(username: string): Promise<VehicleDto[]> {
  const items = await queryAll({
    TableName: config.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `USER#${username}`, ':sk': 'VEH#' },
  });
  return items.map(toVehicle);
}

export async function getVehicle(username: string, id: string): Promise<VehicleDto | undefined> {
  const out = await db().send(new GetCommand({ TableName: config.tableName, Key: key.vehicle(username, id) }));
  return out.Item ? toVehicle(out.Item) : undefined;
}

function toVehicle(v: Record<string, any>): VehicleDto {
  return { id: v.id, make: v.make, model: v.model, year: v.year, plate: v.plate, imageKey: v.imageKey };
}
