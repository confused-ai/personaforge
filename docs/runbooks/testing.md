---
title: "Runbook: Testing"
description: "Operational runbook for personaforge/testing — import, run, verify, recover. 256 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Testing

> Auto-generated from `./dist/testing.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/testing`  ·  **Public symbols:** 256

## What it is
`personaforge/testing` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createTestInstructions, createTestUserId, createTestSessionId } from 'personaforge/testing';
```

## Public API surface
- **Factories / functions** — `createTestInstructions`, `createTestUserId`, `createTestSessionId`, `waitFor`, `createMockToolResponse`, `sleep`, `assertEqual`, `assertNotNull`, `createTestMetadata`, `createTestAgent`, `createTestHttpService`, `createMockLLMProvider`, …(+5)
- **Classes** — `MockLLMProvider`, `MockSessionStore`, `MockMemoryStore`, `MockToolRegistry`, `ScenarioRunner`
- **Interfaces** — `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, `LLMProvider`, `Tool`, `SessionRow`, `MemoryRow`, `LearningRow`, `KnowledgeRow`, `TraceRow`, …(+191)
- **Types** — `LearningType`, `EntityId`, `MessageContent`, `ContentPart`, `SessionId`, `ToolParameters`, `SafeParseResult`, `InferToolSchema`, `EmbeddingFn`, `BudgetExceededAction`, `IdempotencyState`, `ApprovalStatus`, …(+19)

## Minimal use
```ts
import { createTestInstructions, createTestUserId, createTestSessionId } from 'personaforge/testing';

// `createTestInstructions` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = createTestInstructions(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/testing` with no missing-module error.
- Runtime: `node -e "import('personaforge/testing').then(m => console.log(Object.keys(m)))"` lists the exports above.

## Common failures
- `Cannot find module 'personaforge/testing'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
