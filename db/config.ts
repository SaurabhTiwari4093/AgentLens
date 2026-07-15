/** Shared Postgres connection string. Override with DATABASE_URL for self-host. */
export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://agentlens:agentlens@localhost:5433/agentlens';
