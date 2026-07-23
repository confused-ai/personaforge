---
title: "05 · RAG Knowledge Base"
---

# 05 · RAG Knowledge Base

The current RAG surface is centered on `KnowledgeEngine` and the `knowledgebase` option on `agent()` or `createAgent()`.

## What you'll learn

- How to create a knowledge engine
- How to add documents directly
- How to plug that engine into an agent with `knowledgebase`

## Current pattern

```ts
import { agent } from 'personaforge';
import { createKnowledgeEngine } from 'personaforge/knowledge';

const knowledge = createKnowledgeEngine({
  topK: 3,
  maxContextChars: 1_200,
});

await knowledge.addDocuments([
  {
    id: 'refund-policy',
    content: 'Refunds are allowed within 30 days of purchase.',
    metadata: { source: 'refund-policy.md' },
  },
  {
    id: 'digital-goods',
    content: 'Digital downloads are non-refundable.',
    metadata: { source: 'refund-policy.md' },
  },
]);

const supportAgent = agent({
  name: 'SupportBot',
  instructions: 'Answer using the knowledge base. If the answer is missing, say so clearly.',
  knowledgebase: knowledge,
  tools: [],
});

const result = await supportAgent.run('What is the refund policy?');
console.log(result.text);

const context = await knowledge.buildContext('What happens with digital downloads?');
console.log(context);
```

## Notes

- `KnowledgeEngine` defaults to an in-memory store and a built-in embedding fallback, so you can get started without wiring an external vector database.
- If you need more control, pass a custom `store`, `embed`, `topK`, or `maxContextChars` when creating the engine.
- The public agent option is `knowledgebase`, not `knowledge`.

## What's next?

- [06 · Persistent Memory](./06-memory)
- [08 · Multi-Agent Team](./08-team)