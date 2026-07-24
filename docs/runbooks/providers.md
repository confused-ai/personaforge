---
title: "Runbook: Providers"
description: "Operational runbook for personaforge/providers — import, run, verify, recover. 278 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Providers

> Auto-generated from `./dist/providers.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/providers`  ·  **Public symbols:** 278  ·  **Guide:** [/guide/providers](../guide/providers.md)

## What it is
`personaforge/providers` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createOpenRouterProvider, normalizeFinishReason, createGroqProvider } from 'personaforge/providers';
```

## Public API surface
- **Factories / functions** — `normalizeFinishReason`, `createOpenRouterProvider`, `createGroqProvider`, `createXAIProvider`, `createTogetherProvider`, `createFireworksProvider`, `createDeepSeekProvider`, `createMistralProvider`, `createCohereProvider`, `createPerplexityProvider`, `createAzureOpenAIProvider`, `createOpenAICompatibleProvider`, …(+63)
- **Classes** — `OpenAIProvider`, `AnthropicProvider`, `GoogleProvider`, `BedrockConverseProvider`, `ContextWindowManager`, `CostTracker`, `FallbackChainProvider`, `LLMCache`, `LLMRouter`
- **Constants** — `GROQ_BASE_URL`, `XAI_BASE_URL`, `TOGETHER_BASE_URL`, `FIREWORKS_BASE_URL`, `DEEPSEEK_BASE_URL`, `MISTRAL_BASE_URL`, `COHERE_BASE_URL`, `PERPLEXITY_BASE_URL`, `CEREBRAS_BASE_URL`, `SAMBANOVA_BASE_URL`, `NVIDIA_BASE_URL`, `AI21_BASE_URL`, …(+35)
- **Enums** — `FallbackStrategy`
- **Interfaces** — `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, `LLMProvider`, `TextContent`, `ImageContent`, `OpenAIToolCall`, `ITextGenerator`, `IStreamingProvider`, `IToolCallProvider`, …(+113)
- **Types** — `EntityId`, `MessageContent`, `ToolCallResult`, `IFullLLMProvider`, `MessageRole`, `ContentPart`, `StreamDelta`, `OpenAIContent`, `OpenAIMessageParam`, `AnthropicContent`, `AnthropicMessageParam`, `GooglePart`, …(+9)

## Minimal use
```ts
import { createOpenRouterProvider, normalizeFinishReason, createGroqProvider } from 'personaforge/providers';

// `createOpenRouterProvider` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = createOpenRouterProvider(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/providers` with no missing-module error.
- Runtime: `node -e "import('personaforge/providers').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/providers](../guide/providers.md).

## Common failures
- `Cannot find module 'personaforge/providers'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/providers](../guide/providers.md)
