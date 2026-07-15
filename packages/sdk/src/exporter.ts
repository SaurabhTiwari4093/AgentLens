import type { Span } from '@agentlens/shared';

/**
 * Sink for finished spans. Implementations must never throw into the caller's
 * hot path — the BatchProcessor calls export() from a background flush and
 * swallows/reports errors itself.
 */
export interface Exporter {
  export(spans: Span[]): Promise<void>;
  /** Optional: flush and release resources on shutdown. */
  shutdown?(): Promise<void>;
}

export interface BatchOptions {
  /** Flush once this many spans are buffered. */
  maxBatchSize?: number;
  /** Flush at least this often (ms), even if the batch isn't full. */
  flushIntervalMs?: number;
  /** Called when an export fails, so failures aren't silent. */
  onError?: (err: unknown) => void;
}

/**
 * Buffers spans and flushes on size or time, whichever comes first. Enqueue is
 * synchronous and non-blocking: it only pushes to an array and (maybe) triggers
 * a flush that runs detached. The caller's agent code is never awaited on I/O.
 */
export class BatchProcessor {
  private buffer: Span[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly maxBatchSize: number;
  private readonly flushIntervalMs: number;
  private readonly onError: (err: unknown) => void;
  private inFlight = new Set<Promise<void>>();

  constructor(
    private readonly exporter: Exporter,
    opts: BatchOptions = {},
  ) {
    this.maxBatchSize = opts.maxBatchSize ?? 200;
    this.flushIntervalMs = opts.flushIntervalMs ?? 2000;
    this.onError = opts.onError ?? ((err) => console.error('[agentlens] export failed:', err));
  }

  enqueue(span: Span): void {
    this.buffer.push(span);
    this.ensureTimer();
    if (this.buffer.length >= this.maxBatchSize) {
      this.flush();
    }
  }

  /** Detached flush: drains the buffer and exports without blocking the caller. */
  flush(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    const p = this.exporter
      .export(batch)
      .catch(this.onError)
      .finally(() => this.inFlight.delete(p));
    this.inFlight.add(p);
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.flushIntervalMs);
    // Don't keep the process alive just for the flush timer.
    this.timer.unref?.();
  }

  /** Flush remaining spans and await all in-flight exports. Call before exit. */
  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
    await Promise.allSettled([...this.inFlight]);
    await this.exporter.shutdown?.();
  }
}

/**
 * Ships batches to the ingestion gateway over HTTP. Returns 202 from the gateway
 * are treated as success. Used in production; the Phase 1 example can wire a
 * direct-to-Postgres exporter instead while the gateway is still being built.
 */
export class HttpExporter implements Exporter {
  constructor(
    private readonly endpoint: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async export(spans: Span[]): Promise<void> {
    const res = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spans }),
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(`gateway returned ${res.status}: ${await res.text().catch(() => '')}`);
    }
  }
}
