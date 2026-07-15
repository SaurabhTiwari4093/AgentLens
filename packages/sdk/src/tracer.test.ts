import { describe, it, expect } from 'vitest';
import type { Span } from '@agentlens/shared';
import { Tracer } from './tracer.js';
import type { Exporter } from './exporter.js';

/** Collecting exporter for assertions. Flushes are awaited via tracer.shutdown(). */
class MemoryExporter implements Exporter {
  spans: Span[] = [];
  async export(spans: Span[]): Promise<void> {
    this.spans.push(...spans);
  }
}

function tracer(exporter: Exporter, sessionId?: string) {
  // Small batch + fast flush so tests don't wait on the interval.
  return new Tracer({ exporter, sessionId, maxBatchSize: 1, flushIntervalMs: 10 });
}

describe('Tracer context propagation', () => {
  it('links child spans to their parent within one trace', async () => {
    const exp = new MemoryExporter();
    const t = tracer(exp, 'session-1');

    await t.agent('agent.run', async () => {
      await t.tool('search', async () => 'ok');
      await t.llm('chat', 'gpt-4o', async (s) => {
        s.setUsage(1000, 500);
        return 'answer';
      });
    });
    await t.shutdown();

    expect(exp.spans).toHaveLength(3);
    const root = exp.spans.find((s) => s.name === 'agent.run')!;
    const tool = exp.spans.find((s) => s.name === 'search')!;
    const llm = exp.spans.find((s) => s.name === 'chat')!;

    // All share one trace and session.
    expect(new Set(exp.spans.map((s) => s.trace_id)).size).toBe(1);
    for (const s of exp.spans) expect(s.session_id).toBe('session-1');

    // Root has no parent; children point at the root.
    expect(root.parent_span_id).toBeNull();
    expect(tool.parent_span_id).toBe(root.span_id);
    expect(llm.parent_span_id).toBe(root.span_id);
  });

  it('nests grandchildren correctly', async () => {
    const exp = new MemoryExporter();
    const t = tracer(exp);
    await t.agent('root', async () => {
      await t.tool('outer', async () => {
        await t.tool('inner', async () => 'x');
      });
    });
    await t.shutdown();

    const outer = exp.spans.find((s) => s.name === 'outer')!;
    const inner = exp.spans.find((s) => s.name === 'inner')!;
    expect(inner.parent_span_id).toBe(outer.span_id);
  });
});

describe('Tracer cost + timing', () => {
  it('computes cost from model + usage at close time', async () => {
    const exp = new MemoryExporter();
    const t = tracer(exp);
    await t.llm('chat', 'gpt-4o', async (s) => s.setUsage(1000, 500));
    await t.shutdown();

    const span = exp.spans[0]!;
    expect(span.model).toBe('gpt-4o');
    // gpt-4o: 1000*2.5/1e6 + 500*10/1e6 = 0.0075
    expect(span.cost_usd).toBeCloseTo(0.0075, 6);
    expect(span.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('records error metadata and still exports the span on throw', async () => {
    const exp = new MemoryExporter();
    const t = tracer(exp);
    await expect(
      t.tool('boom', async () => {
        throw new Error('kaboom');
      }),
    ).rejects.toThrow('kaboom');
    await t.shutdown();

    const span = exp.spans[0]!;
    expect(span.attributes.error).toBe(true);
    expect(span.attributes.error_message).toBe('kaboom');
  });
});
