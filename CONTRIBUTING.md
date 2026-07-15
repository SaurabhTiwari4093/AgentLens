# Contributing to AgentLens

Thanks for your interest. AgentLens is a pnpm monorepo of TypeScript packages.

## Prerequisites

- Node.js 22+
- pnpm 10+
- Docker (for Postgres + Redis)

## Setup

```bash
pnpm install
pnpm docker:up      # postgres (:5433) + redis (:6380, AOF on)
pnpm db:migrate
pnpm test
```

## Layout

| Package | What it is |
|---|---|
| `packages/shared` | Zod span schema + pricing table — the one source of truth for span shape |
| `packages/sdk` | instrumentation library (Tracer, exporters) |
| `packages/ingestion` | gateway + Redis consumer + idempotent COPY writer |
| `packages/api` | read API for the dashboard |
| `packages/dashboard` | React app (Vite) |
| `packages/evals` | eval harness (pluggable judge) + `agentlens` CLI |
| `db/` | migrations + partition management |
| `docker/` | compose: postgres + redis |
| `docs/` | quickstart, SDK reference, self-host, evals |

## Before you open a PR

Run the same checks CI runs:

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test              # needs docker:up + db:migrate (some tests hit Postgres)
```

For ingestion changes, also run the pipeline checks:

```bash
pnpm --filter @agentlens/ingestion crashtest   # idempotency under crash/redelivery
pnpm --filter @agentlens/ingestion loadtest     # >= 5,000 spans/sec end to end
```

If you touch prompts or eval behavior, re-run the gate and re-pin baselines only
when a change is intentional:

```bash
node --experimental-strip-types packages/evals/dist/cli.js eval \
  packages/evals/examples/support.eval.ts --update-baseline
```

## Conventions

- **One span schema.** Never redefine span shape in a package — import it from
  `@agentlens/shared`. The COPY column order in the writer must match it.
- **Write path stays decoupled from read path.** The gateway only validates and
  enqueues; the writer bulk-inserts. Don't add DB work to the gateway.
- **Ingestion is idempotent by `(started_at, span_id)`.** Any change to the write
  path must keep the crash test green.
- Keep code style consistent with the surrounding files; `pnpm format` runs Prettier.

## Scope

v1 scope is deliberately limited to SDK, ingestion, dashboard, and evals. Auth,
multi-tenancy, redaction, retention policies, and provider-specific
auto-instrumentation are explicitly out of scope for v1.

## License

By contributing you agree that your contributions are licensed under Apache-2.0.
