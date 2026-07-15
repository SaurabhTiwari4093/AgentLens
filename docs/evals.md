# Evals — LLM-as-judge & prompt-regression gate

AgentLens evals catch prompt/agent regressions in CI: run a target, score its
output with a judge, and fail the build when scores drop past a threshold from a
pinned baseline.

## Anatomy of a suite

A suite is a module that default-exports an `EvalSuite`:

```ts
import type { EvalSuite } from '@agentlens/evals';

const suite: EvalSuite = {
  name: 'support-answers',
  rubric: 'The answer must fully and specifically resolve the question, ...',
  threshold: 0.15, // max allowed drop from baseline
  cases: [
    { id: 'refund-window', input: 'How do I get a refund?', reference: '...' },
    // ...
  ],
  target: async (input, testCase) => callYourAgent(input), // system under test
};
export default suite;
```

- `target` is the thing under test — your agent, a prompt+model, a chain. It
  returns the output text to score.
- `reference` (optional) is ground truth handed to the judge for grounding.
- `threshold` is how far a score may fall below baseline before it's a regression.

See [`packages/evals/examples/support.eval.ts`](../packages/evals/examples/support.eval.ts)
for a complete, runnable example.

## The judge

Two implementations of the `Judge` interface:

- **`MockJudge`** — deterministic, no model. Scores by reference-term coverage with
  a refusal penalty. Used by the CLI/CI so the gate is reproducible without API
  keys.
- **`LLMJudge`** — sends output + rubric to a real model via a caller-supplied
  `(prompt) => Promise<string>` and parses a JSON `{score, rationale}`. See the
  adapter in [self-host.md](self-host.md).

## CLI

```bash
agentlens eval <spec> [--update-baseline] [--baseline=<path>] [--threshold=<n>] [--db] [--json]
```

- first run (or `--update-baseline`) pins the current scores as the baseline
- subsequent runs compare to the baseline and **exit non-zero on regression**
- `--db` also persists every case result to the `eval_runs` table (needs
  `DATABASE_URL`; `GIT_SHA` is recorded if set)

Specs can be `.ts` — Node 24 strips types natively, so no flag is needed:

```bash
node packages/evals/dist/cli.js eval \
  packages/evals/examples/support.eval.ts
```

## The CI gate

`.github/workflows/eval.yml` runs on every PR:

1. runs the suite against the committed baseline — a regression fails the job and
   blocks merge;
2. then runs the same suite with a deliberately worsened prompt
   (`PROMPT_MODE=bad`) and asserts it **fails** — proving the gate actually catches
   drift rather than rubber-stamping.

## Making the gate trustworthy

The judge is only as good as its calibration. Before relying on the gate:

- pick a few cases you've labeled by hand;
- confirm the judge's scores track your labels (raise/lower `threshold` or sharpen
  the `rubric` until they do);
- re-pin the baseline only when a change is an intentional improvement.
