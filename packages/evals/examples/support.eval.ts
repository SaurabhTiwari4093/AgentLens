/**
 * Example prompt-regression suite for a support assistant.
 *
 * The `target` here is a DETERMINISTIC STAND-IN for a real model so the gate is
 * reproducible in CI without API keys — in real use you'd replace it with a call
 * to your agent or an LLM. It simulates how changing the SYSTEM PROMPT moves answer
 * quality: the good prompt yields thorough answers; a terse "worsened" prompt drops
 * the specifics the rubric demands.
 *
 * Try it:
 *   agentlens eval support.eval.ts                  # PASS  (matches pinned baseline)
 *   PROMPT_MODE=bad agentlens eval support.eval.ts  # FAIL  (regression caught)
 */
import type { EvalSuite } from '@agentlens/evals';

const GOOD_PROMPT = 'You are a support agent. Answer thoroughly and include concrete specifics.';
const BAD_PROMPT = 'Answer in as few words as possible.';

// Ground-truth answers the judge scores against.
const REFERENCES: Record<string, string> = {
  'refund-window':
    'You can request a refund within 30 days of purchase from the Orders page; refunds are returned to the original payment method within 5 business days.',
  'password-reset':
    'To reset your password, open Settings, click Security, choose Reset Password, and follow the emailed link, which expires after 1 hour.',
  'data-export':
    'Export your data from Settings then Data then Export, choosing CSV or JSON; large exports are delivered as an emailed download link.',
};

const QUESTIONS: Record<string, string> = {
  'refund-window': 'How do I get a refund?',
  'password-reset': 'How do I reset my password?',
  'data-export': 'How do I export my data?',
};

/**
 * Stand-in "model". A thorough system prompt produces the full answer; a terse one
 * returns only the first clause, losing the specifics the rubric requires.
 */
function fakeModel(systemPrompt: string, caseId: string): string {
  const full = REFERENCES[caseId] ?? '';
  if (systemPrompt.includes('thoroughly')) return full;
  return (full.split(';')[0] ?? full).slice(0, 60);
}

const systemPrompt = process.env.PROMPT_MODE === 'bad' ? BAD_PROMPT : GOOD_PROMPT;

const suite: EvalSuite = {
  name: 'support-answers',
  rubric:
    'The answer must fully and specifically resolve the question, including concrete steps, limits, and timeframes.',
  threshold: 0.15,
  cases: Object.keys(REFERENCES).map((id) => ({
    id,
    input: QUESTIONS[id]!,
    reference: REFERENCES[id]!,
  })),
  target: (_input, c) => fakeModel(systemPrompt, c.id),
};

export default suite;
