---
title: "Runbook: Workflow"
description: "Operational runbook for personaforge/workflow — import, run, verify, recover. 355 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Workflow

> Auto-generated from `./dist/workflow.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/workflow`  ·  **Public symbols:** 355  ·  **Guide:** [/guide/workflows](../guide/workflows.md)

## What it is
`personaforge/workflow` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createGraph, compose, pipe } from 'personaforge/workflow';
```

## Public API surface
- **Factories / functions** — `compose`, `pipe`, `uid`, `createGraph`, `replayState`, `redactSecrets`, `redactPII`, `combineRedactors`, `buildReplayProvider`, `buildReplayTools`, `replay`, `verifyChain`, …(+26)
- **Classes** — `GraphBuilder`, `DAGEngine`, `DurableExecutor`, `InMemoryEventStore`, `SqliteEventStore`, `BatchingEventStore`, `RunRecorder`, `InMemoryTaskQueue`, `RedisTaskQueue`, `DefaultScheduler`, `GraphWorker`, `DistributedEngine`, …(+24)
- **Constants** — `nodeId`, `edgeId`, `graphId`, `executionId`, `workerId`
- **Enums** — `NodeKind`, `NodeStatus`, `ExecutionStatus`, `GraphEventType`, `CoordinationType`
- **Interfaces** — `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, `LLMProvider`, `Tool`, `ToolRegistry`, `TextContent`, `ImageContent`, `OpenAIToolCall`, `AgentRunOptions`, …(+232)
- **Types** — `EntityId`, `MessageContent`, `StreamChunk`, `ContentPart`, `ToolParameters`, `AdapterCategory`, `SqlRow`, `VectorMetric`, `AnalyticsExportFormat`, `BudgetExceededAction`, `McpAuthConfig`, `CompressionAlgorithm`, …(+15)

## Minimal use
```ts
import { createGraph, compose, pipe } from 'personaforge/workflow';

// `createGraph` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = createGraph(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/workflow` with no missing-module error.
- Runtime: `node -e "import('personaforge/workflow').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/workflows](../guide/workflows.md).

## Common failures
- `Cannot find module 'personaforge/workflow'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/workflows](../guide/workflows.md)
