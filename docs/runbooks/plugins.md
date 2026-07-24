---
title: "Runbook: Plugins"
description: "Operational runbook for personaforge/plugins — import, run, verify, recover. 28 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Plugins

> Auto-generated from `./dist/plugins.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/plugins`  ·  **Public symbols:** 28  ·  **Guide:** [/guide/plugins](../guide/plugins.md)

## What it is
`personaforge/plugins` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createPluginRegistry, hooksToPlugin, createLoggingPlugin } from 'personaforge/plugins';
```

## Public API surface
- **Factories / functions** — `hooksToPlugin`, `createPluginRegistry`, `createLoggingPlugin`, `createRateLimitPlugin`, `createTelemetryPlugin`
- **Constants** — `INTERCEPTION_ORDER`
- **Interfaces** — `AgentInput`, `ExecutionMetadata`, `AgentOutput`, `Logger`, `ToolRef`, `ToolExecutionResult`, `ToolMiddlewareObject`, `PluginContext`, `Plugin`, `MetricsCollector`, `TextContent`, `ImageContent`, …(+8)
- **Types** — `ToolMiddleware`, `MessageContent`

## Minimal use
Real example from the plugins guide:

```ts
import { createAgent } from 'personaforge';
import {
  createPluginRegistry,
  createLoggingPlugin,
  createRateLimitPlugin,
} from 'personaforge/plugins';

const plugins = createPluginRegistry();

plugins.register(createLoggingPlugin());
plugins.register(createRateLimitPlugin({ maxRpm: 60 }));

const agent = createAgent({
  name: 'my-agent',
  instructions: '...',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

// There is no `plugins` option on createAgent — a registry is applied
// manually around each run. `runBeforeHooks` folds every plugin's beforeRun
// over the input (in registration order) and may transform it:
const context = { agentId: 'my-agent', logger: console, metadata: {} };
const input = await plugins.runBeforeHooks({ prompt: 'Summarize the latest report.' }, context);

const result = await agent.run(input.prompt);
// …see full example in the guide
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/plugins` with no missing-module error.
- Runtime: `node -e "import('personaforge/plugins').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/plugins](../guide/plugins.md).

## Common failures
- `Cannot find module 'personaforge/plugins'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/plugins](../guide/plugins.md)
