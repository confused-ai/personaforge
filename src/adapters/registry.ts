/**
 * Universal Adapter Registry
 *
 * A single central store for every adapter in the system.
 * Modules resolve the driver they need by category + name.
 * Supports auto-connect, health checks, and hot-swap.
 *
 * @example
 * ```ts
 * import { createAdapterRegistry } from 'personaforge/adapters';
 *
 * const registry = createAdapterRegistry();
 *
 * // Register adapters
 * registry.register(new PostgresAdapter({ connectionString: process.env.DATABASE_URL! }));
 * registry.register(new RedisAdapter({ url: process.env.REDIS_URL! }));
 * registry.register(new PineconeAdapter({ apiKey: process.env.PINECONE_API_KEY! }));
 * registry.register(new DuckDBAdapter({ database: ':memory:' }));
 *
 * // Pass to createAgent — modules auto-pick the right adapter
 * const agent = createAgent({ name: 'analyst', adapters: registry });
 *
 * // Or resolve manually
 * const db = registry.resolve<SqlAdapter>('sql', 'postgres');
 * const { rows } = await db.query('SELECT * FROM users LIMIT 10');
 * ```
 */

import type {
    Adapter,
    AdapterCategory,
    AdapterHealth,
    AdapterBindings,
    AnyAdapter,
    SqlAdapter,
    NoSqlAdapter,
    VectorAdapter,
    AnalyticsAdapter,
    SearchAdapter,
    CacheAdapter,
    ObjectStorageAdapter,
    TimeSeriesAdapter,
    GraphAdapter,
    MessageQueueAdapter,
    ObservabilityAdapter,
    EmbeddingAdapter,
    // Framework-level
    SessionStoreAdapter,
    MemoryStoreAdapter,
    GuardrailAdapter,
    RagAdapter,
    ToolRegistryAdapter,
    AuthAdapter,
    RateLimitAdapter,
    AuditLogAdapter,
} from './types.js';

// ── Key helpers ────────────────────────────────────────────────────────────

function adapterKey(category: AdapterCategory, name: string): string {
    return `${category}:${name}`;
}

// ── Interface ──────────────────────────────────────────────────────────────

export interface AdapterRegistry {
    /**
     * Register an adapter.
     * Throws if an adapter with the same category + name is already registered.
     * Use `replace: true` to overwrite.
     */
    register(adapter: AnyAdapter, opts?: { replace?: boolean }): void;

    /** Unregister an adapter. Returns `true` if it existed. */
    unregister(category: AdapterCategory, name: string): boolean;

    /**
     * Resolve an adapter by category and name.
     * Throws `AdapterNotFoundError` if not found.
     */
    resolve<T extends Adapter = Adapter>(category: AdapterCategory, name: string): T;

    /**
     * Resolve an adapter or return `undefined` if not found.
     */
    tryResolve<T extends Adapter = Adapter>(category: AdapterCategory, name: string): T | undefined;

    /**
     * Resolve the first adapter registered under a category.
     * Useful when only one adapter of a category is expected.
     */
    resolveFirst<T extends Adapter = Adapter>(category: AdapterCategory): T | undefined;

    /** Returns `true` if an adapter is registered. */
    has(category: AdapterCategory, name: string): boolean;

    /** List all adapters, optionally filtered by category. */
    list(category?: AdapterCategory): AnyAdapter[];

    // ── Convenience typed resolvers ──────────────────────────────────────

    /** Resolve a SQL adapter by name (or the first registered SQL adapter). */
    sql(name?: string): SqlAdapter | undefined;
    /** Resolve a NoSQL adapter by name (or the first). */
    nosql(name?: string): NoSqlAdapter | undefined;
    /** Resolve a vector adapter by name (or the first). */
    vector(name?: string): VectorAdapter | undefined;
    /** Resolve an analytics adapter by name (or the first). */
    analytics(name?: string): AnalyticsAdapter | undefined;
    /** Resolve a search adapter by name (or the first). */
    search(name?: string): SearchAdapter | undefined;
    /** Resolve a cache adapter by name (or the first). */
    cache(name?: string): CacheAdapter | undefined;
    /** Resolve an object-storage adapter by name (or the first). */
    objectStorage(name?: string): ObjectStorageAdapter | undefined;
    /** Resolve a time-series adapter by name (or the first). */
    timeSeries(name?: string): TimeSeriesAdapter | undefined;
    /** Resolve a graph adapter by name (or the first). */
    graph(name?: string): GraphAdapter | undefined;
    /** Resolve a message-queue adapter by name (or the first). */
    queue(name?: string): MessageQueueAdapter | undefined;
    /** Resolve an observability adapter by name (or the first). */
    observability(name?: string): ObservabilityAdapter | undefined;
    /** Resolve an embedding adapter by name (or the first). */
    embedding(name?: string): EmbeddingAdapter | undefined;
    // ── Framework-level typed resolvers ─────────────────────────────────
    /** Resolve a session-store adapter by name (or the first). */
    sessionStore(name?: string): SessionStoreAdapter | undefined;
    /** Resolve a memory-store adapter by name (or the first). */
    memoryStore(name?: string): MemoryStoreAdapter | undefined;
    /** Resolve a guardrail adapter by name (or the first). */
    guardrail(name?: string): GuardrailAdapter | undefined;
    /** Resolve a RAG adapter by name (or the first). */
    rag(name?: string): RagAdapter | undefined;
    /** Resolve a tool-registry adapter by name (or the first). */
    toolRegistry(name?: string): ToolRegistryAdapter | undefined;
    /** Resolve an auth adapter by name (or the first). */
    auth(name?: string): AuthAdapter | undefined;
    /** Resolve a rate-limit adapter by name (or the first). */
    rateLimit(name?: string): RateLimitAdapter | undefined;
    /** Resolve an audit-log adapter by name (or the first). */
    auditLog(name?: string): AuditLogAdapter | undefined;

    // ── Lifecycle ────────────────────────────────────────────────────────

    /**
     * Call `connect()` on every registered adapter that has it.
     * Safe to call multiple times — skips already-connected adapters.
     */
    connectAll(): Promise<void>;

    /**
     * Call `disconnect()` on every connected adapter.
     */
    disconnectAll(): Promise<void>;

    /**
     * Run `healthCheck()` on all adapters that support it.
     * Returns a map of `"category:name"` → health result.
     */
    healthCheck(): Promise<Record<string, AdapterHealth>>;

    /**
     * Convert to explicit {@link AdapterBindings} using the first registered
     * adapter in each category.  Useful when passing to `createAgent`.
     */
    toBindings(): AdapterBindings;
}

// ── Error ──────────────────────────────────────────────────────────────────

export class AdapterNotFoundError extends Error {
    constructor(category: AdapterCategory, name: string) {
        super(`No adapter registered for category="${category}" name="${name}". Did you call registry.register()?`);
        this.name = 'AdapterNotFoundError';
    }
}

// ── Implementation ─────────────────────────────────────────────────────────

class AdapterRegistryImpl implements AdapterRegistry {
    private readonly store = new Map<string, AnyAdapter>();

    register(adapter: AnyAdapter, opts?: { replace?: boolean }): void {
        const key = adapterKey(adapter.category, adapter.name);
        if (this.store.has(key) && !opts?.replace) {
            throw new Error(
                `Adapter "${key}" is already registered. Use { replace: true } to overwrite.`,
            );
        }
        this.store.set(key, adapter);
    }

    unregister(category: AdapterCategory, name: string): boolean {
        return this.store.delete(adapterKey(category, name));
    }

    resolve<T extends Adapter = Adapter>(category: AdapterCategory, name: string): T {
        const adapter = this.store.get(adapterKey(category, name));
        if (!adapter) throw new AdapterNotFoundError(category, name);
        return adapter as T;
    }

    tryResolve<T extends Adapter = Adapter>(category: AdapterCategory, name: string): T | undefined {
        return this.store.get(adapterKey(category, name)) as T | undefined;
    }

    resolveFirst<T extends Adapter = Adapter>(category: AdapterCategory): T | undefined {
        for (const adapter of this.store.values()) {
            if (adapter.category === category) return adapter as T;
        }
        return undefined;
    }

    has(category: AdapterCategory, name: string): boolean {
        return this.store.has(adapterKey(category, name));
    }

    list(category?: AdapterCategory): AnyAdapter[] {
        const all = [...this.store.values()];
        return category ? all.filter((a) => a.category === category) : all;
    }

    // ── Typed convenience resolvers ────────────────────────────────────────

    sql(name?: string): SqlAdapter | undefined {
        return name ? this.tryResolve('sql', name) : this.resolveFirst('sql');
    }
    nosql(name?: string): NoSqlAdapter | undefined {
        return name ? this.tryResolve('nosql', name) : this.resolveFirst('nosql');
    }
    vector(name?: string): VectorAdapter | undefined {
        return name ? this.tryResolve('vector', name) : this.resolveFirst('vector');
    }
    analytics(name?: string): AnalyticsAdapter | undefined {
        return name ? this.tryResolve('analytics', name) : this.resolveFirst('analytics');
    }
    search(name?: string): SearchAdapter | undefined {
        return name ? this.tryResolve('search', name) : this.resolveFirst('search');
    }
    cache(name?: string): CacheAdapter | undefined {
        return name ? this.tryResolve('cache', name) : this.resolveFirst('cache');
    }
    objectStorage(name?: string): ObjectStorageAdapter | undefined {
        return name ? this.tryResolve('object-storage', name) : this.resolveFirst('object-storage');
    }
    timeSeries(name?: string): TimeSeriesAdapter | undefined {
        return name ? this.tryResolve('time-series', name) : this.resolveFirst('time-series');
    }
    graph(name?: string): GraphAdapter | undefined {
        return name ? this.tryResolve('graph', name) : this.resolveFirst('graph');
    }
    queue(name?: string): MessageQueueAdapter | undefined {
        return name ? this.tryResolve('message-queue', name) : this.resolveFirst('message-queue');
    }
    observability(name?: string): ObservabilityAdapter | undefined {
        return name ? this.tryResolve('observability', name) : this.resolveFirst('observability');
    }
    embedding(name?: string): EmbeddingAdapter | undefined {
        return name ? this.tryResolve('embedding', name) : this.resolveFirst('embedding');
    }

    // ── Framework-level typed resolvers ──────────────────────────────────

    sessionStore(name?: string): SessionStoreAdapter | undefined {
        return name ? this.tryResolve('session-store', name) : this.resolveFirst('session-store');
    }
    memoryStore(name?: string): MemoryStoreAdapter | undefined {
        return name ? this.tryResolve('memory-store', name) : this.resolveFirst('memory-store');
    }
    guardrail(name?: string): GuardrailAdapter | undefined {
        return name ? this.tryResolve('guardrail', name) : this.resolveFirst('guardrail');
    }
    rag(name?: string): RagAdapter | undefined {
        return name ? this.tryResolve('rag', name) : this.resolveFirst('rag');
    }
    toolRegistry(name?: string): ToolRegistryAdapter | undefined {
        return name ? this.tryResolve('tool-registry', name) : this.resolveFirst('tool-registry');
    }
    auth(name?: string): AuthAdapter | undefined {
        return name ? this.tryResolve('auth', name) : this.resolveFirst('auth');
    }
    rateLimit(name?: string): RateLimitAdapter | undefined {
        return name ? this.tryResolve('rate-limit', name) : this.resolveFirst('rate-limit');
    }
    auditLog(name?: string): AuditLogAdapter | undefined {
        return name ? this.tryResolve('audit-log', name) : this.resolveFirst('audit-log');
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    async connectAll(): Promise<void> {
        const errors: string[] = [];
        for (const adapter of this.store.values()) {
            if (adapter.connect && !adapter.isConnected()) {
                try {
                    await adapter.connect();
                } catch (err) {
                    errors.push(
                        `${adapterKey(adapter.category, adapter.name)}: ${err instanceof Error ? err.message : String(err)}`,
                    );
                }
            }
        }
        if (errors.length > 0) {
            throw new Error(`AdapterRegistry.connectAll() failed for:\n${errors.map((e) => `  • ${e}`).join('\n')}`);
        }
    }

    async disconnectAll(): Promise<void> {
        for (const adapter of this.store.values()) {
            if (adapter.disconnect && adapter.isConnected()) {
                try {
                    await adapter.disconnect();
                } catch {
                    // Best-effort disconnect — don't throw on shutdown
                }
            }
        }
    }

    async healthCheck(): Promise<Record<string, AdapterHealth>> {
        const results: Record<string, AdapterHealth> = {};
        for (const adapter of this.store.values()) {
            const key = adapterKey(adapter.category, adapter.name);
            if (adapter.healthCheck) {
                try {
                    results[key] = await adapter.healthCheck();
                } catch (err) {
                    results[key] = { ok: false, message: err instanceof Error ? err.message : String(err) };
                }
            } else {
                results[key] = { ok: adapter.isConnected() };
            }
        }
        return results;
    }

    toBindings(): AdapterBindings {
        return {
            session: (this.resolveFirst<CacheAdapter>('cache') ?? this.resolveFirst<SqlAdapter>('sql') ?? this.resolveFirst<NoSqlAdapter>('nosql')) as AdapterBindings['session'],
            sessionStore: this.resolveFirst('session-store'),
            memory: this.resolveFirst('vector'),
            memoryStore: this.resolveFirst('memory-store'),
            storage: (this.resolveFirst<CacheAdapter>('cache') ?? this.resolveFirst<ObjectStorageAdapter>('object-storage')) as AdapterBindings['storage'],
            knowledge: (this.resolveFirst<VectorAdapter>('vector') ?? this.resolveFirst<SearchAdapter>('search')) as AdapterBindings['knowledge'],
            rag: this.resolveFirst('rag'),
            observability: this.resolveFirst('observability'),
            queue: this.resolveFirst('message-queue'),
            analytics: this.resolveFirst('analytics'),
            database: (this.resolveFirst<SqlAdapter>('sql') ?? this.resolveFirst<NoSqlAdapter>('nosql') ?? this.resolveFirst<AnalyticsAdapter>('analytics') ?? this.resolveFirst<GraphAdapter>('graph')) as AdapterBindings['database'],
            embedding: this.resolveFirst('embedding'),
            guardrail: this.resolveFirst('guardrail'),
            toolRegistry: this.resolveFirst('tool-registry'),
            auth: this.resolveFirst('auth'),
            rateLimit: this.resolveFirst('rate-limit'),
            auditLog: this.resolveFirst('audit-log'),
        };
    }
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a new adapter registry.
 *
 * @example
 * ```ts
 * const registry = createAdapterRegistry();
 * registry.register(new PostgresAdapter({ connectionString: '...' }));
 * await registry.connectAll();
 * ```
 */
export function createAdapterRegistry(): AdapterRegistry {
    return new AdapterRegistryImpl();
}
