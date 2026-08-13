/**
 * @personaforge/core — public types.
 *
 * Re-exports the subset of types that external consumers need.
 * Internal runner types live in src/runner/types.ts.
 */

// ── Primitive branded types ─────────────────────────────────────────────────

/** A string identifier for any framework entity (agent, session, tool, etc.). */
export type EntityId = string;

/** Generate a unique entity ID. */
export function generateEntityId(): EntityId {
    return crypto.randomUUID();
}

// ── LLM message types ───────────────────────────────────────────────────────

export interface TextContent {
    type: 'text';
    text: string;
}

export interface ImageContent {
    type: 'image_url';
    image_url: { url: string; detail?: 'low' | 'high' | 'auto' };
}

/** Allowed multimodal content part in a Message. */
export type MessageContent = string | (TextContent | ImageContent | {
    type: 'file'; file: { url: string; filename?: string };
} | {
    type: 'audio'; audio: { url: string };
} | {
    type: 'video'; video: { url: string };
})[];

/**
 * OpenAI-style tool call inside an assistant Message (for conversation history).
 * Different from ToolCall (flat) which is what LLMProvider.generateText returns.
 */
export interface OpenAIToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

/** @deprecated Use OpenAIToolCall for Message.tool_calls or ToolCall (flat) from runner/types */
export type ToolCall = OpenAIToolCall;

export interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: MessageContent;
    tool_call_id?: string;
    tool_calls?: OpenAIToolCall[];
    name?: string;
}

// ── Run config & result ──────────────────────────────────────────────────────

export interface AgentRunOptions {
    /** Tenant owning this run — used for isolation, quotas, and billing */
    tenantId?: string;
    /** Distributed tracing ID — correlates this run across components */
    traceId?: string;
    /** Resume an existing session by ID */
    sessionId?: string;
    /** Override or inject conversation history */
    messages?: Message[];
    /** Streaming callback — called with each text delta */
    onChunk?: (chunk: string) => void;
    /** Called when a tool is about to be executed */
    onToolCall?: (name: string, input: Record<string, unknown>) => void;
    /** Called when a tool finishes */
    onToolResult?: (name: string, output: unknown) => void;
    /** Called at the start of each reasoning step */
    onStep?: (stepNumber: number) => void;
    /** Lifecycle hooks for this specific run (merged with agent-level hooks) */
    hooks?: AgentLifecycleHooks;
    /** Idempotency / tracing ID */
    runId?: string;
    /** User ID for per-user budget tracking */
    userId?: string;
}

export interface AgentRunResult {
    /** Final assistant text */
    readonly text: string;
    /** The response as a markdown artifact */
    readonly markdown: {
        readonly name: string;
        readonly content: string;
        readonly mimeType: 'text/markdown';
        readonly type: 'markdown';
    };
    /** Structured output when `responseModel` was provided */
    readonly structuredOutput?: unknown;
    /** Full conversation messages */
    readonly messages: Message[];
    /** Number of reasoning steps taken */
    readonly steps: number;
    readonly finishReason: 'stop' | 'max_steps' | 'timeout' | 'error' | 'human_rejected' | 'aborted';
    readonly usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    /** Estimated USD cost of the run (from provider pricing tables) */
    readonly costUsd?: number;
    /** Model used for the run */
    readonly model?: string;
    /** Structured error code if the run failed */
    readonly errorCode?: string;
    readonly runId?: string;
}

// ── Lifecycle hooks ──────────────────────────────────────────────────────────

export interface AgentLifecycleHooks {
    beforeRun?: (prompt: string, config: unknown) => Promise<string> | string;
    afterRun?: (result: AgentRunResult) => Promise<AgentRunResult> | AgentRunResult;
    beforeStep?: (step: number, messages: Message[]) => Promise<Message[]> | Message[];
    afterStep?: (step: number, messages: Message[], text: string) => Promise<void> | void;
    beforeToolCall?: (
        name: string,
        args: Record<string, unknown>,
        step: number,
    ) => Promise<Record<string, unknown>> | Record<string, unknown>;
    afterToolCall?: (
        name: string,
        result: unknown,
        args: Record<string, unknown>,
        step: number,
    ) => Promise<unknown>;
    buildSystemPrompt?: (instructions: string, ragContext?: string) => Promise<string> | string;
    onError?: (error: Error, step: number) => Promise<void> | void;
}

// ── Typed event stream ───────────────────────────────────────────────────────

/**
 * Typed event emitted by `agent.streamEvents()`.
 *
 * Discriminated union — switch on `type` to access the right fields.
 *
 * @example
 * ```ts
 * for await (const event of agent.streamEvents('Summarise this document')) {
 *   if (event.type === 'text-delta')  process.stdout.write(event.delta ?? '');
 *   if (event.type === 'tool-call')   console.log('calling', event.tool?.name);
 *   if (event.type === 'run-finish')  console.log('done in', event.run?.steps, 'steps');
 * }
 * ```
 */
export type StreamChunk =
    | { type: 'text-delta';   delta: string }
    | { type: 'tool-call';    tool: { name: string; input: unknown } }
    | { type: 'tool-result';  tool: { name: string; input: unknown; output: unknown } }
    | { type: 'step-finish';  stepNumber: number }
    | { type: 'run-finish';   run: AgentRunResult }
    | { type: 'error';        error: Error };

// ── Multi-modal ──────────────────────────────────────────────────────────────

export interface MultiModalInput {
    text: string;
    images?: Array<{ url: string; detail?: 'low' | 'high' | 'auto' }>;
}

// ── Agent execution contracts ────────────────────────────────────────────────

/** Agent execution state machine. */
export enum AgentState {
    IDLE = 'idle',
    PLANNING = 'planning',
    EXECUTING = 'executing',
    PAUSED = 'paused',
    COMPLETED = 'completed',
    FAILED = 'failed',
    CANCELLED = 'cancelled',
}

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
 * Uses `unknown` for MemoryStore / ToolRegistry / Planner to keep core
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

// ── Agent interface ──────────────────────────────────────────────────────────

export interface Agent {
    /** Unique agent identifier. */
    readonly id: EntityId;
    name: string;
    instructions: string;
    run(prompt: string | MultiModalInput, options?: AgentRunOptions): Promise<AgentRunResult>;
    stream(prompt: string | MultiModalInput, options?: Omit<AgentRunOptions, 'onChunk'>): AsyncIterable<string>;
    streamEvents(prompt: string | MultiModalInput, options?: Omit<AgentRunOptions, 'onChunk'>): AsyncIterable<StreamChunk>;
    createSession(userId?: string): Promise<string>;
    getSessionMessages(sessionId: string): Promise<Message[]>;
    /**
     * Resume an existing session — returns a bound handle where every `run`,
     * `stream`, and `streamEvents` call automatically uses the given session.
     */
    resume?(sessionId: string): {
        run(prompt: string | MultiModalInput, options?: Omit<AgentRunOptions, 'sessionId'>): Promise<AgentRunResult>;
        stream(prompt: string | MultiModalInput, options?: Omit<AgentRunOptions, 'sessionId' | 'onChunk'>): AsyncIterable<string>;
        streamEvents(prompt: string | MultiModalInput, options?: Omit<AgentRunOptions, 'sessionId' | 'onChunk'>): AsyncIterable<StreamChunk>;
    };
}
