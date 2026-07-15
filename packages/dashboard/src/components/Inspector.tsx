import { useState } from 'react';
import type { SpanRow } from '../api';
import { KIND_COLOR, fmtClock, fmtCost, fmtDuration } from '../util';
import { JsonBlock } from './JsonBlock';

/**
 * Persistent right-hand inspector for the selected span: metadata, token split,
 * prompt/output, remaining attributes, and quick actions.
 */
export function Inspector({
  span,
  onClose,
  onOpenReplay,
}: {
  span: SpanRow | null;
  onClose: () => void;
  onOpenReplay: (spanId: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!span) return <div className="empty">Select a span to inspect.</div>;

  const attrs = span.attributes ?? {};
  const prompt = attrs.prompt as string | undefined;
  const output = attrs.output as string | undefined;
  const rest = Object.fromEntries(
    Object.entries(attrs).filter(([k]) => k !== 'prompt' && k !== 'output'),
  );
  const tokIn = span.input_tokens ?? 0;
  const tokOut = span.output_tokens ?? 0;
  const hasTokens = span.input_tokens != null || span.output_tokens != null;

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(span, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <>
      <div className="insp-header">
        <span
          className={`kind-pill ${span.kind}`}
          style={{ background: KIND_COLOR[span.kind] ?? '#888' }}
        >
          {span.kind}
        </span>
        <span className="insp-title">{span.name}</span>
        <button className="insp-close" onClick={onClose} title="Clear selection">
          ✕
        </button>
      </div>
      <div className="insp-body">
        <div className="kv">
          <span className="k">duration</span>
          <span className="v">{fmtDuration(span.duration_ms)}</span>
          <span className="k">started</span>
          <span className="v">{fmtClock(span.started_at, true)}</span>
          {span.model && (
            <>
              <span className="k">model</span>
              <span className="v">{span.model}</span>
            </>
          )}
          <span className="k">cost</span>
          <span className="v teal">{fmtCost(span.cost_usd)}</span>
        </div>

        {hasTokens && (
          <div>
            <div className="section-label">Tokens</div>
            <div className="tok-bar">
              <div
                className="in"
                style={{ width: `${(tokIn / Math.max(1, tokIn + tokOut)) * 100}%` }}
              />
              <div
                className="out"
                style={{ width: `${(tokOut / Math.max(1, tokIn + tokOut)) * 100}%` }}
              />
            </div>
            <div className="tok-legend">
              <span>
                <span className="in">{tokIn}</span> in
              </span>
              <span>
                <span className="out">{tokOut}</span> out
              </span>
            </div>
          </div>
        )}

        {prompt && (
          <div>
            <div className="section-label">Prompt</div>
            <pre className="code-block">{prompt}</pre>
          </div>
        )}
        {output && (
          <div>
            <div className="section-label">Output</div>
            <pre className="code-block">{output}</pre>
          </div>
        )}
        {Object.keys(rest).length > 0 && (
          <div>
            <div className="section-label">Attributes</div>
            <JsonBlock value={rest} />
          </div>
        )}

        <div className="insp-actions">
          <button className="btn" onClick={copyJson}>
            {copied ? 'Copied ✓' : 'Copy span JSON'}
          </button>
          <button className="btn" onClick={() => onOpenReplay(span.span_id)}>
            Open in Replay →
          </button>
        </div>
      </div>
    </>
  );
}
