import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { config } from './config.js';

export const SERVICE_NAME = 'asa-api';

export const logger = new Logger({
  serviceName: SERVICE_NAME,
  logLevel: (process.env.LOG_LEVEL as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | undefined) ?? 'INFO',
});

/** X-Ray tracing runs only inside Lambda; elsewhere the tracer is a no-op. */
export const tracer = new Tracer({ serviceName: SERVICE_NAME, enabled: config.inLambda });

const metrics = new Metrics({ namespace: 'ASA', serviceName: SERVICE_NAME });
const emitMetrics = config.inLambda || process.env.EMIT_METRICS === 'true';

export type MetricName =
  | 'BookingCreated'
  | 'BookingConflict'
  | 'BookingCancelled'
  | 'AvailabilityQueried'
  | 'LoginSucceeded'
  | 'LoginFailed';

export function count(name: MetricName, value = 1): void {
  if (emitMetrics) metrics.addMetric(name, MetricUnit.Count, value);
}

export function latency(name: string, ms: number): void {
  if (emitMetrics) metrics.addMetric(name, MetricUnit.Milliseconds, ms);
}

export function flushMetrics(): void {
  if (emitMetrics) metrics.publishStoredMetrics();
}

/** Runs `fn` inside a named X-Ray subsegment when tracing is on. */
export async function traced<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const parent = tracer.getSegment();
  if (!parent) return fn();
  const sub = parent.addNewSubsegment(name);
  tracer.setSegment(sub);
  try {
    return await fn();
  } catch (err) {
    sub.addError(err as Error);
    throw err;
  } finally {
    sub.close();
    tracer.setSegment(parent);
  }
}
