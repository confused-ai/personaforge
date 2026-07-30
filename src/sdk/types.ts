import type { SchemaInput } from '../validation/index.js';
import type { MemoryStore } from '../memory/index.js';
import type { Tool } from '../tools/index.js';
import type { Planner } from '../planner/index.js';

/**
 * High-level agent definition: typed I/O, optional handler, pluggable memory/planner.
 */
export interface AgentDefinitionConfig<TInput, TOutput> {
    name: string;
    description?: string;
    inputSchema: SchemaInput<unknown, TInput>;
    outputSchema: SchemaInput<unknown, TOutput>;
    /**
     * Production handler. If omitted, `run()` validates and returns the input as the output (schema permitting).
     */
    handler?: (input: TInput, context?: Record<string, unknown>) => Promise<TOutput> | TOutput;
    tools?: Tool[];
    memory?: MemoryStore;
    planner?: Planner;
    maxIterations?: number;
    timeoutMs?: number;
}

/**
 * One invocation of a {@link import('./defined-agent.js').DefinedAgent}.
 */
export interface AgentRunConfig<TInput> {
    input: TInput;
    context?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

export interface WorkflowResult {
    results: Record<string, unknown>;
}
