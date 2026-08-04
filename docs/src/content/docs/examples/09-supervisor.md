---
title: "09 · Supervisor Workflow"
---

# 09 · Supervisor Workflow

The current supervisor API expects orchestration-native agents, not `createAgent()` results. Use `createRunnableAgent()` or another `OrchestrableAgent` implementation when wiring supervisor flows.

## What you'll learn

- How to create orchestrable worker agents
- How to register workers with roles
- How to run a supervisor in parallel and inspect the combined result

## Current pattern

```ts
import {
  AgentState,
  CoordinationType,
  createRole,
  createRunnableAgent,
  createSupervisor,
} from 'personaforge/orchestration';

function worker(name: string, summary: string) {
  return createRunnableAgent({
    name,
    description: summary,
    run: async (input) => ({
      result: { summary: `${summary}: ${input.prompt}` },
      state: AgentState.COMPLETED,
      metadata: {
        startTime: new Date(),
        endTime: new Date(),
        durationMs: 0,
        iterations: 1,
      },
    }),
  });
}

const researchWorker = worker('research-worker', 'Market facts');
const competitorWorker = worker('competitor-worker', 'Competitor analysis');
const trendWorker = worker('trend-worker', 'Trend summary');

const supervisor = createSupervisor({
  name: 'report-supervisor',
  coordinationType: CoordinationType.PARALLEL,
  subAgents: [
    { agent: researchWorker, role: createRole('Researcher', ['Collect market facts']) },
    { agent: competitorWorker, role: createRole('Competitor Analyst', ['Compare competitors']) },
    { agent: trendWorker, role: createRole('Trend Analyst', ['Summarize growth trends']) },
  ],
});

const result = await supervisor.run(
  { prompt: 'Prepare an electric vehicle market summary.' },
  {
    agentId: 'report-supervisor',
    metadata: {},
  },
);

console.log(result.result);
```

## Notes

- `coordinationType` uses the exported enum values such as `CoordinationType.PARALLEL`.
- `createRole()` takes a role name and a list of responsibilities.
- `createSupervisor()` returns an `OrchestrableAgent`, so you call `.run(input, context)` with the contracts-level shape.

## What's next?

- [10 · Database Analyst](./10-database)
- [Full-Stack App](/examples/15-full-stack)