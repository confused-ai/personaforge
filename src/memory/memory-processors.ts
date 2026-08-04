/**
 * @personaforge/memory — memory processors (Mastra-style inspired).
 *
 * Standalone `Processor` implementations for the framework's agent processor
 * pipeline. When a `Memory` instance is wired onto an agent, these are the
 * pieces that move history, working memory, semantic recall and observations in
 * and out of the model context:
 *
 * - {@link MessageHistoryProcessor}   — load last-N messages (input), persist new ones (output)
 * - {@link SemanticRecallProcessor}   — RAG recall over past messages (input), embed+store new ones (output)
 * - {@link WorkingMemoryProcessor}    — inject the working-memory blob as a system message
 * - {@link TokenLimiterProcessor}     — keep the prompt under a token budget
 * - {@link ObservationalMemoryProcessor} — compress history into an observation log + persist
 * - {@link Mem0ExtractionProcessor}   — extract & store mem0-style facts after each turn
 *
 * They run inside the framework's processor pipeline (input before the loop,
 * output after), reading `threadId` / `resourceId` from `ProcessorContext`.
 */

import type { Message } from '../core/index.js';
import type {
    Processor,
    ProcessInputArgs,
    ProcessInputResult,
    ProcessLLMRequestArgs,
    ProcessLLMRequestResult,
    ProcessOutputResultArgs,
} from '../processors/types.js';
import type { ThreadStore } from './thread-store.js';
import type { StorageMessage } from './threads.js';
import { textOfContent } from './threads.js';
import { estimateConversationTokens, estimateTokenCount, isHashingEmbedder, type TokenEstimator } from './token-estimator.js';
import type { EmbeddingProvider, MemoryType, VectorStoreAdapter } from './types.js';
import type { ObservationalMemoryManager } from './observational-memory.js';
import type { Mem0Memory } from './mem0.js';
import type { WorkingMemoryManager } from './working-memory.js';

/** Extract the new (post-run) messages to persist, dropping injected system lines. */
export function newMessagesFromRun(inputCount: number, messages: Message[]): Message[] {
    return messages.slice(inputCount).filter((m) => m.role !== 'system');
}

/** Minimal message shape accepted by the memory converters (core + contracts + SDK). */
export interface MemoryMessageInput {
    role?: string;
    content?: unknown;
    name?: string;
    toolCallId?: string;
    tool_call_id?: string;
    toolCalls?: unknown;
    tool_calls?: unknown;
    metadata?: Record<string, unknown>;
}

/** Convert a framework/SDK conversation message into a storable row. */
export function messageToStorage(message: MemoryMessageInput): StorageMessage {
    return {
        role: (message.role as StorageMessage['role']) ?? 'user',
        content: (message.content as string | readonly unknown[]) ?? '',
        ...(message.tool_call_id ? { toolCallId: message.tool_call_id } : {}),
        ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
        ...(message.tool_calls ? { toolCalls: message.tool_calls as readonly unknown[] } : {}),
        ...(message.toolCalls ? { toolCalls: message.toolCalls as readonly unknown[] } : {}),
        ...(message.name ? { name: message.name } : {}),
        ...(message.metadata ? { metadata: message.metadata } : {}),
    };
}

/** Convert a stored row back into a framework conversation Message. */
export function storageToMessage(message: StorageMessage): Message {
    return {
        role: message.role,
        content: message.content as string | unknown[],
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
        ...(message.toolCalls ? { tool_calls: message.toolCalls as Message['tool_calls'] } : {}),
        ...(message.name ? { name: message.name } : {}),
    } as Message;
}

/** Insert messages before the last user message (typical for history/recall). */
export function insertBeforeLastUser(base: Message[], incoming: Message[]): Message[] {
    if (incoming.length === 0) return base;
    let lastUserIndex = -1;
    for (let i = base.length - 1; i >= 0; i--) {
        if (base[i]?.role === 'user') {
            lastUserIndex = i;
            break;
        }
    }
    const formatted = incoming.map((m) => (m.role === 'assistant' ? m : m));
    if (lastUserIndex < 0) return [...base, ...formatted];
    return [...base.slice(0, lastUserIndex), ...formatted, ...base.slice(lastUserIndex)];
}

/** Prepend a system block after existing system messages (keeps instructions first). */
export function injectSystemBlock(base: Message[], content: string): Message[] {
    if (!content) return base;
    const systemIdx = base.findIndex((m) => m.role !== 'system');
    const block: Message = { role: 'system', content };
    if (systemIdx < 0) return [...base, block];
    return [...base.slice(0, systemIdx), block, ...base.slice(systemIdx)];
}

function tokenize(text: string): Set<string> {
    return new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
}

// ── MessageHistory ─────────────────────────────────────────────────────────

export interface MessageHistoryProcessorConfig {
    store: ThreadStore;
    /** Number of recent messages to load into context. Default 20. */
    lastMessages: number;
}

/** Load recent message history (input) and persist new messages (output). */
export class MessageHistoryProcessor implements Processor {
    readonly id = 'pf-message-history';
    constructor(private readonly cfg: MessageHistoryProcessorConfig) {}

    async processInput(args: ProcessInputArgs): Promise<ProcessInputResult> {
        const { threadId } = args.context;
        if (!threadId) return args.messages;
        const history = await this.cfg.store.getMessages(threadId, {
            limit: this.cfg.lastMessages,
            includeToolMessages: true,
        });
        args.state['inputCount'] = args.messages.length;
        const conversation = history.map(storageToMessage);
        return insertBeforeLastUser(args.messages, conversation);
    }

    async processOutputResult(args: ProcessOutputResultArgs): Promise<void> {
        const { threadId } = args.context;
        const inputCount = (args.state['inputCount'] as number | undefined) ?? 0;
        if (!threadId) return;
        const newMessages = newMessagesFromRun(inputCount, args.messages);
        if (newMessages.length === 0) return;
        await this.cfg.store.saveMessages(threadId, newMessages.map(messageToStorage));
    }
}

// ── SemanticRecall ─────────────────────────────────────────────────────────

export interface SemanticRecallProcessorConfig {
    store: ThreadStore;
    vectorStore: VectorStoreAdapter;
    embedder: EmbeddingProvider;
    /** Messages to retrieve. Default 3. */
    topK?: number;
    /** Source messages to include around each match. Default 0. */
    messageRange?: number;
    /** `resource` (default) searches all threads for the resource; `thread` only the current one. */
    scope?: 'thread' | 'resource';
    /** Persist embeddings on output. Default true. */
    storeOnOutput?: boolean;
    tokenEstimator?: TokenEstimator;
}

/** RAG recall over past messages (input) + embed & store new messages (output). */
export class SemanticRecallProcessor implements Processor {
    readonly id = 'pf-semantic-recall';
    private readonly topK: number;
    private readonly messageRange: number;
    private readonly scope: 'thread' | 'resource';
    private readonly storeOnOutput: boolean;
    private readonly estimator: TokenEstimator;

    constructor(private readonly cfg: SemanticRecallProcessorConfig) {
        this.topK = cfg.topK ?? 3;
        this.messageRange = cfg.messageRange ?? 0;
        this.scope = cfg.scope ?? 'resource';
        this.storeOnOutput = cfg.storeOnOutput ?? true;
        this.estimator = cfg.tokenEstimator ?? estimateTokenCount;
    }

    async processInput(args: ProcessInputArgs): Promise<ProcessInputResult> {
        const { threadId, resourceId } = args.context;
        if (!threadId) return args.messages;
        const lastUser = [...args.messages].reverse().find((m) => m.role === 'user');
        if (!lastUser) return args.messages;
        args.state['inputCount'] = args.messages.length;
        const query = textOfContent(lastUser.content as string | readonly unknown[]);
        if (!query.trim()) return args.messages;
        const recalled = await this.recall(query, { threadId, resourceId: resourceId ?? 'resource' });
        if (recalled.length === 0) return args.messages;
        // Interleave recalled messages with existing history by timestamp + dedup by id.
        const existing = args.messages;
        const all = [...existing, ...recalled.map(storageToMessage)];
        all.sort((a, b) => {
            const ta = (a as Message & { createdAt?: string }).createdAt ?? '';
            const tb = (b as Message & { createdAt?: string }).createdAt ?? '';
            return ta.localeCompare(tb);
        });
        const seen = new Set<string>();
        const merged = all.filter((m) => {
            const id = (m as Message & { id?: string }).id;
            if (id == null) return true;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });
        // ensure the new user message remains last
        return insertBeforeLastUser(merged, []);
    }

    async processOutputResult(args: ProcessOutputResultArgs): Promise<void> {
        const { threadId, resourceId } = args.context;
        const inputCount = (args.state['inputCount'] as number | undefined) ?? 0;
        if (!this.storeOnOutput || !threadId) return;
        const fresh = newMessagesFromRun(inputCount, args.messages);
        if (fresh.length === 0) return;
        const stored = await this.cfg.store.saveMessages(threadId, fresh.map(messageToStorage));
        await this.embedAndIndex(stored, threadId, resourceId ?? 'resource').catch(() => undefined);
    }

    /** Semantic recall of stored messages for a query (used by the processor and `Memory.recall`). */
    async recall(query: string, opts: { threadId: string; resourceId?: string; limit?: number }): Promise<StorageMessage[]> {
        const requested = opts.limit ?? this.topK;
        const filter: Record<string, unknown> = {};
        if (this.scope === 'thread') filter['threadId'] = opts.threadId;
        else if (opts.resourceId) filter['resourceId'] = opts.resourceId;
        const vector = await this.cfg.embedder.embed(query);
        const neighborBoost = this.messageRange * 2 + 1;
        const results = await this.cfg.vectorStore.search(vector, Math.max(requested * neighborBoost, 1), filter);
        const ranked = isHashingEmbedder(this.cfg.embedder)
            ? this._boostLexicalOverlap(query, results)
            : results;
        const out: StorageMessage[] = [];
        const seen = new Set<string>();
        for (const result of ranked) {
            const id = String(result.id);
            if (seen.has(id)) continue;
            seen.add(id);
            out.push(this._fromMetadata(result.metadata, id));
            if (out.length >= requested) break;
        }
        return out;
    }

    /**
     * The zero-config hashing embedder is bag-of-words: cosine captures crude
     * topical similarity but struggles with sparse one-off messages. Re-rank by
     * lexical overlap so exact keywords win deterministically.
     */
    private _boostLexicalOverlap(
        query: string,
        results: Array<{ id: string | number; score: number; metadata: Record<string, unknown> }>,
    ): Array<{ id: string | number; score: number; metadata: Record<string, unknown> }> {
        const queryTokens = tokenize(query);
        return [...results]
            .map((result) => {
                const content = String(result.metadata['content'] ?? '');
                const contentTokens = tokenize(content);
                let overlap = 0;
                for (const token of contentTokens) if (queryTokens.has(token)) overlap++;
                return { result, overlap };
            })
            .sort((a, b) => b.overlap - a.overlap)
            .map((x) => x.result);
    }

    /** Embed + index stored messages for future recall (used by the processor and callers). */
    async embedAndIndex(messages: StorageMessage[], threadId: string, resourceId: string): Promise<void> {
        const valid = messages.filter((m) => textOfContent(m.content).trim());
        if (valid.length === 0) return;
        const vectors = await this.cfg.embedder.embedBatch(valid.map((m) => textOfContent(m.content)));
        await this.cfg.vectorStore.upsert(
            valid.map((m, i) => ({
                id: m.id!,
                vector: vectors[i]!,
                metadata: {
                    content: textOfContent(m.content),
                    threadId,
                    resourceId,
                    role: m.role,
                    name: m.name,
                    createdAt: m.createdAt,
                },
            })),
        );
    }

    private _fromMetadata(metadata: Record<string, unknown>, id: string): StorageMessage {
        return {
            id,
            threadId: metadata['threadId'] as string | undefined,
            role: (metadata['role'] as StorageMessage['role']) ?? 'user',
            content: (metadata['content'] as string) ?? '',
            createdAt: (metadata['createdAt'] as string) ?? undefined,
            name: metadata['name'] as string | undefined,
        };
    }
}

// ── WorkingMemory ──────────────────────────────────────────────────────────

export interface WorkingMemoryProcessorConfig {
    workingMemory: WorkingMemoryManager;
    scope?: 'resource' | 'thread';
}

/** Inject the working-memory blob as a system message on input. */
export class WorkingMemoryProcessor implements Processor {
    readonly id = 'pf-working-memory';
    private readonly scope: 'resource' | 'thread';
    constructor(private readonly cfg: WorkingMemoryProcessorConfig) {
        this.scope = cfg.scope ?? 'resource';
    }

    async processInput(args: ProcessInputArgs): Promise<ProcessInputResult> {
        const { threadId, resourceId } = args.context;
        if (!threadId) return args.messages;
        const value = await this.cfg.workingMemory.get({ threadId, resourceId: resourceId ?? 'resource', scope: this.scope });
        if (!value) return args.messages;
        return injectSystemBlock(args.messages, `[Working Memory]\n${value}`);
    }
}

// ── TokenLimiter ───────────────────────────────────────────────────────────

export interface TokenLimiterProcessorConfig {
    /** Maximum prompt tokens after trimming. */
    limit: number;
    tokenEstimator?: TokenEstimator;
}

/** Trim the oldest non-system messages when the prompt exceeds the token budget. */
export class TokenLimiterProcessor implements Processor {
    readonly id = 'pf-token-limiter';
    private readonly estimator: TokenEstimator;
    constructor(private readonly cfg: TokenLimiterProcessorConfig) {
        this.estimator = cfg.tokenEstimator ?? estimateTokenCount;
    }

    processLLMRequest(args: ProcessLLMRequestArgs): ProcessLLMRequestResult {
        const budget = this.cfg.limit;
        let total = estimateConversationTokens(args.messages, this.estimator);
        if (total <= budget) return {};
        const keptSystem = args.messages.filter((m) => m.role === 'system');
        const conversation = args.messages.filter((m) => m.role !== 'system');
        const dropped: Message[] = [];
        while (conversation.length > 0 && total > budget) {
            const oldest = conversation.shift();
            if (!oldest) break;
            total -= this.estimator(textOfContent(oldest.content as string | readonly unknown[])) + 4;
            dropped.push(oldest);
        }
        return { messages: [...keptSystem, ...conversation] };
    }
}

// ── ObservationalMemory ────────────────────────────────────────────────────

export interface ObservationalMemoryProcessorConfig {
    manager: ObservationalMemoryManager;
    store: ThreadStore;
}

/**
 * Input: load the OM context window (recent unobserved messages + observation
 * log as a system block + continuation reminder).
 * Output: persist new messages and kick off background buffering.
 */
export class ObservationalMemoryProcessor implements Processor {
    readonly id = 'pf-observational-memory';
    constructor(private readonly cfg: ObservationalMemoryProcessorConfig) {}

    async processInput(args: ProcessInputArgs): Promise<ProcessInputResult> {
        const { threadId, resourceId } = args.context;
        if (!threadId) return args.messages;
        args.state['inputCount'] = args.messages.length;
        const window = await this.cfg.manager.getContextWindow({ threadId, resourceId: resourceId ?? 'resource' });
        let out = args.messages;
        if (window.system) out = injectSystemBlock(out, window.system);
        if (window.continuation) out = injectSystemBlock(out, `[Continuation]\n${window.continuation}`);
        const recent = window.messages.map((m) => storageToMessage(m as StorageMessage));
        out = insertBeforeLastUser(out, recent);
        return out;
    }

    async processOutputResult(args: ProcessOutputResultArgs): Promise<void> {
        const { threadId, resourceId } = args.context;
        const inputCount = (args.state['inputCount'] as number | undefined) ?? 0;
        if (!threadId) return;
        const newMessages = newMessagesFromRun(inputCount, args.messages);
        if (newMessages.length > 0) {
            await this.cfg.store.saveMessages(threadId, newMessages.map(messageToStorage));
        }
        await this.cfg.manager.afterTurn({ threadId, resourceId: resourceId ?? 'resource' });
    }
}

// ── Mem0 extraction ────────────────────────────────────────────────────────

export interface Mem0ExtractionProcessorConfig {
    mem0: Mem0Memory;
    /** Extract facts from this many trailing messages. Default 20. */
    maxMessages?: number;
}

/** Extract mem0-style facts from each turn and store them. */
export class Mem0ExtractionProcessor implements Processor {
    readonly id = 'pf-mem0-extraction';
    private readonly maxMessages: number;
    constructor(private readonly cfg: Mem0ExtractionProcessorConfig) {
        this.maxMessages = cfg.maxMessages ?? 20;
    }

    async processOutputResult(args: ProcessOutputResultArgs): Promise<void> {
        const { resourceId, agentId } = args.context;
        const inputCount = (args.state['inputCount'] as number | undefined) ?? 0;
        const fresh = newMessagesFromRun(inputCount, args.messages)
            .map(messageToStorage)
            .slice(-this.maxMessages);
        if (fresh.length === 0) return;
        try {
            await this.cfg.mem0.processMessages(fresh as unknown as Array<{ role: string; content: unknown }>, {
                userID: resourceId,
                agentID: agentId,
            });
        } catch {
            // extraction is best-effort; never break the agent loop
        }
    }
}

export type { MemoryType };
