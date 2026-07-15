import type { Judge, JudgeInput, JudgeResult } from '../types.js';

const REFUSAL = /\b(i (don't|do not) know|cannot help|no idea|n\/a|unable to)\b/i;

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

/**
 * Deterministic judge for tests and CI — no model, no API key, fully reproducible
 * so the regression gate is trustworthy rather than noisy.
 *
 * Scoring: coverage of the reference's key terms by the output (how much of the
 * expected content the answer actually contains), with a penalty for refusals /
 * empty answers. When no reference is given, falls back to a length/refusal
 * heuristic. This makes a thorough, on-topic answer score high and a terse or
 * evasive one score low — exactly the signal a prompt regression should move.
 */
export class MockJudge implements Judge {
  readonly name = 'mock';

  async score({ output, reference }: JudgeInput): Promise<JudgeResult> {
    const out = output.trim();
    if (out.length === 0) {
      return { score: 0, rationale: 'empty output' };
    }
    const refused = REFUSAL.test(out);

    if (reference && reference.trim().length > 0) {
      const ref = words(reference);
      const got = words(out);
      let hit = 0;
      for (const w of ref) if (got.has(w)) hit++;
      let score = ref.size === 0 ? 0 : hit / ref.size;
      if (refused) score *= 0.25;
      score = Math.round(Math.min(1, Math.max(0, score)) * 1e4) / 1e4;
      return {
        score,
        rationale: `covered ${hit}/${ref.size} reference terms${refused ? ' (refusal penalty)' : ''}`,
      };
    }

    // No reference: reward a substantive, non-refusing answer.
    if (refused) return { score: 0.2, rationale: 'refusal / non-answer' };
    const score = out.length >= 40 ? 0.9 : 0.5;
    return { score, rationale: `heuristic length=${out.length}, no reference` };
  }
}
