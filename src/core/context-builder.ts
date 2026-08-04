/**
 * Agent context builder for fluent context creation
 */

import {
    AgentContext,
    EntityId,
} from './types.js';
import type { MemoryStore } from '../memory/index.js';
import type { ToolRegistry } from '../tools/index.js';
import type { Planner } from '../planner/index.js';
import { InMemoryStore } from '../memory/index.js';
import { ToolRegistryImpl } from '../tools/index.js';

// Cast helpers — AgentContext uses `unknown` to stay dep-free, but callers use typed stores
type TypedAgentContext = Omit<AgentContext, 'memory' | 'tools' | 'planner'> & {
    memory?: MemoryStore;
    tools?: ToolRegistry;
    planner?: Planner;
};

/**
 * Builder for creating AgentContext instances
 */
export class AgentContextBuilder {
    private agentId: EntityId = `agent-${Date.now()}`;
    private memory?: MemoryStore;
    private tools?: ToolRegistry;
    private planner?: Planner;
    private metadata: Record<string, unknown> = {};

    /**
     * Set the agent ID
     */
    withAgentId(agentId: EntityId): this {
        this.agentId = agentId;
        return this;
    }

    /**
     * Set the memory store
     */
    withMemory(memory: MemoryStore): this {
        this.memory = memory;
        return this;
    }

    /**
     * Set the tool registry
     */
    withTools(tools: ToolRegistry): this {
        this.tools = tools;
        return this;
    }

    /**
     * Set the planner
     */
    withPlanner(planner: Planner): this {
        this.planner = planner;
        return this;
    }

    /**
     * Add metadata
     */
    withMetadata(key: string, value: unknown): this {
        this.metadata[key] = value;
        return this;
    }

    /**
     * Add multiple metadata entries
     */
    withMetadataEntries(entries: Record<string, unknown>): this {
        this.metadata = { ...this.metadata, ...entries };
        return this;
    }

    /**
     * Build the AgentContext.
     *
     * Defaults:
     * - memory → InMemoryStore (overridable via `.withMemory()`)
     * - tools  → empty ToolRegistryImpl (overridable via `.withTools()`)
     * - planner → undefined (optional; omit for reactive/agentic agents)
     */
    build(): TypedAgentContext {
        return {
            agentId: this.agentId,
            memory: this.memory ?? new InMemoryStore(),
            tools: this.tools ?? new ToolRegistryImpl(),
            ...(this.planner !== undefined && { planner: this.planner }),
            metadata: { ...this.metadata },
        };
    }

    /**
     * Create a builder from an existing context
     */
    static fromContext(context: AgentContext): AgentContextBuilder {
        const typed = context as TypedAgentContext;
        const builder = new AgentContextBuilder();
        builder.agentId = typed.agentId;
        builder.memory = typed.memory;
        builder.tools = typed.tools;
        builder.planner = typed.planner;
        builder.metadata = { ...typed.metadata };
        return builder;
    }
}