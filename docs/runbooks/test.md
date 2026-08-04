---
title: "Runbook: Test"
description: "Operational runbook for personaforge/test — import, run, verify, recover. 2 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Test

> Auto-generated from `./src/test.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/test`  ·  **Public symbols:** 2  ·  **Guide:** [/guide/eval](../guide/eval.md)

## What it is
`personaforge/test` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { mockAgent, scenario } from 'personaforge/test';
```

## Public API surface
- **Factories / functions** — `mockAgent`, `scenario`

## Minimal use
```ts
import { mockAgent, scenario } from 'personaforge/test';

// `mockAgent` is the primary entry for this feature.
// See the type signature for full options.
const result = mockAgent(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/test` with no missing-module error.
- Runtime: `node -e "import('personaforge/test').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/eval](../guide/eval.md).

## Common failures
- `Cannot find module 'personaforge/test'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/eval](../guide/eval.md)
