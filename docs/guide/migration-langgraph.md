---
title: Migrate From LangGraph
description: Port LangGraph StateGraph, conditional edges, checkpointers, interrupt/resume, and stream modes to personaforge. StateGraph becomes createGraph(). MemorySaver becomes CheckpointStore. stream_mode maps to event streaming.
outline: [2, 3]
---

# Migrate From LangGraph

LangGraph's state-machine model maps directly onto `personaforge`'s graph engine and checkpoint module — in **TypeScript**, with budget enforcement, guardrails, eval, and OTLP tracing included.

---

## Quick comparison

| LangGraph concept | personaforge equivalent |
|---|---|
| `StateGraph` | `createGraph()` + `DAGEngine` |
| `add_node(name, fn)` | `.addNode(name, { kind: 'task', execute })` |
| `add_edge(a, b)` | `.addEdge(a, b)` or `.chain(a, b, c)` |
| `add_conditional_edges` | `router` node or [Workflow Branching](./workflow-branching) |
| `MessagesState` / typed state | `ctx.state.variables` + `ctx.state.results` |
| `MemorySaver` / checkpointer | [Durable Interrupt & Resume](./checkpoint) — `CheckpointStore` |
| `interrupt()` / `Command(resume=...)` | `ctx.interrupt()` / `exec.resume(threadId, value)` |
| `stream_mode=["values","updates"]` | [Event Streaming](./event-streaming) — `values \| updates \| messages \| debug \| custom` |
| `create_react_agent` | `createAgent({ tools, maxSteps })` |
| `Send` / fan-out | `parallel` + `join` nodes |
| `SqliteSaver` | Implement `CheckpointStore` (SQLite pattern in checkpoint guide) |

---

## StateGraph → `createGraph`

```python
# LangGraph (Python)
from langgraph.graph import StateGraph, END

graph = StateGraph(State)
graph.add_node("fetch", fetch_node)
graph.add_node("analyse", analyse_node)
graph.add_edge("fetch", "analyse")
graph.add_edge("analyse", END)
app = graph.compile()
result = app.invoke({"input": "https://example.com"})
```

```ts
// personaforge
import { createGraph } from 'personaforge';
import { DAGEngine } from 'personaforge/graph';

const graph = createGraph('content-pipeline')
  .addNode('fetch', {
    kind: 'task',
    execute: (ctx) => fetchContent(ctx.state.variables.input as string),
  })
  .addNode('analyse', {
    kind: 'task',
    execute: (ctx) => analyseContent(ctx.state.results['fetch']),
  })
  .chain('fetch', 'analyse')
  .build();

const engine = new DAGEngine(graph);
const execution = await engine.execute({ variables: { input: 'https://example.com' } });
// execution.state.results
```

---

## Conditional edges → router node

```python
# LangGraph
graph.add_conditional_edges(
    "classify",
    route_fn,
    {"billing": "billing_agent", "technical": "tech_agent", "general": "general_agent"},
)
```

```ts
// personaforge
const graph = createGraph('support-routing')
  .addNode('classify', {
    kind: 'task',
    execute: async (ctx) => {
      const category = await classifier.run(ctx.state.variables.input as string);
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
  .build();
```

See [Workflow Branching](./workflow-branching) for pipeline-level `when` predicates too.

---

## ReAct agent

```python
# LangGraph
from langgraph.prebuilt import create_react_agent
agent = create_react_agent(model, tools)
result = agent.invoke({"messages": [("user", "What is the weather in London?")]})
```

```ts
// personaforge
const agent = createAgent({
  name: 'weather-agent',
  instructions: 'Answer questions using the available tools.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [getWeather],
  maxSteps: 10,
});

const result = await agent.run('What is the weather in London?');
```

---

## Checkpointer → `CheckpointStore`

```python
# LangGraph
from langgraph.checkpoint.memory import MemorySaver
checkpointer = MemorySaver()
app = graph.compile(checkpointer=checkpointer)
config = {"configurable": {"thread_id": "user-123"}}
app.invoke(input, config)
```

```ts
// personaforge
import { DurableExecutor, InMemoryCheckpointStore } from 'personaforge/checkpoint';

const exec = new DurableExecutor({
  nodes: [['ask', askApproval], ['execute', executeNode]],
  store: new InMemoryCheckpointStore(),
});

const r1 = await exec.run({ amount: 500 }, { threadId: 'user-123' });
// r1.interrupted === true when a node calls ctx.interrupt()

const r2 = await exec.resume(r1.threadId, { ok: true });
```

For production, implement `CheckpointStore` with SQLite or Postgres. See [Durable Interrupt & Resume](./checkpoint).

---

## `interrupt()` / resume

```python
# LangGraph
from langgraph.types import interrupt, Command

def approval_node(state):
    value = interrupt({"question": "Approve this transfer?"})
    return {"approved": value}

# Resume: app.invoke(Command(resume=True), config)
```

```ts
// personaforge
import type { NodeFn } from 'personaforge/checkpoint';

const askApproval: NodeFn = (input, ctx) => {
  const value = ctx.interrupt({ question: 'Approve this transfer?' });
  return { input, approved: value };
};

const r1 = await exec.run({ amount: 500 });
// r1.interrupted === true, r1.interruptPayload === { question: '...' }

const r2 = await exec.resume(r1.threadId, { ok: true });
// Execution continues with approved value
```

---

## Stream modes

```python
# LangGraph
for event in app.stream(input, stream_mode=["updates", "messages"]):
    print(event)
```

```ts
// personaforge
import { createStreamableRun } from 'personaforge/streaming';

const { events, result } = createStreamableRun(async (ctx) => {
  ctx.update({ step: 'fetching' });
  const data = await fetchContent(url);
  ctx.token('Processing...');
  return { data };
}, { streamMode: ['updates', 'messages'] });

for await (const event of events) {
  if (event.type === 'token')  process.stdout.write(event.data);
  if (event.type === 'update') console.log('Update:', event.data);
}
```

| LangGraph `stream_mode` | personaforge mode |
|---|---|
| `values` | `values` |
| `updates` | `updates` |
| `messages` | `messages` |
| `debug` | `debug` |
| `custom` | `custom` (via `ctx.emit()`) |

See [Event Streaming](./event-streaming) for the full protocol.

---

## Parallel fan-out

```python
# LangGraph — Send for map-reduce
from langgraph.types import Send
```

```ts
// personaforge
const graph = createGraph('parallel-research')
  .addNode('split',    { kind: 'task', execute: splitTopics })
  .addNode('research', { kind: 'task', execute: researchTopic })
  .addNode('fan-out',  { kind: 'parallel', targets: ['research-a', 'research-b', 'research-c'] })
  .addNode('merge',    { kind: 'join', execute: mergeResults })
  .addEdge('split', 'fan-out')
  .addEdge('fan-out', 'merge')
  .build();
```

---

## What you gain by switching

| LangGraph gap | personaforge answer |
|---|---|
| Python-first (JS port is separate) | TypeScript-native graph engine |
| No budget enforcement | [Budget Enforcement](./production#budget-enforcement) |
| Add-on observability | [Observability & OTLP](./observability) — built-in |
| No built-in eval | [Evaluation & Benchmarking](./eval) + τ-bench harness |
| No guardrails module | [Guardrails & Safety](./guardrails) |
| No control-plane dashboard | [Control Plane](./control-plane) |

---

## Where to go next

- [Framework Comparisons](./comparisons) — full capability matrix vs all frameworks.
- [Graph Engine](./graph) — node kinds, retries, event sourcing.
- [Durable Interrupt & Resume](./checkpoint) — `interrupt()`, `resume()`, fork-from-checkpoint.
- [Event Streaming](./event-streaming) — LangGraph-compatible stream modes.
- [Workflow Branching](./workflow-branching) — conditional routing patterns.
