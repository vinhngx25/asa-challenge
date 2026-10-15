/**
 * Seeds the demo data. It wipes the table first, so every run ends in the same state.
 *   npm run seed:local   DynamoDB Local on http://localhost:8000, creates the table if needed
 *   npm run seed:aws     the deployed table (AWS credentials from the environment or AWS_PROFILE)
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const toAws = process.argv.includes('--aws');
process.env.LOG_LEVEL ??= 'WARN';

if (!toAws) {
  await import('../local-env.js');
} else {
  process.env.AWS_REGION ??= 'ap-southeast-1';
}

const { config } = await import('../lib/config.js');
const { ensureTable, seed } = await import('./seed.js');

if (!toAws) {
  const client = new DynamoDBClient({
    region: config.region,
    endpoint: config.dynamoEndpoint,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  await ensureTable(client);
}

console.log(`Seeding table "${config.tableName}" ${toAws ? 'in AWS (' + config.region + ')' : 'on ' + config.dynamoEndpoint} ...`);
const summary = await seed();
console.log(summary);
