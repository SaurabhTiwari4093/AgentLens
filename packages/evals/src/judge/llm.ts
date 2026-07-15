import type { Judge, JudgeInput, JudgeResult } from '../types.js';

/** Provider-agnostic completion fn: prompt in, text out. Wrap any model with this. */
export type CompleteFn = (prompt: string) => Promise<string>;

const JUDGE_PROMPT = (a: JudgeInput) => `You are a strict evaluation judge. Score the ANSWER
against the RUBRIC on a scale from 0.0 (fails the rubric) to 1.0 (fully satisfies it).

RUBRIC:
${a.rubric}

QUESTION:
${a.input}
${a.reference ? `\nREFERENCE ANSWER (ground truth):\n${a.reference}\n` : ''}
ANSWER TO SCORE:
${a.output}

Respond with ONLY a JSON object, no prose, in exactly this form:
{"score": <number between 0 and 1>, "rationale": "<one sentence>"}`;

/** Extract the first JSON object from a model response, tolerating surrounding text. */
export function parseJudgeResponse(text: string): JudgeResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`judge response had no JSON object: ${text.slice(0, 200)}`);
  const obj = JSON.parse(match[0]) as { score?: unknown; rationale?: unknown };
  const score = Number(obj.score);
  if (!Number.isFinite(score))
    throw new Error(`judge returned non-numeric score: ${text.slice(0, 200)}`);
  return {
    score: Math.min(1, Math.max(0, score)),
    rationale: typeof obj.rationale === 'string' ? obj.rationale : '',
  };
}

/**
 * LLM-as-judge. Sends output + rubric to a judge model via a caller-supplied
 * `complete` fn (so it's provider-agnostic and unit-testable with a fake). Default
 * usage wires a real model — see docs/self-host for an Anthropic/OpenAI adapter.
 */
export class LLMJudge implements Judge {
  readonly name: string;
  constructor(
    private readonly complete: CompleteFn,
    modelName = 'llm',
  ) {
    this.name = `llm:${modelName}`;
  }

  async score(args: JudgeInput): Promise<JudgeResult> {
    const raw = await this.complete(JUDGE_PROMPT(args));
    return parseJudgeResponse(raw);
  }
}
