---
title: Sessions
description: Keep conversations continuous across runs with InMemorySessionStore, SQLite, Redis, Postgres, or DbSessionStore. Multi-turn chat, session IDs, message history.
outline: [2, 3]
---

# Sessions

Sessions let an agent remember the thread of a conversation across multiple `run()` calls. Pass a `sessionId` and a `sessionStore` and the framework automatically loads and appends message history.

```ts
import {
  createInMemoryStore,
  createSqliteStore,
  createRedisStore,
  DbSessionStore,
  FallbackSessionStore,
  createFallbackSessionStore,
} from 'personaforge';
```

---

## Quick start

```ts
import { createAgent, createInMemoryStore } from 'personaforge';

const sessionStore = createInMemoryStore();

const agent = createAgent({
  name: 'chat',
  instructions: 'You are a helpful assistant.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  sessionStore,
});

// Turn 1
await agent.run('My name is Alice.', { sessionId: 'session-1' });

// Turn 2 — agent remembers the name
const result = await agent.run('What is my name?', { sessionId: 'session-1' });
console.log(result.text); // "Your name is Alice."
```

---

## Session stores

### InMemorySessionStore (development)

Fast, zero-config. Sessions are lost on restart.

```ts
import { createInMemoryStore } from 'personaforge';

const store = createInMemoryStore({
  retentionDays: 7,  // evict sessions older than 7 days
});

// Direct store access
const session = await store.create({ agentId: 'chat', userId: 'user-1' });
await store.appendMessage(session.id, { role: 'user', content: 'Hello' });
const messages = await store.getMessages(session.id);
await store.delete(session.id);

// Prune expired sessions manually
const deleted = store.pruneExpired();
console.log(`Pruned ${deleted} sessions`);
```

### SQLite (single-node production)

Durable sessions on disk — no external server needed:

```ts
import { createSqliteStore } from 'personaforge';

const store = createSqliteStore({
  path: './data/sessions.db',  // defaults to ':memory:' if omitted
});
```

### Redis (distributed, horizontally scalable)

```ts
import { createRedisStore } from 'personaforge';

const store = createRedisStore({
  redis: process.env.REDIS_URL!,   // 'redis://localhost:6379' or ioredis options
  keyPrefix: 'myapp:session:',     // namespacing
  ttlSeconds: 86_400,              // 24-hour TTL
});
```

### DbSessionStore (any AgentDb backend)

```ts
import { DbSessionStore } from 'personaforge';
import { SqliteAgentDb, PostgresAgentDb } from 'personaforge';

// SQLite
const db = new SqliteAgentDb({ path: './agent.db' });
const store = new DbSessionStore(db);

// Postgres
const pgDb = new PostgresAgentDb({ connectionString: process.env.DATABASE_URL! });
const pgStore = new DbSessionStore(pgDb);
```

### FallbackSessionStore (resilient)

Use a primary store (Redis/Postgres) with automatic in-memory fallback if it goes down:

```ts
import { createFallbackSessionStore, createRedisStore } from 'personaforge';

const store = createFallbackSessionStore(
  createRedisStore({ redis: process.env.REDIS_URL! }),
  {
    fallback: 'in-memory',
    onFallback: (err) => logger.warn('Session store degraded, using fallback', err),
    onRecover: () => logger.info('Session store recovered'),
  },
);

// Check degraded state
if (store.isDegraded()) {
  metrics.increment('session.store.degraded');
}

// Force re-check primary (call after your infra team fixes the issue)
store.recover();
```

---

## SessionStore interface

```ts
interface SessionStore {
  get(id: string): Promise<SessionData | undefined>;
  create(data: { agentId: string; userId?: string; messages?: SessionMessage[] } | string): Promise<SessionData>;
  update(id: string, data: { messages: SessionMessage[] }): Promise<void>;
  getMessages(id: string): Promise<SessionMessage[]>;
  appendMessage(id: string, message: SessionMessage): Promise<void>;
  delete(id: string): Promise<void>;
}
```

---

## Session IDs from your own system

You control the session ID — use any string that makes sense in your application:

```ts
// From an HTTP request
const sessionId = req.headers['x-session-id'] ?? crypto.randomUUID();

// From a database row
const sessionId = `order-${orderId}`;

// From a user ID for a single long-running conversation
const sessionId = `user-${userId}-chat`;

const result = await agent.run(prompt, { sessionId, userId });
```

---

## Read conversation history

```ts
const messages = await sessionStore.getMessages('session-1');
// [{ role: 'user', content: '...' }, { role: 'assistant', content: '...' }, ...]

// Get the full session object (metadata + messages)
const session = await sessionStore.get('session-1');
console.log(session?.createdAt, session?.updatedAt);
```

---

## Where to go next

- [Memory](./memory) — retain facts beyond ordinary conversation flow.
- [Storage](./storage) — durable application state around the agent.
- [HITL](./hitl) — pause a session to wait for human approval.
