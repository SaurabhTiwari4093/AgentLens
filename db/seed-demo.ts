/**
 * Seeds a couple of realistic demo sessions so the dashboard has something to show
 * (waterfall, replay, and a prompt-diff between two runs of the same session).
 * Idempotent-ish: each run creates fresh sessions. Run: pnpm db:seed-demo
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { DATABASE_URL } from './config.ts';

interface SpanSeed {
  span_id: string;
  parent: string | null;
  name: string;
  kind: 'agent' | 'tool' | 'llm';
  startOff: number;
  dur: number;
  model?: string;
  input?: number;
  output?: number;
  cost?: number;
  attrs?: Record<string, unknown>;
}

/** Build one trace (a "run") answering a question, with slight variation by variant. */
function buildTrace(question: string, answer: string, planPrompt: string): SpanSeed[] {
  const root = randomUUID();
  const search = randomUUID();
  const plan = randomUUID();
  const fetch = randomUUID();
  const synth = randomUUID();
  return [
    { span_id: root, parent: null, name: 'agent.run', kind: 'agent', startOff: 0, dur: 320, attrs: { question } },
    { span_id: search, parent: root, name: 'web.search', kind: 'tool', startOff: 10, dur: 40, attrs: { query: question } },
    {
      span_id: plan,
      parent: root,
      name: 'plan',
      kind: 'llm',
      startOff: 55,
      dur: 60,
      model: 'gpt-4o-mini',
      input: 320,
      output: 48,
      cost: 0.0000768,
      attrs: { prompt: planPrompt, output: 'fetch top result, then summarize' },
    },
    { span_id: fetch, parent: root, name: 'web.fetch', kind: 'tool', startOff: 120, dur: 80, attrs: { url: 'https://otel.io' } },
    {
      span_id: synth,
      parent: root,
      name: 'synthesize',
      kind: 'llm',
      startOff: 205,
      dur: 120,
      model: 'gpt-4o',
      input: 1200,
      output: 260,
      cost: 0.0056,
      attrs: { prompt: `Answer the question:\n${question}\nUse the fetched page.`, output: answer },
    },
  ];
}

async function insertTrace(client: pg.Client, sessionId: string, spans: SpanSeed[], baseTime: number) {
  const traceId = randomUUID();
  for (const s of spans) {
    const start = new Date(baseTime + s.startOff);
    const end = new Date(baseTime + s.startOff + s.dur);
    await client.query(
      `INSERT INTO spans (span_id, trace_id, parent_span_id, session_id, name, kind,
         started_at, ended_at, duration_ms, model, input_tokens, output_tokens, cost_usd, attributes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,
      [
        s.span_id,
        traceId,
        s.parent,
        sessionId,
        s.name,
        s.kind,
        start.toISOString(),
        end.toISOString(),
        s.dur,
        s.model ?? null,
        s.input ?? null,
        s.output ?? null,
        s.cost ?? null,
        JSON.stringify(s.attrs ?? {}),
      ],
    );
  }
}

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const now = Date.now();

    // Session 1: two runs of the same question => a meaningful prompt-diff.
    const s1 = randomUUID();
    await insertTrace(
      client,
      s1,
      buildTrace(
        'What is OpenTelemetry?',
        'OpenTelemetry is an open standard for traces, metrics, and logs.',
        'Plan how to answer: What is OpenTelemetry?',
      ),
      now - 60_000,
    );
    await insertTrace(
      client,
      s1,
      buildTrace(
        'What is OpenTelemetry?',
        'OpenTelemetry (OTel) is a CNCF observability framework providing a single set of APIs and SDKs to collect traces, metrics, and logs.',
        'Plan a thorough answer with a definition and scope for: What is OpenTelemetry?',
      ),
      now - 30_000,
    );

    // Session 2: a single run, different topic.
    const s2 = randomUUID();
    await insertTrace(
      client,
      s2,
      buildTrace(
        'How do database indexes work?',
        'An index is a sorted data structure (usually a B-tree) that speeds up lookups at the cost of write overhead.',
        'Plan how to answer: How do database indexes work?',
      ),
      now - 10_000,
    );

    console.log(`✓ seeded demo sessions:\n  ${s1}  (2 runs — try Prompt Diff)\n  ${s2}  (1 run)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
