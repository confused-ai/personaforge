---
title: 20 · Scheduled Agents
description: Run agents on a cron schedule using ScheduleManager. Register handlers, create cron schedules, trigger on demand, and inspect run history.
outline: [2, 3]
---

# 20 · Scheduled Agents

`ScheduleManager` lets you register agent handlers, define cron-based schedules, trigger runs manually, and inspect history — all without an external job queue. It's the right primitive for daily digests, health checks, report generation, and any periodic task an agent should own.

```ts
import { ScheduleManager } from 'personaforge/scheduler';
```

---

## What you'll learn

- How to register an agent as a schedule handler
- How to create cron-based schedules with `manager.create()`
- How to trigger a schedule on demand with `manager.trigger()`
- How to inspect run history
- When to use the polling loop vs on-demand triggering

---

## Daily market digest

```ts
import { createAgent } from 'personaforge';
import {
  InMemoryScheduleRunStore,
  InMemoryScheduleStore,
  ScheduleManager,
} from 'personaforge/scheduler';

// ── Agent ────────────────────────────────────────────────────────────────────
const digestAgent = createAgent({
  name: 'market-digest',
  instructions: [
    'You receive a JSON payload with market data.',
    'Return a short, plain-English digest summarising the most important signals.',
    'Keep it under 150 words.',
  ].join(' '),
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

// ── Schedule manager ─────────────────────────────────────────────────────────
const manager = new ScheduleManager({
  store: new InMemoryScheduleStore(),
  runStore: new InMemoryScheduleRunStore(),
  pollIntervalMs: 60_000,   // check for due schedules every 60 seconds
});

// ── Register the handler ─────────────────────────────────────────────────────
manager.register('market-digest', async (payload) => {
  const result = await digestAgent.run(JSON.stringify(payload ?? {}));
  return { delivered: true, summary: result.text };
});

// ── Create the schedule ──────────────────────────────────────────────────────
const scheduleId = await manager.create({
  name: 'Weekday market digest',
  cronExpr: '0 9 * * 1-5',   // 9am Monday–Friday
  endpoint: 'market-digest',
  enabled: true,
  payload: {
    symbols: ['AAPL', 'MSFT', 'GOOGL'],
    date: new Date().toISOString().slice(0, 10),
  },
});

console.log('Schedule created:', scheduleId);

// ── Trigger immediately for testing ─────────────────────────────────────────
const run = await manager.trigger(scheduleId);
console.log('Run status:', run.status);
// → 'completed'
console.log('Output:', run.output);
// → { delivered: true, summary: '...' }
```

---

## Inspect run history

```ts
// Get the last 10 runs for a schedule
const runs = await manager.getRuns(scheduleId, 10);

for (const run of runs) {
  console.log(`[${run.startedAt.toISOString()}] ${run.status} — ${run.durationMs}ms`);
}

// Get a single run by ID
const latest = await manager.getRun(run.runId);
console.log(latest.output);
```

---

## Multiple schedules with different cadences

```ts
import { createAgent } from 'personaforge';
import {
  InMemoryScheduleRunStore,
  InMemoryScheduleStore,
  ScheduleManager,
} from 'personaforge/scheduler';

const manager = new ScheduleManager({
  store: new InMemoryScheduleStore(),
  runStore: new InMemoryScheduleRunStore(),
  pollIntervalMs: 30_000,
});

// Hourly health check agent
const healthAgent = createAgent({
  name: 'health-check',
  instructions: 'Analyse the provided metrics JSON and flag any anomalies.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

// Weekly summary agent
const summaryAgent = createAgent({
  name: 'weekly-summary',
  instructions: 'Produce a concise weekly summary from the provided data.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
});

// Register handlers
manager.register('health-check', async (payload) => {
  const result = await healthAgent.run(JSON.stringify(payload));
  return { alert: result.text.toLowerCase().includes('anomaly'), summary: result.text };
});

manager.register('weekly-summary', async (payload) => {
  const result = await summaryAgent.run(JSON.stringify(payload));
  return { report: result.text };
});

// Create schedules
await manager.create({
  name: 'Hourly health check',
  cronExpr: '0 * * * *',       // every hour
  endpoint: 'health-check',
  enabled: true,
  payload: { service: 'api-gateway' },
});

await manager.create({
  name: 'Weekly business summary',
  cronExpr: '0 8 * * 1',       // Monday 8am
  endpoint: 'weekly-summary',
  enabled: true,
  payload: { period: 'last-7-days' },
});

// Start the polling loop
await manager.start();
console.log('Scheduler running');
```

---

## Pause and resume schedules

```ts
// Disable a schedule (won't fire until re-enabled)
await manager.update(scheduleId, { enabled: false });

// Re-enable it
await manager.update(scheduleId, { enabled: true });

// Delete a schedule entirely
await manager.delete(scheduleId);
```

---

## Persistent schedules across restarts

Swap the in-memory stores for SQLite-backed stores so schedules survive process restarts:

```ts
import {
  createSqliteScheduleStore,
  createSqliteScheduleRunStore,
  ScheduleManager,
} from 'personaforge/scheduler';

const manager = new ScheduleManager({
  store: await createSqliteScheduleStore('./schedules.db'),
  runStore: await createSqliteScheduleRunStore('./schedules.db'),
  pollIntervalMs: 60_000,
});
```

---

## Polling loop vs on-demand triggering

| Mode | Use when |
|---|---|
| `manager.start()` | Continuous daemon — schedules fire automatically at their cron times |
| `manager.trigger(id)` | Tests, backfills, or manually-triggered runs |

For production, call `manager.start()` in a long-running process. For tests or one-off runs, use `manager.trigger()` without starting the loop.

---

## What's next?

- [21 · Code Review Pipeline](./21-code-review-pipeline) — compose agents into processing pipelines
- [22 · Eval Regression Guard](./22-eval-ci) — evaluate scheduled agent outputs in CI
- [Scheduler guide](../guide/scheduler) — full `ScheduleManager` API reference
