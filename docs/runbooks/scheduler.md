---
title: "Runbook: Scheduler"
description: "Operational runbook for personaforge/scheduler — import, run, verify, recover. 0 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Scheduler

> Auto-generated from `./src/scheduler/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/scheduler`  ·  **Public symbols:** 0  ·  **Guide:** [/guide/scheduler](../guide/scheduler.md)

## What it is
`personaforge/scheduler` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import 'personaforge/scheduler';
```

## Public API surface
- _No named runtime exports; import for side effects or types._

## Minimal use
Real example from the scheduler guide:

```ts
import { createAgent } from 'personaforge';
import { ScheduleManager } from 'personaforge/scheduler';

const agent = createAgent({
  name: 'daily-reporter',
  instructions: 'Generate a concise daily business summary.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

const scheduler = new ScheduleManager();

// Register a handler function by key
scheduler.register('daily-report', async () => {
  const result = await agent.run('Generate the daily business summary for today.');
  await saveReport(result.text);
  console.log('Daily report saved.');
});

// Create a schedule — create() returns the new schedule's id (a string).
const id = await scheduler.create({
  name: 'Daily Business Report',
  cronExpr: '0 8 * * *',        // 08:00 every day (evaluated in UTC)
  endpoint: 'daily-report',     // matches the registered handler key
  enabled: true,
  maxRetries: 3,
  retryDelaySeconds: 300,
});

// Start the schedule runner (poll-based)
scheduler.start();

// Later, stop cleanly
process.on('SIGTERM', () => scheduler.stop());
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/scheduler` with no missing-module error.
- Runtime: `node -e "import('personaforge/scheduler').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/scheduler](../guide/scheduler.md).

## Common failures
- `Cannot find module 'personaforge/scheduler'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/scheduler](../guide/scheduler.md)
