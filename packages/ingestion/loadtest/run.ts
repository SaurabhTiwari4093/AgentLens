/**
 * Phase 2 load test. Proves the load-bearing claim: 5,000+ spans/sec sustained,
 * end to end (HTTP gateway -> Redis Stream -> COPY writer -> Postgres), with no
 * data loss. Profiles BOTH the gateway (Zod validation on the hot path) and the
 * writer (COPY throughput).
 *
 *   pnpm --filter @agentlens/ingestion loadtest
 *   DURATION_S=120 CONCURRENCY=24 BATCH_SIZE=200 pnpm --filter ... loadtest
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Redis } from 'ioredis';
import pg from 'pg';
import type { Span } from '@agentlens/shared';
import { buildGateway, runWriter, config } from '../dist/index.js';

const DURATION_S = Number(process.env.DURATION_S ?? 20);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 16);
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 200);
const PORT = Number(process.env.LOADTEST_PORT ?? 4100);

const runId = randomUUID(); // session_id marker so we count/clean only this run
const kinds = ['agent', 'tool', 'llm'] as const;

function makeSpan(): Span {
  const start = Date.now();
  const kind = kinds[Math.floor(Math.random() * kinds.length)]!;
  return {
    trace_id: randomUUID(),
    span_id: randomUUID(),
    parent_span_id: null,
    session_id: runId,
    name: `${kind}.op`,
    kind,
    started_at: new Date(start).toISOString(),
    ended_at: new Date(start + 5).toISOString(),
    duration_ms: 5,
    model: kind === 'llm' ? 'gpt-4o' : null,
    input_tokens: kind === 'llm' ? 500 : null,
    output_tokens: kind === 'llm' ? 120 : null,
    cost_usd: kind === 'llm' ? 0.00245 : null,
    attributes: { prompt: 'load-test payload with some, commas\tand\ttabs', i: start },
  };
}

async function main() {
  const redis = new Redis(config.redisUrl);
  const writerRedis = new Redis(config.redisUrl);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.writer.poolSize });

  // Fresh stream per run so pending/backlog from earlier runs doesn't skew numbers.
  await redis.del(config.stream).catch(() => {});

  const gateway = buildGateway(redis);
  await gateway.listen({ port: PORT, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${PORT}/v1/spans`;

  const writer = runWriter(writerRedis, pool, `loadtest-${runId.slice(0, 8)}`);

  console.log(
    `load test: ${DURATION_S}s, concurrency=${CONCURRENCY}, batch=${BATCH_SIZE} -> ${url}`,
  );

  let accepted = 0;
  let httpErrors = 0;
  const deadline = performance.now() + DURATION_S * 1000;
  const sendStart = performance.now();

  const worker = async () => {
    while (performance.now() < deadline) {
      const spans = Array.from({ length: BATCH_SIZE }, makeSpan);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ spans }),
        });
        if (res.status === 202) {
          accepted += BATCH_SIZE;
        } else {
          httpErrors++;
        }
      } catch {
        httpErrors++;
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const sendElapsed = (performance.now() - sendStart) / 1000;
  const gatewayRate = Math.round(accepted / sendElapsed);

  console.log(
    `\n[gateway] accepted ${accepted} spans in ${sendElapsed.toFixed(1)}s ` +
      `=> ${gatewayRate.toLocaleString()} spans/sec (httpErrors=${httpErrors})`,
  );

  // Wait for the writer to drain the stream into Postgres.
  let inDb = 0;
  const drainDeadline = performance.now() + 60_000;
  while (performance.now() < drainDeadline) {
    const { rows } = await pool.query<{ c: string }>(
      'SELECT count(*)::text AS c FROM spans WHERE session_id = $1',
      [runId],
    );
    inDb = Number(rows[0]!.c);
    if (inDb >= accepted) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const drainElapsed = (performance.now() - sendStart) / 1000;
  const writerRate = Math.round(inDb / drainElapsed);

  console.log(
    `[writer]  persisted ${inDb} spans; end-to-end ${drainElapsed.toFixed(1)}s ` +
      `=> ${writerRate.toLocaleString()} spans/sec sustained`,
  );

  // Correctness: exactly the accepted spans, no loss, no dupes (unique span_id count).
  const { rows: uniq } = await pool.query<{ c: string }>(
    'SELECT count(DISTINCT span_id)::text AS c FROM spans WHERE session_id = $1',
    [runId],
  );
  const distinct = Number(uniq[0]!.c);

  console.log('\n--- result ---');
  console.log(`accepted (gateway 202):     ${accepted}`);
  console.log(`rows in postgres:           ${inDb}`);
  console.log(`distinct span_ids:          ${distinct}`);
  const lossOk = inDb >= accepted;
  const dupeOk = distinct === inDb;
  const rateOk = gatewayRate >= 5000 && writerRate >= 5000;
  console.log(`no data loss:               ${lossOk ? 'PASS' : 'FAIL'}`);
  console.log(`no duplicate rows:          ${dupeOk ? 'PASS' : 'FAIL'}`);
  console.log(`>= 5,000 spans/sec:         ${rateOk ? 'PASS' : 'FAIL'}`);

  // Cleanup this run's rows.
  await pool.query('DELETE FROM spans WHERE session_id = $1', [runId]);

  writer.stop();
  await writer.done.catch(() => {});
  await gateway.close();
  await pool.end();
  redis.disconnect();
  writerRedis.disconnect();

  if (!lossOk || !dupeOk || !rateOk) process.exit(1);
  console.log('\n✓ load test passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
