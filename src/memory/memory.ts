/**
 * @personaforge/memory — Memory, the unified Mastra-style inspired memory layer.
 *
 * One object wires every memory feature and persists them through a ThreadStore
 * (libSQL by default):
 *
 * - **Message history** — threads + per-message rows, loaded into context and
 *   persisted after each run (`lastMessages`).
 * - **Working memory** — a structured user/task scratchpad (template or schema)
 *   always present in the system prompt, updatable by the agent or the Observer.
 * - **Semantic recall** — RAG over past messages via a vector store + embedder.
 * - **Observational memory** — Observer/Reflector background agents that keep a
 *   dense observation log, replacing raw history as it grows.
 * - **mem0-style engine** — LLM-extracted fact memory with a CRUD API and agent
 *   tools.
 *
 * ```ts
 * import { createAgent, Memory } from 'personaforge';
 *
 * const memory = new Memory({
 *   // storage defaults to libSQL (:memory:); use file:./memory.db for durable
 *   vector: new InMemoryVectorStore(),
 *   embedder: new OpenAIEmbeddingProvider(),
 *   options: {
 *     lastMessages: 20,
 *     semanticRecall: true,
 *     workingMemory: { template: '# Profile\n- Name:\n- Location:' },
 *   },
 * });
 *
 * const agent = createAgent({
 *   name: 'assistant',
 *   instructions: '...',
 *   memory,
 * });
 *
 * await agent.run('Remember I like dark mode.', {
 *   memory: { thread: 't1', resource: 'alice' },
 * });
 * ```
 */

import { z } from 'zod';
import type { LLMProvider, Message } from '../contracts/index.js';
import type { Processor, ProcessorSet } from '../processors/types.js';
import type { EmbeddingProvider, VectorStoreAdapter } from './types.js';
import type { Thread, ThreadMetadata, ThreadState } from './threads.js';
import type { ThreadStore, ListThreadsOptions } from './thread-store.js';
import { createThreadStore } from './thread-store-factory.js';
import {
    resolveWorkingMemory,
    mergeWorkingMemory,
    WorkingMemoryManager,
    type ResolvedWorkingMemory,
    type WorkingMemoryConfig,
} from './working-memory.js';
import { ObservationalMemoryManager, type ObservationalMemoryConfig } from './observational-memory.js';
import {
    Mem0Memory,
    createMem0MemoryTools,
    type Mem0MemoryConfig,
} from './mem0.js';
import { HashingEmbedder, estimateTokenCount, type TokenEstimator } from './token-estimator.js';
import { InMemoryVectorStore } from './in-memory-vector-store.js';
import {
    MessageHistoryProcessor,
    SemanticRecallProcessor,
    WorkingMemoryProcessor,
    ObservationalMemoryProcessor,
    Mem0ExtractionProcessor,
    messageToStorage,
    storageToMessage,
} from './memory-processors.js';
import { type StorageMessage } from './threads.js';
import { filterSystemMessages, mergeMessagesByTimestamp, textOfContent } from './threads.js';

// ── Config ─────────────────────────────────────────────────────────────────

export interface SemanticRecallConfig {
    /** Number of similar messages to retrieve. Default 3. */
    topK?: number;
    /** Surrounding messages to include with each match. Default 0. */
    messageRange?: number;
    /** `resource` (default) searches all threads; `thread` only the current one. */
    scope?: 'thread' | 'resource';
    /** Persist embeddings on output. Default true. */
    storeOnOutput?: boolean;
}

export interface Mem0MemoryOption {
    /** Explicit Mem0Memory instance. When omitted and `llm` is available, one is auto-built. */
    memory?: Mem0Memory;
    /** Auto-extract facts from each run. Default false. */
    autoExtract?: boolean;
    /** Config only used when auto-building the engine. */
    config?: Omit<Mem0MemoryConfig, 'llm'>;
}

export interface MemoryOptions {
    /** Recent messages to keep in context. Default 20. */
    lastMessages?: number;
    /** Semantic recall over past messages. `false` (default) disables; `true` uses zero-config embeddings. */
    semanticRecall?: false | SemanticRecallConfig;
    /** Structured user/task scratchpad. `false` (default) disables. */
    workingMemory?: false | WorkingMemoryConfig;
    /** Observational memory (Observer/Reflector). `false` (default) disables. */
    observationalMemory?: false | ObservationalMemoryConfig;
    /** mem0-style fact memory. Disabled by default. */
    mem0?: false | Mem0MemoryOption;
    /** Suggest thread titles. Default false. */
    threadTitle?: boolean;
    /** Local token-estimator override for OM / trimming. */
    tokenEstimator?: TokenEstimator;
}

export interface MemoryConfig {
    /** Short label for logs/tools. */
    name?: string;
    /**
     * ThreadStore. Defaults to `createThreadStore()` — libSQL (shared memory,
     * or `file:`/remote when `LIB_SQL_URL` is set), falling back to in-memory.
     * Pass `false` for in-memory only.
     */
    storage?: ThreadStore | false;
    /** Vector store for semantic recall. Defaults to an in-memory vector store. */
    vector?: VectorStoreAdapter;
    /** Embedder for semantic recall. Defaults to a deterministic local hashing embedder. */
    embedder?: EmbeddingProvider;
    /** LLM for observational memory / mem0 extraction. Falls back to the agent's llm when bound. */
    llm?: LLMProvider;
    options?: MemoryOptions;
}

export interface CreateThreadOptions {
    id?: string;
    title?: string;
    metadata?: ThreadMetadata | Record<string, unknown>;
}

export interface RecallOptions {
    threadId?: string;
    resourceId?: string;
    /** Semantic query — when present, runs vector recall; otherwise lists messages. */
    vectorSearchString?: string;
    perPage?: number;
    page?: number;
    scope?: 'thread' | 'resource';
}

// ── Memory ─────────────────────────────────────────────────────────────────

export class Memory {
    /** Identifier for logs / tool descriptions. */
    readonly name: string | undefined;
    private readonly store: ThreadStore;
    private readonly vector: VectorStoreAdapter;
    private readonly embedder: EmbeddingProvider;
    private llm: LLMProvider | undefined;
    private readonly lastMessages: number;
    private readonly workingMemoryCfg: ResolvedWorkingMemory;
    private readonly workingMemoryManager: WorkingMemoryManager;
    private readonly semantic: SemanticRecallProcessor | undefined;
    private readonly mem0Engine: Mem0Memory | undefined;
    private readonly mem0Option: Mem0MemoryOption | false;
    private readonly mem0AutoExtract: boolean;
    private readonly estimator: TokenEstimator;
    private _observational: ObservationalMemoryManager | undefined;
    private _observationalCfg: ObservationalMemoryConfig | false;

    constructor(config: MemoryConfig = {}) {
        this.name = config.name;
        this.store = config.storage === false ? createThreadStore({ driver: 'memory' }) : (config.storage ?? createThreadStore());
        const options = config.options ?? {};
        this.lastMessages = options.lastMessages ?? 20;
        this.estimator = options.tokenEstimator ?? estimateTokenCount;
        this.llm = config.llm;
        this.workingMemoryCfg = resolveWorkingMemory(options.workingMemory);
        this.workingMemoryManager = new WorkingMemoryManager(this.store);

        // Semantic recall — zero-config defaults (in-memory vector + hashing embedder).
        const recall = options.semanticRecall;
        if (recall) {
            const vector = config.vector ?? new InMemoryVectorStore();
            const embedder = config.embedder ?? new HashingEmbedder();
            this.vector = vector;
            this.embedder = embedder;
            this.semantic = new SemanticRecallProcessor({
                store: this.store,
                vectorStore: vector,
                embedder,
                topK: recall.topK ?? 3,
                messageRange: recall.messageRange ?? 0,
                scope: recall.scope ?? 'resource',
                storeOnOutput: recall.storeOnOutput ?? true,
                tokenEstimator: this.estimator,
            });
        } else {
            this.vector = config.vector ?? new InMemoryVectorStore();
            this.embedder = config.embedder ?? new HashingEmbedder();
            this.semantic = undefined;
        }

        // mem0 engine — auto-built when a config/option is given and llm is (or will be) available.
        const mem0Option: Mem0MemoryOption | false | undefined = options.mem0;
        if (mem0Option === false || !mem0Option) {
            this.mem0Option = false;
            this.mem0AutoExtract = false;
            this.mem0Engine = undefined;
        } else {
            this.mem0Option = mem0Option;
            this.mem0AutoExtract = mem0Option.autoExtract ?? false;
            const explicit = mem0Option.memory;
            this.mem0Engine =
                explicit ??
                new Mem0Memory({
                    ...(mem0Option.config ?? {}),
                    llm: this.llm,
                    embedder: this.embedder,
                    vectorStore: this.vector,
                });
        }

        this._observationalCfg = options.observationalMemory ?? false;
        this._observational = undefined;
    }

    // ── Storage access ──────────────────────────────────────────────────────

    /** The underlying ThreadStore (libSQL by default). */
    get storage(): ThreadStore {
        return this.store;
    }

    /** The mem0 engine (when configured). */
    get mem0(): Mem0Memory | undefined {
        return this.mem0Engine;
    }

    /** Whether working memory is enabled. */
    get workingMemoryEnabled(): boolean {
        return this.workingMemoryCfg.kind !== 'none';
    }

    get workingMemory(): WorkingMemoryManager {
        return this.workingMemoryManager;
    }

    get observational(): ObservationalMemoryManager | undefined {
        return this._ensureObservational();
    }

    /**
     * Bind a fallback LLM (the agent's model) for OM / mem0 when the caller did
     * not pass one. The first non-undefined llm wins.
     */
    bindLlm(llm: LLMProvider | undefined): void {
        if (!llm) return;
        if (!this.llm) this.llm = llm;
        this.mem0Engine?.setLlm(llm);
    }

    private _ensureObservational(): ObservationalMemoryManager | undefined {
        if (!this._observationalCfg) return undefined;
        if (this._observational) return this._observational;
        if (!this.llm) {
            throw new Error(
                'ObservationalMemory requires an LLM. Pass `llm` in the Memory config, or set `options.observationalMemory` on an agent whose Memory receives the agent llm (bind via `memory.bindLlm(llm)` when using createAgent).',
            );
        }
        const cfg = this._observationalCfg;
        const merged: ObservationalMemoryConfig = {
            ...cfg,
            llm: cfg.llm ?? this.llm,
            ...(cfg.observation && cfg.observation.manageWorkingMemory
                ? { workingMemoryManager: this.workingMemoryManager }
                : {}),
        };
        this._observational = new ObservationalMemoryManager({
            store: this.store,
            llm: merged.llm,
            config: merged,
            ...(merged.workingMemoryManager ? { workingMemory: this.workingMemoryManager } : {}),
        });
        return this._observational;
    }

    // ── Thread API ──────────────────────────────────────────────────────────

    /** Create a thread. `id` and `resourceId` are required in practice. */
    async createThread(options: {
        threadId?: string;
        resourceId: string;
        title?: string;
        metadata?: ThreadMetadata | Record<string, unknown>;
    }): Promise<Thread> {
        return this.store.createThread({
            id: options.threadId,
            resourceId: options.resourceId,
            title: options.title,
            metadata: options.metadata,
        });
    }

    async updateThread(options: { id: string; title?: string; metadata?: ThreadMetadata | Record<string, unknown> }): Promise<Thread> {
        return this.store.updateThread(options.id, {
            title: options.title,
            metadata: options.metadata,
        });
    }

    async deleteThread(threadId: string, opts: { resourceId?: string } = {}): Promise<void> {
        if (opts.resourceId) {
            // delete only threads owned by this resource
            const owner = await this.store.getThread(threadId);
            if (owner && owner.resourceId !== opts.resourceId) {
                throw new Error(`Memory.deleteThread: thread "${threadId}" is owned by "${owner.resourceId}", not "${opts.resourceId}".`);
            }
        }
        return this.store.deleteThread(threadId);
    }

    async listThreads(options: ListThreadsOptions = {}): Promise<Thread[]> {
        return this.store.listThreads(options);
    }

    async getThreadById(threadId: string): Promise<Thread | null> {
        return this.store.getThread(threadId);
    }

    async getThreadByResourceId(resourceId: string): Promise<Thread[]> {
        return this.store.getThreadByResourceId(resourceId);
    }

    /** Get or create a thread for a (threadId, resourceId) pair. */
    async ensureThread(options: {
        threadId?: string;
        resourceId: string;
        title?: string;
        metadata?: ThreadMetadata | Record<string, unknown>;
    }): Promise<Thread> {
        if (options.threadId) {
            const existing = await this.store.getThread(options.threadId);
            if (existing) {
                if (existing.resourceId !== options.resourceId) {
                    throw new Error(
                        `Memory: thread "${options.threadId}" is owned by resource "${existing.resourceId}" — it cannot be reused for resource "${options.resourceId}". Each thread has a single owner.`,
                    );
                }
                return existing;
            }
        }
        return this.createThread(options);
    }

    // ── Message API ─────────────────────────────────────────────────────────

    /** Persist messages to a thread (assigning ids/timestamps). */
    async saveMessages(threadIdOrOptions: string | { threadId: string; messages: StorageMessage[] }, resourceId?: string, newMessages?: Message[]): Promise<StorageMessage[]> {
        if (typeof threadIdOrOptions === 'string') {
            const threadId = threadIdOrOptions;
            const messages = (newMessages ?? []).filter((m) => m.role !== 'system').map(messageToStorage);
            if (messages.length === 0) return [];
            // Lazily create the thread if it doesn't exist (legacy call-site contract).
            const existing = await this.store.getThread(threadId).catch(() => null);
            if (!existing) {
                await this.store.createThread({ id: threadId, resourceId: resourceId ?? 'resource' });
            }
            return this.store.saveMessages(threadId, messages);
        }
        return this.store.saveMessages(threadIdOrOptions.threadId, threadIdOrOptions.messages);
    }

    /** List a thread's messages with pagination. */
    async listMessages(options: { threadId: string; perPage?: number; page?: number }): Promise<{ messages: StorageMessage[]; total: number }> {
        const perPage = options.perPage ?? 50;
        const page = options.page ?? 1;
        const messages = await this.store.getMessages(options.threadId, {
            limit: perPage,
            offset: (page - 1) * perPage,
        });
        const total = this.store.getMessageCount ? await this.store.getMessageCount(options.threadId) : messages.length;
        return { messages, total };
    }

    /** Recent messages for a thread (oldest-first). */
    async getMessages(threadId: string, limit?: number): Promise<StorageMessage[]> {
        return this.store.getMessages(threadId, { limit });
    }

    // ── Semantic recall ─────────────────────────────────────────────────────

    /**
     * Recall messages by thread (optional semantic query). Mirrors Mastra's
     * `memory.recall()`.
     *
     * Legacy signature (used by the agent's inline memory integration):
     * `recall(threadId, resourceId, query, limit?) => string[]` — semantic
     * recall of stored message contents.
     */
    async recall(threadId: string, resourceId: string | undefined, query: string, limit?: number): Promise<string[]>;
    async recall(options: RecallOptions): Promise<{ messages: StorageMessage[] }>;
    async recall(
        a: string | RecallOptions,
        b?: string | undefined,
        c?: string,
        d?: number,
    ): Promise<string[] | { messages: StorageMessage[] }> {
        if (typeof a === 'string') {
            if (!this.semantic) return [];
            const query = c ?? '';
            if (!query.trim()) return [];
            const resourceId = await this.resolveResourceId(a, b);
            const rows = await this.semantic.recall(query, { threadId: a, resourceId, limit: d ?? 5 });
            return rows.map((m) => textOfContent(m.content));
        }
        return this._recallInternal(a);
    }

    private async _recallInternal(options: RecallOptions): Promise<{ messages: StorageMessage[] }> {
        const { threadId, resourceId, vectorSearchString, perPage, scope } = options;
        const limit = perPage ?? 20;
        if (vectorSearchString) {
            if (!this.semantic) {
                throw new Error('Memory.recall: semantic recall requires `options.semanticRecall` on the Memory config.');
            }
            if (!threadId) {
                throw new Error('Memory.recall: `threadId` is required for semantic recall.');
            }
            const resolvedResource = await this.resolveResourceId(threadId, resourceId);
            const messages = await this.semantic.recall(vectorSearchString, {
                threadId,
                resourceId: resolvedResource,
                limit,
            });
            void scope;
            return { messages };
        }
        if (!threadId) return { messages: [] };
        return this.listMessages({ threadId, perPage: limit });
    }

    /** Resolve a thread's owning resource id when the caller omits it. */
    private async resolveResourceId(threadId: string, resourceId?: string): Promise<string> {
        if (resourceId) return resourceId;
        const thread = await this.store.getThread(threadId).catch(() => null);
        return thread?.resourceId ?? resourceId ?? 'resource';
    }

    /**
     * Embed + index already-persisted rows for future semantic recall.
     * Use the rows returned by {@link saveMessages} so vectors carry stable ids.
     */
    async indexStoredMessages(threadId: string, resourceId: string | undefined, stored: StorageMessage[]): Promise<void> {
        if (!this.semantic) return;
        const resolved = await this.resolveResourceId(threadId, resourceId);
        await this.semantic.embedAndIndex(stored, threadId, resolved).catch(() => undefined);
    }

    /**
     * Post-run hook for the inline agent path: runs observational-memory
     * buffering, mem0 extraction and (when `storedMessages` is provided,
     * e.g. from `saveMessages`) semantic indexing.
     */
    async processMemoryAfterRun(options: {
        threadId: string;
        resourceId: string;
        messages: Message[];
        storedMessages?: StorageMessage[];
    }): Promise<void> {
        const { threadId, resourceId, messages, storedMessages } = options;
        const om = this._observationalCfg ? this._ensureObservational() : undefined;
        if (om) {
            await om.afterTurn({ threadId, resourceId }).catch(() => undefined);
        }
        if (this.mem0Engine && this.mem0AutoExtract) {
            const fresh = messages.filter((m) => m.role !== 'system');
            if (fresh.length) {
                await this.mem0Engine.processMessages(fresh, { userID: resourceId, agentID: this.name }).catch(() => undefined);
            }
        }
        if (storedMessages?.length) {
            await this.indexStoredMessages(threadId, resourceId, storedMessages);
        }
    }

    /** Working-memory context for a resource/thread (inline agent integration). */
    async workingMemoryContext(threadIdOrResourceId: string): Promise<string | undefined> {
        if (this.workingMemoryCfg.kind === 'none') return undefined;
        const id = threadIdOrResourceId;
        const value = await this.workingMemoryManager.get({ threadId: id, resourceId: id, scope: this.workingMemoryCfg.scope });
        if (value) return `[Working Memory]\n${value}`;
        if (this.workingMemoryCfg.kind === 'template' && this.workingMemoryCfg.template) {
            return `[Working Memory]\n${this.workingMemoryCfg.template}`;
        }
        return undefined;
    }

    // ── Working memory ──────────────────────────────────────────────────────

    /** Read the current working-memory block. */
    async getWorkingMemory(options: { threadId: string; resourceId: string }): Promise<string | undefined> {
        return this.workingMemoryManager.get({
            threadId: options.threadId,
            resourceId: options.resourceId,
            scope: this.workingMemoryCfg.scope,
        });
    }

    /** Replace/merge working memory (replace for template, deep-merge for schema). */
    async updateWorkingMemory(options: { threadId: string; resourceId: string; workingMemory: string }): Promise<void> {
        const current = await this.getWorkingMemory(options);
        const { value } = mergeWorkingMemory(
            this.workingMemoryCfg.kind,
            this.workingMemoryCfg.schema,
            current,
            options.workingMemory,
        );
        return this.workingMemoryManager.update({
            threadId: options.threadId,
            resourceId: options.resourceId,
            scope: this.workingMemoryCfg.scope,
            workingMemory: value,
        });
    }

    /** Alias of {@link updateWorkingMemory} (chosen by agents for state-signal style flows). */
    async setWorkingMemory(options: { threadId: string; resourceId: string; workingMemory: string }): Promise<void> {
        return this.updateWorkingMemory(options);
    }

    /** Set working memory directly (bypasses merge semantics). */
    async putWorkingMemory(options: { threadId: string; resourceId: string; workingMemory: string }): Promise<void> {
        return this.workingMemoryManager.update({
            threadId: options.threadId,
            resourceId: options.resourceId,
            scope: this.workingMemoryCfg.scope,
            workingMemory: options.workingMemory,
        });
    }

    // ── Observational memory ────────────────────────────────────────────────

    /** Compute the OM context window (system block + recent messages) for a thread. */
    async getObservationalContext(options: { threadId: string; resourceId: string }): Promise<
        { messages: StorageMessage[]; system?: string; continuation?: string; counts?: { messages: number; observations: number } }
    > {
        const om = this._ensureObservational();
        if (!om) return { messages: await this.getUnobserved(options.threadId) };
        const window = await om.getContextWindow(options);
        return {
            messages: window.messages as StorageMessage[],
            system: window.system,
            continuation: window.continuation,
            counts: window.counts,
        };
    }

    /** Force observation of buffered/unobserved messages for a thread. */
    async processObservations(options: { threadId: string; resourceId: string }): Promise<{ observed: boolean; notes: string[] }> {
        const om = this._ensureObservational();
        if (!om) return { observed: false, notes: [] };
        const result = await om.observeSync(options);
        return { observed: result.activated, notes: result.notes };
    }

    async getUnobserved(threadId: string): Promise<StorageMessage[]> {
        const om = this._observationalCfg ? this._ensureObservational() : undefined;
        if (om) return (await om.getUnobserved(threadId)) as StorageMessage[];
        return this.store.getMessages(threadId, { limit: this.lastMessages });
    }

    // ── mem0 ────────────────────────────────────────────────────────────────

    /** Run mem0 fact extraction over a set of conversation messages. */
    async extractMemories(
        messages: Array<{ role: string; content: unknown }>,
        options: { userID?: string; agentID?: string } = {},
    ): Promise<void> {
        if (!this.mem0Engine) return;
        await this.mem0Engine.processMessages(messages, options);
    }

    // ── Processors (input/output) ───────────────────────────────────────────

    /**
     * The processor set that wires this Memory into the agent's processor
     * pipeline. Composition:
     *
     * - Observational memory enabled → [WorkingMemory?, OM] in, [OM, Mem0?] out
     * - Otherwise                    → [WorkingMemory?, MessageHistory, SemanticRecall?] in, [MessageHistory, SemanticRecall?, Mem0?] out
     */
    getProcessors(): ProcessorSet {
        const input: Processor[] = [];
        const output: Processor[] = [];
        const om = this._observationalCfg ? this._ensureObservational() : undefined;

        if (om) {
            if (this.workingMemoryCfg.kind !== 'none') input.push(new WorkingMemoryProcessor({ workingMemory: this.workingMemoryManager, scope: this.workingMemoryCfg.scope }));
            input.push(new ObservationalMemoryProcessor({ manager: om, store: this.store }));
            output.push(new ObservationalMemoryProcessor({ manager: om, store: this.store }));
            if (this.mem0Engine && this.mem0AutoExtract) {
                output.push(new Mem0ExtractionProcessor({ mem0: this.mem0Engine }));
            }
            return { input, output };
        }

        if (this.workingMemoryCfg.kind !== 'none') input.push(new WorkingMemoryProcessor({ workingMemory: this.workingMemoryManager, scope: this.workingMemoryCfg.scope }));
        input.push(new MessageHistoryProcessor({ store: this.store, lastMessages: this.lastMessages }));
        if (this.semantic) input.push(this.semantic);
        output.push(new MessageHistoryProcessor({ store: this.store, lastMessages: this.lastMessages }));
        if (this.semantic) output.push(this.semantic);
        if (this.mem0Engine && this.mem0AutoExtract) {
            output.push(new Mem0ExtractionProcessor({ mem0: this.mem0Engine }));
        }
        return { input, output };
    }

    // ── Agent tools (auto-registered by createAgent) ────────────────────────

    /**
     * Lightweight memory tools exposed to the agent:
     * - `updateWorkingMemory` (working memory templates)
     * - `recall_memory` (OM retrieval / raw message browsing)
     * - mem0 tools (`search_mem0`, `add_mem0`, `get_all_memories`, `delete_memory`)
     */
    getAgentTools(): Array<{
        name: string;
        description: string;
        parameters: import('../validation/index.js').SchemaInput<unknown, unknown>;
        execute: (input: Record<string, unknown>) => Promise<unknown>;
    }> {
        const tools: Array<{
            name: string;
            description: string;
            parameters: import('../validation/index.js').SchemaInput<unknown, unknown>;
            execute: (input: Record<string, unknown>) => Promise<unknown>;
        }> = [];
        if (this.workingMemoryCfg.kind !== 'none' && this.workingMemoryCfg.agentManaged && !this.workingMemoryCfg.readOnly) {
            tools.push({
                name: 'updateWorkingMemory',
                description:
                    this.workingMemoryCfg.kind === 'schema'
                        ? 'Update the user working memory profile. Provide ONLY the fields to add or change as a JSON object (deep-merged). Set a field to null to delete it. Arrays replace existing arrays.'
                        : 'Update the working-memory block (user profile / scratchpad). Provide the COMPLETE updated content — existing values are replaced.',
                parameters: z.object({
                    threadId: z.string().describe('The conversation thread id.'),
                    resourceId: z.string().describe('The user / resource id this memory belongs to.'),
                    workingMemory: z.string().min(1).describe(
                        this.workingMemoryCfg.kind === 'schema'
                            ? 'A JSON object with the fields to update.'
                            : 'The complete new working-memory content.',
                    ),
                }),
                execute: async (input) => {
                    const { threadId, resourceId, workingMemory } = input as { threadId: string; resourceId: string; workingMemory: string };
                    await this.updateWorkingMemory({ threadId, resourceId, workingMemory });
                    return { updated: true };
                },
            });
        }

        const om = this._observationalCfg ? this._ensureObservational() : undefined;
        if (om && om.retrieval) {
            tools.push({
                name: 'recall_memory',
                description:
                    'Browse the raw messages behind your observational memory. Use when you need the exact wording, tool output, or chronology of an earlier exchange that was compressed into observations. Pass a semantic `query` for relevance search, or omit it to page through recent messages.',
                parameters: z.object({
                    threadId: z.string().describe('The conversation thread id.'),
                    query: z.string().optional().describe('Optional semantic search for relevant past messages.'),
                    limit: z.number().int().min(1).max(100).optional().describe('Max messages (default 20).'),
                }),
                execute: async (input) => {
                    const { threadId, query, limit } = input as { threadId: string; query?: string; limit?: number };
                    if (query) {
                        if (!this.semantic) {
                            return { messages: [], note: 'Semantic recall is not configured on this memory instance.' };
                        }
                        const { messages } = await this.recall({ threadId, vectorSearchString: query, perPage: limit ?? 20 });
                        return { messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })) };
                    }
                    const { messages } = await this.listMessages({ threadId, perPage: limit ?? 20 });
                    return { messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })) };
                },
            });
        }

        if (this.mem0Engine) {
            const mem0Tools = createMem0MemoryTools(this.mem0Engine);
            for (const tool of Object.values(mem0Tools)) {
                tools.push({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters as import('../validation/index.js').SchemaInput<unknown, unknown>,
                    execute: async (input) => tool.execute(input as never),
                });
            }
        }
        return tools;
    }

    /** Convenience: render working memory as a system-prompt block. */
    async renderWorkingMemory(threadId: string, resourceId: string): Promise<string | undefined> {
        const value = await this.getWorkingMemory({ threadId, resourceId });
        if (!value) return undefined;
        return `[Working Memory]\n${value}`;
    }

    /** Combine recalled messages + history the way the context expects: chronological + deduped. */
    async composeThreadMessages(threadId: string, recall: StorageMessage[] = []): Promise<StorageMessage[]> {
        const history = await this.store.getMessages(threadId, { limit: this.lastMessages });
        return mergeMessagesByTimestamp<StorageMessage & { createdAt?: string }>(history, recall);
    }

    /** Full, ordered conversation for a thread (assistant + user + tool messages). */
    async getThreadMessagesConvo(threadId: string, limit = 200): Promise<Message[]> {
        const rows = await this.store.getMessages(threadId, { limit });
        return filterSystemMessages(rows).map((r) => storageToMessage(r) as Message);
    }
}

// ── Re-exports (convenience) ────────────────────────────────────────────────

export type { Thread, ThreadState, StorageMessage } from './threads.js';
export {
    Mem0Memory,
    InMemoryMem0Store,
    createMem0MemoryTools,
    type Mem0Store,
    type Mem0Fact,
    type ExtractedMemory,
    type MemFactOp,
    type Mem0MemoryConfig,
    type Mem0WriteOptions,
} from './mem0.js';
export {
    Extractor,
    ObservationalMemoryManager,
    type ObservationalMemoryConfig,
    type ObservationalMemoryManagerOptions,
    type ObservationEvent,
    type ReflectionEvent,
    type ObservationContextResult,
} from './observational-memory.js';
export {
    WorkingMemoryManager,
    resolveWorkingMemory,
    DEFAULT_WORKING_MEMORY_TEMPLATE,
    deepMerge,
    mergeWorkingMemory,
    resourceThreadId,
    type WorkingMemoryConfig,
    type WorkingMemoryScope,
    type WorkingMemoryKind,
    type ResolvedWorkingMemory,
} from './working-memory.js';
