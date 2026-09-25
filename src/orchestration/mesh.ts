/**
 * Orchestration Mesh — compile team patterns to replayable DAGs.
 *
 * Team modes (supervisor, pipeline, consensus, router, swarm) become
 * GraphBuilder definitions, so routing, fan-out, voting, and escalation
 * are auditable events with deterministic replay instead of ad-hoc code.
 *
 * Every compiled mesh also carries a `graphology` DirectedGraph mirror of
 * its node topology for inspection (order/size/neighbors) and
 * cycle validation via {@link topologicalOrder}.
 */

import { DirectedGraph } from 'graphology';
import { GraphBuilder } from '../graph/builder.js';
import type { GraphDef, NodeContext } from '../graph/types.js';
import type { AgentContext, AgentInput, OrchestrableAgent } from './core/types.js';

export type MeshPattern = 'supervisor' | 'pipeline' | 'consensus' | 'router' | 'swarm';

export type MeshConsensusStrategy = 'majority' | 'unanimous' | 'weighted';

export interface MeshCompileOptions {
    readonly name: string;
    readonly pattern: MeshPattern;
    /** Named member agents. Pipeline order follows `order` when provided, else insertion order. */
    readonly agents: Readonly<Record<string, OrchestrableAgent>>;
    readonly description?: string;
    /** Router pattern: pick the target agent name for the current input. */
    readonly route?: (input: string) => Promise<string> | string;
    /** Router fallback when route returns an unknown name. Defaults to first agent. */
    readonly fallback?: string;
    /** Consensus strategy. Default: 'majority'. */
    readonly consensus?: MeshConsensusStrategy;
    /** Per-agent weights for 'weighted' consensus. */
    readonly weights?: Readonly<Record<string, number>>;
    /** Minimum agreeing agents for consensus. Default: ceil(n/2). */
    readonly quorum?: number;
    /** Pipeline order. Defaults to Object.keys(agents). */
    readonly order?: readonly string[];
    /** Max concurrent branches for fan-out patterns. */
    readonly maxConcurrency?: number;
    /** Default per-node timeout. */
    readonly timeoutMs?: number;
}

export interface MeshCompiled {
    readonly graph: GraphDef;
    /** Graphology mirror of the mesh topology (node names + directed edges). */
    readonly topology: DirectedGraph;
    readonly pattern: MeshPattern;
    readonly agentNames: readonly string[];
}

function agentNamesOf(agents: Readonly<Record<string, OrchestrableAgent>>): string[] {
    return Object.keys(agents);
}

function assertUsableAgents(names: string[], agents: Readonly<Record<string, OrchestrableAgent>>): void {
    if (names.length === 0) throw new Error('compileMeshToGraph: at least one agent is required');
    for (const name of names) {
        if (!name || name.trim().length === 0) throw new Error('compileMeshToGraph: agent names must be non-empty');
        if (!agents[name]) throw new Error(`compileMeshToGraph: unknown agent "${name}"`);
    }
}

function minimalContext(agent: OrchestrableAgent): AgentContext {
    return { agentId: agent.id, metadata: {} };
}

function inputOf(ctx: NodeContext<unknown>): string {
    const v = ctx.getVariable<string>('input') ?? (ctx.input as unknown);
    return typeof v === 'string' ? v : JSON.stringify(v ?? '');
}

async function runAgent(agent: OrchestrableAgent, prompt: string): Promise<unknown> {
    const input: AgentInput = { prompt };
    const output = await agent.run(input, minimalContext(agent));
    return output.result ?? null;
}

function agentNodeName(name: string): string {
    return `agent:${name}`;
}

function textOf(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value ?? '');
    } catch {
        return String(value ?? '');
    }
}

function decideConsensus(
    outputs: Record<string, unknown>,
    strategy: MeshConsensusStrategy,
    weights: Readonly<Record<string, number>>,
    quorum: number,
): { decision: string; confidence: number; quorumMet: boolean; tally: Record<string, number> } {
    const tally: Record<string, number> = {};
    for (const [agentName, output] of Object.entries(outputs)) {
        const key = textOf(output);
        tally[key] = (tally[key] ?? 0) + (strategy === 'weighted' ? (weights[agentName] ?? 1) : 1);
    }
    let decision = '';
    let best = -Infinity;
    let total = 0;
    for (const [key, score] of Object.entries(tally)) {
        total += score;
        if (score > best) {
            best = score;
            decision = key;
        }
    }
    if (strategy === 'unanimous') {
        const met = Object.keys(tally).length === 1 && total > 0;
        return { decision, confidence: met ? 1 : best / Math.max(total, 1), quorumMet: met && best >= quorum, tally };
    }
    return { decision, confidence: total === 0 ? 0 : best / total, quorumMet: best >= quorum, tally };
}

/**
 * Topological ordering of a mesh topology mirror.
 * Throws when the topology contains a cycle.
 */
export function topologicalOrder(topology: DirectedGraph): string[] {
    const inDegree = new Map<string, number>();
    topology.forEachNode((node) => {
        inDegree.set(node, topology.inDegree(node));
    });
    const queue: string[] = [];
    for (const [node, degree] of inDegree) {
        if (degree === 0) queue.push(node);
    }
    const order: string[] = [];
    let head = 0;
    while (head < queue.length) {
        const current = queue[head++]!;
        order.push(current);
        for (const next of topology.outNeighbors(current)) {
            const remaining = (inDegree.get(next) ?? 0) - 1;
            inDegree.set(next, remaining);
            if (remaining === 0) queue.push(next);
        }
    }
    if (order.length !== topology.order) {
        throw new Error('compileMeshToGraph: mesh topology must be acyclic');
    }
    return order;
}

export function compileMeshToGraph(options: MeshCompileOptions): MeshCompiled {
    const names = agentNamesOf(options.agents);
    assertUsableAgents(names, options.agents);

    const builder = new GraphBuilder(options.name, { description: options.description ?? `Mesh ${options.pattern}` });
    if (options.maxConcurrency !== undefined) builder.maxConcurrency(options.maxConcurrency);
    if (options.timeoutMs !== undefined) builder.defaultTimeout({ timeoutMs: options.timeoutMs, onTimeout: 'fail' });
    builder.meta({ meshPattern: options.pattern, agentNames: names });

    const topology = new DirectedGraph();
    const trackNode = (name: string, attributes?: Record<string, unknown>): void => {
        topology.addNode(name, attributes ?? {});
    };
    const trackEdge = (from: string, to: string, attributes?: Record<string, unknown>): void => {
        topology.addDirectedEdge(from, to, attributes ?? {});
    };

    builder.addNode('input', {
        kind: 'task',
        description: 'Mesh entry',
        execute: async (ctx: NodeContext<unknown>) => inputOf(ctx),
    });
    trackNode('input', { kind: 'task' });

    const addAgentTask = (name: string, agent: OrchestrableAgent, readFrom?: string): void => {
        builder.addNode(agentNodeName(name), {
            kind: 'task',
            description: `Mesh member ${name}`,
            execute: async (ctx: NodeContext<unknown>) => {
                const prompt =
                    readFrom !== undefined
                        ? String(ctx.getNodeOutput<unknown>(readFrom) ?? inputOf(ctx))
                        : inputOf(ctx);
                return runAgent(agent, prompt);
            },
        });
        trackNode(agentNodeName(name), { kind: 'task', agent: name });
    };
    const link = (from: string, to: string): void => {
        builder.addEdge(from, to);
        trackEdge(from, to);
    };

    switch (options.pattern) {
        case 'pipeline': {
            const order = options.order !== undefined ? [...options.order] : names;
            if (order.length === 0) throw new Error('compileMeshToGraph: pipeline order must not be empty');
            assertUsableAgents(order, options.agents);
            if (new Set(order).size !== order.length) {
                throw new Error('compileMeshToGraph: pipeline order must not repeat agents');
            }
            let prev = 'input';
            for (const name of order) {
                addAgentTask(name, options.agents[name]!, prev);
                link(prev, agentNodeName(name));
                prev = agentNodeName(name);
            }
            break;
        }
        case 'supervisor':
        case 'swarm': {
            for (const name of names) {
                addAgentTask(name, options.agents[name]!);
            }
            builder.fanOut('input', names.map(agentNodeName));
            for (const name of names) trackEdge('input', agentNodeName(name));
            builder.addNode('join', {
                kind: 'join',
                strategy: 'all',
                description: `Mesh ${options.pattern} join`,
                merge: async (results) => {
                    const combined: Record<string, unknown> = {};
                    for (const name of names) combined[name] = results[agentNodeName(name)];
                    return { combined, pattern: options.pattern };
                },
            });
            trackNode('join', { kind: 'join' });
            builder.fanIn(names.map(agentNodeName), 'join');
            for (const name of names) trackEdge(agentNodeName(name), 'join');
            break;
        }
        case 'consensus': {
            const strategy = options.consensus ?? 'majority';
            const weights = options.weights ?? {};
            for (const [agentName, w] of Object.entries(weights)) {
                if (!options.agents[agentName]) throw new Error(`compileMeshToGraph: weight for unknown agent "${agentName}"`);
                if (!Number.isFinite(w) || w <= 0) throw new Error(`compileMeshToGraph: weight for "${agentName}" must be positive`);
            }
            const quorum = options.quorum ?? Math.ceil(names.length / 2);
            if (!Number.isInteger(quorum) || quorum < 1 || quorum > names.length) {
                throw new Error('compileMeshToGraph: quorum must be an integer within [1, agentCount]');
            }
            for (const name of names) {
                addAgentTask(name, options.agents[name]!);
            }
            builder.fanOut('input', names.map(agentNodeName));
            for (const name of names) trackEdge('input', agentNodeName(name));
            builder.addNode('join', {
                kind: 'join',
                strategy: 'all',
                description: 'Mesh consensus join',
                merge: async (results) => {
                    const outputs: Record<string, unknown> = {};
                    for (const name of names) outputs[name] = results[agentNodeName(name)];
                    return { ...decideConsensus(outputs, strategy, weights, quorum), strategy, votes: outputs };
                },
            });
            trackNode('join', { kind: 'join' });
            builder.fanIn(names.map(agentNodeName), 'join');
            for (const name of names) trackEdge(agentNodeName(name), 'join');
            break;
        }
        case 'router': {
            if (!options.route) throw new Error('compileMeshToGraph: router pattern requires a route function');
            const fallback = options.fallback ?? names[0]!;
            if (!options.agents[fallback]) throw new Error(`compileMeshToGraph: unknown fallback agent "${fallback}"`);
            for (const name of names) {
                addAgentTask(name, options.agents[name]!);
            }
            builder.addNode('route', {
                kind: 'router',
                description: 'Mesh router',
                route: async (ctx: NodeContext<unknown>) => {
                    const picked = await options.route!(inputOf(ctx));
                    return options.agents[picked] ? picked : fallback;
                },
            });
            trackNode('route', { kind: 'router' });
            link('input', 'route');
            // Router emits the picked agent name; conditional edges match on that label.
            // Branches are terminal: the engine marks non-taken branches skipped, so a
            // shared downstream join would be marked skipped too. Read the taken
            // agent's output via results['route'] + results['agent:<picked>'].
            // No `default` edge: the route function already resolves unknowns to the
            // fallback, and a duplicate edge to the fallback would make the router
            // skip its own taken target.
            builder.addConditionalEdges('route', { map: Object.fromEntries(names.map((n) => [n, agentNodeName(n)])) });
            for (const name of names) trackEdge('route', agentNodeName(name), { label: name });
            break;
        }
    }

    // Graphology-backed validation: the mirror must stay acyclic.
    topologicalOrder(topology);

    return { graph: builder.build(), topology, pattern: options.pattern, agentNames: names };
}
