import { defineConfig } from 'vitest/config';

/** Runs against DynamoDB Local (npm run db:up). Uses its own table, so the demo data is untouched. */
export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      TABLE_NAME: 'asa-challenge-test',
      DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8100',
      JWT_SECRET: 'integration-test-secret',
      LOG_LEVEL: 'ERROR',
    },
  },
});
