import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type SpanRow, type TraceSummary } from '../api';
import { fmtCost } from '../util';

/**
 * Prompt-diff: pick two runs (traces) and compare their prompts/outputs side by
 * side with a line-level diff. Useful for seeing exactly what changed between a
 * baseline run and a new one.
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

  const textA = useMemo(() => extractText(qa.data?.spans ?? []), [qa.data]);
  const textB = useMemo(() => extractText(qb.data?.spans ?? []), [qb.data]);
  const rows = useMemo(() => lineDiff(textA.split('\n'), textB.split('\n')), [textA, textB]);

  if (traces.length < 2) {
    return <div className="empty">Need at least two traces in this session to diff.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
        <TracePicker label="run A" value={a} traces={traces} onChange={setA} />
        <TracePicker label="run B" value={b} traces={traces} onChange={setB} />
      </div>
      <div className="diff-cols">
        <div className="diff-pane">
          <h4 className="muted">run A</h4>
          {rows.map((r, i) => (
            <div key={i} className={`diff-line ${r.left && r.type === 'change' ? 'diff-del' : ''}`}>
              {r.left ?? ' '}
            </div>
          ))}
        </div>
        <div className="diff-pane">
          <h4 className="muted">run B</h4>
          {rows.map((r, i) => (
            <div key={i} className={`diff-line ${r.right && r.type === 'change' ? 'diff-add' : ''}`}>
              {r.right ?? ' '}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TracePicker({
  label,
  value,
  traces,
  onChange,
}: {
  label: string;
  value: string;
  traces: TraceSummary[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="muted" style={{ marginRight: 8 }}>
        {label}
      </label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {traces.map((t) => (
          <option key={t.trace_id} value={t.trace_id}>
            {t.root_name ?? t.trace_id.slice(0, 8)} · {new Date(t.started_at).toLocaleTimeString()} ·{' '}
            {fmtCost(t.total_cost_usd)}
          </option>
        ))}
      </select>
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
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
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
