---
title: "Runbook: Lite"
description: "Operational runbook for personaforge/lite — import, run, verify, recover. 149 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Lite

> Auto-generated from `./dist/lite.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/lite`  ·  **Public symbols:** 149  ·  **Guide:** [/guide/getting-started](../guide/getting-started.md)

## What it is
`personaforge/lite` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createAgent, agent, bare } from 'personaforge/lite';
```

## Public API surface
- **Factories / functions** — `createAgent`, `agent`, `bare`, `defineAgent`, `compose`, `pipe`
- **Interfaces** — `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, `LLMProvider`, `Tool`, `TextContent`, `ImageContent`, `OpenAIToolCall`, `EventRecorder`, `MultiModalInput`, …(+116)
- **Types** — `EntityId`, `MessageContent`, `ContentPart`, `ToolParameters`, `SafeParseResult`, `InferToolSchema`, `AdapterCategory`, `SqlRow`, `VectorMetric`, `AnalyticsExportFormat`, `AnyAdapter`, `BudgetExceededAction`, …(+3)

## Minimal use
Real example from the getting-started guide:

```ts
import { createAgent } from 'personaforge';

const assistant = createAgent({
	name: 'hello-agent',
	model: 'gpt-4o-mini',
	instructions: 'You are a concise and helpful assistant.',
});

const result = await assistant.run('What is the capital of France?');
console.log(result.text);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/lite` with no missing-module error.
- Runtime: `node -e "import('personaforge/lite').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/getting-started](../guide/getting-started.md).

## Common failures
- `Cannot find module 'personaforge/lite'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/getting-started](../guide/getting-started.md)
