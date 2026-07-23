---
title: Output Parsers
description: Parse and validate LLM output — String, JSON (Zod-aware), CSV list, and Regex parsers, plus OutputFixingParser and RetryWithErrorParser for self-correcting extraction.
outline: [2, 3]
---

# Output Parsers

Parsers turn raw LLM text into typed, validated data. Every parser extends `Runnable<string, T>`, so they compose with `.pipe()` after an LLM call.

```ts
import {
  StringOutputParser, JsonOutputParser, CsvListParser, RegexParser,
  OutputFixingParser, RetryWithErrorParser, ParseError,
} from 'confused-ai/parsers';
```

---

## `JsonOutputParser`

Extracts JSON from raw text or from a fenced ```` ```json ```` block, and optionally validates against a Zod schema.

```ts
import { z } from 'zod';

const schema = z.object({ name: z.string(), age: z.number() });
const parser = new JsonOutputParser({ schema });

const chain = llm.pipe(parser);
const person = await chain.invoke('Give me a person as JSON');
// Validated { name, age }; throws ParseError on malformed output
```

Without a schema it returns the parsed value untyped-checked (cast to `T`):

```ts
const parser = new JsonOutputParser<{ answer: string }>();
```

---

## `StringOutputParser`

Identity parser that trims whitespace. Useful as the terminal step of a chain that just needs clean text.

```ts
const chain = llm.pipe(new StringOutputParser());
```

---

## `CsvListParser`

Splits a comma-separated response into `string[]`.

```ts
await new CsvListParser().invoke('apples, bananas, cherries');
// ['apples', 'bananas', 'cherries']
```

`getFormatInstructions()` returns a hint you can inject into your prompt.

---

## `RegexParser`

Extracts named capture groups into a `Record<string, string>`.

```ts
const parser = new RegexParser(/(?<name>\w+):(?<age>\d+)/);
await parser.invoke('bob:42');
// { name: 'bob', age: '42' }
```

---

## Self-correcting parsers

### `OutputFixingParser`

On parse failure, sends the malformed output plus the error to a (cheap) fixer LLM and parses again.

```ts
const parser = new OutputFixingParser({
  parser: new JsonOutputParser({ schema }),
  fixer: (prompt) => cheapLlm.generate(prompt),
  maxRetries: 1,
});
```

### `RetryWithErrorParser`

On failure, re-runs the **original chain** with the error fed back into the prompt, letting the model self-correct with full context.

```ts
const parser = new RetryWithErrorParser({
  parser: new JsonOutputParser({ schema }),
  retryChain: llm,       // a Runnable<string, string>
  maxRetries: 2,
});
```

---

## Error handling

All parsers throw `ParseError` (a named subclass of `Error`) on failure so you can catch parsing problems specifically:

```ts
try {
  await parser.invoke(raw);
} catch (err) {
  if (err instanceof ParseError) { /* handle malformed output */ }
}
```

---

## Related pages

- [Runnable / LCEL](/guide/runnable) — chain composition.
- [Structured Output](/guide/structured-output) — native provider-level JSON schema.
