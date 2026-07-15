import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApi } from './server.js';
import { config } from './config.js';

/**
 * Integration test against a live Postgres (docker-compose). Seeds one session with
 * a small parent/child trace, then exercises every read endpoint via app.inject.
 */
const pool = new pg.Pool({ connectionString: config.databaseUrl });
const sessionId = randomUUID();
const traceId = randomUUID();
const rootId = randomUUID();
const toolId = randomUUID();
const llmId = randomUUID();
let app: FastifyInstance;

const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

async function insert(
  span_id: string,
  parent: string | null,
  name: string,
  kind: string,
  startOff: number,
  dur: number,
  extra: Partial<{
    model: string;
    input: number;
    output: number;
    cost: number;
    attrs: object;
  }> = {},
) {
  await pool.query(
    `INSERT INTO spans (span_id, trace_id, parent_span_id, session_id, name, kind,
       started_at, ended_at, duration_ms, model, input_tokens, output_tokens, cost_usd, attributes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT DO NOTHING`,
    [
      span_id,
      traceId,
      parent,
      sessionId,
      name,
      kind,
      iso(startOff),
      iso(startOff + dur),
      dur,
      extra.model ?? null,
      extra.input ?? null,
      extra.output ?? null,
      extra.cost ?? null,
      JSON.stringify(extra.attrs ?? {}),
    ],
  );
}

beforeAll(async () => {
  await insert(rootId, null, 'agent.run', 'agent', 0, 300, { attrs: { question: 'hi' } });
  await insert(toolId, rootId, 'web.search', 'tool', 10, 40, { attrs: { query: 'hi' } });
  await insert(llmId, rootId, 'chat', 'llm', 60, 120, {
    model: 'gpt-4o',
    input: 1000,
    output: 500,
    cost: 0.0075,
    attrs: { prompt: 'answer hi' },
  });
  app = buildApi(pool);
  await app.ready();
});

afterAll(async () => {
  await pool.query('DELETE FROM spans WHERE session_id = $1', [sessionId]);
  await app.close();
  await pool.end();
});

describe('read API', () => {
  it('lists the seeded session with counts and cost', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/sessions?limit=500' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessions: Array<Record<string, unknown>> };
    const s = body.sessions.find((x) => x.session_id === sessionId);
    expect(s).toBeDefined();
    expect(s!.span_count).toBe(3);
    expect(s!.trace_count).toBe(1);
    expect(s!.total_cost_usd).toBeCloseTo(0.0075, 6);
  });

  it('returns session detail with traces and ordered spans', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/sessions/${sessionId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { traces: Array<{ root_name: string }>; spans: unknown[] };
    expect(body.spans).toHaveLength(3);
    expect(body.traces[0]!.root_name).toBe('agent.run');
  });

  it('fetches a trace tree by trace_id with a time bound', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/traces/${traceId}?start=${encodeURIComponent(iso(0))}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { spans: Array<{ span_id: string; parent_span_id: string | null }> };
    expect(body.spans).toHaveLength(3);
    const root = body.spans.find((s) => s.parent_span_id === null)!;
    expect(root.span_id).toBe(rootId);
  });

  it('returns span detail with full attributes', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/spans/${llmId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { span: { attributes: { prompt: string }; cost_usd: number } };
    expect(body.span.attributes.prompt).toBe('answer hi');
    expect(body.span.cost_usd).toBeCloseTo(0.0075, 6);
  });

  it('404s an unknown trace', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/traces/${randomUUID()}` });
    expect(res.statusCode).toBe(404);
  });
});
