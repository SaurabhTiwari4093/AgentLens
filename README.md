# AgentLens

Open-source observability & evals for LLM agents.

- **SDK (TypeScript)** — instruments tool calls, token usage, cost, and latency into OTel-style traces.
- **Dashboard (React)** — waterfall views, session replay, prompt-diff.
- **Ingestion (Node.js)** — partitioned Postgres trace tables, crash-safe idempotent Redis-buffered batch writes sustaining 40k+ spans/sec.
- **Evals** — a prompt-regression harness (pluggable LLM-as-judge) that gates CI to catch quality drift before deploy.

## Docs

- [Quickstart](docs/quickstart.md) — run it locally in ~5 minutes
- [SDK reference](docs/sdk.md) — instrument your agent
- [Architecture](docs/architecture.md) — how the pieces fit and the durability guarantees
- [Self-hosting](docs/self-host.md) — deploy, env vars, scaling, real LLM judge
- [Evals](docs/evals.md) — the prompt-regression gate and its pluggable judges
- [Contributing](CONTRIBUTING.md)

## Quickstart (dev)

```bash
pnpm install
pnpm docker:up      # postgres + redis (redis has AOF on)
pnpm db:migrate     # apply schema + pre-create daily partitions
pnpm db:smoke       # Phase 0 check: write a span and read it back
pnpm example:agent  # Phase 1 check: run an instrumented agent, print its trace
pnpm test           # unit tests
```

### Ingestion pipeline (Phase 2)

```bash
pnpm --filter @agentlens/ingestion build
pnpm --filter @agentlens/ingestion gateway    # Fastify gateway on :4000
pnpm --filter @agentlens/ingestion writer      # Redis-consumer COPY writer
pnpm --filter @agentlens/ingestion partition-job   # pre-create daily partitions (cron this daily)

# Prove the load-bearing claims:
pnpm --filter @agentlens/ingestion loadtest    # 5k+ spans/sec sustained, no loss/dupes
pnpm --filter @agentlens/ingestion crashtest   # no dup rows after a writer crash/redelivery
```

### API + dashboard (Phase 3)

```bash
pnpm db:seed-demo                  # optional: seed demo sessions (incl. a 2-run session for diff)
pnpm --filter @agentlens/api start        # read API on :4001
pnpm --filter @agentlens/dashboard dev    # dashboard on :5173 (Vite)
```

Open http://localhost:5173 — sessions auto-refresh (TanStack `refetchInterval`, no sockets). Three views:
**Waterfall** (trace timeline with duration/tokens/cost + span detail), **Session Replay** (scrub a session span-by-span), **Prompt Diff** (line-level diff of two runs' prompts/outputs).

### Evals (Phase 4)

```bash
cd packages/evals
node --experimental-strip-types dist/cli.js eval examples/support.eval.ts --update-baseline  # pin
node --experimental-strip-types dist/cli.js eval examples/support.eval.ts                    # PASS
PROMPT_MODE=bad node --experimental-strip-types dist/cli.js eval examples/support.eval.ts     # FAIL (regression caught)
```

The CI `Eval Gate` workflow runs this on every PR and blocks merge when scores drop past threshold. See [docs/evals.md](docs/evals.md).

Set `DATABASE_URL` / `REDIS_URL` to point at your own instances (defaults target the docker-compose services).

## Layout

```
packages/
  sdk/         TypeScript instrumentation library
  ingestion/   gateway + Redis consumer + batch writer
  api/         read API for the dashboard
  dashboard/   React app (Vite)
  evals/       eval harness (pluggable judge) + CLI
  shared/      span schema (Zod) + pricing table
db/            migrations + partition management
docker/        compose: postgres + redis
```

## Status

- **Phase 0** — monorepo, docker, CI, partitioned schema, shared span/pricing. ✅
- **Phase 1** — SDK: spans, `AsyncLocalStorage` context propagation, tool/LLM capture, cost, batched non-blocking export. ✅
- **Phase 2** — ingestion: Fastify gateway → Redis Stream → idempotent COPY writer; partition job; load + crash tests. ✅ (measured ~49k spans/sec sustained, zero loss/dupes)
- **Phase 3** — read API (partition-pruned trace lookups) + React dashboard: waterfall, session replay, prompt-diff, live-ish polling. ✅
- **Phase 4** — evals: pluggable LLM-as-judge (deterministic mock for CI + provider-agnostic LLM judge), baseline pinning, `agentlens` CLI, `eval_runs` persistence, CI gate that blocks merge on regression. ✅
- **Phase 5** — docs & self-host: quickstart, SDK reference, architecture, self-host guide, evals guide, CONTRIBUTING, Apache-2.0. ✅

All five phases complete. See [docs/architecture.md](docs/architecture.md) for the design rationale.

## License

[Apache-2.0](LICENSE)
