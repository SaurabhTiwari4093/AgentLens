import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { SuiteResult } from './types.js';

/**
 * Persist a suite's per-case results into the eval_runs table so scores are
 * queryable over time (trend of a case across commits). Optional — the gate works
 * without it; enable with --db on the CLI.
 */
export async function persistResults(
  connectionString: string,
  result: SuiteResult,
  gitSha: string | null,
): Promise<void> {
  const pool = new pg.Pool({ connectionString });
  try {
    for (const c of result.cases) {
      await pool.query(
        `INSERT INTO eval_runs
           (id, suite, case_id, git_sha, score, baseline, threshold, passed, judge_model, rationale)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          randomUUID(),
          result.suite,
          c.caseId,
          gitSha,
          c.score,
          c.baseline,
          c.threshold,
          c.passed,
          result.judge,
          c.rationale,
        ],
      );
    }
  } finally {
    await pool.end();
  }
}
