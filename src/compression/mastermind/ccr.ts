/**
 * CCR — Compressed-Content Retrieval
 * ====================================
 * When a message is compressed, the original is stashed in a local in-memory
 * store keyed by a short handle (e.g. `ccr_a1b2`).  A `mastermind_retrieve`
 * tool description is injected alongside the compressed content so the LLM
 * can call back for the original if it needs it.
 *
 * Originals are never deleted until the CCR store is explicitly evicted or
 * the agent process ends — making compression fully reversible.
 *
 * LightweightTool compatible: returns a plain object usable directly with
 * the framework's `tool()` helper.
 */

import type { CCREntry } from './types.js';

// ── CCR Store ─────────────────────────────────────────────────────────────────

export class CCRStore {
    private readonly _entries = new Map<string, CCREntry>();
    private readonly _maxEntries: number;
    private _counter = 0;

    constructor(maxEntries = 200) {
        this._maxEntries = maxEntries;
    }

    /** Store original content and return a short handle. */
    store(entry: Omit<CCREntry, 'handle' | 'createdAt'>): string {
        const handle = `ccr_${(++this._counter).toString(36).padStart(4, '0')}`;

        if (this._entries.size >= this._maxEntries) {
            // Evict oldest entry
            const oldest = this._entries.keys().next().value;
            if (oldest) this._entries.delete(oldest);
        }

        this._entries.set(handle, {
            ...entry,
            handle,
            createdAt: Date.now(),
        });

        return handle;
    }

    /** Retrieve original content by handle. Returns null if evicted. */
    retrieve(handle: string): CCREntry | null {
        return this._entries.get(handle) ?? null;
    }

    /** Number of stored entries. */
    get size(): number {
        return this._entries.size;
    }

    /** Remove all entries. */
    clear(): void {
        this._entries.clear();
        this._counter = 0;
    }
}

// ── Retrieve Tool Definition ──────────────────────────────────────────────────

export interface MastermindRetrieveTool {
    name: 'mastermind_retrieve';
    description: string;
    parameters: {
        type: 'object';
        properties: {
            handle: { type: 'string'; description: string };
            query: { type: 'string'; description: string };
        };
        required: ['handle'];
    };
    execute(args: { handle: string; query?: string }): Promise<{
        content: string;
        found: boolean;
        /** Number of matching lines when a `query` was supplied. */
        matches?: number;
    }>;
}

export function createRetrieveTool(store: CCRStore): MastermindRetrieveTool {
    return {
        name: 'mastermind_retrieve',
        description:
            'Retrieve the original (uncompressed) content for a compressed block. ' +
            'Pass the `handle` value shown in brackets after a compressed section ' +
            '(e.g. `[ccr_0001]`). Returns the full original text, or — if you pass ' +
            'an optional `query` — only the lines matching it (case-insensitive), ' +
            'so you can pull just the relevant slice of a large original.',
        parameters: {
            type: 'object',
            properties: {
                handle: {
                    type: 'string',
                    description: 'The CCR handle printed next to the compressed block, e.g. "ccr_0001".',
                },
                query: {
                    type: 'string',
                    description: 'Optional substring; returns only original lines containing it (case-insensitive).',
                },
            },
            required: ['handle'],
        },
        async execute({ handle, query }) {
            const entry = store.retrieve(handle);
            if (!entry) {
                return { content: `[CCR: handle "${handle}" not found — may have been evicted]`, found: false };
            }
            const q = query?.trim();
            if (q) {
                const needle = q.toLowerCase();
                const matches = entry.original.split('\n').filter(line => line.toLowerCase().includes(needle));
                if (matches.length === 0) {
                    return { content: `[CCR: no lines in "${handle}" match query "${q}"]`, found: true, matches: 0 };
                }
                return { content: matches.join('\n'), found: true, matches: matches.length };
            }
            return { content: entry.original, found: true };
        },
    };
}

// ── Inline annotation helper ──────────────────────────────────────────────────

/**
 * Append a CCR handle annotation to a compressed string.
 * Format: `<compressed text> [ccr_xxxx — retrieve for full content]`
 */
export function annotateCCR(compressed: string, handle: string): string {
    return `${compressed}\n[${handle} — call mastermind_retrieve("${handle}") for full content]`;
}
