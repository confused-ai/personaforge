---
title: "Runbook: Graph"
description: "Operational runbook for personaforge/graph — import, run, verify, recover. 1 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Graph

> Auto-generated from `./src/graph/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/graph`  ·  **Public symbols:** 1  ·  **Guide:** [/guide/graph](../guide/graph.md)

## What it is
`personaforge/graph` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { wrapCoreLLM } from 'personaforge/graph';
```

## Public API surface
- **Factories / functions** — `wrapCoreLLM`

## Minimal use
Real example from the graph guide:

```ts
import { replay, buildReplayProvider, buildReplayTools, replayState } from 'personaforge/graph';

const result = await replay(store, executionId, {
  name: 'researcher',
  instructions: 'Research the given topic thoroughly.',
});

// …or build the replay provider / tool registry yourself:
const llm   = await buildReplayProvider(store, executionId);
const tools = await buildReplayTools(store, executionId);

// Reconstruct the full GraphState from an event log:
const events = await store.load(executionId);
const state  = replayState(events, graph);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/graph` with no missing-module error.
- Runtime: `node -e "import('personaforge/graph').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/graph](../guide/graph.md).

## Common failures
- `Cannot find module 'personaforge/graph'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/graph](../guide/graph.md)
