---
title: "Runbook: Router"
description: "Operational runbook for personaforge/router — import, run, verify, recover. 5 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Router

> Auto-generated from `./src/router/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/router`  ·  **Public symbols:** 5  ·  **Guide:** [/guide/llm-router](../guide/llm-router.md)

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
- **Interfaces** — `ModelCost`, `RouterOptions`, `RoutingDecision`

## Minimal use
Real example from the llm-router guide:

```ts
import { createCostOptimizedRouter, createQualityFirstRouter, createSpeedOptimizedRouter } from 'personaforge';

const cheap   = createCostOptimizedRouter(entries);
const quality = createQualityFirstRouter(entries);
const fast    = createSpeedOptimizedRouter(entries);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/router` with no missing-module error.
- Runtime: `node -e "import('personaforge/router').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/llm-router](../guide/llm-router.md).

## Common failures
- `Cannot find module 'personaforge/router'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/llm-router](../guide/llm-router.md)
