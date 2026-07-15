import type { SpanRow } from '../api';
import { KIND_COLOR, fmtCost, fmtDuration, fmtTime, fmtTokens } from '../util';

/** Renders one span's metadata + notable attributes (prompt, output, args). */
export function SpanDetail({ span }: { span: SpanRow }) {
  const attrs = span.attributes ?? {};
  const prompt = attrs.prompt as string | undefined;
  const output = attrs.output as string | undefined;
  const rest = Object.fromEntries(
    Object.entries(attrs).filter(([k]) => k !== 'prompt' && k !== 'output'),
  );

  return (
    <div className="detail">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span className="pill" style={{ background: KIND_COLOR[span.kind] ?? '#888' }}>
          {span.kind}
        </span>
        <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{span.name}</strong>
      </div>

      <div className="kv">
        <span className="k">duration</span>
        <span>{fmtDuration(span.duration_ms)}</span>
        <span className="k">started</span>
        <span>{fmtTime(span.started_at)}</span>
        {span.model && (
          <>
            <span className="k">model</span>
            <span>{span.model}</span>
          </>
        )}
        {(span.input_tokens != null || span.output_tokens != null) && (
          <>
            <span className="k">tokens</span>
            <span>{fmtTokens(span.input_tokens, span.output_tokens)}</span>
          </>
        )}
        <span className="k">cost</span>
        <span>{fmtCost(span.cost_usd)}</span>
      </div>

      {prompt && (
        <>
          <div className="muted">prompt</div>
          <pre>{prompt}</pre>
        </>
      )}
      {output && (
        <>
          <div className="muted">output</div>
          <pre>{output}</pre>
        </>
      )}
      {Object.keys(rest).length > 0 && (
        <>
          <div className="muted">attributes</div>
          <pre>{JSON.stringify(rest, null, 2)}</pre>
        </>
      )}
    </div>
  );
}
