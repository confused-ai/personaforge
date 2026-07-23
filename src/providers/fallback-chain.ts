/**
 * Fallback Chain Provider
 *
 * Implements fallback chains that cascade through multiple LLM providers.
 * Useful for cost optimization (try cheaper models first) and reliability
 * (retry on rate limits or errors with alternative providers).
 */

import type { LLMProvider, Message, GenerateResult, GenerateOptions } from './types.js';
import { LLMError } from '../shared/index.js';

/**
 * Fallback strategy when a provider fails
 */
export enum FallbackStrategy {
    /**
     * Try next provider on any error
     */
    ANY_ERROR = 'any-error',

    /**
     * Try next provider only on rate limit errors
     */
    RATE_LIMIT = 'rate-limit',

    /**
     * Try next provider only on timeout errors
     */
    TIMEOUT = 'timeout',

    /**
     * Try next provider on API errors (4xx, 5xx)
     */
    API_ERROR = 'api-error',
}

/**
 * Fallback chain configuration
 */
export interface FallbackChainConfig {
    /**
     * Ordered list of LLM providers to try
     */
    providers: LLMProvider[];

    /**
     * Strategy for determining when to fallback
     */
    strategy?: FallbackStrategy;

    /**
     * Maximum retries across the chain
     */
    maxRetries?: number;

    /**
     * Enable logging for debugging fallback chain behavior
     */
    debug?: boolean;
}

/** Extract an HTTP status code from a provider/SDK error (status / statusCode / response.status). */
function errorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const e = error as Record<string, unknown>;
    const direct = e['status'] ?? e['statusCode'];
    if (typeof direct === 'number') return direct;
    const resp = e['response'] as Record<string, unknown> | undefined;
    if (resp && typeof resp['status'] === 'number') return resp['status'] as number;
    const ctx = e['context'] as Record<string, unknown> | undefined;
    if (ctx && typeof ctx['status'] === 'number') return ctx['status'] as number;
    return undefined;
}

/** Network-level error (no HTTP status) — connection reset/refused/timeout. */
function isNetworkError(error: unknown): boolean {
    const e = error as { code?: unknown; message?: unknown } | null;
    const code = typeof e?.code === 'string' ? e.code : '';
    if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE', 'ENOTFOUND'].includes(code)) return true;
    const msg = (typeof e?.message === 'string' ? e.message : '').toLowerCase();
    return /network|fetch failed|socket hang up|timed out|timeout|econnreset/.test(msg);
}

/**
 * Determine if an error should trigger fallback.
 * Branches on the TYPED HTTP status / error code — never message substrings
 * (which match false positives like model names "gpt-4500").
 */
function shouldFallback(error: Error, strategy: FallbackStrategy): boolean {
    const status = errorStatus(error);

    switch (strategy) {
        case FallbackStrategy.ANY_ERROR:
            return true;

        case FallbackStrategy.RATE_LIMIT:
            return status === 429;

        case FallbackStrategy.TIMEOUT:
            return status === 408 || isNetworkError(error);

        case FallbackStrategy.API_ERROR:
            // 429 + 5xx server/gateway errors, plus network-level failures.
            return status === 429 || (status !== undefined && status >= 500 && status <= 599) || isNetworkError(error);

        default:
            return false;
    }
}

/**
 * Fallback Chain Provider
 *
 * Wraps multiple LLM providers and falls back to the next one if an error occurs.
 */
export class FallbackChainProvider implements LLMProvider {
    private providers: LLMProvider[];
    private strategy: FallbackStrategy;
    private maxRetries: number;
    private debug: boolean;
    private callHistory: Array<{ provider: number; maxTokens: number; success: boolean; error?: string }> = [];

    constructor(config: FallbackChainConfig) {
        if (config.providers.length === 0) {
            throw new Error('FallbackChainProvider requires at least one provider');
        }

        this.providers = config.providers;
        this.strategy = config.strategy ?? FallbackStrategy.RATE_LIMIT;
        this.maxRetries = config.maxRetries ?? 3;
        this.debug = config.debug ?? false;
    }

/**
 * Get the display name for this provider
 */
getName(): string {
    return `FallbackChain(${this.providers.map((_, i) => `Provider${i + 1}`).join(' → ')})`;
}

/**
 * Generate text using fallback chain
 */
async generateText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
    let lastError: Error = new Error('No providers available');
    let providerIndex = 0;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
            const provider = this.providers[providerIndex];

            if (this.debug) {
                console.log(`[FallbackChain] Attempt ${attempt + 1}: Provider ${providerIndex}`);
            }

            const result = await provider.generateText(messages, options);

            this.recordCall(providerIndex, options?.maxTokens ?? 0, true);

            if (this.debug) {
                console.log(`[FallbackChain] Success with Provider ${providerIndex}`);
            }

            return result;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            this.recordCall(providerIndex, options?.maxTokens ?? 0, false, lastError.message);

            if (this.debug) {
                console.log(`[FallbackChain] Error at Provider ${providerIndex}: ${lastError.message}`);
            }

            // Check if we should fallback (vs. retry same provider)
            if (shouldFallback(lastError, this.strategy)) {
                providerIndex++;

                // Exhausted the chain — do NOT wrap around to re-hit a provider that
                // already failed; stop and surface the aggregated error.
                if (providerIndex >= this.providers.length) {
                    break;
                }
            } else {
                // Don't fallback, but might retry same provider
                // For non-fallback errors, break to avoid wasting tries
                break;
            }
        }
    }

    throw new LLMError(
        `All fallback providers exhausted (${this.providers.length} providers, ${this.maxRetries} attempts)`,
        { cause: lastError },
    );
}

/**
 * Stream text using fallback chain
 */
async streamText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
    let lastError: Error = new Error('No providers available');
    let providerIndex = 0;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
            const provider = this.providers[providerIndex];

            if (this.debug) {
                console.log(`[FallbackChain] Stream attempt ${attempt + 1}: Provider ${providerIndex}`);
            }

            // Check if provider supports streaming
            if (!provider.streamText) {
                throw new Error(`Provider ${providerIndex} does not support streaming`);
            }

            const result = await provider.streamText(messages, options);

            this.recordCall(providerIndex, options?.maxTokens ?? 0, true);

            if (this.debug) {
                console.log(`[FallbackChain] Stream established with Provider ${providerIndex}`);
            }

            return result;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            this.recordCall(providerIndex, options?.maxTokens ?? 0, false, lastError.message);

            if (this.debug) {
                console.log(
                    `[FallbackChain] Stream error at Provider ${providerIndex}: ${lastError.message}`,
                );
            }

            // Check if we should fallback
            if (shouldFallback(lastError, this.strategy)) {
                providerIndex++;

                // Exhausted the chain — do NOT wrap around to a failed provider.
                if (providerIndex >= this.providers.length) {
                    break;
                }
            } else {
                break;
            }
        }
    }

    throw new LLMError(
        `All fallback providers exhausted for streaming (${this.providers.length} providers, ${this.maxRetries} attempts)`,
        { cause: lastError },
    );
}

/**
 * Get success rate for each provider
 */
getStats(): {
    totalAttempts: number;
    successfulAttempts: number;
    providers: Array<{
        provider: string;
        attempts: number;
        successes: number;
        successRate: number;
    }>;
} {
    const providerStats = new Map<number, { attempts: number; successes: number }>();

    for (const call of this.callHistory) {
        const stats = providerStats.get(call.provider) ?? { attempts: 0, successes: 0 };
        stats.attempts++;
        if (call.success) stats.successes++;
        providerStats.set(call.provider, stats);
    }

    const providers = Array.from(providerStats.entries()).map(([idx, stats]) => ({
        provider: `Provider${idx + 1}`,
        attempts: stats.attempts,
        successes: stats.successes,
        successRate: stats.attempts > 0 ? stats.successes / stats.attempts : 0,
    }));

    const totalAttempts = this.callHistory.length;
    // Compute successfulAttempts from the already-built providerStats — avoids second O(n) filter
    let successfulAttempts = 0;
    for (const stats of providerStats.values()) successfulAttempts += stats.successes;

    return {
        totalAttempts,
        successfulAttempts,
        providers,
    };
}

    /**
     * Clear call history
     */
    clearStats(): void {
        this.callHistory = [];
    }

    /**
     * Record a call attempt
     */
    private recordCall(providerIndex: number, maxTokens: number, success: boolean, error?: string): void {
        // Record the provider index + request maxTokens separately — do NOT synthesise
        // a fake "model" label from them (it conflated two distinct dimensions).
        this.callHistory.push({ provider: providerIndex, maxTokens, success, error });
        // Cap to prevent unbounded growth
        if (this.callHistory.length > 1000) {
            this.callHistory = this.callHistory.slice(-1000);
        }
    }
}

/**
 * Convenience function to create a cost-optimized fallback chain
 * Tries cheaper models first before falling back to more expensive ones
 *
 * @example
 * ```ts
 * const chain = createCostOptimizedChain([
 *   new OpenAIProvider({ model: 'gpt-3.5-turbo' }), // Cheap
 *   new OpenAIProvider({ model: 'gpt-4' }),         // Expensive
 * ]);
 * ```
 */
export function createCostOptimizedChain(providers: LLMProvider[]): FallbackChainProvider {
    return new FallbackChainProvider({
        providers,
        strategy: FallbackStrategy.RATE_LIMIT,
        maxRetries: 2,
    });
}

/**
 * Convenience function to create a reliability-focused fallback chain
 * Tries multiple providers to maximize uptime
 */
export function createReliabilityChain(providers: LLMProvider[]): FallbackChainProvider {
    return new FallbackChainProvider({
        providers,
        strategy: FallbackStrategy.ANY_ERROR,
        maxRetries: 5,
    });
}
