---
title: Advanced Retrieval
description: Production-grade RAG — text splitters (recursive, markdown, semantic), BM25 keyword index, hybrid dense-plus-sparse retrieval via Reciprocal-Rank Fusion, rerankers (Cohere, Jina, LLM), and composable retriever primitives (multi-query, contextual compression, parent-document, self-query, time-weighted).
outline: [2, 3]
---

# Advanced Retrieval

The `confused-ai/knowledge` module ships everything needed to close the retrieval quality gap that separates a demo RAG pipeline from a production one: real chunking, dense-plus-sparse hybrid search, reranking, and composable retriever primitives.

```ts
import {
  // Chunking
  RecursiveCharacterSplitter, MarkdownSplitter, SemanticSplitter,
  // Keyword + hybrid
  BM25Index, HybridRetriever, rrfFuse,
  // Rerankers
  CohereReranker, JinaReranker, LLMReranker,
  // Retriever primitives
  MultiQueryRetriever, ContextualCompressionRetriever, LLMCompressor,
  ParentDocumentRetriever, SelfQueryRetriever, TimeWeightedRetriever,
} from 'confused-ai/knowledge';
```

Everything below is zero-dependency by default. External services (Cohere, Jina) are opt-in.

---

## Text splitters

Splitters turn a raw document into overlapping, size-bounded `Chunk`s before embedding. Chunking quality is one of the biggest levers on final answer quality.

### `RecursiveCharacterSplitter`

The default. Tries a priority list of separators (paragraph → line → sentence → word → char), recursing into any fragment still larger than `chunkSize`. Semantic boundaries are preferred.

```ts
const splitter = new RecursiveCharacterSplitter({
  chunkSize: 800,     // characters (or tokens if lengthFn supplied)
  chunkOverlap: 100,  // characters kept between adjacent chunks for context
});

const chunks = splitter.splitText(longDocument);
// [{ content: '...', metadata: {}, chunkIndex: 0 }, ...]
```

For token-accurate chunking pass a counter:

```ts
new RecursiveCharacterSplitter({
  chunkSize: 1000,
  lengthFn: (t) => Math.ceil(t.length / 4),  // rough tokens-per-char heuristic
});
```

### `MarkdownSplitter`

Cuts on Markdown headings first (each chunk keeps its heading as context), then falls back to recursive splitting inside oversized sections.

```ts
const chunks = new MarkdownSplitter({ chunkSize: 1200 }).splitText(readme);
// Each chunk's metadata.heading is the enclosing section heading.
```

### `SemanticSplitter`

Groups adjacent sentences while their embedding stays similar, and cuts a new chunk when the cosine similarity drops below `breakThreshold`. Requires an embedding function; use it when your source is prose without heading structure.

```ts
const splitter = new SemanticSplitter({
  embed: (text) => embedder.embed(text),
  breakThreshold: 0.5,  // lower = more permissive grouping
  maxChars: 2000,       // hard cap so a semantic run cannot overflow the context window
});
const chunks = await splitter.splitTextAsync(article);
```

---

## Keyword retrieval: `BM25Index`

Vector cosine similarity does not always find exact-term matches (order IDs, error codes, product names). `BM25Index` is a zero-dependency Okapi BM25 keyword index that complements dense retrieval.

```ts
const bm25 = new BM25Index();
bm25.add(documents);

const hits = bm25.search('reset password link', 10);
// SearchResult[] normalised to 0..1 for comparability with cosine scores
```

Deliberately in-memory. For >100k documents pair with Elasticsearch or Meilisearch through the same `SearchResult` interface.

---

## Hybrid retrieval (dense + sparse) with RRF

Dense scores and BM25 scores live on different scales, so score-level averaging is unreliable. `HybridRetriever` fuses **rankings**, not scores, using Reciprocal-Rank Fusion:

$$
\text{score}(d) = \sum_{i} \frac{1}{k + \text{rank}_i(d)}
$$

with `k = 60` (Cormack et al. 2009) by default.

```ts
const hybrid = new HybridRetriever({
  dense: vectorStore,   // your existing VectorStore
  sparse: bm25,
  k: 60,                // RRF constant; higher = tail contributions matter more
  candidateK: 20,       // pull this many from each list before fusion
});

const results = await hybrid.search('reset password link', 10);
```

Need to fuse more than two lists (e.g. dense + BM25 + a third source)? Use `rrfFuse` directly:

```ts
const fused = rrfFuse([denseHits, bm25Hits, externalHits], 60).slice(0, 10);
```

---

## Rerankers

A reranker takes the top-N candidates from a cheap retriever and re-scores them with a cross-encoder that sees the `(query, document)` pair together. It is the single largest quality lever above vanilla cosine similarity.

### Cohere

```ts
const reranker = new CohereReranker({
  apiKey: process.env.COHERE_API_KEY,
  model: 'rerank-english-v3.0',
});
const reranked = await reranker.rerank(query, candidates, 5);
```

### Jina

```ts
const reranker = new JinaReranker({
  apiKey: process.env.JINA_API_KEY,
  model: 'jina-reranker-v2-base-multilingual',
});
```

### LLM-as-reranker

Portable to any chat model (Ollama, Anthropic, Google, OpenAI) without a dedicated rerank endpoint. Runs candidate pairs in parallel with a bounded worker pool.

```ts
const reranker = new LLMReranker({
  generate: (prompt) => llm.generate(prompt),
  concurrency: 4,
});
```

**Suggested pipeline**: retrieve 20 candidates with hybrid → rerank to top 5 → pass to the LLM.

```ts
const candidates = await hybrid.search(query, 20);
const top5 = await reranker.rerank(query, candidates, 5);
```

---

## Retriever primitives

Each primitive implements the same `Retriever` interface (`search(query, topK)`), so they compose. Wrap a base retriever in one primitive to add a capability; wrap again to stack.

### `MultiQueryRetriever`

Asks an LLM to generate `queryCount` variants of the user query, runs each through the base retriever, unions and dedupes results. Fixes recall on ambiguous or poorly-phrased queries.

```ts
const retriever = new MultiQueryRetriever({
  base: hybrid,
  generate: (prompt) => llm.generate(prompt),
  queryCount: 3,
});
```

### `ContextualCompressionRetriever`

Passes each retrieved chunk through a compressor that extracts only the sentences relevant to the query. Chunks that compress to empty are filtered out.

```ts
const retriever = new ContextualCompressionRetriever({
  base: hybrid,
  compressor: new LLMCompressor((prompt) => llm.generate(prompt)),
});
```

### `ParentDocumentRetriever`

Stores small child chunks for **precise retrieval** but returns their **full parent document** for richer LLM context. Fixes the common tradeoff between chunk granularity and answer completeness.

```ts
const retriever = new ParentDocumentRetriever({ childStore: vectorStore });

await retriever.addDocuments(parents, (parent) => {
  return splitter.splitText(parent.content).map((chunk) => ({
    id: crypto.randomUUID(),
    content: chunk.content,
    metadata: { _parentId: parent.id },
  }));
});
```

### `SelfQueryRetriever`

Uses an LLM to extract metadata filters from the user query, then applies them to the base retriever's candidates. Handles queries like *"papers by Karpathy about optimizers"*.

```ts
const retriever = new SelfQueryRetriever({
  base: hybrid,
  generate: (prompt) => llm.generate(prompt),
  fieldDescriptions: {
    author: 'Name of the paper author',
    year: 'Publication year',
    topic: 'Research topic',
  },
});
```

### `TimeWeightedRetriever`

Decays relevance of older documents. Score = base_similarity × `decayFactor^(ageInHours)`. Documents must include `metadata.createdAt` as a millisecond timestamp.

```ts
const retriever = new TimeWeightedRetriever({
  base: hybrid,
  decayFactor: 0.99,   // per-hour multiplier; closer to 1 = slower decay
});
```

---

## Composing the full pipeline

The primitives are designed to stack. A production pipeline typically looks like:

```ts
const retriever = new ContextualCompressionRetriever({
  base: new MultiQueryRetriever({
    base: new HybridRetriever({ dense: vectorStore, sparse: bm25 }),
    generate: (p) => llm.generate(p),
  }),
  compressor: new LLMCompressor((p) => llm.generate(p)),
});

// Optional rerank pass on top:
const raw = await retriever.search(query, 20);
const top5 = await reranker.rerank(query, raw, 5);
```

Each layer is optional. Start with `HybridRetriever` alone and add wrappers only when eval shows they help.

---

## Testing

Every splitter, retriever, and reranker has unit test coverage in `tests/retrieval.test.ts` (13 tests, all green). The `LLMReranker` and LLM-based primitives use injectable `generate` functions, so tests never call a real API.

---

## Related pages

- [RAG / Knowledge](/guide/rag) — the base `KnowledgeEngine` and vector stores.
- [Loaders Reference](/guide/loaders) — markdown, HTML, JSON, DOCX, sitemap, GitHub, S3.
- [Evaluation](/guide/eval) — measure retrieval quality with hit rate and MRR.
