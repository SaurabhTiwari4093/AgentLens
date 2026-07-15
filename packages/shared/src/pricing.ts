/**
 * Simple model → price table. USD per 1,000,000 tokens, split input/output.
 * The SDK uses this to compute `cost_usd` at span-close time so cost is stored,
 * not recomputed on read.
 *
 * Prices are illustrative and easy to update; keeping them here (in shared/) means
 * the SDK and any offline recompute use the exact same numbers.
 */
export interface ModelPrice {
  /** USD per 1M input tokens */
  input: number;
  /** USD per 1M output tokens */
  output: number;
}

export const PRICING: Record<string, ModelPrice> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-haiku-4': { input: 0.8, output: 4 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
};

/**
 * Compute cost in USD for a model call. Returns null when the model isn't in the
 * table (unknown model → unknown cost, better than a wrong 0).
 */
export function computeCost(
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number | null {
  if (!model) return null;
  const price = PRICING[model];
  if (!price) return null;
  const inTok = inputTokens ?? 0;
  const outTok = outputTokens ?? 0;
  const cost = (inTok * price.input + outTok * price.output) / 1_000_000;
  // Round to 6 decimals to match NUMERIC(12,6) storage.
  return Math.round(cost * 1e6) / 1e6;
}
