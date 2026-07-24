---
title: "Runbook: Model"
description: "Operational runbook for personaforge/model — import, run, verify, recover. 61 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Model

> Auto-generated from `./dist/model.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/model`  ·  **Public symbols:** 61  ·  **Guide:** [/guide/providers](../guide/providers.md)

## What it is
`personaforge/model` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createOpenRouterProvider, openai, anthropic } from 'personaforge/model';
```

## Public API surface
- **Factories / functions** — `createOpenRouterProvider`, `openai`, `anthropic`, `ollama`
- **Classes** — `OpenAIProvider`, `AnthropicProvider`, `GoogleProvider`, `BedrockConverseProvider`, `OpenAIEmbeddingProvider`, `CostTracker`
- **Constants** — `MODEL_PRICING`
- **Interfaces** — `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, `LLMProvider`, `TextContent`, `ImageContent`, `OpenAIToolCall`, `StreamToolCallChunk`, `StreamOptions`, `OpenAIClient`, …(+31)
- **Types** — `MessageContent`, `StreamDelta`, `OpenAIContent`, `OpenAIMessageParam`, `AnthropicContent`, `AnthropicMessageParam`, `GooglePart`

## Minimal use
Real example from the providers guide:

```ts
import { createOpenRouterProvider } from 'personaforge';

const llm = createOpenRouterProvider({
  apiKey: process.env.OPENROUTER_API_KEY!,
  model: 'anthropic/claude-sonnet-4',  // any OpenRouter model id
});
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/model` with no missing-module error.
- Runtime: `node -e "import('personaforge/model').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/providers](../guide/providers.md).

## Common failures
- `Cannot find module 'personaforge/model'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/providers](../guide/providers.md)
