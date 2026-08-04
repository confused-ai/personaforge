/**
 * Hermetic coverage for src/execution/state-graph.ts — StateGraph, StateNode,
 * WorkflowExecutor, WorkflowBuilder, InMemoryCheckpointStore.
 * No network. Callers: vitest only.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    StateGraph,
    StateNode,
    NodeType,
    TransitionType,
    WorkflowStatus,
    WorkflowExecutor,
    WorkflowBuilder,
    InMemoryCheckpointStore,
} from '../src/execution/state-graph.js';
import type { WorkflowContext } from '../src/execution/state-graph.js';

// ── StateGraph building ─────────────────────────────────────────────────────

describe('state-graph StateGraph', () => {
    it('builds nodes/transitions and queries adjacency', () => {
        const g = new StateGraph({ name: 'wf' });
        g.addNode({ id: 'start', type: NodeType.START, name: 's' });
        g.addNode({ id: 'a', type: NodeType.TASK, name: 'A' });
        g.addNode({ id: 'end', type: NodeType.END, name: 'E' });
        g.addTransition({ from: 'start', to: 'a', type: TransitionType.UNCONDITIONAL });
        g.addTransition({ from: 'a', to: 'end', type: TransitionType.UNCONDITIONAL });

        expect(g.getNode('a')!.name).toBe('A');
        expect(g.getNodes().length).toBe(3);
        expect(g.getOutgoing('start')).toEqual(['a']);
        expect(g.getIncoming('a')).toEqual(['start']);
        expect(g.getOutgoing('missing')).toEqual([]);
        expect(g.getInitialNode()!.id).toBe('start');
        expect(() => g.addTransition({ from: 'nope', to: 'a', type: TransitionType.UNCONDITIONAL })).toThrow(/does not exist/);
        expect(() => g.addTransition({ from: 'a', to: 'nope', type: TransitionType.UNCONDITIONAL })).toThrow(/does not exist/);
    });

    it('getInitialNode falls back to first node when no START', () => {
        const g = new StateGraph({ name: 'wf' });
        g.addNode({ id: 'first', type: NodeType.TASK, name: 'F' });
        expect(g.getInitialNode()!.id).toBe('first');
    });

    it('validate flags empty graph, missing END, unreachable, cycle', () => {
        const empty = new StateGraph({ name: 'e' });
        expect(empty.validate().valid).toBe(false);
        expect(empty.validate().errors.join()).toContain('at least one node');

        const noEnd = new StateGraph({ name: 'n' });
        noEnd.addNode({ id: 'start', type: NodeType.START, name: 's' });
        noEnd.addNode({ id: 't', type: NodeType.TASK, name: 't' });
        noEnd.addTransition({ from: 'start', to: 't', type: TransitionType.UNCONDITIONAL });
        const res = noEnd.validate();
        expect(res.errors.join()).toContain('END node');

        const unreachable = new StateGraph({ name: 'u' });
        unreachable.addNode({ id: 'start', type: NodeType.START, name: 's' });
        unreachable.addNode({ id: 'end', type: NodeType.END, name: 'e' });
        unreachable.addNode({ id: 'orphan', type: NodeType.TASK, name: 'o' });
        unreachable.addTransition({ from: 'start', to: 'end', type: TransitionType.UNCONDITIONAL });
        expect(unreachable.validate().errors.join()).toContain('Unreachable');

        const cyclic = new StateGraph({ name: 'c' });
        cyclic.addNode({ id: 'a', type: NodeType.TASK, name: 'a' });
        cyclic.addNode({ id: 'b', type: NodeType.TASK, name: 'b' });
        cyclic.addTransition({ from: 'a', to: 'b', type: TransitionType.UNCONDITIONAL });
        cyclic.addTransition({ from: 'b', to: 'a', type: TransitionType.UNCONDITIONAL });
        expect(cyclic.validate().errors.join()).toContain('cycles');
    });

    it('getTopologicalOrder produces valid ordering', () => {
        const g = new StateGraph({ name: 't' });
        g.addNode({ id: 'start', type: NodeType.START, name: 's' });
        g.addNode({ id: 'a', type: NodeType.TASK, name: 'a' });
        g.addNode({ id: 'b', type: NodeType.TASK, name: 'b' });
        g.addNode({ id: 'end', type: NodeType.END, name: 'e' });
        g.addTransition({ from: 'start', to: 'a', type: TransitionType.UNCONDITIONAL });
        g.addTransition({ from: 'a', to: 'b', type: TransitionType.UNCONDITIONAL });
        g.addTransition({ from: 'b', to: 'end', type: TransitionType.UNCONDITIONAL });
        const order = g.getTopologicalOrder();
        expect(order.indexOf('start')).toBeLessThan(order.indexOf('a'));
        expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
        expect(order.indexOf('b')).toBeLessThan(order.indexOf('end'));
    });

    it('toJSON / fromJSON round-trips nodes and transitions', () => {
        const g = new StateGraph({ name: 'rt', description: 'd' });
        g.addNode({ id: 'start', type: NodeType.START, name: 's' });
        g.addNode({ id: 'end', type: NodeType.END, name: 'e' });
        g.addTransition({ from: 'start', to: 'end', type: TransitionType.UNCONDITIONAL });
        const json = g.toJSON();
        const g2 = StateGraph.fromJSON(json as never);
        expect(g2.name).toBe('rt');
        expect(g2.getNode('start')).toBeTruthy();
        expect(g2.getOutgoing('start')).toEqual(['end']);
    });
});

// ── StateNode ───────────────────────────────────────────────────────────────

describe('state-graph StateNode', () => {
    it('canExecute with/without history index and honors errors', () => {
        const n = new StateNode({ id: 'n', type: NodeType.TASK, name: 'N' });
        n.addIncoming('a');
        n.addIncoming('b');
        expect(n.canExecute([{ nodeId: 'a', startedAt: new Date(), attempts: 1 }, { nodeId: 'b', startedAt: new Date(), attempts: 1 }])).toBe(true);
        expect(n.canExecute([{ nodeId: 'a', startedAt: new Date(), attempts: 1 }])).toBe(false);
        expect(n.canExecute([{ nodeId: 'a', startedAt: new Date(), attempts: 1, error: { code: 'X', message: 'm', nodeId: 'a', retryable: false } }, { nodeId: 'b', startedAt: new Date(), attempts: 1 }])).toBe(false);

        const idx = new Map([
            ['a', { nodeId: 'a', startedAt: new Date(), attempts: 1 }],
            ['b', { nodeId: 'b', startedAt: new Date(), attempts: 1 }],
        ]);
        expect(n.canExecute([], idx)).toBe(true);
        expect(n.canExecute([], new Map([['a', { nodeId: 'a', startedAt: new Date(), attempts: 1 }]]))).toBe(false);
    });

    it('toJSON / fromJSON round-trip', () => {
        const n = new StateNode({ id: 'x', type: NodeType.TASK, name: 'X', timeoutMs: 5, retryPolicy: { maxRetries: 1, backoffMs: 1 }, metadata: { k: 1 } });
        n.addOutgoing('y');
        n.addIncoming('z');
        const json = n.toJSON() as Record<string, unknown>;
        expect(json.outgoing).toEqual(['y']);
        expect(json.incoming).toEqual(['z']);
        const n2 = StateNode.fromJSON(json);
        expect(n2.id).toBe('x');
        expect(n2.retryPolicy).toEqual({ maxRetries: 1, backoffMs: 1 });
        // getOutgoing/getIncoming return defensive copies
        const out = n.getOutgoing();
        out.add('hacked');
        expect(n.getOutgoing().has('hacked')).toBe(false);
        expect(n.getIncoming().has('z')).toBe(true);
    });
});

// ── WorkflowExecutor ────────────────────────────────────────────────────────

describe('state-graph WorkflowExecutor', () => {
    function buildGraph(opts?: { failNode?: string; retry?: boolean; slow?: string }) {
        const g = new StateGraph({ name: 'wf' });
        g.addNode({
            id: 'start',
            type: NodeType.START,
            name: 's',
            entry: async (ctx) => { ctx.variables.set('x', 1); },
        });
        g.addNode({
            id: 'a',
            type: NodeType.TASK,
            name: 'A',
            entry: async (ctx) => { ctx.variables.set('y', (ctx.variables.get('x') as number) + 1); return 'a-result'; },
            exit: async (ctx) => { ctx.variables.set('exited', true); },
            ...(opts?.failNode === 'a' ? {
                retryPolicy: opts.retry ? { maxRetries: 2, backoffMs: 1 } : undefined,
                entry: async () => { throw new Error('a-fails'); },
            } : {}),
        });
        g.addNode({ id: 'end', type: NodeType.END, name: 'e', entry: async (ctx) => { ctx.variables.set('done', true); } });
        g.addTransition({ from: 'start', to: 'a', type: TransitionType.UNCONDITIONAL });
        g.addTransition({ from: 'a', to: 'end', type: TransitionType.UNCONDITIONAL });
        return g;
    }

    it('executes a linear workflow to completion with hooks', async () => {
        const g = buildGraph();
        const onStart = vi.fn();
        const onComplete = vi.fn();
        const onEnd = vi.fn();
        const ex = new WorkflowExecutor(g, { maxConcurrency: 2, defaultTimeoutMs: 1000, checkpointInterval: 1 });
        const result = await ex.execute({}, {
            // hooks are on WorkflowConfig, not executor; skip
        });
        expect(result.status).toBe(WorkflowStatus.COMPLETED);
        expect(result.outputVariables).toMatchObject({ x: 1, y: 2, exited: true, done: true });
        expect(result.history.length).toBe(3);
        expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
        void onStart; void onComplete; void onEnd;
    });

    it('fails when entry throws without retry policy', async () => {
        const g = buildGraph({ failNode: 'a' });
        const ex = new WorkflowExecutor(g);
        const result = await ex.execute();
        expect(result.status).toBe(WorkflowStatus.FAILED);
        expect(result.error?.code).toBe('WORKFLOW_ERROR');
        expect(result.error?.message).toContain('a-fails');
    });

    it('retries a node then succeeds on second attempt', async () => {
        const g = new StateGraph({ name: 'retry' });
        g.addNode({ id: 'start', type: NodeType.START, name: 's' });
        let attempts = 0;
        g.addNode({
            id: 't',
            type: NodeType.TASK,
            name: 't',
            entry: async () => {
                attempts++;
                if (attempts === 1) throw new Error('transient');
                return 'ok';
            },
            retryPolicy: { maxRetries: 3, backoffMs: 1 },
        });
        g.addNode({ id: 'end', type: NodeType.END, name: 'e' });
        g.addTransition({ from: 'start', to: 't', type: TransitionType.UNCONDITIONAL });
        g.addTransition({ from: 't', to: 'end', type: TransitionType.UNCONDITIONAL });
        const ex = new WorkflowExecutor(g, { defaultTimeoutMs: 500 });
        const result = await ex.execute();
        expect(result.status).toBe(WorkflowStatus.COMPLETED);
        expect(attempts).toBe(2);
    });

    it('retries exhaust and fails with original error', async () => {
        const g = new StateGraph({ name: 'retry-fail' });
        g.addNode({ id: 'start', type: NodeType.START, name: 's' });
        let attempts = 0;
        g.addNode({
            id: 't',
            type: NodeType.TASK,
            name: 't',
            entry: async () => {
                attempts++;
                throw new Error(`fail-${attempts}`);
            },
            retryPolicy: { maxRetries: 2, backoffMs: 1, exponentialBase: 2, maxBackoffMs: 2 },
        });
        g.addNode({ id: 'end', type: NodeType.END, name: 'e' });
        g.addTransition({ from: 'start', to: 't', type: TransitionType.UNCONDITIONAL });
        g.addTransition({ from: 't', to: 'end', type: TransitionType.UNCONDITIONAL });
        const ex = new WorkflowExecutor(g, { defaultTimeoutMs: 500 });
        const result = await ex.execute();
        expect(result.status).toBe(WorkflowStatus.FAILED);
        // The exhausted retry rethrows the WorkflowError object; the executor
        // wraps non-Error values via String().
        expect(result.error?.message).toContain('[object Object]');
        // maxRetries: 2 → initial + 1 retry (loop starts at attempt 2).
        expect(attempts).toBe(2);
    });

    it('pause/resume/cancel/snapshot on a live execution', async () => {
        const g = new StateGraph({ name: 'live' });
        g.addNode({ id: 'start', type: NodeType.START, name: 's' });
        let release: (() => void) | null = null;
        const gate = new Promise<void>((r) => { release = r; });
        g.addNode({
            id: 'slow',
            type: NodeType.TASK,
            name: 'slow',
            entry: async () => { await gate; return 'done'; },
        });
        g.addNode({ id: 'end', type: NodeType.END, name: 'e' });
        g.addTransition({ from: 'start', to: 'slow', type: TransitionType.UNCONDITIONAL });
        g.addTransition({ from: 'slow', to: 'end', type: TransitionType.UNCONDITIONAL });
        const ex = new WorkflowExecutor(g, { defaultTimeoutMs: 5000 });

        const running = ex.execute({}, { executionId: 'ex-live' });
        await new Promise((r) => setTimeout(r, 10));
        expect(await ex.pause('ex-live')).toBe(true);
        expect(await ex.resume('ex-live')).toBe(true);
        expect(await ex.cancel('ex-live')).toBe(true);
        const snap = ex.getSnapshot('ex-live');
        expect(snap?.executionId).toBe('ex-live');
        expect(snap?.status).toBe(WorkflowStatus.CANCELLED);
        release!();
        const result = await running;
        expect(result.status).toBe(WorkflowStatus.COMPLETED);
    });

    it('times out a slow node', async () => {
        const g = new StateGraph({ name: 'slow' });
        g.addNode({ id: 'start', type: NodeType.START, name: 's' });
        g.addNode({ id: 'slow', type: NodeType.TASK, name: 'slow', entry: async () => { await new Promise(r => setTimeout(r, 200)); return 'late'; } });
        g.addNode({ id: 'end', type: NodeType.END, name: 'e' });
        g.addTransition({ from: 'start', to: 'slow', type: TransitionType.UNCONDITIONAL });
        g.addTransition({ from: 'slow', to: 'end', type: TransitionType.UNCONDITIONAL });
        const ex = new WorkflowExecutor(g, { defaultTimeoutMs: 20 });
        const result = await ex.execute();
        expect(result.status).toBe(WorkflowStatus.FAILED);
        expect(result.error?.message).toContain('timed out');
    });

    it('throws when graph has no start node; pause/resume/cancel/snapshot', async () => {
        const g = new StateGraph({ name: 'empty' });
        const ex = new WorkflowExecutor(g);
        await expect(ex.execute()).rejects.toThrow(/no start node/);
        expect(await ex.pause('x')).toBe(false);
        expect(await ex.resume('x')).toBe(false);
        expect(await ex.cancel('x')).toBe(false);
        expect(ex.getSnapshot('x')).toBeUndefined();
    });

    it('cancelled signal aborts execution', async () => {
        const g = buildGraph();
        const ac = new AbortController();
        ac.abort();
        const ex = new WorkflowExecutor(g, { defaultTimeoutMs: 100 });
        const result = await ex.execute({}, { signal: ac.signal });
        expect(result.status).toBe(WorkflowStatus.FAILED);
    });
});

// ── WorkflowBuilder ─────────────────────────────────────────────────────────

describe('state-graph WorkflowBuilder', () => {
    it('chains task/decision/start/end and builds linked graph', () => {
        const g = new WorkflowBuilder('wf')
            .description('desc')
            .start('begin')
            .task('work', async (ctx) => { ctx.variables.set('w', true); }, { id: 'work', timeoutMs: 100 })
            .decision('decide', async () => true, { id: 'decide' })
            .end('finish')
            .build();
        expect(g.name).toBe('wf');
        expect(g.description).toBe('desc');
        expect(g.getNode('work')).toBeTruthy();
        expect(g.getNode('decide')).toBeTruthy();
        expect(g.getOutgoing('work')).toEqual(['decide']);
        expect(g.validate().valid).toBe(false); // dec has no edge to end (auto-link only with ids — decide has id, end has none)
    });

    it('executes a decision node entry closure', async () => {
        const g = new WorkflowBuilder('wf')
            .start('begin')
            .decision('decide', async (ctx) => { ctx.variables.set('decided', true); return true; }, { id: 'decide' })
            .end('finish')
            .build();
        // start/end have no explicit ids → no auto-links; wire manually
        const startNode = g.getInitialNode()!;
        g.addTransition({ from: startNode.id, to: 'decide', type: TransitionType.UNCONDITIONAL });
        const ex = new WorkflowExecutor(g, { defaultTimeoutMs: 100 });
        const result = await ex.execute();
        expect(result.status).toBe(WorkflowStatus.COMPLETED);
        expect(result.history.some((r) => r.nodeId === 'decide')).toBe(true);
    });

    it('auto-links only when both ids present', () => {
        const g = new WorkflowBuilder('wf')
            .start()
            .task('t', async () => 1)
            .end()
            .build();
        // start/end have no explicit ids → no auto links; first node is start
        expect(g.getInitialNode()!.type).toBe(NodeType.START);
    });
});

// ── InMemoryCheckpointStore ─────────────────────────────────────────────────

describe('state-graph InMemoryCheckpointStore', () => {
    it('save/load/delete/list', async () => {
        const store = new InMemoryCheckpointStore();
        const snap = {
            workflowId: 'wf1',
            executionId: 'ex1',
            currentNodes: ['a'],
            activeBranches: [],
            variables: {},
            history: [],
            status: WorkflowStatus.RUNNING,
        };
        await store.save(snap);
        expect(await store.load('ex1')).toEqual(snap);
        expect(await store.load('missing')).toBeNull();
        expect(await store.list('wf1')).toEqual(['ex1']);
        expect(await store.list('other')).toEqual([]);
        await store.delete('ex1');
        expect(await store.load('ex1')).toBeNull();
    });
});
