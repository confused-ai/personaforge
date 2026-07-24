---
title: "Runbook: Guardrails"
description: "Operational runbook for personaforge/guardrails — import, run, verify, recover. 45 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Guardrails

> Auto-generated from `./dist/guardrails.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/guardrails`  ·  **Public symbols:** 45  ·  **Guide:** [/guide/guardrails](../guide/guardrails.md)

## What it is
`personaforge/guardrails` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createContentRule, createToolAllowlistRule, createMaxLengthRule } from 'personaforge/guardrails';
```

## Public API surface
- **Factories / functions** — `createContentRule`, `createToolAllowlistRule`, `createMaxLengthRule`, `createAllowlistRule`, `createSensitiveDataRule`, `createUrlValidationRule`, `detectPii`, `createPiiDetectionRule`, `callOpenAiModeration`, `createOpenAiModerationRule`, `createForbiddenTopicsRule`, `detectPromptInjection`, …(+2)
- **Classes** — `GuardrailValidator`
- **Constants** — `SENSITIVE_DATA_PATTERNS`, `PII_PATTERNS`
- **Interfaces** — `GuardrailResult`, `GuardrailViolation`, `GuardrailContext`, `GuardrailRule`, `SchemaValidationRule`, `AllowlistConfig`, `GuardrailsConfig`, `GuardrailEngine`, `HumanInTheLoopHooks`, `ApprovalRequest`, `ApprovalResponse`, `PiiDetectionResult`, …(+15)
- **Types** — `PiiType`

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
- Type-check: `npx tsc --noEmit` resolves `personaforge/guardrails` with no missing-module error.
- Runtime: `node -e "import('personaforge/guardrails').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/guardrails](../guide/guardrails.md).

## Common failures
- `Cannot find module 'personaforge/guardrails'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/guardrails](../guide/guardrails.md)
