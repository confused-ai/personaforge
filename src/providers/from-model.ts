/**
 * Build an LLMProvider from a "provider:model_id" string outside the
 * createAgent path (goals judge, structured-output structuring model,
 * supervisor scoring). Mirrors resolveLlmForCreateAgent's model resolution.
 */

import type { LLMProvider } from '../core/index.js';
import { OpenAIProvider, AnthropicProvider, GoogleProvider } from './index.js';
import { resolveModelString, getProviderFromModelString, PROVIDER } from './model-resolver.js';

const getEnv = typeof process !== 'undefined'
    ? (k: string) => process.env?.[k]
    : () => undefined;

/**
 * Resolve "provider:model_id" → a ready LLMProvider. Returns `undefined` when
 * the string isn't a recognised model string or the env key is missing.
 */
export function createLlmProviderFromModelString(modelStr: string): LLMProvider | undefined {
    if (typeof modelStr !== 'string' || !modelStr.includes(':')) return undefined;
    const resolved = resolveModelString(modelStr, getEnv);
    if (!resolved) return undefined;
    const provider = getProviderFromModelString(modelStr);

    if (provider === PROVIDER.ANTHROPIC) {
        if (!resolved.apiKey) return undefined;
        return new AnthropicProvider({ apiKey: resolved.apiKey, model: resolved.model });
    }
    if (provider === PROVIDER.GOOGLE) {
        if (!resolved.apiKey) return undefined;
        return new GoogleProvider({ apiKey: resolved.apiKey, model: resolved.model });
    }
    if (!resolved.apiKey && provider !== PROVIDER.OLLAMA) return undefined;
    if (provider === PROVIDER.OLLAMA) {
        return new OpenAIProvider({ apiKey: 'not-needed', baseURL: resolved.baseURL, model: resolved.model });
    }
    return new OpenAIProvider({ apiKey: resolved.apiKey, baseURL: resolved.baseURL, model: resolved.model });
}
