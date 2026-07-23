---
title: Knowledge API
description: Complete reference for createKnowledgeEngine(), addDocuments(), retrieve(), buildContext(), and custom store and embedding configuration.
outline: [2, 3]
---

# Knowledge API

The knowledge layer provides retrieval-augmented generation (RAG): ingest documents into a searchable index, retrieve relevant chunks at run time, and inject them into the agent's context automatically. Attach a `KnowledgeEngine` to any agent with the `knowledgebase` option.

```ts
import { createKnowledgeEngine } from 'personaforge/knowledge';
```

---

## `createKnowledgeEngine()` — create an engine

```ts
import { createKnowledgeEngine } from 'personaforge/knowledge';

const knowledge = createKnowledgeEngine({
  topK: 3,               // retrieve up to 3 most relevant chunks per query
  maxContextChars: 1_500, // cap context injected into the system prompt
});
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `topK` | `number` | `3` | Number of chunks to retrieve per query |
| `maxContextChars` | `number` | `2000` | Maximum characters injected into the prompt |
| `store` | `VectorStore` | in-memory | Custom vector store implementation |
| `embed` | `EmbedFn` | built-in fallback | Custom embedding function |

The engine defaults to an in-memory vector store and a built-in embedding fallback, so no external service is required to get started.

---

## `addDocuments()` — ingest content

```ts
await knowledge.addDocuments([
  {
    id: 'doc-001',
    content: 'Refunds are accepted within 30 days of purchase.',
    metadata: { source: 'return-policy.md', category: 'returns' },
  },
  {
    id: 'doc-002',
    content: 'Digital downloads are non-refundable once activated.',
    metadata: { source: 'return-policy.md', category: 'returns' },
  },
]);
```

**Document shape:**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✓ | Unique document identifier |
| `content` | `string` | ✓ | The text content to embed and retrieve |
| `metadata` | `Record<string, unknown>` | — | Arbitrary metadata attached to the document |

---

## `retrieve()` — semantic search

Fetch the top-K most relevant chunks for a query string. Returns chunks with similarity scores.

```ts
const chunks = await knowledge.retrieve('Can I return software licenses?');

for (const chunk of chunks) {
  console.log(`[${chunk.score.toFixed(3)}] ${chunk.document.id}`);
  console.log(chunk.document.content.slice(0, 100));
}
```

**`retrieve()` result shape:**

```ts
interface RetrievedChunk {
  score: number;          // cosine similarity 0–1
  document: {
    id: string;
    content: string;
    metadata?: Record<string, unknown>;
  };
}
```

---

## `buildContext()` — get prompt-ready context

`buildContext()` retrieves the top-K chunks and formats them as a single string ready for prompt injection. The agent's `knowledgebase` option calls this automatically — use it directly when you want to inspect or pre-build context.

```ts
const context = await knowledge.buildContext('What is the shipping timeline?');
console.log(context);
// → "Standard shipping takes 3–5 business days. Express shipping is available..."
```

---

## Attach to an agent

Pass the engine as `knowledgebase` on any agent. The engine's context is injected into the system prompt before every run.

```ts
import { createAgent } from 'personaforge';
import { createKnowledgeEngine } from 'personaforge/knowledge';

const knowledge = createKnowledgeEngine({ topK: 3, maxContextChars: 1_500 });
await knowledge.addDocuments([...]);

const agent = createAgent({
  name: 'support-bot',
  instructions: 'Answer questions using the knowledge base. If the answer is missing, say so.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  knowledgebase: knowledge,
});
```

---

## Update and delete documents

```ts
// Update an existing document (re-embeds content)
await knowledge.updateDocument('doc-001', {
  content: 'Refunds are accepted within 60 days of purchase for Pro plan customers.',
  metadata: { source: 'return-policy-v2.md', updated: true },
});

// Delete a document
await knowledge.deleteDocument('doc-001');

// Clear all documents
await knowledge.clear();
```

---

## Custom embedding function

Bring your own embeddings — useful for switching to a specific model or using a locally-hosted service.

```ts
import OpenAI from 'openai';
import { createKnowledgeEngine, type EmbedFn } from 'personaforge/knowledge';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const embed: EmbedFn = async (texts) => {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  return response.data.map((d) => d.embedding);
};

const knowledge = createKnowledgeEngine({ topK: 5, maxContextChars: 2_000, embed });
```

---

## Custom vector store

Plug in an external vector database for production-scale retrieval.

```ts
import { createKnowledgeEngine, type VectorStore } from 'personaforge/knowledge';

// Minimal VectorStore interface
const myStore: VectorStore = {
  async upsert(documents) { /* insert into Pinecone, Qdrant, pgvector, etc. */ },
  async search(queryEmbedding, topK) {
    /* query your vector DB, return RetrievedChunk[] */
    return [];
  },
  async delete(ids) { /* remove documents */ },
  async clear() { /* drop all vectors */ },
};

const knowledge = createKnowledgeEngine({ topK: 5, store: myStore });
```

---

## Knowledge vs sessions vs memory

| Layer | Stores | Retrieved by | Best for |
|---|---|---|---|
| **Knowledge** | Documents and policies | Semantic similarity search | Reference content, product docs, FAQs |
| **Session** | Conversation turns | Chronological order | Active conversation context |
| **Memory** | Facts and preferences | Keyword or semantic recall | Per-user personalization |

---

## Where to go next

- [RAG guide](../guide/rag) — ingestion strategies, chunking, and retrieval tuning
- [05 · RAG Knowledge Base](../examples/05-rag) — runnable end-to-end retrieval example
- [Memory API](./knowledge) — user-specific fact and preference storage
