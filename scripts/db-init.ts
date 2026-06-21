import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { log } from '../src/utils/logger.js';

async function main() {
  const url = process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_KEY ?? '';
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  }

  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const schemaSql = readFileSync('./supabase_schema.sql', 'utf8');
  const { error } = await client.rpc('exec_sql', { sql: schemaSql });

  if (error) {
    log('warn', 'Could not execute schema via exec_sql; run it manually in the Supabase SQL Editor', {
      error: String(error),
    });
  } else {
    log('info', 'Schema executed successfully');
  }

  log('info', 'Supabase database initialized');
}

main().catch((error) => {
  log('error', 'Database init failed', { error: String(error) });
  process.exit(1);
});
