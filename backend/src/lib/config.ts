import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

export const config = {
  tableName: process.env.TABLE_NAME ?? 'asa-challenge',
  /** Set for DynamoDB Local, for example http://localhost:8000 */
  dynamoEndpoint: process.env.DYNAMODB_ENDPOINT,
  region: process.env.AWS_REGION ?? 'ap-southeast-1',
  tokenTtlSeconds: 8 * 60 * 60,
  inLambda: Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME),
};

let secret: Uint8Array | undefined;

/** JWT signing secret: JWT_SECRET for local runs, Secrets Manager (JWT_SECRET_ARN) in AWS. Cached per instance. */
export async function getJwtSecret(): Promise<Uint8Array> {
  if (secret) return secret;
  let value = process.env.JWT_SECRET;
  if (!value && process.env.JWT_SECRET_ARN) {
    const out = await new SecretsManagerClient({}).send(
      new GetSecretValueCommand({ SecretId: process.env.JWT_SECRET_ARN }),
    );
    value = out.SecretString;
  }
  if (!value) throw new Error('JWT secret is not configured (set JWT_SECRET or JWT_SECRET_ARN)');
  secret = new TextEncoder().encode(value);
  return secret;
}
