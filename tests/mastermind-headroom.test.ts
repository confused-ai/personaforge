/**
 * Mastermind — headroom-parity features
 * =====================================
 * Two additions that bring Mastermind to feature parity with a headroom-style
 * context system:
 *   1. Mastermind.stats()  — session-lifetime savings dashboard + $ estimate
 *   2. query-filtered CCR retrieve — pull only matching lines of an original
 */

import { describe, it, expect } from 'vitest';

import { Mastermind } from '../src/compression/mastermind/mastermind.js';
import { CCRStore, createRetrieveTool } from '../src/compression/mastermind/ccr.js';
import type { MastermindMessage } from '../src/compression/mastermind/types.js';
// The Mastermind-wired factory (public createAgent), not the standalone core one.
import { createAgent } from '../src/create-agent/index.js';

// A JSON tool result big enough to clear the 100-token compress threshold and
// route to the smart-crusher (no LLM needed → deterministic).
const bigJson = JSON.stringify(
    {
        items: Array.from({ length: 40 }, (_, i) => ({
            id: i,
            name: `item-${i}`,
            value: i * 7,
            active: i % 2 === 0,
            note: 'lorem ipsum dolor sit amet consectetur',
        })),
    },
    null,
    2,
);

/** Fresh message list each call — compress() mutates message objects in place. */
function makeMessages(): MastermindMessage[] {
    return [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Fetch the data.' },
        { role: 'assistant', content: 'calling tool', tool_calls: [{ id: 't1' }] },
        { role: 'tool', tool_call_id: 't1', content: bigJson },
    ];
}

// recentMessagesWindow:0 so the tool result isn't shielded as "recent";
// costPer1kTokens:1 so costSavedUsd === tokensSaved/1000 exactly.
const cfg = { recentMessagesWindow: 0, costPer1kTokens: 1, enableCacheAligner: false };

describe('Mastermind.stats() — session-lifetime dashboard', () => {
    it('starts empty', () => {
        const mm = new Mastermind(cfg);
        const s = mm.stats();
        expect(s.compressions).toBe(0);
        expect(s.tokensSaved).toBe(0);
        expect(s.costSavedUsd).toBe(0);
        expect(s.recent).toEqual([]);
    });

    it('accumulates savings and prices them', async () => {
        const mm = new Mastermind(cfg);
        const { stats: run } = await mm.compress(makeMessages());
        expect(run.messagesCompressed).toBeGreaterThan(0); // sanity: it did compress

        const s = mm.stats();
        expect(s.compressions).toBe(1);
        expect(s.messagesCompressed).toBeGreaterThan(0);
        expect(s.tokensSaved).toBeGreaterThan(0);
        expect(s.tokensBefore).toBeGreaterThan(s.tokensAfter);
        // costPer1kTokens === 1 → dollars == thousands of tokens saved
        expect(s.costSavedUsd).toBeCloseTo(s.tokensSaved / 1000, 10);
        expect(s.recent).toHaveLength(1);
        expect(s.recent[0]!.tokensSaved).toBe(s.tokensSaved);
        expect(Object.keys(s.algorithms).length).toBeGreaterThan(0);
    });

    it('adds up across calls', async () => {
        const mm = new Mastermind(cfg);
        await mm.compress(makeMessages());
        await mm.compress(makeMessages());
        const s = mm.stats();
        expect(s.compressions).toBe(2);
        expect(s.recent).toHaveLength(2);
    });

    it('bounds the recent-events ring buffer at 20', async () => {
        const mm = new Mastermind(cfg);
        for (let i = 0; i < 25; i++) await mm.compress(makeMessages());
        const s = mm.stats();
        expect(s.compressions).toBe(25);
        expect(s.recent).toHaveLength(20); // oldest 5 dropped
    });

    it('returns copies — mutating the result cannot corrupt internal state', () => {
        const mm = new Mastermind(cfg);
        const s = mm.stats();
        s.recent.push({ at: 0, tokensBefore: 9, tokensAfter: 9, tokensSaved: 9, messagesCompressed: 9, algorithms: {} });
        expect(mm.stats().recent).toHaveLength(0);
    });
});

describe('query-filtered CCR retrieve — headroom_retrieve parity', () => {
    const original = ['alpha line one', 'BETA line two', 'gamma beta three', 'delta line four'].join('\n');

    function toolWithEntry() {
        const store = new CCRStore();
        const handle = store.store({
            original,
            compressed: '...',
            algorithm: 'smart-crusher',
            contentType: 'text',
        });
        return { tool: createRetrieveTool(store), handle };
    }

    it('returns the full original when no query is given', async () => {
        const { tool, handle } = toolWithEntry();
        const r = await tool.execute({ handle });
        expect(r.found).toBe(true);
        expect(r.content).toBe(original);
        expect(r.matches).toBeUndefined();
    });

    it('returns only matching lines (case-insensitive) with a count', async () => {
        const { tool, handle } = toolWithEntry();
        const r = await tool.execute({ handle, query: 'beta' });
        expect(r.found).toBe(true);
        expect(r.matches).toBe(2);
        expect(r.content).toBe('BETA line two\ngamma beta three');
    });

    it('reports zero matches without erroring', async () => {
        const { tool, handle } = toolWithEntry();
        const r = await tool.execute({ handle, query: 'zzz-nope' });
        expect(r.found).toBe(true);
        expect(r.matches).toBe(0);
        expect(r.content).toContain('no lines');
    });

    it('still reports not-found for a bad handle', async () => {
        const { tool } = toolWithEntry();
        const r = await tool.execute({ handle: 'ccr_dead', query: 'beta' });
        expect(r.found).toBe(false);
    });
});

describe('createAgent — getCompressionStats() wiring', () => {
    const fakeLLM = {
        generateText: async () => ({ text: 'ok', toolCalls: [], finishReason: 'stop' }),
    } as any;

    it('exposes a zeroed dashboard by default', () => {
        const bot = createAgent({ name: 'b', instructions: 'x', llm: fakeLLM, tools: false });
        const s = bot.getCompressionStats();
        expect(s).toBeDefined();
        expect(s!.compressions).toBe(0);
        expect(s!.costSavedUsd).toBe(0);
    });

    it('returns undefined when compression is disabled', () => {
        const bot = createAgent({ name: 'b', instructions: 'x', llm: fakeLLM, tools: false, mastermind: false });
        expect(bot.getCompressionStats()).toBeUndefined();
    });
});
