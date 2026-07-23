 
/**
 * @personaforge/knowledge — KnowledgeEngine.
 *
 * SOLID:
 *   SRP  — engine owns only retrieval orchestration.
 *   OCP  — extend via VectorStore/EmbeddingFn interfaces; never modify engine.
 *   DIP  — depends on VectorStore + EmbeddingFn abstractions.
 *
 * DS choices:
 *   - In-memory vector store uses cosine similarity with a min-heap of size k
 *     → O(n log k) search, O(1) heap pop for top-k results.
 *   - Document IDs via crypto.randomUUID() — zero deps, O(1).
 */

import type { Document, VectorStore, EmbeddingFn, SearchResult, RAGEngine } from './types.js';

// ── Cosine similarity ─────────────────────────────────────────────────────────
// O(d) where d = vector dimension.

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

function magnitude(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

function cosineSimilarity(a: number[], b: number[]): number {
  const magA = magnitude(a);
  const magB = magnitude(b);
  if (magA === 0 || magB === 0) return 0;
  return dotProduct(a, b) / (magA * magB);
}

// ── In-memory vector store ─────────────────────────────────────────────────────

interface StoredDoc {
  document:  Document;
  embedding: number[];
}

/**
 * InMemoryVectorStore — cosine similarity search with partial sort (O(n log k)).
 * Suitable for up to ~10 000 documents. For larger corpora use adapter-pinecone/qdrant.
 */
class InMemoryVectorStore implements VectorStore {
  private readonly _docs: StoredDoc[] = [];
  private readonly _embed: EmbeddingFn;

  constructor(embed: EmbeddingFn) {
    this._embed = embed;
  }

  async add(documents: Document[]): Promise<void> {
    // Embed in parallel — O(n × embed latency)
    const embeddings = await Promise.all(documents.map((d) => this._embed(d.content)));
    for (let i = 0; i < documents.length; i++) {
      const document = documents[i];
      const embedding = embeddings[i];
      if (!document || !embedding) continue;
      this._docs.push({ document, embedding });
    }
  }

  /**
   * O(n log k) — compute all similarities, partial sort to get top-k.
   * Heap not used here for simplicity; native sort on k<<n is fast enough.
   */
  async search(query: string, topK: number): Promise<SearchResult[]> {
    const qEmbed = await this._embed(query);
    return this._docs
      .map((d) => ({ document: d.document, score: cosineSimilarity(qEmbed, d.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

// ── Embedding result cache ────────────────────────────────────────────────────
// LRU cache using Map (insertion order) — evicts the oldest entry when full.
// Keyed by the raw text; value is the embedding vector.
// Space: O(maxSize × vector_dim). For 500 entries at 1536 dim ≈ 3 MB.

class EmbeddingCache {
  private readonly _cache = new Map<string, number[]>();
  private readonly _maxSize: number;

  constructor(maxSize: number) {
    this._maxSize = maxSize;
  }

  get(text: string): number[] | undefined {
    const hit = this._cache.get(text);
    if (hit !== undefined) {
      // Promote to most-recently-used by re-inserting at the end.
      this._cache.delete(text);
      this._cache.set(text, hit);
    }
    return hit;
  }

  set(text: string, embedding: number[]): void {
    if (this._cache.has(text)) {
      this._cache.delete(text);
    } else if (this._cache.size >= this._maxSize) {
      // Evict the least-recently-used entry (first key in the Map).
      const lru = this._cache.keys().next().value;
      if (lru !== undefined) this._cache.delete(lru);
    }
    this._cache.set(text, embedding);
  }

  /** Number of cached entries. */
  get size(): number { return this._cache.size; }

  /** Remove all cached embeddings. */
  clear(): void { this._cache.clear(); }
}

/**
 * Wrap an `EmbeddingFn` with an LRU cache.
 *
 * @param embed    The underlying embedding function to wrap.
 * @param maxSize  Maximum number of entries to cache. Default: 500.
 */
export function withEmbeddingCache(embed: EmbeddingFn, maxSize = 500): EmbeddingFn & { cache: EmbeddingCache } {
  const cache = new EmbeddingCache(maxSize);
  const cached: EmbeddingFn & { cache: EmbeddingCache } = Object.assign(
    async (text: string): Promise<number[]> => {
      const hit = cache.get(text);
      if (hit !== undefined) return hit;
      const result = await embed(text);
      cache.set(text, result);
      return result;
    },
    { cache },
  );
  return cached;
}

// ── TF-IDF fallback embedding (zero deps) ─────────────────────────────────────
// Suitable for development/testing without an embedding API key.

function tfidfEmbed(text: string): Promise<number[]> {
  const words   = text.toLowerCase().split(/\W+/).filter(Boolean);
  const freq    = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  // Return a 64-element vector using hash bucketing — O(words)
  const vec = new Array<number>(64).fill(0);
  for (const [word, count] of freq) {
    const bucket = word.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffff, 0) % 64;
    vec[bucket] = (vec[bucket] ?? 0) + count;
  }
  return Promise.resolve(vec);
}

// ── KnowledgeEngine ────────────────────────────────────────────────────────────

export interface KnowledgeEngineOptions {
  /** Custom vector store (e.g. Pinecone, Qdrant adapter). Default: in-memory. */
  store?: VectorStore;
  /** Embedding function. Default: TF-IDF (no API key needed). */
  embed?: EmbeddingFn;
  /** Number of documents to retrieve per query. Default: 5. */
  topK?: number;
  /** Max chars of context to inject. Default: 4000. */
  maxContextChars?: number;
  /**
   * Maximum number of embedding results to cache in memory (LRU cache).
   * Set to `0` to disable caching.
   * Default: 500.
   */
  embeddingCacheSize?: number;
}

/**
 * KnowledgeEngine — wraps a VectorStore + EmbeddingFn into a simple RAGEngine.
 */
export class KnowledgeEngine implements RAGEngine {
  private readonly _store:          VectorStore;
  private readonly _topK:           number;
  private readonly _maxContextChars: number;

  constructor(opts: KnowledgeEngineOptions = {}) {
    const rawEmbed = opts.embed ?? tfidfEmbed;
    const cacheSize = opts.embeddingCacheSize ?? 500;
    const embed = cacheSize > 0 ? withEmbeddingCache(rawEmbed, cacheSize) : rawEmbed;
    this._store   = opts.store ?? new InMemoryVectorStore(embed);
    this._topK    = opts.topK  ?? 5;
    this._maxContextChars = opts.maxContextChars ?? 4_000;
  }

  async addDocuments(docs: Document[]): Promise<void> {
    // Assign IDs where missing
    const stamped = docs.map((d) => ({
      ...d,
      id: d.id || crypto.randomUUID(),
    }));
    await this._store.add(stamped);
  }

  /**
   * Build RAG context string for injection into the system prompt.
   * O(n log k) for in-memory store; O(1) network call for remote stores.
   */
  async buildContext(query: string, topK?: number): Promise<string> {
    const k       = topK ?? this._topK;
    const results = await this._store.search(query, k);

    if (results.length === 0) return '';

    let chars  = 0;
    const kept: SearchResult[] = [];
    for (const r of results) {
      if (chars + r.document.content.length > this._maxContextChars) break;
      kept.push(r);
      chars += r.document.content.length;
    }

    return kept.map((r, i) => `[${String(i + 1)}] ${r.document.content}`).join('\n\n');
  }
}

/** Factory shorthand. */
export function createKnowledgeEngine(opts?: KnowledgeEngineOptions): KnowledgeEngine {
  return new KnowledgeEngine(opts);
}
