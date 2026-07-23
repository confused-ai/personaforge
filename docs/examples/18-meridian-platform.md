---
title: 18 · Meridian Platform
description: A realistic multi-agent analytics platform using role-based teams, task dependencies, and planning. Built with personaforge/orchestration.
outline: [2, 3]
---

# 18 · Meridian Platform

Meridian is an analytics intelligence platform where specialist agents collaborate: one analyses raw metrics, another converts findings into recommendations, and a coordinator ensures both stay aligned. This example shows how to model that with `defineRole`, `defineTask`, and `createTeam`.

---

## What you'll learn

- How to define specialist roles with `defineRole`
- How to chain tasks with `context` dependencies
- How to enable planning so the team reasons before executing
- How to move to `createSupervisor` when explicit delegation matters

---

## Two-agent analytics team

```ts
import { defineRole, defineTask, createTeam } from 'personaforge/orchestration';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Shared LLM adapter — both roles use the same model
function makeLlm(systemHint: string) {
  return {
    async generateText(messages: Array<{ role: string; content: unknown }>) {
      const res = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        system: systemHint,
        messages: messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: String(m.content),
        })),
      });
      const block = res.content[0];
      return {
        text: block.type === 'text' ? block.text : '',
        finishReason: 'stop' as const,
      };
    },
  };
}

// ── Roles ────────────────────────────────────────────────────────────────────
const sage = defineRole({
  role: 'Sage',
  backstory: 'Senior analytics specialist. Expert at reading metric signals and identifying root causes.',
  goal: 'Summarise the most important signal in the provided data and explain what it means.',
  llm: makeLlm('You are Sage, a senior analytics specialist.'),
});

const prism = defineRole({
  role: 'Prism',
  backstory: 'Growth strategist who translates analytics insight into customer-facing decisions.',
  goal: 'Turn the analytics summary into a concrete launch or response recommendation.',
  llm: makeLlm('You are Prism, a growth strategist.'),
});

// ── Tasks ────────────────────────────────────────────────────────────────────
const analyzeMetrics = defineTask({
  name: 'Analyze metrics',
  description: 'Review the input and identify the most important business signal.',
  expectedOutput: 'A concise analytics summary with the key finding highlighted.',
  agent: sage,
});

const recommendAction = defineTask({
  name: 'Recommend action',
  description: 'Convert the analytics summary into a concrete recommendation memo.',
  expectedOutput: 'A short recommendation: what to do, why, and what to watch.',
  agent: prism,
  context: [analyzeMetrics],   // prism sees sage's output before writing
});

// ── Team ─────────────────────────────────────────────────────────────────────
const meridian = createTeam({
  name: 'Meridian',
  agents: [sage, prism],
  tasks: [analyzeMetrics, recommendAction],
});

// ── Run ──────────────────────────────────────────────────────────────────────
const result = await meridian.run(
  'Store traffic is up 18% this week, but checkout conversion dropped 6% ' +
  'immediately after the new landing page launched on Monday.',
);

console.log('=== Final output ===');
console.log(result.output);

console.log('\n=== Per-task outputs ===');
for (const [taskName, output] of Object.entries(result.taskOutputs)) {
  console.log(`\n[${taskName}]`);
  console.log(output);
}
```

---

## Add team planning

When tasks are complex enough that agents benefit from a shared pre-run plan, enable `planning`:

```ts
const meridian = createTeam({
  name: 'Meridian',
  agents: [sage, prism],
  tasks: [analyzeMetrics, recommendAction],
  planning: true,   // agents reason about approach before executing tasks
});
```

With planning enabled, the team generates a brief shared plan before starting individual tasks. This improves consistency when tasks are deeply interdependent.

---

## Enable delegation

Allow roles to hand off work they are not best suited for:

```ts
const sage = defineRole({
  role: 'Sage',
  backstory: 'Senior analytics specialist.',
  goal: 'Identify the most important signal.',
  llm: makeLlm('You are Sage.'),
  allowDelegation: true,  // sage can delegate sub-tasks to other roles
});
```

---

## Route mode — direct requests to the right specialist

Use `mode: 'route'` when the team should direct each request to the single most appropriate agent rather than running all tasks in sequence:

```ts
import { createTeam, defineRole } from 'personaforge/orchestration';

const analyticsSpec = defineRole({
  role: 'Analytics Specialist',
  backstory: 'Expert in metrics, dashboards, and data interpretation.',
  goal: 'Answer analytics questions accurately.',
  llm: makeLlm('You are an analytics specialist.'),
});

const strategySpec = defineRole({
  role: 'Strategy Specialist',
  backstory: 'Expert in growth strategy and go-to-market planning.',
  goal: 'Answer strategy questions with actionable recommendations.',
  llm: makeLlm('You are a strategy specialist.'),
});

const router = createTeam({
  name: 'MeridianRouter',
  mode: 'route',
  agents: [analyticsSpec, strategySpec],
  capabilities: [
    ['metrics', 'analytics', 'dashboard', 'data', 'conversion'],
    ['strategy', 'growth', 'launch', 'recommendation', 'go-to-market'],
  ],
});

const result = await router.run('How should we respond to the conversion drop?');
console.log(result.output);
// → routed to Strategy Specialist
```

---

## Move to `createSupervisor` when delegation must be explicit

Use `createSupervisor` when you need one coordinating agent to decide which workers handle each step:

```ts
import {
  createSupervisor,
  createRole,
  createRunnableAgent,
  AgentState,
  CoordinationType,
} from 'personaforge/orchestration';

const sageWorker = createRunnableAgent({
  name: 'sage-worker',
  description: 'Identifies key business signals from metric data.',
  run: async (input) => ({
    result: { summary: `Sage analysis of: ${input.prompt}` },
    state: AgentState.COMPLETED,
    metadata: { startTime: new Date(), endTime: new Date(), durationMs: 0, iterations: 1 },
  }),
});

const prismWorker = createRunnableAgent({
  name: 'prism-worker',
  description: 'Converts analytics insight into launch recommendations.',
  run: async (input) => ({
    result: { recommendation: `Prism recommendation for: ${input.prompt}` },
    state: AgentState.COMPLETED,
    metadata: { startTime: new Date(), endTime: new Date(), durationMs: 0, iterations: 1 },
  }),
});

const supervisor = createSupervisor({
  name: 'meridian-supervisor',
  coordinationType: CoordinationType.SEQUENTIAL,
  subAgents: [
    { agent: sageWorker,  role: createRole('Sage',  ['Analyse metrics and identify signals']) },
    { agent: prismWorker, role: createRole('Prism', ['Convert signals into recommendations']) },
  ],
});

const outcome = await supervisor.run(
  { prompt: 'Traffic up 18%, conversion down 6% after new landing page.' },
  { agentId: 'meridian-supervisor', metadata: {} },
);

console.log(outcome.result);
```

---

## What's next?

- [09 · Supervisor Workflow](./09-supervisor) — explicit coordination with `createSupervisor`
- [08 · Multi-Agent Team](./08-team) — task-driven team with route mode
- [Orchestration guide](../guide/orchestration) — full team and supervisor API reference
