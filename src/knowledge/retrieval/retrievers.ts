/**
 * @confused-ai/knowledge — retriever primitives.
 *
 * Each retriever implements the `Retriever` interface so they compose
 * (chain them, pass one as the `base` of another).
 *
 * Patterns:
 *   MultiQueryRetriever        — LLM generates N query variants, union dedup
 *   ContextualCompressionRetriever — post-filters or compresses each chunk
 *   ParentDocumentRetriever    — stores small chunks but returns the parent
 *   SelfQueryRetriever         — LLM extracts metadata filters from the query
 *   TimeWeightedRetriever      — decay older documents by a tunable half-life
 */

import type { SearchResult, Document, VectorStore } from '../types.js';

/** Any object that can search given a query and topK. */
export interface Retriever {
  search(query: string, topK: number): Promise<SearchResult[]>;
}

// ── MultiQueryRetriever ───────────────────────────────────────────────────────

/**
 * MultiQueryRetriever — ask an LLM to generate N alternative queries,
 * run each through the base retriever, then union + dedup by doc ID.
 */
export class MultiQueryRetriever implements Retriever {
  private readonly base: Retriever;
  private readonly generate: (prompt: string) => Promise<string>;
  private readonly queryCount: number;

  constructor(opts: { base: Retriever; generate: (prompt: string) => Promise<string>; queryCount?: number }) {
    this.base = opts.base;
    this.generate = opts.generate;
    this.queryCount = opts.queryCount ?? 3;
  }

  async search(query: string, topK: number): Promise<SearchResult[]> {
    const alts = await this.expand(query);
    const all = await Promise.all([query, ...alts].map((q) => this.base.search(q, topK)));
    const seen = new Map<string, SearchResult>();
    for (const list of all) {
      for (const hit of list) {
        const existing = seen.get(hit.document.id);
        if (!existing || hit.score > existing.score) seen.set(hit.document.id, hit);
      }
    }
    return Array.from(seen.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private async expand(query: string): Promise<string[]> {
    const prompt = [
      `Generate ${String(this.queryCount)} alternative versions of the following search query.`,
      `Each version should capture a different angle of the same intent.`,
      `Return only the queries, one per line, with no numbering or extra text.`,
      `Query: ${query}`,
    ].join('\n');
    const raw = await this.generate(prompt);
    return raw.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, this.queryCount);
  }
}

// ── ContextualCompressionRetriever ────────────────────────────────────────────

/** Compressor — extracts only the relevant sentences from a document chunk. */
export interface DocumentCompressor {
  compress(query: string, content: string): Promise<string>;
}

/**
 * LLMCompressor — uses any LLM to extract the portion of a chunk that is
 * actually relevant to the query.
 */
export class LLMCompressor implements DocumentCompressor {
  private readonly generate: (prompt: string) => Promise<string>;
  constructor(generate: (prompt: string) => Promise<string>) { this.generate = generate; }
  async compress(query: string, content: string): Promise<string> {
    const prompt = [
      'Given the following query and document excerpt, extract only the sentences that are directly relevant to the query.',
      'If nothing is relevant, respond with an empty string. Do not add commentary.',
      `Query: ${query}`,
      `Document:\n${content}`,
    ].join('\n');
    return (await this.generate(prompt)).trim();
  }
}

/**
 * ContextualCompressionRetriever — wraps a base retriever. Passes each result
 * through a compressor; filters out empty results.
 */
export class ContextualCompressionRetriever implements Retriever {
  private readonly base: Retriever;
  private readonly compressor: DocumentCompressor;
  constructor(opts: { base: Retriever; compressor: DocumentCompressor }) {
    this.base = opts.base;
    this.compressor = opts.compressor;
  }
  async search(query: string, topK: number): Promise<SearchResult[]> {
    // Fetch more than topK since some chunks may compress to empty.
    const candidates = await this.base.search(query, topK * 2);
    const compressed = await Promise.all(
      candidates.map(async (hit) => {
        const content = await this.compressor.compress(query, hit.document.content);
        if (!content) return null;
        return { document: { ...hit.document, content }, score: hit.score } as SearchResult;
      }),
    );
    return compressed.filter((r): r is SearchResult => r !== null).slice(0, topK);
  }
}

// ── ParentDocumentRetriever ──────────────────────────────────────────────────

/**
 * ParentDocumentRetriever — stores small child chunks for precise retrieval
 * but returns the full parent document for richer LLM context.
 */
export class ParentDocumentRetriever implements Retriever {
  private readonly childStore: VectorStore;
  private readonly parents: Map<string, Document>;

  constructor(opts: { childStore: VectorStore }) {
    this.childStore = opts.childStore;
    this.parents = new Map();
  }

  /** Ingest parent docs: split into children, store children, keep parent map. */
  async addDocuments(
    parents: Document[],
    split: (doc: Document) => Document[],
  ): Promise<void> {
    const children: Document[] = [];
    for (const parent of parents) {
      this.parents.set(parent.id, parent);
      const subs = split(parent);
      for (const sub of subs) {
        children.push({ ...sub, metadata: { ...sub.metadata, _parentId: parent.id } });
      }
    }
    await this.childStore.add(children);
  }

  async search(query: string, topK: number): Promise<SearchResult[]> {
    const childHits = await this.childStore.search(query, topK * 3);
    const seen = new Map<string, SearchResult>();
    for (const hit of childHits) {
      const pid = hit.document.metadata._parentId as string | undefined;
      if (!pid) continue;
      const parent = this.parents.get(pid);
      if (!parent) continue;
      if (!seen.has(pid) || hit.score > (seen.get(pid)!.score)) {
        seen.set(pid, { document: parent, score: hit.score });
      }
    }
    return Array.from(seen.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

// ── SelfQueryRetriever ───────────────────────────────────────────────────────

/**
 * SelfQueryRetriever — uses an LLM to parse a user query into a semantic part
 * plus metadata filters, then applies both.
 */
export class SelfQueryRetriever implements Retriever {
  private readonly base: Retriever;
  private readonly generate: (prompt: string) => Promise<string>;
  private readonly fieldDescriptions: Record<string, string>;

  constructor(opts: {
    base: Retriever;
    generate: (prompt: string) => Promise<string>;
    /** Map of metadata field names to human descriptions, e.g. { author: 'Name of the author' }. */
    fieldDescriptions: Record<string, string>;
  }) {
    this.base = opts.base;
    this.generate = opts.generate;
    this.fieldDescriptions = opts.fieldDescriptions;
  }

  async search(query: string, topK: number): Promise<SearchResult[]> {
    const parsed = await this.parse(query);
    const hits = await this.base.search(parsed.semanticQuery || query, topK * 2);
    if (Object.keys(parsed.filters).length === 0) return hits.slice(0, topK);
    return hits
      .filter((hit) => matchesFilters(hit.document.metadata, parsed.filters))
      .slice(0, topK);
  }

  private async parse(query: string): Promise<{ semanticQuery: string; filters: Record<string, unknown> }> {
    const fields = Object.entries(this.fieldDescriptions)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');
    const prompt = [
      'Extract a semantic search query and metadata filters from the user query.',
      `Available metadata fields:\n${fields}`,
      'Respond with JSON: {"semanticQuery": "...", "filters": {"field": "value"}}.',
      'If no filters apply, return an empty filters object.',
      `User query: ${query}`,
    ].join('\n');
    const raw = await this.generate(prompt);
    try {
      const match = /\{[\s\S]*\}/.exec(raw);
      return JSON.parse(match?.[0] ?? '{}') as { semanticQuery: string; filters: Record<string, unknown> };
    } catch {
      return { semanticQuery: query, filters: {} };
    }
  }
}

function matchesFilters(meta: Record<string, unknown>, filters: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(filters)) {
    if (meta[k] !== v) return false;
  }
  return true;
}

// ── TimeWeightedRetriever ────────────────────────────────────────────────────

/**
 * TimeWeightedRetriever — decays relevance of older documents so recent info
 * is preferred. Score = similarity × decayFactor^(age in hours).
 */
export class TimeWeightedRetriever implements Retriever {
  private readonly base: Retriever;
  private readonly decayFactor: number;
  private readonly now: () => number;

  constructor(opts: {
    base: Retriever;
    /** Per-hour decay multiplier. Default 0.99. Set closer to 1 for slower decay. */
    decayFactor?: number;
    /** Clock override for testing. */
    now?: () => number;
  }) {
    this.base = opts.base;
    this.decayFactor = opts.decayFactor ?? 0.99;
    this.now = opts.now ?? (() => Date.now());
  }

  async search(query: string, topK: number): Promise<SearchResult[]> {
    const hits = await this.base.search(query, topK * 2);
    const now = this.now();
    return hits
      .map((hit) => {
        const created = typeof hit.document.metadata.createdAt === 'number' ? hit.document.metadata.createdAt : now;
        const hoursOld = Math.max(0, (now - created) / 3_600_000);
        const decayed = hit.score * Math.pow(this.decayFactor, hoursOld);
        return { document: hit.document, score: decayed };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
