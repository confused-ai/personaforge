---
title: "Runbook: Structured"
description: "Operational runbook for personaforge/structured — import, run, verify, recover. 7 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Structured

> Auto-generated from `./src/structured/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/structured`  ·  **Public symbols:** 7

## What it is
`personaforge/structured` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { detectProviderKind, generateStructured } from 'personaforge/structured';
```

## Public API surface
- **Factories / functions** — `detectProviderKind`, `generateStructured`
- **Interfaces** — `JsonSchema`, `StructuredSchema`, `StructuredOutputOptions`, `StructuredOutputResult`
- **Types** — `ProviderKind`

## Minimal use
```ts
import { detectProviderKind, generateStructured } from 'personaforge/structured';

// `detectProviderKind` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = detectProviderKind(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/structured` with no missing-module error.
- Runtime: `node -e "import('personaforge/structured').then(m => console.log(Object.keys(m)))"` lists the exports above.

## Common failures
- `Cannot find module 'personaforge/structured'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
