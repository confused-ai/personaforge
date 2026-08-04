---
title: Processors
description: Mastra-style input/output/error processor pipeline. Transform, validate, and control messages as they pass through an agent — moderation, PII, token limits, prompt injection, and more.
outline: [2, 3]
---

# Processors

`personaforge/processors` is a Mastra-style inspired processor pipeline. Input/output/error processors transform, validate, and control messages as they flow through an agent. Combined with the built-in guardrail processors, they form the **security + quality layer** of the runtime.

```ts
import { ModerationProcessor, TokenLimiter, PIIDetector } from 'personaforge/processors';
```

---

## Quick start

Attach processors to an agent at creation time:

```ts
import { agent } from 'personaforge';
import {
  TokenLimiter,
  PIIDetector,
  ModerationProcessor,
  PromptInjectionDetector,
} from 'personaforge/processors';

const bot = agent({
  instructions: 'You are a helpful assistant.',
  inputProcessors: [
    new TokenLimiter(64_000),                       // cap input size
    new PIIDetector({ strategy: 'redact' }),        // redact PII
    new PromptInjectionDetector({ strategy: 'block' }),
    new ModerationProcessor({ strategy: 'block' }), // content moderation
  ],
});
```

You can also override processors **per run** — per-call arrays replace the agent-level arrays for that run only:

```ts
await bot.run('Tell me a story', {
  processors: {
    input: [new TokenLimiter(10_000)],
    output: [new EnsureFinalResponse()],
  },
});
```

---

## Processor stages

A `ProcessorSet` has three phases:

| Phase | Runs when | Typical use |
|---|---|---|
| `input` | Before messages reach the LLM | Token caps, PII redaction, moderation, injection defense |
| `output` | After the LLM responds | Validate answer shape, final-response enforcement, cache writes |
| `error` | Provider rejects a request | Retry with recovery messages |

Within a processor, several hooks fire at specific points (input, input-step, LLM-request, LLM-response, output-step, output-result, output-stream, API-error). A processor coordinates between its own hooks via a per-request `state` scratchpad.

Processors can `abort()` (throw a `TripWireError`) to block a request, `sendSignal()` to inject a `<system-reminder>` user message, and reuse per-request state across hooks.

---

## Built-in processors

| Processor | What it does |
|---|---|
| `TokenLimiter` | Caps input tokens (block/warn) |
| `UnicodeNormalizer` | Normalizes unicode in messages |
| `ToolCallFilter` | Allows/blocks tool calls by name |
| `PIIDetector` | Detects / redacts / blocks PII |
| `PromptInjectionDetector` | Detects / blocks prompt-injection patterns |
| `ModerationProcessor` | Content moderation (block/warn/detect) |
| `CostGuardProcessor` | Budgets request cost |
| `LanguageDetector` | Detects message language |
| `BatchPartsProcessor` | Batches multimodal parts |
| `SystemPromptScrubber` | Strips secrets from system prompts |
| `ResponseCache` | Caches LLM responses by prompt |
| `EnsureFinalResponse` | Forces a final answer after max steps |
| `ContextLengthHandler` | Handles context overflow |

LLM-backed processors accept an optional `classify` function so you can plug in any model judge; deterministic heuristic implementations are used by default (zero extra calls).

---

## Writing a custom processor

A processor is any object implementing the `Processor` interface — implement one or more hooks; `id` must be unique (it scopes the per-request `state`):

```ts
import type { Processor, ProcessInputArgs } from 'personaforge/processors';

const myChecker: Processor = {
  id: 'my-checker',

  async processInput({ messages, abort }: ProcessInputArgs) {
    for (const m of messages) {
      if (typeof m.content === 'string' && m.content.includes('secret:')) {
        abort('Contains forbidden content', { metadata: { match: 'secret:' } });
      }
    }
    return messages;
  },
};
```

Other hooks: `processInputStep`, `processLLMRequest`, `processLLMResponse`, `processOutputStep`, `processOutputStream`, `processOutputResult`, and `processAPIError`.

---

## Related pages

- [Guardrails](./guardrails) — the guardrail module (rules + validators).
- [Memory](./memory) — memory processors (`MessageHistoryProcessor`, …).
- [Production](./production) — resilience and safety in production.