import type { SpanRow } from '../api';
import { KIND_COLOR, fmtDuration, shortId } from '../util';

/** Left rail while replaying: the session's spans as numbered steps. */
export function StepsRail({
  sessionId,
  spans,
  idx,
  onSelect,
}: {
  sessionId: string;
  spans: SpanRow[];
  idx: number;
  onSelect: (i: number) => void;
}) {
  return (
    <>
      <div className="rail-header">
        <div className="rail-title">Steps — {shortId(sessionId)}</div>
        <div className="rail-count">{spans.length}</div>
      </div>
      <div className="rail-scroll">
        {spans.map((s, i) => (
          <div
            key={s.span_id}
            className={`step-row ${i === idx ? 'active' : ''}`}
            onClick={() => onSelect(i)}
          >
            <span className="step-num">{i + 1}</span>
            <span className="kind-dot" style={{ background: KIND_COLOR[s.kind] ?? '#888' }} />
            <span className="step-name">{s.name}</span>
            <span className="step-dur">{fmtDuration(s.duration_ms)}</span>
          </div>
        ))}
      </div>
      <div className="rail-hints">
        <span>
          <span className="key">←</span> <span className="key">→</span> step through
        </span>
        <span>
          <span className="key">space</span> autoplay
        </span>
      </div>
    </>
  );
}
