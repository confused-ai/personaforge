/**
 * @personaforge/knowledge — RAG types.
 */

export interface Document {
  readonly id:       string;
  readonly content:  string;
  readonly metadata: Record<string, unknown>;
}

export interface SearchResult {
  readonly document: Document;
  /** Similarity score 0–1. */
  readonly score: number;
}

/**
 * VectorStore — ISP: only the two methods the RAG engine needs.
 * O(1) add (amortised), O(k results) search.
 */
export interface VectorStore {
  add(documents: Document[]): Promise<void>;
  search(query: string, topK: number): Promise<SearchResult[]>;
}

/** EmbeddingFn — converts text → float vector. */
export type EmbeddingFn = (text: string) => Promise<number[]>;

/** RAGEngine — interface consumed by @personaforge/core. */
export interface RAGEngine {
  addDocuments(docs: Document[]): Promise<void>;
  buildContext(query: string, topK?: number): Promise<string>;
  retrieve?(query: string, options?: RAGQueryOptions): Promise<RAGQueryResult>;
  generate?(query: string, options?: RAGQueryOptions & { maxTokens?: number }): Promise<{ answer: string; chunks: RAGChunk[] }>;
  ingest?(chunks: Array<{ content: string; metadata?: Record<string, unknown> }>): Promise<void>;
}

/** Single retrieved chunk for RAG */
export interface RAGChunk {
    readonly id: string;
    readonly content: string;
    readonly score: number;
    readonly metadata?: Record<string, unknown>;
    readonly source?: string;
}

/** RAG query options */
export interface RAGQueryOptions {
    readonly limit?: number;
    readonly threshold?: number;
    readonly filter?: Record<string, unknown>;
    readonly rerank?: boolean;
    readonly hybrid?: boolean;
}

/** RAG query result */
export interface RAGQueryResult {
    readonly chunks: RAGChunk[];
    readonly query: string;
    readonly totalRetrieved?: number;
}
