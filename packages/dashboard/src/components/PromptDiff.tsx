import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type SpanRow, type TraceSummary } from '../api';
import { fmtClock, shortId } from '../util';

/**
 * Prompt-diff: pick two runs (traces) and compare their prompts/outputs side by
 * side with a line-level diff — run cards on top, delta summary chips, then two
 * gutter-numbered panes.
 */
export function PromptDiff({ traces }: { traces: TraceSummary[] }) {
  const [a, setA] = useState(traces[0]?.trace_id ?? '');
  const [b, setB] = useState(traces[1]?.trace_id ?? traces[0]?.trace_id ?? '');

  const ta = traces.find((t) => t.trace_id === a);
  const tb = traces.find((t) => t.trace_id === b);
  const qa = useQuery({
    queryKey: ['trace', a],
    queryFn: () => api.trace(a, ta!.started_at),
    enabled: !!ta,
  });
  const qb = useQuery({
    queryKey: ['trace', b],
    queryFn: () => api.trace(b, tb!.started_at),
    enabled: !!tb,
  });

  const spansA = useMemo(() => qa.data?.spans ?? [], [qa.data]);
  const spansB = useMemo(() => qb.data?.spans ?? [], [qb.data]);
  const textA = useMemo(() => extractText(spansA), [spansA]);
  const textB = useMemo(() => extractText(spansB), [spansB]);
  const rows = useMemo(() => lineDiff(textA.split('\n'), textB.split('\n')), [textA, textB]);
  const chips = useMemo(() => deltaChips(rows, spansA, spansB), [rows, spansA, spansB]);

  if (traces.length < 2) {
    return <div className="empty">Need at least two traces in this session to diff.</div>;
  }

  return (
    <div className="diff">
      <div className="run-pickers">
        <RunCard tag="a" value={a} traces={traces} spans={spansA} onChange={setA} />
        <button
          className="swap"
          title="Swap A and B"
          onClick={() => {
            setA(b);
            setB(a);
          }}
        >
          ⇄
        </button>
        <RunCard tag="b" value={b} traces={traces} spans={spansB} onChange={setB} />
      </div>

      <div className="delta-chips">
        <span className="delta-chip del">−{chips.removed} lines</span>
        <span className="delta-chip add">+{chips.added} lines</span>
        {chips.changedParts.map((c) => (
          <span key={c} className="delta-chip">
            {c}
          </span>
        ))}
        <span className="delta-chip">
          Δ tokens {chips.tokenDelta >= 0 ? '+' : '−'}
          {Math.abs(chips.tokenDelta)}
        </span>
      </div>

      <div className="diff-panes">
        <DiffPane tag="a" time={ta ? fmtClock(ta.started_at) : ''} rows={rows} side="left" />
        <DiffPane tag="b" time={tb ? fmtClock(tb.started_at) : ''} rows={rows} side="right" />
      </div>
    </div>
  );
}

function RunCard({
  tag,
  value,
  traces,
  spans,
  onChange,
}: {
  tag: 'a' | 'b';
  value: string;
  traces: TraceSummary[];
  spans: SpanRow[];
  onChange: (v: string) => void;
}) {
  const tokIn = spans.reduce((n, s) => n + (s.input_tokens ?? 0), 0);
  const tokOut = spans.reduce((n, s) => n + (s.output_tokens ?? 0), 0);
  const cost = spans.reduce((n, s) => n + (s.cost_usd ?? 0), 0);
  const trace = traces.find((t) => t.trace_id === value);
  return (
    <div className={`run-card ${tag}`}>
      <span className="run-tag">{tag.toUpperCase()}</span>
      <div className="run-card-body">
        <select className="run-select" value={value} onChange={(e) => onChange(e.target.value)}>
          {traces.map((t) => (
            <option key={t.trace_id} value={t.trace_id}>
              {t.root_name ?? shortId(t.trace_id)} · {fmtClock(t.started_at)}
            </option>
          ))}
        </select>
        <span className="run-sub">
          {trace ? `${trace.span_count} spans` : '…'}
          {spans.length > 0 && ` · ${tokIn}→${tokOut} tok · $${cost.toFixed(6)}`}
        </span>
      </div>
      <span className="caret">▾</span>
    </div>
  );
}

function DiffPane({
  tag,
  time,
  rows,
  side,
}: {
  tag: 'a' | 'b';
  time: string;
  rows: DiffRow[];
  side: 'left' | 'right';
}) {
  let lineNo = 0;
  return (
    <div className="diff-pane">
      <div className="diff-pane-header">
        <span className={`run-tag ${tag}`}>{tag.toUpperCase()}</span>
        <span>{time}</span>
      </div>
      <div className="diff-body">
        {rows.map((r, i) => {
          const text = side === 'left' ? r.left : r.right;
          const changed = r.type === 'change' && text != null;
          if (text != null) lineNo++;
          const cls = changed ? (side === 'left' ? 'del' : 'add') : '';
          const comment = text?.startsWith('# ') ?? false;
          return (
            <div key={i} className={`dline ${cls} ${comment ? 'comment' : ''}`}>
              <span className="gutter">{text != null ? lineNo : ''}</span>
              <span className="dtext">{text ?? ' '}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Concatenate prompt/output text across a trace's llm spans into one document. */
function extractText(spans: SpanRow[]): string {
  const parts: string[] = [];
  for (const s of spans) {
    const prompt = s.attributes?.prompt as string | undefined;
    const output = s.attributes?.output as string | undefined;
    if (prompt) parts.push(`# ${s.name} · prompt`, prompt);
    if (output) parts.push(`# ${s.name} · output`, output);
  }
  return parts.join('\n');
}

/** Summary chips: line counts, which span parts changed, token delta. */
function deltaChips(rows: DiffRow[], spansA: SpanRow[], spansB: SpanRow[]) {
  let removed = 0;
  let added = 0;
  for (const r of rows) {
    if (r.type !== 'change') continue;
    if (r.left != null) removed++;
    if (r.right != null) added++;
  }

  const byName = (spans: SpanRow[]) => {
    const m = new Map<string, { prompt?: string; output?: string }>();
    for (const s of spans) {
      const prompt = s.attributes?.prompt as string | undefined;
      const output = s.attributes?.output as string | undefined;
      if (prompt != null || output != null) m.set(s.name, { prompt, output });
    }
    return m;
  };
  const ma = byName(spansA);
  const mb = byName(spansB);
  const changedParts: string[] = [];
  for (const name of new Set([...ma.keys(), ...mb.keys()])) {
    const pa = ma.get(name);
    const pb = mb.get(name);
    if ((pa?.prompt ?? '') !== (pb?.prompt ?? '')) changedParts.push(`${name} · prompt changed`);
    if ((pa?.output ?? '') !== (pb?.output ?? '')) changedParts.push(`${name} · output changed`);
  }

  const tokens = (spans: SpanRow[]) =>
    spans.reduce((n, s) => n + (s.input_tokens ?? 0) + (s.output_tokens ?? 0), 0);
  return { removed, added, changedParts, tokenDelta: tokens(spansB) - tokens(spansA) };
}

interface DiffRow {
  left: string | null;
  right: string | null;
  type: 'equal' | 'change';
}

/** Minimal LCS line diff → aligned rows. Common lines align; differences pair up. */
function lineDiff(a: string[], b: string[]): DiffRow[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  const flushChanges = (lefts: string[], rights: string[]) => {
    const len = Math.max(lefts.length, rights.length);
    for (let k = 0; k < len; k++) {
      rows.push({ left: lefts[k] ?? null, right: rights[k] ?? null, type: 'change' });
    }
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ left: a[i]!, right: b[j]!, type: 'equal' });
      i++;
      j++;
    } else {
      const lefts: string[] = [];
      const rights: string[] = [];
      // Consume the divergent block until lines re-sync per the LCS table.
      while (i < n && j < m && a[i] !== b[j]) {
        if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
          lefts.push(a[i]!);
          i++;
        } else {
          rights.push(b[j]!);
          j++;
        }
      }
      flushChanges(lefts, rights);
    }
  }
  flushChanges(a.slice(i), b.slice(j));
  return rows;
}
