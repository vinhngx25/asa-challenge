// Development defaults. Imported first so the values exist before the config module reads them.
process.env.DYNAMODB_ENDPOINT ??= 'http://localhost:8100';
process.env.JWT_SECRET ??= 'local-development-secret-do-not-use-in-aws';
process.env.LOG_LEVEL ??= 'INFO';

export {};
