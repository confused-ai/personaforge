---
title: 19 · Reasoning
description: Use ReasoningManager for explicit multi-step reasoning loops with step-level visibility, confidence tracking, and provider-agnostic generate functions.
outline: [2, 3]
---

# 19 · Reasoning

`ReasoningManager` gives you a structured reasoning loop where each step is an explicit object — with a title, action, result, confidence score, and a declared next action. Use it when you need per-step visibility for incident triage, audit logs, or UI rendering of agent thought.

```ts
import { ReasoningManager, ReasoningEventType, NextAction } from 'personaforge/reasoning';
```

---

## What you'll learn

- How to create and drive a `ReasoningManager`
- How to consume reasoning events step by step
- How to wire the manager to a real LLM provider
- When to choose `ReasoningManager` over a plain agent loop

---

## Deterministic example

This example uses a scripted `generate` function to show the event contract clearly without depending on a specific model.

```ts
import { NextAction, ReasoningEventType, ReasoningManager } from 'personaforge/reasoning';

let calls = 0;

const manager = new ReasoningManager({
  minSteps: 1,
  maxSteps: 4,
  generate: async () => {
    calls += 1;

    if (calls === 1) {
      return JSON.stringify({
        title: 'Check the deployment window',
        action: 'Compare the incident start time to the recent deployment log.',
        result: 'The latency spike begins 3 minutes after the latest release.',
        reasoning: 'A recent change is the fastest high-confidence place to look first.',
        nextAction: NextAction.VALIDATE,
        confidence: 0.78,
      });
    }

    return JSON.stringify({
      title: 'Validate rollback hypothesis',
      action: 'Check whether reverting the release removes the latency symptom.',
      result: 'Rollback brings p99 latency back to baseline within 60 seconds.',
      reasoning: 'The deployment is the root cause with high confidence.',
      nextAction: NextAction.FINAL_ANSWER,
      confidence: 0.94,
    });
  },
});

for await (const event of manager.reason([
  { role: 'user', content: 'Diagnose why POST /orders started timing out after the release.' },
])) {
  if (event.eventType === ReasoningEventType.STEP && event.step) {
    console.log(`[${event.step.title}] confidence=${event.step.confidence} next=${event.step.nextAction}`);
  }

  if (event.eventType === ReasoningEventType.COMPLETED) {
    console.log(`Completed in ${event.steps?.length} steps`);
    console.log('Final answer:', event.steps?.at(-1)?.result);
  }
}
```

---

## Wire to a real LLM

Replace the scripted function with a real LLM call. The manager handles the loop — you only supply the `generate` function.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { NextAction, ReasoningEventType, ReasoningManager } from 'personaforge/reasoning';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `
You are a methodical incident investigator.
For each step, respond with a JSON object containing:
  title, action, result, reasoning, nextAction (one of: validate, continue, final_answer), confidence (0–1)
`;

const manager = new ReasoningManager({
  minSteps: 2,
  maxSteps: 6,
  generate: async (messages) => {
    const res = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: SYSTEM,
      messages: messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: String(m.content),
      })),
    });

    const block = res.content[0];
    return block.type === 'text' ? block.text : '';
  },
});

for await (const event of manager.reason([
  { role: 'user', content: 'Why is our checkout conversion rate down 12% since Tuesday?' },
])) {
  if (event.eventType === ReasoningEventType.STEP && event.step) {
    console.log(`Step: ${event.step.title}`);
    console.log(`  Action: ${event.step.action}`);
    console.log(`  Result: ${event.step.result}`);
    console.log(`  Confidence: ${event.step.confidence}`);
  }

  if (event.eventType === ReasoningEventType.COMPLETED) {
    console.log('\nFinal conclusion:', event.steps?.at(-1)?.result);
  }
}
```

---

## Reasoning event types

| Event type | When it fires |
|---|---|
| `ReasoningEventType.STEP` | After each reasoning step is generated |
| `ReasoningEventType.COMPLETED` | When `nextAction` is `FINAL_ANSWER` or `maxSteps` is reached |
| `ReasoningEventType.ERROR` | If `generate` throws an unrecoverable error |

---

## `NextAction` values

| Value | Meaning |
|---|---|
| `NextAction.VALIDATE` | Check the current hypothesis before continuing |
| `NextAction.CONTINUE` | Gather more information and iterate |
| `NextAction.FINAL_ANSWER` | Reasoning is complete — emit `COMPLETED` event |

---

## `ReasoningManager` options

```ts
new ReasoningManager({
  minSteps: 1,          // minimum steps before FINAL_ANSWER is allowed
  maxSteps: 6,          // hard cap — force-completes even without FINAL_ANSWER
  generate: async (messages) => string,  // your LLM call, returns JSON string
});
```

---

## When to use `ReasoningManager`

Use `ReasoningManager` when you need:

- **Explicit step objects** for incident triage, audit trails, or structured UI rendering
- **Confidence tracking** to know when the model is certain vs. speculating
- **Provider-agnostic loops** that work with any LLM, not just tool-calling models
- **Controllable depth** — set `minSteps` and `maxSteps` to bound reasoning cost

For simpler cases where you just want a good answer, a plain `createAgent()` call is sufficient. Use `ReasoningManager` when the *path* to the answer matters as much as the answer itself.

---

## What's next?

- [20 · Scheduled Agents](./20-scheduled-agents) — run reasoning loops on a cron schedule
- [09 · Supervisor Workflow](./09-supervisor) — delegate reasoning steps to specialist agents
- [Reasoning guide](../guide/reasoning) — full `ReasoningManager` API reference
