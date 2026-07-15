/**
 * Eval harness types. A suite pins a `target` (the thing under test — usually an
 * agent or a prompt+model), a set of `cases`, and a `rubric` the judge scores
 * against. Baselines are pinned per case; a regression past `threshold` fails.
 */

export interface EvalCase {
  /** Stable id — used as the baseline key. */
  id: string;
  /** Input handed to the target. */
  input: string;
  /** Optional reference/expected answer, given to the judge as grounding. */
  reference?: string;
}

export interface EvalSuite {
  name: string;
  /** Runs the system under test for one input, returns its output text. */
  target: (input: string, testCase: EvalCase) => Promise<string> | string;
  cases: EvalCase[];
  /** Criteria the judge scores against (0..1). */
  rubric: string;
  /**
   * Max allowed drop from the pinned baseline before a case is a regression.
   * e.g. 0.05 => a score 0.05 below baseline still passes. Default 0.05.
   */
  threshold?: number;
}

export interface JudgeResult {
  /** Quality score in [0, 1]. */
  score: number;
  /** Short explanation of the score. */
  rationale: string;
}

export interface JudgeInput {
  input: string;
  output: string;
  reference?: string;
  rubric: string;
}

/** Scores a target's output against a rubric. Deterministic mock or real LLM. */
export interface Judge {
  readonly name: string;
  score(args: JudgeInput): Promise<JudgeResult>;
}

export interface CaseResult {
  caseId: string;
  input: string;
  output: string;
  score: number;
  baseline: number | null;
  threshold: number;
  passed: boolean;
  rationale: string;
}

export interface SuiteResult {
  suite: string;
  judge: string;
  cases: CaseResult[];
  passed: boolean;
  regressions: CaseResult[];
}
