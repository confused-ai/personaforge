/**
 * Neo4j Knowledge Adapter
 * =======================
 * Implements `VectorStore` using Neo4j's native vector index (Neo4j ≥ 5.11).
 *
 * Requires the `neo4j-driver` peer dependency:
 *   pnpm add neo4j-driver
 *
 * Vector index must be created in Neo4j before use:
 *   CALL db.index.vector.createNodeIndex(
 *     'documentEmbeddings',  // index name
 *     'Document',             // label
 *     'embedding',            // property
 *     1536,                   // dimension (match your embedding model)
 *     'cosine'                // similarity metric
 *   )
 *
 * Usage:
 *   const adapter = new Neo4jKnowledgeAdapter({
 *     uri: 'bolt://localhost:7687',
 *     username: 'neo4j',
 *     password: process.env.NEO4J_PASSWORD!,
 *     embed: myEmbeddingFn,
 *   });
 *   const engine = new KnowledgeEngine({ store: adapter, embed: myEmbeddingFn });
 */

import type { Document, VectorStore, EmbeddingFn, SearchResult } from '../types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export interface Neo4jAdapterConfig {
    /** Bolt or bolt+s URI, e.g. 'bolt://localhost:7687' */
    uri: string;
    username: string;
    password: string;
    /** Database name. Default: 'neo4j' */
    database?: string;
    /** Neo4j vector index name. Default: 'documentEmbeddings' */
    indexName?: string;
    /** Node label. Default: 'Document' */
    nodeLabel?: string;
    /** Embedding function — converts text → float vector. */
    embed: EmbeddingFn;
}

// ── Neo4j driver type shim (optional peer dep) ────────────────────────────────

interface Neo4jDriver {
    session(options?: { database?: string }): Neo4jSession;
    close(): Promise<void>;
}

interface Neo4jSession {
    run(query: string, params?: Record<string, unknown>): Promise<{ records: Neo4jRecord[] }>;
    close(): Promise<void>;
}

interface Neo4jRecord {
    get(key: string): unknown;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class Neo4jKnowledgeAdapter implements VectorStore {
    private readonly _config: Required<Omit<Neo4jAdapterConfig, 'embed'>> & { embed: EmbeddingFn };
    private _driver: Neo4jDriver | undefined;

    constructor(config: Neo4jAdapterConfig) {
        this._config = {
            uri:       config.uri,
            username:  config.username,
            password:  config.password,
            database:  config.database  ?? 'neo4j',
            indexName: config.indexName ?? 'documentEmbeddings',
            nodeLabel: config.nodeLabel ?? 'Document',
            embed:     config.embed,
        };
    }

    async add(documents: Document[]): Promise<void> {
        const driver = await this._getDriver();
        const session = driver.session({ database: this._config.database });
        try {
            const embeddings = await Promise.all(documents.map((d) => this._config.embed(d.content)));
            for (let i = 0; i < documents.length; i++) {

                const doc       = documents[i]!;

                const embedding = embeddings[i]!;
                await session.run(
                    `MERGE (d:${this._config.nodeLabel} { id: $id })
                     SET d.content   = $content,
                         d.metadata  = $metadata,
                         d.embedding = $embedding`,
                    {
                        id:        doc.id,
                        content:   doc.content,
                        metadata:  JSON.stringify(doc.metadata),
                        embedding,
                    },
                );
            }
        } finally {
            await session.close();
        }
    }

    async search(query: string, topK: number): Promise<SearchResult[]> {
        const queryEmbedding = await this._config.embed(query);
        const driver  = await this._getDriver();
        const session = driver.session({ database: this._config.database });
        try {
            const result = await session.run(
                `CALL db.index.vector.queryNodes($indexName, $topK, $embedding)
                 YIELD node, score
                 RETURN node.id AS id, node.content AS content, node.metadata AS metadata, score`,
                { indexName: this._config.indexName, topK, embedding: queryEmbedding },
            );
            return result.records.map((r): SearchResult => {
                let metadata: Record<string, unknown> = {};
                try {
                    const raw = r.get('metadata');
                    if (typeof raw === 'string') metadata = JSON.parse(raw) as Record<string, unknown>;
                } catch { /* ignore parse errors */ }
                return {
                    document: {
                        id:       ((r.get('id') as string | null | undefined) ?? ''),
                        content:  ((r.get('content') as string | null | undefined) ?? ''),
                        metadata,
                    },
                    score: Number(r.get('score') ?? 0),
                };
            });
        } finally {
            await session.close();
        }
    }

    /** Close the underlying Neo4j driver connection. */
    async close(): Promise<void> {
        if (this._driver) {
            await this._driver.close();
            this._driver = undefined;
        }
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _getDriver(): Promise<Neo4jDriver> {
        if (this._driver) return this._driver;
        // Dynamic import so neo4j-driver is truly optional at bundle time
        // @ts-expect-error — optional peer dependency, may not be installed

        const neo4j = await import('neo4j-driver').catch(() => {
            throw new Error(
                '@personaforge/knowledge Neo4jKnowledgeAdapter requires "neo4j-driver". ' +
                'Install it with: pnpm add neo4j-driver',
            );
        });

        this._driver = ((neo4j as { default?: { driver: (...args: unknown[]) => Neo4jDriver }; driver?: (...args: unknown[]) => Neo4jDriver })
            .default?.driver(this._config.uri, (neo4j as { default?: { auth?: { basic: (u: string, p: string) => unknown } } }).default?.auth?.basic(this._config.username, this._config.password))
            ?? (neo4j as { driver: (uri: string, auth: unknown) => Neo4jDriver }).driver(
                this._config.uri,
                (neo4j as { auth: { basic: (u: string, p: string) => unknown } }).auth.basic(this._config.username, this._config.password),
            )) as Neo4jDriver;
        return this._driver;
    }
}
