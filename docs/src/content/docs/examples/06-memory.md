---
title: "06 · Persistent Memory"
---

# 06 · Persistent Memory

The current memory surface uses `memoryStore` on the agent and the exported memory store classes from the root package.

## What you'll learn

- How to attach a memory store to an agent
- How to seed and query long-term memory directly
- How the same store can serve both the runtime and your application code

## Current pattern

```ts
import { agent, InMemoryStore, MemoryType } from 'personaforge';

const memoryStore = new InMemoryStore();

await memoryStore.store({
  type: MemoryType.LONG_TERM,
  content: 'The user prefers vegetarian meals.',
  metadata: {
    agentId: 'memory-bot',
    sessionId: 'bootstrap',
    tags: ['food-preference'],
  },
});

const bot = agent({
  name: 'MemoryBot',
  instructions: 'Use stored memory when answering preference questions.',
  memoryStore,
});

const matches = await memoryStore.retrieve({
  query: 'vegetarian',
  limit: 3,
});

console.log(matches.map((match) => match.entry.content));

const result = await bot.run('Suggest a dinner idea for me.');
console.log(result.text);
```

## Notes

- `memoryStore` is the public option on `agent()` and `createAgent()`.
- `InMemoryStore` is useful for development and tests. Swap in a different memory-store implementation when you need durability.
- The store API is explicit: `store()`, `retrieve()`, `get()`, `update()`, and `clear()`.

## What's next?

- [07 · Storage Patterns](./07-storage)
- [Customer Support Bot](/examples/11-support-bot)