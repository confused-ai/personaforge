import { describe, it, expect } from 'vitest';

import { ExecutionStatus } from '@personaforge/graph';
import { DAGEngine } from '@personaforge/graph';
import { AgentState } from '../src/core/index.js';
import { createRunnableAgent } from '../src/orchestration/core/agent-adapter.js';
import type { OrchestrableAgent } from '../src/orchestration/core/types.js';
import { compileMeshToGraph, topologicalOrder } from '../src/orchestration/mesh.js';

function stubAgent(name: string, reply: string, seen: string[] = []): OrchestrableAgent {
    return createRunnableAgent({
        name,
        run: async (input) => {
            seen.push(name);
            return {
                result: `${reply}:${input.prompt}`,
                state: AgentState.COMPLETED,
                metadata: { startTime: new Date(), durationMs: 1, iterations: 1 },
            };
        },
    });
}

describe('orchestration mesh', () => {
    it('compiles pipeline to an ordered chain', async () => {
        const seen: string[] = [];
        const { graph, topology } = compileMeshToGraph({
            name: 'mesh-pipe',
            pattern: 'pipeline',
            agents: { a: stubAgent('a', 'A', seen), b: stubAgent('b', 'B', seen) },
        });

        expect(topology.order).toBe(3);
        expect(topology.size).toBe(2);
        expect(topologicalOrder(topology)[0]).toBe('input');

        const engine = new DAGEngine(graph);
        const result = await engine.execute({ variables: { input: 'go' } });

        expect(result.status).toBe(ExecutionStatus.COMPLETED);
        expect(seen).toEqual(['a', 'b']);
        expect(result.state.results['agent:b']).toContain('B:');
    });

    it('fans out supervisor and combines results', async () => {
        const { graph, topology } = compileMeshToGraph({
            name: 'mesh-sup',
            pattern: 'supervisor',
            agents: { a: stubAgent('a', 'A'), b: stubAgent('b', 'B') },
        });

        expect(topology.hasNode('join')).toBe(true);
        expect(topologicalOrder(topology).at(-1)).toBe('join');

        const engine = new DAGEngine(graph);
        const result = await engine.execute({ variables: { input: 'task' } });

        expect(result.status).toBe(ExecutionStatus.COMPLETED);
        const join = result.state.results['join'] as { combined: Record<string, string> };
        expect(Object.keys(join.combined).sort()).toEqual(['a', 'b']);
    });

    it('resolves consensus by majority', async () => {
        const { graph } = compileMeshToGraph({
            name: 'mesh-cons',
            pattern: 'consensus',
            agents: {
                a: stubAgent('a', 'yes'),
                b: stubAgent('b', 'yes'),
                c: stubAgent('c', 'no'),
            },
        });

        const engine = new DAGEngine(graph);
        const result = await engine.execute({ variables: { input: 'same' } });

        expect(result.status).toBe(ExecutionStatus.COMPLETED);
        const join = result.state.results['join'] as { quorumMet: boolean; decision: string };
        expect(join.quorumMet).toBe(true);
        expect(join.decision).toContain('yes');
    });

    it('routes to the picked agent and falls back on unknown', async () => {
        const { graph, topology } = compileMeshToGraph({
            name: 'mesh-route',
            pattern: 'router',
            agents: { a: stubAgent('a', 'A'), b: stubAgent('b', 'B') },
            route: async (input) => (input.includes('b') ? 'b' : 'missing'),
            fallback: 'a',
        });

        // Router branches are terminal (no shared join): the engine marks the
        // non-taken branch skipped, which would poison a shared downstream node.
        expect(topology.hasNode('join')).toBe(false);
        expect(topology.outNeighbors('route').sort()).toEqual(['agent:a', 'agent:b']);

        const engine = new DAGEngine(graph);
        const routed = await engine.execute({ variables: { input: 'use b please' } });
        expect(routed.status).toBe(ExecutionStatus.COMPLETED);
        expect(routed.state.results['route']).toBe('b');
        expect(routed.state.results['agent:b']).toContain('B:');

        const engine2 = new DAGEngine(graph);
        const fellBack = await engine2.execute({ variables: { input: 'unrelated' } });
        expect(fellBack.status).toBe(ExecutionStatus.COMPLETED);
        expect(fellBack.state.results['route']).toBe('a');
        expect(fellBack.state.results['agent:a']).toContain('A:');
    });

    it('rejects invalid mesh configs', () => {
        expect(() => compileMeshToGraph({ name: 'x', pattern: 'pipeline', agents: {} })).toThrow(/at least one agent/);
        expect(() =>
            compileMeshToGraph({ name: 'x', pattern: 'router', agents: { a: stubAgent('a', 'A') } }),
        ).toThrow(/route function/);
        expect(() =>
            compileMeshToGraph({
                name: 'x',
                pattern: 'consensus',
                agents: { a: stubAgent('a', 'A') },
                quorum: 5,
            }),
        ).toThrow(/quorum/);
        expect(() =>
            compileMeshToGraph({
                name: 'x',
                pattern: 'pipeline',
                agents: { a: stubAgent('a', 'A') },
                order: ['a', 'a'],
            }),
        ).toThrow(/repeat/);
    });
});
