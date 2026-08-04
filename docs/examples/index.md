# Examples Playbook

Build confidence by running the examples in order. Each example introduces exactly one new concept and builds on everything before it.

## Start here — 5 minutes to your first agent

```bash
npm install personaforge
```

```ts
import { agent } from 'personaforge';

const bot = agent('You are a helpful assistant. Be concise.');

const { text } = await bot.run('What is 2+2?');
console.log(text); // "4"
```

That's it. No config. No boilerplate. One call, working agent.

## Example map — pick your starting point

| # | Example | Time | What you learn |
|---|---|---|---|
| 01 | [Hello World](./01-hello-world) | 2 min | Create and run your first agent |
| 02 | [First Custom Tool](./02-custom-tool) | 5 min | Build a tool that calls a real API |
| 03 | [Tool with Approval](./03-approval-tool) | 5 min | Ask human before executing risky actions |
| 04 | [Extend & Wrap Tools](./04-extend-tools) | 8 min | Add middleware, caching, auth to any tool |
| 05 | [RAG Knowledge Base](./05-rag) | 10 min | Answer questions from your own documents |
| 06 | [Persistent Memory](./06-memory) | 8 min | Remember users across conversations |
| 07 | [Storage Patterns](./07-storage) | 8 min | Cache, state, and config in agents |
| 08 | [Multi-Agent Team](./08-team) | 10 min | Specialized agents working together |
| 09 | [Supervisor Workflow](./09-supervisor) | 10 min | One agent delegates to many specialists |
| 10 | [Database Analyst](./10-database) | 12 min | Query SQL databases with natural language |
| 11 | [Customer Support Bot](./11-support-bot) | 15 min | Full bot: sessions + guardrails + handoff |
| 12 | [Observability & Hooks](./12-observability) | 10 min | Log, trace, and measure every agent step |
| 13 | [Production Resilience](./13-production) | 12 min | Circuit breakers, retries, fallbacks |
| 14 | [MCP Filesystem Agent](./14-mcp) | 12 min | Use Model Context Protocol tools |
| 15 | [Full-Stack App](./15-full-stack) | 20 min | HTTP API + agent + RAG + storage |
| 16 | [Intelligent LLM Router](./16-llm-router) | 10 min | Auto-route to right model by task/cost/speed |
| 17 | [Full Framework Showcase](./17-full-framework-showcase) | 25 min | Every module in one real-world story |
| 18 | [Meridian Platform](./18-meridian-platform) | 30 min | 6 personas, triage, supervisor, consensus |
| 19 | [Incident Triage Bot](./19-reasoning) | 15 min | Chain-of-thought reasoning loops |
| 20 | [Scheduled Agent Jobs](./20-scheduled-agents) | 10 min | Cron scheduling with handler registry |
| 21 | [Code Review Pipeline](./21-code-review-pipeline) | 15 min | Compose, pipe, conditional handoff, hooks |
| 22 | [Eval Regression Guard](./22-eval-ci) | 12 min | Eval suites, baseline saving, CI exit codes |

## Learning paths

### Path A: Build a real bot (examples 01 → 06 → 11 → 13)

Start with a hello-world agent, add memory so it remembers users, wire it into a full support bot with guardrails and handoff, then wrap it in production resilience.

### Path B: Master multi-agent systems (examples 01 → 08 → 09 → 18)

From a single agent to a team of specialists, to a supervisor that delegates, to a full platform with routing, consensus, and triage.

### Path C: Hardened production (examples 01 → 12 → 13 → 22)

From a working agent through observability and hooks, to circuit breakers and rate limits, to CI-based eval regression detection.

### Path D: Knowledge & retrieval (examples 01 → 02 → 05 → 10)

From a simple chat agent to custom tools, to RAG from your documents, to querying real databases.

## Runnable counterparts

These TypeScript files in the `examples/` directory can be run directly:

```bash
bun run example:simple          # One agent, one tool
bun run example:showcase        # Full framework tour
bun run example:meridian        # Orchestration-heavy platform demo
bun run example:reasoning       # Explicit reasoning loops
bun run example:scheduled       # Scheduled agents
bun run example:code-review     # Staged review pipelines
bun run example:eval            # Regression-style evaluation
bun run example:multi-agent     # Supervisor, pipeline, consensus, graph
bun run example:durability      # Durable execution with checkpoints
bun run example:graph           # DAG workflows with branching + parallelism
```

## Quickstart snippets (run these in 30 seconds)

Run any of these in the `examples/quickstart/` directory:

```bash
bun examples/quickstart/01-hello.ts     # One agent, one message
bun examples/quickstart/02-tool.ts      # Agent with a custom tool
bun examples/quickstart/03-memory.ts    # Agent that remembers
bun examples/quickstart/04-session.ts   # Multi-turn conversation
bun examples/quickstart/05-resume.ts    # Resume from a checkpoint
```

## Environment setup

```bash
# Required for most examples
OPENAI_API_KEY=sk-...

# Optional, adds more provider options
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_AI_API_KEY=...
TAVILY_API_KEY=tvly-...
```

## Skill levels

| Level | Best for |
|---|---|
| 🟢 Beginner | First contact with the framework or agent authoring in general |
| 🟡 Intermediate | Tool-backed, retrieval-backed, or observable agents |
| 🔴 Advanced | Orchestration, production runtime controls, evaluation-heavy systems |

## After the examples

- **[Guide: Getting Started](/guide/getting-started)** — full walkthrough from install to enterprise
- **[Guide: Creating Agents](/guide/agents)** — complete agent authoring reference
- **[Guide: Tools](/guide/tools)** — all 120+ built-in tools and custom patterns
- **[Guide: Orchestration](/guide/orchestration)** — supervisor, swarm, consensus, handoff
- **[Guide: Production](/guide/production)** — resilience, budgets, observability
- **[Guide: All Modules](/guide/all-modules)** — complete module reference with import paths
