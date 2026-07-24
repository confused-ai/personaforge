---
title: "Runbook: Background"
description: "Operational runbook for personaforge/background — import, run, verify, recover. 20 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Background

> Auto-generated from `./dist/background.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/background`  ·  **Public symbols:** 20

## What it is
`personaforge/background` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { queueHook, generateTaskId, InMemoryBackgroundQueue } from 'personaforge/background';
```

## Public API surface
- **Factories / functions** — `queueHook`, `generateTaskId`
- **Classes** — `InMemoryBackgroundQueue`, `BullMQBackgroundQueue`, `RedisPubSubBackgroundQueue`, `KafkaBackgroundQueue`, `RabbitMQBackgroundQueue`, `SQSBackgroundQueue`
- **Interfaces** — `BackgroundTask`, `EnqueueOptions`, `BackgroundQueue`, `BullMQBackgroundQueueOptions`, `RedisPublisher`, `RedisSubscriber`, `RedisPubSubBackgroundQueueOptions`, `KafkaBackgroundQueueOptions`, `RabbitMQBackgroundQueueOptions`, `SQSBackgroundQueueOptions`
- **Types** — `BackgroundTaskHandler`, `QueuedHook`

## Minimal use
```ts
import { queueHook, generateTaskId, InMemoryBackgroundQueue } from 'personaforge/background';

// `queueHook` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = queueHook(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/background` with no missing-module error.
- Runtime: `node -e "import('personaforge/background').then(m => console.log(Object.keys(m)))"` lists the exports above.

## Common failures
- `Cannot find module 'personaforge/background'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
