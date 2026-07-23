---
title: 07 · Storage Patterns
description: Use createStorage() for durable key-value state. In-memory for dev, file-backed for persistence. TTL, prefix listing, and per-tenant namespacing.
outline: [2, 3]
---

# 07 · Storage Patterns

`createStorage()` is the generic persistence layer — the right place for caches, run metadata, configuration, and any agent-adjacent state that doesn't belong in sessions or retrieval indexes.

---

## What you'll learn

- How to use the default in-memory driver
- How to persist values to disk with the file driver
- How TTL-based expiry works
- How to namespace storage by tenant or agent
- When to use storage vs sessions vs memory

---

## In-memory storage (default)

The default driver is in-memory — great for development, tests, and short-lived caches.

```ts
import { createStorage } from 'personaforge/storage';

const cache = createStorage();

// Set with a 5-minute TTL (seconds)
await cache.set('weather:tokyo', { tempC: 24, condition: 'sunny' }, 300);

// Read back
const data = await cache.get('weather:tokyo');
console.log(data);
// → { tempC: 24, condition: 'sunny' }

// Check existence without reading
const exists = await cache.has('weather:tokyo');
console.log(exists); // → true

// Delete a key
await cache.delete('weather:tokyo');

// List all keys under a prefix
const keys = await cache.list('weather:');
console.log(keys); // → []
```

---

## File-backed storage

Swap in `driver: 'file'` with a `basePath` to persist values across process restarts.

```ts
import { createStorage } from 'personaforge/storage';

const diskStore = createStorage({
  driver: 'file',
  basePath: './data/storage',
});

// Write a run record
await diskStore.set('runs:latest', {
  id: 'run_7f3a',
  status: 'completed',
  finishedAt: new Date().toISOString(),
});

// Read it back in the next process
const latest = await diskStore.get('runs:latest');
console.log(latest);
// → { id: 'run_7f3a', status: 'completed', finishedAt: '...' }

// List all run keys
const runKeys = await diskStore.list('runs:');
console.log(runKeys);
// → ['runs:latest', 'runs:run_7f3a']
```

---

## TTL-based caching

The third positional argument to `set()` is the TTL in seconds. After expiry, `get()` returns `null` and `has()` returns `false`.

```ts
const cache = createStorage();

// Cache an expensive computation for 10 minutes
async function getCachedEmbedding(text: string): Promise<number[]> {
  const key = `embed:${text.slice(0, 64)}`;
  const cached = await cache.get<number[]>(key);
  if (cached) return cached;

  const embedding = await computeEmbedding(text);  // slow operation
  await cache.set(key, embedding, 600); // expires in 600 seconds
  return embedding;
}
```

---

## Namespacing by tenant or agent

Prefix keys with a tenant or agent ID to isolate storage within a shared store.

```ts
import { createStorage } from 'personaforge/storage';

function tenantStorage(tenantId: string) {
  const store = createStorage({
    driver: 'file',
    basePath: './data/storage',
  });

  return {
    set: (key: string, value: unknown, ttl?: number) =>
      store.set(`${tenantId}:${key}`, value, ttl),
    get: <T>(key: string) =>
      store.get<T>(`${tenantId}:${key}`),
    list: (prefix: string) =>
      store.list(`${tenantId}:${prefix}`),
    delete: (key: string) =>
      store.delete(`${tenantId}:${key}`),
  };
}

const acmeStorage  = tenantStorage('acme');
const betaStorage  = tenantStorage('beta');

await acmeStorage.set('config:model', 'gpt-4o');
await betaStorage.set('config:model', 'gpt-4o-mini');

console.log(await acmeStorage.get('config:model'));  // → 'gpt-4o'
console.log(await betaStorage.get('config:model'));  // → 'gpt-4o-mini'
```

---

## Storage vs sessions vs memory

| Layer | Use for |
|---|---|
| **Storage** | Caches, run metadata, config, durable outputs |
| **Session** | Conversation history and turn continuity |
| **Memory** | Long-term agent recall (facts, preferences) |
| **Knowledge** | Indexed documents for retrieval |

Storage is the broadest layer. If data doesn't naturally belong in conversation history, memory recall, or a document index — it belongs in storage.

---

## API quick reference

```ts
const store = createStorage(options?);

await store.set(key, value, ttlSeconds?);   // write with optional TTL
await store.get<T>(key);                    // read — returns null if missing
await store.has(key);                       // check existence
await store.delete(key);                    // remove one key
await store.list(prefix);                   // list all keys under prefix
await store.clear();                        // remove all keys
```

---

## What's next?

- [08 · Multi-Agent Team](./08-team) — team orchestration with shared state
- [13 · Production Resilience](./13-production) — wrap storage with circuit breakers and rate limits
- [Storage guide](../guide/storage) — full driver options and configuration reference
