import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { SignJWT, jwtVerify } from 'jose';
import type { LoginResponse, Role, UserDto } from '@asa/shared';
import { config, getJwtSecret } from '../lib/config.js';
import { db } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { key } from '../lib/keys.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

/** Format: scrypt$<salt hex>$<hash hex>. A fresh random salt per password. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Verified against when the username is unknown, so a miss costs the same time as a wrong password. */
const DECOY_HASH = `scrypt$${'00'.repeat(16)}$${'00'.repeat(KEY_LENGTH)}`;

export async function login(username: string, password: string): Promise<LoginResponse> {
  // Usernames are case sensitive and used verbatim in the key.
  const out = await db().send(new GetCommand({ TableName: config.tableName, Key: key.user(username) }));
  const user = out.Item;
  const ok = await verifyPassword(password, user?.passwordHash ?? DECOY_HASH);
  if (!user || !ok) throw new AppError('INVALID_CREDENTIALS', 'Incorrect username or password.');

  const dto: UserDto = {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    imageKey: user.imageKey,
  };
  const expiresAtSec = Math.floor(Date.now() / 1000) + config.tokenTtlSeconds;
  const token = await new SignJWT({ role: dto.role, name: dto.displayName })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(dto.username)
    .setIssuedAt()
    .setExpirationTime(expiresAtSec)
    .sign(await getJwtSecret());
  return { token, expiresAt: new Date(expiresAtSec * 1000).toISOString(), user: dto };
}

export interface Principal {
  username: string;
  displayName: string;
  role: Role;
}

export async function verifyToken(token: string): Promise<Principal> {
  try {
    const { payload } = await jwtVerify(token, await getJwtSecret(), { algorithms: ['HS256'] });
    const role = payload.role;
    if (typeof payload.sub !== 'string' || (role !== 'customer' && role !== 'staff')) {
      throw new Error('bad claims');
    }
    return { username: payload.sub, displayName: String(payload.name ?? payload.sub), role };
  } catch {
    throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
  }
}
