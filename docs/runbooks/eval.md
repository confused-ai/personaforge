---
title: "Runbook: Eval"
description: "Operational runbook for personaforge/eval — import, run, verify, recover. 90 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Eval

> Auto-generated from `./dist/eval.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/eval`  ·  **Public symbols:** 90  ·  **Guide:** [/guide/eval](../guide/eval.md)

## What it is
`personaforge/eval` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createSqliteEvalStore, wordOverlapF1, rougeLWords } from 'personaforge/eval';
```

## Public API surface
- **Factories / functions** — `wordOverlapF1`, `rougeLWords`, `createSqliteEvalStore`, `runEvalSuite`, `runLlmAsJudge`, `createMultiCriteriaJudge`, `runEvalBatch`, `loadDataset`, `runRegression`, `printRegressionReport`, `generateDataset`, `writeSplitDataset`, …(+14)
- **Classes** — `EvalAggregator`, `InMemoryEvalStore`, `SqliteEvalStore`, `MetricsCollectorImpl`
- **Constants** — `ExactMatchAccuracy`, `PartialMatchAccuracy`, `LevenshteinAccuracy`, `RAG_CRITERIA`, `AGENT_CRITERIA`
- **Enums** — `MetricType`
- **Interfaces** — `EvalResult`, `EvalStats`, `AccuracyEvaluator`, `CreateAgentResult`, `EvalDatasetItem`, `EvalDatasetResult`, `EvalSuiteRun`, `EvalReport`, `RunEvalSuiteOptions`, `EvalStore`, `Message`, `LLMToolDefinition`, …(+38)
- **Types** — `EvalScorer`, `MultiCriteriaJudge`, `DatasetFormat`, `ScorerFn`

## Minimal use
Real example from the eval guide:

```ts
import {
  runBenchmark,
  exactMatchScorer,
  containsScorer,
  wordOverlapScorer,
  rougeLScorer,
  llmJudgeScorer,
  formatBenchmarkReport,
} from 'personaforge/eval';

const report = await runBenchmark({
  name: 'qa-benchmark-v3',
  dataset: [
    { input: 'What is the boiling point of water?', expected: '100°C' },
    { input: 'Who invented the telephone?',          expected: 'Alexander Graham Bell' },
  ],
  // `run` receives the input string as the first argument
  run: async (input) => {
    const result = await agent.run(input);
    return result.text;
  },
  // Built-in scorers take no arguments
  scorers: [
    exactMatchScorer(),
    containsScorer(),
    wordOverlapScorer(),
// …see full example in the guide
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/eval` with no missing-module error.
- Runtime: `node -e "import('personaforge/eval').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/eval](../guide/eval.md).

## Common failures
- `Cannot find module 'personaforge/eval'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/eval](../guide/eval.md)
