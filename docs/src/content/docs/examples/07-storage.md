---
title: "07 · Storage Patterns"
---

# 07 · Storage Patterns

`createStorage()` exposes a small typed key-value API with in-memory and file-backed drivers.

## What you'll learn

- How to use the default in-memory driver
- How to persist values to disk with the file driver
- How prefix-based listing works in the current storage API

## Current pattern

```ts
import { createStorage } from 'personaforge/storage';

const cache = createStorage();

await cache.set('weather:tokyo', { tempC: 24, condition: 'sunny' }, 300);
console.log(await cache.get('weather:tokyo'));
console.log(await cache.has('weather:tokyo'));

const diskStore = createStorage({
  driver: 'file',
  basePath: './data/storage',
});

await diskStore.set('runs:latest', { id: 'run_123', status: 'completed' });

console.log(await diskStore.get('runs:latest'));
console.log(await diskStore.list('runs:'));
```

## Notes

- The default driver is in-memory.
- File-backed storage uses `driver: 'file'` with `basePath`, not `type: 'file'`.
- The listing method is `list(prefix)`, not `keys(pattern)`.
- TTL is the third positional argument to `set()` and is expressed in seconds.

## What's next?

- [08 · Multi-Agent Team](./08-team)
- [Production Resilience](/examples/13-production)