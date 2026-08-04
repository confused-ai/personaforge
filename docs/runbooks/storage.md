---
title: "Runbook: Storage"
description: "Operational runbook for personaforge/storage — import, run, verify, recover. 6 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Storage

> Auto-generated from `./src/storage/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/storage`  ·  **Public symbols:** 6  ·  **Guide:** [/guide/storage](../guide/storage.md)

## What it is
`personaforge/storage` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createStorage, MemoryStorageAdapter, FileStorageAdapter } from 'personaforge/storage';
```

## Public API surface
- **Factories / functions** — `createStorage`
- **Classes** — `MemoryStorageAdapter`, `FileStorageAdapter`
- **Interfaces** — `StorageAdapter`, `Storage`, `StorageOptions`

## Minimal use
Real example from the storage guide:

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

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/storage` with no missing-module error.
- Runtime: `node -e "import('personaforge/storage').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/storage](../guide/storage.md).

## Common failures
- `Cannot find module 'personaforge/storage'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/storage](../guide/storage.md)
