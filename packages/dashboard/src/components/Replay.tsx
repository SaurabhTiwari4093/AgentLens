import { useState } from 'react';
import type { SpanRow } from '../api';
import { KIND_COLOR, fmtDuration, shortId } from '../util';
import { SpanDetail } from './SpanDetail';

/**
 * Session replay: step through a session's spans in time order, one at a time —
 * like scrubbing through the agent's execution turn by turn.
 */
export function Replay({ spans }: { spans: SpanRow[] }) {
  const [i, setI] = useState(0);
  if (spans.length === 0) return <div className="empty">No spans in this session.</div>;
  const idx = Math.min(i, spans.length - 1);
  const current = spans[idx]!;

  return (
    <div>
      <div className="replay-controls">
        <button onClick={() => setI(Math.max(0, idx - 1))} disabled={idx === 0}>
          ◀ prev
        </button>
        <input
          type="range"
          min={0}
          max={spans.length - 1}
          value={idx}
          onChange={(e) => setI(Number(e.target.value))}
        />
        <button onClick={() => setI(Math.min(spans.length - 1, idx + 1))} disabled={idx === spans.length - 1}>
          next ▶
        </button>
        <span className="muted" style={{ whiteSpace: 'nowrap' }}>
          step {idx + 1} / {spans.length}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
        {spans.map((s, k) => (
          <div
            key={s.span_id}
            onClick={() => setI(k)}
            title={`${s.name} (${fmtDuration(s.duration_ms)})`}
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              cursor: 'pointer',
              background: KIND_COLOR[s.kind] ?? '#888',
              outline: k === idx ? '2px solid var(--text)' : 'none',
              opacity: k === idx ? 1 : 0.55,
            }}
          />
        ))}
      </div>

      <div className="muted" style={{ marginBottom: 6 }}>
        trace {shortId(current.trace_id)} · {new Date(current.started_at).toLocaleTimeString()}
      </div>
      <SpanDetail span={current} />
    </div>
  );
}
