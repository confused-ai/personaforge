---
title: Structured Output
description: Get JSON-schema-validated output from any LLM provider — OpenAI response_format, Anthropic tool-forced calls, Gemini responseSchema, and a prompt-plus-retry fallback for models without native support.
outline: [2, 3]
---

# Structured Output

`generateStructured()` gives you validated, typed output from any LLM provider using each provider's native structured-output API when available, and a prompt-plus-retry fallback when it is not.

```ts
import { generateStructured, detectProviderKind } from 'personaforge/structured';
```

Native paths:

| Provider | Native mechanism |
|---|---|
| OpenAI, OpenRouter | `response_format` with JSON schema |
| Anthropic | Forced tool call whose parameters are the schema |
| Gemini | `responseSchema` |
| Everything else | Prompt injection + parse retry |

Selection is automatic based on the provider class name.

---

## Quick start

```ts
import { z } from 'zod';

const Person = z.object({
  name: z.string(),
  age: z.number(),
  interests: z.array(z.string()),
});

const result = await generateStructured(
  llm,
  [{ role: 'user', content: 'Invent a person profile.' }],
  { parse: (data) => Person.parse(data), name: 'person' },
);

// result.data is Person
console.log(result.data.name);
console.log(result.attempts);   // 1 on success, up to maxRetries+1 on fallback
```

---

## Options

```ts
generateStructured(provider, messages, schema, {
  maxRetries: 3,   // fallback path only
  temperature: 0,  // + any GenerateOptions field
});
```

Return shape:

```ts
interface StructuredOutputResult<T> {
  data: T;                       // validated
  raw: string;                   // raw model text
  attempts: number;
  usage?: { promptTokens; completionTokens; totalTokens };
}
```

---

## Providing a schema

Two shapes are supported. Pick whichever you already have:

### Zod

Any object with a `.parse()` method (Zod v3 or v4) is accepted directly:

```ts
const Person = z.object({ name: z.string(), age: z.number() });
const result = await generateStructured(llm, msgs, {
  parse: (d) => Person.parse(d),
  name: 'person',
});
```

If Zod exposes `.toJSONSchema()`, it is called automatically to produce the JSON Schema that the provider needs.

### Raw JSON Schema

Pass a JSON Schema directly and let the caller do validation:

```ts
const result = await generateStructured(llm, msgs, {
  name: 'invoice',
  jsonSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      lineItems: { type: 'array', items: { type: 'object' } },
    },
    required: ['id', 'lineItems'],
  },
  parse: (d) => d, // caller-defined validation
});
```

---

## Detecting provider capability

```ts
import { detectProviderKind } from 'personaforge/structured';

const kind = detectProviderKind(llm);
// 'openai' | 'anthropic' | 'gemini' | 'bedrock' | 'unknown'
```

Used internally to route to the native path. Useful if you want to branch behaviour based on provider support.

---

## Fallback behaviour

Providers we do not recognise get the prompt-injection path:

1. The schema is appended as a system message.
2. If parse fails, the model is re-prompted with the error and asked to correct.
3. Retries up to `maxRetries`. On exhaustion the last error is thrown.

This makes structured output work on Ollama, DeepSeek, or any custom provider.

---

## Related pages

- [Output Parsers](/guide/output-parsers) — post-hoc parsing for text output.
- [Providers](/guide/providers) — provider registration.
