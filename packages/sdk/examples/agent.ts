/**
 * Phase 1 example: a tiny "research agent" instrumented with the SDK. It produces
 * a realistic parent/child trace —
 *
 *   agent.run
 *   ├── tool: web.search
 *   ├── llm:  plan            (gpt-4o-mini)
 *   ├── tool: web.fetch
 *   └── llm:  synthesize      (gpt-4o)
 *
 * Run with: pnpm example:agent  (writes to Postgres, then prints the trace tree).
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Tracer } from '@agentlens/sdk';
import { DATABASE_URL } from '../../../db/config.ts';
import { DbExporter } from './db-exporter.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const exporter = new DbExporter(DATABASE_URL);
  const sessionId = randomUUID();
  const tracer = new Tracer({ exporter, sessionId, maxBatchSize: 50, flushIntervalMs: 500 });

  const question = 'What is OpenTelemetry?';

  const answer = await tracer.agent('agent.run', async (root) => {
    root.setAttribute('question', question);

    const hits = await tracer.tool('web.search', async (s) => {
      s.setAttributes({ query: question });
      await sleep(40);
      return ['otel.io', 'wikipedia.org'];
    });

    await tracer.llm('plan', 'gpt-4o-mini', async (s) => {
      s.setUsage(320, 48);
      s.setAttributes({ prompt: `Plan how to answer: ${question}`, hits });
      await sleep(60);
      return 'fetch otel.io then summarize';
    });

    const page = await tracer.tool('web.fetch', async (s) => {
      s.setAttributes({ url: 'https://otel.io' });
      await sleep(80);
      return 'OpenTelemetry is an observability framework...';
    });

    return tracer.llm('synthesize', 'gpt-4o', async (s) => {
      s.setUsage(1200, 260);
      s.setAttributes({ prompt: `Answer using: ${page}`, question });
      await sleep(120);
      return 'OpenTelemetry is an open standard for traces, metrics, and logs.';
    });
  });

  await tracer.shutdown();
  console.log(`\nagent answered: ${answer}\n`);
  await printTrace(sessionId);
}

/** Read the trace back from Postgres and render it as an indented tree. */
async function printTrace(sessionId: string) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{
      span_id: string;
      parent_span_id: string | null;
      name: string;
      kind: string;
      duration_ms: number;
      input_tokens: number | null;
      output_tokens: number | null;
      cost_usd: string | null;
    }>(
      `SELECT span_id, parent_span_id, name, kind, duration_ms, input_tokens, output_tokens, cost_usd
       FROM spans WHERE session_id = $1 ORDER BY started_at`,
      [sessionId],
    );

    console.log(`trace for session ${sessionId} — ${rows.length} spans:\n`);
    const byParent = new Map<string | null, typeof rows>();
    for (const r of rows) {
      const key = r.parent_span_id;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(r);
    }

    let totalCost = 0;
    const walk = (parent: string | null, depth: number) => {
      for (const r of byParent.get(parent) ?? []) {
        const pad = '  '.repeat(depth);
        const tokens =
          r.input_tokens != null ? ` ${r.input_tokens}→${r.output_tokens} tok` : '';
        const cost = r.cost_usd != null ? ` $${Number(r.cost_usd).toFixed(6)}` : '';
        if (r.cost_usd != null) totalCost += Number(r.cost_usd);
        console.log(`${pad}• [${r.kind}] ${r.name} — ${r.duration_ms}ms${tokens}${cost}`);
        walk(r.span_id, depth + 1);
      }
    };
    walk(null, 0);
    console.log(`\ntotal cost: $${totalCost.toFixed(6)}`);

    if (rows.length !== 5) throw new Error(`expected 5 spans, got ${rows.length}`);
    const roots = byParent.get(null) ?? [];
    if (roots.length !== 1) throw new Error(`expected 1 root span, got ${roots.length}`);
    console.log('\n✓ full parent/child trace persisted to Postgres');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
