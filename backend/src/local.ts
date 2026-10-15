import './local-env.js';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: createApp().fetch, port }, () => {
  console.log(`ASA API listening on http://localhost:${port}/api (DynamoDB at ${process.env.DYNAMODB_ENDPOINT})`);
});
