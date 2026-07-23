/**
 * @personaforge/knowledge — reranker interface + adapters.
 *
 * A reranker takes a candidate list from cheap retrieval (dense/BM25/hybrid)
 * and re-scores it with a more expensive model that has access to the *pair*
 * (query, document). This is the single biggest quality lever above vanilla
 * cosine similarity retrieval.
 *
 * Adapters (all optional, lazy-loaded):
 *   - CohereReranker         — Cohere `rerank` endpoint
 *   - JinaReranker           — Jina AI `rerank` endpoint
 *   - LLMReranker            — score each pair with any LLM (works with local Ollama)
 */

import type { SearchResult } from '../types.js';

/** Standard reranker contract. */
export interface Reranker {
  rerank(query: string, candidates: SearchResult[], topK?: number): Promise<SearchResult[]>;
}

// ── Cohere ────────────────────────────────────────────────────────────────────

export interface CohereRerankerOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

/** CohereReranker — production-grade cross-encoder, ~50ms/100 docs. */
export class CohereReranker implements Reranker {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  constructor(opts: CohereRerankerOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.COHERE_API_KEY ?? '';
    if (!this.apiKey) throw new Error('[CohereReranker] COHERE_API_KEY required.');
    this.model = opts.model ?? 'rerank-english-v3.0';
    this.baseUrl = opts.baseUrl ?? 'https://api.cohere.ai/v1';
  }
  async rerank(query: string, candidates: SearchResult[], topK?: number): Promise<SearchResult[]> {
    if (candidates.length === 0) return [];
    const res = await fetch(`${this.baseUrl}/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        query,
        documents: candidates.map((c) => c.document.content),
        top_n: topK ?? candidates.length,
      }),
    });
    if (!res.ok) throw new Error(`[CohereReranker] HTTP ${String(res.status)} ${await res.text()}`);
    const json = (await res.json()) as { results: Array<{ index: number; relevance_score: number }> };
    return json.results.map((r) => ({ document: candidates[r.index]!.document, score: r.relevance_score }));
  }
}

// ── Jina ──────────────────────────────────────────────────────────────────────

export interface JinaRerankerOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

/** JinaReranker — open-source-friendly alternative to Cohere. */
export class JinaReranker implements Reranker {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  constructor(opts: JinaRerankerOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.JINA_API_KEY ?? '';
    if (!this.apiKey) throw new Error('[JinaReranker] JINA_API_KEY required.');
    this.model = opts.model ?? 'jina-reranker-v2-base-multilingual';
    this.baseUrl = opts.baseUrl ?? 'https://api.jina.ai/v1';
  }
  async rerank(query: string, candidates: SearchResult[], topK?: number): Promise<SearchResult[]> {
    if (candidates.length === 0) return [];
    const res = await fetch(`${this.baseUrl}/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        query,
        documents: candidates.map((c) => c.document.content),
        top_n: topK ?? candidates.length,
      }),
    });
    if (!res.ok) throw new Error(`[JinaReranker] HTTP ${String(res.status)} ${await res.text()}`);
    const json = (await res.json()) as { results: Array<{ index: number; relevance_score: number }> };
    return json.results.map((r) => ({ document: candidates[r.index]!.document, score: r.relevance_score }));
  }
}

// ── LLM as reranker ───────────────────────────────────────────────────────────

/**
 * LLMReranker — asks any chat LLM to score each (query, doc) pair 0..10.
 * Slower and pricier, but portable to Ollama/Anthropic/Google/OpenAI without a
 * dedicated rerank endpoint. Runs pairs in parallel with a bounded worker pool.
 */
export class LLMReranker implements Reranker {
  private readonly generate: (prompt: string) => Promise<string>;
  private readonly concurrency: number;
  constructor(opts: { generate: (prompt: string) => Promise<string>; concurrency?: number }) {
    this.generate = opts.generate;
    this.concurrency = opts.concurrency ?? 4;
  }
  async rerank(query: string, candidates: SearchResult[], topK?: number): Promise<SearchResult[]> {
    if (candidates.length === 0) return [];
    const scores = await mapWithConcurrency(candidates, this.concurrency, async (c) => {
      const prompt = [
        'Rate how relevant the document is to the query on a 0..10 integer scale.',
        'Respond with a single JSON object: {"score": <int>}.',
        `Query: ${query}`,
        `Document: ${c.document.content.slice(0, 2000)}`,
      ].join('\n');
      const raw = await this.generate(prompt);
      const match = /\{[^}]*"score"\s*:\s*(\d+(?:\.\d+)?)/i.exec(raw);
      const s = match ? Number(match[1]) : 0;
      return { document: c.document, score: Math.max(0, Math.min(10, s)) / 10 };
    });
    return scores.sort((a, b) => b.score - a.score).slice(0, topK ?? scores.length);
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}
