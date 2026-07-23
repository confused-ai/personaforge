---
title: 06 · Persistent Memory
description: Attach a memory store to any agent so it accumulates and recalls facts, preferences, and history across sessions.
outline: [2, 3]
---

# 06 · Persistent Memory

Memory lets an agent remember things between sessions — user preferences, learned facts, past decisions. Unlike sessions (which preserve conversation turns), memory stores selected content that the agent can retrieve and reason about at any future point.

```ts
import { agent, InMemoryStore, MemoryType } from 'personaforge';
```

---

## What you'll learn

- How to attach a memory store to an agent with `memoryStore`
- How to seed and query memory directly
- How `MemoryType` organizes stored content
- How to swap the in-memory store for a persistent backend

---

## Basic memory-enabled agent

```ts
import { agent, InMemoryStore, MemoryType } from 'personaforge';

// Create the store
const memoryStore = new InMemoryStore();

// Pre-seed with known facts about the user
await memoryStore.store({
  type: MemoryType.LONG_TERM,
  content: 'The user prefers vegetarian meals.',
  metadata: {
    agentId: 'concierge',
    sessionId: 'bootstrap',
    tags: ['food-preference'],
  },
});

await memoryStore.store({
  type: MemoryType.LONG_TERM,
  content: 'The user is based in Tokyo and prefers local restaurant recommendations.',
  metadata: {
    agentId: 'concierge',
    sessionId: 'bootstrap',
    tags: ['location', 'preferences'],
  },
});

// Attach the store to the agent
const concierge = agent({
  name: 'concierge',
  instructions: 'You are a personal concierge. Use stored memory to personalise all recommendations.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  memoryStore,
});

// The agent will surface stored preferences automatically
const result = await concierge.run('Suggest a dinner idea for tonight.');
console.log(result.text);
// → "Since you prefer vegetarian food and are in Tokyo, I'd suggest..."
```

---

## Query memory directly

You can retrieve memories in application code — useful for debugging, building UI, or seeding context before a run.

```ts
const matches = await memoryStore.retrieve({
  query: 'food preferences',
  limit: 5,
});

console.log(matches.map((m) => m.entry.content));
// → ['The user prefers vegetarian meals.']

// Get a specific entry by ID
const entry = await memoryStore.get('entry-id-here');

// Update an existing entry
await memoryStore.update('entry-id-here', {
  content: 'The user now prefers vegan meals.',
});
```

---

## Memory types

`MemoryType` categorises what kind of information is being stored:

```ts
import { MemoryType } from 'personaforge';

// Long-term: persistent facts and preferences
await memoryStore.store({
  type: MemoryType.LONG_TERM,
  content: 'User prefers concise summaries over detailed explanations.',
  metadata: { agentId: 'assistant', sessionId: 'onboarding', tags: ['style'] },
});

// Short-term: session-scoped temporary context
await memoryStore.store({
  type: MemoryType.SHORT_TERM,
  content: 'User is currently researching TypeScript 5.5 features.',
  metadata: { agentId: 'assistant', sessionId: 'sess-001', tags: ['topic'] },
});

// Episodic: past events or interactions worth remembering
await memoryStore.store({
  type: MemoryType.EPISODIC,
  content: 'User asked about Tokyo restaurants on 2026-03-15 and liked the Shinjuku suggestions.',
  metadata: { agentId: 'concierge', sessionId: 'sess-042', tags: ['past-interaction'] },
});
```

---

## Multi-session memory continuity

```ts
import { agent, InMemoryStore, MemoryType } from 'personaforge';
import { InMemorySessionStore } from 'personaforge/session';

const memoryStore = new InMemoryStore();
const sessionStore = new InMemorySessionStore();

const assistant = agent({
  name: 'assistant',
  instructions: 'Use stored memory to give personalised, context-aware answers.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  memoryStore,
  sessionStore,
});

// Session 1 — user states a preference
await assistant.run('I always want answers in bullet points.', {
  sessionId: 'sess-1',
  userId: 'user-42',
});

// Session 2 (later, different session) — agent recalls the preference
const result = await assistant.run('Explain how RAG works.', {
  sessionId: 'sess-2',
  userId: 'user-42',
});

console.log(result.text);
// → "• RAG stands for Retrieval-Augmented Generation\n• It works by..."
```

---

## Swap to a persistent backend

`InMemoryStore` is for development. Switch to a durable store before deploying.

```ts
import { createAgent } from 'personaforge';
import { createDbMemoryStore } from 'personaforge';  // persistent backend

const memoryStore = createDbMemoryStore({
  db: yourDatabaseConnection,
  namespace: 'user-42',  // isolate per user or tenant
});

const assistant = createAgent({
  name: 'assistant',
  instructions: 'Use memory to personalise answers.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  memoryStore,
});
```

---

## Memory vs sessions vs knowledge

| Layer | Stores | Scope |
|---|---|---|
| **Memory** | Facts, preferences, past events | Cross-session, long-term recall |
| **Session** | Conversation turn history | Within a conversation |
| **Knowledge** | Indexed documents and policies | Static retrieval context |

Use memory when the agent should *learn* things about users or accumulate context over time. Use sessions for continuity *within* a conversation. Use knowledge for fixed reference content.

---

## What's next?

- [07 · Storage Patterns](./07-storage) — durable application state beyond agent memory
- [05 · RAG Knowledge Base](./05-rag) — document retrieval and semantic search
- [11 · Customer Support Bot](./11-support-bot) — memory + sessions in a realistic support scenario
- [Memory guide](../guide/memory) — full memory store API reference
