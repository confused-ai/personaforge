---
title: Goals
description: Durable, thread-scoped objectives evaluated in-loop by an LLM judge. Keep an agent working toward a standing goal until it passes, times out, or exhausts its run budget.
outline: [2, 3]
---

# Goals

`personaforge/goals` adds durable, thread-scoped objectives to an agent. A goal is a standing instruction the agent keeps working toward **across loop iterations** until a judge model decides it's satisfied, a run budget is exhausted, or the loop hits a step cap. Objectives persist in thread state, so they survive reloads and are still judged when a new message arrives mid-run.

```ts
import { InMemoryGoalStore, createSqliteGoalStore } from 'personaforge/goals';
```

---

## Quick start

Goals are configured on the agent and driven per-thread:

```ts
import { agent } from 'personaforge';

const worker = agent({
  instructions: 'You complete software tasks end to end.',
  model: 'openai/gpt-5',                     // main agent
  goal: {
    judge: 'openai/gpt-5-mini',              // judge model
    maxRuns: 50,                             // per-objective budget
  },
});

// Set a durable objective scoped to a thread:
await worker.setObjective('Add and test a /health endpoint', {
  threadId: 'thread-42',
  resourceId: 'user-7',
});

// Each stream()/run() now works toward the objective in-loop:
const stream = await worker.stream('Start working on the goal', {
  memory: { thread: 'thread-42', resource: 'user-7' },
});

// The loop emits `goal` events as the judge evaluates:
for await (const chunk of stream) {
  if (chunk.type === 'goal') {
    console.log('iteration', chunk.goal.iteration,
                'passed?', chunk.goal.passed,
                'reason:', chunk.goal.reason);
  }
}
```

---

## How the loop uses the goal

Each model iteration:

1. The judge (`GoalRunConfig.judge`) receives the agent's current output.
2. If `passed` → the loop stops with `finishReason: 'stop'`.
3. If not passed → the judge's `reason` is fed back as revision feedback and the loop continues.
4. The loop stops with `finishReason: 'max_runs'` when `maxRuns` is exhausted, `maxSteps` forces a stop, or the judge produced no actionable feedback.

A `StreamChunk` with `type: 'goal'` carries the `GoalEvaluation` (see below) so you can observe progress in real time.

---

## Objective records

The in-loop judge reads the thread's `ObjectiveRecord`:

```ts
interface ObjectiveRecord {
  objective: string;
  threadId?: string;
  resourceId?: string;
  maxRuns?: number;        // per-objective budget override
  runsUsed: number;
  status: 'active' | 'done' | 'paused';
  activeDurationMs?: number;
  updatedAt: string;
  prompt?: string;         // per-objective judge prompt override
}
```

### Managing objectives at runtime

The agent surface exposes runtime goal management:

```ts
// Set / get / update / clear per-thread objectives:
await worker.setObjective('Fix the flaky test', { threadId: 't9', maxRuns: 20 });
const rec = await worker.getObjective({ threadId: 't9' });
await worker.updateObjectiveOptions({ threadId: 't9', maxRuns: 100, prompt: 'Be lenient about style.' });
await worker.clearObjective({ threadId: 't9' });
```

---

## Goal stores

### In-memory (development / tests)

```ts
import { InMemoryGoalStore } from 'personaforge/goals';
```

### SQLite (production) — survives restarts

```ts
import { createSqliteGoalStore } from 'personaforge/goals';

const store = createSqliteGoalStore('./agent.db'); // requires better-sqlite3
```

When using `createAgent`/`agent`, the factory auto-creates a SQLite goal store when `AGENT_DB_PATH` is set (falling back to in-memory if `better-sqlite3` isn't installed). Pass `goalStore` explicitly to override:

```ts
const worker = agent({
  instructions: '...',
  goal: { judge: 'openai/gpt-5-mini' },
  goalStore: createSqliteGoalStore('./prod.db'),
});
```

---

## LLM judges

The goal feature is built on `personaforge/goals` judges — LLM-as-judge scoring for the agentic loop:

```ts
import { createLlmJudge, createStaticJudge, createRubricScorer, createSchemaScorer } from 'personaforge/goals';

// LLM judge with a custom prompt:
const judge = createLlmJudge({
  llm: myLlmProvider,
  prompt: 'You are a strict completeness judge. Respond with JSON.',
});

// Deterministic predicate judge:
const staticJudge = createStaticJudge((text) => text.includes('DONE'));

// Rubric (checklist) scorer with a backing LLM judge:
const rubric = createRubricScorer({
  judge,
  criteria: [
    { description: 'lists acceptance criteria', required: true },
    { description: 'explains test strategy' },
  ],
  requireAll: true,
});

// Schema-validated scorer:
const schemaScorer = createSchemaScorer(myOutputSchema);
```

Judges return a `JudgeVerdict`: `{ passed, reason?, score? }`.

---

## Related pages

- [Durable Agents](./durable) — resumable runs that pair with goals.
- [Learning](./learning-machine) — continuous improvement / feedback.
- [Agents](./agents) — `agent()` options reference.