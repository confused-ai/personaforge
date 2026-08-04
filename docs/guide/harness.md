---
title: Harness & Evaluation
description: Evaluate agents, tasks, workflows, or functions against a golden dataset in one call. A/B test models, prompt variants, and capture cost/token/latency with a JSON-serialisable report.
outline: [2, 3]
---

# Harness & Evaluation

`personaforge/harness` is the "best-harness" single command for evaluating any runnable against a golden dataset — score every sample, capture cost/token/latency, and when you pass multiple subjects, compare them head-to-head (A/B, model comparison, prompt variants) and emit a winner per metric.

```ts
import { evaluate, fromAgent } from 'personaforge/harness';
```

---

## Quick start

```ts
import { evaluate, fromAgent } from 'personaforge/harness';
import { exactMatchScorer } from 'personaforge/eval';

const report = await evaluate({
  name: 'classifier-ab',
  dataset: [
    { id: '1', input: 'what is 2+2?', expected: '4' },
    { id: '2', input: 'cap of france', expected: 'paris' },
  ],
  subject: {
    baseline: agentA,     // model A
    candidate: agentB,    // model B
  },
  scorers: [exactMatchScorer()],
  concurrency: 4,
});

console.log(report.comparison);   // winner per metric
console.log(report.variants[0].benchmark.summary.passRate);
console.log(report.toJSON());     // JSON-serialisable
```

---

## Subjects

A `HarnessSubject` is any of:

- A **plain function** `(input: string) => unknown`
- An **agent-like** object with `.run(input, options?)` — `CreateAgentResult`, `TaskHandle`, `MockAgent`, …
- A **workflow-like** object with `.execute(input?)`

```ts
import {
  toHarnessRunner, fromAgent, fromTask, fromWorkflow, fromFn,
} from 'personaforge/harness';

const runAgent = fromAgent(myAgent);                 // CreateAgentResult
const runTask  = fromTask(myTask);                   // TaskHandle → .run()
const runWf    = fromWorkflow(myWorkflow);           // Workflow → .execute()
const runFn    = fromFn(async (q) => q.length);      // plain function

// Normalise any subject into `(input) => Promise<RunOutcome>`:
const runner = toHarnessRunner(myAgent, { sessionId: 'eval-1' });
const outcome = await runner('what is 2+2?');
// outcome.output      → text fed to scorers
// outcome.raw         → full raw result
// outcome.latencyMs   → wall time
// outcome.tokensUsed? → when reported
// outcome.costUsd?    → when reported / costOf provided
```

---

## A/B model comparison

Pass a record of named variants to compare head-to-head:

```ts
const report = await evaluate({
  name: 'router-bench',
  dataset,
  subject: {
    gpt4o:    agentWith('openai/gpt-4o'),
    mini:     agentWith('openai/gpt-4o-mini'),
    llama:    agentWith('groq/llama-3.3-70b'),
  },
  scorers: [exactMatchScorer()],
  concurrency: 4,
});

// `report.comparison` → [{ metric: 'score', winner: 'gpt4o', … }, …]
// Also compares latency_ms, tokens, cost_usd when captured.
```

---

## Report

`HarnessReport` exposes:

- `variants` — per-variant benchmark + usage summaries
- `comparison` — winner per metric (`score | latency_ms | tokens | cost_usd`)
- `passes` — true when every evaluated variant meets the pass threshold (default `0.7`)
- `toJSON()` — JSON-serialisable snapshot for CI
- `formatMarkdown()` — human-readable markdown report
- `timestamp`, `durationMs`

---

## Options

```ts
interface EvaluateOptions {
  name: string;
  dataset: BenchmarkSample[];                       // { id?, input, expected? }
  subject: HarnessSubject | Record<string, HarnessSubject>;
  scorers?: Scorer[];                               // from personaforge/eval
  concurrency?: number;                             // default 1
  passThreshold?: number;                           // default 0.7
  sessionId?: string;
  costOf?: (raw: unknown) => number | undefined;    // extract USD cost
  onSample?: (variant, result, index, total) => void;
  only?: string[];                                  // restrict variants by name
}
```

---

## Related pages

- [Evaluation & Benchmarking](./eval) — scorers, datasets, CI baselines.
- [Creating Agents](./agents) — agent subjects.
- [Workflows](./workflows) — workflow subjects.
- [Runbooks](../runbooks/) — operational runbooks for every module.