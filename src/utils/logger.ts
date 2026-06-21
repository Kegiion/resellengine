import { createWriteStream, mkdirSync } from 'node:fs';

const LOG_DIR = './logs';
mkdirSync(LOG_DIR, { recursive: true });

const logStream = createWriteStream(`${LOG_DIR}/resell.log`, { flags: 'a' });

export function log(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const entry = { timestamp, level, message, meta };
  const line = JSON.stringify(entry);

  // eslint-disable-next-line no-console
  console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`, meta ?? '');
  logStream.write(line + '\n');
}
