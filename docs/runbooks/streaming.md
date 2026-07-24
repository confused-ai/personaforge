---
title: "Runbook: Streaming"
description: "Operational runbook for personaforge/streaming — import, run, verify, recover. 11 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Streaming

> Auto-generated from `./src/streaming/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/streaming`  ·  **Public symbols:** 11  ·  **Guide:** [/guide/stream-utils](../guide/stream-utils.md)

## What it is
`personaforge/streaming` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createStreamableRun, StreamEventBus, StreamContext } from 'personaforge/streaming';
```

## Public API surface
- **Factories / functions** — `createStreamableRun`
- **Classes** — `StreamEventBus`, `StreamContext`
- **Interfaces** — `ValueEvent`, `UpdateEvent`, `TokenEvent`, `ToolCallEvent`, `DebugEvent`, `CustomEvent`
- **Types** — `StreamMode`, `StreamEvent`

## Minimal use
```ts
import { createStreamableRun, StreamEventBus, StreamContext } from 'personaforge/streaming';

// `createStreamableRun` is the primary entry for this feature.
// See the type signature for full options.
const result = createStreamableRun(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/streaming` with no missing-module error.
- Runtime: `node -e "import('personaforge/streaming').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/stream-utils](../guide/stream-utils.md).

## Common failures
- `Cannot find module 'personaforge/streaming'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/stream-utils](../guide/stream-utils.md)
