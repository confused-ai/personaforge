/**
 * @personaforge/memory — Mem0-style fact memory engine.
 *
 * A mem0-compatible memory layer: discrete, often short fact entries the
 * assistant can commit, update and delete, rather than raw message history.
 *
 * - **Extraction**: an LLM reads a conversation and emits `ADD / UPDATE / NONE /
 *   DELETE / NOOP` operations with fact content — the mem0 "extract memories"
 *   pipeline.
 * - **CRUD API**: `add`, `search`, `getAll`, `update`, `delete`, `getHistory`,
 *   `reset` — matching mem0's Memory class surface.
 * - **Search**: semantic (vector store + embedder) with optional LLM re-ranking,
 *   falling back to keyword scoring when no embedder is configured.
 * - **Tools**: `search_mem0`, `add_mem0`, `get_all_memories`, `delete_memory`
 *   so the agent self-manages its memory.
 *
 * ```ts
 * const memory = new Mem0Memory({
 *   llm,                                   // for extraction / ranking
 *   embedder: new OpenAIEmbeddingProvider(), // optional — semantic search
 *   vectorStore: new InMemoryVectorStore(),  // optional — semantic search
 * });
 * await memory.add('User prefers dark mode', { userID: 'alice' });
 * await memory.search('what theme do I like?');
 * ```
 */

import { z } from 'zod';
import type { LLMProvider, Message } from '../contracts/index.js';
import type { EmbeddingProvider, VectorStoreAdapter } from './types.js';
import { newId } from '../contracts/index.js';
import type { SchemaInput } from '../validation/index.js';

// ── Store ──────────────────────────────────────────────────────────────────

export interface Mem0Fact {
    readonly id: string;
    readonly content: string;
    /** Metadata incl. userID / agentID / runID / category / created_at / updated_at. */
    readonly metadata: Record<string, unknown>;
    readonly createdAt: string;
    readonly updatedAt: string;
    /** Stable content hash used to deduplicate equivalent facts. */
    readonly hash?: string;
    /** Present on search results. */
    readonly score?: number;
}

export interface Mem0ListOptions {
    userID?: string;
    agentID?: string;
    runID?: string;
    category?: string;
    limit?: number;
}

export interface Mem0Store {
    list(options?: Mem0ListOptions): Promise<Mem0Fact[]>;
    get(id: string): Promise<Mem0Fact | null>;
    upsert(fact: Omit<Mem0Fact, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<Mem0Fact, 'id'>>): Promise<Mem0Fact>;
    delete(id: string): Promise<boolean>;
    reset(): Promise<void>;
    /** Find a fact by its content hash (for dedup/update). Optional — falls back to in-memory scan. */
    findByHash?(hash: string): Promise<Mem0Fact | null>;
    /** Append an audit entry (action + content) for `getHistory`. Optional. */
    log?(entry: { action: string; id?: string; content?: string; createdAt: string }): Promise<void>;
}

/** In-memory mem0 store. */
export class InMemoryMem0Store implements Mem0Store {
    private readonly facts = new Map<string, Mem0Fact>();
    private readonly history: Array<{ action: string; id?: string; content?: string; createdAt: string }> = [];

    async list(options: Mem0ListOptions = {}): Promise<Mem0Fact[]> {
        let out = [...this.facts.values()];
        if (options.userID) out = out.filter((f) => f.metadata['userID'] === options.userID);
        if (options.agentID) out = out.filter((f) => f.metadata['agentID'] === options.agentID);
        if (options.runID) out = out.filter((f) => f.metadata['runID'] === options.runID);
        if (options.category) out = out.filter((f) => f.metadata['category'] === options.category);
        out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return options.limit ? out.slice(0, options.limit) : out;
    }

    async get(id: string): Promise<Mem0Fact | null> {
        return this.facts.get(id) ?? null;
    }

    async upsert(fact: Omit<Mem0Fact, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<Mem0Fact, 'id'>>): Promise<Mem0Fact> {
        const now = new Date().toISOString();
        const id = fact.id ?? newId('mem0');
        const existing = this.facts.get(id);
        const row: Mem0Fact = {
            id,
            content: fact.content,
            metadata: { ...fact.metadata },
            hash: fact.hash,
            createdAt: existing?.createdAt ?? now,
            updatedAt: existing?.updatedAt ?? now,
        };
        this.facts.set(id, row);
        await this.log?.({ action: existing ? 'UPDATE' : 'ADD', id, content: fact.content, createdAt: now });
        return row;
    }

    async delete(id: string): Promise<boolean> {
        const existed = this.facts.delete(id);
        if (existed) await this.log?.({ action: 'DELETE', id, createdAt: new Date().toISOString() });
        return existed;
    }

    async reset(): Promise<void> {
        this.facts.clear();
        this.history.length = 0;
    }

    async findByHash(hash: string): Promise<Mem0Fact | null> {
        for (const fact of this.facts.values()) {
            if (fact.hash === hash) return fact;
        }
        return null;
    }

    async log(entry: { action: string; id?: string; content?: string; createdAt: string }): Promise<void> {
        this.history.push(entry);
    }

    /** Audit trail (ADD / UPDATE / DELETE entries). */
    get audit(): Array<{ action: string; id?: string; content?: string; createdAt: string }> {
        return [...this.history];
    }
}

// ── Extraction ─────────────────────────────────────────────────────────────

export type MemFactOp = 'ADD' | 'UPDATE' | 'NONE' | 'DELETE' | 'NOOP';

export interface ExtractedMemory {
    content: string;
    op: MemFactOp;
    /** Content to replace when `op === 'UPDATE'`. */
    oldContent?: string;
    metadata?: Record<string, unknown>;
}

export interface Mem0MemoryConfig {
    /** LLM used for extraction and optional re-ranking. Required for extraction. */
    llm?: LLMProvider;
    /** Embedder for semantic search. When absent, search uses keyword scoring. */
    embedder?: EmbeddingProvider;
    /** Vector store for semantic search. */
    vectorStore?: VectorStoreAdapter;
    /** Explicit fact store. Defaults to an in-memory store. */
    store?: Mem0Store;
    /** Max results from `search` when LLM ranking is disabled. Default 5. */
    maxResults?: number;
    /** Re-rank top candidates with the LLM. Default true when an llm is provided. */
    rankWithLlm?: boolean;
}

/** Conversation-message shape accepted by extraction (superset of `Message`). */
export type Mem0MessageInput = { role: string; content: unknown } | Message;

const DEFAULT_SEARCH_PROMPT =
    'You are a memory search ranker. Given a query and candidate memories, return the indices of the ' +
    'most relevant candidates, most relevant first, as a JSON array of integers. Keep at most {limit}. ' +
    'Only include genuinely relevant memories; return [] if none are relevant.';

export class Mem0Memory {
    readonly store: Mem0Store;
    private llm?: LLMProvider;
    private readonly embedder?: EmbeddingProvider;
    private readonly vectorStore?: VectorStoreAdapter;
    private readonly maxResults: number;
    private readonly rankWithLlm: boolean;

    constructor(config: Mem0MemoryConfig = {}) {
        this.store = config.store ?? new InMemoryMem0Store();
        this.llm = config.llm;
        this.embedder = config.embedder;
        this.vectorStore = config.vectorStore;
        this.maxResults = config.maxResults ?? 5;
        this.rankWithLlm = config.rankWithLlm ?? !!config.llm;
    }

    /** Bind a fallback LLM (e.g. the agent's model) for extraction/ranking. */
    setLlm(llm: LLMProvider | undefined): void {
        if (!llm) return;
        if (!this.llm) this.llm = llm;
    }

    // ── CRUD (mem0-compatible) ──────────────────────────────────────────────

    /** Add a single fact. Deduplicates equivalent facts by content hash. */
    async add(content: string, options: Mem0WriteOptions = {}): Promise<string> {
        const { userID, agentID, runID, metadata } = normalizeWriteOptions(options);
        const hash = contentHash(content);
        const existing = this.store.findByHash ? await this.store.findByHash(hash) : null;
        const now = new Date().toISOString();
        let fact: Mem0Fact;
        if (existing) {
            fact = await this.store.upsert({
                id: existing.id,
                content,
                metadata: { ...existing.metadata, ...metadata, userID, agentID },
                hash,
            });
        } else {
            fact = await this.store.upsert({
                content,
                metadata: { ...metadata, userID, agentID, ...(runID ? { runID } : {}), created_at: now, updated_at: now },
                hash,
            });
        }
        await this.index(fact);
        return fact.id;
    }

    /** Add several facts at once. */
    async addMemories(contents: string[], options: Mem0WriteOptions = {}): Promise<string[]> {
        const ids: string[] = [];
        for (const content of contents) ids.push(await this.add(content, options));
        return ids;
    }

    /** Search stored facts by meaning (or keyword when no embedder is set). */
    async search(query: string, options: { userID?: string; agentID?: string; runID?: string; limit?: number; useLLMRanking?: boolean } = {}): Promise<Mem0Fact[]> {
        const limit = options.limit ?? this.maxResults;
        const candidates = await this.searchCandidates(query, { userID: options.userID, agentID: options.agentID, runID: options.runID, limit: Math.max(limit, 20) });
        const wantsRank = options.useLLMRanking ?? this.rankWithLlm;
        if (wantsRank && this.llm && candidates.length > 1) {
            const ranked = await this.rankWithLlmCandidates(query, candidates, limit);
            if (ranked) return ranked;
        }
        return candidates.slice(0, limit);
    }

    /** Synonym of `search`. */
    async searchMemories(query: string, options: Parameters<Mem0Memory['search']>[1] = {}): Promise<Mem0Fact[]> {
        return this.search(query, options);
    }

    async getAll(options: Mem0ListOptions = {}): Promise<Mem0Fact[]> {
        return this.store.list(options);
    }

    /** Update a fact by id (or content if id is omitted and a hash match exists). */
    async update(id: string, content: string, options: Mem0WriteOptions = {}): Promise<Mem0Fact> {
        const existing = await this.store.get(id);
        if (!existing) throw new Error(`Mem0Memory: fact "${id}" not found`);
        const fact = await this.store.upsert({
            id: existing.id,
            content,
            metadata: { ...existing.metadata, ...normalizeWriteOptions(options).metadata },
            hash: contentHash(content),
        });
        await this.reindex(existing, fact);
        return fact;
    }

    /** Bulk update using content (matching by id or hash). */
    async updateMemories(facts: Array<{ id?: string; content: string }>, options: Mem0WriteOptions = {}): Promise<string[]> {
        const ids: string[] = [];
        for (const fact of facts) {
            if (fact.id) {
                await this.update(fact.id, fact.content, options);
                ids.push(fact.id);
                continue;
            }
            const hash = contentHash(fact.content);
            const existing = this.store.findByHash ? await this.store.findByHash(hash) : null;
            if (existing) {
                await this.update(existing.id, fact.content, options);
                ids.push(existing.id);
            } else {
                ids.push(await this.add(fact.content, options));
            }
        }
        return ids;
    }

    async delete(factId: string): Promise<boolean> {
        const existing = await this.store.get(factId);
        const removed = await this.store.delete(factId);
        if (removed && existing) {
            await this.deindex(existing);
        }
        return removed;
    }

    async reset(): Promise<void> {
        await this.store.reset();
        if (this.vectorStore) await this.vectorStore.clear().catch(() => undefined);
    }

    /** Audit history of ADD / UPDATE / DELETE operations, newest last. */
    async getHistory(options: { userID?: string; agentID?: string } = {}): Promise<Array<{ action: string; id?: string; content?: string; createdAt: string }>> {
        const store = this.store as InMemoryMem0Store;
        if (typeof store.audit !== 'undefined') {
            let entries = store.audit;
            // in-memory store doesn't scope history by user; filter by resolving ids is overkill — return all
            void options;
            return entries;
        }
        return this.auditFromFacts(options);
    }

    private async auditFromFacts(options: { userID?: string; agentID?: string }): Promise<Array<{ action: string; id?: string; content?: string; createdAt: string }>> {
        const facts = options.userID || options.agentID
            ? await this.store.list({ userID: options.userID, agentID: options.agentID })
            : await this.store.list();
        return facts.map((f) => ({ action: 'ADD', id: f.id, content: f.content, createdAt: f.createdAt }));
    }

    // ── Extraction ──────────────────────────────────────────────────────────

    /** Use the LLM to extract memory operations from a conversation. */
    async extract(messages: Mem0MessageInput[], options: Mem0ExtractOptions = {}): Promise<ExtractedMemory[]> {
        if (!this.llm) throw new Error('Mem0Memory.extract requires an `llm` (constructor option).');
        const transcript = messages
            .map((m) => {
                const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                return `[${m.role}]: ${text}`;
            })
            .join('\n');
        const ops = options.enforceCategories ? ' with a `category` for each' : '';
        const response = await this.llm.generateText(
            [
                {
                    role: 'system',
                    content:
                        'Extract new, concrete memories from the conversation as discrete short facts.\n' +
                        'For each memory choose the operation:\n' +
                        '- ADD: a new fact to remember.\n' +
                        '- UPDATE: a fact that changes or corrects an earlier one (include old_content).\n' +
                        '- NONE: trivial or already-known information.\n' +
                        '- DELETE: a fact that is now invalid (include old_content of the fact to remove).\n' +
                        `Return ONLY JSON: {"memories":[{"content":"...","op":"ADD|UPDATE|NONE|DELETE","old_content":"..."${ops}}]}`,
                },
                { role: 'user', content: transcript },
            ],
            { temperature: 0, maxTokens: 1000, toolChoice: 'none' },
        );
        const data = parseMem0Json(response.text ?? '');
        if (!data || !Array.isArray(data.memories)) return [];
        const seen = new Set<string>();
        const out: ExtractedMemory[] = [];
        for (const raw of data.memories) {
            const op = String(raw.op ?? 'ADD').toUpperCase() as MemFactOp;
            const content = typeof raw.content === 'string' ? raw.content.trim() : '';
            if (!content || seen.has(content)) continue;
            seen.add(content);
            out.push({
                content,
                op: op === 'NOOP' ? 'NONE' : op,
                oldContent: typeof raw.old_content === 'string' ? raw.old_content : undefined,
                ...(raw.category ? { metadata: { category: String(raw.category) } } : {}),
            });
        }
        return out;
    }

    /**
     * mem0's main pipeline: extract memory operations from a conversation and
     * apply them to the store. Returns the extracted operations.
     */
    async processMessages(messages: Mem0MessageInput[], options: Mem0ExtractOptions & Mem0WriteOptions = {}): Promise<ExtractedMemory[]> {
        const extracted = await this.extract(messages, options);
        await this.applyOperations(extracted, options);
        return extracted;
    }

    /** Apply already-extracted operations to the store. */
    async applyOperations(operations: ExtractedMemory[], options: Mem0WriteOptions = {}): Promise<void> {
        for (const op of operations) {
            switch (op.op) {
                case 'ADD':
                    await this.add(op.content, options);
                    break;
                case 'UPDATE': {
                    const hash = contentHash(op.oldContent ?? '');
                    const existing = (this.store.findByHash ? await this.store.findByHash(hash) : null) ?? (op.content ? await this.findByContent(op.content) : null);
                    if (existing) await this.update(existing.id, op.content, options);
                    else await this.add(op.content, options);
                    break;
                }
                case 'DELETE': {
                    const hash = contentHash(op.oldContent ?? op.content);
                    const existing = this.store.findByHash ? await this.store.findByHash(hash) : null;
                    if (existing) await this.delete(existing.id);
                    break;
                }
                case 'NONE':
                default:
                    break;
            }
        }
    }

    // ── Internals ───────────────────────────────────────────────────────────

    private async searchCandidates(
        query: string,
        opts: { userID?: string; agentID?: string; runID?: string; limit: number },
    ): Promise<Mem0Fact[]> {
        let facts = await this.store.list({ userID: opts.userID, agentID: opts.agentID, runID: opts.runID });
        if (facts.length === 0) return [];
        if (this.embedder && this.vectorStore) {
            const vector = await this.embedder.embed(query);
            const results = await this.vectorStore.search(vector, opts.limit, {});
            return results
                .map((r) => {
                    const content = r.metadata['content'];
                    return { id: String(r.id), content: String(content ?? ''), metadata: (r.metadata ?? {}) as Record<string, unknown>, score: r.score } as Mem0Fact;
                })
                .filter((f) => f.content);
        }
        // keyword scoring fallback
        const tokens = tokenize(query);
        const scored = facts
            .map((fact) => {
                const factTokens = tokenize(fact.content);
                const overlap = Array.from(factTokens).filter((t) => tokens.has(t)).length;
                return { fact, score: overlap / Math.max(1, Math.min(tokens.size, factTokens.size)) };
            })
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score);
        return scored.slice(0, opts.limit).map(({ fact, score }) => ({ ...fact, score }));
    }

    private async rankWithLlmCandidates(query: string, candidates: Mem0Fact[], limit: number): Promise<Mem0Fact[] | null> {
        const llm = this.llm;
        if (!llm) return null;
        const list = candidates.map((c, i) => `${i}: ${c.content}`).join('\n');
        const limitText = limit <= 0 ? '10' : String(limit);
        try {
            const response = await llm.generateText(
                [
                    { role: 'system', content: DEFAULT_SEARCH_PROMPT.replace('{limit}', limitText) },
                    { role: 'user', content: `Query: ${query}\n\nCandidates:\n${list}` },
                ],
                { temperature: 0, maxTokens: 300, toolChoice: 'none' },
            );
            const data = parseJsonArray(response.text ?? '');
            if (!data) return null;
            const indices = data.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < candidates.length);
            const seen = new Set<number>();
            const out: Mem0Fact[] = [];
            for (const idx of indices) {
                if (seen.has(idx)) continue;
                seen.add(idx);
                out.push(candidates[idx]!);
                if (out.length >= limit) break;
            }
            return out.length ? out : null;
        } catch {
            return null;
        }
    }

    private async index(fact: Mem0Fact): Promise<void> {
        if (!this.embedder || !this.vectorStore) return;
        const vector = await this.embedder.embed(fact.content);
        await this.vectorStore.upsert([
            {
                id: fact.id,
                vector,
                metadata: {
                    content: fact.content,
                    ...fact.metadata,
                    userID: fact.metadata['userID'],
                    agentID: fact.metadata['agentID'],
                },
            },
        ]);
    }

    private async reindex(before: Mem0Fact, after: Mem0Fact): Promise<void> {
        if (!this.vectorStore) return;
        await this.deindex(before);
        await this.index(after);
    }

    private async deindex(fact: Mem0Fact): Promise<void> {
        if (!this.vectorStore) return;
        await this.vectorStore.delete([fact.id]).catch(() => undefined);
    }

    private async findByContent(content: string): Promise<Mem0Fact | null> {
        const hash = contentHash(content);
        const existing = this.store.findByHash ? await this.store.findByHash(hash) : null;
        if (existing) return existing;
        const all = await this.store.list();
        return all.find((f) => f.content === content) ?? null;
    }
}

// ── Options & helpers ───────────────────────────────────────────────────────

export interface Mem0WriteOptions {
    userID?: string;
    agentID?: string;
    runID?: string;
    category?: string;
    metadata?: Record<string, unknown>;
}

export interface Mem0ExtractOptions {
    /** Ask the LLM to classify each memory into a category. */
    enforceCategories?: boolean;
}

function normalizeWriteOptions(options: Mem0WriteOptions): {
    userID?: string;
    agentID?: string;
    runID?: string;
    metadata: Record<string, unknown>;
} {
    const metadata: Record<string, unknown> = {
        ...(options.category ? { category: options.category } : {}),
        ...(options.metadata ?? {}),
    };
    return { userID: options.userID, agentID: options.agentID, runID: options.runID, metadata };
}

function contentHash(content: string): string {
    const cleaned = content.trim().toLowerCase().replace(/\s+/g, ' ');
    let h = 2166136261;
    for (let i = 0; i < cleaned.length; i++) {
        h ^= cleaned.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return Math.abs(h).toString(36);
}

function tokenize(text: string): Set<string> {
    return new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
}

function parseMem0Json(text: string): { memories?: Array<Record<string, unknown>> } | null {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try {
        const parsed = JSON.parse(cleaned) as unknown;
        return parsed && typeof parsed === 'object' ? (parsed as { memories?: Array<Record<string, unknown>> }) : null;
    } catch {
        const first = cleaned.indexOf('{');
        const last = cleaned.lastIndexOf('}');
        if (first >= 0 && last > first) {
            try {
                const parsed = JSON.parse(cleaned.slice(first, last + 1)) as unknown;
                return parsed && typeof parsed === 'object' ? (parsed as { memories?: Array<Record<string, unknown>> }) : null;
            } catch {
                return null;
            }
        }
        return null;
    }
}

function parseJsonArray(text: string): number[] | null {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const first = cleaned.indexOf('[');
    const last = cleaned.lastIndexOf(']');
    if (first < 0 || last <= first) return null;
    try {
        const parsed = JSON.parse(cleaned.slice(first, last + 1)) as unknown;
        return Array.isArray(parsed) ? parsed.map(Number) : null;
    } catch {
        return null;
    }
}

// ── Agent tools (lightweight — framework wraps them) ────────────────────────

interface Mem0Tool<TA, TB> {
    readonly name: string;
    readonly description: string;
    readonly parameters: SchemaInput<unknown, TA>;
    execute(input: TA): Promise<TB>;
}

const SearchInput = z.object({
    query: z.string().min(1).max(2000).describe('Search query for your memory.'),
    limit: z.number().int().min(1).max(50).optional().describe('Max results (default 5).'),
});
const AddInput = z.object({
    fact: z.string().min(1).max(10_000).describe('The fact to remember.'),
});
const GetAllInput = z.object({
    limit: z.number().int().min(1).max(1000).optional().describe('Max memories to return (default 100).'),
});
const DeleteInput = z.object({
    id: z.string().min(1).describe('Memory id to delete.'),
});

export interface Mem0Tools {
    search_mem0: Mem0Tool<z.infer<typeof SearchInput>, { memories: Array<{ id: string; content: string; score?: number }> }>;
    add_mem0: Mem0Tool<z.infer<typeof AddInput>, { id: string; stored: true }>;
    get_all_memories: Mem0Tool<z.infer<typeof GetAllInput>, { memories: Array<{ id: string; content: string }> }>;
    delete_memory: Mem0Tool<z.infer<typeof DeleteInput>, { deleted: boolean }>;
}

/** LLM-callable tools that let an agent search and edit its mem0 memory. */
export function createMem0MemoryTools(memory: Mem0Memory): Mem0Tools {
    return {
        search_mem0: {
            name: 'search_mem0',
            description: 'Search your long-term memory for relevant facts by meaning. Use when you need prior context about the user or task.',
            parameters: SearchInput,
            async execute({ query, limit }) {
                const results = await memory.search(query, { limit: limit ?? 5 });
                return { memories: results.map((f) => ({ id: f.id, content: f.content, ...(f.score !== undefined ? { score: f.score } : {}) })) };
            },
        },
        add_mem0: {
            name: 'add_mem0',
            description: 'Commit an important new fact to long-term memory (names, preferences, decisions, constraints).',
            parameters: AddInput,
            async execute({ fact }) {
                const id = await memory.add(fact);
                return { id, stored: true as const };
            },
        },
        get_all_memories: {
            name: 'get_all_memories',
            description: 'List everything currently stored in long-term memory.',
            parameters: GetAllInput,
            async execute({ limit }) {
                const facts = await memory.getAll({ limit: limit ?? 100 });
                return { memories: facts.map((f) => ({ id: f.id, content: f.content })) };
            },
        },
        delete_memory: {
            name: 'delete_memory',
            description: 'Delete a fact from long-term memory by id.',
            parameters: DeleteInput,
            async execute({ id }) {
                return { deleted: await memory.delete(id) };
            },
        },
    };
}
