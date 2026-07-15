import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import pg from 'pg';
import type { Span } from '@agentlens/shared';
import { config } from '../config.js';
import { writeSpans } from './db.js';

type StreamEntry = [id: string, fields: string[]];
type StreamReply = [stream: string, entries: StreamEntry[]][];

/** Create the consumer group if it doesn't exist yet (MKSTREAM makes the stream). */
async function ensureGroup(redis: Redis): Promise<void> {
  try {
    await redis.xgroup('CREATE', config.stream, config.group, '$', 'MKSTREAM');
  } catch (err) {
    // BUSYGROUP => group already exists, which is fine.
    if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
  }
}

/** Parse the `b` field of each entry back into spans, and collect entry ids. */
function collect(reply: StreamReply): { spans: Span[]; ids: string[] } {
  const spans: Span[] = [];
  const ids: string[] = [];
  for (const [, entries] of reply) {
    for (const [id, fields] of entries) {
      ids.push(id);
      // fields is a flat [key, value, ...]; we only wrote field 'b'.
      const bIdx = fields.indexOf('b');
      if (bIdx === -1) continue;
      const json = fields[bIdx + 1];
      if (!json) continue;
      const parsed = JSON.parse(json) as Span[];
      spans.push(...parsed);
    }
  }
  return { spans, ids };
}

export interface WriterHandle {
  stop: () => void;
  done: Promise<void>;
}

/**
 * Run the consumer loop. On startup it first drains this consumer's *pending*
 * entries (id '0') — entries delivered but not acked before a prior crash — which
 * is what makes redelivery safe end-to-end: writeSpans() upserts, so replaying a
 * pending batch inserts zero duplicate rows. Then it switches to new entries ('>').
 */
export function runWriter(redis: Redis, pool: pg.Pool, consumer: string): WriterHandle {
  let running = true;
  let inserted = 0;
  let seen = 0;

  const loop = async () => {
    await ensureGroup(redis);
    // '0' replays own pending first; once drained we move to '>' for new work.
    let cursor = '0';

    while (running) {
      const reply = (await redis.xreadgroup(
        'GROUP',
        config.group,
        consumer,
        'COUNT',
        config.writer.readCount,
        'BLOCK',
        config.writer.blockMs,
        'STREAMS',
        config.stream,
        cursor,
      )) as StreamReply | null;

      if (!reply || reply.length === 0) {
        // Nothing pending under '0' anymore -> switch to live entries.
        if (cursor === '0') cursor = '>';
        continue;
      }

      const { spans, ids } = collect(reply);
      if (ids.length === 0) {
        if (cursor === '0') cursor = '>';
        continue;
      }

      const n = await writeSpans(pool, spans);
      await redis.xack(config.stream, config.group, ...ids);
      inserted += n;
      seen += spans.length;

      // When a '0' read returns fewer than we asked, pending is drained.
      if (cursor === '0' && ids.length < config.writer.readCount) cursor = '>';
    }
  };

  const done = loop().catch((err) => {
    console.error('[writer] fatal:', err);
    throw err;
  });

  const statsTimer = setInterval(() => {
    console.log(`[writer] inserted=${inserted} seen=${seen} (dupes=${seen - inserted})`);
  }, 5000);
  statsTimer.unref?.();

  return {
    stop: () => {
      running = false;
      clearInterval(statsTimer);
    },
    done,
  };
}

async function main() {
  const redis = new Redis(config.redisUrl);
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.writer.poolSize,
  });
  const consumer = process.env.WRITER_CONSUMER ?? `writer-${randomUUID().slice(0, 8)}`;
  console.log(`[writer] starting consumer=${consumer} stream=${config.stream}`);

  const handle = runWriter(redis, pool, consumer);

  const shutdown = async () => {
    handle.stop();
    await handle.done.catch(() => {});
    await pool.end();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await handle.done;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
