---
title: Model Fallbacks & Retry
description: withFallbacks and withRetry — provider-level resilience wrappers that give any LLMProvider automatic retry with exponential backoff and ordered fallback chains.
outline: [2, 3]
---

# Model Fallbacks & Retry

`withFallbacks` and `withRetry` are one-liner resilience wrappers around any `LLMProvider`. They compose, so you can retry the primary and then fall back to a different vendor.

```ts
import { withFallbacks, withRetry } from 'personaforge/models';
```

---

## `withFallbacks`

Try the primary provider first; on any error, walk the fallback list until one succeeds. Throws only when all providers fail.

```ts
const resilient = withFallbacks(
  openai('gpt-4o'),
  [anthropic('claude-3-5-sonnet'), ollama('llama3.1')],
);

await resilient.generateText(messages);
```

Streaming is proxied automatically if any provider in the list supports `streamText`.

---

## `withRetry`

Retry with exponential backoff. Backoff schedule: `baseDelayMs * 2^attempt`.

```ts
const retried = withRetry(openai('gpt-4o'), {
  maxRetries: 3,
  baseDelayMs: 200,
  retryOn: (err) => (err as Error).message.includes('429'),
});
```

If `retryOn` is omitted, every error triggers a retry.

---

## Composing

`withRetry` and `withFallbacks` compose in either order. A typical stack is retry the primary, then fall back on final failure:

```ts
const provider = withFallbacks(
  withRetry(openai('gpt-4o'), { maxRetries: 3 }),
  [anthropic('claude-3-5-sonnet'), ollama('llama3.1')],
);
```

Or fall back first (fast), then retry the whole chain:

```ts
const provider = withRetry(
  withFallbacks(openai('gpt-4o'), [anthropic('claude-3-5-sonnet')]),
  { maxRetries: 2 },
);
```

---

## Behaviour details

- `withFallbacks` never retries a single provider; use `withRetry` for that.
- `withRetry` retries on any thrown error unless `retryOn` returns `false`.
- Both preserve the underlying provider's `streamText` when present.

---

## Related pages

- [Providers](/guide/providers) — provider adapters.
- [LLM Router](/guide/llm-router) — cost/capability-aware routing (higher-level than fallbacks).
- [Resilience & Circuit Breakers](/guide/production) — process-wide guards.
