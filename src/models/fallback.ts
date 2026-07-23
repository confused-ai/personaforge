/**
 * @confused-ai/models — provider-level fallback + retry wrapper.
 *
 * Wraps any LLMProvider with `.withFallbacks([alt1, alt2])` and
 * `.withRetry({ maxRetries, retryOn })` so model-level resilience is a
 * one-liner instead of custom guard plumbing.
 *
 * ```ts
 * const resilient = withFallbacks(openai('gpt-4o'), [anthropic('claude-3'), ollama('llama3')]);
 * // or
 * const retried = withRetry(openai('gpt-4o'), { maxRetries: 3 });
 * ```
 */

import type { LLMProvider, Message, GenerateOptions, GenerateResult } from '../contracts/interfaces.js';

// ── withFallbacks ─────────────────────────────────────────────────────────────

/**
 * Returns a new LLMProvider that tries `primary`, then each `fallbacks`
 * in order until one succeeds. Also wraps streamText if present.
 */
export function withFallbacks(primary: LLMProvider, fallbacks: LLMProvider[]): LLMProvider {
  const all = [primary, ...fallbacks];
  const proxy: LLMProvider = {
    async generateText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
      let lastErr: unknown;
      for (const p of all) {
        try { return await p.generateText(messages, options); } catch (err) { lastErr = err; }
      }
      throw lastErr;
    },
  };
  // If any provider supports streamText, proxy it.
  if (all.some((p) => p.streamText)) {
    proxy.streamText = async (messages: Message[], options?: GenerateOptions): Promise<GenerateResult> => {
      let lastErr: unknown;
      for (const p of all) {
        if (!p.streamText) continue;
        try { return await p.streamText(messages, options); } catch (err) { lastErr = err; }
      }
      throw lastErr ?? new Error('[withFallbacks] No provider supports streamText');
    };
  }
  return proxy;
}

// ── withRetry ─────────────────────────────────────────────────────────────────

export interface RetryOptions {
  maxRetries?: number;
  /** Base delay in ms (exponential backoff). Default 200. */
  baseDelayMs?: number;
  /** Only retry errors matching this predicate. Default: always. */
  retryOn?: (err: unknown) => boolean;
}

/**
 * Wraps an LLMProvider with automatic retry + exponential backoff.
 */
export function withRetry(provider: LLMProvider, opts?: RetryOptions): LLMProvider {
  const maxRetries = opts?.maxRetries ?? 3;
  const baseDelay = opts?.baseDelayMs ?? 200;
  const shouldRetry = opts?.retryOn ?? (() => true);

  async function retryWrap<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i <= maxRetries; i++) {
      try { return await fn(); } catch (err) {
        lastErr = err;
        if (i < maxRetries && shouldRetry(err)) {
          await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, i)));
        } else {
          throw err;
        }
      }
    }
    throw lastErr;
  }

  const proxy: LLMProvider = {
    generateText: (m, o) => retryWrap(() => provider.generateText(m, o)),
  };
  if (provider.streamText) {
    proxy.streamText = (m, o) => retryWrap(() => provider.streamText!(m, o));
  }
  return proxy;
}
