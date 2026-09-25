import { describe, it, expect } from 'vitest';
import { anthropicThinkingConfig } from '../src/providers/anthropic-thinking.js';

const ADAPTIVE = { type: 'adaptive', display: 'summarized' };
const BUDGET = { type: 'enabled', budget_tokens: 4000 };

const table: [string, unknown][] = [
    ['claude-opus-5', ADAPTIVE],
    ['claude-sonnet-5', ADAPTIVE],
    ['claude-fable-5', ADAPTIVE],
    ['claude-fable-5-1', ADAPTIVE],
    ['claude-mythos-5-1', ADAPTIVE],
    ['claude-opus-4-8', ADAPTIVE],
    ['claude-opus-4-7', ADAPTIVE],
    ['claude-opus-4-6', ADAPTIVE],
    ['claude-sonnet-4-6', ADAPTIVE],
    ['anthropic.claude-opus-5', ADAPTIVE],
    ['claude-3-7-sonnet-20250219', BUDGET],
    ['claude-haiku-4-5', BUDGET],
    ['claude-sonnet-4-5', BUDGET],
    ['claude-opus-4-5', BUDGET],
    ['claude-opus-4-1', BUDGET],
    ['claude-opus-4-20250514', BUDGET],
    ['claude-sonnet-4-20250514', BUDGET],
    ['claude-sonnet-4', BUDGET],
    ['claude-opus-4', BUDGET],
    ['anthropic.claude-3-7-sonnet-20250219-v1:0', BUDGET],
    ['claude-3-5-sonnet-20241022', undefined],
    ['claude-3-5-haiku-20241022', undefined],
    ['claude-3-opus-20240229', undefined],
    ['claude-3-haiku', undefined],
    ['anthropic.claude-3-5-sonnet-20241022-v2:0', undefined],
    ['gpt-4o', undefined],
    ['', undefined],
    ['something-unknown', undefined],
];

describe('anthropicThinkingConfig', () => {
    it.each(table)('%s', (model, expected) => {
        expect(anthropicThinkingConfig(model, 8000)).toEqual(expected);
    });

    it('budget is at most half of maxTokens (cap 4096) and skipped when < 1024', () => {
        expect(anthropicThinkingConfig('claude-haiku-4-5', 20000)).toEqual({ type: 'enabled', budget_tokens: 4096 });
        expect(anthropicThinkingConfig('claude-haiku-4-5', 8000)).toEqual({ type: 'enabled', budget_tokens: 4000 });
        expect(anthropicThinkingConfig('claude-haiku-4-5', 4096)).toEqual({ type: 'enabled', budget_tokens: 2048 });
        expect(anthropicThinkingConfig('claude-haiku-4-5', 2048)).toEqual({ type: 'enabled', budget_tokens: 1024 });
        expect(anthropicThinkingConfig('claude-haiku-4-5', 2047)).toBeUndefined();
        expect(anthropicThinkingConfig('claude-haiku-4-5', 2000)).toBeUndefined();
        expect(anthropicThinkingConfig('claude-haiku-4-5', 1024)).toBeUndefined();
        expect(anthropicThinkingConfig('claude-opus-5', 1024)).toEqual(ADAPTIVE);
    });

    it('returns undefined for every model when ENABLE_REASONING_STREAM=false', () => {
        const saved = process.env.ENABLE_REASONING_STREAM;
        process.env.ENABLE_REASONING_STREAM = 'false';
        try {
            for (const [model] of table) expect(anthropicThinkingConfig(model, 8000)).toBeUndefined();
        } finally {
            if (saved === undefined) delete process.env.ENABLE_REASONING_STREAM;
            else process.env.ENABLE_REASONING_STREAM = saved;
        }
    });
});
