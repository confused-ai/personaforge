---
title: Custom Adapter
description: Plug any database, cache, vector store, or queue into the framework through the AdapterRegistry. Built-in in-memory adapters for dev; swap in Postgres, Redis, Pinecone and more for production.
outline: [2, 3]
---

# Custom Adapter

The adapter system lets you bind external infrastructure (databases, caches, vector stores, queues) to the framework via a single registry. Modules auto-pick the right adapter by category — swap backends at deploy time without touching agent code.

```ts
import {
  createAdapterRegistry,
  InMemoryCacheAdapter,
  InMemoryVectorAdapter,
} from 'personaforge/adapters';
```

---

## Quick start

```ts
import { createAdapterRegistry, InMemoryCacheAdapter } from 'personaforge/adapters';
import { createAgent } from 'personaforge';

const registry = createAdapterRegistry();

// Register adapters (in-memory for dev)
registry.register(new InMemoryCacheAdapter());
registry.register(new InMemoryVectorAdapter());

await registry.connectAll();

const agent = createAgent({
  name: 'my-agent',
  instructions: '...',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  adapters: registry,   // modules auto-resolve their adapter
});
```

---

## Built-in adapters (zero dependencies)

These ship with the framework and require no external services:

| Adapter | Class | Description |
|---|---|---|
| Cache | `InMemoryCacheAdapter` | In-process TTL cache |
| Vector | `InMemoryVectorAdapter` | Cosine similarity search |
| SQL | `InMemorySqlAdapter` | In-process relational store |
| NoSQL | `InMemoryNoSqlAdapter` | Document store |
| Search | `InMemorySearchAdapter` | Full-text search |
| Object storage | `InMemoryObjectStorageAdapter` | Blob / file store |
| Graph | `InMemoryGraphAdapter` | Node-edge graph |
| Message queue | `InMemoryMessageQueueAdapter` | Pub/sub queue |
| Session | `InMemorySessionStoreAdapter` | Conversation history |
| Memory | `InMemoryMemoryStoreAdapter` | Agent long-term memory |
| RAG | `InMemoryRagAdapter` | Vector retrieval |
| Rate limit | `InMemoryRateLimitAdapter` | Token-bucket limiter |
| Audit log | `InMemoryAuditLogAdapter` | Audit trail |

---

## Production preset

Wire all core adapters in one call using `createProductionSetup`:

```ts
import { createProductionSetup } from 'personaforge/adapters';

const { registry } = await createProductionSetup({
  postgres: { connectionString: process.env.DATABASE_URL! },
  redis:    { url: process.env.REDIS_URL! },
  pinecone: { apiKey: process.env.PINECONE_API_KEY! },
});

const agent = createAgent({ adapters: registry, ... });
```

---

## Implement a custom adapter

Pick the category interface that matches your backend. All adapters share the same base:

```ts
import type { CacheAdapter, Adapter } from 'personaforge/adapters';

class RedisCacheAdapter implements CacheAdapter {
  readonly category = 'cache' as const;
  readonly name = 'redis';

  private client: Redis;

  constructor(config: { url: string }) {
    this.client = new Redis(config.url);
  }

  async connect()    { await this.client.ping(); }
  async disconnect() { await this.client.quit(); }
  async health()     { return { connected: true }; }

  async get(key: string)                                           { return JSON.parse(await this.client.get(key) ?? 'null'); }
  async set(key: string, value: unknown, ttlSeconds?: number)     { await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds ?? 3600); }
  async del(key: string)                                           { await this.client.del(key); }
  async flush(pattern: string)                                     { const keys = await this.client.keys(pattern); if (keys.length) await this.client.del(...keys); return keys.length; }
}

// Register
registry.register(new RedisCacheAdapter({ url: process.env.REDIS_URL! }));
```

---

## Adapter categories

| Category | Interface | Use for |
|---|---|---|
| `sql` | `SqlAdapter` | Relational data, joins, transactions |
| `nosql` | `NoSqlAdapter` | Document collections |
| `vector` | `VectorAdapter` | Embedding similarity search |
| `cache` | `CacheAdapter` | TTL key-value cache |
| `search` | `SearchAdapter` | Full-text / keyword search |
| `object-storage` | `ObjectStorageAdapter` | File/blob storage (S3, GCS) |
| `time-series` | `TimeSeriesAdapter` | Metrics, sensor data |
| `graph` | `GraphAdapter` | Graph traversal |
| `message-queue` | `MessageQueueAdapter` | Pub/sub, task queues |
| `observability` | `ObservabilityAdapter` | Logs, traces, metrics |
| `embedding` | `EmbeddingAdapter` | Text → vector |
| `session` | `SessionStoreAdapter` | Conversation history |
| `memory` | `MemoryStoreAdapter` | Agent long-term memory |
| `rag` | `RagAdapter` | Retrieve + augment |
| `guardrail` | `GuardrailAdapter` | Content safety |
| `auth` | `AuthAdapter` | Authentication |
| `rate-limit` | `RateLimitAdapter` | Rate limiting |
| `audit` | `AuditLogAdapter` | Audit trail |

---

## `AdapterRegistry` interface

```ts
interface AdapterRegistry {
  register(adapter: AnyAdapter, opts?: { replace?: boolean }): void;
  unregister(category: AdapterCategory, name: string): boolean;
  resolve<T>(category: AdapterCategory, name?: string): T;
  connectAll(): Promise<void>;
  disconnectAll(): Promise<void>;
  health(): Promise<Record<string, AdapterHealth>>;
  list(): AnyAdapter[];
}
```

---

## Where to go next

- [Storage](./storage) — key-value store built on top of the adapter system.
- [Session](./session) — conversation persistence via `SessionStoreAdapter`.
- [Secret manager](./secret-manager) — fetch credentials for adapter configuration.
