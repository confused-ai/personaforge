---
title: "Runbook: Guard"
description: "Operational runbook for personaforge/guard — import, run, verify, recover. 99 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Guard

> Auto-generated from `./dist/guard.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/guard`  ·  **Public symbols:** 99  ·  **Guide:** [/guide/guardrails](../guide/guardrails.md)

## What it is
`personaforge/guard` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createContentRule, createToolAllowlistRule, createMaxLengthRule } from 'personaforge/guard';
```

## Public API surface
- **Factories / functions** — `createContentRule`, `createToolAllowlistRule`, `createMaxLengthRule`, `createAllowlistRule`, `createSensitiveDataRule`, `createUrlValidationRule`, `detectPii`, `createPiiDetectionRule`, `callOpenAiModeration`, `createOpenAiModerationRule`, `createForbiddenTopicsRule`, `detectPromptInjection`, …(+6)
- **Classes** — `BudgetExceededError`, `BudgetEnforcer`, `RateLimitError`, `RateLimiter`, `CircuitOpenError`, `CircuitBreaker`, `ApprovalRejectedError`, `InMemoryApprovalStore`, `GuardrailValidator`, `HealthCheckManager`, `InMemoryIdempotencyStore`, `InMemoryAuditStore`, …(+1)
- **Constants** — `SENSITIVE_DATA_PATTERNS`, `PII_PATTERNS`
- **Enums** — `CircuitState`
- **Interfaces** — `BudgetConfig`, `BudgetStore`, `MetricValue`, `MetricsCollector`, `RateLimiterConfig`, `CircuitBreakerConfig`, `CircuitBreakerResult`, `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, …(+47)
- **Types** — `ErrorCodeType`, `BudgetExceededAction`, `MessageContent`, `ApprovalStatus`, `PiiType`, `IdempotencyState`

## Minimal use
Real example from the guardrails guide:

```ts
import {
  createContentRule,
  createMaxLengthRule,
  createAllowlistRule,
  createSensitiveDataRule,
  createUrlValidationRule,
} from 'personaforge';

const rules = [
  // Block responses that contain specific patterns.
  // Signature: createContentRule(name, description, pattern, severity?)
  createContentRule(
    'no-credentials',
    'Blocks responses containing credential patterns.',
    /\b(password|secret|token)\s*[:=]/i,
    'error',
  ),

  // Limit output length.
  // Signature: createMaxLengthRule(name, maxLength, severity?)
  createMaxLengthRule('max-length', 10_000, 'error'),

  // Enforce an allowlist over tools, hosts, paths, outputs, and blocked patterns.
  createAllowlistRule({
    allowedTools: ['search', 'get_order'],
    allowedHosts: ['api.company.com', 'docs.company.com'],
// …see full example in the guide
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/guard` with no missing-module error.
- Runtime: `node -e "import('personaforge/guard').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/guardrails](../guide/guardrails.md).

## Common failures
- `Cannot find module 'personaforge/guard'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/guardrails](../guide/guardrails.md)
