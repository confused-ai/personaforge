---
title: "Runbook: Test"
description: "Operational runbook for personaforge/test — import, run, verify, recover. 258 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Test

> Auto-generated from `./dist/test.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/test`  ·  **Public symbols:** 258  ·  **Guide:** [/guide/eval](../guide/eval.md)

## What it is
`personaforge/test` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createMockAgent, createScenarioRunner, createTestInstructions } from 'personaforge/test';
```

## Public API surface
- **Factories / functions** — `createMockAgent`, `createScenarioRunner`, `createTestInstructions`, `createTestUserId`, `createTestSessionId`, `waitFor`, `createMockToolResponse`, `sleep`, `assertEqual`, `assertNotNull`, `createTestMetadata`, `createTestAgent`, …(+7)
- **Classes** — `ScenarioRunner`, `MockLLMProvider`, `MockSessionStore`, `MockMemoryStore`, `MockToolRegistry`
- **Interfaces** — `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, `LLMProvider`, `Tool`, `SessionRow`, `MemoryRow`, `LearningRow`, `KnowledgeRow`, `TraceRow`, …(+191)
- **Types** — `LearningType`, `EntityId`, `MessageContent`, `ContentPart`, `ToolParameters`, `SafeParseResult`, `InferToolSchema`, `SessionId`, `AdapterCategory`, `SqlRow`, `VectorMetric`, `AnalyticsExportFormat`, …(+19)

## Minimal use
```ts
import { createMockAgent, createScenarioRunner, createTestInstructions } from 'personaforge/test';

// `createMockAgent` is the primary entry for this feature.
// See the type signature for full options.
const result = createMockAgent(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/test` with no missing-module error.
- Runtime: `node -e "import('personaforge/test').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/eval](../guide/eval.md).

## Common failures
- `Cannot find module 'personaforge/test'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/eval](../guide/eval.md)
