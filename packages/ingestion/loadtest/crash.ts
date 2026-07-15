/**
 * Idempotency-under-crash test. Reproduces the exact failure the staging+upsert
 * design defends against: the writer commits a batch to Postgres, then crashes
 * BEFORE acking Redis. On restart the entry is redelivered and processed again —
 * and must NOT create duplicate rows.
 *
 *   pnpm --filter @agentlens/ingestion crashtest
 */
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import pg from 'pg';
import type { Span } from '@agentlens/shared';
import { runWriter, writeSpans, config } from '../dist/index.js';

const BATCH = 500;
const runId = randomUUID();

function makeSpan(): Span {
  const start = Date.now();
  return {
    trace_id: randomUUID(),
    span_id: randomUUID(),
    parent_span_id: null,
    session_id: runId,
    name: 'crash.op',
    kind: 'tool',
    started_at: new Date(start).toISOString(),
    ended_at: new Date(start + 2).toISOString(),
    duration_ms: 2,
    model: null,
    input_tokens: null,
    output_tokens: null,
    cost_usd: null,
    attributes: {},
  };
}

async function pendingCount(redis: Redis): Promise<number> {
  // XPENDING summary: [count, minId, maxId, [[consumer, count], ...]]
  const res = (await redis.xpending(config.stream, config.group)) as [number, ...unknown[]];
  return Number(res?.[0] ?? 0);
}

async function main() {
  const redis = new Redis(config.redisUrl);
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const consumer = 'crash-consumer';

  // Clean slate.
  await redis.del(config.stream).catch(() => {});
  try {
    await redis.xgroup('CREATE', config.stream, config.group, '$', 'MKSTREAM');
  } catch {
    /* BUSYGROUP */
  }

  const spans = Array.from({ length: BATCH }, makeSpan);
  await redis.xadd(config.stream, '*', 'b', JSON.stringify(spans));

  // --- Phase A: deliver to `consumer`, write to Postgres, then "crash" (no XACK).
  const reply = (await redis.xreadgroup(
    'GROUP',
    config.group,
    consumer,
    'COUNT',
    10,
    'STREAMS',
    config.stream,
    '>',
  )) as [string, [string, string[]][]][] | null;

  const entries = reply?.[0]?.[1] ?? [];
  const delivered: Span[] = [];
  for (const [, fields] of entries) {
    const b = fields[fields.indexOf('b') + 1];
    if (b) delivered.push(...(JSON.parse(b) as Span[]));
  }
  const firstInsert = await writeSpans(pool, delivered);
  console.log(`[crash] committed ${firstInsert} rows to Postgres, then crashed WITHOUT acking`);

  const pendingBefore = await pendingCount(redis);
  console.log(`[crash] pending (unacked) entries after crash: ${pendingBefore}`);

  // --- Phase B: restart the writer with the SAME consumer name. It drains its
  // pending (id '0'), re-processes the batch, and the upsert makes it a no-op.
  const writer = runWriter(redis, pool, consumer);

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if ((await pendingCount(redis)) === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  writer.stop();
  await writer.done.catch(() => {});

  const pendingAfter = await pendingCount(redis);
  const { rows } = await pool.query<{ total: string; distinct: string }>(
    'SELECT count(*)::text AS total, count(DISTINCT span_id)::text AS distinct FROM spans WHERE session_id = $1',
    [runId],
  );
  const total = Number(rows[0]!.total);
  const distinct = Number(rows[0]!.distinct);

  console.log('\n--- result ---');
  console.log(`batch size:               ${BATCH}`);
  console.log(`rows after redelivery:    ${total}`);
  console.log(`distinct span_ids:        ${distinct}`);
  console.log(`pending after restart:    ${pendingAfter}`);
  const noDupes = total === BATCH && distinct === BATCH;
  const acked = pendingAfter === 0;
  console.log(`no duplicate rows:        ${noDupes ? 'PASS' : 'FAIL'}`);
  console.log(`redelivered entry acked:  ${acked ? 'PASS' : 'FAIL'}`);

  await pool.query('DELETE FROM spans WHERE session_id = $1', [runId]);
  await redis.del(config.stream).catch(() => {});
  await pool.end();
  redis.disconnect();

  if (!noDupes || !acked) process.exit(1);
  console.log('\n✓ crash/redelivery idempotency test passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
