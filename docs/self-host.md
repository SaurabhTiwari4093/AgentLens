# Self-Hosting AgentLens

AgentLens is a set of small Node services around Postgres and Redis. This guide
runs the data stores in Docker and the services with Node; adapt to your
orchestrator as needed.

## Components

```
SDK ──HTTP──▶ gateway ──Redis Stream──▶ writer ──COPY──▶ Postgres (partitioned)
                                                              │
dashboard ◀──HTTP── read API ◀────────────reads──────────────┘
partition-job (daily cron)  ─────────────────────────────────┘
eval CLI (in CI)
```

## 1. Data stores

```bash
pnpm docker:up      # docker/docker-compose.yml — postgres + redis (AOF on)
```

For production, point at managed Postgres 16+ and Redis 7+ instead and set
`DATABASE_URL` / `REDIS_URL`. Redis **must** have AOF enabled (`appendonly yes`,
`appendfsync everysec`) — the stream is the durable buffer between gateway and
writer.

## 2. Schema

```bash
pnpm db:migrate     # applies db/migrations/*.sql, pre-creates daily partitions
```

## 3. Services

Build once, then run the compiled output:

```bash
pnpm -r build

DATABASE_URL=... REDIS_URL=... node packages/ingestion/dist/gateway/server.js
DATABASE_URL=... REDIS_URL=... node packages/ingestion/dist/writer/main.js
DATABASE_URL=...               node packages/api/dist/server.js
```

The dashboard is a static build:

```bash
VITE_API_URL=https://your-api.example.com pnpm --filter @agentlens/dashboard build
# serve packages/dashboard/dist/ from any static host / CDN
```

## 4. Daily partition job

The writer never fails a write thanks to the `DEFAULT` partition, but you want real
daily partitions. Run this once a day (cron, systemd timer, k8s CronJob):

```bash
DATABASE_URL=... node packages/ingestion/dist/writer/partition-job.js
```

It pre-creates today **plus the next 3 days**, so a single missed run can't cause a
midnight write failure.

## Environment variables

| Var | Used by | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | writer, api, evals, migrate | `postgres://agentlens:agentlens@localhost:5433/agentlens` | Postgres DSN |
| `REDIS_URL` | gateway, writer | `redis://localhost:6380` | Redis DSN |
| `AGENTLENS_STREAM` | gateway, writer | `agentlens:spans` | Redis Stream key |
| `AGENTLENS_GROUP` | writer | `writers` | consumer group |
| `GATEWAY_PORT` | gateway | `4000` | gateway listen port |
| `API_PORT` | api | `4001` | read API listen port |
| `WRITER_READ_COUNT` | writer | `50` | stream entries per read |
| `WRITER_BLOCK_MS` | writer | `2000` | block time waiting for entries |
| `WRITER_POOL_SIZE` | writer | `8` | Postgres pool size |
| `TRACE_WINDOW_HOURS` | api | `24` | partition-pruning window for trace lookups |
| `VITE_API_URL` | dashboard (build) | `http://localhost:4001` | API base URL baked into the UI |

## Scaling & operations

- **Throughput.** A single writer sustains far past the 5,000 spans/sec target
  (measured ~49k/sec locally). To scale reads, add read replicas and point the API
  at them. To scale writes, run multiple writers; each uses its own consumer name,
  and the upsert keeps inserts idempotent.
- **Idempotency.** Delivery is at-least-once. The writer `COPY`s into an `UNLOGGED`
  staging table and `INSERT … ON CONFLICT (started_at, span_id) DO NOTHING`, so a
  redelivered batch (writer crash between commit and ack) inserts zero duplicate
  rows. Validate with `pnpm --filter @agentlens/ingestion crashtest`.
- **Retention.** Out of scope for v1. Because `spans` is daily-partitioned, you can
  add retention later by `DROP`ping old partitions — cheap and lock-light.
- **Payload size.** Prompts/outputs live in the `attributes` JSONB on the hot
  table. If it grows heavy, split large payloads into a side table keyed by
  `span_id`.

## Wiring a real LLM judge (evals)

The eval CLI uses the deterministic `MockJudge` so CI is reproducible. For local or
scheduled evals with a real model, construct an `LLMJudge` with any completion
function and call `runSuite()` directly:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { LLMJudge, runSuite, loadBaseline } from '@agentlens/evals';
import suite from './support.eval.ts';

const client = new Anthropic();
const judge = new LLMJudge(async (prompt) => {
  const res = await client.messages.create({
    model: 'claude-sonnet-4',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });
  return res.content.map((b) => ('text' in b ? b.text : '')).join('');
}, 'claude-sonnet-4');

const baseline = await loadBaseline('./support.eval.baseline.json');
const result = await runSuite(suite, judge, baseline);
process.exit(result.passed ? 0 : 1);
```

The judge is provider-agnostic — swap Anthropic for OpenAI, a local model, or any
`(prompt) => Promise<string>`. Calibrate against a few human-labeled examples so
the gate is trustworthy (see [evals.md](evals.md)).
