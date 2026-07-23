/**
 * Chroma Knowledge Adapter
 * ========================
 * Implements `VectorStore` using ChromaDB (chromadb npm package).
 *
 * Requires the `chromadb` peer dependency:
 *   pnpm add chromadb
 *
 * Usage:
 *   const adapter = new ChromaKnowledgeAdapter({
 *     url: 'http://localhost:8000',
 *     collectionName: 'my-docs',
 *     embed: myEmbeddingFn,
 *   });
 */

import type { Document, VectorStore, EmbeddingFn, SearchResult } from '../types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export interface ChromaAdapterConfig {
    /** ChromaDB server URL. Default: 'http://localhost:8000' */
    url?: string;
    /** Collection name. Default: 'documents' */
    collectionName?: string;
    /** Embedding function */
    embed: EmbeddingFn;
}

// ── Minimal chromadb type shim ────────────────────────────────────────────────

interface ChromaClient {
    getOrCreateCollection(opts: { name: string; metadata?: Record<string, string> }): Promise<ChromaCollection>;
}

interface ChromaCollection {
    add(params: {
        ids: string[];
        documents: string[];
        embeddings: number[][];
        metadatas?: Array<Record<string, unknown>>;
    }): Promise<void>;
    query(params: {
        queryEmbeddings: number[][];
        nResults: number;
        include?: string[];
    }): Promise<{
        ids: string[][];
        documents: (string | null)[][];
        metadatas: (Record<string, unknown> | null)[][];
        distances: number[][];
    }>;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class ChromaKnowledgeAdapter implements VectorStore {
    private readonly _url: string;
    private readonly _collectionName: string;
    private readonly _embed: EmbeddingFn;
    private _collection: ChromaCollection | undefined;

    constructor(config: ChromaAdapterConfig) {
        this._url            = config.url            ?? 'http://localhost:8000';
        this._collectionName = config.collectionName ?? 'documents';
        this._embed          = config.embed;
    }

    async add(documents: Document[]): Promise<void> {
        const collection = await this._getCollection();
        const embeddings = await Promise.all(documents.map((d) => this._embed(d.content)));
        await collection.add({
            ids:        documents.map((d) => d.id),
            documents:  documents.map((d) => d.content),
            embeddings,
            metadatas:  documents.map((d) => d.metadata),
        });
    }

    async search(query: string, topK: number): Promise<SearchResult[]> {
        const collection = await this._getCollection();
        const queryEmbed = await this._embed(query);
        const result = await collection.query({
            queryEmbeddings: [queryEmbed],
            nResults:        topK,
            include:         ['documents', 'metadatas', 'distances'],
        });

        const ids       = result.ids[0]       ?? [];
        const docs      = result.documents[0] ?? [];
        const metas     = result.metadatas[0] ?? [];
        const distances = result.distances[0] ?? [];

        return ids.map((id, i): SearchResult => ({
            document: {
                id,
                content:  docs[i]  ?? '',
                metadata: metas[i] ?? {},
            },
            // Chroma returns L2 distance; convert to cosine-like similarity (0–1)
            score: 1 / (1 + (distances[i] ?? 0)),
        }));
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _getCollection(): Promise<ChromaCollection> {
        if (this._collection) return this._collection;
        // @ts-expect-error — optional peer dependency, may not be installed
        const { ChromaClient: Client } = await import('chromadb').catch(() => {
            throw new Error(
                '@personaforge/knowledge ChromaKnowledgeAdapter requires "chromadb". ' +
                'Install it with: pnpm add chromadb',
            );
        }) as { ChromaClient: new (opts: { path: string }) => ChromaClient };
        const client = new Client({ path: this._url });
        this._collection = await client.getOrCreateCollection({ name: this._collectionName });
        return this._collection;
    }
}
