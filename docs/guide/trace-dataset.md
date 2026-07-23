---
title: Trace ↔ Dataset Loop
description: Turn production trace spans into eval datasets, replay them against a new agent version, and diff results to catch regressions — spanToSample, replayDataset, diffResults, summarizeDiff.
outline: [2, 3]
---

# Trace ↔ Dataset Loop

The `personaforge/eval` module closes the LangSmith-style feedback loop: capture a real production interaction, turn it into an eval sample, replay it against a new prompt or model, and diff the results to catch regressions before shipping.

```ts
import {
  spanToSample, replayDataset, diffResults, summarizeDiff,
} from 'personaforge/eval';
```

---

## The workflow

1. **Capture** a trace span from production.
2. **Convert** it to an `EvalSample` with `spanToSample`.
3. **Replay** the dataset against a candidate agent version with `replayDataset`.
4. **Diff** candidate vs baseline with `diffResults`, then summarise with `summarizeDiff`.

---

## 1. Capture and convert

```ts
const sample = spanToSample({
  id: span.id,
  name: 'agent.run',
  input: span.input,
  output: span.output,        // becomes the expected value
  startTime: span.startTime,
  endTime: span.endTime,
  metadata: { model: 'gpt-4o' },
});

dataset.push(sample);
```

`spanToSample` tags the sample with `metadata.source = 'trace'` so trace-derived samples are distinguishable from hand-authored ones.

---

## 2. Replay

Run every sample through a candidate run function, in parallel:

```ts
const results = await replayDataset(
  dataset,
  (input) => candidateAgent.run(input),   // returns string or { text }
  { concurrency: 4 },
);
// ReplayResult[] — { sample, output, durationMs }
```

---

## 3. Diff

Compare two replay runs (same order and length):

```ts
const baseline = await replayDataset(dataset, (i) => currentAgent.run(i));
const candidate = await replayDataset(dataset, (i) => newAgent.run(i));

const diffs = diffResults(baseline, candidate);
```

Each `DiffEntry` reports:

```ts
{
  sampleId, input, expected,
  baselineOutput, newOutput,
  unchanged,                    // outputs identical?
  baselineMatchesExpected,      // did the old version match ground truth?
  newMatchesExpected,           // did the new version?
}
```

---

## 4. Summarise for CI

```ts
const summary = summarizeDiff(diffs);
// { total, unchanged, changed, regressions, improvements }

if (summary.regressions > 0) {
  console.error(`❌ ${summary.regressions} regressions detected`);
  process.exit(1);
}
```

A **regression** is a sample the baseline got right and the candidate got wrong. An **improvement** is the reverse. Wire this into a CI gate to block PRs that regress golden traces.

---

## Example CI script

```ts
const dataset = productionSpans.map((s) => spanToSample(s));
const baseline = await replayDataset(dataset, (i) => mainBranchAgent.run(i));
const candidate = await replayDataset(dataset, (i) => prBranchAgent.run(i));
const summary = summarizeDiff(diffResults(baseline, candidate));

console.log(`Improvements: ${summary.improvements}, Regressions: ${summary.regressions}`);
process.exit(summary.regressions > 0 ? 1 : 0);
```

---

## Related pages

- [Evaluation & Benchmarking](/guide/eval) — accuracy metrics and LLM-as-judge.
- [Observability](/guide/observability) — where trace spans come from.
- [Control Plane](/guide/control-plane) — browse traces and eval runs in a dashboard.
