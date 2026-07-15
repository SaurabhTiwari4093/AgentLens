import { describe, it, expect } from 'vitest';
import type { Span } from '@agentlens/shared';
import { encodeSpanRow } from './copy.js';

const base: Span = {
  trace_id: '11111111-1111-1111-1111-111111111111',
  span_id: '22222222-2222-2222-2222-222222222222',
  parent_span_id: null,
  session_id: null,
  name: 'llm.chat',
  kind: 'llm',
  started_at: '2026-07-15T00:00:00.000Z',
  ended_at: '2026-07-15T00:00:01.000Z',
  duration_ms: 1000,
  model: 'gpt-4o',
  input_tokens: 100,
  output_tokens: 20,
  cost_usd: 0.00045,
  attributes: {},
};

describe('encodeSpanRow (COPY text format)', () => {
  it('renders null columns as \\N and ends with newline', () => {
    const row = encodeSpanRow(base);
    const cols = row.replace(/\n$/, '').split('\t');
    expect(row.endsWith('\n')).toBe(true);
    expect(cols).toHaveLength(14);
    expect(cols[2]).toBe('\\N'); // parent_span_id
    expect(cols[3]).toBe('\\N'); // session_id
    expect(cols[0]).toBe(base.span_id);
  });

  it('escapes tabs, newlines, and backslashes inside attributes JSON', () => {
    const row = encodeSpanRow({
      ...base,
      attributes: { prompt: 'line1\nline2\ttabbed \\ end' },
    });
    const attrsField = row.replace(/\n$/, '').split('\t')[13]!;
    // No raw control chars survive — they'd corrupt the COPY stream.
    expect(attrsField).not.toContain('\n');
    expect(attrsField.includes('\t')).toBe(false);
    expect(attrsField).toContain('\\n');
    expect(attrsField).toContain('\\t');
    // JSON's own backslash (\n inside the string) becomes \\n after COPY-escaping.
    expect(attrsField).toContain('\\\\n');
  });

  it('encodes numeric columns as plain strings', () => {
    const cols = encodeSpanRow(base).replace(/\n$/, '').split('\t');
    expect(cols[8]).toBe('1000'); // duration_ms
    expect(cols[12]).toBe('0.00045'); // cost_usd
  });
});
