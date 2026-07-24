---
title: "Runbook: Contracts"
description: "Operational runbook for personaforge/contracts — import, run, verify, recover. 107 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Contracts

> Auto-generated from `./dist/contracts.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/contracts`  ·  **Public symbols:** 107

## What it is
`personaforge/contracts` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { newId, isPersonaForgeError, isRetryable } from 'personaforge/contracts';
```

## Public API surface
- **Factories / functions** — `isPersonaForgeError`, `isRetryable`, `ok`, `err`, `isOk`, `isErr`, `unwrap`, `map`, `tryCatch`, `newId`, `tenantScopedKey`, `userScopedKey`, …(+1)
- **Classes** — `PersonaForgeError`, `BudgetExceededError`, `CircuitOpenError`, `GuardrailViolatedError`, `ToolTimeoutError`, `ToolValidationError`, `ExecutionTimeoutError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `ToolNotAuthorizedError`, `TenantBudgetEnforcer`
- **Constants** — `ERROR_CODES`, `asAgentId`, `asSessionId`, `asRunId`, `asMemoryId`, `asArtifactId`, `asToolCallId`, `asTraceId`, `asTaskId`, `asWorkflowId`, `asExecutionId`, `asScheduleId`
- **Enums** — `AgentState`
- **Interfaces** — `PersonaForgeErrorOptions`, `SerializedPersonaForgeError`, `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, `LLMProvider`, `Tool`, `ToolRegistry`, `SessionMessage`, `SessionData`, …(+39)
- **Types** — `ErrorCode`, `Ok`, `Err`, `Result`, `Brand`, `AgentId`, `SessionId`, `RunId`, `MemoryId`, `ArtifactId`, `ToolCallId`, `TraceId`, …(+6)

## Minimal use
```ts
import { newId, isPersonaForgeError, isRetryable } from 'personaforge/contracts';

// `newId` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = newId(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/contracts` with no missing-module error.
- Runtime: `node -e "import('personaforge/contracts').then(m => console.log(Object.keys(m)))"` lists the exports above.

## Common failures
- `Cannot find module 'personaforge/contracts'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
