/**
 * @confused-ai/knowledge — hybrid retrieval (dense + BM25) via Reciprocal-Rank
 * Fusion.
 *
 * RRF: for each candidate d, score = Σ 1 / (k + rank_i(d)) across every ranked
 * list it appears in. k defaults to 60 (Cormack et al.). Rank-only fusion is
 * used because dense cosine and BM25 scores are not directly comparable.
 *
 * ```ts
 * const hybrid = new HybridRetriever({ dense: vectorStore, sparse: bm25 });
 * const results = await hybrid.search('reset password link', 10);
 * ```
 */

import type { VectorStore, SearchResult } from '../types.js';
import type { BM25Index } from './bm25.js';

export interface HybridRetrieverOptions {
  dense: VectorStore;
  sparse: BM25Index;
  /** RRF constant. Higher = tail contributions matter more. Default 60. */
  k?: number;
  /** How many candidates to pull from each list before fusion. Default 20. */
  candidateK?: number;
}

/** Hybrid retriever fusing dense and sparse rankings. */
export class HybridRetriever {
  private readonly dense: VectorStore;
  private readonly sparse: BM25Index;
  private readonly k: number;
  private readonly candidateK: number;
  constructor(opts: HybridRetrieverOptions) {
    this.dense = opts.dense;
    this.sparse = opts.sparse;
    this.k = opts.k ?? 60;
    this.candidateK = opts.candidateK ?? 20;
  }
  async search(query: string, topK: number): Promise<SearchResult[]> {
    const [denseHits, sparseHits] = await Promise.all([
      this.dense.search(query, this.candidateK),
      Promise.resolve(this.sparse.search(query, this.candidateK)),
    ]);
    return rrfFuse([denseHits, sparseHits], this.k).slice(0, topK);
  }
}

/**
 * rrfFuse — public helper. Fuse any number of ranked lists via RRF.
 * Retains the highest-scoring document representation seen across lists.
 */
export function rrfFuse(rankings: SearchResult[][], k = 60): SearchResult[] {
  const acc = new Map<string, { doc: SearchResult['document']; score: number }>();
  for (const list of rankings) {
    list.forEach((hit, rank) => {
      const id = hit.document.id;
      const entry = acc.get(id) ?? { doc: hit.document, score: 0 };
      entry.score += 1 / (k + rank + 1); // rank is 0-based; add 1 to match paper
      acc.set(id, entry);
    });
  }
  return Array.from(acc.values())
    .map(({ doc, score }) => ({ document: doc, score }))
    .sort((a, b) => b.score - a.score);
}
