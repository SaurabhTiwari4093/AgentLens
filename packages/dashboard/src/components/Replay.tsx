import { useMemo } from 'react';
import type { SpanRow } from '../api';
import { KIND_COLOR, fmtClock, fmtCost, fmtDuration } from '../util';
import { JsonBlock } from './JsonBlock';

/**
 * Session replay: scrub through the session's spans in time order via a
 * duration-proportional filmstrip, with a card showing the current step and
 * what the agent does next. Keyboard: ←/→ step, space autoplay (bound in App).
 */
export function Replay({
  spans,
  idx,
  playing,
  onSelect,
  onTogglePlay,
}: {
  spans: SpanRow[];
  idx: number;
  playing: boolean;
  onSelect: (i: number) => void;
  onTogglePlay: () => void;
}) {
  const clamped = Math.min(idx, Math.max(0, spans.length - 1));
  const current = spans[clamped];

  const durations = useMemo(() => spans.map((s) => Math.max(1, s.duration_ms ?? 1)), [spans]);
  const totalMs = durations.reduce((a, b) => a + b, 0);
  // Playhead sits mid-way through the current step's slice of the strip.
  const playheadPct =
    ((durations.slice(0, clamped).reduce((a, b) => a + b, 0) + durations[clamped]! / 2) /
      Math.max(1, totalMs)) *
    100;

  if (spans.length === 0 || !current) {
    return <div className="empty">No spans in this session.</div>;
  }

  return (
    <div className="replay">
      <div className="transport">
        <div className="t-btns">
          <button
            className="t-btn"
            onClick={() => onSelect(Math.max(0, clamped - 1))}
            disabled={clamped === 0}
            title="Previous step (←)"
          >
            ⏮
          </button>
          <button className="t-btn primary" onClick={onTogglePlay} title="Autoplay (space)">
            {playing ? '⏸' : '▶'}
          </button>
          <button
            className="t-btn"
            onClick={() => onSelect(Math.min(spans.length - 1, clamped + 1))}
            disabled={clamped === spans.length - 1}
            title="Next step (→)"
          >
            ⏭
          </button>
        </div>
        <div className="filmstrip">
          {spans.map((s, i) => (
            <div
              key={s.span_id}
              className={`film-block ${s.kind} ${i === clamped ? 'active' : ''}`}
              style={{ flex: durations[i] }}
              onClick={() => onSelect(i)}
              title={`${s.name} (${fmtDuration(s.duration_ms)})`}
            >
              <span>{s.name}</span>
            </div>
          ))}
        </div>
        <div className="step-counter">
          step <b>{clamped + 1}</b> / {spans.length}
        </div>
      </div>
      <div className="playhead-track">
        <div className="playhead" style={{ left: `${playheadPct}%` }} />
      </div>

      <StepCard
        span={current}
        upcoming={spans.slice(clamped + 1)}
        onJump={(i) => onSelect(clamped + 1 + i)}
      />
    </div>
  );
}

function StepCard({
  span,
  upcoming,
  onJump,
}: {
  span: SpanRow;
  upcoming: SpanRow[];
  onJump: (offset: number) => void;
}) {
  return (
    <div className="step-card">
      <div className="step-card-header">
        <span
          className={`kind-pill ${span.kind}`}
          style={{ background: KIND_COLOR[span.kind] ?? '#888' }}
        >
          {span.kind}
        </span>
        <span className="step-card-title">{span.name}</span>
        <span className="step-card-meta">
          <span>{fmtDuration(span.duration_ms)}</span>
          <span>{fmtClock(span.started_at, true)}</span>
          {span.cost_usd != null && span.cost_usd > 0 ? (
            <span>cost {fmtCost(span.cost_usd)}</span>
          ) : (
            <span className="faint">cost —</span>
          )}
        </span>
      </div>
      <div className="step-card-grid">
        <div className="step-card-col">
          <div className="section-label">Attributes</div>
          <JsonBlock value={span.attributes ?? {}} />
        </div>
        <div className="step-card-col">
          <div className="section-label">What happens next</div>
          {upcoming.length === 0 ? (
            <div className="muted">Last step — session complete.</div>
          ) : (
            <div className="next-list">
              {upcoming.map((s, i) => (
                <div key={s.span_id} className="next-item" onClick={() => onJump(i)}>
                  <span className="kind-dot" style={{ background: KIND_COLOR[s.kind] ?? '#888' }} />
                  <span className="nn">{s.name}</span>
                  <span className="nd">
                    — {fmtDuration(s.duration_ms)}
                    {s.cost_usd != null && s.cost_usd > 0 ? ` · ${fmtCost(s.cost_usd)}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
