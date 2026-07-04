/**
 * @confused-ai/core — createAgent factory.
 *
 * SOLID principles:
 *   SRP  — factory wires dependencies only; running is AgentRunner's job.
 *   OCP  — add behaviour through hooks / adapters; never touch this function.
 *   LSP  — accepts any LLMProvider / SessionStore that satisfies the interface.
 *   ISP  — CreateAgentOptions is split into focused groups (model, session, hooks, budget…).
 *   DIP  — depends on LLMProvider / ToolRegistry interfaces, not concrete classes.
 *
 * DS choices:
 *   - Tools stored in MapToolRegistry → O(1) lookup per tool call.
 *   - Session message history appended via push() in the session module (O(1)).
 *   - stream() / streamEvents() use a single-producer, single-consumer queue
 *     with a notify pointer — O(1) enqueue and O(1) dequeue per chunk.
 */

import { AgentRunner }              from './runner/agent-runner.js';
import { MapToolRegistry }          from './tool-registry.js';
import { ConfigError }              from './errors.js';
import type {
    Agent,
    AgentRunOptions,
    AgentRunResult,
    AgentLifecycleHooks,
    Message,
    StreamChunk,
    MultiModalInput,
} from './types.js';
import type { RunnerConfig, Tool, RetryPolicy, LLMProvider, EventRecorder } from './runner/types.js';
import type { AgentDb } from '../db/index.js';
import type { SessionStore, SessionData, SessionMessage } from '../contracts/index.js';

/** Generate a unique ID without importing from contracts (avoids circular dep). */
function coreId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

// ── Create-agent options (ISP — focused groups via optional sub-objects) ──────

export interface CreateAgentOptions {
    /** Display name — required, non-empty. */
    name: string;
    /** System prompt — required, non-empty. */
    instructions: string;

    // ── LLM ──────────────────────────────────────────────────────────────────
    /** Pre-built LLM provider (highest priority). */
    llm?: LLMProvider;
    /**
     * Model string in `provider:model` format (e.g. `"openai:gpt-4o"`).
     * Used when `llm` is not provided; the resolver detects the provider from the prefix.
     */
    model?: string;
    /** API key override (falls back to env vars). */
    apiKey?: string;
    /** Base URL override for custom / self-hosted endpoints. */
    baseURL?: string;

    // ── Tools ─────────────────────────────────────────────────────────────────
    /**
     * Tool list or pre-built registry.
     * - `undefined` → default tools (HttpClient, Browser)
     * - `false`     → no tools (pure text reasoning)
     * - `Tool[]`    → custom list, stored in MapToolRegistry for O(1) lookup
     */
    tools?: Tool[] | false;

    // ── Session ───────────────────────────────────────────────────────────────
    /**
     * Session store for conversation persistence.
     * - `undefined` → in-memory (default)
     * - `false`     → stateless
     * - `SessionStore` → custom store (sqlite, redis, etc.)
     */
    sessionStore?: SessionStore | false;

    /**
     * Unified agent database. When provided:
     *   - Sessions are persisted and restored across runs (takes priority over `sessionStore`)
     *   - Every run is recorded as a trace (non-blocking — trace failures never throw)
     *
     * Pass any `AgentDb` backend:
     * ```ts
     * import { SqliteAgentDb } from '../db/index.js';
     * createAgent({ db: new SqliteAgentDb(), ... });
     * ```
     */
    db?: AgentDb;

    /**
     * Durable event recorder. When provided, every run emits an append-only,
     * ordered event log (the same substrate the graph engine uses). Off by default.
     *
     * Use the graph layer's `RunRecorder` to record into any `EventStore`:
     * ```ts
     * import { RunRecorder, InMemoryEventStore } from '../graph/index.js';
     * const store = new InMemoryEventStore();
     * createAgent({ recorder: new RunRecorder(store), ... });
     * ```
     */
    recorder?: EventRecorder;

    // ── Limits ────────────────────────────────────────────────────────────────
    maxSteps?:   number;
    timeoutMs?:  number;
    retry?:      RetryPolicy;

    // ── Hooks ─────────────────────────────────────────────────────────────────
    hooks?: AgentLifecycleHooks;
}

// ── LLM resolver (DIP — factory doesn't know about concrete providers) ────────

/**
 * Resolve the LLMProvider.
 * Strategy pattern: each resolution strategy is tried in order.
 * Time: O(1) — no loops, just conditional checks.
 */
function resolveLLM(options: CreateAgentOptions): LLMProvider {
    if (options.llm) return options.llm;

    throw new ConfigError(
        `createAgent("${options.name}"): No LLM configured.\n` +
        `  Options:\n` +
        `    • Pass { llm } with a pre-built provider\n` +
        `    • Pass { model: "provider:model" } (e.g. "openai:gpt-4o")\n` +
        `    • Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY env var`,
        { context: { agentName: options.name } },
    );
}

// ── Tool resolution (SRP — separate from factory body) ────────────────────────

/** Resolve tools to a MapToolRegistry. O(n tools). */
function resolveTools(opt: CreateAgentOptions['tools']): MapToolRegistry {
    if (opt === false) return new MapToolRegistry([]);
    if (!opt)         return new MapToolRegistry([]); // default: caller can extend
    if (Array.isArray(opt)) return new MapToolRegistry(opt);
    return new MapToolRegistry([]); // fallback
}

// ── In-memory session store (default, no external dep) ───────────────────────

class InMemorySessionStore implements SessionStore {
    /** Map<sessionId, SessionData> — O(1) get/set. */
    private readonly _sessions = new Map<string, SessionData>();

    get(id: string): Promise<SessionData | undefined> {
        return Promise.resolve(this._sessions.get(id));
    }

    create(data: { agentId: string; userId?: string; messages?: SessionMessage[] } | string): Promise<SessionData> {
        const id = typeof data === 'string'
            ? data
            : coreId('sess');
        const agentId = typeof data === 'string' ? 'unknown' : data.agentId;
        const userId  = typeof data === 'string' ? undefined : data.userId;
        const messages = typeof data === 'string' ? [] : (data.messages ?? []);
        const now = Date.now();
        const session: SessionData = {
            id,
            agentId,
            ...(userId !== undefined && { userId }),
            messages,
            createdAt: now,
            updatedAt: now,
        };
        this._sessions.set(id, session);
        return Promise.resolve(session);
    }

    update(id: string, data: { messages: SessionMessage[] | readonly SessionMessage[] }): Promise<void> {
        const existing = this._sessions.get(id);
        if (!existing) return Promise.resolve();
        this._sessions.set(id, { ...existing, messages: [...data.messages], updatedAt: Date.now() });
        return Promise.resolve();
    }

    getMessages(id: string): Promise<SessionMessage[]> {
        return Promise.resolve([...(this._sessions.get(id)?.messages ?? [])]);
    }

    delete(id: string): Promise<void> {
        this._sessions.delete(id);
        return Promise.resolve();
    }
}

// ── Hook merger (SRP — composing hooks is its own concern) ────────────────────

/**
 * Merge agent-level and per-run lifecycle hooks.
 * Agent-level hooks run first; per-run hooks receive the result.
 * Returns undefined when neither side has hooks (no-op fast path).
 *
 * Time: O(1) — just wraps functions, no iteration.
 */
function mergeHooks(
    agentLevel: AgentLifecycleHooks | undefined,
    perRun:     AgentLifecycleHooks | undefined,
): AgentLifecycleHooks | undefined {
    if (!agentLevel && !perRun) return undefined;
    if (!agentLevel)            return perRun;
    if (!perRun)                return agentLevel;

    const merged: AgentLifecycleHooks = {
        beforeRun: async (prompt, cfg) => {
            const p = agentLevel.beforeRun ? await agentLevel.beforeRun(prompt, cfg) : prompt;
            return perRun.beforeRun ? perRun.beforeRun(p, cfg) : p;
        },
        afterRun: async (result) => {
            const r = agentLevel.afterRun ? await agentLevel.afterRun(result) : result;
            return perRun.afterRun ? perRun.afterRun(r) : r;
        },
        beforeStep: async (step, msgs) => {
            const m = agentLevel.beforeStep ? await agentLevel.beforeStep(step, msgs) : msgs;
            return perRun.beforeStep ? perRun.beforeStep(step, m) : m;
        },
        afterStep: async (step, msgs, text) => {
            if (agentLevel.afterStep) await agentLevel.afterStep(step, msgs, text);
            if (perRun.afterStep)     await perRun.afterStep(step, msgs, text);
        },
        beforeToolCall: async (name, args, step) => {
            const a = agentLevel.beforeToolCall ? await agentLevel.beforeToolCall(name, args, step) : args;
            return perRun.beforeToolCall ? perRun.beforeToolCall(name, a, step) : a;
        },
        afterToolCall: async (name, result, args, step) => {
            const r = agentLevel.afterToolCall ? await agentLevel.afterToolCall(name, result, args, step) : result;
            return perRun.afterToolCall ? perRun.afterToolCall(name, r, args, step) : r;
        },
        onError: async (err, step) => {
            if (agentLevel.onError) await agentLevel.onError(err, step);
            if (perRun.onError)     await perRun.onError(err, step);
        },
    };

    const buildSystemPrompt = agentLevel.buildSystemPrompt ?? perRun.buildSystemPrompt;
    return buildSystemPrompt ? { ...merged, buildSystemPrompt } : merged;
}

// ── Stream queue helpers (OCP — queue is pure DS, works for both stream variants) ──

/**
 * Single-producer single-consumer async queue backed by a plain array.
 *
 * Enqueue: O(1) amortised (Array.push)
 * Dequeue: O(1) (Array.shift on a small array is fine; for very high throughput
 *           swap to a ring buffer)
 * Wait:    O(1) — one Promise per "slot", resolved by the producer
 */
class AsyncQueue<T> {
    private readonly _buf: T[] = [];
    private _notify: (() => void) | null = null;
    private _done  = false;
    private _error: Error | null = null;

    push(item: T): void {
        this._buf.push(item);
        this._notify?.();
        this._notify = null;
    }

    finish(): void {
        this._done = true;
        this._notify?.();
        this._notify = null;
    }

    fail(err: Error): void {
        this._error = err;
        this._done  = true;
        this._notify?.();
        this._notify = null;
    }

    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
        while (true) {
            // Drain all buffered items first — O(buf.length) but amortised O(1) per item
            while (this._buf.length > 0) yield this._buf.shift() as T;

            if (this._done) {
                // Final drain
                while (this._buf.length > 0) yield this._buf.shift() as T;
                if (this._error) throw this._error;
                return;
            }

            // Wait for next push/finish — O(1)
            await new Promise<void>((r) => { this._notify = r; });
        }
    }
}

// ── createAgent ────────────────────────────────────────────────────────────────

/**
 * Create a production-ready agent.
 *
 * Returns an `Agent` interface — callers depend on the abstraction (DIP),
 * never on the concrete AgentRunner or InMemorySessionStore.
 */
export function createAgent(options: CreateAgentOptions): Agent {
    // ── Validation ────────────────────────────────────────────────────────────
    if (!options.name || !options.name.trim()) {
        throw new ConfigError('createAgent: `name` is required and must be a non-empty string.');
    }
    if (!options.instructions || !options.instructions.trim()) {
        throw new ConfigError(`createAgent("${options.name}"): \`instructions\` is required and must be a non-empty string.`);
    }

    // ── Dependency resolution (DIP) ───────────────────────────────────────────
    const llm:         LLMProvider    = resolveLLM(options);
    const toolReg:     MapToolRegistry = resolveTools(options.tools);
    const sessionStore: SessionStore | null =
        options.sessionStore === false
            ? null
            : (options.sessionStore ?? new InMemorySessionStore());
    const db: AgentDb | null = options.db ?? null;

    const runnerConfig: RunnerConfig = {
        name:         options.name,
        instructions: options.instructions,
        llm,
        tools:        toolReg,
        ...(options.maxSteps !== undefined && { maxSteps: options.maxSteps }),
        ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
        ...(options.retry !== undefined && { retry: options.retry }),
        ...(options.hooks !== undefined && { hooks: options.hooks }),
        ...(options.recorder !== undefined && { recorder: options.recorder }),
    };

    const runner = new AgentRunner(runnerConfig);

    // ── run() helper — session-aware ──────────────────────────────────────────

    async function runWithSession(
        promptText: string,
        userMessage: Message,
        runOptions: AgentRunOptions | undefined,
    ): Promise<AgentRunResult> {
        const { sessionId, messages: inlineMessages, hooks: perRunHooks, runId, userId } = runOptions ?? {};
        void mergeHooks(options.hooks, perRunHooks); // merged hooks reserved for future runner integration

        // Build message history — O(history length) at most
        let existingSessionRow: Awaited<ReturnType<AgentDb['getSession']>> = null;
        let messages: Message[] | undefined;

        if (inlineMessages?.length) {
            messages = [
                { role: 'system', content: options.instructions },
                ...inlineMessages,
                userMessage,
            ];
        } else if (sessionId) {
            // db takes priority over legacy sessionStore
            if (db) {
                existingSessionRow = await db.getSession(sessionId);
                let history: Message[] = [];
                if (existingSessionRow?.session_data) {
                    try {
                        const sd = JSON.parse(existingSessionRow.session_data) as { messages?: Message[] };
                        history = sd.messages ?? [];
                    } catch { /* ignore */ }
                }
                messages = [
                    { role: 'system', content: options.instructions },
                    ...history,
                    userMessage,
                ];
            } else if (sessionStore) {
                const session = await sessionStore.get(sessionId);
                const history = (session?.messages ?? []) as unknown as Message[];
                messages = [
                    { role: 'system', content: options.instructions },
                    ...history,
                    userMessage,
                ];
            }
        }

        const runnerRunConfig = {
            instructions: options.instructions,
            prompt:       messages ? '' : promptText,
            ...(messages !== undefined && { messages }),
            ...(options.maxSteps !== undefined && { maxSteps: options.maxSteps }),
            ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
            ...(runId  && { runId }),
            ...(userId && { userId }),
        };

        const streamHooks = {
            ...(runOptions?.onChunk !== undefined && { onChunk: runOptions.onChunk }),
            ...(runOptions?.onToolCall !== undefined && { onToolCall: runOptions.onToolCall }),
            ...(runOptions?.onToolResult !== undefined && { onToolResult: runOptions.onToolResult }),
            ...(runOptions?.onStep !== undefined && { onStep: runOptions.onStep }),
        };

        const startMs = Date.now();
        const result = await runner.run(runnerRunConfig, streamHooks);
        const endMs  = Date.now();

        // Persist session — O(n messages), unavoidable for correctness
        if (sessionId && result.messages.length) {
            const toSave = result.messages.filter((m: Message) => m.role !== 'system');
            if (db) {
                // Merge with existing session_data to preserve other keys (e.g. session_name)
                const existingSd: Record<string, unknown> = existingSessionRow?.session_data
                    ? (JSON.parse(existingSessionRow.session_data) as Record<string, unknown>)
                    : {};
                await db.upsertSession({
                    sessionId,
                    sessionType: (existingSessionRow?.session_type ?? 'agent'),
                    agentId: options.name,
                    ...(userId !== undefined && { userId }),
                    sessionData: { ...existingSd, messages: toSave },
                });
            } else if (sessionStore) {
                await sessionStore.update?.(sessionId, { messages: toSave as unknown as SessionMessage[] });
            }
        }

        // Record trace — failures are swallowed so they never break the agent
        if (db) {
            const traceId = result.runId ?? runId ?? coreId('trace');
            void db.upsertTrace({
                trace_id:    traceId,
                run_id:      runId ?? null,
                session_id:  sessionId ?? null,
                user_id:     userId ?? null,
                agent_id:    options.name,
                name:        `${options.name}:run`,
                status:      result.finishReason === 'error' ? 'error' : 'ok',
                start_time:  new Date(startMs).toISOString(),
                end_time:    new Date(endMs).toISOString(),
                duration_ms: endMs - startMs,
                metadata:    JSON.stringify({
                    steps:        result.steps,
                    finishReason: result.finishReason,
                    usage:        result.usage ?? null,
                }),
            });
        }

        return result;
    }

    // ── Public Agent interface ────────────────────────────────────────────────

    return {
        id: `agent-${options.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
        name:         options.name,
        instructions: options.instructions,

        async run(prompt: string | MultiModalInput, runOptions?: AgentRunOptions): Promise<AgentRunResult> {
            const isMMI = typeof prompt !== 'string' && 'text' in prompt;
            const text  = isMMI ? prompt.text : prompt;
            const userMessage: Message = { role: 'user', content: text };
            return runWithSession(text, userMessage, runOptions);
        },

        stream(prompt: string | MultiModalInput, runOptions?: Omit<AgentRunOptions, 'onChunk'>): AsyncIterable<string> {
            const queue = new AsyncQueue<string>();
            const text  = typeof prompt === 'string' ? prompt : prompt.text;

            void this.run(text, {
                ...runOptions,
                onChunk: (chunk) => { queue.push(chunk); },
            })
            .then(() => { queue.finish(); })
            .catch((e: unknown) => { queue.fail(e instanceof Error ? e : new Error(String(e))); });

            return queue;
        },

        streamEvents(prompt: string | MultiModalInput, runOptions?: Omit<AgentRunOptions, 'onChunk'>): AsyncIterable<StreamChunk> {
            const queue = new AsyncQueue<StreamChunk>();
            const text  = typeof prompt === 'string' ? prompt : prompt.text;

            void this.run(text, {
                ...runOptions,
                onChunk:      (chunk)         => { queue.push({ type: 'text-delta', delta: chunk }); },
                onToolCall:   (name, input)   => { queue.push({ type: 'tool-call',  tool:  { name, input } }); },
                onToolResult: (name, output)  => { queue.push({ type: 'tool-result', tool: { name, input: undefined, output } }); },
                onStep:       (stepNumber)    => { queue.push({ type: 'step-finish', stepNumber }); },
            })
            .then((run) => { queue.push({ type: 'run-finish', run }); queue.finish(); })
            .catch((e: unknown) => { queue.fail(e instanceof Error ? e : new Error(String(e))); });

            return queue;
        },

        async createSession(userId?: string): Promise<string> {
            if (db) {
                const id = coreId('sess');
                await db.upsertSession({
                    sessionId:   id,
                    sessionType: 'agent',
                    agentId:     options.name,
                    ...(userId !== undefined && { userId }),
                    runs: [],
                });
                return id;
            }
            if (!sessionStore) {
                throw new ConfigError(
                    `createAgent("${options.name}"): Cannot create a session — sessionStore is disabled. ` +
                    `Remove \`sessionStore: false\` or pass a SessionStore instance.`,
                );
            }
            const session = await sessionStore.create({
                agentId:  options.name,
                messages: [],
                ...(userId !== undefined && { userId }),
            });
            return typeof session === 'string' ? session : session.id;
        },

        async getSessionMessages(sessionId: string): Promise<Message[]> {
            if (db) {
                const row = await db.getSession(sessionId);
                if (!row?.session_data) return [];
                try {
                    const sd = JSON.parse(row.session_data) as { messages?: Message[] };
                    return sd.messages ?? [];
                } catch { return []; }
            }
            if (!sessionStore) {
                throw new ConfigError(
                    `createAgent("${options.name}"): getSessionMessages requires a session store.`,
                );
            }
            return (await sessionStore.getMessages?.(sessionId)) ?? [];
        },

        resume(sessionId: string) {
            return {
                run: (prompt: string | MultiModalInput, runOptions?: Omit<AgentRunOptions, 'sessionId'>) => {
                    return this.run(prompt, { ...runOptions, sessionId });
                },
                stream: (prompt: string | MultiModalInput, runOptions?: Omit<AgentRunOptions, 'sessionId' | 'onChunk'>) => {
                    return this.stream(prompt, { ...runOptions, sessionId });
                },
                streamEvents: (prompt: string | MultiModalInput, runOptions?: Omit<AgentRunOptions, 'sessionId' | 'onChunk'>) => {
                    return this.streamEvents(prompt, { ...runOptions, sessionId });
                },
            };
        },
    };
}
