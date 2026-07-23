/**
 * @personaforge/router — cost-optimized LLM router.
 *
 * SOLID:
 *   SRP  — router owns only model selection; callers handle actual LLM calls.
 *   OCP  — add new routing strategies by implementing RouterStrategy.
 *   DIP  — depends on LLMProvider interface from @personaforge/core.
 *
 * DS choices:
 *   - Model cost table: Map<string, ModelCost> → O(1) lookup per model.
 *   - Selection: sort by cost ascending, pick first that meets capability
 *     threshold — O(n models log n) sort, O(1) lookup via Map.
 */

import type { LLMProvider } from '../core/index.js';

// ── Cost table ────────────────────────────────────────────────────────────────
// USD per 1M tokens. Source: provider pricing pages (update periodically).

export interface ModelCost {
  /** USD per 1M input tokens. */
  inputPerMillion:  number;
  /** USD per 1M output tokens. */
  outputPerMillion: number;
  /** Max context window in tokens. */
  contextWindow:    number;
  /** Relative capability score 0–10 (higher = more capable). */
  capability:       number;
}

/** Built-in cost table. Extend via createCostRouter({ costs: { ...DEFAULT_COSTS, myModel: {...} } }). */
export const DEFAULT_COSTS: Map<string, ModelCost> = new Map([
  ['gpt-4o',           { inputPerMillion:  2.50, outputPerMillion: 10.00, contextWindow: 128_000, capability: 9 }],
  ['gpt-4o-mini',      { inputPerMillion:  0.15, outputPerMillion:  0.60, contextWindow: 128_000, capability: 7 }],
  ['gpt-3.5-turbo',    { inputPerMillion:  0.50, outputPerMillion:  1.50, contextWindow:  16_385, capability: 6 }],
  ['claude-3-5-sonnet-20241022', { inputPerMillion: 3.00, outputPerMillion: 15.00, contextWindow: 200_000, capability: 9 }],
  ['claude-3-haiku-20240307',    { inputPerMillion: 0.25, outputPerMillion:  1.25, contextWindow: 200_000, capability: 6 }],
  ['gemini-2.0-flash', { inputPerMillion:  0.10, outputPerMillion:  0.40, contextWindow: 1_048_576, capability: 7 }],
  ['gemini-1.5-pro',   { inputPerMillion:  1.25, outputPerMillion:  5.00, contextWindow: 2_097_152, capability: 8 }],
]);

// ── Router options ────────────────────────────────────────────────────────────

export interface RouterOptions {
  /** LLM providers keyed by model name — O(1) lookup. */
  providers: Map<string, LLMProvider>;
  /** Minimum capability score required. Default: 0 (cheapest wins). */
  minCapability?: number;
  /** Minimum context window required (tokens). Default: 0. */
  minContextWindow?: number;
  /** Max cost per 1M input tokens. Default: unlimited. */
  maxInputCostPerMillion?: number;
  /** Custom cost table overrides. */
  costs?: Map<string, ModelCost>;
}

export interface RoutingDecision {
  model:    string;
  provider: LLMProvider;
  cost:     ModelCost;
  reason:   string;
}

/**
 * createCostOptimizedRouter — selects cheapest LLM meeting the constraints.
 *
 * @example
 * ```ts
 * const router = createCostOptimizedRouter({
 *   providers: new Map([
 *     ['gpt-4o-mini',   openai({ model: 'gpt-4o-mini' })],
 *     ['gpt-4o',        openai({ model: 'gpt-4o' })],
 *     ['claude-3-haiku-20240307', anthropic({ model: 'claude-3-haiku-20240307' })],
 *   ]),
 *   minCapability: 7,  // skip low-capability models
 * });
 *
 * const { provider } = router.select('Write me a poem');
 * const result = await createAgent({ llm: provider, ... }).run('Write me a poem');
 * ```
 */
export function createCostOptimizedRouter(opts: RouterOptions): {
  select(prompt: string, estimatedTokens?: number): RoutingDecision;
  selectForBudget(maxUsd: number): RoutingDecision;
} {
  const costs       = opts.costs ?? DEFAULT_COSTS;
  const minCap      = opts.minCapability      ?? 0;
  const minCtx      = opts.minContextWindow   ?? 0;
  const maxInput    = opts.maxInputCostPerMillion ?? Infinity;

  /**
   * Candidates sorted by input cost ascending — O(n log n) once, then O(1) per select.
   * Re-computed only if opts change (which they don't — router is immutable).
   */
  const candidates: Array<{ model: string; provider: LLMProvider; cost: ModelCost }> = Array
    .from(opts.providers.entries())
    .map(([model, provider]) => {
      const cost = costs.get(model);
      return cost ? { model, provider, cost } : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .filter((c) => c.cost.capability >= minCap && c.cost.contextWindow >= minCtx && c.cost.inputPerMillion <= maxInput)
    .sort((a, b) => a.cost.inputPerMillion - b.cost.inputPerMillion);

  if (candidates.length === 0) {
    throw new Error('[router] No providers match the routing constraints. Loosen minCapability, minContextWindow, or maxInputCostPerMillion.');
  }

  return {
    /** O(1) — picks the cheapest candidate from the pre-sorted array. */
    select(_prompt: string, _estimatedTokens?: number): RoutingDecision {
      const winner = candidates[0];
      if (!winner) throw new Error('[router] No providers match the routing constraints.');
      return {
        model:    winner.model,
        provider: winner.provider,
        cost:     winner.cost,
        reason:   `Cheapest model meeting constraints: $${winner.cost.inputPerMillion}/1M input tokens, capability ${winner.cost.capability}/10`,
      };
    },

    /** O(n) — linear scan to find most capable model within budget. */
    selectForBudget(maxInputCostPerMillion: number): RoutingDecision {
      // Both inputPerMillion and the argument are in $/1M tokens — compare directly
      const affordable = candidates.filter((c) => c.cost.inputPerMillion <= maxInputCostPerMillion);
      if (affordable.length === 0) {
        throw new Error(`[router] No model fits within $${String(maxInputCostPerMillion)}/1M input tokens budget.`);
      }
      const best = [...affordable].sort((a, b) => b.cost.capability - a.cost.capability)[0];
      if (!best) throw new Error(`[router] No model fits within $${String(maxInputCostPerMillion)}/1M input tokens budget.`);
      return {
        model:    best.model,
        provider: best.provider,
        cost:     best.cost,
        reason:   `Most capable model within $${String(maxInputCostPerMillion)}/1M: ${best.model} (capability ${String(best.cost.capability)}/10)`,
      };
    },

  };
}
