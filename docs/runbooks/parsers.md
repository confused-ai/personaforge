---
title: "Runbook: Parsers"
description: "Operational runbook for personaforge/parsers — import, run, verify, recover. 9 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Parsers

> Auto-generated from `./src/parsers/index.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/parsers`  ·  **Public symbols:** 9  ·  **Guide:** [/guide/output-parsers](../guide/output-parsers.md)

## What it is
`personaforge/parsers` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { StringOutputParser, JsonOutputParser, CsvListParser } from 'personaforge/parsers';
```

## Public API surface
- **Classes** — `StringOutputParser`, `JsonOutputParser`, `CsvListParser`, `RegexParser`, `OutputFixingParser`, `RetryWithErrorParser`, `ParseError`
- **Interfaces** — `OutputParser`, `JsonOutputParserOptions`

## Minimal use
Real example from the output-parsers guide:

```ts
import {
  StringOutputParser, JsonOutputParser, CsvListParser, RegexParser,
  OutputFixingParser, RetryWithErrorParser, ParseError,
} from 'personaforge/parsers';
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/parsers` with no missing-module error.
- Runtime: `node -e "import('personaforge/parsers').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/output-parsers](../guide/output-parsers.md).

## Common failures
- `Cannot find module 'personaforge/parsers'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/output-parsers](../guide/output-parsers.md)
