import type pg from 'pg';

/** A span row as returned to the dashboard (snake_case, matches the SDK shape). */
export interface SpanRow {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  session_id: string | null;
  name: string;
  kind: string;
  started_at: string;
  ended_at: string;
  duration_ms: number | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  attributes: Record<string, unknown>;
}

export interface SessionSummary {
  session_id: string;
  span_count: number;
  trace_count: number;
  started_at: string;
  ended_at: string;
  total_cost_usd: number;
  /** Summed duration per span kind — drives the kind-share bar on session cards. */
  agent_ms: number;
  tool_ms: number;
  llm_ms: number;
  error_count: number;
}

const SPAN_SELECT = `
  span_id, trace_id, parent_span_id, session_id, name, kind,
  started_at, ended_at, duration_ms, model, input_tokens, output_tokens,
  cost_usd::float8 AS cost_usd, attributes`;

/** List sessions newest-first. Each row carries started_at so trace lookups can prune. */
export async function listSessions(
  pool: pg.Pool,
  opts: { limit?: number; sinceIso?: string | null } = {},
): Promise<SessionSummary[]> {
  const limit = Math.min(opts.limit ?? 50, 500);
  const params: unknown[] = [];
  let sinceClause = '';
  if (opts.sinceIso) {
    params.push(opts.sinceIso);
    sinceClause = `AND started_at >= $${params.length}`;
  }
  params.push(limit);
  const { rows } = await pool.query<SessionSummary>(
    `SELECT session_id,
            count(*)::int                    AS span_count,
            count(DISTINCT trace_id)::int    AS trace_count,
            min(started_at)                  AS started_at,
            max(ended_at)                    AS ended_at,
            COALESCE(sum(cost_usd), 0)::float8 AS total_cost_usd,
            COALESCE(sum(duration_ms) FILTER (WHERE kind = 'agent'), 0)::float8 AS agent_ms,
            COALESCE(sum(duration_ms) FILTER (WHERE kind = 'tool'), 0)::float8  AS tool_ms,
            COALESCE(sum(duration_ms) FILTER (WHERE kind = 'llm'), 0)::float8   AS llm_ms,
            count(*) FILTER (WHERE attributes ? 'error')::int AS error_count
     FROM spans
     WHERE session_id IS NOT NULL ${sinceClause}
     GROUP BY session_id
     ORDER BY min(started_at) DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/** Traces within a session (root span name, timing, cost), newest-first. */
export interface TraceSummary {
  trace_id: string;
  root_name: string | null;
  started_at: string;
  ended_at: string;
  span_count: number;
  total_cost_usd: number;
}

export async function listSessionTraces(pool: pg.Pool, sessionId: string): Promise<TraceSummary[]> {
  const { rows } = await pool.query<TraceSummary>(
    `SELECT trace_id,
            (array_agg(name ORDER BY started_at) FILTER (WHERE parent_span_id IS NULL))[1] AS root_name,
            min(started_at)                    AS started_at,
            max(ended_at)                      AS ended_at,
            count(*)::int                      AS span_count,
            COALESCE(sum(cost_usd), 0)::float8 AS total_cost_usd
     FROM spans
     WHERE session_id = $1
     GROUP BY trace_id
     ORDER BY min(started_at) DESC`,
    [sessionId],
  );
  return rows;
}

/** All spans of a session ordered by time — the source for session replay. */
export async function getSessionSpans(pool: pg.Pool, sessionId: string): Promise<SpanRow[]> {
  const { rows } = await pool.query<SpanRow>(
    `SELECT ${SPAN_SELECT} FROM spans WHERE session_id = $1 ORDER BY started_at, span_id`,
    [sessionId],
  );
  return rows;
}

/**
 * Fetch a trace's spans by trace_id. When `startIso` is given we bound started_at
 * to [start - window, start + window] so Postgres prunes to a couple of daily
 * partitions instead of scanning every one. Without it we fall back to a full scan.
 */
export async function getTrace(
  pool: pg.Pool,
  traceId: string,
  startIso: string | null,
  windowHours: number,
): Promise<SpanRow[]> {
  if (startIso) {
    const { rows } = await pool.query<SpanRow>(
      `SELECT ${SPAN_SELECT} FROM spans
       WHERE trace_id = $1
         AND started_at >= $2::timestamptz - ($3 || ' hours')::interval
         AND started_at <= $2::timestamptz + ($3 || ' hours')::interval
       ORDER BY started_at, span_id`,
      [traceId, startIso, windowHours],
    );
    return rows;
  }
  const { rows } = await pool.query<SpanRow>(
    `SELECT ${SPAN_SELECT} FROM spans WHERE trace_id = $1 ORDER BY started_at, span_id`,
    [traceId],
  );
  return rows;
}

/** Single span detail (full attributes). Time-bounded when startIso is supplied. */
export async function getSpan(
  pool: pg.Pool,
  spanId: string,
  startIso: string | null,
  windowHours: number,
): Promise<SpanRow | null> {
  const params: unknown[] = [spanId];
  let bound = '';
  if (startIso) {
    params.push(startIso, windowHours);
    bound = `AND started_at >= $2::timestamptz - ($3 || ' hours')::interval
             AND started_at <= $2::timestamptz + ($3 || ' hours')::interval`;
  }
  const { rows } = await pool.query<SpanRow>(
    `SELECT ${SPAN_SELECT} FROM spans WHERE span_id = $1 ${bound} LIMIT 1`,
    params,
  );
  return rows[0] ?? null;
}
