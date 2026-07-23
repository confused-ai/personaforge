# 08 · Multi-Agent Team

The current team API lives under `personaforge/orchestration` and is built around roles, tasks, and team modes.

## What you'll learn

- How to define specialist roles
- How to connect tasks with dependencies
- How to run a team and inspect per-task outputs

## Task-driven team

```ts
import { createTeam, defineRole, defineTask } from 'personaforge/orchestration';

const llm = {
  async generateText() {
    return { text: 'stubbed team response', finishReason: 'stop' as const };
  },
};

const researcher = defineRole({
  role: 'Researcher',
  backstory: 'You gather accurate product and billing facts.',
  goal: 'Collect the facts needed to answer the request.',
  llm,
});

const writer = defineRole({
  role: 'Writer',
  backstory: 'You turn raw findings into concise customer-facing responses.',
  goal: 'Write the final answer using the research output.',
  llm,
});

const research = defineTask({
  name: 'Research',
  description: 'Find the key facts about the user request.',
  expectedOutput: 'A short bullet list of verified facts.',
  agent: researcher,
});

const response = defineTask({
  name: 'Compose Response',
  description: 'Write the final response using the research task output.',
  expectedOutput: 'A short support-style response.',
  agent: writer,
  context: [research],
});

const team = createTeam({
  name: 'SupportTeam',
  agents: [researcher, writer],
  tasks: [research, response],
});

const result = await team.run('Explain the difference between the Pro and Enterprise plans.');

console.log(result.output);
console.log(result.taskOutputs);
```

## Route mode

```ts
import { createTeam, defineRole } from 'personaforge/orchestration';

const llm = {
  async generateText() {
    return { text: 'stubbed routed response', finishReason: 'stop' as const };
  },
};

const billing = defineRole({
  role: 'Billing Specialist',
  backstory: 'You answer invoice, refund, and payment questions.',
  goal: 'Resolve billing questions accurately.',
  llm,
});

const technical = defineRole({
  role: 'Technical Specialist',
  backstory: 'You answer integration and API questions.',
  goal: 'Resolve technical questions clearly.',
  llm,
});

const team = createTeam({
  name: 'RouterTeam',
  mode: 'route',
  agents: [billing, technical],
  capabilities: [
    ['billing', 'refunds', 'invoices'],
    ['api', 'technical', 'integration'],
  ],
});

const result = await team.run('I need help with an invoice refund.');
console.log(result.output);
```

## What's next?

- [09 · Supervisor Workflow](./09-supervisor)
- [11 · Customer Support Bot](./11-support-bot)