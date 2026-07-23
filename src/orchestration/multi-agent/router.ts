/**
 * Agent Router — Capability-based dynamic agent routing.
 *
 * Routes tasks to the best-fit agent based on capabilities, load, and history.
 *
 * @example
 * ```ts
 * import { createAgentRouter } from 'personaforge/orchestration';
 *
 * const router = createAgentRouter({
 *   agents: {
 *     researcher: { agent: researchAgent, capabilities: ['search', 'analyze', 'summarize'] },
 *     writer:     { agent: writerAgent,    capabilities: ['write', 'edit', 'format'] },
 *     coder:      { agent: coderAgent,     capabilities: ['code', 'debug', 'test'] },
 *   },
 *   strategy: 'capability-match', // or 'round-robin', 'least-loaded'
 * });
 *
 * // Automatically routes to the best agent
 * const result = await router.route('Write a blog post about TypeScript');
 * ```
 */

import type { EntityId } from '../core/types.js';
import type { AgentInput, AgentOutput } from '../../core/index.js';
import type { OrchestrableAgent } from '../core/types.js';
import type { AgentContext } from '../core/types.js';
import { InMemoryStore } from '../../memory/index.js';
import { ToolRegistryImpl } from '../../tools/index.js';

// ── Types ──────────────────────────────────────────────────────────────────

/** Routing strategy. */
export type AgentRoutingStrategy = 'capability-match' | 'round-robin' | 'least-loaded' | 'custom';

/** A routable agent entry. */
export interface RoutableAgent {
    /** The core agent instance. */
    readonly agent: OrchestrableAgent;
    /** Capabilities this agent can handle. */
    readonly capabilities: string[];
    /** Description for LLM-based routing decisions. */
    readonly description?: string;
    /** Max concurrent tasks. Default: 5. */
    readonly maxConcurrency?: number;
}

/** Router configuration. */
export interface AgentRouterConfig {
    /** Named agents with capabilities. */
    readonly agents: Record<string, RoutableAgent>;
    /** Routing strategy. Default: 'capability-match'. */
    readonly strategy?: AgentRoutingStrategy;
    /** Custom routing function (when strategy is 'custom'). */
    readonly customRouter?: (task: string, agents: Record<string, RoutableAgent>) => string | undefined;
    /** Fallback agent name when no match is found. */
    readonly fallback?: string;
}

/** Router result. */
export interface RouteResult {
    readonly agentName: string;
    readonly agentId: EntityId;
    readonly output: AgentOutput;
    readonly routingReason: string;
    readonly executionTimeMs: number;
}

// ── Implementation ─────────────────────────────────────────────────────────

export class AgentRouter {
    private readonly agents: Record<string, RoutableAgent>;
    private readonly strategy: AgentRoutingStrategy;
    private readonly customRouter?: (task: string, agents: Record<string, RoutableAgent>) => string | undefined;
    private readonly fallback?: string;
    private roundRobinIndex = 0;
    private loadMap: Map<string, number> = new Map();
    // Pre-computed to avoid repeated Object.keys() calls and toLowerCase() per route()
    private readonly agentNames: string[];
    private readonly capabilityCache: Map<string, Set<string>>; // name -> lowercase cap set

    constructor(config: AgentRouterConfig) {
        this.agents = config.agents;
        this.strategy = config.strategy ?? 'capability-match';
        this.customRouter = config.customRouter;
        this.fallback = config.fallback;
        this.agentNames = Object.keys(this.agents);

        this.capabilityCache = new Map();
        for (const name of this.agentNames) {
            this.loadMap.set(name, 0);
            this.capabilityCache.set(
                name,
                new Set(this.agents[name]!.capabilities.map(c => c.toLowerCase()))
            );
        }
    }

    /** Route a task to the best-fit agent and execute. */
    async route(prompt: string, context?: Record<string, unknown>): Promise<RouteResult> {
        const agentName = this.selectAgent(prompt);
        if (!agentName) {
            throw new Error(`No suitable agent found for task: "${prompt.slice(0, 100)}..."`);
        }

        const entry = this.agents[agentName]!;
        const start = Date.now();
        this.loadMap.set(agentName, (this.loadMap.get(agentName) ?? 0) + 1);

        try {
            const input: AgentInput = { prompt, context };
            const ctx: AgentContext = {
                agentId: entry.agent.id,
                memory: new InMemoryStore(),
                tools: new ToolRegistryImpl(),
                planner: null as any,
                metadata: context ?? {},
            };

            const output = await entry.agent.run(input, ctx);

            return {
                agentName,
                agentId: entry.agent.id,
                output,
                routingReason: `Strategy: ${this.strategy}, matched capabilities for "${agentName}"`,
                executionTimeMs: Date.now() - start,
            };
        } finally {
            this.loadMap.set(agentName, Math.max(0, (this.loadMap.get(agentName) ?? 1) - 1));
        }
    }

    /** Get the current load distribution. */
    getLoadDistribution(): Record<string, number> {
        return Object.fromEntries(this.loadMap);
    }

    /** List all registered agents and their capabilities. */
    listAgents(): Array<{ name: string; capabilities: string[]; currentLoad: number }> {
        return Object.entries(this.agents).map(([name, entry]) => ({
            name,
            capabilities: entry.capabilities,
            currentLoad: this.loadMap.get(name) ?? 0,
        }));
    }

    private selectAgent(prompt: string): string | undefined {
        switch (this.strategy) {
            case 'capability-match':
                return this.selectByCapability(prompt);
            case 'round-robin':
                return this.selectRoundRobin();
            case 'least-loaded':
                return this.selectLeastLoaded();
            case 'custom':
                return this.customRouter?.(prompt, this.agents) ?? this.fallback;
            default:
                return this.fallback;
        }
    }

    private selectByCapability(prompt: string): string | undefined {
        const promptLower = prompt.toLowerCase();
        let bestMatch: string | undefined;
        let bestScore = 0;

        for (const name of this.agentNames) {
            const entry = this.agents[name]!;
            const caps = this.capabilityCache.get(name)!;
            let score = 0;

            for (const cap of caps) {
                if (promptLower.includes(cap)) score += 2;
            }
            // Also check description
            if (entry.description && promptLower.includes(entry.description.toLowerCase().split(' ')[0]!)) {
                score += 1;
            }

            const maxLoad = entry.maxConcurrency ?? 5;
            const currentLoad = this.loadMap.get(name) ?? 0;
            if (currentLoad >= maxLoad) continue;

            if (score > bestScore) {
                bestScore = score;
                bestMatch = name;
            }
        }

        return bestMatch ?? this.fallback;
    }

    private selectRoundRobin(): string | undefined {
        if (this.agentNames.length === 0) return this.fallback;
        const name = this.agentNames[this.roundRobinIndex % this.agentNames.length];
        this.roundRobinIndex++;
        return name;
    }

    private selectLeastLoaded(): string | undefined {
        let minLoad = Infinity;
        let selected: string | undefined;
        for (const [name, entry] of Object.entries(this.agents)) {
            const load = this.loadMap.get(name) ?? 0;
            const maxLoad = entry.maxConcurrency ?? 5;
            if (load < maxLoad && load < minLoad) {
                minLoad = load;
                selected = name;
            }
        }
        return selected ?? this.fallback;
    }
}

/** Create an agent router. */
export function createAgentRouter(config: AgentRouterConfig): AgentRouter {
    return new AgentRouter(config);
}
