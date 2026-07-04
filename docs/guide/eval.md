---
title: Evaluation
description: Score agent outputs with LLM-as-judge, text metrics, benchmark suites, regression detection, and eval dataset persistence.
outline: [2, 3]
---

# Evaluation

The evaluation framework gives you LLM-as-judge scoring, text metrics (ROUGE-L, word overlap), benchmark runners, persistent eval stores, and CI regression detection. Import from `confused-ai`.

## LLM-as-judge

Score a response against a prompt with an LLM:

```ts
import { runLlmAsJudge, OpenAIProvider } from 'confused-ai';

const llm = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY!, model: 'gpt-4o-mini' });

const result = await runLlmAsJudge({
  llm,
  rubric: 'Award full marks for an explanation that is factually correct, easy for a non-expert to follow, and concise.',
  candidate: agentResult.text,
  // reference: 'optional gold answer to compare against',
  maxScore: 10,   // default 10
});

console.log(result.score);      // 0 – maxScore (default 10)
console.log(result.rationale);  // judge explanation
```

### Pre-built criteria sets

```ts
import { createMultiCriteriaJudge, RAG_CRITERIA, AGENT_CRITERIA } from 'confused-ai';

// For RAG agents: relevance, groundedness, completeness, conciseness
const ragJudge = createMultiCriteriaJudge({ llm, criteria: RAG_CRITERIA });
const ragResult = await ragJudge({ candidate: response, reference: expected });

// For general agents: task_completion, correctness, helpfulness, safety
const agentJudge = createMultiCriteriaJudge({ llm, criteria: AGENT_CRITERIA });
const agentResult2 = await agentJudge({ candidate: response });
```

### Multi-criteria judge

```ts
import { createMultiCriteriaJudge } from 'confused-ai';

const judge = createMultiCriteriaJudge({
  llm,
  criteria: AGENT_CRITERIA,
});

// The judge is a function: call it with the candidate (and optional reference/context)
const scores = await judge({ candidate: response, reference: expected });
console.log(scores.overallScore);  // mean normalised score, 0–1
console.log(scores.criteria);      // per-criterion breakdown
```

---

## Text metrics

Fast, deterministic metrics that require no LLM:

```ts
import {
  ExactMatchAccuracy,
  PartialMatchAccuracy,
  LevenshteinAccuracy,
  wordOverlapF1,
  rougeLWords,
} from 'confused-ai';

// These accuracy metrics are ready-to-use objects, not classes — no `new`, no config.

// Exact string match
console.log(ExactMatchAccuracy.score('hello world', 'hello world')); // 1.0
console.log(ExactMatchAccuracy.score('hello world', 'Hello World')); // 0.0

// Partial (substring) match — case-insensitive; 0.5 for a partial hit
console.log(PartialMatchAccuracy.score('hello world', 'hello'));  // 0.5

// Normalized edit distance
console.log(LevenshteinAccuracy.score('kitten', 'sitting')); // 0.57

// Word overlap F1 (great for longer text)
console.log(wordOverlapF1('the cat sat on the mat', 'the cat sat'));  // 0.75

// ROUGE-L (longest common subsequence)
console.log(rougeLWords('the cat sat on the mat', 'cat sat on mat'));  // 0.83
```

---

## Batch eval runner

Run an eval against a dataset and collect aggregate metrics:

```ts
import { runEvalBatch, createMultiCriteriaJudge, AGENT_CRITERIA } from 'confused-ai';

// runEvalBatch scores pre-computed candidate outputs against a multi-criteria judge.
const judge = createMultiCriteriaJudge({ llm, criteria: AGENT_CRITERIA });

const cases = [
  { id: '1', candidate: agentAnswer1, reference: '4' },
  { id: '2', candidate: agentAnswer2, reference: 'Paris' },
  { id: '3', candidate: agentAnswer3, reference: 'Shakespeare' },
];

const summary = await runEvalBatch({
  judge,
  cases,
  concurrency: 3,
});

console.log(summary.total, summary.succeeded, summary.failed);
console.log(summary.meanOverallScore);  // mean overall score across cases, 0–1
console.log(summary.criteriaScores);    // mean score per criterion
```

---

## Benchmark pipeline

Run a full benchmark with multiple scorers and get a formatted report:

```ts
import {
  runBenchmark,
  exactMatchScorer,
  containsScorer,
  wordOverlapScorer,
  rougeLScorer,
  llmJudgeScorer,
  formatBenchmarkReport,
} from 'confused-ai/eval';

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
    rougeLScorer(),
    llmJudgeScorer({ llm, rubric: 'Award full marks for a correct, complete answer.' }),
  ],
  concurrency: 5,
});

console.log(formatBenchmarkReport(report));
```

---

## Eval store — persist and query results

```ts
import { InMemoryEvalStore, createSqliteEvalStore, runEvalSuite } from 'confused-ai';

// Development: in-memory
const store = new InMemoryEvalStore();

// Production: SQLite (the factory takes a plain path string)
const store2 = createSqliteEvalStore('./evals.db');

const dataset = [
  { input: 'How do I reset my password?', expectedOutput: 'Use the "Forgot password" link on the sign-in page.' },
  { input: 'What are your support hours?', expectedOutput: 'We are available 24/7.' },
];

const report = await runEvalSuite({
  suiteName: 'customer-service-v2',
  dataset,
  agent,
  store: store2,
});

// Query stored runs for this suite (newest first)
const history = await store2.queryRuns('customer-service-v2', 10);
console.log(history.map(r => ({ date: r.timestamp, avgScore: r.averageScore })));
```

---

## Regression detection (CI/CD)

Compare a new eval run against a baseline and fail if scores drop:

```ts
import { runEvalSuite } from 'confused-ai';

const report = await runEvalSuite({
  suiteName: 'regression-check',
  dataset,
  agent,
  store,
  regressionThreshold: 0.05,   // fail if avg score drops > 5% from the stored baseline
});

if (!report.passed) {
  console.error(`Regression detected! Score delta vs baseline: ${report.regressionDelta}`);
  process.exit(1);
}
```

---

## Dataset loading

```ts
import { loadDataset } from 'confused-ai/eval';

// JSON array or JSON lines
const jsonlCases = await loadDataset({ source: './evals/qa.jsonl' });

// CSV — columns are matched by header name (defaults: 'input' / 'expected')
const csvCases = await loadDataset({
  source: './evals/qa.csv',
  inputColumn: 'question',
  expectedColumn: 'answer',
});

// Pass raw text instead of a file path
const rawCases = await loadDataset({ source: '{"input":"...","expected":"..."}', raw: true });

// Inline
const inlineCases = [
  { input: '...', expected: '...' },
];
```

---

## Fine-tuning dataset generator

Collect high-quality runs and export them as fine-tuning data:

```ts
import { generateDataset, filterByScore } from 'confused-ai/eval';
import { writeFile } from 'node:fs/promises';

// Your collected runs as training examples (input / output, with a quality score 0–10)
const examples = [
  { input: 'What is TypeScript?', output: 'TypeScript is a typed superset of JavaScript.', score: 9.5 },
  // ...more examples
];

// Keep only high-quality examples
const highQuality = filterByScore(examples, { minScore: 9 });

// Serialize to a fine-tuning format: 'openai' | 'alpaca' | 'sharegpt'
const jsonl = generateDataset(highQuality, { format: 'openai' });
await writeFile('./finetune-data.jsonl', jsonl, 'utf-8');

console.log(`Exported ${highQuality.length} examples`);
```

---

## Where to go next

- [Observability](./observability) — trace and measure agent runs in production.
- [Production](./production) — circuit breakers, budget tracking, and rate limits.
- [Examples: eval CI pipeline](../examples/22-eval-ci) — complete CI regression example.
