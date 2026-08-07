/**
 * Memory Distiller
 * =================
 * Background job that consolidates accumulated short-term memory entries into
 * long-term semantic memories using an LLM summarisation pass.
 *
 * Distillation is triggered automatically when:
 *   - The short-term entry count exceeds `triggerThreshold` (default: 20)
 *   - `distillNow()` is called explicitly
 *   - The background interval fires (if `intervalMs` is set)
 *
 * What happens:
 *   1. Retrieve the N oldest short-term entries for a given agentId / sessionId
 *   2. Call the LLM to summarise them into a concise long-term memory blob
 *   3. Store the summary as a LONG_TERM / SEMANTIC memory entry
 *   4. Delete the consumed short-term entries
 *
 * Usage:
 *   import { MemoryDistiller } from './index.js';
 *
 *   const distiller = new MemoryDistiller({
 *     store: myMemoryStore,
 *     llm:   myLLMProvider,
 *     agentId: 'agent-123',
 *   });
 *
 *   distiller.start();               // background polling
 *   await distiller.distillNow();    // force immediate run
 *   distiller.stop();
 */

import type { LLMProvider } from '../core/index.js';
import type { MemoryStore, MemoryEntry, MemoryType } from './types.js';
import { MemoryType as MT } from './types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export interface MemoryDistillerConfig {
    /** Memory store to read from and write to */
    store: MemoryStore;
    /** LLM used to summarise short-term entries */
    llm: LLMProvider;
    /** Scope distillation to entries belonging to this agent */
    agentId?: string;
    /** Scope distillation to entries from this session */
    sessionId?: string;
    /**
     * Number of short-term entries that triggers automatic distillation.
     * Default: 20.
     */
    triggerThreshold?: number;
    /**
     * Max entries to consume in a single distillation pass.
     * Default: 30.
     */
    batchSize?: number;
    /**
     * Background polling interval in ms. If omitted, polling is disabled and
     * you must call `distillNow()` manually or use hooks.
     */
    intervalMs?: number;
    /**
     * Target memory type for the produced summary entry.
     * Default: 'long_term'.
     */
    targetMemoryType?: MemoryType;
    /**
     * Custom tags attached to every produced long-term summary entry.
     * Default: ['distilled'].
     */
    summaryTags?: string[];
    /**
     * Called after each successful distillation pass.
     * Receives the newly created summary entry.
     */
    onDistilled?: (summary: MemoryEntry, consumed: MemoryEntry[]) => void;
    /**
     * Called when a distillation pass encounters an error.
     * Defaults to `console.error`.
     */
    onError?: (err: unknown) => void;
}

// ── Distillation result ───────────────────────────────────────────────────────

export interface DistillationResult {
    /** Number of short-term entries consumed */
    consumed: number;
    /** The produced long-term summary entry */
    summary: MemoryEntry | null;
    /** Whether distillation was skipped (count below threshold) */
    skipped: boolean;
}

// ── MemoryDistiller ───────────────────────────────────────────────────────────

export class MemoryDistiller {
    private readonly _store: MemoryStore;
    private readonly _llm: LLMProvider;
    private readonly _agentId: string | undefined;
    private readonly _sessionId: string | undefined;
    private readonly _triggerThreshold: number;
    private readonly _batchSize: number;
    private readonly _intervalMs: number | undefined;
    private readonly _targetType: MemoryType;
    private readonly _summaryTags: string[];
    private readonly _onDistilled: ((s: MemoryEntry, c: MemoryEntry[]) => void) | undefined;
    private readonly _onError: (err: unknown) => void;

    private _timer: ReturnType<typeof setInterval> | null = null;
    private _running = false;

    constructor(config: MemoryDistillerConfig) {
        this._store          = config.store;
        this._llm            = config.llm;
        this._agentId        = config.agentId;
        this._sessionId      = config.sessionId;
        this._triggerThreshold = config.triggerThreshold ?? 20;
        this._batchSize      = config.batchSize          ?? 30;
        this._intervalMs     = config.intervalMs;
        this._targetType     = config.targetMemoryType   ?? MT.LONG_TERM;
        this._summaryTags    = config.summaryTags        ?? ['distilled'];
        this._onDistilled    = config.onDistilled;
        this._onError        = config.onError ?? ((e) => console.error('[MemoryDistiller]', e));
    }

    /** Start the background polling loop (no-op if already running). */
    start(): this {
        if (this._timer !== null || !this._intervalMs) return this;
        this._timer = setInterval(() => {
            this.distillNow().catch(this._onError);
        }, this._intervalMs);
        this._timer.unref?.();
        return this;
    }

    /** Stop the background polling loop. */
    stop(): this {
        if (this._timer !== null) {
            clearInterval(this._timer);
            this._timer = null;
        }
        return this;
    }

    /**
     * Run a distillation pass immediately.
     * Safe to call concurrently — overlapping runs are debounced.
     */
    async distillNow(force = false): Promise<DistillationResult> {
        if (this._running) return { consumed: 0, summary: null, skipped: true };
        this._running = true;
        try {
            return await this._distill(force);
        } finally {
            this._running = false;
        }
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _distill(force: boolean): Promise<DistillationResult> {
        // Fetch candidate short-term entries
        const entries = await this._fetchShortTerm(this._batchSize);

        if (!force && entries.length < this._triggerThreshold) {
            return { consumed: 0, summary: null, skipped: true };
        }

        if (entries.length === 0) {
            return { consumed: 0, summary: null, skipped: true };
        }

        // Build summarisation prompt
        const prompt = _buildSummarisationPrompt(entries, this._agentId, this._sessionId);

        const { text } = await this._llm.generateText(
            [{ role: 'system', content: 'You are a concise memory summariser for an AI agent. Condense the supplied short-term memory entries into a single, dense long-term memory paragraph. Preserve all key facts. Return only the summary paragraph — no preamble, no metadata.' },
             { role: 'user', content: prompt }],
            { maxTokens: 800, temperature: 0.3 },
        );

        const summaryText = text.trim();
        if (!summaryText) {
            return { consumed: 0, summary: null, skipped: false };
        }

        // Persist the long-term summary
        const stored = await this._store.store({
            type: this._targetType,
            content: summaryText,
            metadata: {
                source:     'distiller',
                importance: 0.8,
                tags:       [...this._summaryTags, `batch:${entries.length}`],
                ...(this._agentId   ? { agentId:   this._agentId   } : {}),
                ...(this._sessionId ? { sessionId: this._sessionId } : {}),
                custom: { distilledAt: new Date().toISOString(), inputCount: entries.length },
            },
        });

        // Delete consumed short-term entries
        for (const entry of entries) {
            await this._store.delete(entry.id).catch(() => { /* best-effort */ });
        }

        this._onDistilled?.(stored, entries);

        return { consumed: entries.length, summary: stored, skipped: false };
    }

    private async _fetchShortTerm(limit: number): Promise<MemoryEntry[]> {
        const results = await this._store.retrieve({
            query:  '',
            type:   MT.SHORT_TERM,
            limit,
            threshold: 0, // no similarity filter — fetch by recency
            filter: {
                ...(this._agentId   ? { agentId:   this._agentId   } : {}),
                ...(this._sessionId ? { sessionId: this._sessionId } : {}),
            },
        });
        return results.map((r) => ('entry' in r ? r.entry : r as unknown as MemoryEntry));
    }
}

// ── Standalone helpers ────────────────────────────────────────────────────────

/**
 * One-shot: summarise an array of memory entries with a given LLM.
 * Returns the summary text (you handle storage yourself).
 */
export async function summariseMemories(
    entries: MemoryEntry[],
    llm: LLMProvider,
    options: { agentId?: string; sessionId?: string } = {},
): Promise<string> {
    if (entries.length === 0) return '';
    const prompt = _buildSummarisationPrompt(entries, options.agentId, options.sessionId);
    const { text } = await llm.generateText(
        [{ role: 'system', content: 'You are a concise memory summariser. Return only the summary paragraph.' },
         { role: 'user',   content: prompt }],
        { maxTokens: 800, temperature: 0.3 },
    );
    return text.trim();
}

/**
 * Summarise a conversation message list into a single paragraph.
 * Useful for session hand-off: compress history before starting a new session.
 */
export async function summariseConversation(
    messages: Array<{ role: string; content: string }>,
    llm: LLMProvider,
): Promise<string> {
    if (messages.length === 0) return '';
    const conversation = messages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n');
    const { text } = await llm.generateText(
        [{ role: 'system', content: 'Summarise the conversation into a dense factual paragraph that retains all decisions, facts, and context. Return only the paragraph.' },
         { role: 'user',   content: conversation }],
        { maxTokens: 600, temperature: 0.2 },
    );
    return text.trim();
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _buildSummarisationPrompt(
    entries: MemoryEntry[],
    agentId: string | undefined,
    sessionId: string | undefined,
): string {
    const header = [
        agentId   ? `Agent: ${agentId}`   : null,
        sessionId ? `Session: ${sessionId}` : null,
    ].filter(Boolean).join(' | ');

    const body = entries
        .map((e, i) => `[${i + 1}] (${e.createdAt.toISOString()}) ${e.content}`)
        .join('\n');

    return (header ? `${header}\n\n` : '') +
           `Short-term memory entries to consolidate:\n${body}`;
}
