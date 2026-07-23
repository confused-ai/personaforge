/**
 * @personaforge/knowledge — BM25 keyword index.
 *
 * Zero-dependency Okapi BM25. Complements dense (vector) retrieval so exact
 * term matches (names, IDs, error codes) are never lost in embedding space.
 *
 *   add(docs) — O(N × avg tokens)          store term frequencies, update df
 *   search(q) — O(|q terms| × postings + K log K)  min-heap top-K
 *
 * Deliberately in-memory. For >100k docs pair with a proper search backend
 * (Elastic, Meilisearch) via the same interface.
 */

import type { Document, SearchResult } from '../types.js';

const K1 = 1.5;
const B = 0.75;

interface Posting { docId: string; tf: number }

/** BM25 keyword index. */
export class BM25Index {
  private readonly postings = new Map<string, Posting[]>();
  private readonly docLen = new Map<string, number>();
  private readonly docs = new Map<string, Document>();
  private totalLen = 0;

  add(documents: Document[]): void {
    for (const doc of documents) {
      const tokens = tokenize(doc.content);
      this.docs.set(doc.id, doc);
      this.docLen.set(doc.id, tokens.length);
      this.totalLen += tokens.length;
      const tf = new Map<string, number>();
      for (const tok of tokens) tf.set(tok, (tf.get(tok) ?? 0) + 1);
      for (const [term, count] of tf) {
        const arr = this.postings.get(term) ?? [];
        arr.push({ docId: doc.id, tf: count });
        this.postings.set(term, arr);
      }
    }
  }

  /** Top-K BM25 results for the query. */
  search(query: string, topK: number): SearchResult[] {
    const terms = tokenize(query);
    const N = this.docs.size;
    if (N === 0 || terms.length === 0) return [];
    const avgdl = this.totalLen / N;
    const scores = new Map<string, number>();

    for (const term of terms) {
      const postings = this.postings.get(term);
      if (!postings) continue;
      const df = postings.length;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (const { docId, tf } of postings) {
        const dl = this.docLen.get(docId) ?? 0;
        const denom = tf + K1 * (1 - B + B * (dl / (avgdl || 1)));
        const contrib = idf * ((tf * (K1 + 1)) / (denom || 1));
        scores.set(docId, (scores.get(docId) ?? 0) + contrib);
      }
    }

    // Normalise into 0..1 for comparability with cosine scores in RRF/fusion.
    const raw = Array.from(scores.entries());
    if (raw.length === 0) return [];
    const max = Math.max(...raw.map(([, s]) => s));
    return raw
      .map(([docId, score]) => {
        const doc = this.docs.get(docId);
        return doc ? { document: doc, score: max > 0 ? score / max : 0 } : null;
      })
      .filter((r): r is SearchResult => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  size(): number { return this.docs.size; }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}
