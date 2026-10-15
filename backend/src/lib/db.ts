import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { config } from './config.js';

export interface DbTarget {
  endpoint?: string;
  region?: string;
}

export function createDocClient(target: DbTarget = {}): DynamoDBDocumentClient {
  const endpoint = target.endpoint ?? config.dynamoEndpoint;
  const client = new DynamoDBClient({
    region: target.region ?? config.region,
    ...(endpoint ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}),
  });
  return DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
}

let shared: DynamoDBDocumentClient | undefined;

/** One client per process, reused across Lambda invocations. */
export function db(): DynamoDBDocumentClient {
  shared ??= createDocClient();
  return shared;
}

/** Test and seed scripts swap the client (for example to point at another endpoint). */
export function setDb(client: DynamoDBDocumentClient): void {
  shared = client;
}
