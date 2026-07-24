---
title: "Runbook: Agentic"
description: "Operational runbook for personaforge/agentic — import, run, verify, recover. 54 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Agentic

> Auto-generated from `./dist/agentic.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/agentic`  ·  **Public symbols:** 54

## What it is
`personaforge/agentic` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createStructuredAgent, toToolRegistry, background } from 'personaforge/agentic';
```

## Public API surface
- **Factories / functions** — `toToolRegistry`, `background`, `toolToLLMDefinition`, `createStructuredAgent`, `createAgenticAgent`
- **Classes** — `AgenticRunner`, `StructuredOutputError`
- **Enums** — `ToolCategory`
- **Interfaces** — `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, `LLMProvider`, `TextContent`, `ImageContent`, `OpenAIToolCall`, `EventRecorder`, `ToolPermissions`, `ToolError`, …(+29)
- **Types** — `EntityId`, `MessageContent`, `ToolParameters`, `ToolProvider`, `BudgetExceededAction`

## Minimal use
```ts
import { createStructuredAgent, toToolRegistry, background } from 'personaforge/agentic';

// `createStructuredAgent` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = createStructuredAgent(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/agentic` with no missing-module error.
- Runtime: `node -e "import('personaforge/agentic').then(m => console.log(Object.keys(m)))"` lists the exports above.

## Common failures
- `Cannot find module 'personaforge/agentic'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
