import { describe, it, expect, vi } from 'vitest';
import { createHarness } from '../src/harness/create-harness.js';
import { createRunJournal } from '../src/harness/journal.js';
import type { EventStore, GraphEvent } from '../src/graph/types.js';
import { InMemoryEventStore } from '../src/graph/event-store.js';

const okAgent = {
    name: 'journal-agent',
    run: async (prompt: string) => ({ text: `ok:${prompt}` }),
};

const failingAgent = {
    name: 'journal-agent',
    run: async () => {
        throw new Error('boom');
    },
};

/** InMemoryEventStore has no list API; each test uses one run per store. */
function collectAll(store: EventStore): GraphEvent[] {
    const internals = store as unknown as { events?: Map<string, GraphEvent[]> };
    if (internals.events instanceof Map) return [...internals.events.values()].flat();
    return [];
}

describe('harness run journal', () => {
    it('records a success run as a verifiable chained pair', async () => {
        const harness = createHarness({ agent: okAgent, resilience: false, journal: true });

        await harness.run('hello', { sessionId: 's1', userId: 'u1' });

        const events = collectAll(harness.journal!.store);
        expect(events).toHaveLength(2);
        expect(events[0]!.sequence).toBe(0);
        expect(events[1]!.sequence).toBe(1);

        const runId = events[0]!.executionId;
        expect((await harness.journal!.verify(runId)).valid).toBe(true);

        const timeline = await harness.journal!.timeline(runId);
        expect(timeline.harness).toBe('journal-agent');
        expect(timeline.outcome).toBe('success');
        expect(timeline.events).toHaveLength(2);
        expect(timeline.events[0]!.data['sessionId']).toBe('s1');
        expect(timeline.events[0]!.data['userId']).toBe('u1');
    });

    it('records failures and detects tampering', async () => {
        const store = new InMemoryEventStore();
        const journal = createRunJournal({ store });
        const harness = createHarness({ agent: failingAgent, resilience: false, journal });

        await expect(harness.run('hello')).rejects.toThrow('boom');

        const events = collectAll(store);
        expect(events).toHaveLength(2);
        const runId = events[0]!.executionId;

        expect((await journal.verify(runId)).valid).toBe(true);
        expect((await journal.timeline(runId)).outcome).toBe('error');

        // Tamper with the stored payload: the chain must break.
        (events[1]!.data as Record<string, unknown>)['error'] = 'forged';
        const tampered = await journal.verify(runId);
        expect(tampered.valid).toBe(false);
        expect(tampered.brokenAt).toBe(1);
    });

    it('never breaks the run when the store fails', async () => {
        const onError = vi.fn();
        const broken: EventStore = {
            async append(): Promise<void> {
                throw new Error('store down');
            },
            async load(): Promise<GraphEvent[]> {
                return [];
            },
            async loadAfter(): Promise<GraphEvent[]> {
                return [];
            },
            async getCheckpoint(): Promise<null> {
                return null;
            },
            async saveCheckpoint(): Promise<void> {},
        };
        const harness = createHarness({
            agent: okAgent,
            resilience: false,
            journal: createRunJournal({ store: broken, onError }),
        });

        await expect(harness.run('hello')).resolves.toEqual({ text: 'ok:hello' });
        expect(onError).toHaveBeenCalled();
    });

    it('is absent unless opted in', async () => {
        const harness = createHarness({ agent: okAgent, resilience: false });
        expect(harness.journal).toBeUndefined();
        await harness.run('hello');
    });
});
