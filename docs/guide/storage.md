---
title: Storage
description: Key-value and blob storage with in-memory, file-system, and custom adapters. Plug in S3, Redis, R2, or any backend via StorageAdapter.
outline: [2, 3]
---

# Storage

`createStorage()` gives you a typed, JSON-serializing key-value store on top of a pluggable `StorageAdapter`. Use it for durable run state, cached results, generated outputs, or any application data that should survive beyond a single agent run.

```ts
import { createStorage } from 'personaforge';
```

---

## Quick start

```ts
import { createStorage } from 'personaforge';

// In-memory (dev / testing)
const store = createStorage();

await store.set('user:alice', { name: 'Alice', plan: 'pro' });
const user = await store.get<{ name: string; plan: string }>('user:alice');
console.log(user?.plan); // 'pro'

await store.has('user:alice');      // true
await store.list('user:');          // ['user:alice']
await store.delete('user:alice');
```

---

## Drivers

### In-memory (default)

Data lives only for the process lifetime. No config needed — ideal for development and testing.

```ts
const store = createStorage();
// equivalent to:
const store2 = createStorage({ driver: 'memory' });
```

### File system

Persists JSON files under a base directory. Suitable for local single-node deployments.

```ts
const store = createStorage({
  driver: 'file',
  basePath: './data',     // directory created automatically
});

await store.set('config', { theme: 'dark' });
// writes to ./data/config.json
```

### Custom adapter (S3, Redis, R2, etc.)

Implement the `StorageAdapter` interface to use any backend:

```ts
import type { StorageAdapter } from 'personaforge';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

class S3StorageAdapter implements StorageAdapter {
  private s3 = new S3Client({});
  private bucket = process.env.S3_BUCKET!;

  async get(key: string): Promise<string | undefined> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.Body?.transformToString();
    } catch { return undefined; }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: value }));
  }

  async delete(key: string): Promise<void> { /* ... */ }
  async list(prefix?: string): Promise<string[]> { /* ... */ return []; }
  async has(key: string): Promise<boolean> { /* ... */ return false; }
}

const store = createStorage({ adapter: new S3StorageAdapter() });
```

---

## Storage interface

```ts
interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;  // ttl in seconds
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  readonly adapter: StorageAdapter;
}
```

---

## Attach to agent

An agent can write its generated outputs to storage automatically:

```ts
const agent = createAgent({
  name: 'report-writer',
  instructions: '...',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  storage: createStorage({ driver: 'file', basePath: './outputs' }),
});

const result = await agent.run('Write a quarterly summary.', { runId: 'q2-2026' });
console.log(result.storageKey); // key where the output was saved
```

---

## TTL (time-to-live)

```ts
// Expire after 1 hour
await store.set('cache:result-123', expensiveResult, 3_600);
```

---

## Namespacing pattern

Use key prefixes to keep different concerns separate:

```ts
// Separate namespaces using prefixes
await store.set('run:abc123:result', runResult);
await store.set('user:alice:prefs', prefs);
await store.set('cache:llm:sha256abc', cachedResponse);

const runKeys  = await store.list('run:');     // all run keys
const userKeys = await store.list('user:');    // all user keys
```

---

## Where to go next

- [Session](./session) — conversation continuity across turns.
- [Memory](./memory) — retain and recall facts inside agents.
- [Database](./database) — relational storage via AgentDb.
