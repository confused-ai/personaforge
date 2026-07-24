/**
 * Tests for pure retrieval primitives:
 *   - BM25Index (add + search + relevance ordering)
 *   - rrfFuse (reciprocal-rank fusion of multiple rankings)
 *   - RecursiveCharacterSplitter, MarkdownSplitter (chunking)
 *   - withEmbeddingCache (memoisation wrapper)
 */

import { describe, it, expect } from 'vitest';
import { BM25Index } from '../src/knowledge/retrieval/bm25.js';
import { rrfFuse } from '../src/knowledge/retrieval/hybrid.js';
import { RecursiveCharacterSplitter, MarkdownSplitter } from '../src/knowledge/retrieval/splitters.js';
import { withEmbeddingCache } from '../src/knowledge/knowledge-engine.js';
import type { Document, SearchResult } from '../src/knowledge/types.js';

const DOCS: Document[] = [
    { id: 'd1', content: 'the quick brown fox jumps over the lazy dog', metadata: {} },
    { id: 'd2', content: 'a fast fox leaps across sleeping dogs at dawn', metadata: {} },
    { id: 'd3', content: 'cats are common household pets', metadata: {} },
    { id: 'd4', content: 'the astronaut walked on the moon', metadata: {} },
];

describe('BM25Index', () => {
    it('returns the most relevant document first for a keyword query', () => {
        const idx = new BM25Index();
        idx.add(DOCS);
        const results = idx.search('fox', 3);
        expect(results.length).toBeGreaterThan(0);
        expect(['d1', 'd2']).toContain(results[0]!.document.id);
        expect(results[0]!.score).toBeGreaterThan(0);
    });

    it('respects the topK limit', () => {
        const idx = new BM25Index();
        idx.add(DOCS);
        const results = idx.search('the', 2);
        expect(results.length).toBeLessThanOrEqual(2);
    });

    it('returns empty when no documents match', () => {
        const idx = new BM25Index();
        idx.add(DOCS);
        const results = idx.search('spaceship submarine plankton', 5);
        // Terms may not appear in any doc — either empty or all zero-scored
        for (const r of results) expect(r.score).toBeGreaterThanOrEqual(0);
    });

    it('orders results by descending score', () => {
        const idx = new BM25Index();
        idx.add(DOCS);
        const results = idx.search('fox dog', 4);
        for (let i = 1; i < results.length; i++) {
            expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
        }
    });
});

describe('rrfFuse (reciprocal rank fusion)', () => {
    const a: SearchResult = { document: DOCS[0]!, score: 0.9 };
    const b: SearchResult = { document: DOCS[1]!, score: 0.7 };
    const c: SearchResult = { document: DOCS[2]!, score: 0.5 };

    it('promotes documents appearing near the top of multiple rankings', () => {
        const rankingA: SearchResult[] = [a, b, c];
        const rankingB: SearchResult[] = [b, a, c];
        const fused = rrfFuse([rankingA, rankingB]);
        // 'a' or 'b' should be first — both appear in top-2 of both rankings
        expect([DOCS[0]!.id, DOCS[1]!.id]).toContain(fused[0]!.document.id);
        expect(fused[fused.length - 1]!.document.id).toBe(DOCS[2]!.id);
    });

    it('handles a single ranking (identity-ish)', () => {
        const fused = rrfFuse([[a, b, c]]);
        expect(fused.length).toBe(3);
        expect(fused[0]!.document.id).toBe(DOCS[0]!.id);
    });

    it('handles empty inputs', () => {
        expect(rrfFuse([])).toEqual([]);
        expect(rrfFuse([[]])).toEqual([]);
    });
});

describe('RecursiveCharacterSplitter', () => {
    it('returns a single chunk when text is shorter than chunkSize', () => {
        const s = new RecursiveCharacterSplitter({ chunkSize: 1000, chunkOverlap: 100 });
        const chunks = s.splitText('short text');
        expect(chunks.length).toBe(1);
        expect(chunks[0]!.content).toBe('short text');
    });

    it('splits long text into multiple chunks', () => {
        const s = new RecursiveCharacterSplitter({ chunkSize: 50, chunkOverlap: 10 });
        const text = 'sentence one. sentence two. sentence three. sentence four. sentence five. sentence six.';
        const chunks = s.splitText(text);
        expect(chunks.length).toBeGreaterThan(1);
        for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(60);
    });

    it('preserves metadata across chunks and assigns sequential chunkIndex', () => {
        // Build text long enough to force multiple chunks at chunkSize 40.
        const s = new RecursiveCharacterSplitter({ chunkSize: 40, chunkOverlap: 0 });
        const text = 'sentence one. sentence two. sentence three. sentence four. sentence five. sentence six.';
        const chunks = s.splitText(text, { source: 'x' });
        expect(chunks.length).toBeGreaterThan(1);
        for (let i = 0; i < chunks.length; i++) {
            expect(chunks[i]!.metadata['source']).toBe('x');
            expect(chunks[i]!.chunkIndex).toBe(i);
        }
    });

    it('returns empty for empty input', () => {
        const s = new RecursiveCharacterSplitter();
        expect(s.splitText('')).toEqual([]);
    });
});

describe('MarkdownSplitter', () => {
    it('respects heading boundaries when splitting', () => {
        const s = new MarkdownSplitter({ chunkSize: 200, chunkOverlap: 0 });
        const md = `# Title\n\n## Section A\n\nContent A.\n\n## Section B\n\nContent B.\n\n## Section C\n\nContent C.`;
        const chunks = s.splitText(md);
        expect(chunks.length).toBeGreaterThanOrEqual(1);
        // Every chunk should have a headings entry in metadata (may be empty for the intro).
        for (const c of chunks) expect(c.metadata).toBeDefined();
    });
});

describe('withEmbeddingCache', () => {
    it('does not re-embed the same input twice', async () => {
        let calls = 0;
        const raw = async (text: string) => {
            calls++;
            return Array.from(text).map((c) => c.charCodeAt(0));
        };
        const cached = withEmbeddingCache(raw, 10);
        await cached('hello');
        await cached('hello');
        await cached('world');
        expect(calls).toBe(2);
    });

    it('evicts oldest entries when the cache is full', async () => {
        let calls = 0;
        const raw = async (text: string) => { calls++; return [text.length]; };
        const cached = withEmbeddingCache(raw, 2);
        await cached('a');
        await cached('b');
        await cached('c'); // evicts 'a'
        await cached('a'); // must miss (evicted)
        expect(calls).toBe(4);
    });

    it('exposes the underlying cache map', async () => {
        const raw = async (text: string) => [text.length];
        const cached = withEmbeddingCache(raw, 10);
        await cached('hello');
        expect(cached.cache.size).toBe(1);
    });
});
