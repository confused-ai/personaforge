/**
 * Tests for Observational Memory: Observer extraction, buffering, activation,
 * reflection, extractors and working-memory hand-off.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Memory } from '../src/memory/memory.js';
import { Extractor, ObservationalMemoryManager } from '../src/memory/observational-memory.js';
import { InMemoryThreadStore } from '../src/memory/in-memory-thread-store.js';
import type { LLMProvider } from '../src/contracts/interfaces.js';

/** Scripted LLM: responds to Observer / Reflector / extractor prompts. */
function observerLlm(): LLMProvider & { calls: number } {
    const llm = {
        calls: 0,
        async generateText(messages: Array<{ role: string; content: unknown }>) {
            llm.calls += 1;
            const sys = messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
            let text: string;
            if (sys.includes('Observer agent')) {
                text = JSON.stringify({
                    observations: ['- [H] User prefers dark mode', '- [M] Project is "acme"'],
                    currentTask: 'help the user set up their editor',
                    suggestedResponse: 'ask what editor theme they want',
                    'user-profile': '- Name: Alice\n- Style: Casual',
                });
            } else if (sys.includes('Reflector agent')) {
                text = JSON.stringify({ reflections: ['- condensed: user prefers dark mode, works on acme'] });
            } else if (sys.includes('Extract structured data')) {
                text = '{"deployment":"production","stack":"libsql"}';
            } else {
                text = '{"observations":[]}';
            }
            return { text, finishReason: 'stop' as const };
        },
    };
    return llm;
}

const messages = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `message number ${i} with enough context tokens to trigger thresholds` }));

const inMemoryStore = () => new InMemoryThreadStore();

describe('ObservationalMemoryManager — configuration', () => {
    it('throws when no llm is provided', () => {
        expect(() => new ObservationalMemoryManager({ store: inMemoryStore(), config: {} })).toThrow(/llm/);
    });
});

describe('ObservationalMemoryManager — observe → activate', () => {
    let llm: ReturnType<typeof observerLlm>;
    let store: InMemoryThreadStore;

    beforeEach(() => {
        llm = observerLlm();
        store = inMemoryStore();
    });

    it('observeSync compresses a long history into notes and advances the cursor', async () => {
        const mgr = new ObservationalMemoryManager({ store, llm, config: { messageTokens: 10 } });
        await store.createThread({ id: 't1', resourceId: 'r1' });
        await store.saveMessages('t1', messages(8));

        const result = await mgr.observeSync({ threadId: 't1', resourceId: 'r1' });
        expect(result.activated).toBe(true);
        expect(result.notes.length).toBeGreaterThan(0);
        expect(result.notes[0]).toContain('dark mode');

        const log = await mgr.getObservationLog('t1');
        expect(log.some((line) => line.includes('dark mode'))).toBe(true);
        // everything observed → no unobserved messages left
        expect(await mgr.getUnobserved('t1')).toHaveLength(0);
    });

    it('getContextWindow activates once history crosses messageTokens', async () => {
        const mgr = new ObservationalMemoryManager({ store, llm, config: { messageTokens: 1, observationTokens: 1000 } });
        await store.createThread({ id: 't2', resourceId: 'r1' });
        await store.saveMessages('t2', messages(4));

        const window = await mgr.getContextWindow({ threadId: 't2', resourceId: 'r1' });
        expect(window.activated).toBe(true);
        expect(window.system).toContain('[Observational Memory]');
        expect(window.system).toContain('dark mode');
        expect(window.messages.length).toBeLessThan(4); // window was trimmed
        expect(window.counts.messages).toBeGreaterThan(0);
    });

    it('does not activate under the threshold — all messages stay in context', async () => {
        const mgr = new ObservationalMemoryManager({ store, llm, config: { messageTokens: 100_000, observationTokens: 100_000 } });
        await store.createThread({ id: 't3', resourceId: 'r1' });
        await store.saveMessages('t3', messages(3));

        const window = await mgr.getContextWindow({ threadId: 't3', resourceId: 'r1' });
        expect(window.activated).toBe(false);
        expect(window.system).toBeUndefined();
        expect(window.messages).toHaveLength(3);
    });

    it('continuation hints (current task / suggested response) are surfaced', async () => {
        const mgr = new ObservationalMemoryManager({ store, llm, config: { messageTokens: 1, observationTokens: 1000 } });
        await store.createThread({ id: 't4', resourceId: 'r1' });
        await store.saveMessages('t4', messages(3));
        const window = await mgr.getContextWindow({ threadId: 't4', resourceId: 'r1' });
        expect(window.continuation).toContain('Suggested next response');
    });
});

describe('ObservationalMemoryManager — buffering + reflection', () => {
    it('background buffering queues notes that activate without a sync LLM call on the next read', async () => {
        const llm = observerLlm();
        const store = inMemoryStore();
        const mgr = new ObservationalMemoryManager({
            store,
            llm,
            config: { messageTokens: 50, bufferTokens: 0.5, bufferActivation: 0.5, observationTokens: 100_000 },
        });
        await store.createThread({ id: 'b1', resourceId: 'r1' });
        await store.saveMessages('b1', messages(30)); // ~30 * 8 tokens ≈ 240 ≥ 50*0.5

        const buffered = await mgr.maybeBuffer({ threadId: 'b1', resourceId: 'r1' });
        expect(buffered.notes.length).toBeGreaterThan(0);

        const thread = await store.getThread('b1');
        expect(thread?.state?.buffer?.length).toBe(1);

        // grow history past messageTokens so buffered notes can be activated
        await store.saveMessages('b1', messages(40));
        const callsBefore = llm.calls;
        const window = await mgr.getContextWindow({ threadId: 'b1', resourceId: 'r1' });
        expect(window.activated).toBe(true);
        expect(window.system).toContain('dark mode');
        // buffered activation must NOT spawn a new Observer call
        expect(llm.calls).toBe(callsBefore);
    });

    it('reflects when the observation log exceeds observationTokens', async () => {
        const llm = observerLlm();
        const store = inMemoryStore();
        const mgr = new ObservationalMemoryManager({
            store,
            llm,
            config: { messageTokens: 1, observationTokens: 40_000, bufferTokens: false },
        });
        await store.createThread({ id: 'b2', resourceId: 'r1' });
        await store.saveMessages('b2', messages(6));
        await mgr.observeSync({ threadId: 'b2', resourceId: 'r1' });

        const { reflected } = await mgr.maybeReflect({ threadId: 'b2', resourceId: 'r1' }, undefined, true);
        expect(reflected).toBe(true);
        const log = await mgr.getObservationLog('b2');
        expect(log.some((line) => line.includes('condensed'))).toBe(true);
    });

    it('only observes once the buffer threshold is met', async () => {
        const llm = observerLlm();
        const store = inMemoryStore();
        const mgr = new ObservationalMemoryManager({ store, llm, config: { messageTokens: 100_000, bufferTokens: false } });
        await store.createThread({ id: 'b3', resourceId: 'r1' });
        await store.saveMessages('b3', messages(2));
        const result = await mgr.maybeBuffer({ threadId: 'b3', resourceId: 'r1' });
        expect(result.notes).toEqual([]);
    });
});

describe('ObservationalMemoryManager — extractors + working memory', () => {
    it('persists inline + schema extractor values onto thread state', async () => {
        const llm = observerLlm();
        const store = inMemoryStore();
        const mgr = new ObservationalMemoryManager({
            store,
            llm,
            config: {
                messageTokens: 1,
                observationTokens: 100_000,
                bufferTokens: false,
                extractors: [new Extractor({ name: 'user-profile', instructions: 'who is the user?' })],
            },
        });
        await store.createThread({ id: 'e1', resourceId: 'r1' });
        await store.saveMessages('e1', messages(3));
        await mgr.observeSync({ threadId: 'e1', resourceId: 'r1' });

        const state = (await store.getThread('e1'))?.state;
        expect(state?.extractions?.['user-profile']).toContain('Alice');
    });

    it('manageWorkingMemory writes a resolved profile into the working-memory store', async () => {
        const llm = observerLlm();
        const store = inMemoryStore();
        const mem = new Memory({
            storage: store,
            llm,
            options: {
                workingMemory: { template: '# Profile\n- Name:' },
                observationalMemory: {
                    messageTokens: 1,
                    observationTokens: 100_000,
                    bufferTokens: false,
                    observation: { manageWorkingMemory: true },
                },
            },
        });
        await mem.createThread({ threadId: 'wm1', resourceId: 'r1' });
        await mem.saveMessages('wm1', 'r1', messages(3));
        const result = await mem.processObservations({ threadId: 'wm1', resourceId: 'r1' });
        expect(result.observed).toBe(true);

        const wm = await mem.getWorkingMemory({ threadId: 'wm1', resourceId: 'r1' });
        expect(wm).toContain('Alice');
    });
});
