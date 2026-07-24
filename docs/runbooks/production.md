---
title: "Runbook: Production"
description: "Operational runbook for personaforge/production — import, run, verify, recover. 151 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Production

> Auto-generated from `./dist/production.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/production`  ·  **Public symbols:** 151  ·  **Guide:** [/guide/production](../guide/production.md)

## What it is
`personaforge/production` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createLLMCircuitBreaker, createOpenAIRateLimiter, createLLMHealthCheck } from 'personaforge/production';
```

## Public API surface
- **Factories / functions** — `createLLMCircuitBreaker`, `createOpenAIRateLimiter`, `createLLMHealthCheck`, `createSessionStoreHealthCheck`, `createCustomHealthCheck`, `createHttpHealthCheck`, `createGracefulShutdown`, `withShutdownGuard`, `formatSSE`, `createResumableStream`, `estimateCostUsd`, `createSqliteCheckpointStore`, …(+10)
- **Classes** — `CircuitOpenError`, `CircuitBreaker`, `RateLimitError`, `RateLimiter`, `RedisRateLimiter`, `HealthCheckManager`, `GracefulShutdown`, `ResumableStreamManager`, `BudgetExceededError`, `InMemoryBudgetStore`, `BudgetEnforcer`, `InMemoryCheckpointStore`, …(+15)
- **Constants** — `FeedbackEntrySchema`, `defaultComponentRegistry`
- **Enums** — `CircuitState`, `HealthStatus`
- **Interfaces** — `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, `LLMProvider`, `Tool`, `TextContent`, `ImageContent`, `OpenAIToolCall`, `AgentRunOptions`, `AgentRunResult`, …(+74)
- **Types** — `EntityId`, `MessageContent`, `ErrorCodeType`, `CleanupHandler`, `BudgetExceededAction`, `IdempotencyState`, `FeedbackEntry`, `SafeParseResult`, `InferToolSchema`, `ApprovalStatus`, `ComponentType`, `ComponentStatus`

## Minimal use
```ts
import { createLLMCircuitBreaker, createOpenAIRateLimiter, createLLMHealthCheck } from 'personaforge/production';

// `createLLMCircuitBreaker` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = createLLMCircuitBreaker(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/production` with no missing-module error.
- Runtime: `node -e "import('personaforge/production').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/production](../guide/production.md).

## Common failures
- `Cannot find module 'personaforge/production'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/production](../guide/production.md)
