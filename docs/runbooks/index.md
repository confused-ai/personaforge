---
title: "Runbooks"
description: "Operational, LLM-ready runbooks for every personaforge feature."
generated: true
---

# Runbooks

One runbook per public export subpath. Each covers import, minimal use, verify, common failures, and rollback. Generated from `.d.ts` — regenerate with `node scripts/gen-runbooks.mjs`.

| Feature | Import | Symbols |
|---|---|---|
| [Adapter Redis](./adapter-redis.md) | `personaforge/adapter-redis` | 16 |
| [Adapters](./adapters.md) | `personaforge/adapters` | 93 |
| [Agentic](./agentic.md) | `personaforge/agentic` | 54 |
| [Artifacts](./artifacts.md) | `personaforge/artifacts` | 27 |
| [Background](./background.md) | `personaforge/background` | 20 |
| [Checkpoint](./checkpoint.md) | `personaforge/checkpoint` | 9 |
| [Cli](./cli.md) | `personaforge/cli` | 0 |
| [Compression](./compression.md) | `personaforge/compression` | 62 |
| [Config](./config.md) | `personaforge/config` | 28 |
| [Context](./context.md) | `personaforge/context` | 10 |
| [Contracts](./contracts.md) | `personaforge/contracts` | 107 |
| [Control Plane](./control-plane.md) | `personaforge/control-plane` | 3 |
| [Core](./core.md) | `personaforge/core` | 74 |
| [Create Agent](./create-agent.md) | `personaforge/create-agent` | 146 |
| [Db](./db.md) | `personaforge/db` | 38 |
| [Dx](./dx.md) | `personaforge/dx` | 153 |
| [Eval](./eval.md) | `personaforge/eval` | 90 |
| [Execution](./execution.md) | `personaforge/execution` | 91 |
| [Graph](./graph.md) | `personaforge/graph` | 120 |
| [Guard](./guard.md) | `personaforge/guard` | 99 |
| [Guardrails](./guardrails.md) | `personaforge/guardrails` | 45 |
| [Framework Core](./index.md) | `personaforge` | 1137 |
| [Interfaces](./interfaces.md) | `personaforge/interfaces` | 94 |
| [Knowledge](./knowledge.md) | `personaforge/knowledge` | 83 |
| [Learning](./learning.md) | `personaforge/learning` | 77 |
| [Lite](./lite.md) | `personaforge/lite` | 149 |
| [Memory](./memory.md) | `personaforge/memory` | 77 |
| [Model](./model.md) | `personaforge/model` | 61 |
| [Models](./models.md) | `personaforge/models` | 81 |
| [Observability](./observability.md) | `personaforge/observability` | 83 |
| [Observe](./observe.md) | `personaforge/observe` | 83 |
| [Orchestration](./orchestration.md) | `personaforge/orchestration` | 277 |
| [Parsers](./parsers.md) | `personaforge/parsers` | 9 |
| [Planner](./planner.md) | `personaforge/planner` | 27 |
| [Playground](./playground.md) | `personaforge/playground` | 4 |
| [Plugins](./plugins.md) | `personaforge/plugins` | 28 |
| [Production](./production.md) | `personaforge/production` | 151 |
| [Providers](./providers.md) | `personaforge/providers` | 278 |
| [Reasoning](./reasoning.md) | `personaforge/reasoning` | 16 |
| [Router](./router.md) | `personaforge/router` | 11 |
| [Runnable](./runnable.md) | `personaforge/runnable` | 6 |
| [Runtime](./runtime.md) | `personaforge/runtime` | 161 |
| [Scheduler](./scheduler.md) | `personaforge/scheduler` | 33 |
| [Sdk](./sdk.md) | `personaforge/sdk` | 458 |
| [Serve](./serve.md) | `personaforge/serve` | 161 |
| [Session](./session.md) | `personaforge/session` | 36 |
| [Shared](./shared.md) | `personaforge/shared` | 21 |
| [Simulation](./simulation.md) | `personaforge/simulation` | 30 |
| [Skills](./skills.md) | `personaforge/skills` | 8 |
| [Storage](./storage.md) | `personaforge/storage` | 5 |
| [Streaming](./streaming.md) | `personaforge/streaming` | 11 |
| [Structured](./structured.md) | `personaforge/structured` | 7 |
| [Test](./test.md) | `personaforge/test` | 258 |
| [Test Utils](./test-utils.md) | `personaforge/test-utils` | 21 |
| [Test Utils: Conformance](./test-utils-conformance.md) | `personaforge/test-utils/conformance` | 24 |
| [Testing](./testing.md) | `personaforge/testing` | 256 |
| [Tool](./tool.md) | `personaforge/tool` | 139 |
| [Toolkits](./toolkits.md) | `personaforge/toolkits` | 9 |
| [Tools](./tools.md) | `personaforge/tools` | 139 |
| [Tools: Ai](./tools-ai.md) | `personaforge/tools/ai` | 20 |
| [Tools: Communication](./tools-communication.md) | `personaforge/tools/communication` | 67 |
| [Tools: Core](./tools-core.md) | `personaforge/tools/core` | 55 |
| [Tools: Crm](./tools-crm.md) | `personaforge/tools/crm` | 34 |
| [Tools: Data](./tools-data.md) | `personaforge/tools/data` | 47 |
| [Tools: Devtools](./tools-devtools.md) | `personaforge/tools/devtools` | 62 |
| [Tools: Finance](./tools-finance.md) | `personaforge/tools/finance` | 30 |
| [Tools: Mcp](./tools-mcp.md) | `personaforge/tools/mcp` | 44 |
| [Tools: Media](./tools-media.md) | `personaforge/tools/media` | 45 |
| [Tools: Memory](./tools-memory.md) | `personaforge/tools/memory` | 45 |
| [Tools: Productivity](./tools-productivity.md) | `personaforge/tools/productivity` | 90 |
| [Tools: Scraping](./tools-scraping.md) | `personaforge/tools/scraping` | 62 |
| [Tools: Search](./tools-search.md) | `personaforge/tools/search` | 86 |
| [Tools: Shell](./tools-shell.md) | `personaforge/tools/shell` | 16 |
| [Tools: Social](./tools-social.md) | `personaforge/tools/social` | 36 |
| [Tools: Utils](./tools-utils.md) | `personaforge/tools/utils` | 37 |
| [Video](./video.md) | `personaforge/video` | 2 |
| [Voice](./voice.md) | `personaforge/voice` | 12 |
| [Workflow](./workflow.md) | `personaforge/workflow` | 355 |
