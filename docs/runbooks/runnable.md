---
title: "Runbook: Runnable"
description: "Operational runbook for personaforge/runnable — import, run, verify, recover. 6 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Runnable

> Auto-generated from `./src/runnable/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/runnable`  ·  **Public symbols:** 6  ·  **Guide:** [/guide/runnable](../guide/runnable.md)

## What it is
`personaforge/runnable` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { Runnable, RunnableLambda, RunnableSequence } from 'personaforge/runnable';
```

## Public API surface
- **Classes** — `Runnable`, `RunnableLambda`, `RunnableSequence`, `RunnableParallel`, `RunnablePassthrough`
- **Interfaces** — `RunnableConfig`

## Minimal use
```ts
import { Runnable, RunnableLambda, RunnableSequence } from 'personaforge/runnable';

// `Runnable` is the primary entry for this feature.
// See the guide/type signature for full options.
const instance = new Runnable(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/runnable` with no missing-module error.
- Runtime: `node -e "import('personaforge/runnable').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/runnable](../guide/runnable.md).

## Common failures
- `Cannot find module 'personaforge/runnable'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/runnable](../guide/runnable.md)
