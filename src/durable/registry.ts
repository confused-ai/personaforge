/**
 * Durable agent runtime — server cache + run registry.
 *
 * Every durable run publishes its stream events to a per-runId topic. The cache
 * stores published events so a late subscriber (`observe()`) can replay chunks
 * it missed while disconnected. The run registry tracks live runs in-process.
 */

/** Minimal KV cache interface (mirrors Mastra's ServerCache). */
export interface ServerCache {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds?: number): Promise<void>;
    delete?(key: string): Promise<void>;
    /** Iterate keys with a prefix (optional — used for run discovery in Redis). */
    scanKeys?(prefix: string): Promise<string[]>;
}

/** Default in-process cache. Not shared across processes. */
export class InMemoryServerCache implements ServerCache {
    private store = new Map<string, { value: string; expiresAt?: number }>();

    private prune(): void {
        const now = Date.now();
        for (const [k, v] of this.store) {
            if (v.expiresAt !== undefined && v.expiresAt <= now) this.store.delete(k);
        }
    }

    async get(key: string): Promise<string | null> {
        this.prune();
        const v = this.store.get(key);
        if (!v) return null;
        return v.value;
    }

    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
        this.store.set(key, {
            value,
            expiresAt: ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1000 : undefined,
        });
    }

    async delete(key: string): Promise<void> {
        this.store.delete(key);
    }

    async scanKeys(prefix: string): Promise<string[]> {
        this.prune();
        return Array.from(this.store.keys()).filter((k) => k.startsWith(prefix));
    }

    /** Expose a Redis-backed adapter for multi-process durable runs. */
    static fromRedis(url: string): ServerCache {
        // Lazily require ioredis (peer dep) — optional Redis support.
        const Redis = require('ioredis') as new (u: string) => {
            get(k: string): Promise<string | null>;
            set(k: string, v: string, mode: 'EX', ttl: number): Promise<unknown>;
            del(...keys: string[]): Promise<unknown>;
            keys(pattern: string): Promise<string[]>;
        };
        const client = new Redis(url);
        return {
            async get(key) {
                return client.get(key);
            },
            async set(key, value, ttlSeconds) {
                if (ttlSeconds !== undefined) await client.set(key, value, 'EX', ttlSeconds);
                else await client.set(key, value, 'EX', 86_400);
            },
            async delete(key) {
                await client.del(key);
            },
            async scanKeys(prefix) {
                return client.keys(`${prefix}*`);
            },
        };
    }
}

const EVENT_TTL_SECONDS = 7 * 86_400; // 7 days of replay retention

/** A single durable run event (superset of StreamChunk with timestamp). */
export type DurableRunStatus = 'running' | 'suspended' | 'done' | 'error';

import type { DurableRunEvent } from './types.js';

export interface DurableRunHandle {
    readonly runId: string;
    status: DurableRunStatus;
    readonly events: import('./types.js').DurableRunEvent[];
    closed: boolean;
    resultResolve: (r: import('../create-agent/types.js').AgentRunResult) => void;
    resultReject: (e: unknown) => void;
    readonly result: Promise<import('../create-agent/types.js').AgentRunResult>;
    notify: () => void;
    /** Input + options captured for approval/suspend re-drives. */
    input: string | import('../providers/vision.js').MultiModalInput;
    options?: import('../create-agent/types.js').AgentRunOptions;
    agentId?: string;
}

/**
 * Tracks live durable runs in-process and mirrors events into a cache so a
 * later observer can replay anything it missed (same process, or another
 * process sharing the cache for the stored agent).
 */
export class DurableRunRegistry {
    private readonly runs = new Map<string, DurableRunHandle>();

    constructor(private readonly cache?: ServerCache) {}

    create(meta: {
        runId: string;
        input: DurableRunHandle['input'];
        options?: DurableRunHandle['options'];
        agentId?: string;
    }): DurableRunHandle {
        let resolveResult!: DurableRunHandle['resultResolve'];
        let rejectResult!: DurableRunHandle['resultReject'];
        const result = new Promise<import('../create-agent/types.js').AgentRunResult>((res, rej) => {
            resolveResult = res;
            rejectResult = rej;
        });
        let notify: () => void = () => undefined;
        const handle: DurableRunHandle = {
            runId: meta.runId,
            status: 'running',
            events: [],
            closed: false,
            resultResolve: resolveResult,
            resultReject: rejectResult,
            result,
            notify: () => { const fn = notify; notify = () => undefined; fn?.(); },
            input: meta.input,
            options: meta.options,
            agentId: meta.agentId,
        };
        this.runs.set(meta.runId, handle);
        return handle;
    }

    get(runId: string): DurableRunHandle | undefined {
        return this.runs.get(runId);
    }

    async publish(runId: string, event: import('../create-agent/types.js').StreamChunk): Promise<void> {
        const run = this.runs.get(runId);
        const seq = run ? run.events.length : (await this._cachedCount(runId));
        const stamped: DurableRunEvent = { ...event, seq, at: new Date().toISOString() };
        if (run) {
            run.events.push(stamped);
            run.notify();
        }
        if (this.cache) {
            const key = this.cacheKey(runId);
            const current = (await this.cache.get(key).catch(() => null)) ?? '[]';
            try {
                const list = JSON.parse(current) as DurableRunEvent[];
                list.push(stamped);
                await this.cache.set(key, JSON.stringify(list), EVENT_TTL_SECONDS).catch(() => undefined);
            } catch {
                await this.cache.set(key, JSON.stringify([stamped]), EVENT_TTL_SECONDS).catch(() => undefined);
            }
        }
    }

    private async _cachedCount(runId: string): Promise<number> {
        if (!this.cache) return 0;
        const current = await this.cache.get(this.cacheKey(runId)).catch(() => null);
        if (!current) return 0;
        try {
            return (JSON.parse(current) as DurableRunEvent[]).length;
        } catch {
            return 0;
        }
    }

    async markStatus(runId: string, status: DurableRunStatus): Promise<void> {
        const run = this.runs.get(runId);
        if (run) run.status = status;
        if (this.cache) {
            await this.cache.set(this.cacheKey(runId, 'status'), status, EVENT_TTL_SECONDS).catch(() => undefined);
        }
    }

    close(runId: string): void {
        const run = this.runs.get(runId);
        if (run) {
            run.closed = true;
            run.notify();
        }
        if (this.cache) {
            void this.cache.set(this.cacheKey(runId, 'closed'), '1', EVENT_TTL_SECONDS).catch(() => undefined);
        }
    }

    /** Events persisted in the cache for a run (used for cross-process observe). */
    async cachedEvents(runId: string): Promise<import('./types.js').DurableRunEvent[]> {
        if (!this.cache) return [];
        const raw = await this.cache.get(this.cacheKey(runId)).catch(() => null);
        if (!raw) return [];
        try {
            return JSON.parse(raw) as import('./types.js').DurableRunEvent[];
        } catch {
            return [];
        }
    }

    /** List runIds persisted in the cache (used by recoverActiveRuns). */
    async listCachedRunIds(): Promise<string[]> {
        if (!this.cache?.scanKeys) return [];
        const keys = await this.cache.scanKeys('durable:run:').catch(() => [] as string[]);
        const ids = new Set<string>();
        for (const k of keys) {
            // durable:run:<id>:events
            const m = /^durable:run:(.+):events$/.exec(k);
            if (m) ids.add(m[1]);
        }
        return Array.from(ids);
    }

    private cacheKey(runId: string, suffix = 'events'): string {
        return `durable:run:${runId}:${suffix}`;
    }
}
