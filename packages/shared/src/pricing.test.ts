import { describe, it, expect } from 'vitest';
import { computeCost } from './pricing.js';
import { Span, SpanBatch } from './span.js';

describe('computeCost', () => {
  it('computes blended input/output cost per 1M tokens', () => {
    // gpt-4o: $2.5/1M in, $10/1M out. 1000 in + 500 out.
    expect(computeCost('gpt-4o', 1000, 500)).toBeCloseTo(0.0075, 6);
  });

  it('returns null for an unknown model rather than a wrong zero', () => {
    expect(computeCost('made-up-model', 1000, 1000)).toBeNull();
  });

  it('returns null when no model is set', () => {
    expect(computeCost(null, 1000, 1000)).toBeNull();
  });

  it('treats missing token counts as zero', () => {
    expect(computeCost('gpt-4o', null, null)).toBe(0);
  });
});

describe('Span schema', () => {
  const base = {
    trace_id: '11111111-1111-1111-1111-111111111111',
    span_id: '22222222-2222-2222-2222-222222222222',
    name: 'llm.chat',
    kind: 'llm' as const,
    started_at: '2026-07-15T00:00:00.000Z',
    ended_at: '2026-07-15T00:00:01.000Z',
    duration_ms: 1000,
  };

  it('applies nullable defaults for optional fields', () => {
    const parsed = Span.parse(base);
    expect(parsed.parent_span_id).toBeNull();
    expect(parsed.session_id).toBeNull();
    expect(parsed.cost_usd).toBeNull();
    expect(parsed.attributes).toEqual({});
  });

  it('rejects a non-uuid trace id', () => {
    expect(() => Span.parse({ ...base, trace_id: 'nope' })).toThrow();
  });

  it('rejects an empty batch', () => {
    expect(() => SpanBatch.parse({ spans: [] })).toThrow();
  });
});
