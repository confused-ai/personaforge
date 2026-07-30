---
title: Migrate From Mastra
description: Port Mastra agents, typed step workflows, tools, memory, and MCP to personaforge. Agent becomes createAgent(). Workflow steps become createGraph() or pipe(). MCP maps to the built-in MCP client.
outline: [2, 3]
---

# Migrate From Mastra

Mastra is a TypeScript agent framework focused on typed workflows, MCP integration, and developer experience. `personaforge` covers the same surface area and adds **durable DAG execution, circuit breakers, budget enforcement, eval, and a control-plane dashboard** in a single package.

---

## Quick comparison

| Mastra concept | personaforge equivalent |
|---|---|
| `new Agent({ name, instructions, model, tools })` | `createAgent({ name, instructions, model, tools })` |
| `createWorkflow().then().commit()` | `createGraph()` + `DAGEngine` or `pipe().then()` |
| `createStep()` | Graph `task` node or `pipe().then()` stage |
| `tool()` | `tool({ name, description, schema, execute })` |
| `MCPClient` | [MCP Client & Server](./mcp) |
| `Memory` / thread storage | `agent.createSession({ sessionId })` |
| `createTool()` with Zod | `tool()` with Zod schema |
| `generate()` / `stream()` | `agent.run()` / `agent.stream()` |
| `evals` | [Evaluation & Benchmarking](./eval) |
| `deploy()` / server | [Production](./production) + automatic REST API |
| `Telemetry` | [Observability & OTLP](./observability) — OpenTelemetry-native |

---

## Agent migration

```ts
// Mastra
import { Agent } from '@mastra/core/agent';

const agent = new Agent({
  name: 'weather-agent',
  instructions: 'Answer weather questions using the available tools.',
  model: openai('gpt-4o'),
  tools: { getWeather },
});

const result = await agent.generate('What is the weather in London?');
```

```ts
// personaforge
import { createAgent } from 'personaforge';

const agent = createAgent({
  name: 'weather-agent',
  instructions: 'Answer weather questions using the available tools.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [getWeather],
});

const result = await agent.run('What is the weather in London?');
// result.text
```

---

## Typed step workflow → graph engine

```ts
// Mastra
import { createWorkflow, createStep } from '@mastra/core/workflows';

const fetchStep = createStep({
  id: 'fetch',
  execute: async ({ inputData }) => fetchContent(inputData.url),
});

const analyseStep = createStep({
  id: 'analyse',
  execute: async ({ inputData }) => analyseContent(inputData),
});

const workflow = createWorkflow({ id: 'content-pipeline' })
  .then(fetchStep)
  .then(analyseStep)
  .commit();

const result = await workflow.execute({ url: 'https://example.com' });
```

```ts
// personaforge
import { createGraph } from 'personaforge';
import { DAGEngine } from 'personaforge/graph';

const graph = createGraph('content-pipeline', { version: '1.0' })
  .addNode('fetch', {
    kind: 'task',
    execute: (ctx) => fetchContent(ctx.state.variables.url as string),
  })
  .addNode('analyse', {
    kind: 'task',
    execute: (ctx) => analyseContent(ctx.state.results['fetch']),
  })
  .chain('fetch', 'analyse')
  .build();

const engine = new DAGEngine(graph);
const execution = await engine.execute({ variables: { url: 'https://example.com' } });
// execution.state.results
```

For simpler linear pipelines without full graph semantics, use `pipe()`:

```ts
import { pipe } from 'personaforge';

const pipeline = pipe(fetchAgent)
  .then(analyseAgent, { transform: (r) => r.text })
  .then(publishAgent);

const result = await pipeline.run('https://example.com/article');
```

---

## Tools

```ts
// Mastra
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const getWeather = createTool({
  id: 'get_weather',
  description: 'Get weather for a city.',
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ context }) => fetchWeather(context.city),
});
```

```ts
// personaforge
import { tool } from 'personaforge';
import { z } from 'zod';

const getWeather = tool({
  name: 'get_weather',
  description: 'Get weather for a city.',
  schema: z.object({ city: z.string().describe('City name') }),
  execute: async ({ city }) => fetchWeather(city),
});
```

---

## MCP integration

```ts
// Mastra
import { MCPClient } from '@mastra/mcp';

const mcp = new MCPClient({ servers: { filesystem: { url: '...' } } });
const tools = await mcp.getTools();
```

```ts
// personaforge
import { createMCPClient } from 'personaforge/mcp';

const mcp = await createMCPClient({
  servers: { filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] } },
});
const tools = await mcp.listTools();

const agent = createAgent({
  name: 'filesystem-agent',
  instructions: 'Use filesystem tools to answer questions.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  tools,
});
```

See [MCP Client & Server](./mcp) for full setup.

---

## Streaming

```ts
// Mastra
const stream = await agent.stream('Explain async/await');
for await (const chunk of stream.textStream) process.stdout.write(chunk);

// personaforge
for await (const chunk of agent.stream('Explain async/await')) {
  process.stdout.write(chunk);
}

// Event-level streaming (tool calls, steps)
for await (const event of agent.streamEvents('Plan my vacation')) {
  if (event.type === 'text-delta') process.stdout.write(event.delta ?? '');
  if (event.type === 'tool-call')  console.log('Calling:', event.tool?.name);
}
```

---

## Memory / threads

```ts
// Mastra — thread-based memory
const result = await agent.generate('Hello', { threadId: 'user-123' });
const followUp = await agent.generate('What did I just say?', { threadId: 'user-123' });

// personaforge — explicit sessions
const session = agent.createSession({ sessionId: 'user-123' });
await session.run('Hello');
const result = await session.run('What did I just say?');
```

---

## What you gain by switching

| Mastra gap | personaforge answer |
|---|---|
| No durable DAG engine | [Graph Engine](./graph) — conditional edges, fan-out, event sourcing |
| No circuit breakers | [Resilience & Circuit Breakers](./production) |
| No USD budget caps | [Budget Enforcement](./production#budget-enforcement) |
| Limited multi-tenancy | [Multi-Tenancy](./multi-tenancy) |
| Partial enterprise audit | SOC2/HIPAA audit logging + [Control Plane](./control-plane) |
| 100+ built-in tools | [Built-in Tools](./tools) — web search, databases, code execution, and more |

---

## Where to go next

- [Framework Comparisons](./comparisons) — full capability matrix vs all frameworks.
- [Agents](./agents) — `createAgent` in full.
- [Execution Workflows](./workflows) — typed DAG workflows.
- [Graph Engine](./graph) — conditional edges, parallel fan-out, durable execution.
- [MCP Client & Server](./mcp) — MCP tools and servers.
