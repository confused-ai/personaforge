/**
 * Hermetic coverage for src/providers — cost-tracker, from-model, cache.
 * No network. Callers: vitest only.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { CostTracker, estimateCost } from '../src/providers/cost-tracker.js';
import { createLlmProviderFromModelString } from '../src/providers/from-model.js';
import { LLMCache, withLLMCache } from '../src/providers/cache.js';
import type { LLMProvider, Message, GenerateOptions, GenerateResult } from '../src/core/index.js';

// ── cost-tracker ────────────────────────────────────────────────────────────

describe('providers/cost-tracker', () => {
    it('records calls with known pricing + fuzzy date-suffix match + default', () => {
        const ct = new CostTracker();
        const c1 = ct.recordCall('gpt-4o', { input: 1_000_000, output: 1_000_000 });
        expect(c1.inputCost).toBe(2.5);
        expect(c1.outputCost).toBe(10);
        expect(c1.totalCost).toBe(12.5);

        // fuzzy: strip -20241022
        const c2 = ct.recordCall('claude-3-5-sonnet-20241022', { input: 1_000_000, output: 1_000_000 });
        expect(c2.inputCost).toBe(3);
        // unknown model → default 0
        const c3 = ct.recordCall('totally-unknown-model', { input: 1_000_000, output: 1_000_000 });
        expect(c3.totalCost).toBe(0);
    });

    it('handles cache read savings and cache creation costs', () => {
        const ct = new CostTracker();
        const c = ct.recordCall('gpt-4o', {
            input: 100_000,
            output: 50_000,
            cache: { cacheRead: 200_000, cacheCreation: 100_000 },
        });
        // read saving: 200k * (2.5 - 1.25)/1M = 0.25 saved → cacheCost -= 0.25
        // creation: 100k * 5/1M = 0.5 → cacheCost += 0.5
        // input 0.25 + output 0.5 + cache 0.25 = 1.0
        expect(c.cacheCost).toBeCloseTo(0.25, 5);
        expect(c.totalCost).toBeCloseTo(1.0, 5);
    });

    it('aggregates totals, by-model, summary, history, clear', () => {
        const ct = new CostTracker();
        ct.recordCall('gpt-4o', { input: 1000, output: 500 });
        ct.recordCall('gpt-4o', { input: 2000, output: 1000 });
        ct.recordCall('gemini-2.0-flash', { input: 1000, output: 1000 });

        expect(ct.getTotalCost()).toBeGreaterThan(0);
        expect(ct.getTotalTokens()).toMatchObject({ input: 4000, output: 2500 });
        expect(ct.getByModel('gpt-4o')?.calls).toBe(2);
        expect(ct.getByModel('nope')).toBeUndefined();
        expect(ct.getAllModels().length).toBe(2);
        expect(ct.getCallHistory().length).toBe(3);
        const sum = ct.getSummary();
        expect(sum.totalCalls).toBe(3);
        expect(sum.averageCostPerCall).toBe(sum.totalCost / 3);
        expect(sum.costPerMillionTokens).toBeGreaterThan(0);
        ct.clear();
        expect(ct.getSummary().totalCalls).toBe(0);
        expect(ct.getSummary().averageCostPerCall).toBe(0);
        expect(ct.getSummary().costPerMillionTokens).toBe(0);
    });

    it('estimateCost computes simple cost', () => {
        expect(estimateCost('gpt-4o', { input: 1_000_000, output: 500_000 })).toBe(2.5 + 5);
        expect(estimateCost('unknown', { input: 1000, output: 1000 })).toBe(0);
    });
});

// ── from-model ──────────────────────────────────────────────────────────────

describe('providers/from-model', () => {
    const saved: Record<string, string | undefined> = {};

    afterEach(() => {
        for (const k of Object.keys(saved)) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
            delete saved[k];
        }
    });

    function setEnv(k: string, v?: string) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }

    it('resolves openai:model with env key', () => {
        setEnv('OPENAI_API_KEY', 'sk-x');
        const p = createLlmProviderFromModelString('openai:gpt-4o');
        expect(p).toBeTruthy();
        expect(typeof p!.generateText).toBe('function');
    });

    it('resolves anthropic:model with env key', () => {
        setEnv('ANTHROPIC_API_KEY', 'sk-ant-x');
        const p = createLlmProviderFromModelString('anthropic:claude-3-5-sonnet');
        expect(p).toBeTruthy();
    });

    it('resolves google:model with env key', () => {
        setEnv('GOOGLE_API_KEY', 'g-x');
        const p = createLlmProviderFromModelString('google:gemini-2.0-flash');
        expect(p).toBeTruthy();
    });

    it('resolves ollama:model without key', () => {
        const p = createLlmProviderFromModelString('ollama:llama3');
        expect(p).toBeTruthy();
    });

    it('returns undefined for invalid strings / missing keys', () => {
        expect(createLlmProviderFromModelString('')).toBeUndefined();
        expect(createLlmProviderFromModelString('no-colon')).toBeUndefined();
        setEnv('ANTHROPIC_API_KEY', undefined);
        expect(createLlmProviderFromModelString('anthropic:claude')).toBeUndefined();
        setEnv('OPENAI_API_KEY', undefined);
        expect(createLlmProviderFromModelString('openai:gpt-4o')).toBeUndefined();
        expect(createLlmProviderFromModelString('unknown:model')).toBeUndefined();
    });
});

// ── cache ───────────────────────────────────────────────────────────────────

describe('providers/cache', () => {
    const input = { messages: [{ role: 'user' as const, content: 'hello' }], model: 'gpt-4o' };
    const result = { text: 'cached', finishReason: 'stop' as const };

    it('get/set/has/delete/stats/clear/cleanup/eviction/ttl', () => {
        const c = new LLMCache({ maxEntries: 2, ttlMs: 1000 });
        expect(c.isEnabled()).toBe(true);
        expect(c.get(input)).toBeNull(); // miss
        c.set(input, result);
        expect(c.get(input)).toEqual(result); // hit
        expect(c.has(input)).toBe(true);
        expect(c.getStats()).toMatchObject({ hits: 1, misses: 1, entries: 1, hitRate: 0.5, evictions: 0 });

        // delete before eviction
        expect(c.delete(input)).toBe(true);
        expect(c.has(input)).toBe(false);

        // eviction at capacity
        c.set({ messages: [{ role: 'user', content: 'b' }], model: 'm' }, result);
        c.set({ messages: [{ role: 'user', content: 'c' }], model: 'm' }, result);
        c.set({ messages: [{ role: 'user', content: 'd' }], model: 'm' }, result);
        expect(c.getStats().evictions).toBeGreaterThan(0);

        // cleanup expired
        const exp = new LLMCache({ ttlMs: -1 });
        exp.set(input, result);
        expect(exp.cleanup()).toBe(1);
        expect(exp.get(input)).toBeNull();

        // disabled
        const off = new LLMCache({ enabled: false });
        off.set(input, result);
        expect(off.get(input)).toBeNull();
        expect(off.isEnabled()).toBe(false);

        // custom hashFn
        const h = new LLMCache({ hashFn: () => 'fixed' });
        h.set(input, result);
        expect(h.get({ messages: [], model: 'x' })).toEqual(result);

        c.clear();
        expect(c.getStats()).toMatchObject({ hits: 0, misses: 0, entries: 0 });
    });

    it('withLLMCache wraps generateText with caching', async () => {
        const cache = new LLMCache({ ttlMs: 1000 });
        const inner = vi.fn(async () => ({ text: 'fresh', finishReason: 'stop' as const }));
        const provider = { generateText: inner };
        withLLMCache(provider as never, cache, 'gpt-4o');

        const r1 = await provider.generateText([{ role: 'user', content: 'hello' }], { temperature: 0 });
        const r2 = await provider.generateText([{ role: 'user', content: 'hello' }], { temperature: 0 });
        expect(r1.text).toBe('fresh');
        expect(r2.text).toBe('fresh');
        expect(inner).toHaveBeenCalledTimes(1);

        // different content → miss
        await provider.generateText([{ role: 'user', content: 'other' }]);
        expect(inner).toHaveBeenCalledTimes(2);
    });
});
