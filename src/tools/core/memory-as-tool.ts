/**
 * `memoryAsTool()` — expose any {@link MemoryStore} to an agent as a callable
 * tool, so the agent can store, recall, and prune its own long-term memory
 * through the standard tool-calling interface.
 *
 * Unlike the pre-built `createTieredMemoryTools` (which are welded to
 * `TieredMemory`), this adapter works against the generic `MemoryStore`
 * interface — in-memory, vector, SQL, Redis, or any custom store.
 *
 * @example
 * ```ts
 * import { agent, memoryAsTool, InMemoryStore } from 'personaforge';
 * import { z } from 'zod';
 *
 * const memory = new InMemoryStore();
 * const memoryTool = memoryAsTool({
 *   name: 'personal_memory',
 *   description: 'Remember facts about the user and recall them later.',
 *   memory,
 *   parameters: z.object({
 *     action: z.enum(['store', 'recall']),
 *     content: z.string().optional().describe('Fact to remember'),
 *     query: z.string().optional().describe('What to recall'),
 *   }),
 * });
 *
 * const assistant = agent({
 *   instructions: 'Remember user preferences and recall them when asked.',
 *   tools: [memoryTool],
 * });
 * ```
 */

import { z } from 'zod';
import { ToolCategory } from './types.js';
import type { ToolObjectSchemaLike, SimpleToolContext, LightweightTool } from './tool-helper.js';
import { tool } from './tool-helper.js';
import type { MemoryStore, MemoryEntry, MemoryType } from '../../memory/types.js';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Minimal structural contract for a memory store. Any object exposing these
 * methods can be wrapped — most `MemoryStore` implementations qualify.
 */
export interface MemoryStoreLike {
    store(entry: { content: string; type?: MemoryType; metadata?: Record<string, unknown> }): Promise<{ id: string }>;
    retrieve(options: {
        query: string;
        limit?: number;
        type?: MemoryType;
    }): Promise<Array<{ id: string; content: string; score?: number; metadata?: Record<string, unknown> }>>;
    getRecent?(limit: number, type?: MemoryType): Promise<MemoryEntry[]>;
    delete?(id: string): Promise<boolean>;
    clear?(type?: MemoryType): Promise<void>;
    get?(id: string): Promise<MemoryEntry | null>;
}

const DEFAULT_MEMORY_PARAMETERS = z.object({
    action: z.enum(['store', 'recall', 'get_recent', 'delete', 'clear']).describe('What to do with memory'),
    content: z.string().optional().describe('Fact/content to store (required for action=store)'),
    query: z.string().optional().describe('Semantic query for recall'),
    type: z.string().optional().describe('Memory type: short_term, long_term, episodic, semantic'),
    limit: z.number().int().positive().max(100).optional().describe('Max results for recall/get_recent'),
    id: z.string().optional().describe('Memory id to delete (required for action=delete)'),
}) as ToolObjectSchemaLike<Record<string, unknown>>;

/**
 * Configuration for `memoryAsTool()`.
 */
export interface MemoryAsToolOptions {
    /** Tool name (used as function ID by the LLM). */
    readonly name: string;
    /** Human-readable description for the LLM. */
    readonly description: string;
    /** The memory store to wrap. */
    readonly memory: MemoryStoreLike;
    /** Zod schema for tool parameters. Defaults to the standard action schema. */
    readonly parameters?: ToolObjectSchemaLike<Record<string, unknown>>;
    /** Category for organization. */
    readonly category?: ToolCategory;
    /** Tags for discoverability. */
    readonly tags?: string[];
    /** Maximum execution time in ms. Default: 15_000. */
    readonly timeoutMs?: number;
    /** Require human approval before execution. */
    readonly needsApproval?: boolean | ((params: Record<string, unknown>) => boolean | Promise<boolean>);
    /** Called before the memory tool runs. Return false to cancel. */
    readonly beforeExecute?: (params: Record<string, unknown>, ctx: SimpleToolContext) => Promise<false | undefined> | false | undefined;
    /** Called after the memory tool completes. */
    readonly afterExecute?: (output: unknown, params: Record<string, unknown>, ctx: SimpleToolContext) => Promise<void> | void;
    /** Handle errors during memory access. */
    readonly onError?: (error: Error, params: Record<string, unknown>, ctx: SimpleToolContext) => unknown | Promise<unknown>;
    /** Whether the tool may write (store/delete/clear). Default: true. */
    readonly writeable?: boolean;
}

type MemoryAction = 'store' | 'recall' | 'get_recent' | 'delete' | 'clear';

function toMemoryType(raw: unknown): MemoryType | undefined {
    if (typeof raw !== 'string') return undefined;
    const candidates = [
        'short_term',
        'long_term',
        'episodic',
        'semantic',
    ] as const;
    const hit = candidates.find((c) => c === raw);
    return hit as MemoryType | undefined;
}

/**
 * Wrap a `MemoryStore` as a tool so agents can persist and recall memories
 * via function calling.
 */
export function memoryAsTool(
    config: MemoryAsToolOptions,
): LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, unknown> {
    const {
        name,
        description,
        memory,
        parameters = DEFAULT_MEMORY_PARAMETERS,
        category = ToolCategory.AI,
        tags = ['memory-tool'],
        timeoutMs = 15_000,
        needsApproval = false,
        beforeExecute,
        afterExecute,
        onError,
        writeable = true,
    } = config;

    const execute = async (params: Record<string, unknown>): Promise<unknown> => {
        const action = params.action as MemoryAction;

        if (!writeable && (action === 'store' || action === 'delete' || action === 'clear')) {
            throw new Error(`Memory tool "${name}" is read-only; action "${action}" is not permitted.`);
        }

        switch (action) {
            case 'store': {
                const content = typeof params.content === 'string' ? params.content : '';
                if (!content.trim()) {
                    throw new Error(`Memory tool "${name}": action=store requires a non-empty "content".`);
                }
                const entry = await memory.store({
                    content,
                    ...(params.type !== undefined ? { type: toMemoryType(params.type)! } : {}),
                    metadata:
                        params.metadata !== undefined && typeof params.metadata === 'object' && params.metadata !== null
                            ? (params.metadata as Record<string, unknown>)
                            : {},
                });
                return { action: 'stored', id: entry.id, content };
            }
            case 'recall': {
                const query = typeof params.query === 'string' && params.query.trim()
                    ? params.query
                    : 'recent context';
                const results = await memory.retrieve({
                    query,
                    ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
                    ...(params.type !== undefined ? { type: toMemoryType(params.type)! } : {}),
                });
                return {
                    action: 'recalled',
                    count: results.length,
                    results: results.map((r) => {
                        const entry = ('entry' in r && r.entry !== null && r.entry !== undefined
                            ? r.entry
                            : r) as { id: string; content: string; metadata?: Record<string, unknown> };
                        return {
                            id: entry.id,
                            content: entry.content,
                            ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
                            ...('score' in r && typeof (r as { score?: unknown }).score === 'number'
                                ? { score: (r as { score: number }).score }
                                : {}),
                        };
                    }),
                };
            }
            case 'get_recent': {
                if (!memory.getRecent) {
                    throw new Error(`Memory tool "${name}": action=get_recent is unsupported by this store.`);
                }
                const limit = typeof params.limit === 'number' ? params.limit : 10;
                const entries = await memory.getRecent(
                    limit,
                    params.type !== undefined ? toMemoryType(params.type)! : undefined,
                );
                return {
                    action: 'get_recent',
                    count: entries.length,
                    results: entries.map((e) => ({ id: e.id, content: e.content, metadata: e.metadata })),
                };
            }
            case 'delete': {
                if (!memory.delete) {
                    throw new Error(`Memory tool "${name}": action=delete is unsupported by this store.`);
                }
                const id = typeof params.id === 'string' ? params.id : '';
                if (!id) {
                    throw new Error(`Memory tool "${name}": action=delete requires an "id".`);
                }
                const deleted = await memory.delete(id);
                return { action: 'delete', id, deleted };
            }
            case 'clear': {
                if (!memory.clear) {
                    throw new Error(`Memory tool "${name}": action=clear is unsupported by this store.`);
                }
                await memory.clear(params.type !== undefined ? toMemoryType(params.type)! : undefined);
                return { action: 'cleared' };
            }
            default:
                throw new Error(
                    `Memory tool "${name}": unknown action "${String(params.action)}". ` +
                        'Expected one of: store, recall, get_recent, delete, clear.',
                );
        }
    };

    return tool({
        name,
        description,
        parameters,
        execute,
        needsApproval,
        category,
        tags,
        timeoutMs,
        ...(beforeExecute !== undefined ? { beforeExecute } : {}),
        ...(afterExecute !== undefined ? { afterExecute } : {}),
        ...(onError !== undefined ? { onError } : {}),
    } as import('./tool-helper.js').ToolHelperConfig<ToolObjectSchemaLike<Record<string, unknown>>, unknown>);
}
