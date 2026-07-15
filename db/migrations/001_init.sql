-- AgentLens core schema.
-- One high-volume table (spans), partitioned by day. Sessions and traces are
-- derived by grouping on their IDs — no extra tables.

-- ---------------------------------------------------------------------------
-- spans: native daily RANGE partitions on started_at.
-- PK is (started_at, span_id): started_at must be in the PK for a partitioned
-- table, and (started_at, span_id) is the dedup/idempotency target for the writer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spans (
  span_id        UUID        NOT NULL,
  trace_id       UUID        NOT NULL,
  parent_span_id UUID,
  session_id     UUID,
  name           TEXT        NOT NULL,
  kind           TEXT        NOT NULL,   -- llm | tool | agent
  started_at     TIMESTAMPTZ NOT NULL,
  ended_at       TIMESTAMPTZ NOT NULL,
  duration_ms    INTEGER,
  model          TEXT,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  cost_usd       NUMERIC(12,6),
  attributes     JSONB,
  PRIMARY KEY (started_at, span_id)
) PARTITION BY RANGE (started_at);

-- Local per-partition indexes (created on the parent => inherited by partitions).
CREATE INDEX IF NOT EXISTS spans_trace_id_idx   ON spans (trace_id);
CREATE INDEX IF NOT EXISTS spans_session_id_idx ON spans (session_id);

-- DEFAULT partition: backstop so a write never fails just because the daily
-- partition job hasn't run. Rows here can be migrated into a real partition later.
CREATE TABLE IF NOT EXISTS spans_default PARTITION OF spans DEFAULT;

-- ---------------------------------------------------------------------------
-- spans_staging: UNLOGGED landing zone for the idempotent bulk load.
-- Writer COPYs a batch here (fast, no WAL), then
--   INSERT INTO spans SELECT * FROM spans_staging ON CONFLICT DO NOTHING
-- so a redelivered (duplicate) batch inserts zero extra rows. UNLOGGED is safe:
-- if it's lost on crash, the source Redis entry was never acked and redelivers.
-- ---------------------------------------------------------------------------
CREATE UNLOGGED TABLE IF NOT EXISTS spans_staging (LIKE spans INCLUDING DEFAULTS);

-- ---------------------------------------------------------------------------
-- eval_runs: one row per eval case execution. Baseline vs. current + gate result.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eval_runs (
  id            UUID         PRIMARY KEY,
  suite         TEXT         NOT NULL,
  case_id       TEXT         NOT NULL,
  git_sha       TEXT,
  score         NUMERIC(5,4) NOT NULL,
  baseline      NUMERIC(5,4),
  threshold     NUMERIC(5,4) NOT NULL,
  passed        BOOLEAN      NOT NULL,
  judge_model   TEXT,
  rationale     TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eval_runs_suite_case_idx ON eval_runs (suite, case_id, created_at DESC);
