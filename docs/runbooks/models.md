---
title: "Runbook: Models"
description: "Operational runbook for personaforge/models — import, run, verify, recover. 81 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Models

> Auto-generated from `./dist/models.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/models`  ·  **Public symbols:** 81  ·  **Guide:** [/guide/providers](../guide/providers.md)

## What it is
`personaforge/models` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createOpenRouterProvider, openai, anthropic } from 'personaforge/models';
```

## Public API surface
- **Factories / functions** — `openai`, `anthropic`, `google`, `ollama`, `bedrock`, `createOpenRouterProvider`, `resolveModelString`, `isModelString`, `text`, `buildMessage`, `contentToText`, `isVisionCapable`, …(+12)
- **Classes** — `OpenAIProvider`
- **Constants** — `DEEPINFRA_BASE_URL`, `HUGGINGFACE_INFERENCE_BASE_URL`, `LEPTON_BASE_URL`, `FEATHERLESS_BASE_URL`, `SNOWFLAKE_BASE_URL`, `HUNYUAN_BASE_URL`, `VOLCENGINE_BASE_URL`, `MINIMAX_BASE_URL`, `BAICHUAN_BASE_URL`, `STEPFUN_BASE_URL`, `INTERNLM_BASE_URL`, `REPLICATE_BASE_URL`, …(+12)
- **Interfaces** — `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, `LLMProvider`, `TextContent`, `ImageContent`, `OpenAIToolCall`, `TextStreamChunk`, `StreamToolCallChunk`, `ModelAdapterConfig`, …(+14)
- **Types** — `MessageContent`, `StreamDelta`, `OpenAIContent`, `OpenAIMessageParam`, `EnvFn`, `ContentPart`

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
- Type-check: `npx tsc --noEmit` resolves `personaforge/models` with no missing-module error.
- Runtime: `node -e "import('personaforge/models').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/providers](../guide/providers.md).

## Common failures
- `Cannot find module 'personaforge/models'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/providers](../guide/providers.md)
