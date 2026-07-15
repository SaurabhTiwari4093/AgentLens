import { describe, it, expect } from 'vitest';
import { MockJudge } from './judge/mock.js';
import { LLMJudge, parseJudgeResponse } from './judge/llm.js';
import { runSuite, toBaseline } from './runner.js';
import type { EvalSuite } from './types.js';

describe('MockJudge', () => {
  const judge = new MockJudge();

  it('scores full reference coverage as 1.0 and is deterministic', async () => {
    const args = {
      input: 'q',
      output: 'refund within 30 days from the Orders page',
      reference: 'refund within 30 days from the Orders page',
      rubric: 'r',
    };
    const a = await judge.score(args);
    const b = await judge.score(args);
    expect(a.score).toBe(1);
    expect(a).toEqual(b); // deterministic
  });

  it('scores partial coverage below 1.0', async () => {
    const { score } = await judge.score({
      input: 'q',
      output: 'refund available',
      reference: 'you can request a refund within 30 days from the Orders page',
      rubric: 'r',
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.5);
  });

  it('penalizes refusals and empty output', async () => {
    expect(
      (await judge.score({ input: 'q', output: '', reference: 'x y', rubric: 'r' })).score,
    ).toBe(0);
    const refused = await judge.score({
      input: 'q',
      output: "I don't know how to help with refunds within 30 days",
      reference: 'refund within 30 days',
      rubric: 'r',
    });
    const plain = await judge.score({
      input: 'q',
      output: 'refund within 30 days',
      reference: 'refund within 30 days',
      rubric: 'r',
    });
    expect(refused.score).toBeLessThan(plain.score);
  });
});

describe('runSuite gate', () => {
  const suite: EvalSuite = {
    name: 'demo',
    rubric: 'answer fully',
    threshold: 0.15,
    cases: [
      { id: 'a', input: 'ask a', reference: 'alpha beta gamma delta' },
      { id: 'b', input: 'ask b', reference: 'one two three four' },
    ],
    // Target echoes a canned answer per case; we vary it between runs below.
    target: (_i, c) => (c.id === 'a' ? 'alpha beta gamma delta' : 'one two three four'),
  };

  it('passes and pins baselines on first run (no baseline)', async () => {
    const r = await runSuite(suite, new MockJudge(), {});
    expect(r.passed).toBe(true);
    expect(r.cases.every((c) => c.baseline === null)).toBe(true);
    expect(toBaseline(r)).toEqual({ a: 1, b: 1 });
  });

  it('passes when scores hold at baseline', async () => {
    const r = await runSuite(suite, new MockJudge(), { a: 1, b: 1 });
    expect(r.passed).toBe(true);
    expect(r.regressions).toHaveLength(0);
  });

  it('flags a regression when a target degrades past threshold', async () => {
    const degraded: EvalSuite = {
      ...suite,
      target: (_i, c) => (c.id === 'a' ? 'alpha' : 'one two three four'),
    };
    const r = await runSuite(degraded, new MockJudge(), { a: 1, b: 1 });
    expect(r.passed).toBe(false);
    expect(r.regressions.map((x) => x.caseId)).toEqual(['a']);
  });

  it('tolerates a drop within threshold', async () => {
    // 'a' drops to 0.75 (3/4 terms) with baseline 0.8, threshold 0.15 => still passes.
    const slightly: EvalSuite = {
      ...suite,
      threshold: 0.15,
      target: (_i, c) => (c.id === 'a' ? 'alpha beta gamma' : 'one two three four'),
    };
    const r = await runSuite(slightly, new MockJudge(), { a: 0.8, b: 1 });
    expect(r.passed).toBe(true);
  });
});

describe('LLMJudge', () => {
  it('parses a JSON verdict from a noisy model response', () => {
    const v = parseJudgeResponse('Sure!\n{"score": 0.8, "rationale": "good"}\nHope that helps');
    expect(v.score).toBeCloseTo(0.8);
    expect(v.rationale).toBe('good');
  });

  it('clamps out-of-range scores and calls the provided model', async () => {
    let seenPrompt = '';
    const judge = new LLMJudge(async (p) => {
      seenPrompt = p;
      return '{"score": 1.7, "rationale": "over"}';
    }, 'test-model');
    const r = await judge.score({ input: 'q', output: 'o', rubric: 'be good' });
    expect(r.score).toBe(1);
    expect(judge.name).toBe('llm:test-model');
    expect(seenPrompt).toContain('be good');
  });

  it('throws on a response with no JSON', async () => {
    const judge = new LLMJudge(async () => 'no json here');
    await expect(judge.score({ input: 'q', output: 'o', rubric: 'r' })).rejects.toThrow();
  });
});
