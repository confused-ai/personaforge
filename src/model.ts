/**
 * personaforge/model — LLM providers
 *
 * Import your model provider from here:
 * ```ts
 * import { openai, anthropic, ollama } from 'personaforge/model'
 * ```
 */

// ── Provider Classes ────────────────────────────────────────────────────────
export {
    OpenAIProvider,
    AnthropicProvider,
    GoogleProvider,
    BedrockConverseProvider,
    createOpenRouterProvider,
} from './providers/index.js';
export { OpenAIEmbeddingProvider } from './memory/index.js';

// ── Provider Types ──────────────────────────────────────────────────────────
export type {
    LLMProvider,
    Message,
    GenerateResult,
    GenerateOptions,
    StreamOptions,
    StreamChunk,
} from './providers/types.js';

// ── Cost Tracking ───────────────────────────────────────────────────────────
export {
    CostTracker,
    MODEL_PRICING,
} from './providers/cost-tracker.js';

// ── Convenience: provider factory aliases ───────────────────────────────────

import { OpenAIProvider } from './providers/index.js';
import { AnthropicProvider } from './providers/index.js';

/**
 * Shorthand: `openai()` creates an OpenAI provider with defaults from env.
 *
 * @example
 * ```ts
 * import { openai } from 'personaforge/model'
 * const model = openai()           // uses OPENAI_API_KEY
 * const model = openai('gpt-4.1')  // specific model
 * ```
 */
export function openai(model?: string, options?: { apiKey?: string; baseURL?: string }) {
    return new OpenAIProvider({
        model: model ?? 'gpt-4o',
        apiKey: options?.apiKey,
        baseURL: options?.baseURL,
    });
}

/**
 * Shorthand: `anthropic()` creates an Anthropic provider.
 *
 * @example
 * ```ts
 * import { anthropic } from 'personaforge/model'
 * const model = anthropic()                    // uses ANTHROPIC_API_KEY
 * const model = anthropic('claude-sonnet-4-20250514')  // specific model
 * ```
 */
export function anthropic(model?: string, options?: { apiKey?: string }) {
    return new AnthropicProvider({
        model: model ?? 'claude-sonnet-4-20250514',
        apiKey: options?.apiKey,
    });
}

/**
 * Shorthand: `ollama()` creates a local Ollama provider via OpenAI-compatible API.
 *
 * @example
 * ```ts
 * import { ollama } from 'personaforge/model'
 * const model = ollama()              // llama3.2 on localhost
 * const model = ollama('mistral')     // specific model
 * ```
 */
export function ollama(model?: string, options?: { baseURL?: string }) {
    return new OpenAIProvider({
        model: model ?? 'llama3.2',
        baseURL: options?.baseURL ?? 'http://localhost:11434/v1',
        apiKey: 'ollama',
    });
}
