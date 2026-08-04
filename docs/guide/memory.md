---
title: Memory
description: Persist and recall facts across agent runs using InMemoryStore, VectorMemoryStore, Pinecone, Qdrant, PgVector, and more.
outline: [2, 3]
---

# Memory

Memory lets an agent retain and recall selected facts across runs. The framework ships multiple store backends and a distiller for compressing conversation history into compact summaries.

## Quick start

```ts
import { createAgent, InMemoryStore } from 'personaforge';

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

## The unified `Memory` layer

`Memory` is the modern, all-in-one way to give agents durable memory — message history, working memory, semantic recall, observational memory, and even a mem0-style fact engine. It mirrors Mastra's `@mastra/memory` API and is **production-ready by default** (libSQL persistence, zero-config semantic recall).

```ts
import { createAgent, Memory } from 'personaforge';

const memory = new Memory({
  // storage defaults to libSQL (`:memory:`, or `file:`/remote when LIB_SQL_URL is set)
  options: {
    lastMessages: 20,                       // history window
    workingMemory: { template: '# Profile\n- Name:\n- Location:' },
  },
});

const agent = createAgent({
  name: 'assistant',
  instructions: 'You are a helpful assistant.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  memory,                                   // ← attaches threads/working-memory/tools
});

// Scope every run with a thread + resource (user/entity).
await agent.run('Remember I like dark mode.', { memory: { thread: 't1', resource: 'alice' } });
```

When `memory` is set, `createAgent`:

- loads/persists message history through the `Memory` bundle (instead of the legacy `sessionStore` blob),
- injects working memory and observational memory as system context,
- registers the memory agent tools (`updateWorkingMemory`, `recall_memory`, mem0 tools),
- automatically runs observational buffering, mem0 extraction and semantic indexing after each turn.

### Thread stores — libSQL by default

Threads and messages persist through a `ThreadStore`. The default is **libSQL** (`@libsql/client`) — local `file:` databases, shared `:memory:`, or Turso cloud (`libsql://`). If libSQL isn't installed it falls back to in-memory; `better-sqlite3` is also supported.

```ts
import { createAgent, Memory, createThreadStore } from 'personaforge';

const storage = createThreadStore({ url: 'file:./memory.db' }); // durable, recommended
const memory  = new Memory({ storage });

// or equivalently via env:
//   LIB_SQL_URL=file:./memory.db

// available stores
import { InMemoryThreadStore, LibSqlThreadStore, SqliteThreadStore } from 'personaforge';
new Memory({ storage: new InMemoryThreadStore() });   // dev / tests
new Memory({ storage: new LibSqlThreadStore({ url: 'libsql://my-db-org.turso.io', authToken }) });
new Memory({ storage: new SqliteThreadStore({ path: './memory.db' }) }); // better-sqlite3
```

### Working memory

A persistent, always-available block (user profile / task state) injected as a system message every turn. Two styles:

```ts
// Markdown template — the agent rewrites the whole block.
new Memory({
  options: {
    workingMemory: { template: `
# User Profile
- Name:
- Location:
- Communication style:
` },
  },
});

// Structured JSON (deep-merge updates; null deletes fields; arrays replace).
import { z } from 'zod';
new Memory({
  options: {
    workingMemory: {
      schema: z.object({ name: z.string(), prefs: z.record(z.any()) }),
      scope: 'resource',   // shared across all threads of the user (default)
    },
  },
});
```

Programmatic API:

```ts
await memory.updateWorkingMemory({ threadId: 't1', resourceId: 'alice', workingMemory: '...' });
const block = await memory.getWorkingMemory({ threadId: 't1', resourceId: 'alice' });
```

### Semantic recall

RAG over past messages. Enable with `semanticRecall: true` — zero-config: a deterministic local hashing embedder + in-memory vector store work out of the box. Bring a real embedder + vector store for production-grade similarity.

```ts
import { createAgent, Memory, InMemoryVectorStore, OpenAIEmbeddingProvider } from 'personaforge';

const memory = new Memory({
  vector: new InMemoryVectorStore(),
  embedder: new OpenAIEmbeddingProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  options: { semanticRecall: { topK: 3, scope: 'resource' } },
});

// Direct recall anywhere
const { messages } = await memory.recall({
  threadId: 't1',
  vectorSearchString: 'what code theme do I prefer?',
  perPage: 5,
});
```

### Observational memory

Compress very long conversations into a dense observation log with background Observer/Reflector agents — the context window stays bounded no matter how long the thread runs.

```ts
const memory = new Memory({
  llm, // agent-level LLM is bound automatically when using createAgent
  options: {
    observationalMemory: {
      messageTokens: 30_000,     // when to compress history (default 30k)
      observationTokens: 40_000, // when to reflect/condense the log (default 40k)
      bufferTokens: 0.2,         // background buffering cadence
      observation: {
        manageWorkingMemory: true, // Observer keeps the user profile fresh
        extract: [new Extractor({ name: 'Blockers', instructions: 'What is blocking the user?' })],
      },
    },
  },
});
```

When activated, observed messages leave the context window and a compact `[Observational Memory]` system block (plus a continuation hint) takes their place. Raw messages stay in storage for the `recall_memory` tool.

### mem0-style memory

An LLM extracts discrete, editable **facts** from each turn (mem0's `ADD / UPDATE / NONE / DELETE` pipeline), stored and searchable with a CRUD API + agent tools.

```ts
import { createAgent, Memory } from 'personaforge';

const memory = new Memory({
  llm,
  options: {
    mem0: { autoExtract: true }, // extract + store facts after every run
  },
});

// programmatic API
await memory.mem0?.add('Alice prefers dark mode', { userID: 'alice' });
const facts = await memory.mem0?.search('theme preference', { userID: 'alice' });

// standalone engine (anywhere)
import { Mem0Memory, InMemoryMem0Store } from 'personaforge';
const mem0 = new Mem0Memory({
  llm,
  store: new InMemoryMem0Store(),
  embedder: undefined, // optional semantic search
  vectorStore: undefined, // optional semantic search
});
await mem0.processMessages(conversation, { userID: 'alice' });
```

### Memory processors (Mastra parity)

The individual pieces are also available as standalone `Processor`s for the agent processor pipeline: `MessageHistoryProcessor`, `SemanticRecallProcessor`, `WorkingMemoryProcessor`, `TokenLimiterProcessor`, `ObservationalMemoryProcessor`, and `Mem0ExtractionProcessor`. You can compose them manually with `memory.getProcessors()` or reference them directly when building a custom runner.

### Scoped, multi-user threads

Every thread belongs to a single `resourceId` (user/entity); a resource can own many threads. Threads are isolated first-class records — use one `thread` per conversation and one `resource` per user:

```ts
await agent.run('...', { memory: { thread: 'support-42', resource: 'user-7' } });
await memory.listThreads({ resourceId: 'user-7' }); // all of user-7's conversations
```

---

## Memory stores

### `InMemoryStore`

In-process store. Cleared when the process restarts. Good for prototyping.

```ts
import { InMemoryStore } from 'personaforge';

const memoryStore = new InMemoryStore();
```

### `VectorMemoryStore`

Semantic search over stored memories using embeddings.

```ts
import { VectorMemoryStore, InMemoryVectorStore, OpenAIEmbeddingProvider } from 'personaforge';

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
import { VectorMemoryStore, PineconeVectorStore, OpenAIEmbeddingProvider } from 'personaforge';

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
import { VectorMemoryStore, QdrantVectorStore, OpenAIEmbeddingProvider } from 'personaforge';

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
import { VectorMemoryStore, PgVectorStore, OpenAIEmbeddingProvider } from 'personaforge';

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
import { createDbMemoryStore } from 'personaforge/memory';
import { SqliteAgentDb } from 'personaforge/db';

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
import { MemoryDistiller, summariseMemories, summariseConversation } from 'personaforge/memory';
import { InMemoryStore } from 'personaforge';
import { OpenAIProvider } from 'personaforge';

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
import { createAgent } from 'personaforge';
import { createSummaryBufferHook } from 'personaforge/memory';
import { OpenAIProvider } from 'personaforge';

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
import { InMemoryStore, MemoryType } from 'personaforge';

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
import { createAgent, TieredMemory, createTieredMemoryTools, InMemoryStore, DEFAULT_BLOCK_LIMIT } from 'personaforge';

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
import { createAgent, GraphMemory, createGraphMemoryTools } from 'personaforge';

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
import { createAgent, InMemoryStore } from 'personaforge';
import { createAgentMemoryTools } from 'personaforge/memory';

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
