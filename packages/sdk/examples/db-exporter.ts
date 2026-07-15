import pg from 'pg';
import { SPAN_COLUMNS, type Span } from '@agentlens/shared';
import type { Exporter } from '@agentlens/sdk';

/**
 * Direct-to-Postgres exporter, used ONLY by the Phase 1 example so we can prove a
 * full parent/child trace reaches storage before the ingestion gateway exists.
 * Production uses HttpExporter → gateway → Redis → COPY writer instead.
 */
export class DbExporter implements Exporter {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async export(spans: Span[]): Promise<void> {
    const cols = SPAN_COLUMNS.join(', ');
    for (const s of spans) {
      const values = [
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
        JSON.stringify(s.attributes),
      ];
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      await this.pool.query(
        `INSERT INTO spans (${cols}) VALUES (${placeholders})
         ON CONFLICT (started_at, span_id) DO NOTHING`,
        values,
      );
    }
  }

  async shutdown(): Promise<void> {
    await this.pool.end();
  }
}
