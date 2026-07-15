import { z } from 'zod';

/**
 * The one canonical span shape. SDK, ingestion, and dashboard all import this so
 * they can never disagree on the wire/storage format. OTel-style: a span is a
 * timed unit of work identified by (trace_id, span_id) with an optional parent.
 */

export const SpanKind = z.enum(['llm', 'tool', 'agent']);
export type SpanKind = z.infer<typeof SpanKind>;

/**
 * A span as emitted by the SDK and accepted by the ingestion gateway.
 *
 * Timestamps are ISO-8601 strings on the wire (JSON has no date type); the writer
 * casts them to TIMESTAMPTZ. `duration_ms` is derived by the SDK from start/end so
 * the read path never has to compute it.
 */
export const Span = z.object({
  trace_id: z.string().uuid(),
  span_id: z.string().uuid(),
  parent_span_id: z.string().uuid().nullable().default(null),
  session_id: z.string().uuid().nullable().default(null),
  name: z.string().min(1).max(512),
  kind: SpanKind,
  started_at: z.string().datetime({ offset: true }),
  ended_at: z.string().datetime({ offset: true }),
  duration_ms: z.number().int().nonnegative(),
  model: z.string().max(128).nullable().default(null),
  input_tokens: z.number().int().nonnegative().nullable().default(null),
  output_tokens: z.number().int().nonnegative().nullable().default(null),
  cost_usd: z.number().nonnegative().nullable().default(null),
  // Free-form: prompt, params, tool args, output. Kept as an object so the schema
  // stays stable while the payload evolves.
  attributes: z.record(z.unknown()).default({}),
});
export type Span = z.infer<typeof Span>;

/**
 * The SDK exports spans in batches. The gateway validates the whole batch against
 * this before pushing to Redis — validation is the gateway's main CPU cost, so the
 * batch is capped to keep a single request bounded.
 */
export const SpanBatch = z.object({
  spans: z.array(Span).min(1).max(1000),
});
export type SpanBatch = z.infer<typeof SpanBatch>;

/** Column order used by the COPY writer. Must match db/migrations spans table. */
export const SPAN_COLUMNS = [
  'span_id',
  'trace_id',
  'parent_span_id',
  'session_id',
  'name',
  'kind',
  'started_at',
  'ended_at',
  'duration_ms',
  'model',
  'input_tokens',
  'output_tokens',
  'cost_usd',
  'attributes',
] as const;
