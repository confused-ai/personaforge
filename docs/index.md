---
layout: home
title: personaforge — Production AI Agents in TypeScript
description: One framework. Ship anything from a one-line assistant to a hardened enterprise system with durability, guardrails, budgets, and audit. 40+ providers, 120+ tools, multi-agent teams, RAG, circuit breakers — all in one npm install.

hero:
  name: "personaforge"
  text: "AI agents that ship."
  tagline: "One framework. From hello-world to hardened enterprise — durability, guardrails, budgets, and audit included. In one package. With zero lock-in."
  actions:
    - theme: brand
      text: Get Started → 5 minutes
      link: /guide/getting-started
    - theme: alt
      text: See Examples
      link: /examples/
    - theme: alt
      text: Trust & Reliability →
      link: /guide/trust
  image:
    src: /logo.svg
    alt: personaforge
---

<HeroStats />

<CodeDemo />

## Why personaforge?

Most agent frameworks give you an LLM wrapper and call it a day. personaforge is different — it ships **every production primitive** in a single `npm install`. No stitching together 7 packages. No "choose your own adventure" with sessions, memory, and guardrails.

<ComparisonMatrix />

<div class="vp-doc" style="max-width: 880px; margin: 0 auto; padding: 0 24px;">

### One agent, one run — start here

```ts
import { agent } from 'personaforge';

const bot = agent('You are a helpful assistant.');

const { text } = await bot.run('What is the capital of France?');
console.log(text); // "The capital of France is Paris."
```

Zero config. The framework resolves the provider from your environment, wires sessions in memory, and runs. No boilerplate. No ceremony.

### Add capabilities as you need them

```ts
import { agent, tool, InMemorySessionStore, Memory } from 'personaforge';
import { z } from 'zod';

const searchWeb = tool({
  name: 'search_web',
  description: 'Search the web.',
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => fetch(`https://api.search.com?q=${query}`).then(r => r.json()),
});

const memory = new Memory({ options: { lastMessages: 20 } });

const researchAgent = agent({
  name: 'researcher',
  model: 'gpt-4o',
  instructions: 'Research topics using web search. Remember preferences.',
  tools: [searchWeb],
  memory,
  sessionStore: new InMemorySessionStore(),
  dev: true, // console logging when you're iterating
});
```

### Scale to production — same API

```ts
import { createEnterpriseGateway, createAgent } from 'personaforge';

const support = createAgent({ name: 'support', model: 'gpt-4o', instructions: '...' });
const billing = createAgent({ name: 'billing', model: 'gpt-4o', instructions: '...' });

const gateway = createEnterpriseGateway({
  agents: { support, billing },
  auth: apiKeyAuth([process.env.GATEWAY_API_KEY!]),
  tenants: [
    { id: 'acme', monthlyBudgetUsd: 500, maxRpm: 60, allowedAgents: ['support'] },
  ],
  policy: { monthlyBudgetUsd: 5000 },
});

await gateway.start(8787);
// → SOC 2 / HIPAA / GDPR dashboard at /compliance
```

### Three primitives. Every pattern.

| Primitive | When |
|---|---|
| **Agent** | One model-backed worker with tools, memory, and state |
| **Team** | Specialists coordinating — supervisor, consensus, swarm, handoff |
| **Workflow** | Staged execution with branching, parallelism, and durability |

</div>

<BatteriesIncluded />

<ProvidersGrid />

## Built for production — by default

<div class="vp-doc" style="max-width: 880px; margin: 0 auto; padding: 0 24px;">

| Capability | Ships in the box |
|---|---|
| **Guardrails** | PII detection, prompt injection defense, content moderation, tool/host allowlists |
| **Budget enforcement** | Per-user, per-session, and global USD caps — stop before the bill surprises you |
| **Rate limiting** | Sliding-window (in-memory + Redis) |
| **Circuit breakers** | Automatic provider failure detection and recovery |
| **HITL approvals** | Human-in-the-loop tool approval with `interrupt()` / `resume()` |
| **Audit trail** | Hash-chained event log, SOC 2 ready |
| **OTLP tracing** | OpenTelemetry with gen-ai semantic conventions |
| **Prometheus metrics** | Request counts, latency, token usage, error rates out of the box |
| **Durable execution** | Checkpoint/restore, deterministic replay from event log |
| **Multi-tenancy** | Per-tenant budgets, rate limits, agent allowlists, RBAC |
| **Graceful shutdown** | Drain active executions before shutdown |
| **Health checks** | Readiness, liveness, dependency probes |

### Eval built in

```ts
import { evaluate, fromAgent } from 'personaforge';

const results = await evaluate({
  subject: fromAgent(myAgent),
  dataset: [
    { input: 'What is 2+2?', expected: { contains: '4' } },
    { input: 'Capital of Japan?', expected: { contains: 'Tokyo' } },
  ],
  metrics: ['accuracy', 'latency', 'cost'],
  judge: { model: 'gpt-4o', criteria: ['correctness', 'conciseness'] },
});

console.log(results.passRate); // 0.92
```

## Framework comparisons

<ComparisonSection />

</div>

<TrustSignals />

<DelightfulDX />

<EnterpriseSection />

<CtaBanner />
