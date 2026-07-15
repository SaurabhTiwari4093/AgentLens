# Architecture

```
┌───────────┐  batched   ┌───────────┐  Redis    ┌───────────┐  COPY   ┌──────────────┐
│ Agent app │  spans     │ Ingestion │  Stream   │ Batch     │ ──────► │ PostgreSQL   │
│ + SDK     │ ─────────► │ gateway   │ ────────► │ writer    │         │ (partitioned │
└───────────┘            └───────────┘           └───────────┘         │  spans)      │
                                                                       └──────┬───────┘
┌───────────┐  REST poll  ┌───────────┐   reads                              │
│ React     │ ◄─────────► │ Query API │ ◄────────────────────────────────────┘
│ dashboard │             └───────────┘
└───────────┘
                    ┌──────────────┐
                    │ Eval harness │  (CLI, runs in CI)
                    └──────────────┘
```

## Two rules that keep it simple

1. **Write path is decoupled from read path.** The gateway only validates and
   pushes to Redis; a separate writer bulk-inserts. That decoupling buys the
   throughput — not extra machinery.
2. **Emit OTel-style spans** so the format is standard and no bespoke schema is
   invented.

## Delivery & durability guarantees

- **At-least-once → idempotent by `(started_at, span_id)`.** Redis consumer groups
  can redeliver after a writer crash between `COPY` and `XACK`. The writer `COPY`s
  into an `UNLOGGED` staging table then `INSERT … ON CONFLICT DO NOTHING`, so
  duplicates collapse to zero extra rows. Proven by the crash test.
- **Redis is the durable buffer** (AOF `everysec`); worst-case loss on a hard Redis
  failure is ~1s of in-flight telemetry.
- **Validation is the gateway's main cost.** Zod runs on the hot path; the load
  test profiles the gateway as well as the writer. In practice the gateway outruns
  the writer, so the DB write is the ceiling, and it clears 5k/sec with wide margin.

## Data model

One high-volume `spans` table, **daily range-partitioned** on `started_at`.
Sessions and traces are derived by grouping on their IDs — no extra tables. Local
indexes on `trace_id` and `session_id`. Trace-tree reads carry a **time bound** so
Postgres prunes to one or two partitions instead of scanning every one. Full DDL in
[`db/migrations`](../db/migrations).

## Package map

| Package | Role |
|---|---|
| `@agentlens/shared` | Zod span schema + pricing (single source of truth) |
| `@agentlens/sdk` | Tracer, context propagation, batched export |
| `@agentlens/ingestion` | gateway, Redis consumer, idempotent COPY writer, partition job |
| `@agentlens/api` | read API (sessions, trace tree, span detail) |
| `@agentlens/dashboard` | React UI: waterfall, replay, prompt-diff |
| `@agentlens/evals` | LLM-as-judge harness + `agentlens` CLI |

## The two load-bearing claims

Both were easy to hand-wave, so both are validated by a test you can run:

1. **5,000+ spans/sec** — `pnpm --filter @agentlens/ingestion loadtest` drives the full
   HTTP → Redis → `COPY` → Postgres path and asserts throughput plus zero loss and
   zero duplicates. Measured ~49k spans/sec sustained locally.
2. **An eval gate that catches drift** — the CI gate runs the suite against pinned
   baselines, then re-runs it with a deliberately worsened prompt and asserts that it
   *fails*. A gate that can't fail isn't a gate.
