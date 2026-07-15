import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { SpanBatch } from '@agentlens/shared';
import { config } from '../config.js';

/**
 * Ingestion gateway. The ONLY thing on the write hot path: validate the batch
 * against the shared Zod schema, push it to the Redis Stream, return 202. No DB
 * work here — that's the writer's job. Validation is the gateway's main CPU cost,
 * which is why we profile it in the load test.
 */
export function buildGateway(redis: Redis) {
  const app = Fastify({
    logger: false,
    // Batches can be large; allow up to ~8MB bodies (1000 spans w/ prompts).
    bodyLimit: 8 * 1024 * 1024,
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/v1/spans', async (req, reply) => {
    const parsed = SpanBatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid span batch',
        issues: parsed.error.issues.slice(0, 20),
      });
    }

    // Store the validated batch as one stream entry. The writer re-reads the
    // JSON and bulk-loads it. XADD is O(1); Redis is the durable buffer (AOF on).
    await redis.xadd(config.stream, '*', 'b', JSON.stringify(parsed.data.spans));

    return reply.status(202).send({ accepted: parsed.data.spans.length });
  });

  return app;
}

async function main() {
  const redis = new Redis(config.redisUrl);
  const app = buildGateway(redis);
  try {
    await app.listen({ port: config.gatewayPort, host: '0.0.0.0' });
    console.log(`[gateway] listening on :${config.gatewayPort}, stream=${config.stream}`);
  } catch (err) {
    console.error('[gateway] failed to start:', err);
    process.exit(1);
  }

  const shutdown = async () => {
    await app.close();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run only when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
