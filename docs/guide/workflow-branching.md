---
title: Workflow Branching
description: Add conditional routing to pipelines with pipe(...).then(agent, { when }) and router nodes in the graph engine. Branch on agent output, tool results, or arbitrary predicates.
outline: [2, 3]
---

# Workflow Branching

Branching adds conditional execution paths — different stages run depending on what an earlier stage produced. In `personaforge`, branching is available in both the pipeline API (`compose`/`pipe`) and the full graph engine.

---

## Branching in pipelines (`pipe`)

Use a `when` predicate on `pipe(...).then()` to skip or stop stages:

```ts
import { pipe, createAgent } from 'personaforge';

const classifier = createAgent({
  name: 'classifier',
  instructions: 'Classify the user request as: simple | complex | out-of-scope.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

const deepAnalyzer = createAgent({
  name: 'deep-analyzer',
  instructions: 'Perform in-depth analysis of complex requests.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
});

const responder = createAgent({
  name: 'responder',
  instructions: 'Produce the final user-facing response.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

const pipeline = pipe(classifier)
  // Only run deep analysis for 'complex' requests
  .then(deepAnalyzer, {
    when: (result) => result.text.toLowerCase().includes('complex'),
    transform: (result) => `Analyse in depth:\n${result.text}`,
  })
  .then(responder);

const result = await pipeline.run('How do I configure distributed tracing in Kubernetes?');
```

---

## Branching in graph workflows

Use a `router` node for multi-way branching:

```ts
import { createGraph } from 'personaforge';

const graph = createGraph('support-routing')
  .addNode('classify', {
    kind: 'task',
    execute: async (ctx) => {
      const category = await classifier.run(ctx.state.input as string);
      return { category: category.text.trim() };
    },
  })
  .addNode('billing-agent',   { kind: 'task', execute: (ctx) => billingAgent.run(ctx.state.input as string) })
  .addNode('technical-agent', { kind: 'task', execute: (ctx) => techAgent.run(ctx.state.input as string) })
  .addNode('general-agent',   { kind: 'task', execute: (ctx) => generalAgent.run(ctx.state.input as string) })
  .addNode('router', {
    kind: 'router',
    route: (state) => {
      const category = (state.results['classify'] as { category: string }).category;
      if (category.includes('billing'))   return 'billing-agent';
      if (category.includes('technical')) return 'technical-agent';
      return 'general-agent';
    },
  })
  .addEdge('classify', 'router')
  .addEdge('router', 'billing-agent')
  .addEdge('router', 'technical-agent')
  .addEdge('router', 'general-agent')
  .build();
```

---

## Conditional edges

Add conditions on any edge with `addEdge(from, to, { condition })`:

```ts
const graph = createGraph('quality-gate')
  .addNode('generate', { kind: 'task', execute: (ctx) => writer.run(ctx.state.input as string) })
  .addNode('review',   { kind: 'task', execute: (ctx) => reviewer.run(ctx.state.results['generate'] as string) })
  .addNode('revise',   { kind: 'task', execute: (ctx) => writer.run(`Revise based on: ${ctx.state.results['review']}`) })
  .addNode('publish',  { kind: 'task', execute: (ctx) => publisher.run(ctx.state.results['review'] as string) })
  // If review passes, publish; otherwise revise
  .addEdge('review', 'publish', {
    condition: (state) => String(state.results['review']).toLowerCase().includes('approved'),
  })
  .addEdge('review', 'revise', {
    condition: (state) => !String(state.results['review']).toLowerCase().includes('approved'),
  })
  .addEdge('generate', 'review')
  .addEdge('revise', 'publish')
  .build();
```

---

## Validation gate pattern

A common pattern: validate first, branch on pass/fail:

```ts
const pipeline = pipe(validator)
  .then(processor, {
    when: (result) => !result.text.toLowerCase().includes('invalid'),
    transform: (result) => `Process this validated input:\n${result.text}`,
  })
  .then(formatter);
```

---

## When to escalate to graph

If you find yourself with more than 2–3 `when` predicates on a linear pipeline, consider moving to the graph engine:

- More than 3 conditional branches → use a `router` node
- Parallel branches that join back → use `fanOut` + `fanIn` in the graph builder
- Retry loops → use `defaultRetry` on the graph or node
- Re-visiting earlier stages → the graph engine supports cycles

---

## Where to go next

- [Compose](./compose) — linear pipelines without branching.
- [Graph workflows](./graph) — DAG execution with fan-out, join, and router nodes.
- [Orchestration](./orchestration) — supervisor patterns and agent handoffs.
