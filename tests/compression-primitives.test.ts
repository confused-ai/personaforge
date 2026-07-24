/**
 * Tests for compression primitives used by long-running agents:
 *   - Huffman context codec (lossless round-trip)
 *   - token counter + context budget
 *   - sliding window message pruning
 */

import { describe, it, expect } from 'vitest';
import { compressContext, decompressContext, estimateCompressionRatio } from '../src/compression/huffman.js';
import { countTokens, contextBudget, createTokenCounter } from '../src/compression/token-counter.js';
import { createSlidingWindow } from '../src/compression/sliding-window.js';

describe('Huffman context codec', () => {
    it('round-trips repetitive text losslessly', () => {
        const text = 'the quick brown fox '.repeat(20);
        const compressed = compressContext(text);
        expect(compressed.startsWith('H1:')).toBe(true);
        expect(decompressContext(compressed)).toBe(text);
    });

    it('leaves very short strings untouched (below threshold)', () => {
        const text = 'short';
        expect(compressContext(text)).toBe(text);
        // decompress of a non-H1 string is a pass-through
        expect(decompressContext(text)).toBe(text);
    });

    it('achieves < 1.0 compression ratio on repetitive input', () => {
        const text = 'aaaaaaaa bbbbbbbb '.repeat(40);
        const ratio = estimateCompressionRatio(text);
        expect(ratio).toBeGreaterThan(0);
        expect(ratio).toBeLessThan(1);
    });

    it('round-trips unicode content', () => {
        const text = 'café ☕ 日本語 '.repeat(20);
        const compressed = compressContext(text);
        expect(decompressContext(compressed)).toBe(text);
    });
});

describe('token counter', () => {
    it('countTokens returns 0 for empty and grows with length', () => {
        expect(countTokens('')).toBe(0);
        const short = countTokens('hello');
        const long = countTokens('hello world this is a longer sentence with more tokens');
        expect(long).toBeGreaterThan(short);
    });

    it('countMessages sums role + content', () => {
        const counter = createTokenCounter('gpt-4o');
        const n = counter.countMessages([
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'What is 2 + 2?' },
        ]);
        expect(n).toBeGreaterThan(0);
    });

    it('contextBudget reports used / remaining / ratio', () => {
        const budget = contextBudget(
            [{ role: 'user', content: 'hello world' }],
            1000,
            'gpt-4o',
        );
        expect(budget.used).toBeGreaterThan(0);
        expect(budget.remaining).toBe(1000 - budget.used);
        expect(budget.ratio).toBeCloseTo(budget.used / 1000, 5);
    });

    it('contextBudget clamps remaining at 0 when over budget', () => {
        const budget = contextBudget(
            [{ role: 'user', content: 'x '.repeat(500) }],
            10,
            'gpt-4o',
        );
        expect(budget.remaining).toBe(0);
        expect(budget.ratio).toBeGreaterThan(1);
    });
});

describe('sliding window', () => {
    it('keeps all messages when under the limit', () => {
        const win = createSlidingWindow({ strategy: 'lastN', maxMessages: 10 });
        const msgs = [
            { role: 'user' as const, content: 'a' },
            { role: 'assistant' as const, content: 'b' },
        ];
        const result = win.apply(msgs);
        expect(result.messages.length).toBe(2);
        expect(result.dropped).toBe(0);
    });

    it('drops oldest non-system messages when over maxMessages', () => {
        const win = createSlidingWindow({ strategy: 'lastN', maxMessages: 3, preserveSystem: true });
        const msgs = [
            { role: 'system' as const, content: 'sys' },
            { role: 'user' as const, content: 'm1' },
            { role: 'assistant' as const, content: 'm2' },
            { role: 'user' as const, content: 'm3' },
            { role: 'assistant' as const, content: 'm4' },
        ];
        const result = win.apply(msgs);
        // System preserved + most-recent messages kept
        expect(result.messages.some((m) => m.role === 'system')).toBe(true);
        expect(result.messages.map((m) => m.content)).toContain('m4');
        expect(result.dropped).toBeGreaterThan(0);
    });

    it('returns empty for empty input', () => {
        const win = createSlidingWindow();
        const result = win.apply([]);
        expect(result.messages).toEqual([]);
        expect(result.dropped).toBe(0);
    });

    it('exposes the resolved config', () => {
        const win = createSlidingWindow({ maxMessages: 42 });
        expect(win.config.maxMessages).toBe(42);
        expect(win.config.preserveSystem).toBe(true);
    });
});
