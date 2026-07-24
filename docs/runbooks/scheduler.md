---
title: "Runbook: Scheduler"
description: "Operational runbook for personaforge/scheduler — import, run, verify, recover. 33 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Scheduler

> Auto-generated from `./dist/scheduler.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/scheduler`  ·  **Public symbols:** 33  ·  **Guide:** [/guide/scheduler](../guide/scheduler.md)

## What it is
`personaforge/scheduler` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { validateCronExpr, computeNextRun, InMemoryScheduleStore } from 'personaforge/scheduler';
```

## Public API surface
- **Factories / functions** — `validateCronExpr`, `computeNextRun`
- **Classes** — `InMemoryScheduleStore`, `InMemoryScheduleRunStore`, `ScheduleManager`, `DbScheduleStore`, `SchedulerTools`
- **Interfaces** — `Schedule`, `ScheduleRun`, `ScheduleStore`, `ScheduleRunStore`, `ScheduleManagerConfig`, `SessionRow`, `MemoryRow`, `LearningRow`, `KnowledgeRow`, `TraceRow`, `ScheduleRow`, `SessionQuery`, …(+9)
- **Types** — `HttpMethod`, `ScheduleStatus`, `CreateScheduleInput`, `UpdateScheduleInput`, `LearningType`

## Minimal use
Real example from the scheduler guide:

```ts
import {
  ScheduleManager,
  InMemoryScheduleStore,
  InMemoryScheduleRunStore,
  DbScheduleStore,
  validateCronExpr,
  computeNextRun,
} from 'personaforge/scheduler';
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
