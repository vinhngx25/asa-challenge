export type LockKind = 'BAY' | 'TECH' | 'VEH';

export const key = {
  dealership: (id: string) => ({ PK: `DLR#${id}`, SK: 'META' }),
  bay: (dealershipId: string, id: string) => ({ PK: `DLR#${dealershipId}`, SK: `BAY#${id}` }),
  tech: (dealershipId: string, id: string) => ({ PK: `DLR#${dealershipId}`, SK: `TECH#${id}` }),
  service: (id: string) => ({ PK: `SVC#${id}`, SK: 'META' }),
  user: (username: string) => ({ PK: `USER#${username}`, SK: 'META' }),
  vehicle: (username: string, id: string) => ({ PK: `USER#${username}`, SK: `VEH#${id}` }),
  appointment: (id: string) => ({ PK: `APPT#${id}`, SK: 'META' }),
  lockPartition: (kind: LockKind, id: string) => `LOCK#${kind}#${id}`,
  lock: (kind: LockKind, id: string, slotIso: string) => ({ PK: `LOCK#${kind}#${id}`, SK: slotIso }),
};

export const GSI1 = 'GSI1';
export const GSI2 = 'GSI2';
export const CATALOG_DEALERSHIPS = 'CATALOG#DEALERSHIPS';
export const CATALOG_SERVICES = 'CATALOG#SERVICES';
