/** Ingestion config. Defaults target the docker-compose services (remapped ports). */
export const config = {
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://agentlens:agentlens@localhost:5433/agentlens',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6380',

  /** Redis Stream that buffers span batches between gateway and writer. */
  stream: process.env.AGENTLENS_STREAM ?? 'agentlens:spans',
  /** Consumer group the writer(s) read from. */
  group: process.env.AGENTLENS_GROUP ?? 'writers',

  gatewayPort: Number(process.env.GATEWAY_PORT ?? 4000),

  writer: {
    /** Max stream entries pulled per read (each entry is one gateway batch). */
    readCount: Number(process.env.WRITER_READ_COUNT ?? 50),
    /** Block up to this long (ms) waiting for new entries. */
    blockMs: Number(process.env.WRITER_BLOCK_MS ?? 2000),
    /** Postgres pool size for the writer. */
    poolSize: Number(process.env.WRITER_POOL_SIZE ?? 8),
  },
} as const;
