---
title: Reasoning
description: Chain-of-Thought and Tree-of-Thought reasoning with ReasoningManager and TreeOfThoughtEngine — emit structured ReasoningStep events for inspectable, streamable multi-step thinking.
outline: [2, 3]
---

# Reasoning

The reasoning module gives agents explicit, inspectable multi-step thinking. Use `ReasoningManager` for Chain-of-Thought (CoT) and `TreeOfThoughtEngine` for Tree-of-Thought (ToT) reasoning.

> **Experimental.** This subsystem is newer and not yet semver-stable — its CoT/ToT engines and config shapes may change in a minor release.

```ts
import {
  ReasoningManager,
  TreeOfThoughtEngine,
  ReasoningEventType,
  NextAction,
} from 'confused-ai';
```

---

## Chain-of-Thought with `ReasoningManager`

```ts
import { createAgent, OpenAIProvider } from 'confused-ai';
import { ReasoningManager, ReasoningEventType } from 'confused-ai';

const llm = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY!, model: 'gpt-4o' });

const manager = new ReasoningManager({
  generate: async (messages) => llm.generate(messages),
  minSteps: 2,       // minimum reasoning steps before final answer
  maxSteps: 10,      // maximum steps before forced termination
  // systemPrompt: '...',  // override the built-in CoT prompt
});

const messages = [
  { role: 'user' as const, content: 'A farmer has 17 sheep. All but 9 die. How many are left?' },
];

for await (const event of manager.reason(messages)) {
  switch (event.eventType) {
    case ReasoningEventType.STARTED:
      console.log('Reasoning started');
      break;
    case ReasoningEventType.STEP:
      console.log(`Step: ${event.step?.title}`);
      console.log(`  Action:     ${event.step?.action}`);
      console.log(`  Result:     ${event.step?.result}`);
      console.log(`  Confidence: ${event.step?.confidence}`);
      console.log(`  Next:       ${event.step?.nextAction}`);
      break;
    case ReasoningEventType.DELTA:
      process.stdout.write(event.contentDelta ?? '');
      break;
    case ReasoningEventType.COMPLETED:
      console.log('\nFinal answer:', event.steps?.at(-1)?.result);
      console.log('Total steps:', event.steps?.length);
      break;
    case ReasoningEventType.ERROR:
      console.error('Reasoning error:', event.error);
      break;
  }
}
```

Prefer a single result over the event stream? `await manager.run(messages)` collects every step and returns a `ReasoningResult` (`{ steps, success, error? }`). The default CoT system prompt is exported as `REASONING_SYSTEM_PROMPT` if you want to extend rather than replace it.

---

## `ReasoningStep` fields

Each step emitted by `ReasoningManager` contains:

| Field | Type | Description |
|---|---|---|
| `title` | `string` | Short title summarising this step |
| `action` | `string` | What the agent plans to do ("I will...") |
| `result` | `string` | What happened after executing the action |
| `reasoning` | `string` | Rationale and assumptions |
| `nextAction` | `NextAction` | `continue` \| `validate` \| `final_answer` \| `reset` |
| `confidence` | `number` | 0.0–1.0 confidence score |

---

## Attach reasoning to an agent

Pass a `ReasoningManager` to `createAgent()` for automatic CoT on every run:

```ts
import { createAgent } from 'confused-ai';
import { ReasoningManager } from 'confused-ai';

const agent = createAgent({
  name: 'reasoning-agent',
  instructions: 'Solve problems step by step.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  reasoning: new ReasoningManager({
    generate: async (msgs) => llm.generate(msgs),
    maxSteps: 8,
  }),
  // Stream reasoning steps in the result
  streamReasoningSteps: true,
});

const result = await agent.run('What is the optimal strategy for the knapsack problem?');
console.log(result.reasoningSteps);  // full array of ReasoningStep
console.log(result.text);            // final answer
```

---

## Tree-of-Thought

`TreeOfThoughtEngine` explores multiple reasoning branches and picks the best path:

```ts
import { TreeOfThoughtEngine } from 'confused-ai';

const tot = new TreeOfThoughtEngine({
  generate: async (messages) => llm.generate(messages),
  beamWidth: 3,          // branches to expand and keep per BFS level
  maxDepth: 4,           // max tree depth
  // Optional separate evaluator. Receives a messages array and returns a score
  // as a string — either a plain float ('0.0'–'1.0') or JSON `{ "score": 0.8 }`.
  // Defaults to `generate` when omitted.
  evaluate: async (messages) => llm.generate(messages),
});

// solve(goal, context?) runs beam search and returns the best branch.
const result = await tot.solve(
  'What is the optimal strategy for the knapsack problem?',
);

console.log(result.bestThought); // best final thought text
console.log(result.score);       // cumulative score of the winning branch (0–1)
console.log(result.nodes);       // full beam tree (TotNode[], for inspection)
console.log(result.depth);       // number of BFS levels traversed
```

---

## Where to go next

- [Planner](./planner) — decompose a goal into an explicit execution plan.
- [Workflows](./workflows) — graph-based execution with explicit branching.
- [Example 19: Reasoning agent](../examples/19-reasoning) — full CoT example.
