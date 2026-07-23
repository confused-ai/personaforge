---
title: Reasoning Tools
description: Agno-style think and analyze tools — let an agent write structured reasoning steps to a scratchpad and review them, lifting non-reasoning models with explicit tool-based thinking.
outline: [2, 3]
---

# Reasoning Tools

Reasoning-as-tools makes step-by-step thinking an explicit tool call rather than free-form chain-of-thought. This lifts non-reasoning models by giving them a structured scratchpad they can write to and query.

```ts
import {
  ReasoningScratchpad, createReasoningTools,
} from 'personaforge/reasoning';
```

---

## Quick start

```ts
import { agent } from 'personaforge';

const scratchpad = new ReasoningScratchpad();
const { think, analyze } = createReasoningTools(scratchpad);

const researcher = agent({
  name: 'researcher',
  model: 'gpt-4o-mini',
  instructions: 'Use the think tool to plan before acting, and analyze to review your reasoning.',
  tools: [think, analyze /* , ...domainTools */],
});

await researcher.run('Compare three database options for our workload.');

// Inspect what the agent reasoned about
console.log(scratchpad.render());
```

---

## The tools

### `think(title, thought)`

Records a reasoning step. Returns the step ID and running total.

```ts
await think.execute({
  title: 'Plan',
  thought: 'Break the comparison into cost, latency, and operational overhead.',
});
// { stepId: 1, totalSteps: 1 }
```

### `analyze(query?)`

Reviews recorded steps. With no query it returns everything; with a query it substring-filters titles and thoughts.

```ts
await analyze.execute({ query: 'cost' });
// { steps: [ ...matching steps ] }
```

---

## The scratchpad

`ReasoningScratchpad` is a per-run store you own and inspect:

```ts
const pad = new ReasoningScratchpad();

pad.add('Plan', 'decompose the task');
pad.count();          // 2
pad.search('plan');   // matching steps
pad.render();         // prompt-injectable text summary
pad.clear();          // reset between runs
```

Create a fresh scratchpad per run to avoid cross-run leakage.

---

## Prompt injection pattern

Render the scratchpad into a later prompt to give the model its own prior reasoning as context:

```ts
const priorReasoning = scratchpad.render();
const followup = await agent.run(
  `Previous reasoning:\n${priorReasoning}\n\nNow produce the final recommendation.`,
);
```

---

## Related pages

- [Reasoning (CoT / ToT)](/guide/reasoning) — the ReasoningManager and Tree-of-Thought.
- [Planner](/guide/planner) — task decomposition.
