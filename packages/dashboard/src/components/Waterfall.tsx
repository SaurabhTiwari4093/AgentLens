import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type SpanRow, type TraceSummary } from '../api';
import {
  KIND_BAR,
  KIND_COLOR,
  computeDepths,
  fmtCost,
  fmtDuration,
  hasError,
  shortId,
  treeOrder,
} from '../util';

/**
 * Waterfall: spans of one trace laid out on a shared timeline, with a time ruler
 * and a stat strip. Bar offset/width are proportional to each span's start/duration
 * relative to the whole trace. Fetches via the trace endpoint with a `start` bound
 * so Postgres prunes partitions.
 */
export function Waterfall({
  trace,
  selectedSpanId,
  onSelectSpan,
}: {
  trace: TraceSummary | null;
  selectedSpanId: string | null;
  onSelectSpan: (id: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ['trace', trace?.trace_id],
    queryFn: () => api.trace(trace!.trace_id, trace!.started_at),
    enabled: !!trace,
    refetchInterval: 3000,
  });

  if (!trace) return <div className="empty">No traces in this session.</div>;
  if (!data) return <div className="empty">Loading trace…</div>;

  return (
    <WaterfallBody
      trace={trace}
      spans={data.spans}
      selectedSpanId={selectedSpanId}
      onSelectSpan={onSelectSpan}
    />
  );
}

function WaterfallBody({
  trace,
  spans,
  selectedSpanId,
  onSelectSpan,
}: {
  trace: TraceSummary;
  spans: SpanRow[];
  selectedSpanId: string | null;
  onSelectSpan: (id: string) => void;
}) {
  const ordered = useMemo(() => treeOrder(spans), [spans]);
  const depths = useMemo(() => computeDepths(spans), [spans]);

  const { min, total } = useMemo(() => {
    const starts = spans.map((s) => new Date(s.started_at).getTime());
    const ends = spans.map((s) => new Date(s.ended_at).getTime());
    const min = Math.min(...starts);
    return { min, total: Math.max(1, Math.max(...ends) - min) };
  }, [spans]);

  const stats = useMemo(() => {
    let tokIn = 0;
    let tokOut = 0;
    let llmCalls = 0;
    let cost = 0;
    for (const s of spans) {
      tokIn += s.input_tokens ?? 0;
      tokOut += s.output_tokens ?? 0;
      cost += s.cost_usd ?? 0;
      if (s.kind === 'llm') llmCalls++;
    }
    return { tokIn, tokOut, llmCalls, cost };
  }, [spans]);

  const ok = !hasError(spans);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div>
      <div className="trace-header">
        <span className="trace-title">{trace.root_name ?? shortId(trace.trace_id)}</span>
        <span className="id-pill">trace {shortId(trace.trace_id)}</span>
        <span className={`status-pill ${ok ? 'ok' : 'err'}`}>{ok ? 'ok' : 'error'}</span>
      </div>

      <div className="stat-strip">
        <StatCard label="Duration" value={fmtDuration(total)} />
        <StatCard label="Spans" value={String(spans.length)} />
        <StatCard
          label="Tokens"
          value={
            <>
              {stats.tokIn}
              <span className="dim">→</span>
              {stats.tokOut}
            </>
          }
        />
        <StatCard label="Cost" value={fmtCost(stats.cost)} tone="teal" />
        <StatCard label="LLM calls" value={String(stats.llmCalls)} tone="orange" />
      </div>

      <div className="wf">
        <div className="wf-grid wf-ruler">
          <div className="wf-ruler-label">Span</div>
          <div className="wf-ticks">
            {ticks.map((t, i) => (
              <span
                key={t}
                style={
                  i === 0
                    ? { left: 0 }
                    : i === ticks.length - 1
                      ? { right: 0 }
                      : { left: `${t * 100}%`, transform: 'translateX(-50%)' }
                }
              >
                {fmtDuration(Math.round(total * t))}
              </span>
            ))}
          </div>
          <div className="wf-ruler-label right">Stats</div>
        </div>

        {ordered.map((s) => {
          const start = new Date(s.started_at).getTime();
          const end = new Date(s.ended_at).getTime();
          const left = ((start - min) / total) * 100;
          const width = Math.max(0.5, ((end - start) / total) * 100);
          const depth = depths.get(s.span_id) ?? 0;
          const selected = s.span_id === selectedSpanId;
          const tok =
            s.kind === 'llm' && (s.input_tokens != null || s.output_tokens != null)
              ? `${s.input_tokens ?? 0}→${s.output_tokens ?? 0}`
              : null;
          return (
            <div
              className={`wf-grid wf-row ${selected ? 'selected' : ''} ${depth === 0 ? 'root' : ''}`}
              key={s.span_id}
              onClick={() => onSelectSpan(s.span_id)}
            >
              <div className="wf-name" style={{ paddingLeft: depth * 18 }} title={s.name}>
                {depth > 0 && <span className="tree-branch">└</span>}
                <span className="kind-chip" style={{ background: KIND_COLOR[s.kind] ?? '#888' }} />
                <span className="label">{s.name}</span>
              </div>
              <div className="wf-track">
                <div
                  className="wf-bar"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: KIND_BAR[s.kind] ?? KIND_COLOR[s.kind] ?? '#888',
                  }}
                />
                {tok &&
                  (left + width < 78 ? (
                    <span className="wf-tok" style={{ left: `${left + width}%` }}>
                      {tok}
                    </span>
                  ) : (
                    <span className="wf-tok" style={{ right: `${100 - left}%` }}>
                      {tok}
                    </span>
                  ))}
              </div>
              <div className="wf-stat">{fmtDuration(s.duration_ms)}</div>
            </div>
          );
        })}

        <div className="legend">
          {Object.entries(KIND_COLOR).map(([kind, color]) => (
            <span key={kind}>
              <span className="kind-chip" style={{ background: color }} />
              {kind}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: 'teal' | 'orange';
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ''}`}>{value}</div>
    </div>
  );
}
