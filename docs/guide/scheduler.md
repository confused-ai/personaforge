---
title: Scheduler
description: Run agents on a cron schedule with ScheduleManager, in-memory and SQLite schedule stores, run history, and durable persistence.
outline: [2, 3]
---

# Scheduler

The scheduler module lets you register cron-based jobs that invoke agents or custom handlers automatically. Use `ScheduleManager` for in-process scheduling and `DbScheduleStore` for durable schedule persistence.

```ts
import {
  ScheduleManager,
  InMemoryScheduleStore,
  InMemoryScheduleRunStore,
  DbScheduleStore,
  validateCronExpr,
  computeNextRun,
} from 'personaforge/scheduler';
```

---

## Quick start

```ts
import { createAgent } from 'personaforge';
import { ScheduleManager } from 'personaforge/scheduler';

const agent = createAgent({
  name: 'daily-reporter',
  instructions: 'Generate a concise daily business summary.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

const scheduler = new ScheduleManager();

// Register a handler function by key
scheduler.register('daily-report', async () => {
  const result = await agent.run('Generate the daily business summary for today.');
  await saveReport(result.text);
  console.log('Daily report saved.');
});

// Create a schedule — create() returns the new schedule's id (a string).
const id = await scheduler.create({
  name: 'Daily Business Report',
  cronExpr: '0 8 * * *',        // 08:00 every day (evaluated in UTC)
  endpoint: 'daily-report',     // matches the registered handler key
  enabled: true,
  maxRetries: 3,
  retryDelaySeconds: 300,
});

// Start the schedule runner (poll-based)
scheduler.start();

// Later, stop cleanly
process.on('SIGTERM', () => scheduler.stop());
```

---

## Cron expression examples

```ts
import { validateCronExpr, computeNextRun } from 'personaforge';

// Standard 5-field cron (min hour dom mon dow)
validateCronExpr('*/5 * * * *');    // every 5 minutes — valid
validateCronExpr('0 8 * * 1-5');    // weekdays at 08:00 — valid

// Compute next run time. Day-of-week is numeric (0–6, 0 = Sunday); named days
// like MON are not supported. Returns a Date, or null if no match is found.
const next = computeNextRun('0 9 * * 1');   // next Monday 09:00 UTC
console.log(next?.toISOString());
```

> **Scheduling is UTC-only.** All cron fields are evaluated in UTC. `computeNextRun` ignores its `timezone` argument (and the `timezone` field on a schedule), so IANA zones like `America/New_York` do not shift the run time — convert to UTC yourself when building the expression.

Common patterns:

| Expression | Description |
|---|---|
| `* * * * *` | Every minute |
| `*/5 * * * *` | Every 5 minutes |
| `0 * * * *` | Every hour |
| `0 8 * * *` | Daily at 08:00 UTC |
| `0 8 * * 1-5` | Weekdays at 08:00 |
| `0 0 1 * *` | First day of every month |
| `0 0 * * 0` | Every Sunday at midnight |

---

## Schedule management

```ts
const scheduler = new ScheduleManager();

// Create
const id = await scheduler.create({
  name: 'Health check',
  cronExpr: '*/15 * * * *',
  endpoint: 'health-check',
  enabled: true,
});

// List all schedules
const all = await scheduler.list();

// List only enabled — pass the boolean positionally
const enabled = await scheduler.list(true);

// Get one
const schedule = await scheduler.get(id);

// Update
await scheduler.update(id, { cronExpr: '*/30 * * * *', enabled: false });

// Enable / disable
await scheduler.enable(id);
await scheduler.disable(id);

// Delete
await scheduler.delete(id);
```

---

## Run history

```ts
// Get last 20 runs for a schedule
const runs = await scheduler.getRuns(id, 20);

for (const run of runs) {
  console.log(run.status, run.triggeredAt, run.completedAt, run.error);
}
// { status: 'success', triggeredAt: '2026-05-11T08:00:00Z', completedAt: '...', error: null }
```

---

## Durable schedule store (survives restarts)

```ts
import { DbScheduleStore } from 'personaforge/scheduler';
import { SqliteAgentDb } from 'personaforge/db';

const db = new SqliteAgentDb({ path: './agent.db' });
const scheduleStore = new DbScheduleStore(db);

const scheduler = new ScheduleManager({ store: scheduleStore });
```

---

## Manual trigger (testing and backfill)

```ts
// Fire a schedule immediately without waiting for the cron
await scheduler.trigger(id);
```

---

## Let an agent manage schedules

`SchedulerTools` wraps a `ScheduleManager` as agent-callable tools, so an agent can create, list, update, and delete its own schedules from chat. Register the array returned by `getTools()`:

```ts
import { createAgent } from 'personaforge';
import { SchedulerTools, ScheduleManager } from 'personaforge/scheduler';

const manager = new ScheduleManager();

const agent = createAgent({
  name: 'SchedulerAgent',
  instructions: 'Create and manage the user\'s reminders and reports.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: new SchedulerTools({
    manager,
    defaultEndpoint: '/agents/assistant/run',
  }).getTools(),
});
```

---

## Where to go next

- [Background Queues](./background-queues) — process jobs from a queue rather than a cron.
- [Production](./production) — graceful shutdown and health checks for scheduled services.
- [Example 20: Scheduled agents](../examples/20-scheduled-agents) — full scheduled agent example.
