/**
 * `model()` / `router()` — top-level LLM provider + routing factories.
 *
 * `model("provider:model_id")` resolves a provider instance from a model
 * string, so switching providers is a config change, not a code change.
 * `router(...)` builds a cost/quality/speed/balanced/adaptive routing
 * provider over a set of underlying model entries.
 *
 * ```ts
 * import { model, router } from 'personaforge';
 *
 * const llm = model('openai:gpt-4o');            // OpenAIProvider
 * const local = model('ollama:llama3.1');        // OpenAI-compat → localhost
 *
 * const smart = router([
 *   { model: 'gpt-4o-mini', provider: model('openai:gpt-4o-mini'), capabilities: ['conversation'], costTier: 'small' },
 *   { model: 'claude-3-5-sonnet', provider: model('anthropic:claude-3-5-sonnet-20241022'), capabilities: ['coding'], costTier: 'medium' },
 * ], { strategy: 'adaptive' });
 * ```
 */

import {
    OpenAIProvider,
    AnthropicProvider,
    GoogleProvider,
    resolveModelString,
    getProviderFromModelString,
    createCostOptimizedRouter,
    createQualityFirstRouter,
    createSpeedOptimizedRouter,
    createBalancedRouter,
    createSmartRouter,
} from '../providers/index.js';
import { PROVIDER } from '../providers/model-resolver.js';
import type { LLMProvider } from '../core/index.js';
import type {
    RouterEntry,
    RouterRule,
    RoutingStrategy,
    AdaptiveWeights,
    RouteContext,
    TaskType,
    Complexity,
    LLMRouter,
} from '../providers/router.js';

// ── model() ────────────────────────────────────────────────────────────────

/**
 * Resolve an `LLMProvider` from a `"provider:model_id"` string (or pass a
 * provider through unchanged).
 *
 * @throws when the provider prefix is unknown or the model cannot be resolved.
 */
export function model(modelId: string, options?: { apiKey?: string; baseURL?: string }): LLMProvider;
export function model(providerInstance: LLMProvider): LLMProvider;
export function model(
    modelOrProvider: string | LLMProvider,
    options: { apiKey?: string; baseURL?: string } = {},
): LLMProvider {
    if (typeof modelOrProvider !== 'string') return modelOrProvider;

    const resolved = resolveModelString(modelOrProvider);
    if (!resolved) {
        throw new Error(
            `model(): unknown provider in model string "${modelOrProvider}". ` +
                'Supported: openai, anthropic, google, groq, xai, together, fireworks, ' +
                'deepseek, mistral, cohere, perplexity, openrouter, ollama, azure.',
        );
    }

    const provider = getProviderFromModelString(modelOrProvider);

    if (provider === PROVIDER.ANTHROPIC) {
        return new AnthropicProvider({ apiKey: options.apiKey, model: resolved.model });
    }
    if (provider === PROVIDER.GOOGLE) {
        return new GoogleProvider({ apiKey: options.apiKey, model: resolved.model });
    }
    return new OpenAIProvider({
        apiKey: options.apiKey ?? resolved.apiKey,
        baseURL: options.baseURL ?? resolved.baseURL,
        model: resolved.model,
    });
}

// ── router() ───────────────────────────────────────────────────────────────

/** Configuration for {@link router}. */
export interface RouterOptions {
    /** Routing strategy. Default: 'adaptive'. */
    readonly strategy?: RoutingStrategy;
    /** Rule overrides for the LLM router. */
    readonly rules?: RouterRule[];
    /** Debug logging. */
    readonly debug?: boolean;
    /** Custom adaptive weights (strategy: 'adaptive'). */
    readonly adaptiveWeights?: AdaptiveWeights;
    /** Custom task classifier (strategy: 'adaptive'). */
    readonly classifyTask?: (ctx: RouteContext) => TaskType;
    /** Custom complexity classifier (strategy: 'adaptive'). */
    readonly classifyComplexity?: (ctx: RouteContext) => Complexity;
}

/**
 * Build an `LLMProvider`-compatible router over `entries` using the chosen
 * strategy. The returned router is itself an `LLMProvider`, so it drops into
 * `agent({ llm })` unchanged.
 */
export function router(entries: RouterEntry[], options: RouterOptions = {}): LLMRouter {
    const {
        strategy = 'adaptive',
        rules,
        debug,
        adaptiveWeights,
        classifyTask,
        classifyComplexity,
    } = options;

    switch (strategy) {
        case 'cost':
            return createCostOptimizedRouter(entries, debug);
        case 'quality':
            return createQualityFirstRouter(entries, debug);
        case 'speed':
            return createSpeedOptimizedRouter(entries, debug);
        case 'balanced':
            return createBalancedRouter(entries, { rules, debug });
        case 'adaptive':
        default:
            return createSmartRouter(entries, {
                rules,
                debug,
                ...(adaptiveWeights !== undefined ? { adaptiveWeights } : {}),
                ...(classifyTask !== undefined ? { classifyTask } : {}),
                ...(classifyComplexity !== undefined ? { classifyComplexity } : {}),
            });
    }
}
