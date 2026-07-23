---
title: 22 · Eval Regression Guard
description: Run automated eval suites with runEvalSuite() to catch regressions before they ship. Score outputs, track baselines, and integrate with CI.
outline: [2, 3]
---

# 22 · Eval Regression Guard

Evals answer one question: "Is this agent still behaving correctly?" `runEvalSuite()` runs a dataset of input/expected-output pairs against your agent, scores each response, tracks a baseline, and fails if the average score drops beyond a threshold. Run it in CI and catch regressions before they reach production.

```ts
import { runEvalSuite, wordOverlapF1 } from 'personaforge/observe';
```

---

## What you'll learn

- How to define an eval dataset
- How to run a suite and inspect the report
- How to set a baseline and detect regressions
- How to write a custom scorer
- How to persist baselines with `SqliteEvalStore` for CI

---

## Basic eval suite

```ts
import { createAgent } from 'personaforge';
import {
  InMemoryEvalStore,
  runEvalSuite,
  wordOverlapF1,
  type EvalDatasetItem,
} from 'personaforge/observe';

// ── Dataset ──────────────────────────────────────────────────────────────────
const dataset: EvalDatasetItem[] = [
  {
    input: 'What is the return policy?',
    expectedOutput: 'You can return any item within 30 days for a full refund.',
  },
  {
    input: 'How do I track my order?',
    expectedOutput: 'Visit the Orders page or check your confirmation email for a tracking link.',
  },
  {
    input: 'Do you offer free shipping?',
    expectedOutput: 'Free standard shipping is available on orders over $50.',
  },
  {
    input: 'How long does delivery take?',
    expectedOutput: 'Standard shipping takes 3–5 business days. Express takes 1–2 business days.',
  },
];

// ── Agent ────────────────────────────────────────────────────────────────────
const supportAgent = createAgent({
  name: 'support-agent',
  instructions: [
    'You are a customer support assistant.',
    'Return policy: 30 days for a full refund.',
    'Order tracking: Orders page or confirmation email.',
    'Free shipping: Orders over $50.',
    'Delivery: Standard 3–5 days, Express 1–2 days.',
  ].join(' '),
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

// ── Scorer: word overlap F1 (0–1) ────────────────────────────────────────────
const scorer = (_input: string, expected: string | undefined, actual: string) =>
  expected ? wordOverlapF1(actual, expected) : 0;

// ── Run the suite ─────────────────────────────────────────────────────────────
const report = await runEvalSuite({
  suiteName: 'support-qa-v1',
  dataset,
  agent: supportAgent,
  store: new InMemoryEvalStore(),
  scorer,
  passingScore: 0.6,         // minimum acceptable score per item
  regressionThreshold: 0.05, // fail if average drops more than 5% below baseline
  setBaseline: true,         // record this run as the baseline
});

console.log('Average score:', report.averageScore.toFixed(3));
console.log('Passed:',        report.passed);
console.log('Items:',         report.results.length);

// Per-item breakdown
for (const item of report.results) {
  const icon = item.passed ? '✓' : '✗';
  console.log(`${icon} [${item.score.toFixed(3)}] "${item.input.slice(0, 60)}"`);
}
```

---

## Detect regressions against a saved baseline

On subsequent runs, omit `setBaseline: true` so the suite compares against the stored baseline:

```ts
const report = await runEvalSuite({
  suiteName: 'support-qa-v1',
  dataset,
  agent: supportAgent,
  store: evalStore,        // same store as before
  scorer,
  passingScore: 0.6,
  regressionThreshold: 0.05,
  // setBaseline: false    ← default; compare against stored baseline
});

if (!report.passed) {
  console.error(
    `Regression detected: average score ${report.averageScore.toFixed(3)} ` +
    `dropped more than 5% below baseline ${report.baselineScore?.toFixed(3)}`,
  );
  process.exit(1);  // fail the CI job
}
```

---

## Persistent baselines with `SqliteEvalStore`

`InMemoryEvalStore` loses history on restart. Use `SqliteEvalStore` to persist baselines across CI runs.

```ts
import { createAgent } from 'personaforge';
import {
  createSqliteEvalStore,
  runEvalSuite,
  wordOverlapF1,
} from 'personaforge/observe';

const store = await createSqliteEvalStore('./evals.db');

const report = await runEvalSuite({
  suiteName: 'support-qa-v1',
  dataset,
  agent: supportAgent,
  store,
  scorer: (_i, expected, actual) =>
    expected ? wordOverlapF1(actual, expected) : 0,
  passingScore: 0.6,
  regressionThreshold: 0.05,
});

console.log('Passed:', report.passed);
```

In CI, mount `evals.db` as a persistent artifact or store it in a shared location so the baseline persists between pipeline runs.

---

## Custom scorer

`wordOverlapF1` works well for factual recall. Write a custom scorer for other quality dimensions:

```ts
// Exact match scorer
const exactMatch = (_input: string, expected: string | undefined, actual: string) => {
  if (!expected) return 0;
  return actual.trim().toLowerCase() === expected.trim().toLowerCase() ? 1 : 0;
};

// Keyword presence scorer
const keywords = ['30 days', 'refund', 'return'];
const keywordScorer = (_input: string, _expected: string | undefined, actual: string) => {
  const text = actual.toLowerCase();
  const hits = keywords.filter((k) => text.includes(k)).length;
  return hits / keywords.length;
};

// LLM-as-judge scorer (semantic similarity)
const llmJudge = async (
  input: string,
  expected: string | undefined,
  actual: string,
): Promise<number> => {
  if (!expected) return 0;
  const judgement = await judgeAgent.run(
    `Rate how well this answer matches the expected answer on a scale 0–1.\n` +
    `Expected: ${expected}\nActual: ${actual}\n\nReturn only a number.`,
  );
  return parseFloat(judgement.text) || 0;
};
```

---

## CI integration (GitHub Actions)

```yaml
# .github/workflows/eval.yml
name: Eval Regression Guard

on:
  pull_request:
    paths:
      - 'src/**'
      - 'evals/**'

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Restore eval baseline
        uses: actions/cache@v4
        with:
          path: evals.db
          key: eval-baseline-${{ github.base_ref }}
          restore-keys: eval-baseline-

      - name: Install dependencies
        run: npm ci

      - name: Run eval suite
        run: npx tsx evals/run.ts
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

      - name: Save eval baseline
        if: github.ref == 'refs/heads/main'
        uses: actions/cache@v4
        with:
          path: evals.db
          key: eval-baseline-${{ github.ref_name }}
```

---

## `runEvalSuite` options reference

| Option | Required | Description |
|---|---|---|
| `suiteName` | ✓ | Stable name — used for baseline lookups |
| `dataset` | ✓ | Array of `{ input, expectedOutput }` items |
| `agent` | ✓ | Any agent created with `createAgent()` or `bare()` |
| `store` | ✓ | `InMemoryEvalStore` or `createSqliteEvalStore()` |
| `scorer` | ✓ | `(input, expected, actual) => number` (0–1) |
| `passingScore` | — | Minimum score for a single item to pass (default: 0.5) |
| `regressionThreshold` | — | Max allowed drop from baseline (default: 0.1) |
| `setBaseline` | — | Save this run as the new baseline (default: false) |

---

## What's next?

- [12 · Observability & Hooks](./12-observability) — instrument runs before evaluating them
- [Eval guide](../guide/eval) — full eval API reference, judge scorers, and dataset formats
