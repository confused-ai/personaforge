---
title: Runnable / LCEL
description: Composable Runnable primitive — pipe, batch, stream, map, bind, withRetry, withFallbacks, withConfig, assign — for LCEL-style chain composition.
outline: [2, 3]
---

# Runnable / LCEL

`Runnable<I, O>` is the universal unit of composition in confused-ai. Everything that takes input and produces output — a prompt template, an LLM call, a parser, a retriever — can be a `Runnable` and composed with `.pipe()`.

```ts
import {
  Runnable, RunnableLambda, RunnableSequence,
  RunnableParallel, RunnablePassthrough,
} from 'confused-ai/runnable';
```

---

## Quick start

```ts
const upper = new RunnableLambda<string, string>((s) => s.toUpperCase());
const exclaim = new RunnableLambda<string, string>((s) => s + '!');

const chain = upper.pipe(exclaim);
await chain.invoke('hello'); // 'HELLO!'
```

Chains flatten automatically. `a.pipe(b).pipe(c)` creates a three-step `RunnableSequence`, not a nested structure.

---

## Core methods

| Method | What it does |
|---|---|
| `.invoke(input)` | Execute the chain, return a single output |
| `.batch(inputs, { concurrency })` | Run N inputs in parallel |
| `.stream(input)` | Return an `AsyncGenerator` of incremental outputs |
| `.pipe(next)` | Chain two Runnables |
| `.map(fn)` | Transform the output |
| `.bind(kwargs)` | Partial-apply input fields |
| `.withRetry({ maxRetries, delayMs })` | Retry on error with exponential backoff |
| `.withFallbacks([alt1, alt2])` | Try alternatives on failure |
| `.withConfig({ tags, metadata })` | Inject config defaults |
| `.assign({ key: Runnable })` | Fan-out, merge results |

---

## Batching

```ts
const results = await upper.batch(['a', 'b', 'c'], { concurrency: 2 });
// ['A', 'B', 'C']
```

Concurrency is bounded by a worker pool; no Promise.all explosion.

---

## Streaming

The default `.stream()` yields a single result. Subclasses override for true token-level streaming:

```ts
for await (const chunk of chain.stream('input')) {
  process.stdout.write(chunk);
}
```

A `RunnableSequence` streams: it eagerly invokes all steps except the last, then yields tokens from the final step.

---

## Retry and fallback

```ts
const safe = llm
  .withRetry({ maxRetries: 3, delayMs: 200 })
  .withFallbacks([backupLlm]);
```

- `withRetry` uses exponential backoff: `delayMs * 2^attempt`.
- `withFallbacks` tries alternatives in order; throws only when all are exhausted.
- Both compose: retry wraps the primary, fallback wraps the retried primary.

---

## Assign (parallel fan-out)

Run named branches in parallel, merge results into the input object:

```ts
const base = new RunnablePassthrough<{ q: string }>();
const chain = base.assign({
  len: new RunnableLambda((x: { q: string }) => x.q.length),
  up: new RunnableLambda((x: { q: string }) => x.q.toUpperCase()),
});

await chain.invoke({ q: 'hi' });
// { q: 'hi', len: 2, up: 'HI' }
```

---

## `RunnableParallel`

Run named branches without a base passthrough:

```ts
const par = new RunnableParallel({
  a: new RunnableLambda<number, number>((n) => n + 1),
  b: new RunnableLambda<number, number>((n) => n * 2),
});

await par.invoke(10); // { a: 11, b: 20 }
```

---

## Building chains with parsers

Every parser in `confused-ai/parsers` extends `Runnable`, so they compose:

```ts
import { JsonOutputParser } from 'confused-ai/parsers';

const chain = llm.pipe(new JsonOutputParser<{ answer: string }>());
const result = await chain.invoke('What is 2+2?');
// { answer: '4' }
```

---

## Related pages

- [Output Parsers](/guide/output-parsers) — String, JSON, CSV, fixing, retry parsers.
- [Model Fallbacks](/guide/model-fallbacks) — provider-level resilience.
