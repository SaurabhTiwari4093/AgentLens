# SDK Reference — `@agentlens/sdk`

The SDK instruments an agent's tool calls and LLM calls into OTel-style spans and
ships them to the ingestion gateway in non-blocking batches.

## Install

In this monorepo the SDK is a workspace package (`@agentlens/sdk`). In a real app
you'd depend on the published package and import from it the same way.

## Concepts

- A **span** is a timed unit of work: `(trace_id, span_id)` with an optional
  `parent_span_id`. Kinds: `agent`, `tool`, `llm`.
- The **Tracer** creates spans and propagates trace context across `await`
  boundaries with `AsyncLocalStorage`, so nested calls automatically become child
  spans of the enclosing one.
- Cost is computed at span close from `model` + token usage via the shared
  pricing table, so it's stored, never recomputed on read.
- Export is **batched and non-blocking**: spans buffer and flush on size/time; your
  agent code never awaits network I/O.

## Basic usage

```ts
import { Tracer, HttpExporter } from '@agentlens/sdk';
import { randomUUID } from 'node:crypto';

const tracer = new Tracer({
  exporter: new HttpExporter('http://localhost:4000/v1/spans'),
  sessionId: randomUUID(), // groups a conversation for Session Replay
  maxBatchSize: 200, // flush when this many spans buffer
  flushIntervalMs: 2000, // …or at least this often
});

const answer = await tracer.agent('agent.run', async (root) => {
  root.setAttribute('question', question);

  const hits = await tracer.tool('web.search', async (s) => {
    s.setAttributes({ query: question });
    return search(question);
  });

  return tracer.llm('synthesize', 'gpt-4o', async (s) => {
    const res = await llm.chat({ model: 'gpt-4o', messages });
    s.setUsage(res.usage.input_tokens, res.usage.output_tokens); // drives cost
    s.setAttributes({ prompt, output: res.text }); // shown in the UI
    return res.text;
  });
});

// Before the process exits, flush buffered spans.
await tracer.shutdown();
```

Because `web.search` and `synthesize` run inside `agent.run`'s callback, they're
automatically linked as its children in the same trace — no manual id threading.

## API

### `new Tracer(options)`

| Option            | Type            | Default | Notes                       |
| ----------------- | --------------- | ------- | --------------------------- |
| `exporter`        | `Exporter`      | —       | required; where spans go    |
| `sessionId`       | `string`        | `null`  | groups spans into a session |
| `maxBatchSize`    | `number`        | `200`   | flush at this buffer size   |
| `flushIntervalMs` | `number`        | `2000`  | periodic flush interval     |
| `onError`         | `(err) => void` | logs    | export failure handler      |

Methods:

- `agent(name, fn)` / `tool(name, fn)` / `llm(name, model, fn)` — run `fn` inside a
  new span of that kind. Returns whatever `fn` returns. Errors are recorded on the
  span (`error`, `error_message`) and re-thrown.
- `span(name, kind, fn)` — the general form.
- `activeContext()` — the current `(traceId, spanId, sessionId)`, if any.
- `shutdown()` — flush and await in-flight exports. Call before exit.

### `ActiveSpan`

Handed to your callback. Chainable setters:

- `setModel(model)`
- `setUsage(inputTokens, outputTokens)` — required for cost on `llm` spans
- `setAttribute(key, value)` / `setAttributes(obj)` — `prompt` and `output` get
  first-class rendering in the dashboard; everything else shows as JSON.

### Exporters

- `HttpExporter(endpoint, fetchImpl?)` — POSTs `{ spans }` batches to the gateway;
  treats `202` as success. This is the production path.
- `BatchProcessor` — the buffering/flush engine (used internally by `Tracer`).
- `Exporter` interface — implement `export(spans)` (and optionally `shutdown()`)
  to send spans anywhere. The Phase 1 example ships a direct-to-Postgres exporter
  used only for local demos.

## Pricing

`@agentlens/shared` exports `PRICING` (model → `$/1M` input/output) and
`computeCost(model, inTok, outTok)`. Unknown models return `null` cost (better than
a wrong `0`). Add models by editing `packages/shared/src/pricing.ts`.
