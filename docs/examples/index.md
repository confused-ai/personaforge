# Examples Playbook

The examples are the fastest way to understand how the framework is meant to feel in practice. Start with the smallest runnable pattern, then move toward the examples that match the next capability you need.

## If you are new, start here

1. [01 · Hello World](./01-hello-world) for the smallest working agent.
2. [02 · First Custom Tool](./02-custom-tool) for the baseline pattern that connects the framework to real application code.
3. [05 · RAG Knowledge Base](./05-rag) if the answers should come from your documents.
4. [13 · Production Resilience](./13-production) when the agent is becoming a real service.

## Full framework map

If you want one page that ties the broader capability story together, start with [17 · Full framework showcase](./17-full-framework-showcase). It connects the examples back to the module layout and the larger runtime model.

Runnable counterparts in the repo:

- `bun run example:showcase` for a broad framework tour
- `bun run example:meridian` for a larger orchestration-heavy platform demo
- `bun run example:reasoning` for explicit reasoning loops
- `bun run example:scheduled` for scheduled agents
- `bun run example:code-review` for staged review pipelines
- `bun run example:eval` for regression-style evaluation

## Skill levels

| Level | Best for |
|---|---|
| Beginner | first contact with the framework or with agent authoring in general |
| Intermediate | tool-backed, retrieval-backed, or observable agents |
| Advanced | orchestration, production runtime controls, and evaluation-heavy systems |

## All examples

| # | Example | Level | What you learn |
|---|---|---|---|
| 01 | [Hello World](./01-hello-world) | 🟢 | Create and run your first agent |
| 02 | [First Custom Tool](./02-custom-tool) | 🟢 | Build a tool that calls a real API |
| 03 | [Tool with Approval](./03-approval-tool) | 🟢 | Ask human before executing risky actions |
| 04 | [Extend & Wrap Tools](./04-extend-tools) | 🟡 | Add middleware, caching, auth to any tool |
| 05 | [RAG Knowledge Base](./05-rag) | 🟡 | Answer questions from your own documents |
| 06 | [Persistent Memory](./06-memory) | 🟡 | Remember users and conversations |
| 07 | [Storage Patterns](./07-storage) | 🟡 | Cache, state, and config in agents |
| 08 | [Multi-Agent Team](./08-team) | 🔴 | Specialized agents working together |
| 09 | [Supervisor Workflow](./09-supervisor) | 🔴 | One agent delegates to many |
| 10 | [Database Analyst](./10-database) | 🔴 | Query a SQL database with natural language |
| 11 | [Customer Support Bot](./11-support-bot) | 🔴 | Full bot: sessions + guardrails + handoff |
| 12 | [Observability & Hooks](./12-observability) | 🟡 | Log, trace, and measure every agent step |
| 13 | [Production Resilience](./13-production) | 🔴 | Circuit breakers, retries, fallbacks |
| 14 | [MCP Filesystem Agent](./14-mcp) | 🔴 | Use Model Context Protocol tools |
| 15 | [Full-Stack App](./15-full-stack) | 🔴 | Complete app: HTTP API + agent + RAG + storage |
| 16 | [Intelligent LLM Router](./16-llm-router) | 🟡 | Auto-route requests to the right model by task, cost & speed |
| 17 | [Full framework showcase](./17-full-framework-showcase) | 🔴 | **Coverage map:** one real-world story + every module / import path + links to 01–16 |
| 18 | [Meridian — Role Intelligence Platform](./18-meridian-platform) | 🔴 | **Full platform demo:** 6 role personas, triage handoff, router, supervisor, consensus, compose/pipe, workflows, RAG, guardrails, resilience, health, HTTP runtime |
| 19 | [Incident Triage Bot](./19-reasoning) | 🔴 | Chain-of-thought reasoning, `ReasoningManager`, event streaming, `NextAction` loop |
| 20 | [Scheduled Agent Jobs](./20-scheduled-agents) | 🔴 | Cron scheduling, `ScheduleManager`, handler registry, run history, enable/disable |
| 21 | [Code Review Pipeline](./21-code-review-pipeline) | 🔴 | `bare()`, `compose()`, `pipe()`, conditional `when` hand-off, lifecycle hooks |
| 22 | [Eval Regression Guard](./22-eval-ci) | 🟡 | `runEvalSuite`, `EvalStore`, custom scorer, baseline saving, CI exit code |

## Quick start

```bash
npm install personaforge
```

```ts
import { createAgent } from 'personaforge';

const agent = createAgent({
  name: 'my-first-agent',
  model: 'gpt-4o-mini',
  instructions: 'You are a helpful assistant.',
});

const result = await agent.run('What is 2 + 2?');
console.log(result.text); // "4"
```

---

## Environment variables

Most examples need these in a `.env` file:

```bash
OPENAI_API_KEY=sk-...        # required for OpenAI models
ANTHROPIC_API_KEY=sk-...     # optional, for Claude models
GOOGLE_AI_API_KEY=...        # optional, for Gemini models
```
