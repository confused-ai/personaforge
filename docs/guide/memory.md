---
title: Memory
description: Persist and recall facts across agent runs using InMemoryStore, VectorMemoryStore, Pinecone, Qdrant, PgVector, and more.
outline: [2, 3]
---

# Memory

Memory lets an agent retain and recall selected facts across runs. The framework ships multiple store backends and a distiller for compressing conversation history into compact summaries.

## Quick start

```ts
import { createAgent, InMemoryStore } from 'confused-ai';

const agent = createAgent({
  name: 'personal-assistant',
  instructions: 'You are a personal assistant. Remember user preferences.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  memoryStore: new InMemoryStore(),
  enableAgenticMemory: true,    // gives agent remember() and recall() tools
  addMemoriesToContext: true,   // auto-prepend recalled memories to each run
  numMemories: 5,               // max memories added to context (default: 5)
});

await agent.run('I prefer TypeScript and dark mode.', { userId: 'alice' });

// Later session — agent recalls these facts automatically
const result = await agent.run('What languages do I use?', { userId: 'alice' });
console.log(result.text);  // references TypeScript
```

---

## Memory stores

### `InMemoryStore`

In-process store. Cleared when the process restarts. Good for prototyping.

```ts
import { InMemoryStore } from 'confused-ai';

const memoryStore = new InMemoryStore();
```

### `VectorMemoryStore`

Semantic search over stored memories using embeddings.

```ts
import { VectorMemoryStore, InMemoryVectorStore, OpenAIEmbeddingProvider } from 'confused-ai';

const memoryStore = new VectorMemoryStore({
  vectorStore: new InMemoryVectorStore(),
  embeddingProvider: new OpenAIEmbeddingProvider({
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'text-embedding-3-small',
  }),
});
```

### Pinecone

```ts
import { VectorMemoryStore, PineconeVectorStore, OpenAIEmbeddingProvider } from 'confused-ai';

const memoryStore = new VectorMemoryStore({
  vectorStore: new PineconeVectorStore({
    apiKey: process.env.PINECONE_API_KEY!,
    indexName: 'agent-memories',
  }),
  embeddingProvider: new OpenAIEmbeddingProvider({ apiKey: process.env.OPENAI_API_KEY! }),
});
```

### Qdrant

```ts
import { VectorMemoryStore, QdrantVectorStore, OpenAIEmbeddingProvider } from 'confused-ai';

const memoryStore = new VectorMemoryStore({
  vectorStore: new QdrantVectorStore({
    url: process.env.QDRANT_URL!,
    collectionName: 'memories',
  }),
  embeddingProvider: new OpenAIEmbeddingProvider({ apiKey: process.env.OPENAI_API_KEY! }),
});
```

### PgVector (PostgreSQL)

```ts
import { VectorMemoryStore, PgVectorStore, OpenAIEmbeddingProvider } from 'confused-ai';

const memoryStore = new VectorMemoryStore({
  vectorStore: new PgVectorStore({
    connectionString: process.env.DATABASE_URL!,
    tableName: 'agent_memories',
  }),
  embeddingProvider: new OpenAIEmbeddingProvider({ apiKey: process.env.OPENAI_API_KEY! }),
});
```

### Database-backed store (`DbMemoryStore`)

Persists to the framework's built-in SQLite/Postgres AgentDb:

```ts
import { createDbMemoryStore } from 'confused-ai/memory';
import { SqliteAgentDb } from 'confused-ai/db';

// Pass an AgentDb instance positionally; options are optional.
const db = new SqliteAgentDb({ path: './agent.db' });
const memoryStore = createDbMemoryStore(db, { agentId: 'my-agent' });
```

---

## Agentic memory tools

When `enableAgenticMemory: true`, the agent gets two tools:

- **`remember(fact: string)`** — explicitly stores a fact
- **`recall(query: string)`** — retrieves relevant memories

The agent decides when to call these. Pair with `addMemoriesToContext: true` to also automatically prepend relevant memories before each run.

```ts
const agent = createAgent({
  name: 'assistant',
  instructions: `
    You are a personal assistant.
    Use remember() to store any user preference, fact, or important detail.
    Recalled memories will appear at the top of each conversation.
  `,
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  memoryStore: new InMemoryStore(),
  enableAgenticMemory: true,
  addMemoriesToContext: true,
});
```

---

## Memory distiller

Compress conversation history into concise summaries to prevent context overflow:

```ts
import { MemoryDistiller, summariseMemories, summariseConversation } from 'confused-ai/memory';
import { InMemoryStore } from 'confused-ai';
import { OpenAIProvider } from 'confused-ai';

const llm = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });
const store = new InMemoryStore();

const distiller = new MemoryDistiller({
  store,                 // the MemoryStore to read short-term entries from and write summaries to
  llm,
  agentId: 'agent-123',  // optional: scope distillation to one agent
  triggerThreshold: 20,  // auto-distill once this many short-term entries accumulate (default: 20)
  batchSize: 30,         // max entries consumed per pass (default: 30)
  // intervalMs: 60_000, // optional background polling; omit to distill manually
});

// Run a distillation pass now. Returns DistillationResult { consumed, summary, skipped }.
const result = await distiller.distillNow(true);  // force = true ignores the threshold
if (result.summary) console.log(result.consumed, result.summary.content);

// One-shot helpers (entries/messages first, llm second; each returns a string)
const memorySummary = await summariseMemories(memories, llm);
const conversationSummary = await summariseConversation(messages, llm);
```

---

## Summary buffer middleware

Automatically compress conversation history when it grows too long:

```ts
import { createAgent } from 'confused-ai';
import { createSummaryBufferHook } from 'confused-ai/memory';
import { OpenAIProvider } from 'confused-ai';

const llm = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });
const summaryHook = createSummaryBufferHook({
  llm,
  maxMessages: 20,   // compress when history exceeds this many messages (default: 30)
  keepLastN: 5,      // always keep the last N messages verbatim (default: 10)
  // summarizePrompt: '...' // optional: override the summarisation system prompt
});

const agent = createAgent({
  name: 'long-chat-agent',
  instructions: 'You are a long-running assistant.',
  llm,
  hooks: { beforeStep: summaryHook },
});
```

---

## Direct memory store usage

You can read and write the memory store directly without an agent:

```ts
import { InMemoryStore, MemoryType } from 'confused-ai';

const store = new InMemoryStore();

// Write — store(entry), where entry is { type, content, metadata }.
// The id and createdAt are assigned for you and returned on the entry.
const entry = await store.store({
  type: MemoryType.LONG_TERM,
  content: 'Prefers TypeScript',
  metadata: { agentId: 'alice', tags: ['user-pref'] },
});

// Retrieve — retrieve(query) with { query, type?, limit?, threshold?, filter? }.
// Scope with `filter` (agentId, sessionId, tags, …). Semantic stores rank by
// similarity; InMemoryStore uses keyword/substring matching.
const results = await store.retrieve({
  query: 'programming language',
  limit: 5,
  filter: { agentId: 'alice' },
});
console.log(results);  // MemorySearchResult[] — each { entry, score }

// Delete by id
await store.delete(entry.id);
```

---

## Self-editing tiered memory (MemGPT / Letta style)

`TieredMemory` gives an agent two tiers it manages itself:

- **Core memory** — small labelled blocks (`persona`, `human`, …) always rendered into the prompt via `renderCore()`. Each block is character-limited; the default ceiling is `DEFAULT_BLOCK_LIMIT` (2 000 chars).
- **Archival memory** — an unbounded `MemoryStore` searched on demand.

`createTieredMemoryTools(memory)` returns the four LLM-callable tools (`core_memory_append`, `core_memory_replace`, `archival_memory_insert`, `archival_memory_search`) so the agent edits both tiers on its own.

```ts
import { createAgent, TieredMemory, createTieredMemoryTools, InMemoryStore, DEFAULT_BLOCK_LIMIT } from 'confused-ai';

const tiered = new TieredMemory({
  blocks: [
    { label: 'persona', value: 'I am a helpful research assistant.' },
    { label: 'human',   value: '' },
    { label: 'scratchpad', value: '', limit: DEFAULT_BLOCK_LIMIT },
  ],
  archival: new InMemoryStore(),   // backs the archival_memory_* tools
});

const agent = createAgent({
  name: 'Letta',
  instructions: `You are an assistant.\n\n${tiered.renderCore()}`,
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: Object.values(createTieredMemoryTools(tiered)),
});
```

---

## Graph (entity) memory

`GraphMemory` stores typed entities and labelled relations the agent can traverse ("who works where", "what depends on what") instead of only fuzzy-matching by embedding. `createGraphMemoryTools(graph)` exposes `add_entity`, `add_relation`, and `search_graph` so the agent builds and queries the graph itself.

```ts
import { createAgent, GraphMemory, createGraphMemoryTools } from 'confused-ai';

const graph = new GraphMemory();
graph.addRelation('Jordan', 'works_at', 'AcmeCorp');
graph.addRelation('Jordan', 'lives_in', 'Lisbon');

graph.search('Jordan');  // → ['Jordan works_at AcmeCorp', 'Jordan lives_in Lisbon']
graph.toFacts();         // every relation as a fact line — handy for dumping into a prompt

const agent = createAgent({
  name: 'graph-agent',
  instructions: 'Track facts about people and organisations.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: Object.values(createGraphMemoryTools(graph)),
});
```

---

## `remember` / `recall` tools

`createAgentMemoryTools({ store })` returns two ready-to-register tools — `remember(fact, tags?)` and `recall(query, limit?)` — backed by any `MemoryStore`. This is the explicit, tool-based alternative to the `enableAgenticMemory` shortcut used in the quick start.

```ts
import { createAgent, InMemoryStore } from 'confused-ai';
import { createAgentMemoryTools } from 'confused-ai/memory';

const { remember, recall } = createAgentMemoryTools({ store: new InMemoryStore() });

const agent = createAgent({
  name: 'ResearchBot',
  instructions: 'Remember useful facts and recall them when relevant.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [remember, recall],
});
```

---

## Where to go next

- [RAG](./rag) — retrieve from indexed documents (different from persisted memories).
- [Session](./session) — per-conversation turn history.
- [Agents](./agents) — how to attach a memory store to `createAgent()`.
