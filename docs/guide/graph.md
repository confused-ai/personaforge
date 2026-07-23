---
title: Graph Workflows
description: Build DAG-based workflows with createGraph(). Node kinds — task, router, parallel, join, agent, wait. Conditional edges, fan-out/fan-in, retry policies, and durable execution with DAGEngine and event sourcing.
outline: [2, 3]
---

# Graph Workflows

The graph engine executes arbitrary DAGs — directed acyclic graphs — with node-level retries, conditional edges, parallel fan-out, and durable checkpointing. Use it when a pipeline is no longer enough.

```ts
import { createGraph } from 'personaforge';       // createGraph is root-exported
import { DAGEngine } from 'personaforge/graph';    // the graph engine lives on the subpath
```

---

## Quick start

```ts
import { createGraph } from 'personaforge';
import { DAGEngine } from 'personaforge/graph';

const graph = createGraph('content-pipeline', { version: '1.0' })
  .addNode('fetch',    { kind: 'task', execute: (ctx) => fetchContent(ctx.state.variables.input as string) })
  .addNode('analyse',  { kind: 'task', execute: (ctx) => analyseContent(ctx.state.results['fetch']) })
  .addNode('publish',  { kind: 'task', execute: (ctx) => publishContent(ctx.state.results['analyse']) })
  .chain('fetch', 'analyse', 'publish')  // linear shorthand
  .build();

const engine = new DAGEngine(graph);
const execution = await engine.execute({ variables: { input: 'https://example.com/article' } });
// execution.state.results — keyed by node name
```

---

## Node kinds

| Kind | Use for |
|---|---|
| `task` | Any async function |
| `agent` | Run an LLM agent |
| `router` | Route to exactly one of multiple targets |
| `parallel` | Fan out to multiple targets concurrently |
| `join` | Wait for all incoming branches, then merge |
| `start` | Entry point (auto-detected if omitted) |
| `end` | Terminal node (optional) |
| `wait` | Pause for an external event or timer |

---

## Task node

```ts
.addNode('process', {
  kind: 'task',
  execute: async (ctx) => {
    // ctx.state.variables — initial input passed to execute({ variables })
    // ctx.state.results['nodeName'] — output of a previous node
    return await processData(ctx.state.results['fetch']);
  },
  retry: { maxRetries: 3, backoffMs: 1000, exponentialBase: 2 },
  timeout: { timeoutMs: 30_000 },
})
```

---

## Agent node

Run an LLM agent as a graph node:

```ts
.addNode('summarise', {
  kind: 'agent',
  instructions: 'Summarise the provided text in 3 bullet points.',
  model: 'gpt-4o-mini',
  tools: [webSearchTool],
  maxSteps: 5,
})
```

---

## Router node

Branch to exactly one target based on state:

```ts
.addNode('classify', {
  kind: 'router',
  route: (state) => {
    const category = state.results['classifier'] as string;
    if (category === 'billing')   return 'billing-agent';
    if (category === 'technical') return 'tech-agent';
    return 'general-agent';
  },
})
.addEdge('classify', 'billing-agent')
.addEdge('classify', 'tech-agent')
.addEdge('classify', 'general-agent')
```

---

## Parallel fan-out / join

Run multiple nodes concurrently, then merge results:

```ts
const graph = createGraph('parallel-research')
  .addNode('query',          { kind: 'task', execute: (ctx) => parseQuery(ctx.state.input as string) })
  .addNode('web-search',     { kind: 'task', execute: (ctx) => webSearch(ctx.state.results['query']) })
  .addNode('db-lookup',      { kind: 'task', execute: (ctx) => dbQuery(ctx.state.results['query']) })
  .addNode('docs-search',    { kind: 'task', execute: (ctx) => docSearch(ctx.state.results['query']) })
  .addNode('merge',          {
    kind: 'join',
    merge: (results) => ({
      web:  results['web-search'],
      db:   results['db-lookup'],
      docs: results['docs-search'],
    }),
  })
  .addNode('synthesise',     { kind: 'task', execute: (ctx) => synthesise(ctx.state.results['merge']) })
  .addEdge('query', 'web-search')
  .fanOut('query', ['web-search', 'db-lookup', 'docs-search'])   // parallel edges
  .fanIn(['web-search', 'db-lookup', 'docs-search'], 'merge')    // join
  .addEdge('merge', 'synthesise')
  .build();
```

---

## Conditional edges

Add a condition on any edge:

```ts
.addEdge('review', 'publish', {
  condition: (state) => (state.results['review'] as string).includes('approved'),
})
.addEdge('review', 'revise', {
  condition: (state) => !(state.results['review'] as string).includes('approved'),
})
```

---

## Graph-level options

```ts
createGraph('my-workflow')
  .defaultRetry({ maxRetries: 3, backoffMs: 500, exponentialBase: 2 })
  .defaultTimeout({ timeoutMs: 60_000 })
  .maxConcurrency(4)   // max parallel nodes
  .description('Content generation pipeline')
  .version('2.0')
```

---

## Durable execution with `DAGEngine`

Graphs execute through `DAGEngine` — not `AgentRuntime`, which is a single-agent
tool loop, not a graph runner. Pass an `EventStore` to `execute()` and the engine
records every state change, so an interrupted run can be reconstructed and resumed:

```ts
import { DAGEngine, SqliteEventStore } from 'personaforge/graph';

const engine = new DAGEngine(graph);
const execution = await engine.execute({
  eventStore: new SqliteEventStore('./graph-events.db'),
  checkpointInterval: 10,   // persist a checkpoint every N node completions
  maxConcurrency: 8,
});
// execution.status         — 'completed' | 'failed' | 'running' | 'paused'
// execution.state.results  — node-keyed results map
```

`DurableExecutor` wraps this pattern and adds crash recovery from the log:

```ts
import { DurableExecutor, SqliteEventStore } from 'personaforge/graph';

const store   = new SqliteEventStore('./graph-events.db');
const durable = new DurableExecutor(graph, store);

const first = await durable.run({ variables: { input: 'my-input' } });
// …process crashes…
const recovered = await durable.resume(first.executionId);   // rebuilt via replayState()
```

---

## Event sourcing, replay, and audit

The graph engine is event-sourced end to end. Everything below is exported from
`personaforge/graph` (`createGraph` and `SqliteEventStore` are also re-exported at
the package root).

### Event stores

```ts
import { InMemoryEventStore, SqliteEventStore, BatchingEventStore } from 'personaforge/graph';

const dev   = new InMemoryEventStore();          // tests / ephemeral
const store = new SqliteEventStore('./events.db'); // durable, file-backed
const fast  = new BatchingEventStore(store);     // buffer + batch appends off the hot path
```

### Deterministic replay

Re-run a recorded execution with **zero external calls** — recorded LLM results
and tool outputs are served from the log in order (time-travel debugging, sims):

```ts
import { replay, buildReplayProvider, buildReplayTools, replayState } from 'personaforge/graph';

const result = await replay(store, executionId, {
  name: 'researcher',
  instructions: 'Research the given topic thoroughly.',
});

// …or build the replay provider / tool registry yourself:
const llm   = await buildReplayProvider(store, executionId);
const tools = await buildReplayTools(store, executionId);

// Reconstruct the full GraphState from an event log:
const events = await store.load(executionId);
const state  = replayState(events, graph);
```

### Tamper-evident audit

Record with a hash chain, then verify the log hasn't been altered:

```ts
import { verifyChain } from 'personaforge/graph';

const events = await store.load(executionId);
const check = verifyChain(events);   // ChainVerification { valid, brokenAt?, reason? }
if (!check.valid) {
  console.error(`Audit log broken at event #${check.brokenAt}: ${check.reason}`);
}
```

### Recording agent runs & right-to-erasure

`RunRecorder` writes an ordinary `agent.run()` into the same durable log, with
optional secret/PII redaction and hash chaining. `EventStore.purge()` erases every
event for one execution (GDPR right-to-erasure):

```ts
import { RunRecorder, redactSecrets, redactPII, combineRedactors, SqliteEventStore } from 'personaforge/graph';

const store = new SqliteEventStore('./events.db');
const recorder = new RunRecorder(store, {
  hashChain: true,
  redact: combineRedactors(redactSecrets, redactPII),
});

// Drop every event for a single execution.
await store.purge(recorder.executionId);
```

### Distributed execution

Fan a graph across workers with a shared task queue:

```ts
import {
  DefaultScheduler, GraphWorker, DistributedEngine, RedisTaskQueue, computeWaves,
} from 'personaforge/graph';

const waves     = computeWaves(graph);                  // topological execution waves
const queue     = new RedisTaskQueue('redis://localhost:6379');
const scheduler = new DefaultScheduler(graph, queue);
const engine    = new DistributedEngine({ graph, scheduler, queue });
// GraphWorker instances pull tasks off the shared queue and report results back.
```

### Plugins

Attach cross-cutting telemetry and audit hooks via `execute({ plugins })`:

```ts
import { TelemetryPlugin, AuditPlugin, OpenTelemetryPlugin } from 'personaforge/graph';

await engine.execute({
  plugins: [
    new TelemetryPlugin(),
    new AuditPlugin({ maxEvents: 10_000 }),
    new OpenTelemetryPlugin({ serviceName: 'graph-engine' }),
  ],
});
```

---

## Where to go next

- [Workflow branching](./workflow-branching) — conditional routing patterns.
- [Compose](./compose) — simpler linear pipelines.
- [Orchestration](./orchestration) — supervisor/consensus patterns for agent teams.
