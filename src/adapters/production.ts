/**
 * Production Setup Helper
 *
 * `createProductionSetup()` gives you a single, opinionated entry-point that
 * wires a complete, production-ready adapter stack for a personaforge agent.
 *
 * Every slot can be overridden with a real driver.  Anything not provided falls
 * back to a sensible zero-dep in-memory implementation so the agent always
 * starts without crashing, even in partial-config environments like CI or
 * local dev.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUICK START — full production wiring
 * ─────────────────────────────────────────────────────────────────────────
 * ```ts
 * import { createProductionSetup } from 'personaforge/adapters';
 *
 * // 1. Describe the stack using real adapters
 * const setup = createProductionSetup({
 *   database:    new PostgresAdapter({ connectionString: process.env.DATABASE_URL! }),
 *   cache:       new RedisAdapter({ url: process.env.REDIS_URL! }),
 *   vector:      new PineconeAdapter({ apiKey: process.env.PINECONE_API_KEY! }),
 *   sessionStore:new RedisSessionAdapter({ url: process.env.REDIS_URL! }),
 *   memoryStore: new QdrantMemoryAdapter({ url: process.env.QDRANT_URL! }),
 *   rag:         new PineconeRagAdapter({ apiKey: process.env.PINECONE_API_KEY! }),
 *   observability: new OtelAdapter({ endpoint: process.env.OTEL_ENDPOINT }),
 *   auditLog:    new PgAuditLogAdapter({ connectionString: process.env.DATABASE_URL! }),
 *   rateLimit:   new RedisRateLimitAdapter({ url: process.env.REDIS_URL! }),
 *   auth:        new JwtAuthAdapter({ secret: process.env.JWT_SECRET! }),
 *   guardrail:   new ContentSafetyAdapter({ apiKey: process.env.AZURE_CS_KEY! }),
 * });
 *
 * // 2. Connect everything
 * await setup.connect();
 *
 * // 3. Wire to createAgent
 * const agent = createAgent({
 *   name: 'assistant',
 *   model: 'gpt-4o',
 *   instructions: '...',
 *   adapters: setup.bindings,
 * });
 *
 * // 4. Run health checks (e.g. in a /health endpoint)
 * const health = await setup.healthCheck();
 * console.log(health); // { 'session-store:redis': { ok: true, latencyMs: 2 }, ... }
 *
 * // 5. Graceful shutdown
 * process.on('SIGTERM', () => setup.disconnect());
 * ```
 */

import {
    InMemorySessionStoreAdapter,
    InMemoryMemoryStoreAdapter,
    PassThroughGuardrailAdapter,
    InMemoryRagAdapter,
    InMemoryToolRegistryAdapter,
    NoOpAuthAdapter,
    InMemoryRateLimitAdapter,
    InMemoryAuditLogAdapter,
    InMemoryCacheAdapter,
    InMemoryVectorAdapter,
    ConsoleObservabilityAdapter,
    NullObservabilityAdapter,
} from './built-in.js';

import type {
    AdapterBindings,
    AdapterHealth,
    SessionStoreAdapter,
    MemoryStoreAdapter,
    GuardrailAdapter,
    RagAdapter,
    ToolRegistryAdapter,
    AuthAdapter,
    RateLimitAdapter,
    AuditLogAdapter,
    CacheAdapter,
    SqlAdapter,
    NoSqlAdapter,
    VectorAdapter,
    SearchAdapter,
    ObjectStorageAdapter,
    ObservabilityAdapter,
    MessageQueueAdapter,
    AnalyticsAdapter,
    EmbeddingAdapter,
    GraphAdapter,
    Adapter,
} from './types.js';

import type { AdapterRegistry } from './registry.js';
import { createAdapterRegistry } from './registry.js';

// ── Options ────────────────────────────────────────────────────────────────

/**
 * Options for `createProductionSetup()`.
 *
 * Every field is optional.  Omitted fields use zero-dep in-memory defaults
 * so you can start with nothing and layer in real drivers progressively.
 */
export interface ProductionSetupOptions {
    // ── Data & storage ─────────────────────────────────────────────────────
    /** Relational / SQL database adapter (PostgreSQL, MySQL, SQLite …). */
    database?: SqlAdapter | NoSqlAdapter | AnalyticsAdapter | GraphAdapter;
    /** NoSQL document store. */
    nosql?: NoSqlAdapter;
    /** Cache adapter (Redis, Memcached, Upstash …). */
    cache?: CacheAdapter;
    /** Object / blob storage (S3, GCS, Azure Blob …). */
    objectStorage?: ObjectStorageAdapter;
    /** Analytics / OLAP (DuckDB, ClickHouse, BigQuery …). */
    analytics?: AnalyticsAdapter;
    /** Vector database (Pinecone, Qdrant, Weaviate, pgvector …). */
    vector?: VectorAdapter;
    /** Full-text search (Elasticsearch, Typesense, MeiliSearch …). */
    search?: SearchAdapter;
    /** Graph database (Neo4j, ArangoDB …). */
    graph?: GraphAdapter;
    /** Message queue / stream (RabbitMQ, Kafka, SQS, BullMQ …). */
    queue?: MessageQueueAdapter;
    /** Embedding model provider. */
    embedding?: EmbeddingAdapter;

    // ── Framework-level ─────────────────────────────────────────────────────
    /**
     * Session store adapter.
     * Default: in-memory (lost on restart — replace with Redis or SQL in production).
     */
    sessionStore?: SessionStoreAdapter;
    /**
     * Long-term memory store adapter.
     * Default: in-memory vector store (not persistent — replace with Qdrant, Pinecone …).
     */
    memoryStore?: MemoryStoreAdapter;
    /**
     * Guardrail / content safety adapter.
     * Default: pass-through (no moderation — replace in production with your safety API).
     */
    guardrail?: GuardrailAdapter;
    /**
     * RAG (Retrieval-Augmented Generation) pipeline adapter.
     * Default: in-memory keyword retrieval.
     */
    rag?: RagAdapter;
    /**
     * Remote tool registry adapter (MCP, HTTP tool hubs …).
     * Default: empty in-memory registry.
     */
    toolRegistry?: ToolRegistryAdapter;
    /**
     * Authentication & authorization adapter.
     * Default: no-op (all requests accepted — replace in production).
     */
    auth?: AuthAdapter;
    /**
     * Rate-limit adapter.
     * Default: in-memory token-bucket.
     */
    rateLimit?: RateLimitAdapter;
    /**
     * Immutable audit / compliance log adapter.
     * Default: in-memory ring-buffer (lost on restart — replace with PostgreSQL, CloudWatch …).
     */
    auditLog?: AuditLogAdapter;
    /**
     * Observability adapter (logs, traces, metrics).
     * Default: `ConsoleObservabilityAdapter` in dev, `NullObservabilityAdapter` in production.
     * Override with your OpenTelemetry, Datadog, or Axiom adapter.
     */
    observability?: ObservabilityAdapter;

    // ── Behaviour ───────────────────────────────────────────────────────────
    /**
     * When `true`, uses console-based observability by default and logs adapter
     * startup info.  When `false` (default), uses the null observability sink.
     */
    dev?: boolean;
    /**
     * Rate-limit window in seconds.  Only used when `rateLimit` is not provided.
     * Default: `60`.
     */
    rateLimitWindowSecs?: number;
    /**
     * Requests per window when using the built-in in-memory rate limiter.
     * Default: `100`.
     */
    rateLimitMax?: number;
}

// ── Result ─────────────────────────────────────────────────────────────────

/**
 * The object returned by `createProductionSetup()`.
 */
export interface ProductionSetup {
    /**
     * The fully-wired `AdapterBindings` object.
     * Pass this directly to `createAgent({ adapters: setup.bindings })`.
     */
    readonly bindings: AdapterBindings;

    /**
     * The underlying `AdapterRegistry` — use this to resolve adapters by category,
     * run lifecycle operations, or register additional adapters.
     */
    readonly registry: AdapterRegistry;

    /**
     * Connect all registered adapters.  Call this once during application startup.
     * Throws if any adapter fails to connect.
     */
    connect(): Promise<void>;

    /**
     * Disconnect all adapters gracefully.  Call during SIGTERM / SIGINT.
     */
    disconnect(): Promise<void>;

    /**
     * Run a liveness probe on all adapters that support it.
     * Returns a map of `"category:name"` → `AdapterHealth`.
     *
     * @example
     * ```ts
     * app.get('/health', async (req, res) => {
     *   const health = await setup.healthCheck();
     *   const allOk = Object.values(health).every(h => h.ok);
     *   res.status(allOk ? 200 : 503).json(health);
     * });
     * ```
     */
    healthCheck(): Promise<Record<string, AdapterHealth>>;

    /**
     * Whether all registered adapters are currently connected.
     */
    isHealthy(): boolean;
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a production-ready, fully-wired adapter stack for a personaforge agent.
 *
 * @param options - Adapter overrides.  Any omitted field defaults to a safe
 *                  zero-dep in-memory implementation.
 *
 * @example
 * ```ts
 * import {
 *   createProductionSetup,
 *   InMemorySessionStoreAdapter,
 * } from 'personaforge/adapters';
 *
 * const setup = createProductionSetup({
 *   // Swap any slot with a real adapter:
 *   // sessionStore: new RedisSessionAdapter({ url: process.env.REDIS_URL! }),
 * });
 *
 * await setup.connect();
 *
 * const agent = createAgent({
 *   name: 'assistant',
 *   model: 'gpt-4o',
 *   instructions: 'You are a helpful assistant.',
 *   adapters: setup.bindings,
 * });
 * ```
 */
export function createProductionSetup(options: ProductionSetupOptions = {}): ProductionSetup {
    const {
        dev = false,
        rateLimitWindowSecs = 60,
        rateLimitMax = 100,
    } = options;

    const registry = createAdapterRegistry();

    // ── Helper: register if provided ────────────────────────────────────────
    function reg(adapter: Adapter | undefined): void {
        if (adapter) registry.register(adapter as import('./types.js').AnyAdapter);
    }

    // ── Data / storage ───────────────────────────────────────────────────────
    const cache = options.cache ?? new InMemoryCacheAdapter();
    reg(cache);

    if (options.nosql) reg(options.nosql);
    if (options.objectStorage) reg(options.objectStorage);
    if (options.analytics) reg(options.analytics);
    if (options.graph) reg(options.graph);
    if (options.queue) reg(options.queue);
    if (options.search) reg(options.search);

    const vector = options.vector ?? new InMemoryVectorAdapter();
    reg(vector);

    if (options.embedding) reg(options.embedding);
    if (options.database) reg(options.database as import('./types.js').AnyAdapter);

    // ── Observability ────────────────────────────────────────────────────────
    const observability = options.observability
        ?? (dev ? new ConsoleObservabilityAdapter() : new NullObservabilityAdapter());
    reg(observability);

    // ── Framework-level ──────────────────────────────────────────────────────
    const sessionStore = options.sessionStore ?? new InMemorySessionStoreAdapter();
    reg(sessionStore);

    const memoryStore = options.memoryStore ?? new InMemoryMemoryStoreAdapter();
    reg(memoryStore);

    const guardrail = options.guardrail ?? new PassThroughGuardrailAdapter();
    reg(guardrail);

    const rag = options.rag ?? new InMemoryRagAdapter();
    reg(rag);

    const toolRegistry = options.toolRegistry ?? new InMemoryToolRegistryAdapter();
    reg(toolRegistry);

    const auth = options.auth ?? new NoOpAuthAdapter();
    reg(auth);

    const rateLimit = options.rateLimit ?? new InMemoryRateLimitAdapter(rateLimitMax, rateLimitWindowSecs);
    reg(rateLimit);

    const auditLog = options.auditLog ?? new InMemoryAuditLogAdapter();
    reg(auditLog);

    // ── Bindings ─────────────────────────────────────────────────────────────
    const bindings: AdapterBindings = {
        // Data
        session: cache as AdapterBindings['session'],
        sessionStore,
        memory: vector,
        memoryStore,
        storage: cache as AdapterBindings['storage'],
        knowledge: vector as AdapterBindings['knowledge'],
        observability,
        ...(options.queue && { queue: options.queue }),
        ...(options.analytics && { analytics: options.analytics }),
        ...(options.database && { database: options.database as AdapterBindings['database'] }),
        ...(options.embedding && { embedding: options.embedding }),
        // Framework-level
        rag,
        guardrail,
        toolRegistry,
        auth,
        rateLimit,
        auditLog,
    };

    return {
        bindings,
        registry,

        async connect(): Promise<void> {
            await registry.connectAll();
        },

        async disconnect(): Promise<void> {
            await registry.disconnectAll();
        },

        async healthCheck(): Promise<Record<string, AdapterHealth>> {
            return registry.healthCheck();
        },

        isHealthy(): boolean {
            return registry.list().every((a) => a.isConnected());
        },
    };
}
