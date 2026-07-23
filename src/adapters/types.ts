/**
 * Universal Adapter & Plugin System
 *
 * A single extensibility layer covering every storage / database / integration
 * category the industry uses today.  Any module in the framework (session,
 * memory, storage, knowledge, observability, queue, analytics …) can declare
 * the adapter category it needs and the registry provides the right driver.
 *
 * ## Relationship with contracts/index.ts
 *
 * `contracts/index.ts` defines **domain-model** interfaces (MemoryStore, SessionStore,
 * LLMProvider, ToolRegistry) used by the agent planning/execution subsystem.
 *
 * This file (`adapters/types.ts`) defines **infrastructure** interfaces — pluggable
 * persistence backends that implement specific storage categories (SQL, NoSQL,
 * vector, cache, etc.) and framework-level adapters (SessionStoreAdapter,
 * MemoryStoreAdapter, GuardrailAdapter, etc.).
 *
 * The canonical import surface for pluggable interfaces is `contracts/extensions.ts`,
 * which re-exports from the authoritative source module for each interface.
 *
 * Categories
 * ──────────────────────────────────────────────────────────────────────────
 *  sql           – PostgreSQL, MySQL, SQLite, MS SQL, CockroachDB, PlanetScale
 *  nosql         – MongoDB, DynamoDB, Firestore, Cassandra, CouchDB
 *  vector        – Pinecone, Weaviate, Qdrant, Chroma, Milvus, pgvector
 *  analytics     – DuckDB, ClickHouse, BigQuery, Snowflake, Redshift, Athena
 *  search        – Elasticsearch, OpenSearch, Typesense, MeiliSearch, Algolia
 *  cache         – Redis, Memcached, Upstash, DragonflyDB, in-memory
 *  object-storage– S3, GCS, Azure Blob, R2, MinIO, local file
 *  time-series   – InfluxDB, TimescaleDB, QuestDB, Prometheus remote write
 *  graph         – Neo4j, ArangoDB, Amazon Neptune, FalkorDB
 *  message-queue – RabbitMQ, Kafka, SQS, Pub/Sub, NATS, BullMQ
 *  observability – OpenTelemetry, Datadog, Grafana Loki, Axiom
 *  embedding     – OpenAI, Cohere, Voyage, HuggingFace, local ONNX
 *  session-store – Any session persistence backend
 *  memory-store  – Any long-term / vector memory backend
 *  guardrail     – Content moderation, compliance, safety rules
 *  rag           – Retrieval-augmented generation pipeline
 *  tool-registry – External or remote tool registries
 *  auth          – JWT, OAuth2, API-key, mTLS identity validation
 *  rate-limit    – Token-bucket, sliding-window, fixed-window
 *  audit-log     – Immutable activity logging for compliance
 *  llm           – Any LLM backend (thin adapter bridge)
 *  custom        – Anything else
 */

// ── Base ───────────────────────────────────────────────────────────────────

/** All categories an adapter can belong to. */
export type AdapterCategory =
    | 'sql'
    | 'nosql'
    | 'vector'
    | 'analytics'
    | 'search'
    | 'cache'
    | 'object-storage'
    | 'time-series'
    | 'graph'
    | 'message-queue'
    | 'observability'
    | 'embedding'
    // ── Framework-level adapter categories ──────────────────────────────────
    | 'session-store'
    | 'memory-store'
    | 'guardrail'
    | 'rag'
    | 'tool-registry'
    | 'auth'
    | 'rate-limit'
    | 'audit-log'
    | 'llm'
    | 'custom';

/** Metadata every adapter must provide. */
export interface AdapterMeta {
    /** Unique adapter name, e.g. `"postgres"`, `"duckdb"`, `"pinecone"`. */
    readonly name: string;
    /** Category this adapter belongs to. */
    readonly category: AdapterCategory;
    /** Semver string, e.g. `"1.0.0"`. */
    readonly version: string;
    /** Human-readable description. */
    readonly description?: string;
    /** Optional extra tags for discovery (e.g. `["olap", "embedded"]`). */
    readonly tags?: string[];
}

/** Base adapter – all adapters extend this. */
export interface Adapter extends AdapterMeta {
    /** Open connections / warmup.  Called once by the registry at `connectAll()`. */
    connect?(): Promise<void>;
    /** Gracefully close all connections. */
    disconnect?(): Promise<void>;
    /** Returns `true` once `connect()` has succeeded. */
    isConnected(): boolean;
    /** Optional liveness probe. */
    healthCheck?(): Promise<AdapterHealth>;
}

/** Result of a liveness probe. */
export interface AdapterHealth {
    readonly ok: boolean;
    readonly latencyMs?: number;
    readonly message?: string;
}

// ── SQL ────────────────────────────────────────────────────────────────────

/** Row returned from a SQL query. */
export type SqlRow = Record<string, unknown>;

/** Options for query execution. */
export interface SqlQueryOptions {
    /** Statement timeout in ms (adapter-specific). */
    timeoutMs?: number;
    /** Named cursor / prepared statement identifier. */
    cursorName?: string;
}

/** A transaction handle. */
export interface SqlTransaction {
    query<T extends SqlRow = SqlRow>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
    execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
}

/**
 * SQL adapter — PostgreSQL, MySQL, SQLite, CockroachDB, MS SQL, PlanetScale …
 *
 * @example
 * ```ts
 * const pg = registry.resolve<SqlAdapter>('sql', 'postgres');
 * const { rows } = await pg.query<{ count: number }>('SELECT COUNT(*) AS count FROM users');
 * ```
 */
export interface SqlAdapter extends Adapter {
    readonly category: 'sql';
    /** Execute a parameterised query and return typed rows. */
    query<T extends SqlRow = SqlRow>(sql: string, params?: unknown[], opts?: SqlQueryOptions): Promise<{ rows: T[]; rowCount: number }>;
    /** Execute DML/DDL. Returns rows-affected count. */
    execute(sql: string, params?: unknown[], opts?: SqlQueryOptions): Promise<{ rowsAffected: number }>;
    /** Run a block inside a single ACID transaction. */
    transaction<T>(fn: (tx: SqlTransaction) => Promise<T>): Promise<T>;
    /** Stream rows (for large result sets). */
    stream?<T extends SqlRow = SqlRow>(sql: string, params?: unknown[]): AsyncIterable<T>;
    /** Returns the underlying raw client (pg.Pool, mysql2.Connection, etc.). */
    rawClient?(): unknown;
}

// ── NoSQL ──────────────────────────────────────────────────────────────────

/** Projection / sort document (MongoDB-style). */
export interface NoSqlProjection {
    fields?: Record<string, 0 | 1>;
    sort?: Record<string, 1 | -1>;
    limit?: number;
    skip?: number;
}

/**
 * NoSQL / document store adapter — MongoDB, DynamoDB, Firestore, Cassandra …
 *
 * @example
 * ```ts
 * const mongo = registry.resolve<NoSqlAdapter>('nosql', 'mongodb');
 * await mongo.insert('sessions', { userId: 'u1', messages: [] });
 * const session = await mongo.findOne<Session>('sessions', { userId: 'u1' });
 * ```
 */
export interface NoSqlAdapter extends Adapter {
    readonly category: 'nosql';
    find<T = unknown>(collection: string, filter: Record<string, unknown>, projection?: NoSqlProjection): Promise<T[]>;
    findOne<T = unknown>(collection: string, filter: Record<string, unknown>): Promise<T | undefined>;
    insert<T = unknown>(collection: string, doc: T): Promise<string>;
    insertMany<T = unknown>(collection: string, docs: T[]): Promise<string[]>;
    update(collection: string, filter: Record<string, unknown>, update: Record<string, unknown>, upsert?: boolean): Promise<number>;
    delete(collection: string, filter: Record<string, unknown>): Promise<number>;
    aggregate<T = unknown>(collection: string, pipeline: unknown[]): Promise<T[]>;
    createIndex?(collection: string, keys: Record<string, 1 | -1 | 'text'>, options?: Record<string, unknown>): Promise<void>;
    rawClient?(): unknown;
}

// ── Vector ─────────────────────────────────────────────────────────────────

/** A vector record to upsert. */
export interface VectorRecord {
    id: string;
    vector: number[];
    payload?: Record<string, unknown>;
}

/** A vector similarity match returned from a query. */
export interface VectorMatch {
    id: string;
    score: number;
    payload?: Record<string, unknown>;
    vector?: number[];
}

/** Distance / similarity metric. */
export type VectorMetric = 'cosine' | 'euclidean' | 'dot-product';

/**
 * Vector database adapter — Pinecone, Weaviate, Qdrant, Chroma, Milvus, pgvector …
 *
 * @example
 * ```ts
 * const qdrant = registry.resolve<VectorAdapter>('vector', 'qdrant');
 * await qdrant.upsert('docs', [{ id: '1', vector: embed, payload: { text } }]);
 * const hits = await qdrant.query('docs', queryEmbed, 5);
 * ```
 */
export interface VectorAdapter extends Adapter {
    readonly category: 'vector';
    createCollection?(collection: string, dimension: number, metric?: VectorMetric): Promise<void>;
    deleteCollection?(collection: string): Promise<void>;
    upsert(collection: string, records: VectorRecord[]): Promise<void>;
    query(collection: string, vector: number[], topK: number, filter?: Record<string, unknown>): Promise<VectorMatch[]>;
    delete(collection: string, ids: string[]): Promise<void>;
    fetch?(collection: string, ids: string[]): Promise<VectorRecord[]>;
    count?(collection: string): Promise<number>;
    rawClient?(): unknown;
}

// ── Analytics / OLAP ───────────────────────────────────────────────────────

/** Import source for bulk loads. */
export interface AnalyticsImportSource {
    format: 'csv' | 'parquet' | 'json' | 'arrow' | 'ndjson';
    /** Either a file-system path, HTTP URL, or in-memory Buffer / string. */
    source: string | Buffer;
    table: string;
    /** Create the table if it doesn't exist. Default: true. */
    createIfMissing?: boolean;
    /** Replace existing table. Default: false. */
    replace?: boolean;
}

/** Export format. */
export type AnalyticsExportFormat = 'csv' | 'parquet' | 'json' | 'arrow';

/**
 * Analytics / OLAP adapter — DuckDB, ClickHouse, BigQuery, Snowflake, Redshift, Athena …
 *
 * @example
 * ```ts
 * const duckdb = registry.resolve<AnalyticsAdapter>('analytics', 'duckdb');
 * await duckdb.import({ format: 'parquet', source: './events.parquet', table: 'events' });
 * const rows = await duckdb.query('SELECT date_trunc(\'day\', ts) d, sum(revenue) FROM events GROUP BY d');
 * ```
 */
export interface AnalyticsAdapter extends Adapter {
    readonly category: 'analytics';
    query<T = SqlRow>(sql: string, params?: unknown[]): Promise<T[]>;
    execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
    import(source: AnalyticsImportSource): Promise<{ rowsImported: number }>;
    export(query: string, format: AnalyticsExportFormat): Promise<Buffer>;
    /** Stream results row-by-row for memory-efficient processing. */
    stream?<T = SqlRow>(sql: string, params?: unknown[]): AsyncIterable<T>;
    rawClient?(): unknown;
}

// ── Search ─────────────────────────────────────────────────────────────────

/** A document to index. */
export interface SearchDocument {
    id: string;
    [field: string]: unknown;
}

/** Options for a search query. */
export interface SearchQueryOptions {
    limit?: number;
    offset?: number;
    filter?: Record<string, unknown>;
    /** Fields to search. Default: all text fields. */
    fields?: string[];
    /** Boost specific fields (e.g. `{ title: 2 }`). */
    boost?: Record<string, number>;
    /** Sort criteria (e.g. `[{ field: 'date', order: 'desc' }]`). */
    sort?: Array<{ field: string; order: 'asc' | 'desc' }>;
    /** Highlight matching tokens. Default: false. */
    highlight?: boolean;
}

/** A single search hit. */
export interface SearchHit {
    id: string;
    score: number;
    document: Record<string, unknown>;
    highlights?: Record<string, string[]>;
}

/**
 * Full-text search adapter — Elasticsearch, OpenSearch, Typesense, MeiliSearch, Algolia …
 */
export interface SearchAdapter extends Adapter {
    readonly category: 'search';
    createIndex?(index: string, schema?: Record<string, unknown>): Promise<void>;
    deleteIndex?(index: string): Promise<void>;
    index(index: string, docs: SearchDocument[]): Promise<void>;
    search(index: string, query: string, options?: SearchQueryOptions): Promise<{ hits: SearchHit[]; total: number }>;
    delete(index: string, ids: string[]): Promise<void>;
    rawClient?(): unknown;
}

// ── Cache ──────────────────────────────────────────────────────────────────

/**
 * Cache adapter — Redis, Upstash Redis, Memcached, DragonflyDB, in-memory …
 *
 * @example
 * ```ts
 * const redis = registry.resolve<CacheAdapter>('cache', 'redis');
 * await redis.set('session:abc', { messages: [] }, 3600_000); // 1-hour TTL
 * ```
 */
export interface CacheAdapter extends Adapter {
    readonly category: 'cache';
    get<T = unknown>(key: string): Promise<T | undefined>;
    set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void>;
    delete(key: string): Promise<void>;
    has(key: string): Promise<boolean>;
    keys(pattern?: string): Promise<string[]>;
    mget<T = unknown>(keys: string[]): Promise<(T | undefined)[]>;
    mset(entries: Array<{ key: string; value: unknown; ttlMs?: number }>): Promise<void>;
    mdelete(keys: string[]): Promise<void>;
    flush?(): Promise<void>;
    /** Atomic increment (for counters / rate-limiting). */
    incr?(key: string, by?: number): Promise<number>;
    /** Pub/sub: publish a message to a channel. */
    publish?(channel: string, message: unknown): Promise<void>;
    /** Pub/sub: subscribe to a channel. */
    subscribe?(channel: string, handler: (message: unknown) => void): Promise<() => void>;
    rawClient?(): unknown;
}

// ── Object Storage ─────────────────────────────────────────────────────────

/** Options for an upload operation. */
export interface ObjectUploadOptions {
    contentType?: string;
    metadata?: Record<string, string>;
    /** Server-side encryption. */
    encrypt?: boolean;
    /** Cache-Control header. */
    cacheControl?: string;
    /** Storage class / tier (e.g. 'STANDARD', 'INTELLIGENT_TIERING'). */
    storageClass?: string;
}

/** Metadata for a stored object. */
export interface ObjectInfo {
    key: string;
    size: number;
    lastModified: Date;
    contentType?: string;
    metadata?: Record<string, string>;
    etag?: string;
}

/**
 * Object / blob storage adapter — AWS S3, GCS, Azure Blob, Cloudflare R2, MinIO, local …
 *
 * @example
 * ```ts
 * const s3 = registry.resolve<ObjectStorageAdapter>('object-storage', 's3');
 * const { url } = await s3.upload('my-bucket', 'exports/report.pdf', pdfBuffer);
 * ```
 */
export interface ObjectStorageAdapter extends Adapter {
    readonly category: 'object-storage';
    upload(bucket: string, key: string, data: Buffer | string | ReadableStream, options?: ObjectUploadOptions): Promise<{ url: string; etag?: string }>;
    download(bucket: string, key: string): Promise<Buffer>;
    downloadStream?(bucket: string, key: string): Promise<ReadableStream>;
    delete(bucket: string, key: string): Promise<void>;
    deleteMany?(bucket: string, keys: string[]): Promise<void>;
    list(bucket: string, prefix?: string, limit?: number): Promise<ObjectInfo[]>;
    info?(bucket: string, key: string): Promise<ObjectInfo | undefined>;
    copy?(fromBucket: string, fromKey: string, toBucket: string, toKey: string): Promise<void>;
    getSignedUrl?(bucket: string, key: string, operation: 'get' | 'put', expiresInMs?: number): Promise<string>;
    createBucket?(bucket: string, options?: Record<string, unknown>): Promise<void>;
    rawClient?(): unknown;
}

// ── Time Series ────────────────────────────────────────────────────────────

/** A time-series data point. */
export interface TimeSeriesPoint {
    measurement: string;
    tags: Record<string, string>;
    fields: Record<string, number | string | boolean>;
    timestamp?: Date;
}

/**
 * Time-series adapter — InfluxDB, TimescaleDB, QuestDB, Prometheus remote-write …
 */
export interface TimeSeriesAdapter extends Adapter {
    readonly category: 'time-series';
    write(points: TimeSeriesPoint[]): Promise<void>;
    query<T = unknown>(fluxOrSql: string, params?: Record<string, unknown>): Promise<T[]>;
    queryRange<T = unknown>(measurement: string, start: Date, end: Date, tags?: Record<string, string>): Promise<T[]>;
    delete?(measurement: string, start: Date, end: Date, predicate?: string): Promise<void>;
    rawClient?(): unknown;
}

// ── Graph ──────────────────────────────────────────────────────────────────

/** A graph node. */
export interface GraphNode {
    id: string;
    labels: string[];
    properties: Record<string, unknown>;
}

/** A graph relationship. */
export interface GraphRelationship {
    id: string;
    type: string;
    startNodeId: string;
    endNodeId: string;
    properties: Record<string, unknown>;
}

/** Graph query result. */
export interface GraphQueryResult<T = unknown> {
    records: T[];
    summary?: Record<string, unknown>;
}

/**
 * Graph database adapter — Neo4j, ArangoDB, Amazon Neptune, FalkorDB …
 *
 * @example
 * ```ts
 * const neo4j = registry.resolve<GraphAdapter>('graph', 'neo4j');
 * await neo4j.createNode(['Person'], { name: 'Alice' });
 * const result = await neo4j.query('MATCH (p:Person) RETURN p LIMIT 10');
 * ```
 */
export interface GraphAdapter extends Adapter {
    readonly category: 'graph';
    query<T = unknown>(cypher: string, params?: Record<string, unknown>): Promise<GraphQueryResult<T>>;
    createNode(labels: string[], properties: Record<string, unknown>): Promise<string>;
    updateNode(id: string, properties: Record<string, unknown>): Promise<void>;
    deleteNode(id: string, detach?: boolean): Promise<void>;
    createRelationship(fromId: string, toId: string, type: string, properties?: Record<string, unknown>): Promise<string>;
    deleteRelationship(id: string): Promise<void>;
    findNode?(labels: string[], filter: Record<string, unknown>): Promise<GraphNode[]>;
    rawClient?(): unknown;
}

// ── Message Queue ──────────────────────────────────────────────────────────

/** A message received from a queue. */
export interface QueueMessage<T = unknown> {
    id: string;
    queue: string;
    payload: T;
    receivedAt: Date;
    retryCount: number;
    metadata?: Record<string, unknown>;
}

/** Options for producing a message. */
export interface QueuePublishOptions {
    /** Delay before delivery (ms). */
    delayMs?: number;
    /** Message priority (higher = first). */
    priority?: number;
    /** Message TTL in ms. */
    ttlMs?: number;
    /** Deduplication key. */
    deduplicationId?: string;
    /** Group key (FIFO queues). */
    messageGroupId?: string;
}

/** Options for a consumer. */
export interface QueueConsumeOptions {
    /** Max messages to fetch per poll. */
    batchSize?: number;
    /** Visibility timeout in ms. */
    visibilityTimeoutMs?: number;
    /** Long-poll wait time in ms. */
    waitTimeMs?: number;
    /** Auto-ack on successful handler. Default: true. */
    autoAck?: boolean;
    /** Max retries before DLQ. */
    maxRetries?: number;
}

/**
 * Message queue / stream adapter — RabbitMQ, Kafka, AWS SQS, Google Pub/Sub, NATS, BullMQ …
 */
export interface MessageQueueAdapter extends Adapter {
    readonly category: 'message-queue';
    publish<T = unknown>(queue: string, message: T, options?: QueuePublishOptions): Promise<string>;
    publishBatch?<T = unknown>(queue: string, messages: T[], options?: QueuePublishOptions): Promise<string[]>;
    consume<T = unknown>(queue: string, handler: (msg: QueueMessage<T>) => Promise<void>, options?: QueueConsumeOptions): Promise<() => Promise<void>>;
    ack(messageId: string): Promise<void>;
    nack(messageId: string, requeue?: boolean): Promise<void>;
    purge?(queue: string): Promise<number>;
    createQueue?(queue: string, options?: Record<string, unknown>): Promise<void>;
    deleteQueue?(queue: string): Promise<void>;
    rawClient?(): unknown;
}

// ── Observability ──────────────────────────────────────────────────────────

/** A structured log entry for the observability adapter. */
export interface ObservabilityLogEntry {
    level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    message: string;
    timestamp: Date;
    fields?: Record<string, unknown>;
    traceId?: string;
    spanId?: string;
    service?: string;
}

/** An OpenTelemetry-compatible span (simplified). */
export interface TraceSpan {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    startTime: Date;
    endTime?: Date;
    status?: 'ok' | 'error' | 'unset';
    attributes?: Record<string, string | number | boolean>;
    events?: Array<{ name: string; timestamp: Date; attributes?: Record<string, unknown> }>;
}

/** A metric data point. */
export interface MetricPoint {
    name: string;
    value: number;
    type: 'counter' | 'gauge' | 'histogram' | 'summary';
    tags?: Record<string, string>;
    timestamp?: Date;
}

/**
 * Observability adapter — OpenTelemetry collector, Datadog, Grafana Loki, Axiom, New Relic …
 */
export interface ObservabilityAdapter extends Adapter {
    readonly category: 'observability';
    log(entry: ObservabilityLogEntry): Promise<void>;
    logBatch?(entries: ObservabilityLogEntry[]): Promise<void>;
    trace(span: TraceSpan): Promise<void>;
    metric(point: MetricPoint): Promise<void>;
    metricBatch?(points: MetricPoint[]): Promise<void>;
    /** Flush buffered telemetry (call before process exit). */
    flush?(): Promise<void>;
    rawClient?(): unknown;
}

// ── Embedding ─────────────────────────────────────────────────────────────

/** Options for generating embeddings. */
export interface EmbeddingOptions {
    /** Model override (e.g. `"text-embedding-3-large"`). */
    model?: string;
    /** Dimensionality (if the model supports it). */
    dimensions?: number;
    /** Batch size for bulk operations. Default: 100. */
    batchSize?: number;
}

/**
 * Embedding adapter — OpenAI, Cohere, Voyage AI, Jina, HuggingFace, local ONNX …
 */
export interface EmbeddingAdapter extends Adapter {
    readonly category: 'embedding';
    /** Embed a single string. */
    embed(text: string, options?: EmbeddingOptions): Promise<number[]>;
    /** Embed many strings (batched internally). */
    embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]>;
    /** Dimensionality of the default model's output. */
    readonly dimensions: number;
}

// ── Session Store ──────────────────────────────────────────────────────────

/** A stored session including messages + arbitrary state. */
export interface StoredSession {
    id: string;
    agentId?: string;
    userId?: string;
    state: 'active' | 'paused' | 'completed' | 'failed';
    messages: SessionMessage[];
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
    expiresAt?: Date;
}

/** A message stored inside a session. */
export interface SessionMessage {
    id: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    toolName?: string;
    toolCallId?: string;
    createdAt: Date;
    metadata?: Record<string, unknown>;
}

/**
 * Session store adapter — Redis, DynamoDB, PostgreSQL, D1, in-memory …
 *
 * Implement this interface to plug any backend into the session layer.
 *
 * @example
 * ```ts
 * import { createAdapterRegistry } from 'personaforge/adapters';
 * const registry = createAdapterRegistry();
 * registry.register(myRedisSessionAdapter);
 * ```
 */
export interface SessionStoreAdapter extends Adapter {
    readonly category: 'session-store';
    create(session: Omit<StoredSession, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoredSession>;
    get(sessionId: string): Promise<StoredSession | null>;
    update(sessionId: string, updates: Partial<Omit<StoredSession, 'id' | 'createdAt'>>): Promise<StoredSession>;
    delete(sessionId: string): Promise<boolean>;
    list(filter?: { agentId?: string; userId?: string; state?: StoredSession['state']; limit?: number }): Promise<StoredSession[]>;
    addMessage(sessionId: string, message: Omit<SessionMessage, 'id' | 'createdAt'>): Promise<StoredSession>;
    getMessages(sessionId: string, limit?: number): Promise<SessionMessage[]>;
    touch(sessionId: string): Promise<void>;
    purgeExpired?(): Promise<number>;
}

// ── Memory Store ───────────────────────────────────────────────────────────

/** A single entry persisted in long-term memory. */
export interface MemoryEntry {
    id: string;
    agentId?: string;
    userId?: string;
    type: 'fact' | 'episode' | 'skill' | 'preference' | string;
    content: string;
    embedding?: number[];
    tags?: string[];
    importance?: number;
    metadata?: Record<string, unknown>;
    createdAt: Date;
    expiresAt?: Date;
}

/** Result from a semantic memory search. */
export interface MemorySearchResult {
    entry: MemoryEntry;
    score: number;
}

/**
 * Memory store adapter — Pinecone, Qdrant, Weaviate, pgvector, in-memory …
 *
 * Implement this interface to swap the long-term memory backend.
 *
 * @example
 * ```ts
 * createAgent({ adapters: { memoryStore: myPineconeAdapter } });
 * ```
 */
export interface MemoryStoreAdapter extends Adapter {
    readonly category: 'memory-store';
    store(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry>;
    retrieve(query: string, options?: {
        agentId?: string;
        userId?: string;
        type?: string;
        limit?: number;
        threshold?: number;
        embedding?: number[];
    }): Promise<MemorySearchResult[]>;
    get(id: string): Promise<MemoryEntry | null>;
    update(id: string, updates: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>): Promise<MemoryEntry>;
    delete(id: string): Promise<boolean>;
    clear(type?: string): Promise<void>;
    count?(filter?: { agentId?: string; type?: string }): Promise<number>;
}

// ── Guardrail ──────────────────────────────────────────────────────────────

/** Result returned by a single guardrail check. */
export interface GuardrailCheckResult {
    passed: boolean;
    rule: string;
    severity: 'error' | 'warning' | 'info';
    message?: string;
    details?: unknown;
}

/** What the guardrail adapter is checking. */
export interface GuardrailAdapterContext {
    agentId: string;
    sessionId?: string;
    userId?: string;
    /** 'input'  = user message before the LLM sees it
     *  'output' = LLM reply before it reaches the user
     *  'tool'   = tool call + args */
    phase: 'input' | 'output' | 'tool';
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    content?: string;
    output?: unknown;
    metadata?: Record<string, unknown>;
}

/**
 * Guardrail adapter — AWS Bedrock Guardrails, Azure Content Safety, custom NLP …
 *
 * @example
 * ```ts
 * createAgent({ adapters: { guardrail: myContentSafetyAdapter } });
 * ```
 */
export interface GuardrailAdapter extends Adapter {
    readonly category: 'guardrail';
    /** Run all checks for the given context. Resolve to list of results. */
    check(context: GuardrailAdapterContext): Promise<GuardrailCheckResult[]>;
    /** Convenience — true only if every check passes. */
    passes(context: GuardrailAdapterContext): Promise<boolean>;
    /** Add a custom rule at runtime (optional). */
    addRule?(rule: { name: string; check(ctx: GuardrailAdapterContext): Promise<GuardrailCheckResult> }): void;
}

// ── RAG ────────────────────────────────────────────────────────────────────

/** A single retrieved document chunk. */
export interface RetrievedDocument {
    id: string;
    content: string;
    score: number;
    source?: string;
    metadata?: Record<string, unknown>;
}

/** Options for a RAG retrieval query. */
export interface RagRetrieveOptions {
    /** Number of documents to retrieve. Default: 5. */
    topK?: number;
    /** Minimum similarity threshold (0-1). */
    minScore?: number;
    /** Filter by metadata fields. */
    filter?: Record<string, unknown>;
    /** Override embedding to use. */
    embedding?: number[];
    /** Namespace / collection to query. */
    namespace?: string;
}

/**
 * RAG (Retrieval-Augmented Generation) adapter.
 *
 * A full-pipeline adapter: handles chunking, embedding, indexing,
 * and retrieval behind a single interface.
 *
 * @example
 * ```ts
 * createAgent({ adapters: { rag: myRagAdapter } });
 * ```
 */
export interface RagAdapter extends Adapter {
    readonly category: 'rag';
    /** Retrieve relevant documents for a natural-language query. */
    retrieve(query: string, options?: RagRetrieveOptions): Promise<RetrievedDocument[]>;
    /** Ingest a document (chunked + embedded internally). */
    ingest(document: {
        id?: string;
        content: string;
        source?: string;
        metadata?: Record<string, unknown>;
    }): Promise<string>;
    /** Batch ingest. */
    ingestBatch(documents: Array<{
        id?: string;
        content: string;
        source?: string;
        metadata?: Record<string, unknown>;
    }>): Promise<string[]>;
    /** Remove a document by ID. */
    deleteDocument(id: string): Promise<boolean>;
    /** Build context string from a query (retrieve + format). */
    buildContext(query: string, options?: RagRetrieveOptions): Promise<string>;
    /** Total number of indexed documents. */
    count?(): Promise<number>;
}

// ── Tool Registry ──────────────────────────────────────────────────────────

/** Descriptor for a remotely registered tool. */
export interface RemoteToolDescriptor {
    name: string;
    description: string;
    /** JSON Schema for the tool's input parameters. */
    inputSchema: Record<string, unknown>;
    /** JSON Schema for the expected output. */
    outputSchema?: Record<string, unknown>;
    /** Execution endpoint or MCP URL. */
    endpoint?: string;
    tags?: string[];
    version?: string;
}

/**
 * Tool registry adapter — MCP servers, LangChain tool hubs, remote HTTP tools …
 *
 * @example
 * ```ts
 * createAgent({ adapters: { toolRegistry: myMcpRegistryAdapter } });
 * ```
 */
export interface ToolRegistryAdapter extends Adapter {
    readonly category: 'tool-registry';
    /** List all available tools (optionally filtered by tags). */
    list(filter?: { tags?: string[] }): Promise<RemoteToolDescriptor[]>;
    /** Look up a specific tool by name. */
    find(name: string): Promise<RemoteToolDescriptor | null>;
    /** Call a remote tool and return its output. */
    call(name: string, args: Record<string, unknown>): Promise<unknown>;
    /** Register / publish a new tool. */
    register?(descriptor: Omit<RemoteToolDescriptor, 'version'>): Promise<void>;
    /** Un-register a tool. */
    unregister?(name: string): Promise<void>;
}

// ── Auth ───────────────────────────────────────────────────────────────────

/** Authenticated identity. */
export interface AuthIdentity {
    id: string;
    type: 'user' | 'agent' | 'service' | 'api-key';
    roles?: string[];
    scopes?: string[];
    metadata?: Record<string, unknown>;
    /** Unix epoch (seconds) when this identity expires. */
    expiresAt?: number;
}

/** Result of an auth check. */
export interface AuthResult {
    valid: boolean;
    identity?: AuthIdentity;
    reason?: string;
}

/**
 * Auth adapter — JWT validators, OAuth2 introspection, API-key lookup, mTLS …
 *
 * @example
 * ```ts
 * createAgent({ adapters: { auth: myJwtAdapter } });
 * ```
 */
export interface AuthAdapter extends Adapter {
    readonly category: 'auth';
    /** Validate a raw credential (token, API key, cert). */
    validate(credential: string, context?: Record<string, unknown>): Promise<AuthResult>;
    /** Generate a credential for an identity (optional). */
    issue?(identity: Omit<AuthIdentity, 'id'>): Promise<string>;
    /** Revoke a credential. */
    revoke?(credential: string): Promise<void>;
    /** Check if an identity has a specific permission. */
    can?(identity: AuthIdentity, permission: string, resource?: string): Promise<boolean>;
}

// ── Rate Limit ─────────────────────────────────────────────────────────────

/** Options for a rate-limit check. */
export interface RateLimitOptions {
    /** Bucket identifier (user-id, ip, agent-id, or composite). */
    key: string;
    /** Name of the limit rule (e.g. `"global"`, `"per-tool:search"`). */
    rule?: string;
    /** Weight of this request (default: 1). */
    cost?: number;
}

/** Result of a rate-limit check. */
export interface RateLimitResult {
    allowed: boolean;
    /** Remaining capacity in the current window. */
    remaining: number;
    /** Total capacity for the window. */
    limit: number;
    /** Seconds until the window resets. */
    resetInSeconds: number;
    /** Retry-After header value (seconds), present when `allowed === false`. */
    retryAfterSeconds?: number;
}

/**
 * Rate-limit adapter — Redis token-bucket, Upstash, in-memory sliding-window …
 *
 * @example
 * ```ts
 * createAgent({ adapters: { rateLimit: myRedisRateLimiter } });
 * ```
 */
export interface RateLimitAdapter extends Adapter {
    readonly category: 'rate-limit';
    /** Check (and conditionally consume) capacity. */
    check(options: RateLimitOptions): Promise<RateLimitResult>;
    /** Consume without pre-checking (throws if exceeded). */
    consume(options: RateLimitOptions): Promise<RateLimitResult>;
    /** Reset a key's counter immediately. */
    reset(key: string, rule?: string): Promise<void>;
    /** Return current state without consuming. */
    peek?(options: Omit<RateLimitOptions, 'cost'>): Promise<RateLimitResult>;
}

// ── Audit Log ──────────────────────────────────────────────────────────────

/** A single immutable audit event. */
export interface AuditEvent {
    id?: string;
    agentId: string;
    sessionId?: string;
    userId?: string;
    /** What happened, e.g. `"tool.call"`, `"session.created"`, `"guardrail.blocked"`. */
    action: string;
    resource?: string;
    status: 'success' | 'failure' | 'blocked' | 'pending';
    details?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
    durationMs?: number;
    timestamp: Date;
}

/** Query filter for audit log retrieval. */
export interface AuditQuery {
    agentId?: string;
    sessionId?: string;
    userId?: string;
    action?: string;
    status?: AuditEvent['status'];
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
}

/**
 * Audit log adapter — append-only compliance log backed by any DB or log service.
 *
 * Implementations: PostgreSQL, CloudWatch, OpenSearch, Azure Monitor, file …
 *
 * @example
 * ```ts
 * createAgent({ adapters: { auditLog: myPostgresAuditAdapter } });
 * ```
 */
export interface AuditLogAdapter extends Adapter {
    readonly category: 'audit-log';
    /** Append an event. Returns the stored event with assigned `id`. */
    log(event: Omit<AuditEvent, 'id'>): Promise<AuditEvent>;
    /** Retrieve events matching a query. */
    query(filter?: AuditQuery): Promise<AuditEvent[]>;
    /** Count events matching a filter. */
    count?(filter?: AuditQuery): Promise<number>;
    /** Export events (for compliance reports). */
    export?(filter?: AuditQuery, format?: 'json' | 'csv'): Promise<string>;
}

// ── Module Bindings ────────────────────────────────────────────────────────

/**
 * Explicit per-module adapter bindings.
 * All fields are optional — omit any to keep the framework's built-in default.
 *
 * @example
 * ```ts
 * createAgent({
 *   adapters: {
 *     session: redisAdapter,
 *     memory:  pineconeAdapter,
 *     storage: s3Adapter,
 *   },
 * });
 * ```
 */
export interface AdapterBindings {
    /** Session store: fast reads/writes per conversation. Cache or SQL adapters work well. */
    session?: CacheAdapter | SqlAdapter | NoSqlAdapter;
    /** Structured session-store adapter (full session lifecycle). */
    sessionStore?: SessionStoreAdapter;
    /** Long-term memory / vector recall (legacy: use `memoryStore`). */
    memory?: VectorAdapter;
    /** Long-term memory store (full memory lifecycle). */
    memoryStore?: MemoryStoreAdapter;
    /** Generic key-value / blob storage used by the storage module. */
    storage?: CacheAdapter | ObjectStorageAdapter;
    /** Knowledge / RAG retrieval backend. */
    knowledge?: VectorAdapter | SearchAdapter;
    /** RAG pipeline adapter (retrieve, ingest, build-context). */
    rag?: RagAdapter;
    /** Observability sink for logs, traces, metrics. */
    observability?: ObservabilityAdapter;
    /** Task / event queue for async work. */
    queue?: MessageQueueAdapter;
    /** Analytics / OLAP queries run by tools or workflows. */
    analytics?: AnalyticsAdapter;
    /** Relational data access. */
    database?: SqlAdapter | NoSqlAdapter | AnalyticsAdapter | GraphAdapter;
    /** Embedding generation override (replaces the LLM provider's embedder). */
    embedding?: EmbeddingAdapter;
    /** Content safety / compliance guardrail adapter. */
    guardrail?: GuardrailAdapter;
    /** Remote / external tool registry. */
    toolRegistry?: ToolRegistryAdapter;
    /** Authentication & authorization adapter. */
    auth?: AuthAdapter;
    /** Rate-limiting adapter (throttle users / agents / tools). */
    rateLimit?: RateLimitAdapter;
    /** Immutable audit / compliance event log. */
    auditLog?: AuditLogAdapter;
}

// ── Convenience union ──────────────────────────────────────────────────────

/** Union of all adapter types. */
export type AnyAdapter =
    | SqlAdapter
    | NoSqlAdapter
    | VectorAdapter
    | AnalyticsAdapter
    | SearchAdapter
    | CacheAdapter
    | ObjectStorageAdapter
    | TimeSeriesAdapter
    | GraphAdapter
    | MessageQueueAdapter
    | ObservabilityAdapter
    | EmbeddingAdapter
    | SessionStoreAdapter
    | MemoryStoreAdapter
    | GuardrailAdapter
    | RagAdapter
    | ToolRegistryAdapter
    | AuthAdapter
    | RateLimitAdapter
    | AuditLogAdapter
    | Adapter;
