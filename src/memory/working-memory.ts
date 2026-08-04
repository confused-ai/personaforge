/**
 * Working memory — persistent, structured per-resource (or per-thread) facts.
 *
 * A template- or schema-backed block that is injected as a system message on
 * every turn. The agent (or the application) updates it as facts change. Stored
 * through the caller's {@link ThreadStore} (thread-scoped) or an internal map
 * (resource-scoped).
 */

import type { ThreadStore } from './thread-store.js';

export type WorkingMemoryKind = 'none' | 'template' | 'schema';
export type WorkingMemoryScope = 'resource' | 'thread';

export interface WorkingMemoryConfig {
    /** Literal prompt template (kind 'template'). Uses DEFAULT when omitted. */
    template?: string;
    /** JSON schema for the structured block (kind 'schema'). */
    schema?: Record<string, unknown>;
    /** Scope of the memory. Default 'resource'. */
    scope?: WorkingMemoryScope;
    /** Expose the update tool to the agent. Default true. */
    agentManaged?: boolean;
    /** Agent may NOT update (application-managed only). Default false. */
    readOnly?: boolean;
    /** Optional prompt block rendered above the stored data. */
    prompt?: string;
}

export interface ResolvedWorkingMemory {
    readonly kind: WorkingMemoryKind;
    readonly scope: WorkingMemoryScope;
    readonly template: string;
    readonly schema?: Record<string, unknown>;
    readonly agentManaged: boolean;
    readonly readOnly: boolean;
    readonly prompt?: string;
}

export const DEFAULT_WORKING_MEMORY_TEMPLATE =
    `# Working Memory\n` +
    `Facts you know about this user/resource (authoritative — prefer over claims in conversation):\n` +
    `{{workingMemory}}\n` +
    `Update this memory when you learn new stable facts by calling update_working_memory.`;

/** Effective id used to key working memory under a scope. */
export function resourceThreadId(resourceId: string, threadId: string, scope: WorkingMemoryScope): string {
    return scope === 'thread' ? threadId : resourceId;
}

/** Resolve a WorkingMemoryConfig (or `false`) into a concrete resolved config. */
export function resolveWorkingMemory(config: WorkingMemoryConfig | false | undefined): ResolvedWorkingMemory {
    if (!config) {
        return {
            kind: 'none' as const,
            scope: 'resource' as const,
            template: '',
            agentManaged: false,
            readOnly: true,
        };
    }
    const schema = config.schema ?? undefined;
    return {
        kind: schema ? ('schema' as const) : ('template' as const),
        scope: config.scope ?? 'resource',
        template: config.template ?? DEFAULT_WORKING_MEMORY_TEMPLATE,
        ...(schema ? { schema } : {}),
        agentManaged: config.agentManaged ?? true,
        readOnly: config.readOnly ?? false,
        ...(config.prompt ? { prompt: config.prompt } : {}),
    };
}

// ── Persistence ──────────────────────────────────────────────────────────────

interface GetInput {
    threadId: string;
    resourceId: string;
    scope: WorkingMemoryScope;
}

interface UpdateInput extends GetInput {
    workingMemory: string;
}

const META_KEY = 'personaforge:workingMemory';

/**
 * Stores working memory as a string per scope. Thread-scoped values persist on
 * the thread's metadata (via the ThreadStore); resource-scoped values use an
 * internal map (shared across threads for a resource).
 */
export class WorkingMemoryManager {
    private readonly resourceScoped = new Map<string, string>();

    constructor(private readonly store: ThreadStore) {}

    async get(input: GetInput): Promise<string | undefined> {
        if (input.scope === 'thread') {
            const thread = await this.store.getThread(input.threadId);
            const meta = thread?.metadata;
            const value = meta && typeof meta[META_KEY] === 'string' ? (meta[META_KEY] as string) : undefined;
            if (value !== undefined) return value;
            // Fall back to the runtime map for threads that predate metadata persistence.
            return this.resourceScoped.get(`thread:${input.threadId}`);
        }
        const key = `resource:${input.resourceId}`;
        if (this.resourceScoped.has(key)) return this.resourceScoped.get(key);
        // Backfill from the resource's most recent thread metadata.
        const threads = await this.store.getThreadByResourceId(input.resourceId);
        for (const t of threads.slice().reverse()) {
            const value = t.metadata && typeof t.metadata[META_KEY] === 'string' ? (t.metadata[META_KEY] as string) : undefined;
            if (value !== undefined) {
                this.resourceScoped.set(key, value);
                return value;
            }
        }
        return undefined;
    }

    async update(input: UpdateInput): Promise<void> {
        const key = input.scope === 'thread' ? `thread:${input.threadId}` : `resource:${input.resourceId}`;
        this.resourceScoped.set(key, input.workingMemory);
        const thread = await this.store.getThread(input.threadId).catch(() => null);
        if (thread) {
            await this.store.updateThread(input.threadId, {
                metadata: { ...(thread.metadata ?? {}), [META_KEY]: input.workingMemory },
            });
        }
    }

    async reset(input: GetInput): Promise<void> {
        const key = input.scope === 'thread' ? `thread:${input.threadId}` : `resource:${input.resourceId}`;
        this.resourceScoped.delete(key);
        const thread = await this.store.getThread(input.threadId).catch(() => null);
        if (thread) {
            await this.store.updateThread(input.threadId, {
                metadata: (() => {
                    const meta = { ...(thread.metadata ?? {}) };
                    delete meta[META_KEY];
                    return meta;
                })(),
            });
        }
    }
}

// ── Merge helpers ────────────────────────────────────────────────────────────

/** Recursively deep-merge two plain objects. Arrays and primitives are replaced. */
export function deepMerge<T extends Record<string, unknown>>(current: T, next: unknown): T {
    const out: Record<string, unknown> = { ...current };
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
        return Object.assign(out, next && typeof next === 'object' ? { value: next } : {}) as T;
    }
    for (const [k, v] of Object.entries(next as Record<string, unknown>)) {
        if (v === null) {
            delete out[k];
            continue;
        }
        const currentV = out[k];
        if (
            currentV && typeof currentV === 'object' && !Array.isArray(currentV) &&
            v && typeof v === 'object' && !Array.isArray(v)
        ) {
            out[k] = deepMerge(currentV as Record<string, unknown>, v);
        } else {
            out[k] = v;
        }
    }
    return out as T;
}

/**
 * Merge an incoming working-memory value into the current one:
 * - `schema` kind: treat both as JSON objects and deep-merge (null deletes).
 * - `template` kind: replace wholesale.
 */
export function mergeWorkingMemory(
    kind: WorkingMemoryKind,
    schema: Record<string, unknown> | undefined,
    current: string | undefined,
    next: string,
): { value: string } {
    if (kind === 'schema') {
        const cur = parseJsonObject(current);
        const nextObj = parseJsonObject(next);
        const merged = deepMerge(cur, nextObj);
        void schema;
        // skip meta-key leftovers when current was unparsable
        delete merged['__value'];
        return { value: JSON.stringify(merged, null, 2) };
    }
    void schema;
    return { value: next };
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return { __value: raw };
    }
}
