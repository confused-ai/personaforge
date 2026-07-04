---
title: Learning Machine
description: Coordinate multiple memory stores (user profile, session context, entity memory, learned knowledge, decision logs) via LearningMachine. Build adaptive agents that improve across runs.
outline: [2, 3]
---

# Learning Machine

`LearningMachine` coordinates multiple memory store types under a single API. It retrieves relevant context before each LLM call and extracts new learnings after each turn — keeping agents adaptive without making the system opaque.

```ts
import { LearningMachine } from 'confused-ai';
```

---

## Quick start

```ts
import { LearningMachine } from 'confused-ai';
import { SqliteAgentDb } from 'confused-ai';
import { createAgent } from 'confused-ai';

const db = new SqliteAgentDb({ path: './agent.db' });

// All five stores auto-created using the db backend
const machine = new LearningMachine({ db });

const agent = createAgent({
  name: 'adaptive-assistant',
  instructions: 'Help users. Use your memory to personalise responses.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  hooks: {
    buildSystemPrompt: async (base, ctx) => {
      // Inject remembered context into every run
      const memory = await machine.buildContext({
        userId:    ctx.userId,
        sessionId: ctx.sessionId,
        message:   ctx.prompt,
      });
      return memory ? `${base}\n\n${memory}` : base;
    },
    afterRun: async (result) => {
      // Extract and persist new learnings from this turn
      await machine.process({
        messages:  result.messages,
        userId:    result.userId,
        sessionId: result.sessionId,
      });
      return result;
    },
  },
});
```

---

## Store types

Each store is opt-in — use only what the task requires:

| Store | Purpose |
|---|---|
| `userProfile` | Structured user attributes (name, preferences, language) |
| `userMemory` | Unstructured user memories (free-text facts per user) |
| `sessionContext` | Per-session summary, current goal, and plan |
| `entityMemory` | Memories about companies, projects, people (named entities) |
| `learnedKnowledge` | Reusable insights and patterns across all users |
| `decisionLog` | Log of agent decisions for auditability and reflection |

---

## `LearningMachine` API

```ts
// Build a context string to inject into the system prompt
const context = await machine.buildContext({
  userId: 'user-42',
  sessionId: 'sess-xyz',
  message: 'What were we working on last time?',
  namespace: 'default',     // optional: scope entity/knowledge queries
});

// Raw recall — returns one key per store (useful for inspection/testing)
const recalled = await machine.recall({ userId: 'user-42', sessionId: 'sess-xyz' });
// recalled.userProfile, recalled.userMemory, recalled.sessionContext...

// Process a completed turn and persist learnings.
// `messages` is required. The base implementation is effectively a no-op —
// extend it with custom stores to plug in LLM-based extraction.
await machine.process({
  messages,
  userId: 'user-42',
  sessionId: 'sess-xyz',
});

// Get callable tools the agent can use to update its own memory.
// getTools() is synchronous and returns bare callables (LearningTool[]) —
// plain functions, NOT framework Tools.
const tools = machine.getTools({ userId: 'user-42' });
// Returns: [addMemory, updateMemory, deleteMemory, updateContext, addEntityFact,
//   addEntityEvent, saveKnowledge, searchKnowledge, logDecision, searchDecisions]
```

---

## `LearningMachineConfig`

```ts
interface LearningMachineConfig {
  /** Structured user profile store */
  userProfile?: UserProfileStore;
  /** Unstructured user memory store */
  userMemory?: UserMemoryStore;
  /** Per-session context store */
  sessionContext?: SessionContextStore;
  /** Entity memory store */
  entityMemory?: EntityMemoryStore;
  /** Learned knowledge store */
  learnedKnowledge?: LearnedKnowledgeStore;
  /** Decision log store */
  decisionLog?: DecisionLogStore;
  /** Curator for pruning and deduplicating memories */
  curator?: Curator;
  /** Optional db backend — any unspecified store is auto-created */
  db?: AgentDb;
  /** Default namespace for entity/knowledge stores (default: 'global') */
  namespace?: string;
  debug?: boolean;
}
```

---

## Self-updating memory tools

Give the agent tools to update its own memory during a run:

```ts
import { tool } from 'confused-ai';
import { z } from 'zod';

const machine = new LearningMachine({ db });

// getTools() is synchronous and returns bare callables (LearningTool[]), not
// framework Tools — wrap each with tool() before passing to createAgent.
// (Most take a single string argument; widen the schema per tool as needed.)
const memoryTools = machine.getTools({ userId: 'user-42' }).map((fn) =>
  tool({
    name: fn.name,                          // e.g. 'addMemory', 'saveKnowledge'
    description: `Learning memory tool: ${fn.name}`,
    parameters: z.object({ input: z.string() }),
    execute: async ({ input }) => String(await fn(input)),
  }),
);

const agent = createAgent({
  name: 'personal-assistant',
  instructions: 'Help the user. Use memory tools to save important facts.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: memoryTools,   // agent can call addMemory, addEntityFact, saveKnowledge, etc.
});
```

---

## Where to go next

- [Memory](./memory) — underlying memory stores (InMemoryMemoryStore, DbMemoryStore).
- [Session](./session) — session continuity underlying `sessionContext`.
- [Eval](./eval) — measure whether learning is improving outcomes.
