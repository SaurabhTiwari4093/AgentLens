export const config = {
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://agentlens:agentlens@localhost:5433/agentlens',
  port: Number(process.env.API_PORT ?? 4001),
  /**
   * Window (hours) added on each side of a trace's start when fetching it, so a
   * `trace_id` lookup prunes to a couple of daily partitions instead of scanning
   * all of them. A single trace is short-lived; this is generous.
   */
  traceWindowHours: Number(process.env.TRACE_WINDOW_HOURS ?? 24),
} as const;
