/** One JSON object per line on stdout (not console.log, which Lambda prefixes); CloudWatch Logs then makes every field queryable. */
const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[(process.env.LOG_LEVEL as Level | undefined) ?? 'INFO'] ?? LEVELS.INFO;

function write(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] < threshold) return;
  process.stdout.write(`${JSON.stringify({ level, time: new Date().toISOString(), message, ...fields })}
`);
}

export const logger = {
  info: (message: string, fields?: Record<string, unknown>) => write('INFO', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('WARN', message, fields),
  error: (message: string, err: unknown, fields?: Record<string, unknown>) =>
    write('ERROR', message, {
      ...fields,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    }),
};
