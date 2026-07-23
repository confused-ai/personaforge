---
title: Migrate From CrewAI
description: Port CrewAI agents, tasks, crews, and tools to personaforge. Role-based agents become createAgent(). Crew execution becomes compose() or orchestration. Shared tools are plain tool() definitions.
outline: [2, 3]
---

# Migrate From CrewAI

CrewAI's role-based crew model maps cleanly onto `personaforge`. The main change is moving from a framework-defined crew class to explicit agents, pipelines, or orchestrators.

---

## Quick comparison

| CrewAI concept | personaforge equivalent |
|---|---|
| `Agent(role, goal, backstory)` | `createAgent({ name, instructions })` |
| `Task(description, agent)` | An `agent.run()` call — or a graph `task` node |
| `Crew([agents], [tasks])` | `compose(agent1, agent2)` or `createOrchestrator` |
| `Task.tools` | `createAgent({ tools: [...] })` |
| `Process.sequential` | `compose(a, b, c)` |
| `Process.hierarchical` | `createSupervisor(manager, [workers])` |
| `Crew.kickoff()` | `pipeline.run(prompt)` |

---

## Agent migration

```ts
// CrewAI
from crewai import Agent
researcher = Agent(
    role='Senior Research Analyst',
    goal='Uncover cutting-edge developments in AI',
    backstory='You work at a leading tech think tank...',
    tools=[search_tool],
)

// personaforge
import { createAgent } from 'personaforge';
import { webSearchTool } from 'personaforge';

const researcher = createAgent({
  name: 'researcher',
  instructions: `You are a Senior Research Analyst at a leading tech think tank.
Your goal is to uncover cutting-edge developments in AI.
Be analytical and precise.`,
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [webSearchTool],
});
```

---

## Sequential crew → `compose`

```ts
// CrewAI
crew = Crew(
    agents=[researcher, writer, editor],
    tasks=[research_task, write_task, edit_task],
    process=Process.sequential,
)
result = crew.kickoff()

// personaforge
import { compose } from 'personaforge';

const pipeline = compose(researcher, writer, editor, {
  transform: (result) => result.text,
});

const result = await pipeline.run('AI trends in 2025');
```

---

## Hierarchical crew → `createSupervisor`

```ts
// CrewAI (hierarchical with manager_llm)
crew = Crew(agents=[writer, researcher], process=Process.hierarchical, manager_llm=gpt4)

// personaforge
import { createSupervisor } from 'personaforge';

const supervisor = createSupervisor({
  name: 'project-manager',
  instructions: 'Coordinate the research and writing agents to complete the task.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  workers: [researcher, writer],
});

const result = await supervisor.run('Produce a detailed report on quantum computing.');
```

---

## Task with expected output → tool + output format

```ts
// CrewAI
task = Task(
    description='Research the market for electric vehicles',
    expected_output='A detailed 3-paragraph report',
    agent=researcher,
)

// personaforge — bake the output format into instructions
const researcher = createAgent({
  name: 'ev-researcher',
  instructions: `Research the given market and produce a detailed 3-paragraph report.
Always structure your output with an introduction, key findings, and conclusion.`,
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [webSearchTool],
});

const result = await researcher.run('Research the market for electric vehicles.');
```

---

## Custom tools

```ts
// CrewAI
from crewai import tool

@tool("Get stock price")
def get_stock_price(ticker: str) -> str:
    """Get the current stock price for a ticker."""
    return fetch_price(ticker)

// personaforge
import { tool } from 'personaforge';
import { z } from 'zod';

const getStockPrice = tool({
  name: 'get_stock_price',
  description: 'Get the current stock price for a ticker symbol.',
  schema: z.object({ ticker: z.string().describe('Stock ticker, e.g. AAPL') }),
  execute: async ({ ticker }) => fetchPrice(ticker),
});
```

---

## Where to go next

- [Agents](./agents) — `createAgent` in full.
- [Orchestration](./orchestration) — `createSupervisor`, handoffs, consensus.
- [Compose](./compose) — `compose()` and `pipe()` sequential pipelines.
