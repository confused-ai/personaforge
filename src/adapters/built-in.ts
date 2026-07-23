/**
 * Built-in adapters — zero-dependency implementations that work everywhere.
 *
 * These serve as:
 *   1. Default fallbacks so the framework works out-of-the-box.
 *   2. Canonical reference implementations for building your own adapters.
 *   3. Stubs showing the exact shape third-party adapters must satisfy.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SWAPPING TO PRODUCTION DRIVERS
 * ─────────────────────────────────────────────────────────────────────────
 * Install the matching package and register its adapter instead:
 *
 *   Category         Package (community / official)
 *   ─────────────────────────────────────────────────
 *   sql/postgres     personaforge-adapter-postgres     (pg / postgres.js)
 *   sql/mysql        personaforge-adapter-mysql         (mysql2)
 *   sql/sqlite       personaforge-adapter-sqlite        (better-sqlite3)
 *   nosql/mongodb    personaforge-adapter-mongodb       (@mongodb/driver)
 *   nosql/dynamodb   personaforge-adapter-dynamodb      (@aws-sdk/client-dynamodb)
 *   vector/pinecone  personaforge-adapter-pinecone      (@pinecone-database/pinecone)
 *   vector/qdrant    personaforge-adapter-qdrant        (@qdrant/js-client-rest)
 *   vector/weaviate  personaforge-adapter-weaviate      (weaviate-client)
 *   analytics/duckdb personaforge-adapter-duckdb        (duckdb-async)
 *   analytics/ch     personaforge-adapter-clickhouse    (@clickhouse/client)
 *   search/elastic   personaforge-adapter-elasticsearch (@elastic/elasticsearch)
 *   search/typesense personaforge-adapter-typesense     (typesense)
 *   cache/redis      personaforge-adapter-redis         (ioredis / @upstash/redis)
 *   object/s3        personaforge-adapter-s3            (@aws-sdk/client-s3)
 *   object/gcs       personaforge-adapter-gcs           (@google-cloud/storage)
 *   ts/influxdb      personaforge-adapter-influxdb      (@influxdata/influxdb-client)
 *   graph/neo4j      personaforge-adapter-neo4j         (neo4j-driver)
 *   queue/bullmq     personaforge-adapter-bullmq        (bullmq)
 *   queue/kafka      personaforge-adapter-kafka         (kafkajs)
 *   obs/otel         personaforge-adapter-otel          (@opentelemetry/sdk-node)
 *   embed/openai     personaforge-adapter-openai-embed  (openai)
 */

import type {
    SqlAdapter,
    SqlTransaction,
    SqlRow,
    NoSqlAdapter,
    VectorAdapter,
    VectorRecord,
    VectorMatch,
    AnalyticsAdapter,
    AnalyticsImportSource,
    SearchAdapter,
    SearchDocument,
    SearchHit,
    SearchQueryOptions,
    CacheAdapter,
    ObjectStorageAdapter,
    ObjectUploadOptions,
    ObjectInfo,
    TimeSeriesAdapter,
    TimeSeriesPoint,
    GraphAdapter,
    GraphNode,
    GraphQueryResult,
    MessageQueueAdapter,
    QueueMessage,
    QueuePublishOptions,
    QueueConsumeOptions,
    ObservabilityAdapter,
    ObservabilityLogEntry,
    TraceSpan,
    MetricPoint,
    EmbeddingAdapter,
    AdapterHealth,
    // Framework-level adapters
    SessionStoreAdapter,
    StoredSession,
    SessionMessage,
    MemoryStoreAdapter,
    MemoryEntry,
    MemorySearchResult,
    GuardrailAdapter,
    GuardrailAdapterContext,
    GuardrailCheckResult,
    RagAdapter,
    RetrievedDocument,
    RagRetrieveOptions,
    ToolRegistryAdapter,
    RemoteToolDescriptor,
    AuthAdapter,
    AuthIdentity,
    AuthResult,
    RateLimitAdapter,
    RateLimitOptions,
    RateLimitResult,
    AuditLogAdapter,
    AuditEvent,
    AuditQuery,
} from './types.js';

// ── DS helpers ────────────────────────────────────────────────────────────

/**
 * Return the top-K highest-scoring items without full sort — O(n·k) where k is
 * typically 5-20, vs O(n log n) for a full sort. For large n and small k this
 * is substantially faster and allocates no intermediate arrays.
 */
function topKByScore<T>(items: T[], getScore: (item: T) => number, k: number): T[] {
    if (k <= 0) return [];
    if (items.length <= k) {
        return [...items].sort((a, b) => getScore(b) - getScore(a));
    }
    // Maintain a min-heap of size k using a simple sorted array insert (O(k) per item)
    const heap: T[] = [];
    for (const item of items) {
        const score = getScore(item);
        if (heap.length < k) {
            heap.push(item);
            if (heap.length === k) heap.sort((a, b) => getScore(a) - getScore(b)); // ascending min-heap
        } else if (score > getScore(heap[0]!)) {
            heap[0] = item;
            // Bubble up to maintain ascending order
            let i = 0;
            while (i * 2 + 1 < heap.length) {
                const left = i * 2 + 1;
                const right = i * 2 + 2;
                let smallest = i;
                if (left < heap.length && getScore(heap[left]!) < getScore(heap[smallest]!)) smallest = left;
                if (right < heap.length && getScore(heap[right]!) < getScore(heap[smallest]!)) smallest = right;
                if (smallest === i) break;
                [heap[i], heap[smallest]] = [heap[smallest]!, heap[i]!];
                i = smallest;
            }
        }
    }
    return heap.sort((a, b) => getScore(b) - getScore(a));
}

// ── Base adapter ──────────────────────────────────────────────────────────

abstract class BaseAdapter {
    protected _connected = false;

    isConnected(): boolean {
        return this._connected;
    }

    async connect(): Promise<void> {
        this._connected = true;
    }

    async disconnect(): Promise<void> {
        this._connected = false;
    }

    async healthCheck(): Promise<AdapterHealth> {
        return { ok: this._connected };
    }
}

// ── In-Memory SQL ──────────────────────────────────────────────────────────

/**
 * In-memory SQL adapter.
 * Stores rows in plain Maps. Supports basic SELECT / INSERT / UPDATE / DELETE
 * without an external dependency.  Use for testing and prototyping.
 *
 * For real SQL, swap with personaforge-adapter-postgres / -mysql / -sqlite.
 */
export class InMemorySqlAdapter extends BaseAdapter implements SqlAdapter {
    readonly name = 'memory';
    readonly category = 'sql' as const;
    readonly version = '1.2.0';
    readonly description = 'In-memory SQL adapter for development and testing';

    // table → rows (Map so insertion order is preserved)
    private tables = new Map<string, Map<string, SqlRow>>();
    private idSeq = 0;

    private getOrCreateTable(name: string): Map<string, SqlRow> {
        if (!this.tables.has(name)) this.tables.set(name, new Map());
        return this.tables.get(name)!;
    }

    async query<T extends SqlRow = SqlRow>(sql: string, _params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
        // Very minimal parser — real drivers handle this properly
        const normalized = sql.trim().toUpperCase();

        if (normalized.startsWith('SELECT')) {
            const tableMatch = /FROM\s+(\w+)/i.exec(sql);
            if (!tableMatch) return { rows: [], rowCount: 0 };
            const table = this.getOrCreateTable(tableMatch[1]);
            const rows = [...table.values()] as T[];
            return { rows, rowCount: rows.length };
        }

        return { rows: [], rowCount: 0 };
    }

    async execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }> {
        const normalized = sql.trim().toUpperCase();

        if (normalized.startsWith('INSERT')) {
            const tableMatch = /INTO\s+(\w+)/i.exec(sql);
            if (!tableMatch) return { rowsAffected: 0 };
            const table = this.getOrCreateTable(tableMatch[1]);
            const id = String(++this.idSeq);
            table.set(id, { id, _params: params ?? [] });
            return { rowsAffected: 1 };
        }

        if (normalized.startsWith('DELETE')) {
            const tableMatch = /FROM\s+(\w+)/i.exec(sql);
            if (!tableMatch) return { rowsAffected: 0 };
            const table = this.getOrCreateTable(tableMatch[1]);
            const prev = table.size;
            table.clear();
            return { rowsAffected: prev };
        }

        return { rowsAffected: 0 };
    }

    async transaction<T>(fn: (tx: SqlTransaction) => Promise<T>): Promise<T> {
        let committed = false;

        const tx: SqlTransaction = {
            query: (sql, params) => this.query(sql, params),
            execute: (sql, params) => this.execute(sql, params),
            commit: async () => { committed = true; },
            rollback: async () => { /* in-memory: just discard */ },
        };

        try {
            const result = await fn(tx);
            if (!committed) await tx.commit();
            return result;
        } catch (err) {
            await tx.rollback();
            throw err;
        }
    }
}

// ── In-Memory NoSQL ────────────────────────────────────────────────────────

/**
 * In-memory NoSQL / document adapter.
 * Each collection is a Map of id → document.
 *
 * For production, swap with personaforge-adapter-mongodb or -dynamodb.
 */
export class InMemoryNoSqlAdapter extends BaseAdapter implements NoSqlAdapter {
    readonly name = 'memory';
    readonly category = 'nosql' as const;
    readonly version = '1.2.0';
    readonly description = 'In-memory NoSQL document adapter';

    private collections = new Map<string, Map<string, unknown>>();
    private idSeq = 0;

    private col(name: string): Map<string, unknown> {
        if (!this.collections.has(name)) this.collections.set(name, new Map());
        return this.collections.get(name)!;
    }

    private matches(doc: unknown, filter: Record<string, unknown>): boolean {
        if (!doc || typeof doc !== 'object') return false;
        return Object.entries(filter).every(([k, v]) => (doc as Record<string, unknown>)[k] === v);
    }

    async find<T = unknown>(collection: string, filter: Record<string, unknown>): Promise<T[]> {
        return [...this.col(collection).values()].filter((d) => this.matches(d, filter)) as T[];
    }

    async findOne<T = unknown>(collection: string, filter: Record<string, unknown>): Promise<T | undefined> {
        for (const doc of this.col(collection).values()) {
            if (this.matches(doc, filter)) return doc as T;
        }
        return undefined;
    }

    async insert<T = unknown>(collection: string, doc: T): Promise<string> {
        const id = String(++this.idSeq);
        this.col(collection).set(id, { ...(doc as object), _id: id });
        return id;
    }

    async insertMany<T = unknown>(collection: string, docs: T[]): Promise<string[]> {
        return Promise.all(docs.map((d) => this.insert(collection, d)));
    }

    async update(collection: string, filter: Record<string, unknown>, update: Record<string, unknown>, upsert = false): Promise<number> {
        let count = 0;
        for (const [id, doc] of this.col(collection)) {
            if (this.matches(doc, filter)) {
                this.col(collection).set(id, { ...(doc as object), ...update });
                count++;
            }
        }
        if (count === 0 && upsert) {
            await this.insert(collection, { ...filter, ...update });
            count = 1;
        }
        return count;
    }

    async delete(collection: string, filter: Record<string, unknown>): Promise<number> {
        let count = 0;
        for (const [id, doc] of this.col(collection)) {
            if (this.matches(doc, filter)) {
                this.col(collection).delete(id);
                count++;
            }
        }
        return count;
    }

    async aggregate<T = unknown>(_collection: string, _pipeline: unknown[]): Promise<T[]> {
        // Stubs aggregate — real adapters implement this fully
        return [];
    }
}

// ── In-Memory Vector ───────────────────────────────────────────────────────

/** Cosine similarity between two unit-or-non-unit vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot   += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

/**
 * In-memory vector adapter — pure-JS brute-force cosine search.
 * Suitable for < 10k vectors.  Replace with Qdrant / Pinecone for production.
 */
export class InMemoryVectorAdapter extends BaseAdapter implements VectorAdapter {
    readonly name = 'memory';
    readonly category = 'vector' as const;
    readonly version = '1.2.0';
    readonly description = 'In-memory vector adapter with cosine similarity';

    private collections = new Map<string, Map<string, VectorRecord>>();

    private col(name: string): Map<string, VectorRecord> {
        if (!this.collections.has(name)) this.collections.set(name, new Map());
        return this.collections.get(name)!;
    }

    async createCollection(collection: string): Promise<void> {
        this.col(collection); // ensure exists
    }

    async deleteCollection(collection: string): Promise<void> {
        this.collections.delete(collection);
    }

    async upsert(collection: string, records: VectorRecord[]): Promise<void> {
        const col = this.col(collection);
        for (const r of records) col.set(r.id, r);
    }

    async query(collection: string, vector: number[], topK: number, filter?: Record<string, unknown>): Promise<VectorMatch[]> {
        const col = this.col(collection);
        const scored: VectorMatch[] = [];

        for (const record of col.values()) {
            if (filter) {
                const payload = record.payload ?? {};
                const pass = Object.entries(filter).every(([k, v]) => payload[k] === v);
                if (!pass) continue;
            }
            scored.push({ id: record.id, score: cosineSimilarity(vector, record.vector), payload: record.payload });
        }

        return topKByScore(scored, m => m.score, topK);
    }

    async delete(collection: string, ids: string[]): Promise<void> {
        const col = this.col(collection);
        for (const id of ids) col.delete(id);
    }

    async fetch(collection: string, ids: string[]): Promise<VectorRecord[]> {
        const col = this.col(collection);
        return ids.flatMap((id) => (col.has(id) ? [col.get(id)!] : []));
    }

    async count(collection: string): Promise<number> {
        return this.col(collection).size;
    }
}

// ── In-Memory Analytics ────────────────────────────────────────────────────

/**
 * In-memory analytics adapter — stores imported data in Maps, executes a
 * very small SQL-like DSL.  For real analytics use personaforge-adapter-duckdb.
 */
export class InMemoryAnalyticsAdapter extends BaseAdapter implements AnalyticsAdapter {
    readonly name = 'memory';
    readonly category = 'analytics' as const;
    readonly version = '1.2.0';
    readonly description = 'In-memory analytics adapter (stub) — swap with DuckDB for production';

    private tables = new Map<string, Record<string, unknown>[]>();

    async query<T = SqlRow>(sql: string): Promise<T[]> {
        const tableMatch = /FROM\s+(\w+)/i.exec(sql);
        if (!tableMatch) return [];
        return (this.tables.get(tableMatch[1]) ?? []) as T[];
    }

    async execute(_sql: string): Promise<{ rowsAffected: number }> {
        return { rowsAffected: 0 };
    }

    async import(source: AnalyticsImportSource): Promise<{ rowsImported: number }> {
        // In-memory stub: parse JSON arrays only
        if (source.format === 'json' && typeof source.source === 'string') {
            try {
                const data = JSON.parse(source.source) as Record<string, unknown>[];
                this.tables.set(source.table, data);
                return { rowsImported: data.length };
            } catch { /* ignore */ }
        }
        return { rowsImported: 0 };
    }

    async export(query: string, _format: string): Promise<Buffer> {
        const rows = await this.query(query);
        return Buffer.from(JSON.stringify(rows), 'utf8');
    }
}

// ── In-Memory Search ───────────────────────────────────────────────────────

/**
 * In-memory full-text search adapter — simple substring matching.
 * For production use personaforge-adapter-elasticsearch or -typesense.
 */
export class InMemorySearchAdapter extends BaseAdapter implements SearchAdapter {
    readonly name = 'memory';
    readonly category = 'search' as const;
    readonly version = '1.2.0';
    readonly description = 'In-memory full-text search adapter (substring matching)';

    private indices = new Map<string, Map<string, SearchDocument>>();

    private idx(name: string): Map<string, SearchDocument> {
        if (!this.indices.has(name)) this.indices.set(name, new Map());
        return this.indices.get(name)!;
    }

    async createIndex(index: string): Promise<void> { this.idx(index); }
    async deleteIndex(index: string): Promise<void> { this.indices.delete(index); }

    async index(index: string, docs: SearchDocument[]): Promise<void> {
        const idx = this.idx(index);
        for (const doc of docs) idx.set(doc.id, doc);
    }

    async search(index: string, query: string, options?: SearchQueryOptions): Promise<{ hits: SearchHit[]; total: number }> {
        const idx = this.idx(index);
        const q = query.toLowerCase();
        const hits: SearchHit[] = [];

        for (const doc of idx.values()) {
            const text = Object.values(doc).join(' ').toLowerCase();
            if (text.includes(q)) {
                hits.push({ id: doc.id, score: 1, document: doc as Record<string, unknown> });
            }
        }

        const limit = options?.limit ?? 10;
        const offset = options?.offset ?? 0;
        const paged = hits.slice(offset, offset + limit);
        return { hits: paged, total: hits.length };
    }

    async delete(index: string, ids: string[]): Promise<void> {
        const idx = this.idx(index);
        for (const id of ids) idx.delete(id);
    }
}

// ── In-Memory Cache ────────────────────────────────────────────────────────

/**
 * In-memory cache adapter with optional TTL.
 * For production use personaforge-adapter-redis or personaforge-adapter-upstash.
 */
export class InMemoryCacheAdapter extends BaseAdapter implements CacheAdapter {
    readonly name = 'memory';
    readonly category = 'cache' as const;
    readonly version = '1.2.0';
    readonly description = 'In-memory cache adapter with TTL support';

    private store = new Map<string, { value: unknown; expiresAt?: number }>();
    private counters = new Map<string, number>();
    private subs = new Map<string, Set<(msg: unknown) => void>>();

    private isExpired(entry: { value: unknown; expiresAt?: number }): boolean {
        return entry.expiresAt !== undefined && Date.now() > entry.expiresAt;
    }

    async get<T>(key: string): Promise<T | undefined> {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        if (this.isExpired(entry)) { this.store.delete(key); return undefined; }
        return entry.value as T;
    }

    async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
        this.store.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : undefined });
    }

    async delete(key: string): Promise<void> { this.store.delete(key); }

    async has(key: string): Promise<boolean> { return (await this.get(key)) !== undefined; }

    async keys(pattern?: string): Promise<string[]> {
        const now = Date.now();
        const result: string[] = [];
        for (const [k, entry] of this.store) {
            if (entry.expiresAt && now > entry.expiresAt) continue;
            if (!pattern || k.includes(pattern.replace(/\*/g, ''))) result.push(k);
        }
        return result;
    }

    async mget<T>(keys: string[]): Promise<(T | undefined)[]> {
        return Promise.all(keys.map((k) => this.get<T>(k)));
    }

    async mset(entries: Array<{ key: string; value: unknown; ttlMs?: number }>): Promise<void> {
        for (const e of entries) await this.set(e.key, e.value, e.ttlMs);
    }

    async mdelete(keys: string[]): Promise<void> {
        for (const k of keys) this.store.delete(k);
    }

    async flush(): Promise<void> { this.store.clear(); }

    async incr(key: string, by = 1): Promise<number> {
        const val = (this.counters.get(key) ?? 0) + by;
        this.counters.set(key, val);
        return val;
    }

    async publish(channel: string, message: unknown): Promise<void> {
        this.subs.get(channel)?.forEach((fn) => fn(message));
    }

    async subscribe(channel: string, handler: (message: unknown) => void): Promise<() => void> {
        if (!this.subs.has(channel)) this.subs.set(channel, new Set());
        this.subs.get(channel)!.add(handler);
        return () => this.subs.get(channel)?.delete(handler);
    }
}

// ── In-Memory Object Storage ───────────────────────────────────────────────

/**
 * In-memory object / blob storage.
 * For production use personaforge-adapter-s3 or personaforge-adapter-gcs.
 */
export class InMemoryObjectStorageAdapter extends BaseAdapter implements ObjectStorageAdapter {
    readonly name = 'memory';
    readonly category = 'object-storage' as const;
    readonly version = '1.2.0';
    readonly description = 'In-memory object storage adapter';

    private buckets = new Map<string, Map<string, { data: Buffer; info: ObjectInfo }>>();

    private bucket(name: string): Map<string, { data: Buffer; info: ObjectInfo }> {
        if (!this.buckets.has(name)) this.buckets.set(name, new Map());
        return this.buckets.get(name)!;
    }

    async createBucket(bucket: string): Promise<void> { this.bucket(bucket); }

    async upload(bucket: string, key: string, data: Buffer | string, options?: ObjectUploadOptions): Promise<{ url: string }> {
        const buf = typeof data === 'string' ? Buffer.from(data) : data as Buffer;
        const info: ObjectInfo = {
            key,
            size: buf.length,
            lastModified: new Date(),
            contentType: options?.contentType,
            metadata: options?.metadata,
        };
        this.bucket(bucket).set(key, { data: buf, info });
        return { url: `memory://${bucket}/${key}` };
    }

    async download(bucket: string, key: string): Promise<Buffer> {
        const entry = this.bucket(bucket).get(key);
        if (!entry) throw new Error(`Object not found: ${bucket}/${key}`);
        return entry.data;
    }

    async delete(bucket: string, key: string): Promise<void> {
        this.bucket(bucket).delete(key);
    }

    async deleteMany(bucket: string, keys: string[]): Promise<void> {
        for (const k of keys) this.bucket(bucket).delete(k);
    }

    async list(bucket: string, prefix?: string): Promise<ObjectInfo[]> {
        return [...this.bucket(bucket).values()]
            .filter((e) => !prefix || e.info.key.startsWith(prefix))
            .map((e) => e.info);
    }

    async info(bucket: string, key: string): Promise<ObjectInfo | undefined> {
        return this.bucket(bucket).get(key)?.info;
    }
}

// ── In-Memory Time Series ──────────────────────────────────────────────────

/**
 * In-memory time-series adapter.
 * For production use personaforge-adapter-influxdb or -timescaledb.
 */
export class InMemoryTimeSeriesAdapter extends BaseAdapter implements TimeSeriesAdapter {
    readonly name = 'memory';
    readonly category = 'time-series' as const;
    readonly version = '1.2.0';
    readonly description = 'In-memory time-series adapter';

    private points: TimeSeriesPoint[] = [];

    async write(points: TimeSeriesPoint[]): Promise<void> {
        this.points.push(...points);
    }

    async query<T = unknown>(_fluxOrSql: string): Promise<T[]> {
        // Stub — return all points
        return this.points as T[];
    }

    async queryRange<T = unknown>(measurement: string, start: Date, end: Date): Promise<T[]> {
        return this.points.filter((p) => {
            const ts = p.timestamp ?? new Date();
            return p.measurement === measurement && ts >= start && ts <= end;
        }) as T[];
    }

    async delete(measurement: string): Promise<void> {
        this.points = this.points.filter((p) => p.measurement !== measurement);
    }
}

// ── In-Memory Graph ────────────────────────────────────────────────────────

/**
 * In-memory graph adapter.
 * For production use personaforge-adapter-neo4j or -arangodb.
 */
export class InMemoryGraphAdapter extends BaseAdapter implements GraphAdapter {
    readonly name = 'memory';
    readonly category = 'graph' as const;
    readonly version = '1.2.0';
    readonly description = 'In-memory graph adapter';

    private nodes = new Map<string, GraphNode>();
    private relationships: Array<{ id: string; type: string; from: string; to: string; properties: Record<string, unknown> }> = [];
    private idSeq = 0;

    async query<T = unknown>(cypher: string): Promise<GraphQueryResult<T>> {
        // Stub — MATCH (n) RETURN n returns all nodes
        if (/MATCH\s*\(n\)/i.test(cypher)) {
            return { records: [...this.nodes.values()] as T[] };
        }
        return { records: [] };
    }

    async createNode(labels: string[], properties: Record<string, unknown>): Promise<string> {
        const id = String(++this.idSeq);
        this.nodes.set(id, { id, labels, properties });
        return id;
    }

    async updateNode(id: string, properties: Record<string, unknown>): Promise<void> {
        const node = this.nodes.get(id);
        if (node) this.nodes.set(id, { ...node, properties: { ...node.properties, ...properties } });
    }

    async deleteNode(id: string): Promise<void> {
        this.nodes.delete(id);
    }

    async createRelationship(fromId: string, toId: string, type: string, properties?: Record<string, unknown>): Promise<string> {
        const id = String(++this.idSeq);
        this.relationships.push({ id, type, from: fromId, to: toId, properties: properties ?? {} });
        return id;
    }

    async deleteRelationship(id: string): Promise<void> {
        this.relationships = this.relationships.filter((r) => r.id !== id);
    }

    async findNode(labels: string[], filter: Record<string, unknown>): Promise<GraphNode[]> {
        return [...this.nodes.values()].filter((n) => {
            const hasLabel = labels.every((l) => n.labels.includes(l));
            const matchesFilter = Object.entries(filter).every(([k, v]) => n.properties[k] === v);
            return hasLabel && matchesFilter;
        });
    }
}

// ── In-Memory Message Queue ────────────────────────────────────────────────

/**
 * In-memory message queue with basic pub/sub.
 * For production use personaforge-adapter-bullmq (Redis) or -kafka.
 */
export class InMemoryMessageQueueAdapter extends BaseAdapter implements MessageQueueAdapter {
    readonly name = 'memory';
    readonly category = 'message-queue' as const;
    readonly version = '1.2.0';
    readonly description = 'In-memory message queue adapter';

    private queues = new Map<string, QueueMessage[]>();
    private handlers = new Map<string, Array<(msg: QueueMessage) => Promise<void>>>();
    private idSeq = 0;

    async publish<T = unknown>(queue: string, message: T, _options?: QueuePublishOptions): Promise<string> {
        const id = String(++this.idSeq);
        const msg: QueueMessage<T> = { id, queue, payload: message, receivedAt: new Date(), retryCount: 0 };
        if (!this.queues.has(queue)) this.queues.set(queue, []);
        this.queues.get(queue)!.push(msg as QueueMessage);

        // Fire any registered consumers
        const handlers = this.handlers.get(queue);
        if (handlers?.length) {
            for (const h of handlers) {
                h(msg as QueueMessage).catch(() => {});
            }
        }
        return id;
    }

    async publishBatch<T = unknown>(queue: string, messages: T[]): Promise<string[]> {
        return Promise.all(messages.map((m) => this.publish(queue, m)));
    }

    async consume<T = unknown>(queue: string, handler: (msg: QueueMessage<T>) => Promise<void>, _options?: QueueConsumeOptions): Promise<() => Promise<void>> {
        if (!this.handlers.has(queue)) this.handlers.set(queue, []);
        const h = handler as (msg: QueueMessage) => Promise<void>;
        this.handlers.get(queue)!.push(h);
        // Return unsubscribe
        return async () => {
            const arr = this.handlers.get(queue);
            if (arr) this.handlers.set(queue, arr.filter((fn) => fn !== h));
        };
    }

    async ack(_messageId: string): Promise<void> { /* in-memory: noop */ }
    async nack(_messageId: string, _requeue = true): Promise<void> { /* in-memory: noop */ }

    async purge(queue: string): Promise<number> {
        const msgs = this.queues.get(queue) ?? [];
        this.queues.set(queue, []);
        return msgs.length;
    }

    async createQueue(queue: string): Promise<void> {
        if (!this.queues.has(queue)) this.queues.set(queue, []);
    }

    async deleteQueue(queue: string): Promise<void> {
        this.queues.delete(queue);
        this.handlers.delete(queue);
    }
}

// ── Console Observability ─────────────────────────────────────────────────

/**
 * Console-based observability adapter (logs to stdout, traces to stdout).
 * For production use personaforge-adapter-otel or personaforge-adapter-datadog.
 */
export class ConsoleObservabilityAdapter extends BaseAdapter implements ObservabilityAdapter {
    readonly name = 'console';
    readonly category = 'observability' as const;
    readonly version = '1.2.0';
    readonly description = 'Console observability adapter (stdout logging)';

    async log(entry: ObservabilityLogEntry): Promise<void> {
        const prefix = `[${entry.level.toUpperCase()}] ${entry.timestamp.toISOString()}`;
        const fields = entry.fields ? ` ${JSON.stringify(entry.fields)}` : '';
        console.log(`${prefix} ${entry.message}${fields}`);
    }

    async logBatch(entries: ObservabilityLogEntry[]): Promise<void> {
        for (const e of entries) await this.log(e);
    }

    async trace(span: TraceSpan): Promise<void> {
        const dur = span.endTime ? span.endTime.getTime() - span.startTime.getTime() : '?';
        console.log(`[TRACE] ${span.name} traceId=${span.traceId} spanId=${span.spanId} dur=${dur}ms status=${span.status ?? 'ok'}`);
    }

    async metric(point: MetricPoint): Promise<void> {
        const tags = point.tags ? ` ${JSON.stringify(point.tags)}` : '';
        console.log(`[METRIC] ${point.name}=${point.value} type=${point.type}${tags}`);
    }

    async metricBatch(points: MetricPoint[]): Promise<void> {
        for (const p of points) await this.metric(p);
    }
}

// ── Null Observability ─────────────────────────────────────────────────────

/**
 * No-op observability adapter — discards all telemetry.
 * Use in unit tests to avoid stdout noise.
 */
export class NullObservabilityAdapter extends BaseAdapter implements ObservabilityAdapter {
    readonly name = 'null';
    readonly category = 'observability' as const;
    readonly version = '1.2.0';
    readonly description = 'No-op observability adapter';

    async log(): Promise<void> {}
    async trace(): Promise<void> {}
    async metric(): Promise<void> {}
}

// ── In-Memory Embedding ────────────────────────────────────────────────────

/**
 * Deterministic in-memory embedding adapter — generates pseudo-embeddings
 * from character codes.  Useful for testing. NOT suitable for semantic search.
 * For production use personaforge-adapter-openai-embed or personaforge-adapter-cohere.
 */
export class InMemoryEmbeddingAdapter extends BaseAdapter implements EmbeddingAdapter {
    readonly name = 'memory';
    readonly category = 'embedding' as const;
    readonly version = '1.2.0';
    readonly description = 'Deterministic in-memory embedding adapter (for testing)';
    readonly dimensions: number;

    constructor(dimensions = 384) {
        super();
        this.dimensions = dimensions;
    }

    async embed(text: string): Promise<number[]> {
        // Stable hash → unit vector (deterministic but not semantic)
        const vec = new Array<number>(this.dimensions).fill(0);
        for (let i = 0; i < text.length; i++) {
            vec[i % this.dimensions] += text.charCodeAt(i) / 1000;
        }
        // Normalise to unit length
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map((v) => v / norm);
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        return Promise.all(texts.map((t) => this.embed(t)));
    }
}

// ── In-Memory Session Store ────────────────────────────────────────────────

/**
 * In-memory session store adapter.
 * Stores sessions in a Map — lost on restart.
 * For production use personaforge-adapter-redis-sessions or personaforge-adapter-pg-sessions.
 */
export class InMemorySessionStoreAdapter extends BaseAdapter implements SessionStoreAdapter {
    readonly name = 'memory';
    readonly category = 'session-store' as const;
    readonly version = '1.2.0';
    readonly description = 'In-memory session store (for dev / testing)';

    private sessions = new Map<string, StoredSession>();
    private _counter = 0;

    private _id(): string {
        return `sess_${Date.now()}_${++this._counter}`;
    }

    async create(session: Omit<StoredSession, 'id' | 'createdAt' | 'updatedAt'>): Promise<StoredSession> {
        const now = new Date();
        const stored: StoredSession = { ...session, id: this._id(), createdAt: now, updatedAt: now };
        this.sessions.set(stored.id, stored);
        return stored;
    }

    async get(sessionId: string): Promise<StoredSession | null> {
        return this.sessions.get(sessionId) ?? null;
    }

    async update(sessionId: string, updates: Partial<Omit<StoredSession, 'id' | 'createdAt'>>): Promise<StoredSession> {
        const existing = this.sessions.get(sessionId);
        if (!existing) throw new Error(`Session not found: ${sessionId}`);
        const updated = { ...existing, ...updates, updatedAt: new Date() };
        this.sessions.set(sessionId, updated);
        return updated;
    }

    async delete(sessionId: string): Promise<boolean> {
        return this.sessions.delete(sessionId);
    }

    async list(filter?: { agentId?: string; userId?: string; state?: StoredSession['state']; limit?: number }): Promise<StoredSession[]> {
        let results = Array.from(this.sessions.values());
        if (filter?.agentId) results = results.filter((s) => s.agentId === filter.agentId);
        if (filter?.userId) results = results.filter((s) => s.userId === filter.userId);
        if (filter?.state) results = results.filter((s) => s.state === filter.state);
        if (filter?.limit) results = results.slice(0, filter.limit);
        return results;
    }

    async addMessage(sessionId: string, message: Omit<SessionMessage, 'id' | 'createdAt'>): Promise<StoredSession> {
        const session = await this.get(sessionId);
        if (!session) throw new Error(`Session not found: ${sessionId}`);
        const msg: SessionMessage = { ...message, id: `msg_${crypto.randomUUID()}`, createdAt: new Date() };
        return this.update(sessionId, { messages: [...session.messages, msg] });
    }

    async getMessages(sessionId: string, limit?: number): Promise<SessionMessage[]> {
        const session = await this.get(sessionId);
        if (!session) return [];
        const msgs = session.messages;
        return limit ? msgs.slice(-limit) : msgs;
    }

    async touch(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (session) this.sessions.set(sessionId, { ...session, updatedAt: new Date() });
    }

    async purgeExpired(): Promise<number> {
        const now = new Date();
        let count = 0;
        for (const [id, session] of this.sessions) {
            if (session.expiresAt && session.expiresAt < now) {
                this.sessions.delete(id);
                count++;
            }
        }
        return count;
    }
}

// ── In-Memory Memory Store ─────────────────────────────────────────────────

/**
 * In-memory memory store adapter.
 * Semantic search uses cosine similarity on stored embeddings (if present),
 * otherwise falls back to keyword matching.
 * For production use personaforge-adapter-pinecone, personaforge-adapter-qdrant, etc.
 */
export class InMemoryMemoryStoreAdapter extends BaseAdapter implements MemoryStoreAdapter {
    readonly name = 'memory';
    readonly category = 'memory-store' as const;
    readonly version = '1.2.0';
    readonly description = 'In-memory memory store (for dev / testing)';

    private entries = new Map<string, MemoryEntry>();
    private _counter = 0;

    private _id(): string {
        return `mem_${Date.now()}_${++this._counter}`;
    }

    async store(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry> {
        const stored: MemoryEntry = { ...entry, id: this._id(), createdAt: new Date() };
        this.entries.set(stored.id, stored);
        return stored;
    }

    async retrieve(query: string, options?: {
        agentId?: string;
        userId?: string;
        type?: string;
        limit?: number;
        threshold?: number;
        embedding?: number[];
    }): Promise<MemorySearchResult[]> {
        let candidates = Array.from(this.entries.values());
        if (options?.agentId) candidates = candidates.filter((e) => e.agentId === options.agentId);
        if (options?.userId) candidates = candidates.filter((e) => e.userId === options.userId);
        if (options?.type) candidates = candidates.filter((e) => e.type === options.type);

        const queryLower = query.toLowerCase();
        // Hoist the query tokenisation out of the per-entry loop (was O(n) splits → O(1)).
        const words = queryLower.split(/\s+/);
        const invWordCount = 1 / Math.max(words.length, 1);
        const results: MemorySearchResult[] = candidates.map((entry) => {
            // Prefer vector cosine similarity; fall back to keyword overlap
            if (options?.embedding && entry.embedding) {
                const score = this._cosine(options.embedding, entry.embedding);
                return { entry, score };
            }
            const contentLower = entry.content.toLowerCase();
            let hits = 0;
            for (const w of words) if (contentLower.includes(w)) hits++;
            return { entry, score: hits * invWordCount };
        });

        const threshold = options?.threshold ?? 0;
        const filtered = results.filter((r) => r.score >= threshold);
        return topKByScore(filtered, r => r.score, options?.limit ?? 10);
    }

    private _cosine(a: number[], b: number[]): number {
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
        return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
    }

    async get(id: string): Promise<MemoryEntry | null> {
        return this.entries.get(id) ?? null;
    }

    async update(id: string, updates: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>): Promise<MemoryEntry> {
        const entry = this.entries.get(id);
        if (!entry) throw new Error(`Memory entry not found: ${id}`);
        const updated = { ...entry, ...updates };
        this.entries.set(id, updated);
        return updated;
    }

    async delete(id: string): Promise<boolean> {
        return this.entries.delete(id);
    }

    async clear(type?: string): Promise<void> {
        if (type) {
            for (const [id, entry] of this.entries) {
                if (entry.type === type) this.entries.delete(id);
            }
        } else {
            this.entries.clear();
        }
    }

    async count(filter?: { agentId?: string; type?: string }): Promise<number> {
        let entries = Array.from(this.entries.values());
        if (filter?.agentId) entries = entries.filter((e) => e.agentId === filter.agentId);
        if (filter?.type) entries = entries.filter((e) => e.type === filter.type);
        return entries.length;
    }
}

// ── Pass-Through Guardrail Adapter ─────────────────────────────────────────

/**
 * No-op guardrail adapter — every check passes.
 * Useful for development. Replace with personaforge-adapter-azure-content-safety or
 * a custom implementation that calls your moderation API.
 */
export class PassThroughGuardrailAdapter extends BaseAdapter implements GuardrailAdapter {
    readonly name = 'passthrough';
    readonly category = 'guardrail' as const;
    readonly version = '1.2.0';
    readonly description = 'No-op guardrail adapter — all checks pass (dev only)';

    private rules: Array<{ name: string; check(ctx: GuardrailAdapterContext): Promise<GuardrailCheckResult> }> = [];

    async check(context: GuardrailAdapterContext): Promise<GuardrailCheckResult[]> {
        const builtIn: GuardrailCheckResult = { passed: true, rule: 'passthrough', severity: 'info' };
        const custom = await Promise.all(this.rules.map((r) => r.check(context)));
        return [builtIn, ...custom];
    }

    async passes(context: GuardrailAdapterContext): Promise<boolean> {
        const results = await this.check(context);
        return results.every((r) => r.passed || r.severity !== 'error');
    }

    addRule(rule: { name: string; check(ctx: GuardrailAdapterContext): Promise<GuardrailCheckResult> }): void {
        this.rules.push(rule);
    }
}

// ── In-Memory RAG Adapter ──────────────────────────────────────────────────

/**
 * In-memory RAG adapter.
 * Splits documents by sentence, indexes in a plain Map, and retrieves
 * by keyword overlap (TF-IDF-ish scoring). For production use
 * personaforge-adapter-pinecone, personaforge-adapter-qdrant, or personaforge-adapter-pgvector.
 */
export class InMemoryRagAdapter extends BaseAdapter implements RagAdapter {
    readonly name = 'memory';
    readonly category = 'rag' as const;
    readonly version = '1.2.0';
    readonly description = 'In-memory RAG adapter with keyword retrieval (for dev / testing)';

    private docs = new Map<string, { content: string; source?: string; metadata?: Record<string, unknown> }>();
    private _counter = 0;

    private _id(): string { return `doc_${Date.now()}_${++this._counter}`; }

    private _score(query: string, content: string): number {
        const qwords = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
        const cwords = content.toLowerCase().split(/\W+/).filter(Boolean);
        let hits = 0;
        for (const w of cwords) { if (qwords.has(w)) hits++; }
        return hits / (qwords.size || 1);
    }

    async retrieve(query: string, options?: RagRetrieveOptions): Promise<RetrievedDocument[]> {
        const topK = options?.topK ?? 5;
        const minScore = options?.minScore ?? 0;
        const results: RetrievedDocument[] = [];
        for (const [id, doc] of this.docs) {
            // Apply metadata filter
            if (options?.filter && doc.metadata) {
                const match = Object.entries(options.filter).every(([k, v]) => doc.metadata?.[k] === v);
                if (!match) continue;
            }
            const score = this._score(query, doc.content);
            if (score >= minScore) results.push({ id, content: doc.content, score, source: doc.source, metadata: doc.metadata });
        }
        return topKByScore(results, r => r.score, topK);
    }

    async ingest(document: { id?: string; content: string; source?: string; metadata?: Record<string, unknown> }): Promise<string> {
        const id = document.id ?? this._id();
        this.docs.set(id, { content: document.content, source: document.source, metadata: document.metadata });
        return id;
    }

    async ingestBatch(documents: Array<{ id?: string; content: string; source?: string; metadata?: Record<string, unknown> }>): Promise<string[]> {
        return Promise.all(documents.map((d) => this.ingest(d)));
    }

    async deleteDocument(id: string): Promise<boolean> {
        return this.docs.delete(id);
    }

    async buildContext(query: string, options?: RagRetrieveOptions): Promise<string> {
        const docs = await this.retrieve(query, options);
        if (docs.length === 0) return '';
        return docs
            .map((d, i) => `[${i + 1}] ${d.source ? `(${d.source}) ` : ''}${d.content}`)
            .join('\n\n');
    }

    async count(): Promise<number> {
        return this.docs.size;
    }
}

// ── In-Memory Tool Registry Adapter ───────────────────────────────────────

/**
 * In-memory tool registry adapter — store and look up tool descriptors locally.
 * For production use personaforge-adapter-mcp-registry or a remote HTTP registry.
 */
export class InMemoryToolRegistryAdapter extends BaseAdapter implements ToolRegistryAdapter {
    readonly name = 'memory';
    readonly category = 'tool-registry' as const;
    readonly version = '1.2.0';
    readonly description = 'In-memory tool registry (for dev / testing)';

    private tools = new Map<string, RemoteToolDescriptor>();

    async list(filter?: { tags?: string[] }): Promise<RemoteToolDescriptor[]> {
        const all = Array.from(this.tools.values());
        if (!filter?.tags?.length) return all;
        // Hash the requested tags once → O(t + n·avgTags) instead of O(n·t·avgTags).
        const wanted = new Set(filter.tags);
        return all.filter((t) => t.tags?.some((tag) => wanted.has(tag)) ?? false);
    }

    async find(name: string): Promise<RemoteToolDescriptor | null> {
        return this.tools.get(name) ?? null;
    }

    async call(_name: string, _args: Record<string, unknown>): Promise<unknown> {
        throw new Error('InMemoryToolRegistryAdapter does not support remote execution — use a real registry adapter.');
    }

    async register(descriptor: Omit<RemoteToolDescriptor, 'version'>): Promise<void> {
        this.tools.set(descriptor.name, { ...descriptor, version: '0.0.0' });
    }

    async unregister(name: string): Promise<void> {
        this.tools.delete(name);
    }
}

// ── No-Op Auth Adapter ─────────────────────────────────────────────────────

/**
 * No-op auth adapter — every token is valid; returns a generic service identity.
 * Replace with personaforge-adapter-jwt, personaforge-adapter-oauth2, etc.
 */
export class NoOpAuthAdapter extends BaseAdapter implements AuthAdapter {
    readonly name = 'noop';
    readonly category = 'auth' as const;
    readonly version = '1.2.0';
    readonly description = 'No-op auth adapter — all credentials accepted (dev only)';

    async validate(_credential: string, _context?: Record<string, unknown>): Promise<AuthResult> {
        const identity: AuthIdentity = {
            id: 'anonymous',
            type: 'user',
            roles: ['user'],
            scopes: ['*'],
        };
        return { valid: true, identity };
    }

    async issue(_identity: Omit<AuthIdentity, 'id'>): Promise<string> {
        return `noop-token-${Date.now()}`;
    }

    async revoke(_credential: string): Promise<void> {
        // noop
    }

    async can(_identity: AuthIdentity, _permission: string, _resource?: string): Promise<boolean> {
        return true;
    }
}

// ── In-Memory Rate Limit Adapter ───────────────────────────────────────────

interface RateLimitBucket {
    tokens: number;
    lastRefill: number;
}

/**
 * In-memory token-bucket rate limiter.
 * For production use personaforge-adapter-redis-rate-limit (Upstash, ioredis).
 */
export class InMemoryRateLimitAdapter extends BaseAdapter implements RateLimitAdapter {
    readonly name = 'memory';
    readonly category = 'rate-limit' as const;
    readonly version = '1.2.0';
    readonly description = 'In-memory token-bucket rate limiter (for dev / testing)';

    private buckets = new Map<string, RateLimitBucket>();

    constructor(
        private readonly limit = 100,
        private readonly windowSecs = 60,
    ) {
        super();
    }

    private _bucketKey(opts: RateLimitOptions): string {
        return `${opts.key}::${opts.rule ?? 'default'}`;
    }

    private _refill(bucket: RateLimitBucket): RateLimitBucket {
        const now = Date.now();
        const elapsed = (now - bucket.lastRefill) / 1000;
        const refillRate = this.limit / this.windowSecs;
        const refilled = Math.min(this.limit, bucket.tokens + elapsed * refillRate);
        return { tokens: refilled, lastRefill: now };
    }

    async check(options: RateLimitOptions): Promise<RateLimitResult> {
        const key = this._bucketKey(options);
        let bucket = this.buckets.get(key) ?? { tokens: this.limit, lastRefill: Date.now() };
        bucket = this._refill(bucket);
        const cost = options.cost ?? 1;
        const allowed = bucket.tokens >= cost;
        if (allowed) {
            bucket.tokens -= cost;
            this.buckets.set(key, bucket);
        }
        const resetInSeconds = Math.ceil((cost - bucket.tokens) / (this.limit / this.windowSecs));
        return {
            allowed,
            remaining: Math.floor(bucket.tokens),
            limit: this.limit,
            resetInSeconds: Math.max(0, resetInSeconds),
            retryAfterSeconds: allowed ? undefined : Math.max(1, resetInSeconds),
        };
    }

    async consume(options: RateLimitOptions): Promise<RateLimitResult> {
        const result = await this.check(options);
        if (!result.allowed) throw new Error(`Rate limit exceeded for key "${options.key}". Retry after ${result.retryAfterSeconds}s.`);
        return result;
    }

    async reset(key: string, rule?: string): Promise<void> {
        this.buckets.delete(`${key}::${rule ?? 'default'}`);
    }

    async peek(options: Omit<RateLimitOptions, 'cost'>): Promise<RateLimitResult> {
        const key = this._bucketKey({ ...options, cost: 0 });
        let bucket = this.buckets.get(key) ?? { tokens: this.limit, lastRefill: Date.now() };
        bucket = this._refill(bucket);
        return {
            allowed: bucket.tokens >= 1,
            remaining: Math.floor(bucket.tokens),
            limit: this.limit,
            resetInSeconds: 0,
        };
    }
}

// ── In-Memory Audit Log Adapter ────────────────────────────────────────────

/**
 * In-memory audit log adapter.
 * Events are stored in a ring-buffer (max 10 000 entries).
 * For production use personaforge-adapter-pg-audit, personaforge-adapter-cloudwatch-audit, etc.
 */
export class InMemoryAuditLogAdapter extends BaseAdapter implements AuditLogAdapter {
    readonly name = 'memory';
    readonly category = 'audit-log' as const;
    readonly version = '1.2.0';
    readonly description = 'In-memory audit log adapter (for dev / testing)';

    private static readonly MAX_EVENTS = 10_000;
    private events: AuditEvent[] = [];
    private _counter = 0;

    async log(event: Omit<AuditEvent, 'id'>): Promise<AuditEvent> {
        const stored: AuditEvent = { ...event, id: `evt_${Date.now()}_${++this._counter}` };
        this.events.push(stored);
        // Ring buffer
        if (this.events.length > InMemoryAuditLogAdapter.MAX_EVENTS) {
            this.events = this.events.slice(-InMemoryAuditLogAdapter.MAX_EVENTS);
        }
        return stored;
    }

    async query(filter?: AuditQuery): Promise<AuditEvent[]> {
        let results = this.events.slice();
        if (filter?.agentId) results = results.filter((e) => e.agentId === filter.agentId);
        if (filter?.sessionId) results = results.filter((e) => e.sessionId === filter.sessionId);
        if (filter?.userId) results = results.filter((e) => e.userId === filter.userId);
        if (filter?.action) results = results.filter((e) => e.action === filter.action);
        if (filter?.status) results = results.filter((e) => e.status === filter.status);
        if (filter?.since) results = results.filter((e) => e.timestamp >= filter.since!);
        if (filter?.until) results = results.filter((e) => e.timestamp <= filter.until!);
        if (filter?.offset) results = results.slice(filter.offset);
        if (filter?.limit) results = results.slice(0, filter.limit);
        return results;
    }

    async count(filter?: AuditQuery): Promise<number> {
        return (await this.query(filter)).length;
    }

    async export(filter?: AuditQuery, format: 'json' | 'csv' = 'json'): Promise<string> {
        const events = await this.query(filter);
        if (format === 'csv') {
            const header = 'id,agentId,sessionId,userId,action,resource,status,durationMs,timestamp';
            const rows = events.map((e) =>
                [e.id, e.agentId, e.sessionId ?? '', e.userId ?? '', e.action, e.resource ?? '', e.status, e.durationMs ?? '', e.timestamp.toISOString()].join(',')
            );
            return [header, ...rows].join('\n');
        }
        return JSON.stringify(events, null, 2);
    }
}
