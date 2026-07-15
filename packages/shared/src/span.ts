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
  // z.guid(), not z.uuid(): Zod 4's uuid() enforces RFC 4122 version/variant bits,
  // which is stricter than the Postgres UUID column we store into. guid() keeps the
  // wire format aligned with storage and accepts any 8-4-4-4-12 hex id.
  trace_id: z.guid(),
  span_id: z.guid(),
  parent_span_id: z.guid().nullable().default(null),
  session_id: z.guid().nullable().default(null),
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
  // stays stable while the payload evolves. Zod 4 requires an explicit key schema.
  attributes: z.record(z.string(), z.unknown()).default({}),
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
