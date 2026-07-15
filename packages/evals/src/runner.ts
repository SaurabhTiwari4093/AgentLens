import type { Baseline } from './baseline.js';
import type { CaseResult, EvalSuite, Judge, SuiteResult } from './types.js';

const DEFAULT_THRESHOLD = 0.05;

/**
 * Run a suite: for each case, run the target, judge its output, and compare the
 * score to the pinned baseline. A case is a regression when its score falls more
 * than `threshold` below baseline. With no baseline (first run), a case passes and
 * its score becomes the baseline to pin.
 */
export async function runSuite(
  suite: EvalSuite,
  judge: Judge,
  baseline: Baseline,
): Promise<SuiteResult> {
  const threshold = suite.threshold ?? DEFAULT_THRESHOLD;
  const cases: CaseResult[] = [];

  for (const c of suite.cases) {
    const output = await suite.target(c.input, c);
    const { score, rationale } = await judge.score({
      input: c.input,
      output,
      reference: c.reference,
      rubric: suite.rubric,
    });
    const base = c.id in baseline ? baseline[c.id]! : null;
    const passed = base == null ? true : score >= base - threshold;
    cases.push({
      caseId: c.id,
      input: c.input,
      output,
      score,
      baseline: base,
      threshold,
      passed,
      rationale,
    });
  }

  const regressions = cases.filter((c) => !c.passed);
  return {
    suite: suite.name,
    judge: judge.name,
    cases,
    passed: regressions.length === 0,
    regressions,
  };
}

/** Extract current scores as a baseline snapshot (for --update-baseline). */
export function toBaseline(result: SuiteResult): Baseline {
  const b: Baseline = {};
  for (const c of result.cases) b[c.caseId] = c.score;
  return b;
}
