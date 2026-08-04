---
title: Agent Registry
description: Register runnable agents once, resolve by name, search by description/tags, and expose every registered agent to a parent orchestrator as a tool.
outline: [2, 3]
---

# Agent Registry

`personaforge/registry` provides a first-class agent registry for registration, discovery, and delegation. Register runnable agents once, resolve them by name, search by description/tags, and expose any (or all) registered agents to a parent orchestrator as tools in a single call.

```ts
import { createAgentRegistry } from 'personaforge/registry';
```

---

## Quick start

```ts
import { createAgentRegistry } from 'personaforge/registry';
import { agent } from 'personaforge';

const registry = createAgentRegistry();

registry.register({
  name: 'translator',
  description: 'Translate text into another language',
  tags: ['language', 'nlp'],
  agent: agent('You translate text.'),
});

registry.register({
  name: 'summarizer',
  description: 'Summarize long documents',
  tags: ['nlp', 'summarization'],
  agent: agent('You summarize documents.'),
});

// O(1) lookup by name
const t = registry.get('translator');              // AgentRecord

// Case-insensitive discovery across name/description/tags
const matches = registry.search('translate');      // → [translator record]
const scoped = registry.search('nlp');             // → [translator, summarizer]

// Delegate to any agent as an LLM tool
const translateTool = registry.asTool('translator');

// Or expose every registered agent as a delegation toolkit:
const tools = registry.toTools();                  // one tool per agent
```

---

## Registration metadata

`AgentRecord` carries discovery + marketplace metadata:

```ts
registry.register({
  name: 'finance-report',
  description: 'Generate a weekly finance report',
  tags: ['finance', 'reporting'],
  version: '1.2.0',
  author: 'data-team',
  metadata: { owner: 'finance@example.com', sla: 'p1' },
  agent: financeAgent,
});
```

---

## Managing agents

```ts
registry.size        // number of agents
registry.names()     // registered names, in order
registry.list()      // Array<{ name, registration }>
registry.has('x')    // boolean
registry.resolve('x') // the raw runnable agent
registry.remove('x') // boolean (true if removed)
registry.clear()     // remove all

// Batch registration (throws on duplicates):
registry.registerMany([
  { name: 'a', agent: agentA },
  { name: 'b', agent: agentB },
]);
```

`register()` throws if the name is empty or already registered.

---

## Delegation — agents as tools

Each registered agent can be exposed to a parent LLM as a function-calling tool. This is the "agent registry → orchestrator" pattern:

```ts
// Single agent as a tool with overrides:
const tool = registry.asTool('translator', {
  category: 'language',
  tags: ['delegate'],
});

// All agents at once:
const allTools = registry.toTools();
// Consistent category across all exports:
const categorized = registry.toToolsWithCategory('language');
```

Pass `allTools` directly to an orchestrator agent's `tools` and the parent LLM can delegate work to any registered specialist.

---

## Related pages

- [Orchestration](./orchestration) — supervisors and multi-agent systems that consume registry tools.
- [Agents](./agents) — `agent()` / `createAgent()` reference.
- [Tools](./tools) — `agentAsTool` / tool helpers.