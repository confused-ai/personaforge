/**
 * Adapters — Universal extensibility layer.
 *
 * Import path: `personaforge/adapters`
 *
 * @example
 * ```ts
 * import {
 *   createAdapterRegistry,
 *   InMemoryCacheAdapter,
 *   InMemoryVectorAdapter,
 * } from 'personaforge/adapters';
 *
 * const registry = createAdapterRegistry();
 *
 * // Built-in adapters (zero deps — good for dev/test)
 * registry.register(new InMemoryCacheAdapter());
 * registry.register(new InMemoryVectorAdapter());
 *
 * // Third-party adapters (install separately):
 * // registry.register(new PostgresAdapter({ connectionString: '...' }));
 * // registry.register(new RedisAdapter({ url: '...' }));
 * // registry.register(new PineconeAdapter({ apiKey: '...' }));
 * // registry.register(new DuckDBAdapter({ database: ':memory:' }));
 *
 * await registry.connectAll();
 *
 * // Use with createAgent
 * const agent = createAgent({ name: 'analyst', adapters: registry });
 *
 * // Or explicit per-module bindings
 * const agent2 = createAgent({
 *   name: 'analyst',
 *   adapters: {
 *     session: registry.cache('redis'),
 *     memory:  registry.vector('pinecone'),
 *     storage: registry.objectStorage('s3'),
 *   },
 * });
 * ```
 */

// ── Types ──────────────────────────────────────────────────────────────────
export type {
    AdapterCategory,
    AdapterMeta,
    Adapter,
    AdapterHealth,
    AdapterBindings,
    AnyAdapter,

    // SQL
    SqlRow,
    SqlQueryOptions,
    SqlTransaction,
    SqlAdapter,

    // NoSQL
    NoSqlProjection,
    NoSqlAdapter,

    // Vector
    VectorRecord,
    VectorMatch,
    VectorMetric,
    VectorAdapter,

    // Analytics
    AnalyticsImportSource,
    AnalyticsExportFormat,
    AnalyticsAdapter,

    // Search
    SearchDocument,
    SearchQueryOptions,
    SearchHit,
    SearchAdapter,

    // Cache
    CacheAdapter,

    // Object Storage
    ObjectUploadOptions,
    ObjectInfo,
    ObjectStorageAdapter,

    // Time Series
    TimeSeriesPoint,
    TimeSeriesAdapter,

    // Graph
    GraphNode,
    GraphRelationship,
    GraphQueryResult,
    GraphAdapter,

    // Message Queue
    QueueMessage,
    QueuePublishOptions,
    QueueConsumeOptions,
    MessageQueueAdapter,

    // Observability
    ObservabilityLogEntry,
    TraceSpan,
    MetricPoint,
    ObservabilityAdapter,

    // Embedding
    EmbeddingOptions,
    EmbeddingAdapter,

    // Framework-level adapters
    StoredSession,
    SessionMessage,
    SessionStoreAdapter,

    MemoryEntry,
    MemorySearchResult,
    MemoryStoreAdapter,

    GuardrailCheckResult,
    GuardrailAdapterContext,
    GuardrailAdapter,

    RetrievedDocument,
    RagRetrieveOptions,
    RagAdapter,

    RemoteToolDescriptor,
    ToolRegistryAdapter,

    AuthIdentity,
    AuthResult,
    AuthAdapter,

    RateLimitOptions,
    RateLimitResult,
    RateLimitAdapter,

    AuditEvent,
    AuditQuery,
    AuditLogAdapter,
} from './types.js';

// ── Registry ───────────────────────────────────────────────────────────────
export { createAdapterRegistry, AdapterNotFoundError } from './registry.js';
export type { AdapterRegistry } from './registry.js';

// ── Built-in adapters ──────────────────────────────────────────────────────
export {
    InMemorySqlAdapter,
    InMemoryNoSqlAdapter,
    InMemoryVectorAdapter,
    InMemoryAnalyticsAdapter,
    InMemorySearchAdapter,
    InMemoryCacheAdapter,
    InMemoryObjectStorageAdapter,
    InMemoryTimeSeriesAdapter,
    InMemoryGraphAdapter,
    InMemoryMessageQueueAdapter,
    ConsoleObservabilityAdapter,
    NullObservabilityAdapter,
    InMemoryEmbeddingAdapter,
    // Framework-level built-ins
    InMemorySessionStoreAdapter,
    InMemoryMemoryStoreAdapter,
    PassThroughGuardrailAdapter,
    InMemoryRagAdapter,
    InMemoryToolRegistryAdapter,
    NoOpAuthAdapter,
    InMemoryRateLimitAdapter,
    InMemoryAuditLogAdapter,
} from './built-in.js';

// ── Production preset ──────────────────────────────────────────────────────
export { createProductionSetup } from './production.js';
export type { ProductionSetupOptions, ProductionSetup } from './production.js';

// ── Universal foreign-system tool adapters ───────────────────────────────────
export {
    fromOpenAITool,
    fromOpenAITools,
    jsonSchemaToZodObject,
    fromHttpTool,
    fromForeignTool,
    fromForeignTools,
} from './universal/index.js';
export type {
    OpenAIFunctionTool,
    OpenAIToolAdapterOptions,
    HttpToolOptions,
    ForeignTool,
} from './universal/index.js';

