---
title: "Runbook: Execution"
description: "Operational runbook for personaforge/execution — import, run, verify, recover. 91 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Execution

> Auto-generated from `./dist/execution.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/execution`  ·  **Public symbols:** 91

## What it is
`personaforge/execution` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createThreadPool, createStep, executeParallel } from 'personaforge/execution';
```

## Public API surface
- **Factories / functions** — `createThreadPool`, `createStep`, `executeParallel`, `stateMachine`
- **Classes** — `ExecutionEngineImpl`, `ExecutionGraphBuilder`, `WorkerPool`, `ThreadPool`, `StateGraph`, `StateNode`, `WorkflowExecutor`, `StepExecutor`, `PipelineBuilder`, `BackpressureQueue`, `InMemoryEventStore`, `DurableWorkflowContext`, …(+4)
- **Constants** — `EngineEvent`
- **Enums** — `BackoffStrategy`, `ExecutionNodeStatus`, `ExecutionState`, `NodeType`, `TransitionType`, `WorkflowStatus`, `StepPriority`
- **Interfaces** — `Task`, `TaskMetadata`, `TaskResult`, `TaskError`, `Plan`, `PlanMetadata`, `PlanExecutionResult`, `ExecutionEngineConfig`, `ExecutionRetryPolicy`, `ExecutionContext`, `TaskExecutionMetadata`, `TaskExecutor`, …(+39)
- **Types** — `EntityId`, `ExecutionEventType`, `ExecutionEventHandler`, `ExecutionId`, `ThreadJob`, `WorkflowStepStatus`, `EngineEventType`, `EventHandler`, `WorkflowEventType`, `WorkflowFunction`, `AgentLifecycleState`, `StateMachineConfig`

## Minimal use
```ts
import { createThreadPool, createStep, executeParallel } from 'personaforge/execution';

// `createThreadPool` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = createThreadPool(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/execution` with no missing-module error.
- Runtime: `node -e "import('personaforge/execution').then(m => console.log(Object.keys(m)))"` lists the exports above.

## Common failures
- `Cannot find module 'personaforge/execution'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
