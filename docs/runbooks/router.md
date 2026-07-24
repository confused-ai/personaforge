---
title: "Runbook: Router"
description: "Operational runbook for personaforge/router — import, run, verify, recover. 11 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Router

> Auto-generated from `./dist/router.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/router`  ·  **Public symbols:** 11

## What it is
`personaforge/router` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createCostOptimizedRouter } from 'personaforge/router';
```

## Public API surface
- **Factories / functions** — `createCostOptimizedRouter`
- **Constants** — `DEFAULT_COSTS`
- **Interfaces** — `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, `LLMProvider`, `ModelCost`, `RouterOptions`, `RoutingDecision`

## Minimal use
```ts
import { createCostOptimizedRouter } from 'personaforge/router';

// `createCostOptimizedRouter` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = createCostOptimizedRouter(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/router` with no missing-module error.
- Runtime: `node -e "import('personaforge/router').then(m => console.log(Object.keys(m)))"` lists the exports above.

## Common failures
- `Cannot find module 'personaforge/router'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
