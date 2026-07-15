# Quickstart

Get AgentLens running locally and see a trace end to end in ~5 minutes.

## 1. Start the infrastructure

```bash
pnpm install
pnpm docker:up      # postgres on :5433, redis on :6380 (AOF on)
pnpm db:migrate     # schema + pre-created daily partitions
```

## 2. Run the full pipeline

Open four terminals (or run each in the background):

```bash
# 1) ingestion gateway — receives span batches over HTTP
pnpm --filter @agentlens/ingestion gateway        # :4000

# 2) writer — drains Redis into Postgres with COPY
pnpm --filter @agentlens/ingestion writer

# 3) read API — serves the dashboard
pnpm --filter @agentlens/api start                # :4001

# 4) dashboard
pnpm --filter @agentlens/dashboard dev            # :5173
```

## 3. Produce a trace

Either run the bundled example agent (writes straight to Postgres):

```bash
pnpm example:agent
```

…or instrument your own agent with the SDK pointed at the gateway (see
[sdk.md](sdk.md)). Then open <http://localhost:5173> and explore it in the
Waterfall, Session Replay, and Prompt Diff views. The session list auto-refreshes.

## 4. Seed demo data (optional)

```bash
pnpm db:seed-demo   # a couple of sessions, incl. a 2-run session for Prompt Diff
```

## Ports & env

| Service | Default | Env override |
|---|---|---|
| Postgres | `localhost:5433` | `DATABASE_URL` |
| Redis | `localhost:6380` | `REDIS_URL` |
| Gateway | `:4000` | `GATEWAY_PORT` |
| Read API | `:4001` | `API_PORT` |
| Dashboard | `:5173` | `VITE_API_URL` (points the UI at the API) |

The dev ports are remapped off the Postgres/Redis defaults (5432/6379) so they
don't clash with a local install. For a container-only deploy see
[self-host.md](self-host.md).
