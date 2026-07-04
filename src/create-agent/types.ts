import type { LLMProvider } from '../providers/types.js';
import type { Message } from '../providers/types.js';
import type { MultiModalInput } from '../providers/vision.js';
import type { Tool, ToolRegistry, ToolMiddleware } from '../tools/core/index.js';
import type { LightweightTool } from '../tools/core/index.js';
import type { SessionStore } from '../session/index.js';
import type {
    AdapterBindings,
    AdapterRegistry,
    GuardrailAdapter,
    RagAdapter,
    SessionStoreAdapter,
    MemoryStoreAdapter,
    ToolRegistryAdapter,
    AuthAdapter,
    RateLimitAdapter,
    AuditLogAdapter,
} from '../adapters/index.js';
import type { GuardrailEngine } from '../guardrails/index.js';
import type { UserProfileStore } from '../learning/index.js';
import type { LearningMode } from '../learning/index.js';
import type { MemoryStore } from '../memory/index.js';
import type { RAGEngine } from '../knowledge/index.js';
import type { Storage } from '../storage/index.js';
import type { z } from 'zod';
import type { AgenticRunResult, AgenticLifecycleHooks } from '../agentic/index.js';
import type { Logger } from '../observability/types.js';
import type { MastermindConfig } from '../compression/mastermind/index.js';
import type { EventRecorder } from '../core/runner/types.js';

type AnyLightweightTool = LightweightTool<any, any>;

export interface AgentRunDebugInfo {
    enabled: true;
    historyMessages: number;
    memoryResults: number;
    knowledgeContext: boolean;
    followupsGenerated: number;
    usage?: AgenticRunResult['usage'];
    storageKey?: string;
    /** Mastermind compression stats when context was compressed before the LLM call. */
    compression?: import('../compression/mastermind/index.js').MastermindStats;
}

export interface AgentRunResult extends AgenticRunResult {
    /** Follow-up suggestions generated after the final answer when enabled. */
    readonly followups?: string[];
    /** TypeScript-friendly alias for `followups`. */
    readonly followUpSuggestions?: string[];
    /** Present when debug mode is enabled for the agent or run. */
    readonly debug?: AgentRunDebugInfo;
    /** Storage key used when a generic storage adapter persisted this run. */
    readonly storageKey?: string;
}

export interface AgentContextOptions {
    /** Include prior session messages in the model context. Defaults to legacy session behavior when a session id is used. */
    addHistoryToContext?: boolean;
    /** Include only the most recent N historical user turns/runs. */
    numHistoryRuns?: number;
    /** Include only the most recent N historical messages. Applied after `numHistoryRuns` when both are set. */
    numHistoryMessages?: number;
    /** Let the agent manage long-term memory through automatic `remember` and `recall` tools. */
    enableAgenticMemory?: boolean;
    /** Retrieve relevant memories and add them to the prompt context before a run. */
    addMemoriesToContext?: boolean;
    /** Maximum memories to add to context. Defaults to 5. */
    numMemories?: number;
    /** Retrieve knowledge base context before a run. Defaults to true when a knowledgebase is configured. */
    addKnowledgeToContext?: boolean;
    /** Generate follow-up suggestions after the answer. */
    followUps?: boolean;
    /** Maximum follow-up suggestions to generate. Defaults to 3. */
    numFollowups?: number;
    /** Console debug visibility for agent runs. Alias of `dev` at agent creation time. */
    debugMode?: boolean;
    /** Debug verbosity. Level 2 logs text chunks as they stream. */
    debugLevel?: 1 | 2;
}

export interface CreateAgentOptions extends AgentContextOptions {
    name: string;
    instructions: string;
    llm?: LLMProvider;
    /**
     * Model: plain id (e.g. gpt-4o) or `provider:model_id`.
     * Ignored if `llm` is provided.
     */
    model?: string;
    apiKey?: string;
    baseURL?: string;
    openRouter?: { apiKey?: string; model?: string };
    /**
     * Tools to give the agent.
     * - Pass an array of `tool()` / `defineTool()` results **directly** — no `.toFrameworkTool()` needed.
    * - Mix `tool()` / `defineTool()` results and full `Tool` instances freely in the same array.
     * - Pass a `ToolRegistry` for advanced use.
     * - Pass `'web'` for the built-in preset (HttpClientTool + BrowserTool).
     * - Pass `[]`, `false`, or omit entirely for a tool-free agent (pure text reasoning).
     */
    tools?: (Tool | AnyLightweightTool)[] | ToolRegistry | false | 'web';
    toolMiddleware?: ToolMiddleware[];
    /**
     * Session store. Pass `false` to run stateless (no session tracking).
     * Omit to use an in-memory store.
     */
    sessionStore?: SessionStore | false;
    /**
     * Guardrails. Pass `false` to disable completely.
     * Omit to use the default sensitive-data guardrail.
     */
    guardrails?: GuardrailEngine | false;
    maxSteps?: number;
    timeoutMs?: number;
    /** Default temperature for LLM calls (0–2). Defaults to 0.7. */
    temperature?: number;
    /** Default max output tokens for LLM calls. Defaults to 4096. */
    maxTokens?: number;
    retry?: { maxRetries?: number; backoffMs?: number; maxBackoffMs?: number };
    logger?: Logger;
    learningMode?: LearningMode;
    userProfileStore?: UserProfileStore;
    memoryStore?: MemoryStore;
    knowledgebase?: RAGEngine;
    /** Generic storage for persisted run metadata, usage, and follow-up suggestions. */
    storage?: Storage;
    inputSchema?: z.ZodType;
    outputSchema?: z.ZodType;
    dev?: boolean;
    /**
     * Adapter registry or explicit per-module bindings.
     *
     * Pass an `AdapterRegistry` to let every module auto-pick the best available
     * adapter for its category, or use explicit `AdapterBindings` to wire
     * specific adapters to specific modules.
     *
     * @example
     * ```ts
     * // Option A — registry (auto-selects first adapter per category)
     * import { createAdapterRegistry, InMemoryCacheAdapter } from 'confused-ai/adapters';
     * const registry = createAdapterRegistry();
     * registry.register(new RedisAdapter({ url: process.env.REDIS_URL! }));
     * registry.register(new PineconeAdapter({ apiKey: process.env.PINECONE_API_KEY! }));
     * createAgent({ adapters: registry });
     *
     * // Option B — explicit bindings
     * createAgent({
     *   adapters: {
     *     session:     redisAdapter,
     *     memory:      pineconeAdapter,
     *     storage:     s3Adapter,
     *     analytics:   duckdbAdapter,
     *     observability: otelAdapter,
     *   },
     * });
     * ```
     */
    adapters?: AdapterRegistry | AdapterBindings;
    /**
     * Convenience: plug in a guardrail adapter without using the full adapter registry.
     * Coexists with `guardrails` — adapter-based check runs after the GuardrailEngine check.
     */
    guardrailAdapter?: GuardrailAdapter;
    /** Convenience: plug in a RAG adapter (overrides `knowledgebase`). */
    ragAdapter?: RagAdapter;
    /** Convenience: plug in a session-store adapter (overrides `sessionStore`). */
    sessionStoreAdapter?: SessionStoreAdapter;
    /** Convenience: plug in a memory-store adapter (overrides `memoryStore`). */
    memoryStoreAdapter?: MemoryStoreAdapter;
    /** Convenience: plug in a remote tool-registry adapter. */
    toolRegistryAdapter?: ToolRegistryAdapter;
    /** Convenience: plug in an auth adapter for per-run credential validation. */
    authAdapter?: AuthAdapter;
    /** Convenience: plug in a rate-limit adapter. */
    rateLimitAdapter?: RateLimitAdapter;
    /** Convenience: plug in an audit-log adapter. */
    auditLogAdapter?: AuditLogAdapter;
    /**
     * Durable checkpoint store — saves loop state after each step so the agent
     * can resume from the last step after a process restart.
     * Pair with a stable `runId` in `AgentRunOptions` for full durable execution.
     *
     * @example
     * ```ts
     * import { createSqliteCheckpointStore } from 'confused-ai/production';
     * createAgent({
     *   checkpointStore: createSqliteCheckpointStore('./agent.db'),
     * });
     * await agent.run('Analyse 500 documents', { runId: 'batch-2024-001' });
     * ```
     */
    checkpointStore?: import('../production/checkpoint.js').AgentCheckpointStore;
    /**
     * Budget enforcement — hard USD caps per run, per user (daily), and per month.
     * Throws `BudgetExceededError` (or warns / truncates) when a cap is crossed.
     *
     * @example
     * ```ts
     * import { createSqliteIdempotencyStore } from 'confused-ai/production';
     *
     * const agent = createAgent({
     *   name: 'Safe',
     *   budget: {
     *     maxUsdPerRun: 0.50,
     *     maxUsdPerUser: 10.00,
     *     maxUsdPerMonth: 500.00,
     *     onExceeded: 'throw',
     *   },
     * });
     * ```
     */
    budget?: import('../production/budget.js').BudgetConfig;
    /**
     * Full lifecycle hooks — intercept every stage of the agentic loop.
     * Zero-cost when omitted (no overhead).
     *
     * @example
     * ```ts
     * hooks: {
     *   beforeRun: async (prompt) => `Context: today is Monday\n\n${prompt}`,
     *   afterRun:  async (result) => { myMetrics.record(result.steps); return result; },
     *   beforeToolCall: async (name, args) => { console.log(name, args); return args; },
     *   afterToolCall:  async (name, result) => result,
     *   buildSystemPrompt: async (instructions, rag) => `${instructions}\n\n${rag ?? ''}`,
     *   onError: async (err, step) => console.error(`Step ${step}:`, err),
     * }
     * ```
     */
    hooks?: AgenticLifecycleHooks;
    /**
     * Mastermind context compression pipeline.
     * Compresses tool outputs, logs, code, and conversation history before they
     * reach the LLM — reducing token usage by 40–90% with no semantic loss.
     *
     * Enabled by default. Set `false` to disable entirely.
     * Pass a `MastermindConfig` to customise thresholds and algorithms.
     *
     * @default true
     * @example
     * ```ts
     * // Disable
     * createAgent({ mastermind: false });
     *
     * // Custom budget
     * createAgent({ mastermind: { contextTokenBudget: 8_000, compressToolResults: true } });
     * ```
     */
    mastermind?: MastermindConfig | boolean;
    /**
     * Durable event recorder. When provided, every run emits an append-only,
     * deterministic, replayable event log (agentStart / llmResult / toolResult /
     * agentEnd) to the recorder's store. Off by default — zero cost when absent.
     *
     * @example
     * ```ts
     * import { RunRecorder, InMemoryEventStore } from '@confused-ai/core';
     * const store = new InMemoryEventStore();
     * createAgent({ recorder: new RunRecorder(store), ... });
     * ```
     */
    recorder?: EventRecorder;
}

export interface AgentRunOptions extends AgentContextOptions {
    sessionId?: string;
    userId?: string;
    messages?: Message[];
    onChunk?: (text: string) => void;
    onToolCall?: (name: string, args: Record<string, unknown>) => void;
    onToolResult?: (name: string, result: unknown) => void;
    onStep?: (step: number) => void;
    /** Per-run lifecycle hooks (merged with agent-level hooks). */
    hooks?: AgenticLifecycleHooks;
    /**
     * Stable run ID for durable execution — enables checkpoint resume.
     * When provided and a `checkpointStore` is configured, the runner saves
     * state after each step and resumes from the last checkpoint on retry.
     */
    runId?: string;
    /** Restrict which tools may execute for this run. */
    allowedTools?: string[];
    /** Abort/cancel the run. */
    signal?: import('../agentic/index.js').AgenticRunConfig['signal'];
}

/**
 * Typed event emitted by `agent.streamEvents()`.
 *
 * Richer than the `string` chunks of `agent.stream()` — callers can differentiate
 * text deltas, tool calls, tool results, step completions, and the final run result.
 */
export interface StreamChunk {
    type: 'text-delta' | 'tool-call' | 'tool-result' | 'step-finish' | 'run-finish' | 'error';
    /** Present when type is 'text-delta'. */
    delta?: string;
    /** Present when type is 'tool-call' or 'tool-result'. */
    tool?: { name: string; input: unknown; output?: unknown };
    /** Present when type is 'step-finish'. */
    stepNumber?: number;
    /** Present when type is 'run-finish'. */
    run?: AgentRunResult;
    /** Present when type is 'error'. */
    error?: Error;
}

export interface CreateAgentResult {
    name: string;
    instructions: string;
    /**
     * Run the agent with a text prompt or a multi-modal input.
     *
     * @example
     * // Text only
     * await agent.run('What is TypeScript?');
     *
     * // With an image (vision)
     * import { multiModal, imageUrl } from 'confused-ai';
     * await agent.run(await multiModal('Describe this image', imageUrl('https://...')));
     */
    run(prompt: string | MultiModalInput, options?: AgentRunOptions): Promise<AgentRunResult>;
    /**
     * Stream the agent's response as an async iterable of text chunks.
     *
     * Chunks arrive in real time as the LLM generates — no need to wait for
     * the full response. After the loop exhausts, the run has completed.
     *
     * @example
     * ```ts
     * for await (const chunk of agent.stream('Explain TypeScript generics')) {
     *   process.stdout.write(chunk);
     * }
     * ```
     *
     * Errors thrown by the agent are re-thrown when the iterator exhausts.
     */
    stream(prompt: string | MultiModalInput, options?: Omit<AgentRunOptions, 'onChunk'>): AsyncIterable<string>;
    /**
     * Stream the agent's response as typed `StreamChunk` events.
     *
     * Yields text deltas, tool-call/result notifications, step completions,
    * and finally a `run-finish` event carrying the full `AgentRunResult`.
     *
     * @example
     * ```ts
     * for await (const event of agent.streamEvents('Summarise this document')) {
     *   if (event.type === 'text-delta') process.stdout.write(event.delta ?? '');
     *   if (event.type === 'run-finish') console.log('done', event.run?.steps, 'steps');
     * }
     * ```
     */
    streamEvents(prompt: string | MultiModalInput, options?: Omit<AgentRunOptions, 'onChunk'>): AsyncIterable<StreamChunk>;
    /**
     * Session-lifetime context-compression savings (headroom-style dashboard):
     * cumulative tokens saved, estimated USD, per-algorithm counts, and recent
     * events. Returns `undefined` when compression is disabled (`mastermind: false`).
     *
     * @example
     * ```ts
     * await bot.run('summarise these logs');
     * const s = bot.getCompressionStats();
     * console.log(`saved ${s?.tokensSaved} tokens (~$${s?.costSavedUsd.toFixed(4)})`);
     * ```
     */
    getCompressionStats(): import('../compression/mastermind/index.js').MastermindLifetimeStats | undefined;
    createSession(userId?: string): Promise<string>;
    getSessionMessages(sessionId: string): Promise<Message[]>;
    /**
     * Resume an existing session — returns a bound handle where every `run`,
     * `stream`, and `streamEvents` call automatically uses the given session.
     *
     * @example
     * ```ts
     * const bot = agent({ instructions: '...' });
     * const sid  = await bot.createSession();
     *
     * // Turn 1
     * await bot.run('Hello!', { sessionId: sid });
     *
     * // Turn 2 — same session, cleaner syntax
     * const session = bot.resume(sid);
     * await session.run('What did I just say?');
     * ```
     */
    resume(sessionId: string): {
        run(prompt: string | MultiModalInput, options?: Omit<AgentRunOptions, 'sessionId'>): Promise<AgentRunResult>;
        stream(prompt: string | MultiModalInput, options?: Omit<AgentRunOptions, 'sessionId' | 'onChunk'>): AsyncIterable<string>;
        streamEvents(prompt: string | MultiModalInput, options?: Omit<AgentRunOptions, 'sessionId' | 'onChunk'>): AsyncIterable<StreamChunk>;
    };
    /** All resolved adapter bindings (merged from `adapters` + convenience fields). */
    readonly adapters?: AdapterBindings;
}
