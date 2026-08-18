---
title: Reasoning
description: Chain-of-Thought, Tree-of-Thought, Reflexion, ReWOO, and Graph-of-Thoughts reasoning engines — emit structured ReasoningStep events for inspectable, streamable multi-step thinking.
outline: [2, 3]
---

# Reasoning

The reasoning module gives agents explicit, inspectable multi-step thinking across five standard frameworks:

- **Chain-of-Thought (CoT)**: `ReasoningManager` step-by-step reasoning.
- **Tree-of-Thought (ToT)**: `TreeOfThoughtEngine` beam search tree.
- **Reflexion**: `ReflexionEngine` actor-evaluator-reflection critique retry loop.
- **ReWOO**: `ReWOOEngine` decoupled planning with variable substitution (`#E1`, `#E2`) and execution.
- **Graph-of-Thoughts (GoT)**: `GotEngine` non-linear graph with node generation, refinement, aggregation, and graph scoring.

> **Experimental.** This subsystem is newer and not yet semver-stable — its engines and config shapes may change in a minor release.

```ts
import {
  ReasoningManager,
  TreeOfThoughtEngine,
  ReflexionEngine,
  ReWooEngine,
  GotEngine,
} from 'personaforge';
```

---

## Agentic Loop Strategies

When configuring an `AgenticRunner` or agent reasoning options, set `reasoning.strategy` to choose the active engine:

```ts
const agent = createAgent({
  name: 'reasoner',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  reasoning: {
    enabled: true,
    strategy: 'cot' | 'tot' | 'reflexion' | 'rewoo' | 'got',
    maxSteps: 6,
  },
});
```

---

## Reflexion (`ReflexionEngine`)

Reflexion implements verbal reinforcement learning (Shinn et al. 2023). It executes candidate generation, evaluation, and self-critique:

```ts
import { ReflexionEngine } from 'personaforge';

const reflexion = new ReflexionEngine({
  generate: async (msgs) => llm.generate(msgs),
  maxAttempts: 3,
  evaluate: async (response, goal) => {
    const passed = response.includes('42');
    return { passed, score: passed ? 1.0 : 0.2, feedback: passed ? 'Correct' : 'Missing result' };
  },
});

const result = await reflexion.solve('Solve equation step by step');
console.log(result.solution);      // winning response text
console.log(result.passed);        // boolean verdict
console.log(result.attempts);      // full step trace with self-critiques
```

---

## ReWOO (`ReWooEngine`)

ReWOO decouples planning from tool execution (Wang et al. 2023) using `#E` variable placeholders to eliminate redundant context tokens:

```ts
import { ReWooEngine } from 'personaforge';

const rewoo = new ReWooEngine({
  generate: async (msgs) => llm.generate(msgs),
  executeTool: async (toolName, input) => {
    return runMyTool(toolName, input);
  },
});

const result = await rewoo.solve('Find weather in Tokyo and calculate clothing index');
console.log(result.plan);          // execution steps (#E1, #E2)
console.log(result.variableMap);   // { '#E1': '22C', '#E2': 'Light jacket' }
console.log(result.solution);      // synthesized final answer
```

---

## Graph-of-Thoughts (`GotEngine`)

GoT (Besta et al. 2023) expands thoughts into a non-linear graph with generate, aggregate, and refine operations:

```ts
import { GotEngine } from 'personaforge';

const got = new GotEngine({
  generate: async (msgs) => llm.generate(msgs),
  numBranches: 4,
  maxIterations: 3,
  keepBest: 3,
});

const result = await got.solve('Optimize supply chain logistics');
console.log(result.solution);      // highest-scoring node output
console.log(result.nodes);         // all graph nodes (operations: generate, refine, aggregate)
console.log(result.edges);         // graph connectivity edges
```

---

## Chain-of-Thought with `ReasoningManager`

```ts
import { ReasoningManager, ReasoningEventType } from 'personaforge';

const manager = new ReasoningManager({
  generate: async (messages) => llm.generate(messages),
  minSteps: 2,
  maxSteps: 10,
});

for await (const event of manager.reason(messages)) {
  if (event.eventType === ReasoningEventType.STEP) {
    console.log(`Step: ${event.step?.title}`);
  }
}
```

---

## Tree-of-Thought (`TreeOfThoughtEngine`)

```ts
import { TreeOfThoughtEngine } from 'personaforge';

const tot = new TreeOfThoughtEngine({
  generate: async (messages) => llm.generate(messages),
  beamWidth: 3,
  maxDepth: 4,
});

const result = await tot.solve('Solve puzzle');
console.log(result.bestThought, result.score);
```

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

## Where to go next

- [Planner](./planner) — decompose a goal into an explicit execution plan.
- [Workflows](./workflows) — graph-based execution with explicit branching.
- [Example 19: Reasoning agent](../examples/19-reasoning) — full CoT example.
