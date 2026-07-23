/**
 * pgvector Knowledge Adapter
 * ==========================
 * Implements `VectorStore` on top of PostgreSQL + pgvector extension.
 * Uses the `pg` (node-postgres) driver.
 *
 * Requires peer dependencies:
 *   pnpm add pg pgvector
 *   pnpm add -D @types/pg
 *
 * Set up the table once:
 *   CREATE EXTENSION IF NOT EXISTS vector;
 *   CREATE TABLE IF NOT EXISTS documents (
 *     id       TEXT PRIMARY KEY,
 *     content  TEXT NOT NULL,
 *     metadata JSONB,
 *     embedding vector(1536)   -- dimensions must match your embed model
 *   );
 *   CREATE INDEX IF NOT EXISTS documents_embedding_idx
 *     ON documents USING ivfflat (embedding vector_cosine_ops);
 *
 * Usage:
 *   const adapter = new PgvectorKnowledgeAdapter({
 *     connectionString: process.env.DATABASE_URL!,
 *     embed: myEmbeddingFn,
 *   });
 */

import type { Document, VectorStore, EmbeddingFn, SearchResult } from '../types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export interface PgvectorAdapterConfig {
    /** PostgreSQL connection string, e.g. 'postgresql://user:pass@localhost:5432/db' */
    connectionString: string;
    /** Table name. Default: 'documents' */
    tableName?: string;
    /** Embedding function */
    embed: EmbeddingFn;
}

// ── pg Pool shim (optional peer dep) ─────────────────────────────────────────

interface PgPool {
    query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    end(): Promise<void>;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class PgvectorKnowledgeAdapter implements VectorStore {
    private readonly _connectionString: string;
    private readonly _tableName: string;
    private readonly _embed: EmbeddingFn;
    private _pool: PgPool | undefined;

    constructor(config: PgvectorAdapterConfig) {
        this._connectionString = config.connectionString;
        this._tableName        = config.tableName ?? 'documents';
        this._embed            = config.embed;
    }

    async add(documents: Document[]): Promise<void> {
        const pool = await this._getPool();
        const embeddings = await Promise.all(documents.map((d) => this._embed(d.content)));
        for (let i = 0; i < documents.length; i++) {

            const doc  = documents[i]!;

            const emb  = embeddings[i]!;
            // Use pgvector array syntax: '[0.1, 0.2, ...]'
            const embStr = `[${emb.join(',')}]`;
            await pool.query(
                `INSERT INTO ${this._tableName} (id, content, metadata, embedding)
                 VALUES ($1, $2, $3, $4::vector)
                 ON CONFLICT (id) DO UPDATE
                   SET content   = EXCLUDED.content,
                       metadata  = EXCLUDED.metadata,
                       embedding = EXCLUDED.embedding`,
                [doc.id, doc.content, JSON.stringify(doc.metadata), embStr],
            );
        }
    }

    async search(query: string, topK: number): Promise<SearchResult[]> {
        const pool        = await this._getPool();
        const queryEmbed  = await this._embed(query);
        const embStr      = `[${queryEmbed.join(',')}]`;
        const { rows } = await pool.query(
            `SELECT id, content, metadata,
                    1 - (embedding <=> $1::vector) AS score
             FROM ${this._tableName}
             ORDER BY embedding <=> $1::vector
             LIMIT $2`,
            [embStr, topK],
        );
        return rows.map((row): SearchResult => {
            let metadata: Record<string, unknown> = {};
            try {
                if (typeof row['metadata'] === 'string') {
                    metadata = JSON.parse(row['metadata']) as Record<string, unknown>;
                } else if (row['metadata'] && typeof row['metadata'] === 'object') {
                    metadata = row['metadata'] as Record<string, unknown>;
                }
            } catch { /* ignore */ }
            return {
                document: {
                    id:      ((row['id'] as string | null | undefined) ?? ''),
                    content: ((row['content'] as string | null | undefined) ?? ''),
                    metadata,
                },
                score: Number(row['score'] ?? 0),
            };
        });
    }

    /** Gracefully close the pool when the adapter is no longer needed. */
    async close(): Promise<void> {
        if (this._pool) {
            await this._pool.end();
            this._pool = undefined;
        }
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _getPool(): Promise<PgPool> {
        if (this._pool) return this._pool;
        // @ts-ignore -- pg is an optional peer dependency
        const pg = await import('pg').catch(() => {
            throw new Error(
                '@personaforge/knowledge PgvectorKnowledgeAdapter requires "pg". ' +
                'Install it with: pnpm add pg',
            );
        }) as { default?: { Pool: new (opts: { connectionString: string }) => PgPool }; Pool?: new (opts: { connectionString: string }) => PgPool };
        const Pool = pg.default?.Pool ?? pg.Pool;
        if (!Pool) throw new Error('Could not locate pg.Pool constructor');
        this._pool = new Pool({ connectionString: this._connectionString });
        return this._pool;
    }
}
