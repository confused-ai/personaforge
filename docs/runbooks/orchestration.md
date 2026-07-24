---
title: "Runbook: Orchestration"
description: "Operational runbook for personaforge/orchestration — import, run, verify, recover. 277 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Orchestration

> Auto-generated from `./dist/orchestration.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/orchestration`  ·  **Public symbols:** 277  ·  **Guide:** [/guide/orchestration](../guide/orchestration.md)

## What it is
`personaforge/orchestration` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createToolkit, toolkitsToRegistry, createRunnableAgent } from 'personaforge/orchestration';
```

## Public API surface
- **Factories / functions** — `createToolkit`, `toolkitsToRegistry`, `createRunnableAgent`, `createResearchTeam`, `createDecisionTeam`, `createSwarm`, `createSwarmAgent`, `createSupervisor`, `createRole`, `createPipeline`, `createConsensus`, `createHandoff`, …(+35)
- **Classes** — `OrchestratorImpl`, `MessageBusImpl`, `RoundRobinLoadBalancer`, `LeastConnectionsLoadBalancer`, `WeightedResponseTimeLoadBalancer`, `ActorSystem`, `Actor`, `CommandBus`, `EventBus`, `Team`, `SwarmOrchestrator`, `ConsensusProtocol`, …(+12)
- **Constants** — `A2A_ERRORS`
- **Enums** — `AgentState`, `MessageType`, `MessagePriority`, `DelegationPriority`, `DelegationStatus`, `CoordinationType`, `CoordinationStatus`
- **Interfaces** — `Message`, `LLMToolDefinition`, `GenerateOptions`, `ToolCall`, `GenerateResult`, `LLMProvider`, `TextContent`, `ImageContent`, `OpenAIToolCall`, `AgentRunOptions`, `AgentRunResult`, `AgentLifecycleHooks`, …(+162)
- **Types** — `EntityId`, `MessageContent`, `StreamChunk`, `MessageHandler`, `ToolParameters`, `McpAuthConfig`, `ToolProvider`, `BudgetExceededAction`, `ActorMessageType`, `StartWorkflowPayload`, `ExecuteToolPayload`, `PauseWorkflowPayload`, …(+12)

## Minimal use
```ts
import { createToolkit, toolkitsToRegistry, createRunnableAgent } from 'personaforge/orchestration';

// `createToolkit` is the primary entry for this feature.
// See the guide/type signature for full options.
const result = createToolkit(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/orchestration` with no missing-module error.
- Runtime: `node -e "import('personaforge/orchestration').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/orchestration](../guide/orchestration.md).

## Common failures
- `Cannot find module 'personaforge/orchestration'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/orchestration](../guide/orchestration.md)
