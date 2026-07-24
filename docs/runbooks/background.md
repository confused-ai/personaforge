---
title: "Runbook: Background"
description: "Operational runbook for personaforge/background — import, run, verify, recover. 20 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Background

> Auto-generated from `./dist/background.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/background`  ·  **Public symbols:** 20  ·  **Guide:** [/guide/background-queues](../guide/background-queues.md)

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
Real example from the background-queues guide:

```ts
import { createAgent } from 'personaforge';
import { InMemoryBackgroundQueue, queueHook } from 'personaforge/background';

// In-memory queue — no dependencies, good for dev/test
const queue = new InMemoryBackgroundQueue({ concurrency: 5 });

const agent = createAgent({
  name: 'analytics-agent',
  instructions: 'Help users with their questions.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  hooks: {
    // Dispatch post-run analytics to the queue without blocking the response
    afterRun: queueHook(queue, 'analytics', (result) => ({
      steps:  result.steps,
      tokens: result.usage?.totalTokens,
      runId:  result.runId,
    })),
  },
});

// Register the worker handler (same or separate process)
await queue.consume('analytics', async (task) => {
  await analyticsService.track('agent.run', task.payload);
});

// …see full example in the guide
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/background` with no missing-module error.
- Runtime: `node -e "import('personaforge/background').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/background-queues](../guide/background-queues.md).

## Common failures
- `Cannot find module 'personaforge/background'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/background-queues](../guide/background-queues.md)
