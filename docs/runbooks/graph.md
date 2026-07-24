---
title: "Runbook: Graph"
description: "Operational runbook for personaforge/graph — import, run, verify, recover. 120 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Graph

> Auto-generated from `./dist/graph.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/graph`  ·  **Public symbols:** 120  ·  **Guide:** [/guide/graph](../guide/graph.md)

## What it is
`personaforge/graph` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createGraph, uid, replayState } from 'personaforge/graph';
```

## Public API surface
- **Factories / functions** — `uid`, `createGraph`, `replayState`, `redactSecrets`, `redactPII`, `combineRedactors`, `buildReplayProvider`, `buildReplayTools`, `replay`, `verifyChain`, `computeWaves`, `agentNode`, …(+1)
- **Classes** — `GraphBuilder`, `DAGEngine`, `DurableExecutor`, `InMemoryEventStore`, `SqliteEventStore`, `BatchingEventStore`, `RunRecorder`, `InMemoryTaskQueue`, `RedisTaskQueue`, `DefaultScheduler`, `GraphWorker`, `DistributedEngine`, …(+12)
- **Constants** — `nodeId`, `edgeId`, `graphId`, `executionId`, `workerId`
- **Enums** — `NodeKind`, `NodeStatus`, `ExecutionStatus`, `GraphEventType`
- **Interfaces** — `RetryPolicy`, `TimeoutPolicy`, `GraphNodeDef`, `AgentNodeConfig`, `WaitConfig`, `GraphEdgeDef`, `GraphDef`, `NodeState`, `GraphState`, `NodeContext`, `NodeLogger`, `GraphEvent`, …(+54)
- **Types** — `NodeId`, `EdgeId`, `GraphId`, `ExecutionId`, `WorkerId`, `NodeConfig`, `MessageContent`, `LogLevel`

## Minimal use
```ts
import { createGraph, uid, replayState } from 'personaforge/graph';

// `createGraph` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = createGraph(/* opts */);
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
