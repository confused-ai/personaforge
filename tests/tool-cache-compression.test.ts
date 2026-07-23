/**
 * Tool Cache & Compression Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ToolCache } from '@personaforge/tools';
import { ToolCompressor } from '@personaforge/tools';
import { withCache, withCompression } from '@personaforge/tools';
import { tool } from '@personaforge/tools';
import { z } from 'zod';
import type { ToolResult } from '@personaforge/tools';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeResult<T>(data: T): ToolResult<T> {
    const now = new Date();
    return {
        success: true,
        data,
        executionTimeMs: 5,
        metadata: { startTime: now, endTime: now, retries: 0 },
    };
}

function makeErrorResult(): ToolResult<unknown> {
    const now = new Date();
    return {
        success: false,
        error: { code: 'EXECUTION_ERROR', message: 'boom' },
        executionTimeMs: 1,
        metadata: { startTime: now, endTime: now, retries: 0 },
    };
}

// ── ToolCache ──────────────────────────────────────────────────────────────

describe('ToolCache', () => {
    let cache: ToolCache;

    beforeEach(() => {
        cache = new ToolCache({ maxEntries: 5, ttlMs: 5000 });
    });

    describe('basic get/set', () => {
        it('returns null on cache miss', () => {
            expect(cache.get('search', { q: 'hello' })).toBeNull();
        });

        it('returns cached result on hit', () => {
            const result = makeResult('found it');
            cache.set('search', { q: 'hello' }, result);
            expect(cache.get('search', { q: 'hello' })).toEqual(result);
        });

        it('misses when params differ', () => {
            cache.set('search', { q: 'hello' }, makeResult('a'));
            expect(cache.get('search', { q: 'world' })).toBeNull();
        });

        it('misses when tool name differs', () => {
            cache.set('search', { q: 'hello' }, makeResult('a'));
            expect(cache.get('other', { q: 'hello' })).toBeNull();
        });
    });

    describe('TTL expiry', () => {
        it('returns null after TTL expires', async () => {
            const shortCache = new ToolCache({ ttlMs: 10 });
            shortCache.set('t', {}, makeResult('v'));
            await new Promise(r => setTimeout(r, 20));
            expect(shortCache.get('t', {})).toBeNull();
        });

        it('does not expire when ttlMs=0', async () => {
            const forever = new ToolCache({ ttlMs: 0 });
            forever.set('t', {}, makeResult('v'));
            await new Promise(r => setTimeout(r, 20));
            expect(forever.get('t', {})).not.toBeNull();
        });
    });

    describe('LRU eviction', () => {
        it('evicts LRU entry when at capacity', () => {
            for (let i = 0; i < 5; i++) {
                cache.set('t', { i }, makeResult(i));
            }
            // Access entry 0 to make it recently used
            cache.get('t', { i: 0 });
            // Add one more — should evict the LRU (entry 1, the oldest unaccessed)
            cache.set('t', { i: 5 }, makeResult(5));

            expect(cache.getStats().size).toBe(5);
            expect(cache.getStats().evictions).toBe(1);
        });
    });

    describe('invalidate', () => {
        it('removes all entries for a tool', () => {
            cache.set('search', { q: 'a' }, makeResult('a'));
            cache.set('search', { q: 'b' }, makeResult('b'));
            cache.set('other', { q: 'c' }, makeResult('c'));

            const removed = cache.invalidate('search');
            expect(removed).toBe(2);
            expect(cache.get('search', { q: 'a' })).toBeNull();
            expect(cache.get('other', { q: 'c' })).not.toBeNull();
        });
    });

    describe('clear', () => {
        it('removes all entries', () => {
            cache.set('t', { a: 1 }, makeResult(1));
            cache.set('t', { a: 2 }, makeResult(2));
            cache.clear();
            expect(cache.getStats().size).toBe(0);
        });
    });

    describe('stats', () => {
        it('tracks hits and misses', () => {
            cache.set('t', { k: 1 }, makeResult(1));
            cache.get('t', { k: 1 }); // hit
            cache.get('t', { k: 2 }); // miss

            const stats = cache.getStats();
            expect(stats.hits).toBe(1);
            expect(stats.misses).toBe(1);
        });
    });

    describe('custom cacheKeyFn', () => {
        it('uses the provided key function', () => {
            const custom = new ToolCache({ cacheKeyFn: (name) => name });
            custom.set('myTool', { anything: true }, makeResult('v'));
            // Same tool name → same key regardless of params
            expect(custom.get('myTool', { different: true })).not.toBeNull();
        });
    });
});

// ── ToolCompressor ─────────────────────────────────────────────────────────

describe('ToolCompressor', () => {
    describe('shouldCompress', () => {
        it('returns false for small payloads', () => {
            const c = new ToolCompressor({ maxBytes: 100 });
            expect(c.shouldCompress('small')).toBe(false);
        });

        it('returns true when bytes exceed threshold', () => {
            const c = new ToolCompressor({ maxBytes: 10 });
            expect(c.shouldCompress('this string is definitely longer than ten bytes')).toBe(true);
        });

        it('serialises objects for measurement', () => {
            const c = new ToolCompressor({ maxBytes: 5 });
            expect(c.shouldCompress({ a: 1, b: 2, c: 3 })).toBe(true);
        });
    });

    describe('truncate strategy', () => {
        it('truncates and appends suffix', async () => {
            const c = new ToolCompressor({ maxBytes: 20, strategy: 'truncate', truncateSuffix: '[…]' });
            const result = await c.compress('abcdefghijklmnopqrstuvwxyz');
            expect(typeof result).toBe('string');
            expect((result as string).length).toBeLessThanOrEqual(20);
            expect((result as string).endsWith('[…]')).toBe(true);
        });

        it('passes through values below threshold', async () => {
            const c = new ToolCompressor({ maxBytes: 100 });
            const original = 'short';
            expect(await c.compress(original)).toBe(original);
        });
    });

    describe('compressSync', () => {
        it('works for truncate strategy', () => {
            const c = new ToolCompressor({ maxBytes: 10, truncateSuffix: '…' });
            const result = c.compressSync('123456789012345');
            expect(typeof result).toBe('string');
            expect((result as string).length).toBeLessThanOrEqual(10);
        });

        it('throws for summarize strategy', () => {
            const c = new ToolCompressor({
                maxBytes: 5,
                strategy: 'summarize',
                summarize: async (s) => s.slice(0, 5),
            });
            expect(() => c.compressSync('hello world')).toThrow();
        });
    });

    describe('summarize strategy', () => {
        it('calls the summarize function', async () => {
            const summarize = vi.fn().mockResolvedValue('summary');
            const c = new ToolCompressor({ maxBytes: 5, strategy: 'summarize', summarize });
            const result = await c.compress('a very long string here');
            expect(summarize).toHaveBeenCalledOnce();
            expect(result).toBe('summary');
        });
    });

    describe('stats', () => {
        it('tracks compressions and bytes saved', async () => {
            const c = new ToolCompressor({ maxBytes: 5, truncateSuffix: '' });
            await c.compress('123456789');
            const stats = c.getStats();
            expect(stats.compressions).toBe(1);
            expect(stats.bytesSaved).toBeGreaterThan(0);
        });
    });

    describe('constructor validation', () => {
        it('throws when summarize strategy has no fn', () => {
            expect(() => new ToolCompressor({ maxBytes: 5, strategy: 'summarize' })).toThrow();
        });
    });
});

// ── withCache wrapper ──────────────────────────────────────────────────────

describe('withCache', () => {
    let callCount: number;
    let echoTool: ReturnType<typeof tool>;
    let cache: ToolCache;

    beforeEach(() => {
        callCount = 0;
        echoTool = tool({
            name: 'echo',
            description: 'Echo input',
            parameters: z.object({ msg: z.string() }),
            execute: async ({ msg }) => { callCount++; return msg; },
        });
        cache = new ToolCache({ ttlMs: 60_000 });
    });

    it('calls underlying tool on first invocation', async () => {
        const wrapped = withCache(echoTool, cache);
        const result = await wrapped.execute({ msg: 'hi' });
        expect(result.success).toBe(true);
        expect(result.data).toBe('hi');
        expect(callCount).toBe(1);
    });

    it('returns cached result without re-executing', async () => {
        const wrapped = withCache(echoTool, cache);
        await wrapped.execute({ msg: 'hi' });
        await wrapped.execute({ msg: 'hi' });
        expect(callCount).toBe(1);
    });

    it('executes again for different params', async () => {
        const wrapped = withCache(echoTool, cache);
        await wrapped.execute({ msg: 'hi' });
        await wrapped.execute({ msg: 'bye' });
        expect(callCount).toBe(2);
    });

    it('does not cache failed results', async () => {
        let failCount = 0;
        const failTool = tool({
            name: 'fail',
            description: 'Always fails',
            parameters: z.object({}),
            execute: async () => { failCount++; throw new Error('boom'); },
        });
        const wrapped = withCache(failTool, cache);
        await wrapped.execute({});
        await wrapped.execute({});
        expect(failCount).toBe(2);
    });

    it('marks cache hits in metadata', async () => {
        const wrapped = withCache(echoTool, cache);
        await wrapped.execute({ msg: 'x' });
        const second = await wrapped.execute({ msg: 'x' });
        expect((second.metadata as any).cached).toBe(true);
    });

    it('preserves all original tool properties', () => {
        const wrapped = withCache(echoTool, cache);
        expect(wrapped.name).toBe(echoTool.name);
        expect(wrapped.description).toBe(echoTool.description);
        expect(wrapped.parameters).toBe(echoTool.parameters);
        expect(wrapped.category).toBe(echoTool.category);
    });
});

// ── withCompression wrapper ────────────────────────────────────────────────

describe('withCompression', () => {
    const bigOutputTool = tool({
        name: 'bigOutput',
        description: 'Returns a large string',
        parameters: z.object({ size: z.number() }),
        execute: async ({ size }) => 'x'.repeat(size),
    });

    it('passes through small results unmodified', async () => {
        const compressor = new ToolCompressor({ maxBytes: 100 });
        const wrapped = withCompression(bigOutputTool, compressor);
        const result = await wrapped.execute({ size: 10 });
        expect(result.success).toBe(true);
        expect((result.data as string).length).toBe(10);
    });

    it('compresses large results', async () => {
        const compressor = new ToolCompressor({ maxBytes: 50, truncateSuffix: '[trunc]' });
        const wrapped = withCompression(bigOutputTool, compressor);
        const result = await wrapped.execute({ size: 200 });
        expect(result.success).toBe(true);
        expect((result.data as string).length).toBeLessThanOrEqual(50);
        expect((result.data as string).endsWith('[trunc]')).toBe(true);
    });

    it('passes error results through unchanged', async () => {
        const errorTool = tool({
            name: 'error',
            description: 'Errors',
            parameters: z.object({}),
            execute: async () => { throw new Error('oops'); },
        });
        const compressor = new ToolCompressor({ maxBytes: 5 });
        const wrapped = withCompression(errorTool, compressor);
        const result = await wrapped.execute({});
        expect(result.success).toBe(false);
    });

    it('preserves tool metadata', () => {
        const compressor = new ToolCompressor({ maxBytes: 100 });
        const wrapped = withCompression(bigOutputTool, compressor);
        expect(wrapped.name).toBe(bigOutputTool.name);
        expect(wrapped.description).toBe(bigOutputTool.description);
    });
});

// ── Composition: withCache(withCompression(...)) ───────────────────────────

describe('withCache + withCompression composed', () => {
    let callCount = 0;

    const heavyTool = tool({
        name: 'heavy',
        description: 'Returns large data',
        parameters: z.object({ id: z.number() }),
        execute: async ({ id }) => {
            callCount++;
            return 'data'.repeat(1000) + id;
        },
    });

    beforeEach(() => { callCount = 0; });

    it('compresses on first call and caches the compressed result', async () => {
        const cache = new ToolCache({ ttlMs: 60_000 });
        const compressor = new ToolCompressor({ maxBytes: 100, truncateSuffix: '[…]' });
        const wrapped = withCache(withCompression(heavyTool, compressor), cache);

        const first = await wrapped.execute({ id: 1 });
        const second = await wrapped.execute({ id: 1 });

        expect(callCount).toBe(1);
        expect((first.data as string).length).toBeLessThanOrEqual(100);
        expect(second.data).toBe(first.data);
    });
});
