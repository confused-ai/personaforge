/**
 * Coverage for src/model.ts (barrel) — provider factory shorthands + cost tracking.
 * No live network: provider classes are constructed with explicit keys.
 */

import { describe, it, expect } from 'vitest';
import {
    openai,
    anthropic,
    ollama,
    CostTracker,
    MODEL_PRICING,
    OpenAIProvider,
    AnthropicProvider,
} from '../src/model.js';

describe('model barrel', () => {
    it('openai() builds an OpenAIProvider with defaults and explicit args', () => {
        const m1 = openai();
        expect(m1).toBeInstanceOf(OpenAIProvider);
        const m2 = openai('gpt-4.1', { apiKey: 'k', baseURL: 'https://x' });
        expect(m2).toBeInstanceOf(OpenAIProvider);
    });

    it('anthropic() builds an AnthropicProvider', () => {
        const m = anthropic();
        expect(m).toBeInstanceOf(AnthropicProvider);
        const m2 = anthropic('claude-x', { apiKey: 'k' });
        expect(m2).toBeInstanceOf(AnthropicProvider);
    });

    it('ollama() builds an OpenAI-compatible provider pointed at localhost', () => {
        const m = ollama();
        expect(m).toBeInstanceOf(OpenAIProvider);
        const m2 = ollama('mistral', { baseURL: 'http://host:11434/v1' });
        expect(m2).toBeInstanceOf(OpenAIProvider);
    });

    it('MODEL_PRICING contains known models', () => {
        expect(MODEL_PRICING['gpt-4o']).toBeDefined();
        expect(MODEL_PRICING['claude-3-5-sonnet-20241022']).toBeDefined();
    });

    it('CostTracker estimates USD for a known model', () => {
        const usd = CostTracker.estimateCostUsd('gpt-4o', 1000, 500);
        expect(typeof usd).toBe('number');
        expect(usd).toBeGreaterThan(0);
    });

    it('CostTracker returns 0 for unknown models rather than throwing', () => {
        expect(CostTracker.estimateCostUsd('no-such-model', 10, 10)).toBe(0);
    });
});
