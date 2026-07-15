import { SPAN_COLUMNS, type Span } from '@agentlens/shared';

/**
 * Encode a value for Postgres COPY *text* format (the default). Text format has
 * clean, well-specified escaping — safer than hand-rolling CSV quoting around
 * JSON payloads that contain commas, quotes, and newlines.
 *
 *   NULL           -> \N
 *   backslash      -> \\
 *   tab/newline/CR -> \t \n \r
 */
function encodeField(value: string | number | null): string {
  if (value === null) return '\\N';
  const s = typeof value === 'number' ? String(value) : value;
  return s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/** One COPY text row (tab-separated, newline-terminated) for a span. */
export function encodeSpanRow(s: Span): string {
  const fields: (string | number | null)[] = [
    s.span_id,
    s.trace_id,
    s.parent_span_id,
    s.session_id,
    s.name,
    s.kind,
    s.started_at,
    s.ended_at,
    s.duration_ms,
    s.model,
    s.input_tokens,
    s.output_tokens,
    s.cost_usd,
    JSON.stringify(s.attributes ?? {}),
  ];
  return fields.map(encodeField).join('\t') + '\n';
}

export const COPY_COLUMNS = SPAN_COLUMNS.join(', ');
