import { describe, it, expect } from 'vitest';
import {
  RecursiveCharacterSplitter,
  MarkdownSplitter,
  BM25Index,
  HybridRetriever,
  rrfFuse,
  LLMReranker,
  MultiQueryRetriever,
  ContextualCompressionRetriever,
  LLMCompressor,
  ParentDocumentRetriever,
  SelfQueryRetriever,
  TimeWeightedRetriever,
} from '../src/knowledge/index.js';
import type { Document, SearchResult, VectorStore } from '../src/knowledge/index.js';

// ── helpers ───────────────────────────────────────────────────────────────────
const doc = (id: string, content: string, meta: Record<string, unknown> = {}): Document => ({
  id, content, metadata: meta,
});

function fakeVectorStore(docs: Document[]): VectorStore {
  return {
    async add() {},
    async search(query: string, topK: number): Promise<SearchResult[]> {
      return docs
        .map((d) => ({ document: d, score: query.split(' ').filter((w) => d.content.includes(w)).length / query.split(' ').length }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    },
  };
}

// ── RecursiveCharacterSplitter ────────────────────────────────────────────────
describe('RecursiveCharacterSplitter', () => {
  it('splits long text into overlapping chunks', () => {
    const s = new RecursiveCharacterSplitter({ chunkSize: 50, chunkOverlap: 10 });
    const text = 'word '.repeat(40); // 200 chars
    const chunks = s.splitText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length <= 60)).toBe(true); // allow minor overshoot from join
    expect(chunks[0]!.chunkIndex).toBe(0);
  });
  it('returns single chunk for short text', () => {
    const s = new RecursiveCharacterSplitter({ chunkSize: 500 });
    const chunks = s.splitText('Hello world.');
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.content).toBe('Hello world.');
  });
  it('splitDocuments preserves metadata', () => {
    const s = new RecursiveCharacterSplitter({ chunkSize: 20, chunkOverlap: 0 });
    const chunks = s.splitDocuments([{ content: 'a '.repeat(30), metadata: { src: 'x' } }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.metadata.src).toBe('x');
  });
});

// ── MarkdownSplitter ──────────────────────────────────────────────────────────
describe('MarkdownSplitter', () => {
  it('splits on headings and keeps heading as context', () => {
    const md = '# Intro\nHello world.\n## Details\n' + 'detail '.repeat(200);
    const s = new MarkdownSplitter({ chunkSize: 100, chunkOverlap: 20 });
    const chunks = s.splitText(md);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.content).toContain('# Intro');
    const detailChunks = chunks.filter((c) => String(c.metadata.heading).includes('Details'));
    expect(detailChunks.length).toBeGreaterThan(0);
    expect(detailChunks[0]!.content).toContain('## Details');
  });
});

// ── BM25 ──────────────────────────────────────────────────────────────────────
describe('BM25Index', () => {
  it('returns keyword-matched results ranked by BM25 score', () => {
    const idx = new BM25Index();
    idx.add([
      doc('1', 'the quick brown fox jumped over the lazy dog'),
      doc('2', 'machine learning is transforming AI research'),
      doc('3', 'the brown dog ran fast across the brown field'),
    ]);
    const results = idx.search('brown dog', 2);
    expect(results.length).toBe(2);
    // Both docs containing 'brown' and 'dog' appear first
    const ids = results.map((r) => r.document.id);
    expect(ids).toContain('1');
    expect(ids).toContain('3');
  });
  it('returns empty for unrelated query', () => {
    const idx = new BM25Index();
    idx.add([doc('1', 'hello world')]);
    expect(idx.search('foobar', 5).length).toBe(0);
  });
});

// ── rrfFuse ───────────────────────────────────────────────────────────────────
describe('rrfFuse', () => {
  it('fuses two ranked lists, preferring docs that appear in both', () => {
    const list1: SearchResult[] = [
      { document: doc('a', 'A'), score: 0.9 },
      { document: doc('b', 'B'), score: 0.7 },
    ];
    const list2: SearchResult[] = [
      { document: doc('b', 'B'), score: 0.8 },
      { document: doc('c', 'C'), score: 0.6 },
    ];
    const fused = rrfFuse([list1, list2]);
    expect(fused[0]!.document.id).toBe('b'); // appears in both lists
  });
});

// ── HybridRetriever ───────────────────────────────────────────────────────────
describe('HybridRetriever', () => {
  it('fuses dense and sparse results', async () => {
    const docs = [doc('1', 'password reset link'), doc('2', 'machine learning'), doc('3', 'reset your password')];
    const bm25 = new BM25Index();
    bm25.add(docs);
    const dense = fakeVectorStore(docs);
    const hybrid = new HybridRetriever({ dense, sparse: bm25, candidateK: 10 });
    const results = await hybrid.search('reset password', 2);
    expect(results.length).toBe(2);
    const ids = results.map((r) => r.document.id);
    expect(ids).toContain('1');
    expect(ids).toContain('3');
  });
});

// ── LLMReranker ───────────────────────────────────────────────────────────────
describe('LLMReranker', () => {
  it('re-scores candidates via generate fn', async () => {
    const reranker = new LLMReranker({
      generate: async () => '{"score": 8}',
      concurrency: 2,
    });
    const candidates: SearchResult[] = [
      { document: doc('a', 'relevant text'), score: 0.5 },
      { document: doc('b', 'irrelevant'), score: 0.9 },
    ];
    const reranked = await reranker.rerank('query', candidates, 2);
    expect(reranked.length).toBe(2);
    expect(reranked[0]!.score).toBe(0.8); // 8/10
  });
});

// ── MultiQueryRetriever ───────────────────────────────────────────────────────
describe('MultiQueryRetriever', () => {
  it('expands query and deduplicates', async () => {
    const base = fakeVectorStore([doc('1', 'alpha beta'), doc('2', 'gamma delta')]);
    const retriever = new MultiQueryRetriever({
      base,
      generate: async () => 'alpha query\nbeta query',
      queryCount: 2,
    });
    const results = await retriever.search('alpha', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const ids = new Set(results.map((r) => r.document.id));
    expect(ids.size).toBe(results.length); // no dupes
  });
});

// ── ContextualCompressionRetriever ────────────────────────────────────────────
describe('ContextualCompressionRetriever', () => {
  it('compresses and filters empty results', async () => {
    const base = fakeVectorStore([doc('1', 'relevant stuff'), doc('2', 'noise')]);
    const compressor = new LLMCompressor(async (prompt: string) =>
      prompt.includes('noise') ? '' : 'compressed content',
    );
    const retriever = new ContextualCompressionRetriever({ base, compressor });
    const results = await retriever.search('query', 5);
    for (const r of results) {
      expect(r.document.content).not.toBe('');
    }
  });
});

// ── ParentDocumentRetriever ───────────────────────────────────────────────────
describe('ParentDocumentRetriever', () => {
  it('returns parent documents even though children were matched', async () => {
    const childStore = fakeVectorStore([]);
    const storedChildren: Document[] = [];
    childStore.add = async (docs: Document[]) => { storedChildren.push(...docs); };
    childStore.search = async (query: string, topK: number) =>
      storedChildren
        .filter((d) => d.content.includes(query.split(' ')[0] ?? ''))
        .slice(0, topK)
        .map((d) => ({ document: d, score: 0.9 }));

    const retriever = new ParentDocumentRetriever({ childStore });
    const parent = doc('p1', 'full parent document with many words about alpha and beta');
    await retriever.addDocuments([parent], (d) => [
      doc('c1', 'alpha section', { _parentId: d.id }),
      doc('c2', 'beta section', { _parentId: d.id }),
    ]);
    const results = await retriever.search('alpha', 5);
    expect(results.length).toBe(1);
    expect(results[0]!.document.id).toBe('p1');
    expect(results[0]!.document.content).toContain('full parent');
  });
});

// ── TimeWeightedRetriever ─────────────────────────────────────────────────────
describe('TimeWeightedRetriever', () => {
  it('decays older documents', async () => {
    const now = 1_000_000_000_000;
    const docs = [
      doc('old', 'some content', { createdAt: now - 72 * 3_600_000 }), // 72h old
      doc('new', 'some content', { createdAt: now - 1 * 3_600_000 }),  // 1h old
    ];
    const base = fakeVectorStore(docs);
    // give both equal retrieval score
    base.search = async (_q: string, topK: number) =>
      docs.map((d) => ({ document: d, score: 0.8 })).slice(0, topK);

    const retriever = new TimeWeightedRetriever({
      base,
      decayFactor: 0.95,
      now: () => now,
    });
    const results = await retriever.search('query', 2);
    expect(results.length).toBe(2);
    expect(results[0]!.document.id).toBe('new'); // newer doc scored higher after decay
  });
});
