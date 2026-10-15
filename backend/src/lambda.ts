import { handle } from 'hono/aws-lambda';
import { createApp } from './app.js';

/** AWS Lambda entry point (API Gateway HTTP API, payload v2). The same app runs locally through local.ts. */
export const handler = handle(createApp());
