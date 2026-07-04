---
title: Retrieval Augmented Generation
description: Index documents, retrieve relevant context, and ground agent answers with KnowledgeEngine — built-in vector stores, PDF/CSV/URL loaders, and pluggable backends (Pinecone, Qdrant, pgvector, Neo4j, Chroma).
outline: [2, 3]
---

# Retrieval Augmented Generation

The knowledge layer lets you ingest documents, embed them into a vector store, and attach them to an agent so answers are grounded in your content rather than model guesswork.

```ts
import {
  KnowledgeEngine,
  createKnowledgeEngine,
  InMemoryVectorStore,   // built-in, good for <10 000 docs
  loadPdf, loadCsv, loadUrl,
} from 'confused-ai';
```

---

## Quick start

```ts
import { createAgent } from 'confused-ai';
import { createKnowledgeEngine, loadUrl } from 'confused-ai';
import { OpenAIEmbeddingProvider } from 'confused-ai';

// 1. Build the engine — `embed` is an EmbeddingFn: (text) => Promise<number[]>
const embedder = new OpenAIEmbeddingProvider({ apiKey: process.env.OPENAI_API_KEY! });
const kb = createKnowledgeEngine({
  embed: (text) => embedder.embed(text),
  // default: InMemoryVectorStore (cosine similarity)
});

// 2. Ingest documents
const docs = await loadUrl('https://docs.example.com/api-reference', { recursive: true, maxPages: 20 });
await kb.addDocuments(docs);

// 3. Attach to agent
const agent = createAgent({
  name: 'docs-assistant',
  instructions: 'Answer questions about our product using the provided documentation.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  knowledgebase: kb,
  addKnowledgeToContext: true,   // automatically prepends retrieved chunks to system prompt (default: true when a knowledgebase is set)
});

const result = await agent.run('How do I authenticate API requests?');
console.log(result.text);
```

---

## Document loaders

### Load from URL

```ts
import { loadUrl } from 'confused-ai';

const docs = await loadUrl('https://example.com/docs', {
  recursive: true,
  maxPages: 50,
  selector: 'main',  // CSS selector to extract content from
});
```

### Load PDF

```ts
import { loadPdf } from 'confused-ai';

const docs = await loadPdf('./data/handbook.pdf', {
  splitByPage: true,  // one Document per page
  metadata: { source: 'handbook', version: '2.1' },
});
```

### Load CSV

```ts
import { loadCsv } from 'confused-ai';

const docs = await loadCsv('./data/products.csv', {
  contentColumn: 'description',   // column to use as document content
  metadataColumns: ['sku', 'category', 'price'],
});
```

### Manual documents

```ts
import type { Document } from 'confused-ai';

const docs: Document[] = [
  {
    id: crypto.randomUUID(),
    content: 'The refund policy allows returns within 30 days of purchase.',
    metadata: { source: 'policy', section: 'refunds' },
  },
];
await kb.addDocuments(docs);
```

---

## Vector store backends

### InMemoryVectorStore (default)

Good for development and up to ~10 000 documents. Data is lost on process restart.

```ts
const embedder = new OpenAIEmbeddingProvider({ apiKey: '...' });
const kb = createKnowledgeEngine({
  embed: (text) => embedder.embed(text),
  // InMemoryVectorStore is the default; no extra config needed
});
```

### PgvectorKnowledgeAdapter

Production-ready vector search backed by PostgreSQL + pgvector:

```ts
import { PgvectorKnowledgeAdapter, createKnowledgeEngine } from 'confused-ai';

const adapter = new PgvectorKnowledgeAdapter({
  connectionString: process.env.DATABASE_URL!,
  tableName: 'knowledge_embeddings',
  dimensions: 1536,  // match your embedding model
});

const kb = createKnowledgeEngine({ embed: myEmbed, store: adapter });
```

### ChromaKnowledgeAdapter

```ts
import { ChromaKnowledgeAdapter } from 'confused-ai';

const adapter = new ChromaKnowledgeAdapter({
  url: 'http://localhost:8000',
  collectionName: 'my-docs',
  embed: myEmbed,   // EmbeddingFn used to embed docs and queries
});
```

### Neo4jKnowledgeAdapter — graph RAG

```ts
import { Neo4jKnowledgeAdapter } from 'confused-ai';

const adapter = new Neo4jKnowledgeAdapter({
  uri: process.env.NEO4J_URI!,
  username: process.env.NEO4J_USER!,
  password: process.env.NEO4J_PASSWORD!,
  database: 'docs',
});
```

### DbKnowledgeEngine — zero infra (SQLite-backed)

```ts
import { createDbKnowledgeEngine } from 'confused-ai';
import { SqliteAgentDb } from 'confused-ai/db';

const db = new SqliteAgentDb({ path: './agent.db' });
const kb = createDbKnowledgeEngine({ db, embed: myEmbed });
```

---

## Retrieval options

```ts
// When the engine is attached to an agent via `knowledgebase`, retrieval runs
// automatically before each run. To build the retrieved context manually,
// call buildContext(query, topK?) — it returns the top-k chunks joined into a
// single string, ready to inject into a prompt.
const context = await kb.buildContext('How do I reset my password?', 5);
console.log(context);
```

---

## Embedding providers

```ts
import { OpenAIEmbeddingProvider } from 'confused-ai';

const openaiEmbed = new OpenAIEmbeddingProvider({ apiKey: '...', model: 'text-embedding-3-small' });
```

### Custom embedding function

Any `async (text: string) => number[]` works:

```ts
import type { EmbeddingFn } from 'confused-ai';

const myEmbed: EmbeddingFn = async (text) => {
  const res = await fetch('https://my-embed-service/embed', {
    method: 'POST', body: JSON.stringify({ text }),
    headers: { 'Content-Type': 'application/json' },
  });
  const { embedding } = await res.json();
  return embedding;
};
```

---

## Embedding cache

Avoid re-embedding identical text within a process. `withEmbeddingCache` wraps an
`EmbeddingFn` with an in-process LRU cache — it keeps up to `maxSize` most-recent
embeddings in memory (no external store, no TTL). The cache is cleared on restart.

```ts
import { withEmbeddingCache } from 'confused-ai';

// Second arg is the max number of cached entries (default: 500).
const cachedEmbed = withEmbeddingCache(myEmbeddingFn, 500);
```

---

## Where to go next

- [Memory](./memory) — retain facts across conversations.
- [Eval](./eval) — measure RAG quality with `RAG_CRITERIA`.
- [Example 05: RAG](../examples/05-rag) — full ingestion-to-answer example.
