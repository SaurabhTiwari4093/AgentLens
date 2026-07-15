import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import pg from 'pg';
import copyStreams from 'pg-copy-streams';
import type { Span } from '@agentlens/shared';
import { COPY_COLUMNS, encodeSpanRow } from './copy.js';

const { from: copyFrom } = copyStreams;

/**
 * Idempotent bulk write for one poll's worth of spans, in a single transaction:
 *
 *   TRUNCATE spans_staging            -- clear any leftovers
 *   COPY   spans_staging FROM STDIN   -- fast load (UNLOGGED, no WAL)
 *   INSERT spans SELECT * FROM staging ON CONFLICT (started_at, span_id) DO NOTHING
 *   COMMIT
 *
 * Because the target upsert is keyed on (started_at, span_id), a redelivered batch
 * (writer crashed between COMMIT and XACK) inserts zero extra rows. Returns the
 * number of rows actually inserted into `spans` (dupes excluded).
 */
export async function writeSpans(pool: pg.Pool, spans: Span[]): Promise<number> {
  if (spans.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE spans_staging');

    const copyStream = client.query(
      copyFrom(`COPY spans_staging (${COPY_COLUMNS}) FROM STDIN`),
    );
    const source = Readable.from(spans.map(encodeSpanRow));
    await pipeline(source, copyStream);

    const inserted = await client.query(
      `INSERT INTO spans (${COPY_COLUMNS})
       SELECT ${COPY_COLUMNS} FROM spans_staging
       ON CONFLICT (started_at, span_id) DO NOTHING`,
    );

    await client.query('COMMIT');
    return inserted.rowCount ?? 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
