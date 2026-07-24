---
title: "Runbook: Control Plane"
description: "Operational runbook for personaforge/control-plane — import, run, verify, recover. 3 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Control Plane

> Auto-generated from `./src/control-plane/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/control-plane`  ·  **Public symbols:** 3  ·  **Guide:** [/guide/control-plane](../guide/control-plane.md)

## What it is
`personaforge/control-plane` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createControlPlane } from 'personaforge/control-plane';
```

## Public API surface
- **Factories / functions** — `createControlPlane`
- **Interfaces** — `ControlPlaneConfig`, `ControlPlaneServer`

## Minimal use
```ts
import { createControlPlane } from 'personaforge/control-plane';

// `createControlPlane` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = createControlPlane(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/control-plane` with no missing-module error.
- Runtime: `node -e "import('personaforge/control-plane').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/control-plane](../guide/control-plane.md).

## Common failures
- `Cannot find module 'personaforge/control-plane'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/control-plane](../guide/control-plane.md)
