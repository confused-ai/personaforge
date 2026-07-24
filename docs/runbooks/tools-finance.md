---
title: "Runbook: Tools: Finance"
description: "Operational runbook for personaforge/tools/finance — import, run, verify, recover. 30 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Tools: Finance

> Auto-generated from `./dist/tools/finance.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/tools/finance`  ·  **Public symbols:** 30  ·  **Guide:** [/guide/tools](../guide/tools.md)

## What it is
`personaforge/tools/finance` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { StripeCreateCustomerTool, StripeGetCustomerTool, StripeCreatePaymentIntentTool } from 'personaforge/tools/finance';
```

## Public API surface
- **Classes** — `StripeCreateCustomerTool`, `StripeGetCustomerTool`, `StripeCreatePaymentIntentTool`, `StripeCreateSubscriptionTool`, `StripeCancelSubscriptionTool`, `StripeRefundTool`, `StripeToolkit`, `YFinanceTool`, `OpenBBStockQuoteTool`, `OpenBBStockHistoricalTool`, `OpenBBStockNewsTool`, `OpenBBStockFundamentalsTool`, …(+3)
- **Interfaces** — `ToolContext`, `ToolPermissions`, `ToolResult`, `ToolError`, `ToolExecutionMetadata`, `Tool`, `LogContext`, `Logger`, `DebugLoggerConfig`, `BaseToolConfig`, `StripeToolConfig`, `OpenBBToolConfig`
- **Types** — `EntityId`, `ToolParameters`, `YFinanceParameters`

## Minimal use
Real example from the tools guide:

```ts
import {
  StripeToolkit,
  YFinanceTool,      // Yahoo Finance market data
} from 'personaforge/tools/finance';
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/tools/finance` with no missing-module error.
- Runtime: `node -e "import('personaforge/tools/finance').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/tools](../guide/tools.md).

## Common failures
- `Cannot find module 'personaforge/tools/finance'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/tools](../guide/tools.md)
