---
title: "Runbook: Context"
description: "Operational runbook for personaforge/context — import, run, verify, recover. 10 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Context

> Auto-generated from `./dist/context.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/context`  ·  **Public symbols:** 10

## What it is
`personaforge/context` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { ContextBackend, ContextProvider } from 'personaforge/context';
```

## Public API surface
- **Classes** — `ContextBackend`, `ContextProvider`
- **Enums** — `ContextMode`
- **Interfaces** — `Status`, `Document`, `Answer`, `QueryOptions`, `UpdateOptions`, `BackendTool`, `ProviderConfig`

## Minimal use
```ts
import { ContextBackend, ContextProvider } from 'personaforge/context';

// `ContextBackend` is the primary entry for this feature.
// See the guide/type signature for full options.
const instance = new ContextBackend(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/context` with no missing-module error.
- Runtime: `node -e "import('personaforge/context').then(m => console.log(Object.keys(m)))"` lists the exports above.

## Common failures
- `Cannot find module 'personaforge/context'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
