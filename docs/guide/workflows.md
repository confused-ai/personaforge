---
title: Workflows
description: Build DAG-based workflows with GraphBuilder, typed nodes (task, router, parallel, join, agent, wait), event sourcing, and durable execution.
outline: [2, 3]
---

# Workflows

The graph workflow engine lets you build typed, durable DAG workflows with explicit branching, parallel execution, retries, and checkpointing. Import from `personaforge/workflow`.

## Quick start

```ts
import { createGraph, DAGEngine } from 'personaforge/workflow';

const graph = createGraph('data-pipeline')
  .addNode('fetch', {
    kind: 'task',
    execute: async (ctx) => {
      const url = ctx.state.variables.url as string;
      return { data: await fetchData(url) };
    },
  })
  .addNode('transform', {
    kind: 'task',
    execute: async (ctx) => {
      const { data } = ctx.state.results['fetch'] as { data: unknown };
      return { transformed: transform(data) };
    },
  })
  .addNode('save', {
    kind: 'task',
    execute: async (ctx) => {
      const { transformed } = ctx.state.results['transform'] as { transformed: unknown };
      await saveToDatabase(transformed);
      return { saved: true };
    },
  })
  .chain('fetch', 'transform', 'save')  // linear shorthand for addEdge
  .build();

const engine = new DAGEngine(graph);
const result = await engine.execute({ variables: { url: 'https://api.example.com/data' } });
console.log(result.state.results);
```

---

## `GraphBuilder`

All graph types are created through the `GraphBuilder` or the `createGraph` helper.

### Node types

| Type | Purpose |
|---|---|
| `task` | Execute a function; can call LLMs, APIs, or any async work |
| `agent` | Run a `createAgent()` agent as a node |
| `router` | Branch to different nodes based on condition |
| `parallel` | Fan out to multiple nodes simultaneously |
| `join` | Wait for all branches to complete before continuing |
| `wait` | Pause for an external event (HITL, webhook, timer) |

### `task` node

```ts
import { GraphBuilder } from 'personaforge/workflow';

const builder = new GraphBuilder('my-graph');

builder.addNode('classify', {
  kind: 'task',
  execute: async (ctx) => {
    const label = await classifyText(ctx.state.variables.text as string);
    return { label };
  },
  retry: { maxRetries: 3, backoffMs: 1_000, exponentialBase: 2 },
  timeout: { timeoutMs: 10_000 },
});
```

### `agent` node

```ts
// An `agent` node is configured inline — the engine builds the agent from this
// config (instructions, model, provider, tools by name, maxSteps, temperature).
builder.addNode('research', {
  kind: 'agent',
  instructions: 'Research the given topic thoroughly.',
  model: 'gpt-4o',
  maxSteps: 5,
});
```

### `router` node — conditional branching

```ts
builder.addNode('route', {
  kind: 'router',
  route: async (ctx) => {
    const label = ctx.state.results['classify'] as string;
    if (label === 'technical') return 'tech-handler';
    if (label === 'billing')   return 'billing-handler';
    return 'general-handler';
  },
});

// The router follows the outgoing edge whose `label` matches its return value.
builder
  .addEdge('route', 'tech-handler',    { label: 'tech-handler' })
  .addEdge('route', 'billing-handler', { label: 'billing-handler' })
  .addEdge('route', 'general-handler', { label: 'general-handler' });
```

### `parallel` node — fan out

```ts
// A `parallel` node fans out to its outgoing edges; a `join` node waits for the
// incoming branches, then merges their results (keyed by node name).
builder.addNode('gather', { kind: 'parallel' });
builder.addNode('merge', {
  kind: 'join',
  strategy: 'all',
  merge: async (results) => ({
    combined: ['search-web', 'search-db', 'search-docs']
      .map((k) => String(results[k] ?? ''))
      .join('\n\n'),
  }),
});

builder
  .fanOut('gather', ['search-web', 'search-db', 'search-docs'])
  .fanIn(['search-web', 'search-db', 'search-docs'], 'merge');
```

### `wait` node — HITL and webhooks

```ts
builder.addNode('await-approval', {
  kind: 'wait',
  type: 'human',           // 'human' | 'webhook' | 'timer' | 'signal'
  signalName: 'human-approval',
  timeoutMs: 86_400_000,   // 24 hours
});
```

---

## Full DAG example: content pipeline

```ts
import { createGraph, DAGEngine } from 'personaforge/workflow';

const graph = createGraph('content-pipeline')
  .addNode('plan', {
    kind: 'agent',
    instructions: 'Create a detailed outline for the given topic.',
    model: 'gpt-4o-mini',
  })
  .addNode('write-sections', { kind: 'parallel' })
  .addNode('section-intro',      { kind: 'agent', instructions: 'Write the introduction from the outline.', model: 'gpt-4o' })
  .addNode('section-body',       { kind: 'agent', instructions: 'Write the body from the outline.',         model: 'gpt-4o' })
  .addNode('section-conclusion', { kind: 'agent', instructions: 'Write the conclusion from the outline.',   model: 'gpt-4o' })
  .addNode('assemble', {
    kind: 'join',
    strategy: 'all',
    merge: async (results) => ({
      combined: ['section-intro', 'section-body', 'section-conclusion']
        .map((k) => String(results[k] ?? ''))
        .join('\n\n'),
    }),
  })
  .addNode('review', { kind: 'agent', instructions: 'Review for accuracy and readability.', model: 'gpt-4o-mini' })
  .addNode('seo',    { kind: 'agent', instructions: 'Add SEO keywords and meta tags.',      model: 'gpt-4o-mini' })
  .addEdge('plan', 'write-sections')
  .fanOut('write-sections', ['section-intro', 'section-body', 'section-conclusion'])
  .fanIn(['section-intro', 'section-body', 'section-conclusion'], 'assemble')
  .chain('assemble', 'review', 'seo')
  .build();

const engine = new DAGEngine(graph);
const result = await engine.execute({ variables: { topic: 'The future of TypeScript in 2027' } });
console.log(result.state.results['seo']);
```

---

## `compose` and `pipe` — lightweight pipelines

For simple sequential chains without the full graph engine:

```ts
import { compose, pipe } from 'personaforge/workflow';
import { createAgent } from 'personaforge';

// compose: agents in sequence, output → input
const chain = compose(researchAgent, writeAgent, editAgent);
const result = await chain.run('Write a blog post on Rust async runtimes.');

// pipe: functional transform chain
const process = pipe(
  async (topic: string) => researchAgent.run(topic),
  async (r)             => writeAgent.run(r.text),
  async (r)             => editAgent.run(r.text),
);
const final = await process('Rust async runtimes');
```

---

## Retry policies

```ts
builder.addNode('call-external-api', {
  kind: 'task',
  execute: async (ctx) => callApi(ctx.input),
  retry: {
    maxRetries: 5,
    backoffMs: 500,
    exponentialBase: 2,     // exponential backoff
    maxBackoffMs: 10_000,
    retryOn: (err) => err instanceof Error && (err.message.includes('rate limit') || err.message.includes('timeout')),
  },
});
```

---

## Checkpointing (durable workflows)

The graph engine emits `GraphEvent`s. Plug in an `EventStore` to replay interrupted workflows:

```ts
import { DAGEngine } from 'personaforge/workflow';
import { SqliteEventStore } from 'personaforge';

// The event store and checkpoint cadence are passed to execute(), not the constructor.
const engine = new DAGEngine(graph);
const result = await engine.execute({
  eventStore: new SqliteEventStore('./workflow-events.db'),
  checkpointInterval: 10,   // persist a checkpoint every N node completions
});

// A paused or suspended run resumes on the same engine (optionally injecting variables):
const resumed = await engine.resume({ variables: { approved: true } });
```

---

## Where to go next

- [Graph workflow branching](./workflow-branching) — advanced conditional branching patterns.
- [Orchestration](./orchestration) — team, supervisor, and swarm patterns.
- [Production](./production) — circuit breakers, checkpoints, and durable execution.
