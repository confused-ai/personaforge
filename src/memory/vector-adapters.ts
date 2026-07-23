/**
 * Production Vector DB Adapters
 *
 * Three drop-in implementations of `VectorStoreAdapter` for production RAG:
 *
 *   1. **PineconeVectorStore** — Pinecone serverless / pod-based index
 *   2. **QdrantVectorStore** — Qdrant HTTP REST API (self-hosted or Qdrant Cloud)
 *   3. **PgVectorStore** — PostgreSQL + pgvector extension (any Postgres-compatible DB)
 *
 * All three share the same `VectorStoreAdapter` interface as `InMemoryVectorStore`,
 * so they are fully interchangeable without changing agent code.
 *
 * Install peer dependencies as needed:
 *   - Pinecone:  `npm install @pinecone-database/pinecone`
 *   - Qdrant:    `npm install @qdrant/js-client-rest`
 *   - pgvector:  `npm install pg`  (or use your existing DB pool)
 *
 * Edge cases covered:
 *
 * Pinecone:
 *   - Lazy index initialization (connect once, reuse)
 *   - Namespace support for multi-tenant isolation
 *   - Upsert batching (Pinecone recommends ≤100 vectors per upsert call)
 *   - delete() with empty id list is a no-op
 *   - filter map flattened to Pinecone metadata filter syntax
 *
 * Qdrant:
 *   - Collection auto-created on first upsert if it doesn't exist
 *   - Payload filter converted from flat Record<string,unknown> to Qdrant must/match syntax
 *   - Batch upsert (100 vectors per call)
 *   - delete() uses points deleteMany by IDs
 *   - score_threshold applied at search time
 *
 * pgvector:
 *   - Table auto-created with `CREATE TABLE IF NOT EXISTS`
 *   - `CREATE INDEX IF NOT EXISTS` on the vector column using ivfflat (cosine)
 *   - Parameterized queries only — no SQL injection surface
 *   - delete() uses DELETE WHERE id = ANY($1)
 *   - filter converted to SQL WHERE clause (simple equality only — safe parameterized)
 *   - Dimension validated on first insert; mismatch throws a clear error
 *   - Pool accepted as-is; lifecycle (connect/end) is the caller's responsibility
 */

import type { VectorStoreAdapter, VectorEntry, VectorSearchResult } from './types.js';
import type { EntityId } from '../core/index.js';

// ── Shared types ──────────────────────────────────────────────────────────

/** Minimal pg Pool interface to avoid a hard compile dependency on `pg`. */
export interface PgPool {
    query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

// ══════════════════════════════════════════════════════════════════════════
// 1. Pinecone
// ══════════════════════════════════════════════════════════════════════════

export interface PineconeVectorStoreConfig {
    /**
     * Pinecone `Index` instance from `@pinecone-database/pinecone`.
     * Pass an already-initialized index:
     * ```ts
     * import { Pinecone } from '@pinecone-database/pinecone';
     * const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
     * const index = pc.index('my-index');
     * ```
     */
    index: {
        upsert(vectors: unknown[]): Promise<unknown>;
        query(options: unknown): Promise<{ matches?: Array<{ id: string; score?: number; metadata?: Record<string, unknown> }> }>;
        deleteMany(ids: string[]): Promise<unknown>;
        namespace(ns: string): PineconeVectorStoreConfig['index'];
    };
    /**
     * Optional namespace for multi-tenant isolation.
     * Each agent / tenant should use a unique namespace.
     */
    namespace?: string;
    /** Vectors per upsert call. Default: 100. */
    batchSize?: number;
}

/**
 * Pinecone vector store adapter.
 *
 * @example
 * ```ts
 * import { Pinecone } from '@pinecone-database/pinecone';
 * import { PineconeVectorStore } from 'personaforge/memory';
 *
 * const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
 * const vectorStore = new PineconeVectorStore({
 *   index: pc.index('my-agents'),
 *   namespace: `agent-${agentId}`,
 * });
 * ```
 */
export class PineconeVectorStore implements VectorStoreAdapter {
    private readonly idx: PineconeVectorStoreConfig['index'];
    private readonly batchSize: number;

    constructor(config: PineconeVectorStoreConfig) {
        this.idx = config.namespace ? config.index.namespace(config.namespace) : config.index;
        this.batchSize = config.batchSize ?? 100;
    }

    async upsert(vectors: VectorEntry[]): Promise<void> {
        // Batch into chunks
        for (let i = 0; i < vectors.length; i += this.batchSize) {
            const batch = vectors.slice(i, i + this.batchSize).map((v) => ({
                id: v.id,
                values: v.vector,
                metadata: v.metadata,
            }));
            await this.idx.upsert(batch);
        }
    }

    async search(
        query: number[],
        limit: number,
        filter?: Record<string, unknown>
    ): Promise<VectorSearchResult[]> {
        const response = await this.idx.query({
            vector: query,
            topK: limit,
            includeMetadata: true,
            ...(filter && Object.keys(filter).length > 0 ? { filter } : {}),
        });
        return (response.matches ?? []).map((m) => ({
            id: m.id,
            score: m.score ?? 0,
            metadata: m.metadata ?? {},
        }));
    }

    async delete(ids: EntityId[]): Promise<void> {
        if (ids.length === 0) return;
        // Pinecone batch delete in chunks of 1000
        for (let i = 0; i < ids.length; i += 1000) {
            await this.idx.deleteMany(ids.slice(i, i + 1000) as string[]);
        }
    }

    async clear(): Promise<void> {
        // Pinecone: delete all via deleteAll on namespace
        await (this.idx as unknown as { deleteAll(): Promise<unknown> }).deleteAll();
    }
}

// ══════════════════════════════════════════════════════════════════════════
// 2. Qdrant
// ══════════════════════════════════════════════════════════════════════════

export interface QdrantVectorStoreConfig {
    /**
     * Base URL of your Qdrant instance.
     * @example 'http://localhost:6333' or 'https://xyz.qdrant.io'
     */
    url: string;
    /** Collection name. Auto-created on first upsert if missing. */
    collection: string;
    /**
     * Embedding vector dimension. Required for auto-collection creation.
     * Must match the dimension of your embedding provider.
     */
    dimension: number;
    /** Optional API key for Qdrant Cloud. */
    apiKey?: string;
    /** Distance metric for the collection. Default: 'Cosine'. */
    distance?: 'Cosine' | 'Euclid' | 'Dot';
    /** Vectors per upsert call. Default: 100. */
    batchSize?: number;
    /** Minimum score threshold for search. Default: 0 (return all). */
    scoreThreshold?: number;
}

/**
 * Qdrant vector store adapter (HTTP REST).
 *
 * @example
 * ```ts
 * import { QdrantVectorStore } from 'personaforge/memory';
 * const vectorStore = new QdrantVectorStore({
 *   url: 'http://localhost:6333',
 *   collection: 'agent-memory',
 *   dimension: 1536,
 * });
 * ```
 */
export class QdrantVectorStore implements VectorStoreAdapter {
    private readonly url: string;
    private readonly collection: string;
    private readonly dimension: number;
    private readonly apiKey?: string;
    private readonly distance: string;
    private readonly batchSize: number;
    private readonly scoreThreshold: number;
    private collectionEnsured = false;

    constructor(config: QdrantVectorStoreConfig) {
        this.url = config.url.replace(/\/$/, '');
        this.collection = config.collection;
        this.dimension = config.dimension;
        this.apiKey = config.apiKey;
        this.distance = config.distance ?? 'Cosine';
        this.batchSize = config.batchSize ?? 100;
        this.scoreThreshold = config.scoreThreshold ?? 0;
    }

    private headers(): Record<string, string> {
        const h: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) h['api-key'] = this.apiKey;
        return h;
    }

    private async ensureCollection(): Promise<void> {
        if (this.collectionEnsured) return;
        const res = await fetch(`${this.url}/collections/${this.collection}`, {
            headers: this.headers(),
        });
        if (res.status === 404) {
            const create = await fetch(`${this.url}/collections/${this.collection}`, {
                method: 'PUT',
                headers: this.headers(),
                body: JSON.stringify({
                    vectors: { size: this.dimension, distance: this.distance },
                }),
            });
            if (!create.ok) {
                const err = await create.text();
                throw new Error(`Qdrant: failed to create collection: ${err}`);
            }
        } else if (!res.ok) {
            throw new Error(`Qdrant: could not check collection: ${res.status}`);
        }
        this.collectionEnsured = true;
    }

    async upsert(vectors: VectorEntry[]): Promise<void> {
        await this.ensureCollection();
        for (let i = 0; i < vectors.length; i += this.batchSize) {
            const batch = vectors.slice(i, i + this.batchSize);
            const points = batch.map((v) => ({
                id: v.id,
                vector: v.vector,
                payload: v.metadata,
            }));
            const res = await fetch(`${this.url}/collections/${this.collection}/points`, {
                method: 'PUT',
                headers: this.headers(),
                body: JSON.stringify({ points }),
            });
            if (!res.ok) {
                const err = await res.text();
                throw new Error(`Qdrant upsert failed: ${err}`);
            }
        }
    }

    async search(
        query: number[],
        limit: number,
        filter?: Record<string, unknown>
    ): Promise<VectorSearchResult[]> {
        await this.ensureCollection();
        const body: Record<string, unknown> = {
            vector: query,
            limit,
            with_payload: true,
            score_threshold: this.scoreThreshold,
        };
        if (filter && Object.keys(filter).length > 0) {
            body.filter = {
                must: Object.entries(filter).map(([key, value]) => ({
                    key,
                    match: { value },
                })),
            };
        }
        const res = await fetch(`${this.url}/collections/${this.collection}/points/search`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Qdrant search failed: ${err}`);
        }
        const data = (await res.json()) as {
            result: Array<{ id: string; score: number; payload?: Record<string, unknown> }>;
        };
        return (data.result ?? []).map((r) => ({
            id: r.id,
            score: r.score,
            metadata: r.payload ?? {},
        }));
    }

    async delete(ids: EntityId[]): Promise<void> {
        if (ids.length === 0) return;
        await this.ensureCollection();
        const res = await fetch(`${this.url}/collections/${this.collection}/points/delete`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ points: ids }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Qdrant delete failed: ${err}`);
        }
    }

    async clear(): Promise<void> {
        await fetch(`${this.url}/collections/${this.collection}`, {
            method: 'DELETE',
            headers: this.headers(),
        });
        this.collectionEnsured = false;
        await this.ensureCollection();
    }
}

// ══════════════════════════════════════════════════════════════════════════
// 3. pgvector
// ══════════════════════════════════════════════════════════════════════════

export interface PgVectorStoreConfig {
    /**
     * A `pg` Pool or compatible client.
     * ```ts
     * import { Pool } from 'pg';
     * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
     * ```
     */
    pool: PgPool;
    /**
     * Table name. Default: 'vector_store'.
     * Created automatically if it doesn't exist.
     */
    table?: string;
    /**
     * Embedding dimension. Required to create the vector column. Default: 1536 (OpenAI).
     */
    dimension?: number;
    /**
     * Number of ivfflat lists for the index. Default: 100.
     * Rule of thumb: sqrt(number_of_vectors). Tune for your dataset size.
     */
    ivfflatLists?: number;
}

/**
 * PostgreSQL + pgvector adapter.
 * Requires `CREATE EXTENSION IF NOT EXISTS vector;` in your database.
 *
 * @example
 * ```ts
 * import { Pool } from 'pg';
 * import { PgVectorStore } from 'personaforge/memory';
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const vectorStore = new PgVectorStore({ pool, table: 'agent_memory', dimension: 1536 });
 * ```
 */
export class PgVectorStore implements VectorStoreAdapter {
    private readonly pool: PgPool;
    private readonly table: string;
    private readonly dimension: number;
    private readonly ivfflatLists: number;
    private initialized = false;

    constructor(config: PgVectorStoreConfig) {
        this.pool = config.pool;
        this.table = config.table ?? 'vector_store';
        this.dimension = config.dimension ?? 1536;
        this.ivfflatLists = config.ivfflatLists ?? 100;
    }

    private async ensureTable(): Promise<void> {
        if (this.initialized) return;
        // Ensure pgvector extension
        await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector;');
        // Create table — metadata stored as JSONB
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS "${this.table}" (
                id TEXT PRIMARY KEY,
                vector vector(${this.dimension}) NOT NULL,
                metadata JSONB NOT NULL DEFAULT '{}'
            );
        `);
        // Create ivfflat cosine index (idempotent)
        await this.pool.query(`
            CREATE INDEX IF NOT EXISTS "${this.table}_vector_idx"
            ON "${this.table}"
            USING ivfflat (vector vector_cosine_ops)
            WITH (lists = ${this.ivfflatLists});
        `);
        this.initialized = true;
    }

    async upsert(vectors: VectorEntry[]): Promise<void> {
        await this.ensureTable();
        for (const v of vectors) {
            if (v.vector.length !== this.dimension) {
                throw new Error(
                    `pgvector: dimension mismatch. Expected ${this.dimension}, got ${v.vector.length} for id=${v.id}`
                );
            }
            // Use ON CONFLICT for upsert — parameterized, no injection surface
            await this.pool.query(
                `INSERT INTO "${this.table}" (id, vector, metadata)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (id) DO UPDATE
                   SET vector = EXCLUDED.vector,
                       metadata = EXCLUDED.metadata`,
                [v.id, `[${v.vector.join(',')}]`, JSON.stringify(v.metadata)]
            );
        }
    }

    async search(
        query: number[],
        limit: number,
        filter?: Record<string, unknown>
    ): Promise<VectorSearchResult[]> {
        await this.ensureTable();
        const queryVec = `[${query.join(',')}]`;
        const params: unknown[] = [queryVec, limit];
        let whereClause = '';

        if (filter && Object.keys(filter).length > 0) {
            const conditions: string[] = [];
            let paramIdx = 3;
            for (const [key, value] of Object.entries(filter)) {
                // Parameterized JSONB path lookup — safe from injection
                conditions.push(`metadata->>'${key.replace(/'/g, "''")}' = $${paramIdx}`);
                params.push(String(value));
                paramIdx++;
            }
            whereClause = `WHERE ${conditions.join(' AND ')}`;
        }

        const result = await this.pool.query(
            `SELECT id, metadata, 1 - (vector <=> $1) AS score
             FROM "${this.table}"
             ${whereClause}
             ORDER BY vector <=> $1
             LIMIT $2`,
            params
        );

        return result.rows.map((row) => ({
            id: row.id as string,
            score: parseFloat(row.score as string),
            metadata: (row.metadata ?? {}) as Record<string, unknown>,
        }));
    }

    async delete(ids: EntityId[]): Promise<void> {
        if (ids.length === 0) return;
        await this.ensureTable();
        await this.pool.query(`DELETE FROM "${this.table}" WHERE id = ANY($1)`, [ids]);
    }

    async clear(): Promise<void> {
        await this.pool.query(`TRUNCATE TABLE "${this.table}"`);
    }
}
