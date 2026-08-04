/**
 * Hermetic coverage for src/memory — token-estimator + threads helpers.
 * No network. Callers: vitest only.
 */

import { describe, it, expect } from 'vitest';
import {
    estimateTokenCount,
    estimateMessageTokens,
    estimateConversationTokens,
    estimateObservationTokens,
    HashingEmbedder,
    isHashingEmbedder,
} from '../src/memory/token-estimator.js';
import {
    textOfContent,
    textOfMessage,
    byTimestamp,
    dedupeMessages,
    mergeMessagesByTimestamp,
    filterSystemMessages,
} from '../src/memory/threads.js';

describe('memory/token-estimator', () => {
    it('estimateTokenCount heuristic', () => {
        expect(estimateTokenCount('')).toBe(0);
        expect(estimateTokenCount('abcd')).toBe(1);
        expect(estimateTokenCount('abcdefgh')).toBe(2);
    });

    it('estimateMessageTokens handles string/array/parts/object/null', () => {
        expect(estimateMessageTokens(null)).toBe(0);
        expect(estimateMessageTokens(undefined)).toBe(0);
        expect(estimateMessageTokens('hello')).toBe(2 + 4); // 5 chars → 2 tokens + overhead
        expect(estimateMessageTokens(['a', { type: 'text', text: 'bcd' }])).toBe(1 + 1 + 4);
        expect(estimateMessageTokens([{ type: 'image' }, { type: 'file' }, { type: 'audio' }])).toBe(85 + 40 + 20 + 4);
        // nested text.content blocks
        expect(estimateMessageTokens([{ type: 'text', content: [{ type: 'text', text: 'wxyz' }] }])).toBe(1 + 4);
        // plain object without type → overhead only
        expect(estimateMessageTokens({ foo: 1 })).toBe(4);
    });

    it('estimateConversationTokens + estimateObservationTokens', () => {
        expect(estimateConversationTokens([
            { role: 'user', content: 'abcd' },
            { role: 'assistant', content: 'efgh' },
            { role: 'user' }, // no content → 0
        ])).toBe(1 + 4 + 1 + 4);
        expect(estimateObservationTokens(['abcd', undefined, 'efgh'])).toBe(1 + 1 + 1 + 1);
    });

    it('HashingEmbedder produces deterministic normalized vectors', async () => {
        const e = new HashingEmbedder(32);
        const v1 = await e.embed('hello world');
        const v2 = await e.embed('hello world');
        expect(v1).toHaveLength(32);
        expect(v1).toEqual(v2);
        // normalized
        const norm = Math.sqrt(v1.reduce((s, x) => s + x * x, 0));
        expect(norm).toBeCloseTo(1, 5);
        const batch = await e.embedBatch(['a', 'b']);
        expect(batch).toHaveLength(2);
        expect(e.getDimension()).toBe(32);
        expect(e.isHashing).toBe(true);
        // similar texts → similar vectors
        const v3 = await e.embed('hello world!');
        const dot = v1.reduce((s, x, i) => s + x * v3[i]!, 0);
        expect(dot).toBeGreaterThan(0.5);
    });

    it('isHashingEmbedder detection', () => {
        expect(isHashingEmbedder(new HashingEmbedder())).toBe(true);
        expect(isHashingEmbedder({ isHashing: false })).toBe(false);
        expect(isHashingEmbedder(null)).toBe(false);
        expect(isHashingEmbedder('nope')).toBe(false);
    });
});

describe('memory/threads helpers', () => {
    it('textOfContent handles all shapes', () => {
        expect(textOfContent(undefined)).toBe('');
        expect(textOfContent(null)).toBe('');
        expect(textOfContent('plain')).toBe('plain');
        expect(textOfContent(['a', { type: 'text', text: 'b' }, 'c'])).toBe('a\nb\nc');
        expect(textOfContent([{ type: 'text', text: { text: 'nested' } }])).toBe('nested');
        expect(textOfContent({ text: 'obj' })).toBe('obj');
        expect(textOfContent(42)).toBe('42');
        expect(textOfContent([{ type: 'image' }])).toBe('');
    });

    it('textOfMessage + byTimestamp + dedupe + merge + filter', () => {
        expect(textOfMessage({ content: 'hi' })).toBe('hi');
        expect(byTimestamp({ createdAt: '2026-01-01' }, { createdAt: '2026-01-02' })).toBeLessThan(0);
        expect(byTimestamp({}, {})).toBe(0);

        expect(dedupeMessages([
            { id: 'a', x: 1 },
            { id: 'a', x: 2 },
            { id: undefined, y: 1 },
            { y: 2 },
        ]).map((m) => m.x ?? m.y)).toEqual([1, 1, 2]);

        const merged = mergeMessagesByTimestamp(
            [{ id: 'b', createdAt: '2', role: 'user' }],
            [{ id: 'a', createdAt: '1', role: 'assistant' }],
            [{ id: 'a', createdAt: '1', role: 'assistant' }],
        );
        expect(merged.map((m) => m.id)).toEqual(['a', 'b']);

        expect(filterSystemMessages([
            { role: 'system' },
            { role: 'user' },
            { role: 'assistant' },
        ])).toHaveLength(2);
    });
});
