/**
 * @personaforge/knowledge — DbKnowledgeEngine.
 *
 * A KnowledgeEngine variant that persists documents in AgentDb (agent_knowledge table).
 * On first use it loads the stored corpus into the in-memory vector index,
 * so the knowledge survives process restarts.
 *
 * Vector search is still done in-memory via cosine similarity (same as the base
 * KnowledgeEngine). Embeddings are recomputed from stored text when the process
 * restarts — this is fine for corpora up to ~10 000 documents.
 *
 * Usage:
 * ```ts
 * import { SqliteAgentDb } from '../db/index.js';
 * import { DbKnowledgeEngine } from './index.js';
 *
 * const db     = new SqliteAgentDb({ path: './agent.db' });
 * const engine = new DbKnowledgeEngine({ db });
 * await engine.addDocuments([{ content: 'The sky is blue.', metadata: {} }]);
 * const ctx = await engine.buildContext('What colour is the sky?');
 * ```
 */

import type { AgentDb } from '../db/index.js';
import type { Document, VectorStore, EmbeddingFn, SearchResult, RAGEngine, RAGQueryOptions, RAGQueryResult } from './types.js';
import { KnowledgeEngine, type KnowledgeEngineOptions } from './knowledge-engine.js';

export interface DbKnowledgeEngineOptions extends KnowledgeEngineOptions {
  /** AgentDb instance — required. */
  db: AgentDb;
  /**
   * Namespace / tag for grouping knowledge items in the DB.
   * Useful when one database stores knowledge for multiple agents.
   * Defaults to `'default'`.
   */
  linkedTo?: string;
}

/**
 * DbKnowledgeEngine — KnowledgeEngine with AgentDb persistence.
 */
export class DbKnowledgeEngine implements RAGEngine {
  private readonly db: AgentDb;
  private readonly linkedTo: string;
  private readonly engine: KnowledgeEngine;
  private _loaded = false;

  constructor(opts: DbKnowledgeEngineOptions) {
    this.db       = opts.db;
    this.linkedTo = opts.linkedTo ?? 'default';
    // Build inner engine with same store/embed/topK options (minus db)
    const { db: _db, linkedTo: _lt, ...engineOpts } = opts;
    void _db; void _lt;
    this.engine = new KnowledgeEngine(engineOpts);
  }

  /**
   * Add documents — persists to DB + indexes in memory.
   */
  async addDocuments(docs: Document[]): Promise<void> {
    await this._ensureLoaded();
    // Assign IDs where missing
    const stamped = docs.map(d => ({ ...d, id: d.id || crypto.randomUUID() }));

    // Add to in-memory index
    await this.engine.addDocuments(stamped);

    // Persist to DB
    await this.db.init();
    for (const doc of stamped) {
      await this.db.upsertKnowledge({
        id:       doc.id,
        content:  typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content),
        linkedTo: this.linkedTo,
        status:   'ready',
        metadata: doc.metadata,
      });
    }
  }

  /**
   * Build RAG context string — loads corpus on first call, then uses in-memory search.
   */
  async buildContext(query: string, topK?: number): Promise<string> {
    await this._ensureLoaded();
    return this.engine.buildContext(query, topK);
  }

  async retrieve(query: string, options?: RAGQueryOptions): Promise<RAGQueryResult> {
    await this._ensureLoaded();
    const k = options?.limit ?? 5;
    const ctx = await this.engine.buildContext(query, k);
    const lines = ctx.split('\n\n').filter(Boolean);
    return {
      query,
      chunks: lines.map((c, i) => ({ id: String(i), content: c, score: 1 - i * 0.1 })),
      totalRetrieved: lines.length,
    };
  }

  /** Expose the underlying KnowledgeEngine for advanced use. */
  get inner(): KnowledgeEngine { return this.engine; }

  // ── Lazy load from DB ────────────────────────────────────────────────────────

  private async _ensureLoaded(): Promise<void> {
    if (this._loaded) return;
    this._loaded = true; // set early to avoid parallel loads
    await this.db.init();
    const [rows] = await this.db.getKnowledgeItems({ linkedTo: this.linkedTo, limit: 10_000 });
    if (rows.length === 0) return;

    const docs: Document[] = rows
      .filter(r => r.content != null)
      .map(r => ({
        id:       r.id,
        content:  r.content ?? '',
        metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : {},
      }));

    if (docs.length > 0) {
      await this.engine.addDocuments(docs);
    }
  }
}

/** Convenience factory. */
export function createDbKnowledgeEngine(opts: DbKnowledgeEngineOptions): DbKnowledgeEngine {
  return new DbKnowledgeEngine(opts);
}

// ── DbVectorStore ─────────────────────────────────────────────────────────────
// A VectorStore adapter that keeps embeddings in memory but persists docs to AgentDb.

interface StoredEntry {
  doc: Document;
  embedding: number[];
}

export class DbVectorStore implements VectorStore {
  private readonly db: AgentDb;
  private readonly embed: EmbeddingFn;
  private readonly linkedTo: string;
  private readonly _entries: StoredEntry[] = [];
  private _loaded = false;

  constructor(db: AgentDb, embed: EmbeddingFn, linkedTo = 'default') {
    this.db       = db;
    this.embed    = embed;
    this.linkedTo = linkedTo;
  }

  async add(documents: Document[]): Promise<void> {
    await this._ensureLoaded();
    const embeddings = await Promise.all(documents.map(d => this.embed(d.content)));
    for (let i = 0; i < documents.length; i++) {
      const doc       = documents[i];
      const embedding = embeddings[i];
      if (!doc || !embedding) continue;
      this._entries.push({ doc, embedding });
      await this.db.upsertKnowledge({
        id:       doc.id,
        content:  doc.content,
        linkedTo: this.linkedTo,
        status:   'ready',
        metadata: doc.metadata,
      });
    }
  }

  async search(query: string, topK: number): Promise<SearchResult[]> {
    await this._ensureLoaded();
    const qEmbed = await this.embed(query);
    return this._entries
      .map(e => ({ document: e.doc, score: cosineSim(qEmbed, e.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private async _ensureLoaded(): Promise<void> {
    if (this._loaded) return;
    this._loaded = true;
    await this.db.init();
    const [rows] = await this.db.getKnowledgeItems({ linkedTo: this.linkedTo, limit: 10_000 });
    const docs = rows.filter(r => r.content != null).map(r => ({
      id:       r.id,
      content:  r.content ?? '',
      metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : {},
    }));
    if (docs.length > 0) {
      const embeddings = await Promise.all(docs.map(d => this.embed(d.content)));
      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i]; const emb = embeddings[i];
        if (doc && emb) this._entries.push({ doc, embedding: emb });
      }
    }
  }
}

// ── cosine similarity (same as knowledge-engine.ts, kept local to avoid coupling) ──

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}
function mag(v: number[]): number { return Math.sqrt(v.reduce((s, x) => s + x * x, 0)); }
function cosineSim(a: number[], b: number[]): number {
  const ma = mag(a); const mb = mag(b);
  return ma === 0 || mb === 0 ? 0 : dot(a, b) / (ma * mb);
}
