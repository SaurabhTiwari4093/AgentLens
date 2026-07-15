import Fastify from 'fastify';
import cors from '@fastify/cors';
import pg from 'pg';
import { config } from './config.js';
import {
  getSessionSpans,
  getSpan,
  getTrace,
  listSessions,
  listSessionTraces,
} from './queries.js';

/**
 * Read API for the dashboard. Pure reads — no writes here. Trace/span lookups take
 * an optional `start` (ISO) so Postgres prunes partitions; the dashboard always
 * passes it (session/trace lists return the start time for exactly this).
 */
export function buildApi(pool: pg.Pool) {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });

  app.get('/health', async () => ({ status: 'ok' }));

  // GET /v1/sessions?limit=&since=
  app.get('/v1/sessions', async (req) => {
    const q = req.query as { limit?: string; since?: string };
    const sessions = await listSessions(pool, {
      limit: q.limit ? Number(q.limit) : undefined,
      sinceIso: q.since ?? null,
    });
    return { sessions };
  });

  // GET /v1/sessions/:id  -> summary traces + ordered spans (for replay)
  app.get('/v1/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [traces, spans] = await Promise.all([
      listSessionTraces(pool, id),
      getSessionSpans(pool, id),
    ]);
    if (spans.length === 0) return reply.status(404).send({ error: 'session not found' });
    return { session_id: id, traces, spans };
  });

  // GET /v1/traces/:id?start=<iso>  -> spans of one trace (waterfall)
  app.get('/v1/traces/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { start } = req.query as { start?: string };
    const spans = await getTrace(pool, id, start ?? null, config.traceWindowHours);
    if (spans.length === 0) return reply.status(404).send({ error: 'trace not found' });
    return { trace_id: id, spans };
  });

  // GET /v1/spans/:id?start=<iso>  -> single span detail
  app.get('/v1/spans/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { start } = req.query as { start?: string };
    const span = await getSpan(pool, id, start ?? null, config.traceWindowHours);
    if (!span) return reply.status(404).send({ error: 'span not found' });
    return { span };
  });

  return app;
}

async function main() {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const app = buildApi(pool);
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`[api] listening on :${config.port}`);
  } catch (err) {
    console.error('[api] failed to start:', err);
    process.exit(1);
  }

  const shutdown = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
