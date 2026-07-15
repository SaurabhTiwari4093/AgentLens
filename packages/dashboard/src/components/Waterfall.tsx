import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type SpanRow, type TraceSummary } from '../api';
import { KIND_COLOR, computeDepths, fmtCost, fmtDuration, fmtTokens, treeOrder } from '../util';
import { SpanDetail } from './SpanDetail';

/**
 * Waterfall: spans of one trace laid out on a shared timeline. Bar offset/width are
 * proportional to each span's start/duration relative to the whole trace. Fetches
 * via the trace endpoint with a `start` bound so Postgres prunes partitions.
 */
export function Waterfall({ traces }: { traces: TraceSummary[] }) {
  const [traceId, setTraceId] = useState<string | null>(traces[0]?.trace_id ?? null);
  const selectedTrace = traces.find((t) => t.trace_id === traceId) ?? traces[0];

  const { data } = useQuery({
    queryKey: ['trace', selectedTrace?.trace_id],
    queryFn: () => api.trace(selectedTrace!.trace_id, selectedTrace!.started_at),
    enabled: !!selectedTrace,
    refetchInterval: 3000,
  });

  if (!selectedTrace) return <div className="empty">No traces in this session.</div>;

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <label className="muted" style={{ marginRight: 8 }}>
          trace
        </label>
        <select value={selectedTrace.trace_id} onChange={(e) => setTraceId(e.target.value)}>
          {traces.map((t) => (
            <option key={t.trace_id} value={t.trace_id}>
              {t.root_name ?? t.trace_id.slice(0, 8)} · {t.span_count} spans · {fmtCost(t.total_cost_usd)}
            </option>
          ))}
        </select>
      </div>
      {data ? <WaterfallBars spans={data.spans} /> : <div className="muted">Loading…</div>}
    </div>
  );
}

function WaterfallBars({ spans }: { spans: SpanRow[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const ordered = useMemo(() => treeOrder(spans), [spans]);
  const depths = useMemo(() => computeDepths(spans), [spans]);

  const { min, span } = useMemo(() => {
    const starts = spans.map((s) => new Date(s.started_at).getTime());
    const ends = spans.map((s) => new Date(s.ended_at).getTime());
    const min = Math.min(...starts);
    const max = Math.max(...ends);
    return { min, span: Math.max(1, max - min) };
  }, [spans]);

  const selectedSpan = spans.find((s) => s.span_id === selected);

  return (
    <div>
      {ordered.map((s) => {
        const start = new Date(s.started_at).getTime();
        const end = new Date(s.ended_at).getTime();
        const left = ((start - min) / span) * 100;
        const width = Math.max(0.5, ((end - start) / span) * 100);
        const depth = depths.get(s.span_id) ?? 0;
        return (
          <div className="wf-row" key={s.span_id} onClick={() => setSelected(s.span_id)}>
            <div className="wf-name" style={{ paddingLeft: depth * 14 }} title={s.name}>
              {depth > 0 ? '└ ' : ''}
              {s.name}
            </div>
            <div className="wf-track">
              <div
                className="wf-bar"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: KIND_COLOR[s.kind] ?? '#888',
                }}
              />
            </div>
            <div className="wf-stats">
              {fmtDuration(s.duration_ms)}
              {s.input_tokens != null && <> · {fmtTokens(s.input_tokens, s.output_tokens)}</>}
              {s.cost_usd != null && s.cost_usd > 0 && <> · {fmtCost(s.cost_usd)}</>}
            </div>
          </div>
        );
      })}
      {selectedSpan && <SpanDetail span={selectedSpan} />}
    </div>
  );
}
