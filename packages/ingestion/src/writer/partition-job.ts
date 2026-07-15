/**
 * Pre-creates upcoming daily partitions. Run on a daily schedule (cron/systemd
 * timer). Creates today + next 3 days so a single missed run can't cause a
 * midnight write failure; the DEFAULT partition is the final backstop.
 */
import pg from 'pg';
import { config } from '../config.js';

export async function ensurePartitions(pool: pg.Pool, daysAhead = 3): Promise<void> {
  await pool.query('SELECT ensure_span_partitions($1)', [daysAhead]);
}

async function main() {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  try {
    await ensurePartitions(pool, 3);
    console.log('[partition-job] ensured partitions today .. +3d');
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[partition-job] failed:', err);
    process.exit(1);
  });
}
