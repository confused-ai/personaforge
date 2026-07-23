---
title: Storage API
description: Complete reference for createStorage(). In-memory and file-backed drivers, TTL expiry, prefix listing, and typed key-value operations.
outline: [2, 3]
---

# Storage API

`createStorage()` is the generic key-value persistence layer. Use it for caches, run metadata, configuration, durable outputs, and any application state that doesn't belong in sessions, memory, or a retrieval index.

```ts
import { createStorage } from 'personaforge/storage';
```

---

## `createStorage()` — create a store

```ts
import { createStorage } from 'personaforge/storage';

// In-memory (default) — data lost on restart, ideal for dev and tests
const cache = createStorage();

// File-backed — data persists to disk across restarts
const disk = createStorage({
  driver: 'file',
  basePath: './data/storage',
});
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'memory' \| 'file'` | `'memory'` | Storage backend |
| `basePath` | `string` | — | Required when `driver` is `'file'` |

---

## `set()` — write a value

```ts
// Write without TTL — persists until deleted or cleared
await store.set('config:model', 'gpt-4o');

// Write with TTL in seconds — expires after 5 minutes
await store.set('cache:weather:tokyo', { tempC: 24 }, 300);
```

**Signature:** `set(key: string, value: unknown, ttlSeconds?: number): Promise<void>`

The third argument is the TTL in **seconds**. After expiry, `get()` returns `null` and `has()` returns `false`.

---

## `get()` — read a value

```ts
const model = await store.get<string>('config:model');
// → 'gpt-4o'

const expired = await store.get('cache:weather:tokyo');
// → null  (if TTL has elapsed)
```

**Signature:** `get<T>(key: string): Promise<T | null>`

Returns `null` when the key doesn't exist or has expired.

---

## `has()` — check existence

```ts
const exists = await store.has('config:model');
// → true

const missing = await store.has('does:not:exist');
// → false
```

**Signature:** `has(key: string): Promise<boolean>`

---

## `delete()` — remove a key

```ts
await store.delete('cache:weather:tokyo');
```

**Signature:** `delete(key: string): Promise<void>`

---

## `list()` — list keys by prefix

```ts
await store.set('runs:abc', { status: 'completed' });
await store.set('runs:def', { status: 'failed' });
await store.set('config:model', 'gpt-4o');

const runKeys = await store.list('runs:');
console.log(runKeys);
// → ['runs:abc', 'runs:def']
```

**Signature:** `list(prefix: string): Promise<string[]>`

Returns all keys that start with `prefix`. Pass an empty string to list all keys.

---

## `clear()` — remove all keys

```ts
await store.clear();
```

**Signature:** `clear(): Promise<void>`

Removes every key in the store. Use with caution in production.

---

## Full API reference

```ts
interface Storage {
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  get<T = unknown>(key: string): Promise<T | null>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  clear(): Promise<void>;
}
```

---

## TTL-based caching pattern

```ts
const cache = createStorage();

async function getCached<T>(
  key: string,
  compute: () => Promise<T>,
  ttlSeconds = 300,
): Promise<T> {
  const cached = await cache.get<T>(key);
  if (cached !== null) return cached;
  const value = await compute();
  await cache.set(key, value, ttlSeconds);
  return value;
}

// Usage
const weather = await getCached(
  `weather:${city}`,
  () => fetchWeatherApi(city),
  600,  // 10-minute cache
);
```

---

## Namespace by tenant or agent

```ts
function scopedStore(store: Storage, prefix: string): Storage {
  return {
    set:    (k, v, ttl) => store.set(`${prefix}:${k}`, v, ttl),
    get:    (k)         => store.get(`${prefix}:${k}`),
    has:    (k)         => store.has(`${prefix}:${k}`),
    delete: (k)         => store.delete(`${prefix}:${k}`),
    list:   (p)         => store.list(`${prefix}:${p}`),
    clear:  ()          => Promise.resolve(),  // intentionally no-op on scoped stores
  };
}

const baseStore = createStorage({ driver: 'file', basePath: './data' });
const acmeStore = scopedStore(baseStore, 'tenant:acme');
const betaStore = scopedStore(baseStore, 'tenant:beta');
```

---

## Storage vs other state layers

| Layer | Use for | Backed by |
|---|---|---|
| **Storage** | Caches, run metadata, config, durable outputs | `createStorage()` |
| **Session** | Conversation turn history | `createSqliteSessionStore()` |
| **Memory** | Agent recall — facts, preferences | `InMemoryStore` / `createDbMemoryStore()` |
| **Knowledge** | Document retrieval index | `createKnowledgeEngine()` |

Storage is the broadest layer. Reach for it when the data doesn't naturally belong to a conversation, a user's long-term memory, or a document index.

---

## Where to go next

- [Storage guide](../guide/storage) — design advice and driver configuration
- [07 · Storage Patterns](../examples/07-storage) — runnable storage examples
- [Multi-tenancy](../guide/multi-tenancy) — `TenantScopedSessionStore` for per-tenant isolation
