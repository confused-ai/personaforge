---
title: "Runbook: Dx"
description: "Operational runbook for personaforge/dx — import, run, verify, recover. 153 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Dx

> Auto-generated from `./dist/dx.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/dx`  ·  **Public symbols:** 153  ·  **Guide:** [/guide/getting-started](../guide/getting-started.md)

## What it is
`personaforge/dx` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { defineAgent, agent, bare } from 'personaforge/dx';
```

## Public API surface
- **Factories / functions** — `agent`, `bare`, `defineAgent`, `compose`, `pipe`, `buildPersonaInstructions`, `definePersona`, `createDevLogger`, `createDevToolMiddleware`
- **Interfaces** — `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, `LLMProvider`, `Tool`, `TextContent`, `ImageContent`, `OpenAIToolCall`, `EventRecorder`, `MultiModalInput`, …(+117)
- **Types** — `EntityId`, `MessageContent`, `ContentPart`, `ToolParameters`, `SafeParseResult`, `InferToolSchema`, `AdapterCategory`, `SqlRow`, `VectorMetric`, `AnalyticsExportFormat`, `AnyAdapter`, `BudgetExceededAction`, …(+3)

## Minimal use
```ts
import { defineAgent, agent, bare } from 'personaforge/dx';

// `defineAgent` is the primary entry for this feature.
// See the type signature for full options.
const result = defineAgent(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/dx` with no missing-module error.
- Runtime: `node -e "import('personaforge/dx').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/getting-started](../guide/getting-started.md).

## Common failures
- `Cannot find module 'personaforge/dx'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/getting-started](../guide/getting-started.md)
