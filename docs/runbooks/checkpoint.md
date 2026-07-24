---
title: "Runbook: Checkpoint"
description: "Operational runbook for personaforge/checkpoint — import, run, verify, recover. 9 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Checkpoint

> Auto-generated from `./src/checkpoint/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/checkpoint`  ·  **Public symbols:** 9  ·  **Guide:** [/guide/checkpoint](../guide/checkpoint.md)

## What it is
`personaforge/checkpoint` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { InterruptSignal, InMemoryCheckpointStore, DurableExecutor } from 'personaforge/checkpoint';
```

## Public API surface
- **Classes** — `InterruptSignal`, `InMemoryCheckpointStore`, `DurableExecutor`
- **Interfaces** — `Checkpoint`, `CheckpointStore`, `InterruptContext`, `DurableExecutorConfig`, `RunResult`
- **Types** — `NodeFn`

## Minimal use
Real example from the checkpoint guide:

```ts
import {
  DurableExecutor, InMemoryCheckpointStore, InterruptSignal,
} from 'personaforge/checkpoint';
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/checkpoint` with no missing-module error.
- Runtime: `node -e "import('personaforge/checkpoint').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/checkpoint](../guide/checkpoint.md).

## Common failures
- `Cannot find module 'personaforge/checkpoint'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/checkpoint](../guide/checkpoint.md)
