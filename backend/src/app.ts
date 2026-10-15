import { randomUUID } from 'node:crypto';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { Hono, type MiddlewareHandler } from 'hono';
import type { ZodType } from 'zod';
import {
  availabilityQuerySchema,
  createAppointmentSchema,
  listAppointmentsQuerySchema,
  loginRequestSchema,
  type ApiErrorBody,
  type Role,
  type UserDto,
} from '@asa/shared';
import { config } from './lib/config.js';
import { db } from './lib/db.js';
import { AppError } from './lib/errors.js';
import { key } from './lib/keys.js';
import { count, flushMetrics, latency, logger } from './lib/observability.js';
import { login, verifyToken, type Principal } from './services/auth.js';
import {
  cancelAppointment,
  createAppointment,
  getAppointment,
  getAvailability,
  listAppointments,
} from './services/booking.js';
import { getCatalog, listVehicles } from './services/catalog.js';

type Env = { Variables: { principal: Principal; requestId: string } };

function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`)
      .join('; ');
    throw new AppError('INVALID_INPUT', message);
  }
  return result.data;
}

async function readJson(req: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError('INVALID_INPUT', 'Request body must be valid JSON.');
  }
}

/** Assigns a request id, logs one line per request and flushes metrics. */
const requestContext: MiddlewareHandler<Env> = async (c, next) => {
  const requestId = randomUUID();
  const started = Date.now();
  c.set('requestId', requestId);
  // Lambda handles one request at a time per instance, so appended keys never mix between requests there.
  logger.appendKeys({ requestId });
  try {
    await next();
  } finally {
    const ms = Date.now() - started;
    c.header('X-Request-Id', requestId);
    c.header('Cache-Control', 'no-store');
    latency('RequestLatency', ms);
    logger.info('request', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms,
      username: c.get('principal')?.username,
      role: c.get('principal')?.role,
    });
    flushMetrics();
    logger.removeKeys(['requestId']);
  }
};

const authenticate: MiddlewareHandler<Env> = async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match?.[1]) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
  c.set('principal', await verifyToken(match[1]));
  await next();
};

const requireRole =
  (role: Role): MiddlewareHandler<Env> =>
  async (c, next) => {
    if (c.get('principal').role !== role) {
      throw new AppError('FORBIDDEN', `This action is for ${role} accounts.`);
    }
    await next();
  };

export function createApp(): Hono<Env> {
  const app = new Hono<Env>().basePath('/api');

  app.use('*', requestContext);

  app.onError((err, c) => {
    const requestId = c.get('requestId') ?? 'unknown';
    if (err instanceof AppError) {
      const body: ApiErrorBody = {
        error: {
          code: err.code,
          message: err.message,
          requestId,
          ...(err.alternatives ? { alternatives: err.alternatives } : {}),
        },
      };
      if (err.status >= 500) logger.error('Request failed', err);
      return c.json(body, err.status as 400);
    }
    logger.error('Unhandled error', err);
    const body: ApiErrorBody = { error: { code: 'INTERNAL', message: 'Something went wrong.', requestId } };
    return c.json(body, 500);
  });

  app.notFound((c) => {
    const body: ApiErrorBody = {
      error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: c.get('requestId') ?? 'unknown' },
    };
    return c.json(body, 404);
  });

  /* Public */

  app.get('/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }));

  app.post('/auth/login', async (c) => {
    const body = parse(loginRequestSchema, await readJson(c.req));
    try {
      const result = await login(body.username, body.password);
      count('LoginSucceeded');
      logger.info('Login succeeded', { username: result.user.username, role: result.user.role });
      return c.json(result);
    } catch (err) {
      if (err instanceof AppError && err.code === 'INVALID_CREDENTIALS') {
        count('LoginFailed');
        logger.warn('Login failed');
      }
      throw err;
    }
  });

  /* Authenticated */

  app.use('*', authenticate);

  app.get('/me', async (c) => {
    const { username } = c.get('principal');
    const out = await db().send(new GetCommand({ TableName: config.tableName, Key: key.user(username) }));
    if (!out.Item) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
    const user: UserDto = {
      username: out.Item.username,
      displayName: out.Item.displayName,
      role: out.Item.role,
      imageKey: out.Item.imageKey,
    };
    return c.json(user);
  });

  app.get('/catalog', async (c) => c.json(await getCatalog()));

  app.get('/vehicles', requireRole('customer'), async (c) =>
    c.json(await listVehicles(c.get('principal').username)),
  );

  app.get('/availability', requireRole('customer'), async (c) => {
    const query = parse(availabilityQuerySchema, c.req.query());
    return c.json(await getAvailability(query, c.get('principal')));
  });

  app.post('/appointments', requireRole('customer'), async (c) => {
    const body = parse(createAppointmentSchema, await readJson(c.req));
    return c.json(await createAppointment(body, c.get('principal')), 201);
  });

  app.get('/appointments', async (c) => {
    const query = parse(listAppointmentsQuerySchema, c.req.query());
    return c.json(await listAppointments(c.get('principal'), query));
  });

  app.get('/appointments/:id', async (c) => c.json(await getAppointment(c.req.param('id'), c.get('principal'))));

  app.post('/appointments/:id/cancel', async (c) =>
    c.json(await cancelAppointment(c.req.param('id'), c.get('principal'))),
  );

  return app;
}
