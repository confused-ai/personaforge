---
title: "Examples Playbook"
---

# Examples Playbook

Real-world examples covering **every feature** of personaforge. Pick your level.

---

## Full framework map (start here)

For a **single narrative** that walks every capability area—NorthPeak StoreOps Copilot, import cheat-sheets, architecture diagram, and links back to these tutorials—see **[17 · Full framework showcase](./17-full-framework-showcase)**.

Runnable counterparts in the repo:

- `bun run example:showcase` — LLM, sessions, workflows, pipeline, health, metrics, optional HTTP.
- `bun run example:potential` — chunking, circuit breaker, rate limiter, artifacts, profiles, eval metrics, config (no LLM calls).
- `bun run example:meridian` — full role intelligence platform: 6 personas, handoff, router, supervisor, consensus, RAG, HTTP server.

---

## Skill Levels

| Label | Who it's for |
|---|---|
| 🟢 **Beginner** | Never used an AI framework. First time here. |
| 🟡 **Intermediate** | Built basic agents, want real-world patterns. |
| 🔴 **Advanced** | Production systems, orchestration, resilience. |

---

## All Examples

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
| 11 | [Customer Support Bot](/examples/11-support-bot) | 🔴 | Full bot: sessions + guardrails + handoff |
| 12 | [Observability & Hooks](/examples/12-observability) | 🟡 | Log, trace, and measure every agent step |
| 13 | [Production Resilience](/examples/13-production) | 🔴 | Circuit breakers, retries, fallbacks |
| 14 | [MCP Filesystem Agent](/examples/14-mcp) | 🔴 | Use Model Context Protocol tools |
| 15 | [Full-Stack App](/examples/15-full-stack) | 🔴 | Complete app: HTTP API + agent + RAG + storage |
| 16 | [Intelligent LLM Router](./16-llm-router) | 🟡 | Auto-route requests to the right model by task, cost & speed |
| 17 | [Full framework showcase](./17-full-framework-showcase) | 🔴 | **Coverage map:** one real-world story + every module / import path + links to 01–16 |
| 18 | [Meridian — Role Intelligence Platform](./18-meridian-platform) | 🔴 | **Full platform demo:** 6 role personas, triage handoff, router, supervisor, consensus, compose/pipe, workflows, RAG, guardrails, resilience, health, HTTP runtime |

---

## Quick Start (30 seconds)

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

## Environment Variables

Most examples need these in a `.env` file:

```bash
OPENAI_API_KEY=sk-...        # required for OpenAI models
ANTHROPIC_API_KEY=sk-...     # optional, for Claude models
GOOGLE_AI_API_KEY=...        # optional, for Gemini models
```
