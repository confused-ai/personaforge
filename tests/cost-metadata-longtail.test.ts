import { describe, expect, it } from 'vitest';
import { MODEL_PRICING } from '../src/providers/cost-tracker.js';
import {
    getContextLimitForModel,
    MODEL_CONTEXT_LIMITS,
    resolveModelKeyForContextLimit,
} from '../src/providers/context-window-manager.js';

// Long-tail pricing keys added in src/providers/cost-tracker.ts.
const ADDED_PRICING_KEYS = [
    'grok-2-mini',
    'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    'command-a-03-2025',
    'MiniMax-Text-01',
    'abab6.5s-chat',
    'Baichuan4-Turbo',
    'Baichuan4-Air',
    'step-2-16k',
    'step-1-8k',
    'internlm2.5-20b-chat',
    'hunyuan-turbo',
    'hunyuan-standard',
    'hunyuan-lite',
    'doubao-1.5-pro-32k',
    'doubao-1.5-lite-32k',
    'meta-llama/Meta-Llama-3.1-70B-Instruct',
    'deepseek/deepseek-v3',
    'snowflake-arctic-instruct',
    'qwen/qwen3.6-plus',
    'anthropic/claude-sonnet-4',
    'openai/gpt-4o-mini',
    'meta/meta-llama-3-70b-instruct',
    'palmyra-x-002-128k',
];

// Context-limit entries added in src/providers/context-window-manager.ts for
// long-tail models whose pricing already existed (keeps both tables in sync).
const ADDED_CONTEXT_ONLY_KEYS = [
    'sonar',
    'sonar-pro',
    'sonar-reasoning',
    'sonar-reasoning-pro',
];

// Representative long-tail models that must exist in BOTH tables.
const REPRESENTATIVE_MODELS = [
    'llama-3.3-70b-versatile',
    'grok-3',
    'mistral-large-latest',
    'command-r-plus-08-2024',
    'sonar-pro',
    'MiniMax-Text-01',
    'Baichuan4-Turbo',
    'hunyuan-turbo',
    'doubao-1.5-pro-32k',
    'qwen/qwen3.6-plus',
    'step-2-16k',
];

describe('long-tail model cost metadata', () => {
    it('prices a representative set of long-tail models', () => {
        for (const model of REPRESENTATIVE_MODELS) {
            const pricing = MODEL_PRICING[model];
            expect(pricing, `${model} should have pricing`).toBeDefined();
            expect(pricing!.input).toBeGreaterThanOrEqual(0);
            expect(pricing!.output).toBeGreaterThanOrEqual(0);
            expect(pricing!.input + pricing!.output, `${model} pricing should be nonzero`).toBeGreaterThan(0);
        }
    });

    it('assigns positive context limits to a representative set of long-tail models', () => {
        for (const model of REPRESENTATIVE_MODELS) {
            const limit = getContextLimitForModel(model);
            expect(limit, `${model} should resolve a context limit`).toBeGreaterThan(0);
            expect(limit, `${model} should not fall back to the default`).not.toBe(MODEL_CONTEXT_LIMITS['__default__']);
        }
    });

    it('keeps pricing and context-limit tables in parity for added keys', () => {
        // Every pricing key added must have a context limit (forward direction).
        for (const model of ADDED_PRICING_KEYS) {
            expect(MODEL_PRICING[model], `${model} pricing`).toBeDefined();
            const contextKey = resolveModelKeyForContextLimit(model);
            const limit = MODEL_CONTEXT_LIMITS[contextKey];
            expect(limit, `${model} context limit`).toBeGreaterThan(0);
        }

        // Every context-limit key added must have a pricing entry (reverse direction).
        const resolvedPricingKeys = Object.keys(MODEL_PRICING).map(resolveModelKeyForContextLimit);
        const allAdded = [...ADDED_PRICING_KEYS, ...ADDED_CONTEXT_ONLY_KEYS];
        for (const model of allAdded) {
            const contextKey = resolveModelKeyForContextLimit(model);
            expect(MODEL_CONTEXT_LIMITS[contextKey], `${model} context entry`).toBeGreaterThan(0);
            expect(resolvedPricingKeys, `${model} should have a pricing entry`).toContain(contextKey);
        }
    });
});
