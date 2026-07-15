/**
 * Phase 0 exit check: write a placeholder span to Postgres and read it back,
 * routed through a real daily partition (not the DEFAULT). Prints OK or throws.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { DATABASE_URL } from './config.ts';

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const span_id = randomUUID();
    const trace_id = randomUUID();
    const now = new Date();

    await client.query(
      `INSERT INTO spans
         (span_id, trace_id, parent_span_id, session_id, name, kind,
          started_at, ended_at, duration_ms, model, input_tokens, output_tokens, cost_usd, attributes)
       VALUES ($1,$2,NULL,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        span_id,
        trace_id,
        'smoke.placeholder',
        'agent',
        now.toISOString(),
        new Date(now.getTime() + 5).toISOString(),
        5,
        'gpt-4o',
        100,
        20,
        0.00045,
        JSON.stringify({ note: 'phase-0 smoke test' }),
      ],
    );

    const { rows } = await client.query(
      'SELECT span_id, name, tableoid::regclass::text AS partition FROM spans WHERE span_id = $1',
      [span_id],
    );
    if (rows.length !== 1) throw new Error('span not read back');
    if (rows[0].partition === 'spans_default') {
      throw new Error('span landed in DEFAULT partition — daily partition missing');
    }
    console.log(`✓ span ${rows[0].span_id} round-tripped via partition ${rows[0].partition}`);

    // Clean up so repeated runs stay idempotent.
    await client.query('DELETE FROM spans WHERE span_id = $1', [span_id]);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
