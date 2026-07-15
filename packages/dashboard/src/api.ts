/** Thin client for the AgentLens read API. */
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4001';

export interface SpanRow {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  session_id: string | null;
  name: string;
  kind: 'agent' | 'tool' | 'llm' | string;
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
  agent_ms: number;
  tool_ms: number;
  llm_ms: number;
  error_count: number;
}

export interface TraceSummary {
  trace_id: string;
  root_name: string | null;
  started_at: string;
  ended_at: string;
  span_count: number;
  total_cost_usd: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  sessions: () => get<{ sessions: SessionSummary[] }>('/v1/sessions?limit=200'),
  session: (id: string) =>
    get<{ session_id: string; traces: TraceSummary[]; spans: SpanRow[] }>(`/v1/sessions/${id}`),
  trace: (id: string, start: string) =>
    get<{ trace_id: string; spans: SpanRow[] }>(
      `/v1/traces/${id}?start=${encodeURIComponent(start)}`,
    ),
};
