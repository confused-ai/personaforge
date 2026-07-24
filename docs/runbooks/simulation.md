---
title: "Runbook: Simulation"
description: "Operational runbook for personaforge/simulation — import, run, verify, recover. 30 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Simulation

> Auto-generated from `./dist/simulation.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/simulation`  ·  **Public symbols:** 30

## What it is
`personaforge/simulation` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { simulate, trainsetFromReport } from 'personaforge/simulation';
```

## Public API surface
- **Factories / functions** — `simulate`, `trainsetFromReport`
- **Interfaces** — `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, `LLMProvider`, `Tool`, `ToolRegistry`, `TextContent`, `ImageContent`, `OpenAIToolCall`, `AgentRunResult`, …(+11)
- **Types** — `MessageContent`, `NodeId`, `GraphId`, `ExecutionId`, `WorkerId`

## Minimal use
```ts
import { simulate, trainsetFromReport } from 'personaforge/simulation';

// `simulate` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = simulate(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/simulation` with no missing-module error.
- Runtime: `node -e "import('personaforge/simulation').then(m => console.log(Object.keys(m)))"` lists the exports above.

## Common failures
- `Cannot find module 'personaforge/simulation'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
