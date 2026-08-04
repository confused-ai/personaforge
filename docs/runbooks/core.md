---
title: "Runbook: Core"
description: "Operational runbook for personaforge/core — import, run, verify, recover. 0 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Core

> Auto-generated from `./src/core/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/core`  ·  **Public symbols:** 0  ·  **Guide:** [/guide/concepts](../guide/concepts.md)

## What it is
`personaforge/core` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import 'personaforge/core';
```

## Public API surface
- _No named runtime exports; import for side effects or types._

## Minimal use
This entry exposes types/interfaces only. Import the symbols you need for typing:

```ts
import 'personaforge/core';
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/core` with no missing-module error.
- Runtime: `node -e "import('personaforge/core').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/concepts](../guide/concepts.md).

## Common failures
- `Cannot find module 'personaforge/core'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/concepts](../guide/concepts.md)
