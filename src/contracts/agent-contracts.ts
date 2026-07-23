/**
 * Agent execution contracts — zero-dependency definitions.
 *
 * These types are the canonical contracts layer. @personaforge/core re-exports
 * the same shapes for consumers that prefer importing from core directly.
 */

// ── Primitive branded types ──────────────────────────────────────────────────

/** A string identifier for any framework entity (agent, session, tool, etc.). */
export type EntityId = string;

/** Generate a unique entity ID. */
export function generateEntityId(): EntityId {
    return crypto.randomUUID();
}

// ── Agent state machine ──────────────────────────────────────────────────────

export enum AgentState {
    IDLE = 'idle',
    PLANNING = 'planning',
    EXECUTING = 'executing',
    PAUSED = 'paused',
    COMPLETED = 'completed',
    FAILED = 'failed',
    CANCELLED = 'cancelled',
}

// ── Core agent interfaces ────────────────────────────────────────────────────

/** Minimal agent identity shared across all implementations. */
export interface AgentIdentity {
    readonly id: EntityId;
    readonly name: string;
    readonly description?: string;
}

/** Input to an agent execution (contracts-level, framework-agnostic). */
export interface AgentInput {
    readonly prompt: string;
    readonly context?: Record<string, unknown>;
}

/** Timing / token metadata attached to an agent execution. */
export interface ExecutionMetadata {
    readonly startTime: Date;
    readonly endTime?: Date;
    readonly durationMs?: number;
    readonly iterations: number;
    readonly tokensUsed?: number;
    readonly cost?: number;
}

/** Output from an agent execution (contracts-level). */
export interface AgentOutput {
    readonly result: unknown;
    readonly state: AgentState;
    readonly metadata: ExecutionMetadata;
}

/**
 * Execution context provided to an agent.
 * Uses `unknown` for MemoryStore / ToolRegistry / Planner to keep contracts
 * dependency-free — orchestration packages narrow these with their own types.
 */
export interface AgentContext {
    readonly agentId: EntityId;
    readonly memory?: unknown;
    readonly tools?: unknown;
    readonly planner?: unknown;
    readonly metadata: Record<string, unknown>;
}

/** Hook for agent lifecycle events (framework-level). */
export interface AgentHooks {
    beforeExecution?: (input: AgentInput, ctx: AgentContext) => Promise<void> | void;
    afterExecution?: (output: AgentOutput, ctx: AgentContext) => Promise<void> | void;
    onError?: (error: Error, ctx: AgentContext) => Promise<void> | void;
    onStateChange?: (oldState: AgentState, newState: AgentState, ctx: AgentContext) => Promise<void> | void;
}

/** Agent configuration for construction. */
export interface AgentConfig {
    readonly id?: EntityId;
    readonly name: string;
    readonly description?: string;
    readonly persona?: string;
    readonly maxIterations?: number;
    readonly timeoutMs?: number;
    readonly debug?: boolean;
}

// ── Plugin contracts ─────────────────────────────────────────────────────────

/** Logger interface available to plugins. */
export interface Logger {
    debug(msg: string, meta?: Record<string, unknown>): void;
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
}

/** Tool middleware signature (function-based — wraps a single call). */
export type ToolMiddleware = (
    name: string,
    args: Record<string, unknown>,
    next: (name: string, args: Record<string, unknown>) => Promise<unknown>,
) => Promise<unknown>;

/** Tool reference passed to object-based middleware hooks. */
export interface ToolRef {
    readonly name: string;
    readonly description: string;
}

/** Tool execution result passed to object-based middleware hooks. */
export interface ToolExecutionResult {
    readonly success: boolean;
    readonly executionTimeMs: number;
    readonly output?: unknown;
    readonly error?: string;
}

/**
 * Object-based tool middleware — lifecycle hooks for tool execution.
 * Easier to use than the function-based ToolMiddleware for logging / metrics.
 */
export interface ToolMiddlewareObject {
    beforeExecute?(tool: ToolRef, params: Record<string, unknown>): void | Promise<void>;
    afterExecute?(tool: ToolRef, result: ToolExecutionResult, ctx: { agentId?: string }): void | Promise<void>;
    onError?(tool: ToolRef, error: Error, ctx: { agentId?: string }): void | Promise<void>;
}

/** Context available to plugins during execution. */
export interface PluginContext {
    readonly agentId?: string;
    readonly sessionId?: string;
    readonly logger: Logger;
    readonly metadata: Record<string, unknown>;
}

/**
 * Plugin interface for cross-cutting concerns.
 *
 * Plugins hook into the agent lifecycle, tool execution, and observability.
 * Register once via PluginRegistry; they apply to all agents.
 */
export interface Plugin {
    readonly id: string;
    readonly name: string;
    readonly version?: string;

    /** Called once when the plugin is registered. */
    onRegister?(context: PluginContext): Promise<void> | void;
    /** Called before each agent run — may transform input. */
    beforeRun?(input: AgentInput, context: PluginContext): Promise<AgentInput> | AgentInput;
    /** Called after each agent run — may transform output. */
    afterRun?(output: AgentOutput, context: PluginContext): Promise<AgentOutput> | AgentOutput;
    /** Optional tool middleware injected by this plugin. Can be function or object form. */
    toolMiddleware?: ToolMiddleware | ToolMiddlewareObject;
    /** Called on agent errors. */
    onError?(error: Error, context: PluginContext): Promise<void> | void;
}

/** Generic metrics collector interface for telemetry plugins. */
export interface MetricsCollector {
    counter(name: string, value: number, labels?: Record<string, string>): void;
    histogram(name: string, value: number, labels?: Record<string, string>): void;
    gauge?(name: string, value: number, labels?: Record<string, string>): void;
}
