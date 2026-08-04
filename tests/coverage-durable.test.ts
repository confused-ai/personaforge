2/**
 * Hermetic coverage for src/execution/durable.ts — InMemoryEventStore,
 * DurableWorkflowContext, DurableRuntime.
 * No network. Callers: vitest only.
 */

import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest';
import {
    InMemoryEventStore,
    SqliteEventStore,
    LibSqlEventStore,
    RedisEventStore,
    PgEventStore,
    DurableWorkflowContext,
    DurableRuntime,
    WorkflowPausedError,
    WorkflowStateError,
    createEventStore,
    type EventStore,
} from '../src/execution/durable.js';

describe('durable InMemoryEventStore', () => {
    it('append/get/delete events', async () => {
        const store = new InMemoryEventStore();
        const evt = await store.append('wf1', { type: 'StepStarted', workflowId: 'wf1', payload: { stepId: 'a' } });
        expect(evt.id).toBeTruthy();
        expect(evt.timestamp).toBeGreaterThan(0);
        const events = await store.getEvents('wf1');
        expect(events.length).toBe(1);
        expect(events[0]!.type).toBe('StepStarted');
        expect(await store.getEvents('missing')).toEqual([]);
        await store.deleteEvents('wf1');
        expect(await store.getEvents('wf1')).toEqual([]);
    });
});

describe('durable DurableWorkflowContext', () => {
    it('step caches completed results and reuses them on replay', async () => {
        const store = new InMemoryEventStore();
        const ctx = new DurableWorkflowContext('wf', store);
        const fn = vi.fn(async () => 42);
        expect(await ctx.step('calc', fn)).toBe(42);
        expect(await ctx.step('calc', fn)).toBe(42);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(await ctx.getEventCount()).toBe(2); // StepStarted + StepCompleted
    });

    it('loadHistory hydrates cached results from prior events', async () => {
        const store = new InMemoryEventStore();
        const ctx1 = new DurableWorkflowContext('wf', store);
        await ctx1.step('done', async () => 'cached-value');
        const ctx2 = new DurableWorkflowContext('wf', store);
        await ctx2.loadHistory();
        const fn = vi.fn(async () => 'fresh');
        expect(await ctx2.step('done', fn)).toBe('cached-value');
        expect(fn).not.toHaveBeenCalled();
    });

    it('step retries with backoff then succeeds', async () => {
        const store = new InMemoryEventStore();
        const ctx = new DurableWorkflowContext('wf', store);
        let n = 0;
        const result = await ctx.step('flaky', async () => {
            n++;
            if (n < 3) throw new Error('transient');
            return 'ok';
        }, { attempts: 3, strategy: 'fixed', backoffMs: 1 });
        expect(result).toBe('ok');
        expect(n).toBe(3);
        const events = await store.getEvents('wf');
        expect(events.filter((e) => e.type === 'StepFailed').length).toBe(2);
    });

    it('step exhausts retries, logs DLQ warning, and throws', async () => {
        const store = new InMemoryEventStore();
        const ctx = new DurableWorkflowContext('wf', store);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(ctx.step('bad', async () => { throw new Error('fatal'); },
            { attempts: 2, strategy: 'exponential', backoffMs: 1, deadLetterQueue: true }))
            .rejects.toThrow('fatal');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('[DLQ]'));
        warn.mockRestore();
    });

    it('calculateBackoff strategies and no-backoff', async () => {
        const store = new InMemoryEventStore();
        const ctx = new DurableWorkflowContext('wf', store);
        // linear: backoffMs * attempt
        let n = 0;
        await expect(ctx.step('lin', async () => { n++; throw new Error('x'); },
            { attempts: 1, strategy: 'linear', backoffMs: 5 })).rejects.toThrow();
        expect(n).toBe(1);
        // no backoffMs → delay 0
        n = 0;
        await expect(ctx.step('zero', async () => { n++; throw new Error('x'); },
            { attempts: 1, strategy: 'linear' })).rejects.toThrow();
        expect(n).toBe(1);
    });

    it('waitForHuman appends paused event and throws WorkflowPausedError', async () => {
        const store = new InMemoryEventStore();
        const ctx = new DurableWorkflowContext('wf', store);
        await expect(ctx.waitForHuman('need input')).rejects.toBeInstanceOf(WorkflowPausedError);
        const events = await store.getEvents('wf');
        expect(events[0]!.type).toBe('WorkflowPaused');
        expect(events[0]!.payload).toMatchObject({ reason: 'need input' });
    });

    it('checkpoint appends CheckpointCreated event', async () => {
        const store = new InMemoryEventStore();
        const ctx = new DurableWorkflowContext('wf', store);
        await ctx.checkpoint();
        const events = await store.getEvents('wf');
        expect(events[0]!.type).toBe('CheckpointCreated');
    });
});

describe('durable DurableRuntime', () => {
    it('executes a workflow to completion and replays cached steps', async () => {
        const store = new InMemoryEventStore();
        const runtime = new DurableRuntime(store);
        const result = await runtime.execute('wf', async (ctx) => {
            const a = await ctx.step('a', async () => 1);
            const b = await ctx.step('b', async () => a + 1);
            return b;
        }, null);
        expect(result).toBe(2);
        expect(await runtime.replay('wf')).toHaveLength(6); // Started + a(2) + b(2) + Completed
    });

    it('returns cached result when already completed', async () => {
        const store = new InMemoryEventStore();
        const runtime = new DurableRuntime(store);
        await runtime.execute('wf', async (ctx) => ctx.step('s', async () => 'done'), null);
        const again = await runtime.execute('wf', async () => { throw new Error('should not run'); }, null);
        expect(again).toBe('done');
    });

    it('resume of a paused workflow re-runs and completes', async () => {
        const store = new InMemoryEventStore();
        const runtime = new DurableRuntime(store);
        const first = await runtime.execute('wf', async (ctx) => {
            await ctx.step('s1', async () => 'v1');
            await ctx.waitForHuman('pause here');
            return 'never';
        }, null);
        expect(first).toEqual({ status: 'paused', reason: 'pause here' });

        const resumed = await runtime.resume('wf', async (ctx) => {
            await ctx.step('s1', async () => 'cached'); // cached, not re-run
            await ctx.step('s2', async () => 'v2');
            return 'final';
        }, null);
        expect(resumed).toBe('final');
    });

    it('resume throws for not-started, completed, failed, and non-paused workflows', async () => {
        const store = new InMemoryEventStore();
        const runtime = new DurableRuntime(store);
        await expect(runtime.resume('never', async () => 'x', null)).rejects.toThrow(/not been started/);

        await runtime.execute('done-wf', async (ctx) => ctx.step('s', async () => 'x'), null);
        await expect(runtime.resume('done-wf', async () => 'x', null)).rejects.toThrow(/already completed/);

        await expect(runtime.execute('fail-wf', async () => { throw new Error('boom'); }, null)).rejects.toThrow('boom');
        await expect(runtime.resume('fail-wf', async () => 'x', null)).rejects.toThrow(/already failed/);

        // running but not paused → cannot resume (simulate via a store that
        // has only a WorkflowStarted event — no terminal, no pause)
        const startedOnly: EventStore = {
            append: async () => ({ id: 'x', type: 'WorkflowStarted', workflowId: 'w', timestamp: 1 }),
            getEvents: async () => [{ id: 'x', type: 'WorkflowStarted', workflowId: 'w', timestamp: 1 }],
            deleteEvents: async () => {},
        };
        const runtime2 = new DurableRuntime(startedOnly);
        await expect(runtime2.resume('w', async () => 'x', null)).rejects.toThrow(/not paused/);
    });

    it('workflow with terminal failed event throws WorkflowStateError on re-execute', async () => {
        const store = new InMemoryEventStore();
        const runtime = new DurableRuntime(store);
        await expect(runtime.execute('wf', async () => { throw new Error('boom'); }, null)).rejects.toThrow('boom');
        await expect(runtime.execute('wf', async () => 'x', null)).rejects.toBeInstanceOf(WorkflowStateError);
        await expect(runtime.execute('wf', async () => 'x', null)).rejects.toThrow(/already failed/);
    });

    it('WorkflowStateError and WorkflowPausedError names', () => {
        expect(new WorkflowStateError('m').name).toBe('WorkflowStateError');
        expect(new WorkflowPausedError('m').name).toBe('WorkflowPausedError');
    });
});

// ── Production-grade EventStores ─────────────────────────────────────────────

/** Contract test — runs each store against the EventStore interface. */
function testEventStore(createStore: () => EventStore, label: string): void {
    let store: EventStore;

    describe(`EventStore contract — ${label}`, () => {
        beforeAll(() => {
            store = createStore();
        });

        afterAll(async () => {
            await store.close?.();
        });

        it('append/get/delete events', async () => {
            const evt = await store.append('wf-contract', { type: 'StepStarted', workflowId: 'wf-contract', payload: { stepId: 'a' } });
            expect(evt.id).toBeTruthy();
            expect(evt.timestamp).toBeGreaterThan(0);
            expect(evt.type).toBe('StepStarted');

            await store.append('wf-contract', { type: 'StepCompleted', workflowId: 'wf-contract', payload: { stepId: 'a', result: 42 } });

            const events = await store.getEvents('wf-contract');
            expect(events.length).toBe(2);
            expect(events[0]!.type).toBe('StepStarted');
            expect(events[1]!.type).toBe('StepCompleted');

            expect(await store.getEvents('nonexistent')).toEqual([]);

            await store.deleteEvents?.('wf-contract');
            expect(await store.getEvents('wf-contract')).toEqual([]);
        });

        it('DurableRuntime completes a workflow and replays from the store', async () => {
            const runtime = new DurableRuntime(store);
            const wfId = `wf-replay-${label.replace(/\s+/g, '-').toLowerCase()}`;

            const result = await runtime.execute(wfId, async (ctx) => {
                const a = await ctx.step('step-a', async () => 1);
                const b = await ctx.step('step-b', async () => a + 1);
                return b;
            }, null);

            expect(result).toBe(2);

            // Replay — steps are cached from the persistent store
            const again = await runtime.execute(wfId, async () => { throw new Error('should not run'); }, null);
            expect(again).toBe(2);

            const events = await runtime.replay(wfId);
            expect(events.length).toBeGreaterThanOrEqual(6);
        });
    });
}

describe('durable production-grade EventStores', () => {
    testEventStore(() => new InMemoryEventStore(), 'InMemory');
    testEventStore(() => new SqliteEventStore(':memory:'), 'Sqlite');
    testEventStore(() => new LibSqlEventStore('file::memory:?cache=shared'), 'LibSql');

    describe('factory driver selection', () => {
        it('createEventStore returns the right store type', () => {
            const mem = createEventStore({ driver: 'memory' });
            expect(mem).toBeInstanceOf(InMemoryEventStore);

            const sql = createEventStore({ driver: 'sqlite', path: ':memory:' });
            expect(sql).toBeInstanceOf(SqliteEventStore);

            const lib = createEventStore({ driver: 'libsql', url: 'file::memory:?cache=shared' });
            expect(lib).toBeInstanceOf(LibSqlEventStore);
        });

        it('custom driver — pre-built instance', () => {
            const myStore = new InMemoryEventStore();
            const store = createEventStore({ driver: 'custom', custom: myStore });
            expect(store).toBe(myStore);
        });

        it('custom driver — factory', () => {
            const store = createEventStore({ driver: 'custom', custom: () => new InMemoryEventStore() });
            expect(store).toBeInstanceOf(InMemoryEventStore);
        });

        it('unknown driver falls back to memory', () => {
            const store = createEventStore({ driver: 'redis', fallbackToMemory: true });
            expect(store).toBeInstanceOf(InMemoryEventStore);
        });

        it('postgres falls back to memory when pg not installed', () => {
            const store = createEventStore({ driver: 'postgres', fallbackToMemory: true });
            expect(store).toBeInstanceOf(InMemoryEventStore);
        });
    });
});
