/**
 * Boundary guard: `personaforge/graph` and `personaforge/execution` are TWO
 * different engines and must stay separable.
 *
 * They share three symbol names (`EventStore`, `InMemoryEventStore`,
 * `ExecutionStatus`) but the shapes are intentionally different — the graph
 * side is the roadmap L1 substrate (append-only, hash-chainable, replayable),
 * the execution side is the CQRS task-scheduler store. Merging or cross-
 * importing them silently would break both engines.
 *
 * This test pins that fact:
 *   - Their classes are distinct references.
 *   - Their append() signatures are incompatible (arity + argument shape).
 *   - `ExecutionStatus` is an enum on one side and an interface on the other,
 *     which we assert via a runtime shape check.
 *
 * If a future refactor unifies them, delete this test in the same PR — it is a
 * regression alarm, not a moral judgement.
 */

import { describe, it, expect } from 'vitest';

import { InMemoryEventStore as GraphStore, GraphEventType, ExecutionStatus as GraphStatus } from '../src/graph/index.js';
import { InMemoryEventStore as ExecStore } from '../src/execution/index.js';

describe('graph vs execution — engine boundary', () => {
    it('exports two distinct InMemoryEventStore classes', () => {
        expect(GraphStore).not.toBe(ExecStore);
    });

    it('graph EventStore.append accepts a batch of graph events', async () => {
        const store = new GraphStore();
        const events = [
            {
                id: 'e-1',
                type: GraphEventType.AGENT_STARTED,
                executionId: 'x-1' as never,
                graphId: 'g-1' as never,
                timestamp: 1,
                sequence: 1,
                data: { prompt: 'hi' },
            },
        ];
        await store.append(events as never);
        const loaded = await store.load('x-1' as never);
        expect(loaded).toHaveLength(1);
        expect(loaded[0]!.type).toBe(GraphEventType.AGENT_STARTED);
    });

    it('execution EventStore.append uses a (workflowId, event) signature', async () => {
        const store = new ExecStore();
        const stored = await store.append('wf-1', { type: 'started', payload: { ok: true } });
        expect(stored.id).toBeDefined();
        expect(stored.timestamp).toBeDefined();
        const history = await store.getEvents('wf-1');
        expect(history).toHaveLength(1);
        expect(history[0]!.type).toBe('started');
    });

    it('exported ExecutionStatus symbol shape differs between the two engines', async () => {
        // graph.ExecutionStatus is an enum → the imported value is an object with string keys.
        expect(typeof GraphStatus).toBe('object');
        expect(Object.keys(GraphStatus as object).length).toBeGreaterThan(0);

        // execution.ExecutionStatus is an interface → it has no runtime value.
        // We verify that by dynamically importing the barrel and checking the
        // ExecutionStatus name is NOT enumerable as a runtime value there.
        const execMod = await import('../src/execution/index.js') as Record<string, unknown>;
        expect('ExecutionStatus' in execMod ? typeof execMod.ExecutionStatus : 'undefined').toBe('undefined');
    });
});
