---
title: "Runbook: Observability"
description: "Operational runbook for personaforge/observability — import, run, verify, recover. 83 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Observability

> Auto-generated from `./dist/observability.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/observability`  ·  **Public symbols:** 83  ·  **Guide:** [/guide/observability](../guide/observability.md)

## What it is
`personaforge/observability` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createMultiCriteriaJudge, wordOverlapF1, rougeLWords } from 'personaforge/observability';
```

## Public API surface
- **Factories / functions** — `wordOverlapF1`, `rougeLWords`, `runLlmAsJudge`, `createMultiCriteriaJudge`, `runEvalBatch`, `parseTraceparent`, `generateTraceparent`, `childSpan`, `extractTraceContext`, `injectTraceHeaders`, `buildTraceparent`, `sendLangfuseBatch`, …(+3)
- **Classes** — `ConsoleLogger`, `InMemoryTracer`, `MetricsCollectorImpl`, `EvalAggregator`, `OTLPTraceExporter`, `OTLPMetricsExporter`, `InMemoryEvalStore`, `SqliteEvalStore`
- **Constants** — `ExactMatchAccuracy`, `PartialMatchAccuracy`, `LevenshteinAccuracy`, `RAG_CRITERIA`, `AGENT_CRITERIA`
- **Enums** — `LogLevel`, `SpanStatus`, `MetricType`, `AgentEventType`, `TaskEventType`, `ExportFormat`
- **Interfaces** — `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, `LLMProvider`, `LogEntry`, `LogContext`, `Logger`, `LogTransport`, `TraceSpan`, `SpanEvent`, …(+34)
- **Types** — `EntityId`, `MultiCriteriaJudge`, `EvalScorer`

## Minimal use
```ts
import { createMultiCriteriaJudge, wordOverlapF1, rougeLWords } from 'personaforge/observability';

// `createMultiCriteriaJudge` is the primary entry for this feature.
// See the type signature for full options.
const result = createMultiCriteriaJudge(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/observability` with no missing-module error.
- Runtime: `node -e "import('personaforge/observability').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/observability](../guide/observability.md).

## Common failures
- `Cannot find module 'personaforge/observability'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/observability](../guide/observability.md)
