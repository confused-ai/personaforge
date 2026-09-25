/**
 * ToolCache
 * =========
 * TTL + LRU in-memory cache for tool execution results.
 *
 * Usage:
 *   const cache = new ToolCache({ maxEntries: 200, ttlMs: 60_000 });
 *   const wrapped = withCache(myTool, cache);
 *
 *   // Or use the cache directly:
 *   const cached = cache.get('search', { query: 'hello' });
 *   if (!cached) {
 *     const result = await myTool.execute({ query: 'hello' });
 *     cache.set('search', { query: 'hello' }, result);
 *   }
 */

import type { ToolResult } from './types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export interface ToolCacheConfig {
    /** Maximum number of entries before LRU eviction. Default: 100 */
    maxEntries?: number;
    /** Time-to-live in ms. 0 = never expire. Default: 300_000 (5 min) */
    ttlMs?: number;
    /**
     * Custom cache key function.
     * Default: `${toolName}::${JSON.stringify(params)}`
     */
    cacheKeyFn?: (toolName: string, params: unknown) => string;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface ToolCacheStats {
    hits: number;
    misses: number;
    evictions: number;
    /** Current number of entries in the cache */
    size: number;
}

// ── Internal entry ────────────────────────────────────────────────────────────

interface CacheEntry {
    value: ToolResult;
    expiresAt: number;   // 0 = never
    accessedAt: number;  // monotonic ms — used for LRU
}

// ── ToolCache ─────────────────────────────────────────────────────────────────

export class ToolCache {
    private readonly _maxEntries: number;
    private readonly _ttlMs: number;
    private readonly _cacheKeyFn: (toolName: string, params: unknown) => string;
    private readonly _store = new Map<string, CacheEntry>();
    private _hits = 0;
    private _misses = 0;
    private _evictions = 0;

    constructor(config: ToolCacheConfig = {}) {
        this._maxEntries = config.maxEntries ?? 100;
        this._ttlMs = config.ttlMs ?? 300_000;
        this._cacheKeyFn = config.cacheKeyFn ?? ToolCache._defaultKey;
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /**
     * Look up a cached result.  Returns `null` on miss or expiry.
     */
    get<T>(toolName: string, params: unknown): ToolResult<T> | null {
        const key = this._cacheKeyFn(toolName, params);
        const entry = this._store.get(key);

        if (!entry) {
            this._misses++;
            return null;
        }

        // TTL eviction
        if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
            this._store.delete(key);
            this._evictions++;
            this._misses++;
            return null;
        }

        entry.accessedAt = Date.now();
        this._hits++;
        return entry.value as ToolResult<T>;
    }

    /**
     * Store a tool result.  Evicts the least-recently-used entry when full.
     */
    set<T>(toolName: string, params: unknown, value: ToolResult<T>): void {
        const key = this._cacheKeyFn(toolName, params);

        // Update in-place if already exists
        const existing = this._store.get(key);
        if (existing) {
            existing.value = value;
            existing.accessedAt = Date.now();
            existing.expiresAt = this._ttlMs > 0 ? Date.now() + this._ttlMs : 0;
            return;
        }

        // Evict LRU if at capacity
        if (this._store.size >= this._maxEntries) {
            this._evictLRU();
        }

        this._store.set(key, {
            value: value,
            expiresAt: this._ttlMs > 0 ? Date.now() + this._ttlMs : 0,
            accessedAt: Date.now(),
        });
    }

    /**
     * Remove all entries for a specific tool name.
     * Returns the number of entries deleted.
     */
    invalidate(toolName: string): number {
        const prefix = `${toolName}::`;
        let removed = 0;
        for (const key of this._store.keys()) {
            if (key.startsWith(prefix)) {
                this._store.delete(key);
                removed++;
            }
        }
        return removed;
    }

    /** Remove all cached entries. */
    clear(): void {
        this._store.clear();
    }

    getStats(): ToolCacheStats {
        return {
            hits: this._hits,
            misses: this._misses,
            evictions: this._evictions,
            size: this._store.size,
        };
    }

    // ── Private ────────────────────────────────────────────────────────────

    private _evictLRU(): void {
        let lruKey: string | undefined;
        let lruTime = Infinity;

        for (const [k, entry] of this._store) {
            if (entry.accessedAt < lruTime) {
                lruTime = entry.accessedAt;
                lruKey = k;
            }
        }

        if (lruKey) {
            this._store.delete(lruKey);
            this._evictions++;
        }
    }

    private static _defaultKey(this: void, toolName: string, params: unknown): string {
        let serialized: string;
        try {
            serialized = JSON.stringify(params) ?? 'undefined';
        } catch {
            // BigInt / circular params aren't JSON-serializable — fall back to
            // a String() key so caching degrades instead of throwing.
            serialized = String(params);
        }
        return `${toolName}::${serialized}`;
    }
}
