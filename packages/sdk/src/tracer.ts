import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { computeCost, type Span, type SpanKind } from '@agentlens/shared';
import { BatchProcessor, type BatchOptions, type Exporter } from './exporter.js';

/** The context that flows through async calls, identifying the current span. */
interface SpanContext {
  traceId: string;
  spanId: string;
  sessionId: string | null;
}

/**
 * A live, not-yet-finished span. Handed to the user's callback so they can attach
 * model/usage/attributes. Cost is computed from model + tokens at close time using
 * the shared pricing table, so cost is stored, never recomputed on read.
 */
export class ActiveSpan {
  model: string | null = null;
  inputTokens: number | null = null;
  outputTokens: number | null = null;
  readonly attributes: Record<string, unknown> = {};

  constructor(
    readonly traceId: string,
    readonly spanId: string,
    readonly parentSpanId: string | null,
    readonly sessionId: string | null,
    readonly name: string,
    readonly kind: SpanKind,
    readonly startedAt: number,
  ) {}

  setModel(model: string): this {
    this.model = model;
    return this;
  }

  /** Record token usage for an LLM call. Drives cost at close time. */
  setUsage(inputTokens: number, outputTokens: number): this {
    this.inputTokens = inputTokens;
    this.outputTokens = outputTokens;
    return this;
  }

  setAttribute(key: string, value: unknown): this {
    this.attributes[key] = value;
    return this;
  }

  setAttributes(attrs: Record<string, unknown>): this {
    Object.assign(this.attributes, attrs);
    return this;
  }
}

export interface TracerOptions extends BatchOptions {
  exporter: Exporter;
  /** Groups spans into a session for the replay view. Defaults to a new UUID. */
  sessionId?: string;
}

/**
 * Creates spans and propagates (trace_id, parent_span_id, session_id) across async
 * boundaries via AsyncLocalStorage. Child spans started inside a parent's callback
 * automatically inherit the trace and point their parent_span_id at it.
 */
export class Tracer {
  private readonly als = new AsyncLocalStorage<SpanContext>();
  private readonly processor: BatchProcessor;
  private readonly sessionId: string | null;

  constructor(opts: TracerOptions) {
    this.processor = new BatchProcessor(opts.exporter, opts);
    this.sessionId = opts.sessionId ?? null;
  }

  /** The span currently in scope, if any. */
  activeContext(): SpanContext | undefined {
    return this.als.getStore();
  }

  /**
   * Run `fn` inside a new span. Opens the span, sets it as the active context for
   * anything awaited inside `fn`, and closes+enqueues it when `fn` settles (even on
   * throw). Returns whatever `fn` returns.
   */
  async span<T>(
    name: string,
    kind: SpanKind,
    fn: (span: ActiveSpan) => Promise<T>,
  ): Promise<T> {
    const parent = this.als.getStore();
    const traceId = parent?.traceId ?? randomUUID();
    const spanId = randomUUID();
    const sessionId = parent?.sessionId ?? this.sessionId;
    const active = new ActiveSpan(
      traceId,
      spanId,
      parent?.spanId ?? null,
      sessionId,
      name,
      kind,
      Date.now(),
    );

    const ctx: SpanContext = { traceId, spanId, sessionId };
    try {
      return await this.als.run(ctx, () => fn(active));
    } catch (err) {
      active.setAttribute('error', true);
      active.setAttribute('error_message', err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      this.finish(active);
    }
  }

  /** Convenience wrappers so call sites read as agent/tool/llm. */
  agent<T>(name: string, fn: (span: ActiveSpan) => Promise<T>): Promise<T> {
    return this.span(name, 'agent', fn);
  }

  tool<T>(name: string, fn: (span: ActiveSpan) => Promise<T>): Promise<T> {
    return this.span(name, 'tool', fn);
  }

  llm<T>(name: string, model: string, fn: (span: ActiveSpan) => Promise<T>): Promise<T> {
    return this.span(name, 'llm', async (span) => {
      span.setModel(model);
      return fn(span);
    });
  }

  private finish(active: ActiveSpan): void {
    const endedAt = Date.now();
    const span: Span = {
      trace_id: active.traceId,
      span_id: active.spanId,
      parent_span_id: active.parentSpanId,
      session_id: active.sessionId,
      name: active.name,
      kind: active.kind,
      started_at: new Date(active.startedAt).toISOString(),
      ended_at: new Date(endedAt).toISOString(),
      duration_ms: Math.max(0, endedAt - active.startedAt),
      model: active.model,
      input_tokens: active.inputTokens,
      output_tokens: active.outputTokens,
      cost_usd: computeCost(active.model, active.inputTokens, active.outputTokens),
      attributes: active.attributes,
    };
    this.processor.enqueue(span);
  }

  /** Flush buffered spans and await in-flight exports. Call before process exit. */
  shutdown(): Promise<void> {
    return this.processor.shutdown();
  }
}
