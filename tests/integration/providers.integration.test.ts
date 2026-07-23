/**
 * Live-model integration tests for the provider adapters.
 *
 * These call REAL provider APIs and are excluded from the default unit suite.
 * Run with: `bun run test:integration`.
 *
 * Each provider block self-skips when its credential is missing, so the suite
 * is safe to run with any subset of keys configured. The assertions are
 * deliberately shape-focused (not content-focused) so they remain stable across
 * model updates: we verify the adapter returns a well-formed `GenerateResult`
 * with a normalised `finishReason`, non-empty text, and (where the SDK reports
 * it) token usage.
 */

import { describe, it, expect } from 'vitest';
import type { LLMProvider, Message } from '../../src/contracts/index.js';

const CANONICAL_FINISH = new Set(['stop', 'tool_calls', 'max_tokens', 'error', undefined]);

const PROMPT: Message[] = [
    { role: 'system', content: 'You are a terse assistant. Reply with a single word.' },
    { role: 'user', content: 'Reply with the single word: PONG' },
];

/** Shared shape assertions every provider must satisfy on a live call. */
async function assertWellFormed(provider: LLMProvider): Promise<void> {
    const result = await provider.generateText(PROMPT, { maxTokens: 16, temperature: 0 });
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);
    // finishReason must already be normalised to the canonical union.
    expect(CANONICAL_FINISH.has(result.finishReason)).toBe(true);
    if (result.usage) {
        // When usage is reported it must be non-negative numbers.
        const u = result.usage;
        for (const v of [u.promptTokens, u.completionTokens, u.totalTokens]) {
            if (v !== undefined) expect(v).toBeGreaterThanOrEqual(0);
        }
    }
}

// ── OpenAI ────────────────────────────────────────────────────────────────
describe.runIf(!!process.env.OPENAI_API_KEY)('OpenAIProvider (live)', () => {
    it('returns a well-formed GenerateResult', async () => {
        const { OpenAIProvider } = await import('../../src/providers/index.js');
        const provider = new OpenAIProvider({
            apiKey: process.env.OPENAI_API_KEY!,
            model: process.env.PF_IT_OPENAI_MODEL ?? 'gpt-4o-mini',
        });
        await assertWellFormed(provider);
    });
});

// ── Anthropic ───────────────────────────────────────────────────────────────
describe.runIf(!!process.env.ANTHROPIC_API_KEY)('AnthropicProvider (live)', () => {
    it('returns a well-formed GenerateResult', async () => {
        const { AnthropicProvider } = await import('../../src/providers/index.js');
        const provider = new AnthropicProvider({
            apiKey: process.env.ANTHROPIC_API_KEY!,
            model: process.env.PF_IT_ANTHROPIC_MODEL ?? 'claude-3-5-haiku-latest',
        });
        await assertWellFormed(provider);
    });
});

// ── Google ────────────────────────────────────────────────────────────────
describe.runIf(!!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY))('GoogleProvider (live)', () => {
    it('returns a well-formed GenerateResult', async () => {
        const { GoogleProvider } = await import('../../src/providers/index.js');
        const provider = new GoogleProvider({
            apiKey: (process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY)!,
            model: process.env.PF_IT_GOOGLE_MODEL ?? 'gemini-1.5-flash',
        });
        await assertWellFormed(provider);
    });
});

// ── Ollama (local, OpenAI-compatible) ───────────────────────────────────────
describe.runIf(!!process.env.OLLAMA_HOST)('Ollama via OpenAIProvider (live, local)', () => {
    it('returns a well-formed GenerateResult', async () => {
        const { OpenAIProvider } = await import('../../src/providers/index.js');
        const host = process.env.OLLAMA_HOST!.replace(/\/$/, '');
        const provider = new OpenAIProvider({
            apiKey: 'ollama', // Ollama ignores the key but the SDK requires a non-empty string.
            baseURL: `${host}/v1`,
            model: process.env.PF_IT_OLLAMA_MODEL ?? 'llama3.2',
        });
        await assertWellFormed(provider);
    });
});

// Guard: if NO credentials are configured, leave a visible reminder rather than
// silently reporting "0 tests" (which can hide a misconfigured CI secret).
describe('integration suite guard', () => {
    it('reports when no provider credentials are configured', () => {
        const anyConfigured = !!(
            process.env.OPENAI_API_KEY ||
            process.env.ANTHROPIC_API_KEY ||
            process.env.GOOGLE_API_KEY ||
            process.env.GEMINI_API_KEY ||
            process.env.OLLAMA_HOST
        );
        if (!anyConfigured) {
            // eslint-disable-next-line no-console
            console.warn(
                '[integration] No provider credentials found — all live tests skipped. ' +
                'Set OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY / OLLAMA_HOST to exercise them.',
            );
        }
        // Always passes — this test exists purely for operator visibility.
        expect(true).toBe(true);
    });
});
