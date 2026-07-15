/**
 * agentlens eval — run a prompt-regression suite and gate on it.
 *
 *   agentlens eval <spec> [--update-baseline] [--baseline=<path>]
 *                         [--threshold=<n>] [--db] [--json]
 *
 * Exit code is 1 when any case regresses past its threshold — that's what blocks a
 * merge in CI. `--update-baseline` re-pins baselines and always exits 0.
 *
 * Spec files may be .ts — Node 24 strips types natively, no flag needed:
 *   node dist/cli.js eval <spec.ts>
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { loadBaseline, saveBaseline } from './baseline.js';
import { runSuite, toBaseline } from './runner.js';
import { MockJudge } from './judge/mock.js';
import { persistResults } from './store.js';
import type { EvalSuite, Judge, SuiteResult } from './types.js';

interface Args {
  spec: string;
  baselinePath?: string;
  updateBaseline: boolean;
  threshold?: number;
  db: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  // Support both `eval <spec>` and bare `<spec>`.
  const rest = argv[0] === 'eval' ? argv.slice(1) : argv;
  const positional = rest.filter((a) => !a.startsWith('--'));
  const flags = new Map<string, string>();
  for (const a of rest.filter((x) => x.startsWith('--'))) {
    const [k, v] = a.slice(2).split('=');
    flags.set(k!, v ?? 'true');
  }
  const spec = positional[0];
  if (!spec) {
    console.error('usage: agentlens eval <spec> [--update-baseline] [--baseline=path] [--threshold=n] [--db] [--json]');
    process.exit(2);
  }
  return {
    spec: resolve(spec),
    baselinePath: flags.get('baseline'),
    updateBaseline: flags.has('update-baseline'),
    threshold: flags.has('threshold') ? Number(flags.get('threshold')) : undefined,
    db: flags.has('db'),
    json: flags.has('json'),
  };
}

function defaultBaselinePath(specPath: string): string {
  return specPath.replace(/\.[cm]?[jt]s$/, '') + '.baseline.json';
}

function printResult(r: SuiteResult) {
  console.log(`\nsuite: ${r.suite}   judge: ${r.judge}\n`);
  for (const c of r.cases) {
    const base = c.baseline == null ? '  (new)' : c.baseline.toFixed(4);
    const mark = c.passed ? '✓' : '✗ REGRESSION';
    console.log(
      `  ${mark}  ${c.caseId.padEnd(20)} score=${c.score.toFixed(4)}  baseline=${base}  — ${c.rationale}`,
    );
  }
  console.log(
    `\n${r.passed ? '✓ PASS' : `✗ FAIL — ${r.regressions.length} regression(s)`} ` +
      `(${r.cases.length} cases)\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const mod = (await import(pathToFileURL(args.spec).href)) as { default?: EvalSuite };
  const suite = mod.default;
  if (!suite || !Array.isArray(suite.cases)) {
    throw new Error(`spec ${args.spec} must default-export an EvalSuite`);
  }
  if (args.threshold != null) suite.threshold = args.threshold;

  // CLI uses the deterministic judge so the gate is reproducible. Programmatic
  // callers can pass an LLMJudge via runSuite() directly.
  const judge: Judge = new MockJudge();

  const baselinePath = args.baselinePath ?? defaultBaselinePath(args.spec);
  const baseline = await loadBaseline(baselinePath);
  const result = await runSuite(suite, judge, baseline);

  if (args.json) console.log(JSON.stringify(result, null, 2));
  else printResult(result);

  if (args.db && process.env.DATABASE_URL) {
    await persistResults(process.env.DATABASE_URL, result, process.env.GIT_SHA ?? null);
    console.log('persisted results to eval_runs');
  }

  if (args.updateBaseline) {
    await saveBaseline(baselinePath, toBaseline(result));
    console.log(`baseline updated: ${baselinePath}`);
    process.exit(0);
  }

  process.exit(result.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
