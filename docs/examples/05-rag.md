---
title: 05 · RAG Knowledge Base
description: Give agents retrieval-backed answers. Ingest documents into a KnowledgeEngine, attach it with the knowledgebase option, and let the agent answer from indexed content.
outline: [2, 3]
---

# 05 · RAG Knowledge Base

RAG (Retrieval-Augmented Generation) grounds agent answers in your documents instead of relying on the model's training data. `KnowledgeEngine` handles ingestion, embedding, and retrieval — you attach it to any agent with the `knowledgebase` option.

```ts
import { createKnowledgeEngine } from 'personaforge/knowledge';
```

---

## What you'll learn

- How to create a `KnowledgeEngine` and ingest documents
- How to attach the engine to an agent with `knowledgebase`
- How to inspect retrieved context directly
- How to ingest from files and external sources
- When to use knowledge vs sessions vs memory

---

## Basic knowledge-backed agent

```ts
import { agent } from 'personaforge';
import { createKnowledgeEngine } from 'personaforge/knowledge';

// Create the engine
const knowledge = createKnowledgeEngine({
  topK: 3,              // return up to 3 most relevant chunks
  maxContextChars: 1_500,  // cap total context size injected into the prompt
});

// Ingest documents
await knowledge.addDocuments([
  {
    id: 'refund-standard',
    content: 'Standard items can be returned within 30 days of purchase for a full refund.',
    metadata: { source: 'return-policy.md', category: 'returns' },
  },
  {
    id: 'refund-digital',
    content: 'Digital downloads and software licenses are non-refundable once activated.',
    metadata: { source: 'return-policy.md', category: 'returns' },
  },
  {
    id: 'shipping-standard',
    content: 'Standard shipping takes 3–5 business days. Express shipping is available for an additional fee.',
    metadata: { source: 'shipping-policy.md', category: 'shipping' },
  },
  {
    id: 'shipping-international',
    content: 'International orders ship via DHL and may take 7–14 business days. Customs fees are the buyer\'s responsibility.',
    metadata: { source: 'shipping-policy.md', category: 'shipping' },
  },
]);

// Attach to the agent
const supportAgent = agent({
  name: 'support-bot',
  instructions: [
    'Answer customer questions using the knowledge base.',
    'If the answer is not in the knowledge base, say so clearly.',
    'Do not make up policy details.',
  ].join(' '),
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  knowledgebase: knowledge,
  tools: [],
});

// The agent automatically retrieves relevant context before responding
const result = await supportAgent.run('What is the return policy for digital products?');
console.log(result.text);
// → "Digital downloads and software licenses are non-refundable once activated."
```

---

## Inspect retrieved context

Debug retrieval quality before trusting the final answer:

```ts
// See exactly what context the engine would inject for a query
const context = await knowledge.buildContext('Can I return a software license?');
console.log(context);
// → "Digital downloads and software licenses are non-refundable once activated."

// Or retrieve raw chunks with scores
const chunks = await knowledge.retrieve('software license return');
for (const chunk of chunks) {
  console.log(`[${chunk.score.toFixed(3)}] ${chunk.document.id}: ${chunk.document.content.slice(0, 80)}`);
}
// → [0.912] refund-digital: Digital downloads and software licenses are non-refundable...
```

---

## Ingest from files

```ts
import { readFile } from 'node:fs/promises';
import { createKnowledgeEngine } from 'personaforge/knowledge';

const knowledge = createKnowledgeEngine({ topK: 5, maxContextChars: 2_000 });

// Load a Markdown file and ingest as one document
const policyText = await readFile('./docs/return-policy.md', 'utf-8');
await knowledge.addDocuments([
  {
    id: 'return-policy',
    content: policyText,
    metadata: { source: 'return-policy.md' },
  },
]);

// Ingest a directory of policy documents
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const docsDir = './policies';
const files = await readdir(docsDir);

const docs = await Promise.all(
  files
    .filter((f) => f.endsWith('.md') || f.endsWith('.txt'))
    .map(async (file) => ({
      id: file.replace(/\.[^.]+$/, ''),
      content: await readFile(path.join(docsDir, file), 'utf-8'),
      metadata: { source: file },
    })),
);

await knowledge.addDocuments(docs);
console.log(`Ingested ${docs.length} documents`);
```

---

## Ingest structured data as documents

Any content can be a document — including JSON records or database rows:

```ts
import { createKnowledgeEngine } from 'personaforge/knowledge';

const knowledge = createKnowledgeEngine({ topK: 3, maxContextChars: 1_000 });

// Convert product catalog rows into searchable documents
const products = [
  { id: 'P001', name: 'Wireless Mouse', category: 'accessories', warranty: '12 months' },
  { id: 'P002', name: 'Mechanical Keyboard', category: 'accessories', warranty: '24 months' },
  { id: 'P003', name: 'USB-C Hub', category: 'accessories', warranty: '12 months' },
];

await knowledge.addDocuments(
  products.map((p) => ({
    id: p.id,
    content: `${p.name} (${p.category}): ${p.warranty} warranty. SKU: ${p.id}.`,
    metadata: { category: p.category },
  })),
);

const agent2 = agent({
  name: 'product-advisor',
  instructions: 'Answer product questions using the catalog knowledge base.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  knowledgebase: knowledge,
  tools: [],
});

const res = await agent2.run('What is the warranty on the keyboard?');
console.log(res.text);
// → "The Mechanical Keyboard comes with a 24-month warranty."
```

---

## `KnowledgeEngine` configuration

```ts
const knowledge = createKnowledgeEngine({
  topK: 3,               // number of chunks to retrieve per query
  maxContextChars: 1_500, // maximum characters injected into the system prompt
  store: customStore,    // bring your own vector store (optional)
  embed: customEmbedFn,  // bring your own embedding function (optional)
});
```

The engine defaults to an in-memory store and a built-in embedding fallback — no external vector database required to get started.

---

## Knowledge vs sessions vs memory

| Layer | Use for | Scope |
|---|---|---|
| **Knowledge** | Policy docs, manuals, product info | Static reference content |
| **Session** | Conversation turn history | Within a conversation |
| **Memory** | User preferences, learned facts | Cross-session recall |

Knowledge is for reference material that doesn't change between users. Sessions preserve conversation flow. Memory accumulates user-specific information over time.

---

## What's next?

- [06 · Persistent Memory](./06-memory) — user-specific memory that accumulates over time
- [08 · Multi-Agent Team](./08-team) — multiple agents sharing a knowledge base
- [11 · Customer Support Bot](./11-support-bot) — knowledge + tools in a real support scenario
- [RAG guide](../guide/rag) — full ingestion, retrieval, and embedding configuration
