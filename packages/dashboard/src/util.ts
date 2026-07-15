import type { SpanRow } from './api';

export const KIND_COLOR: Record<string, string> = {
  agent: '#7c6cf0',
  tool: '#2fb7a5',
  llm: '#e0913b',
};

/** Vertical gradients for waterfall bars, per span kind. */
export const KIND_BAR: Record<string, string> = {
  agent: 'linear-gradient(180deg, #8b7cf5, #6a59e0)',
  tool: 'linear-gradient(180deg, #3fcbb8, #27a291)',
  llm: 'linear-gradient(180deg, #edb45f, #d1832f)',
};

export function fmtCost(usd: number | null | undefined): string {
  if (usd == null) return '—';
  if (usd === 0) return '$0';
  return `$${usd.toFixed(6)}`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function fmtTokens(inp: number | null, out: number | null): string {
  if (inp == null && out == null) return '';
  return `${inp ?? 0}→${out ?? 0} tok`;
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Wall-clock time like "2:31:21 PM"; with `ms` adds milliseconds. */
export function fmtClock(iso: string, ms = false): string {
  return new Date(iso).toLocaleTimeString(
    undefined,
    ms
      ? { hour: 'numeric', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 }
      : undefined,
  );
}

/** Compact relative time: "2m ago", "11h ago". */
export function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** True when any span in the list recorded an error attribute. */
export function hasError(spans: Pick<SpanRow, 'attributes'>[]): boolean {
  return spans.some((s) => s.attributes != null && 'error' in s.attributes);
}

/** Depth of each span from its root, by walking parent_span_id links. */
export function computeDepths(spans: SpanRow[]): Map<string, number> {
  const byId = new Map(spans.map((s) => [s.span_id, s]));
  const depth = new Map<string, number>();
  const resolve = (s: SpanRow): number => {
    const cached = depth.get(s.span_id);
    if (cached != null) return cached;
    if (!s.parent_span_id || !byId.has(s.parent_span_id)) {
      depth.set(s.span_id, 0);
      return 0;
    }
    const d = resolve(byId.get(s.parent_span_id)!) + 1;
    depth.set(s.span_id, d);
    return d;
  };
  for (const s of spans) resolve(s);
  return depth;
}

/** Order spans as a pre-order DFS of the parent/child tree (waterfall order). */
export function treeOrder(spans: SpanRow[]): SpanRow[] {
  const children = new Map<string | null, SpanRow[]>();
  for (const s of spans) {
    const key =
      s.parent_span_id && spans.some((x) => x.span_id === s.parent_span_id)
        ? s.parent_span_id
        : null;
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(s);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.started_at.localeCompare(b.started_at));
  }
  const out: SpanRow[] = [];
  const walk = (parent: string | null) => {
    for (const s of children.get(parent) ?? []) {
      out.push(s);
      walk(s.span_id);
    }
  };
  walk(null);
  return out;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
