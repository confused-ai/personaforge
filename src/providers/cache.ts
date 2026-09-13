/**
 * LLM Response Cache - Content-Addressable Caching for LLM Responses
 *
 * LLM response cache to cut cost and latency:
 * - Content-addressable cache (hash of messages + model + params)
 * - Configurable TTL and max entries
 * - LRU eviction when full
 * - In-memory with pluggable adapter interface
 */

import { createHash } from 'node:crypto';
import type { Message, GenerateOptions, GenerateResult } from './types.js';
import type { MetricsCollector } from '../observability/types.js';

/** Cache entry */
interface CacheEntry {
    readonly key: string;
    readonly result: GenerateResult;
    readonly createdAt: number;
    readonly expiresAt: number;
    accessedAt: number;
    accessCount: number;
}

/** Cache configuration */
export interface LLMCacheConfig {
    /** Maximum number of cached entries (default: 1000) */
    readonly maxEntries?: number;
    /** TTL in milliseconds (default: 3600000 = 1 hour) */
    readonly ttlMs?: number;
    /** Enable cache (default: true) */
    readonly enabled?: boolean;
    /** Optional metrics collector */
    readonly metrics?: MetricsCollector;
    /** Hash function override (default: JSON hash) */
    readonly hashFn?: (key: CacheKeyInput) => string;
}

/** Input for cache key generation */
export interface CacheKeyInput {
    readonly messages: Message[];
    readonly model?: string;
    readonly temperature?: number;
    readonly maxTokens?: number;
    readonly tools?: unknown[];
}

/** Cache statistics */
export interface CacheStats {
    readonly hits: number;
    readonly misses: number;
    readonly entries: number;
    readonly hitRate: number;
    readonly evictions: number;
}

/**
 * LLM Response Cache with LRU eviction.
 *
 * @example
 * const cache = new LLMCache({
 *   maxEntries: 500,
 *   ttlMs: 60 * 60 * 1000, // 1 hour
 * });
 *
 * // Check cache before calling LLM
 * const cached = cache.get({
 *   messages: [{ role: 'user', content: 'Hello' }],
 *   model: 'gpt-4o',
 * });
 *
 * if (cached) {
 *   return cached;
 * }
 *
 * const result = await llm.generateText(messages, options);
 * cache.set({ messages, model: 'gpt-4o' }, result);
 */
export class LLMCache {
    private readonly cache = new Map<string, CacheEntry>();
    private readonly config: Required<Omit<LLMCacheConfig, 'metrics' | 'hashFn'>> &
        Pick<LLMCacheConfig, 'metrics' | 'hashFn'>;

    private hits = 0;
    private misses = 0;
    private evictions = 0;

    constructor(config: LLMCacheConfig = {}) {
        this.config = {
            maxEntries: config.maxEntries ?? 1000,
            ttlMs: config.ttlMs ?? 3600_000, // 1 hour
            enabled: config.enabled ?? true,
            metrics: config.metrics,
            hashFn: config.hashFn,
        };
    }

    /** Check if caching is enabled */
    isEnabled(): boolean {
        return this.config.enabled;
    }

    /** Get cached result */
    get(input: CacheKeyInput): GenerateResult | null {
        if (!this.config.enabled) return null;

        const key = this.getKey(input);
        const entry = this.cache.get(key);

        if (!entry) {
            this.misses++;
            this.recordMetric('cache_miss', 1);
            return null;
        }

        // Check expiration
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            this.misses++;
            this.recordMetric('cache_expired', 1);
            return null;
        }

        // Update access info (LRU tracking)
        entry.accessedAt = Date.now();
        entry.accessCount++;

        this.hits++;
        this.recordMetric('cache_hit', 1);
        return entry.result;
    }

    /** Set cached result */
    set(input: CacheKeyInput, result: GenerateResult): void {
        if (!this.config.enabled) return;

        const key = this.getKey(input);
        const now = Date.now();

        // Evict if at capacity
        if (this.cache.size >= this.config.maxEntries) {
            this.evictLRU();
        }

        this.cache.set(key, {
            key,
            result,
            createdAt: now,
            expiresAt: now + this.config.ttlMs,
            accessedAt: now,
            accessCount: 1,
        });

        this.recordMetric('cache_set', 1);
    }

    /** Delete a cached entry */
    delete(input: CacheKeyInput): boolean {
        const key = this.getKey(input);
        return this.cache.delete(key);
    }

    /** Check if entry exists (without affecting LRU) */
    has(input: CacheKeyInput): boolean {
        const key = this.getKey(input);
        const entry = this.cache.get(key);
        return entry !== undefined && Date.now() <= entry.expiresAt;
    }

    /** Clear all cached entries */
    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
        this.evictions = 0;
    }

    /** Get cache statistics */
    getStats(): CacheStats {
        const total = this.hits + this.misses;
        return {
            hits: this.hits,
            misses: this.misses,
            entries: this.cache.size,
            hitRate: total > 0 ? this.hits / total : 0,
            evictions: this.evictions,
        };
    }

    /** Cleanup expired entries */
    cleanup(): number {
        const now = Date.now();
        let removed = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
                removed++;
            }
        }

        return removed;
    }

    // --- Private methods ---

    private getKey(input: CacheKeyInput): string {
        if (this.config.hashFn) {
            return this.config.hashFn(input);
        }

        // Default: JSON-based hash. Tools are part of the key — the same
        // prompt with different tools must not share a cached response.
        const normalized = {
            messages: input.messages.map(m => ({
                role: m.role,
                content: m.content,
            })),
            model: input.model,
            temperature: input.temperature,
            maxTokens: input.maxTokens,
            tools: input.tools === undefined ? null : JSON.stringify(input.tools),
        };

        return this.simpleHash(JSON.stringify(normalized));
    }

    private simpleHash(str: string): string {
        // SHA-256: a 32-bit Java-style hash collides routinely at cache
        // scale, and a collision serves the wrong cached response.
        return createHash('sha256').update(str, 'utf8').digest('hex');
    }

    private evictLRU(): void {
        let oldest: CacheEntry | null = null;
        let oldestKey = '';

        for (const [key, entry] of this.cache.entries()) {
            if (!oldest || entry.accessedAt < oldest.accessedAt) {
                oldest = entry;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.cache.delete(oldestKey);
            this.evictions++;
            this.recordMetric('cache_eviction', 1);
        }
    }

    private recordMetric(name: string, value: number): void {
        this.config.metrics?.counter(`llm_cache.${name}`, value);
    }
}

/**
 * Wrap an LLM provider with caching.
 * Note: Model should be passed separately to the cache key.
 */
export function withLLMCache<T extends {
    generateText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult>;
}>(
    llm: T,
    cache: LLMCache,
    model?: string
): T {
    const originalGenerate = llm.generateText.bind(llm);

    llm.generateText = async (messages: Message[], options?: GenerateOptions): Promise<GenerateResult> => {
        const cacheInput: CacheKeyInput = {
            messages,
            model,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
            tools: options?.tools,
        };

        // Check cache
        const cached = cache.get(cacheInput);
        if (cached) {
            return cached;
        }

        // Call LLM
        const result = await originalGenerate(messages, options);

        // Cache successful results
        if (result.finishReason !== 'error') {
            cache.set(cacheInput, result);
        }

        return result;
    };

    return llm;
}

