# Monorepo Migration Plan

This repo is midway through a package-first migration. The root `personaforge` package still ships the legacy `src/` implementation for compatibility, while `packages/*` contains the clean workspace packages that should become the source of truth.

The goal is not to move folders one-for-one. The goal is to create stable package boundaries, keep the quickstart working, and make every optional capability opt-in.

## Current State

- Root `src/` has 36 top-level domains and 351 TypeScript files.
- `packages/*` currently has 15 workspace packages and 440 TypeScript files.
- Full tests pass, but the root build needs a larger Node heap during declaration generation.
- Turbo was present in config but could not run until the root package declared `packageManager`.
- The root entry point intentionally re-exports `src/` modules for backward compatibility.

## Target Shape

The root package should become a compatibility layer. New implementation code should live in workspace packages. Root subpaths should re-export from packages only after each package has full tests, public exports, and compatibility shims.

Package layering:

1. Foundation: `contracts`, `shared`
2. Core runtime: `core`, `models`, `tools`, `session`
3. Safety and telemetry: `guard`, `observe`, `guardrails`, `production`
4. Agent capabilities: `agentic`, `memory`, `knowledge`, `planner`, `reasoning`, `compression`, `context`
5. Orchestration: `workflow`, `graph`, `execution`, `orchestration`, `scheduler`, `background`
6. Delivery and DX: `serve`, `runtime`, `cli`, `dx`, `sdk`, `testing`, `test-utils`
7. Media and extensions: `artifacts`, `voice`, `video`, `plugins`, `extensions`, `adapters`, provider-specific adapter packages

## Source Domain Mapping

| Legacy `src/` domain | Target package | Notes |
| --- | --- | --- |
| `src/contracts` | `@personaforge/contracts` | Move interfaces and error contracts first. No runtime deps. |
| `src/shared` | `@personaforge/shared` | Shared version, telemetry flags, debug helpers. No domain imports. |
| `src/core` | `@personaforge/core` | Agent contracts, registry, low-level runner primitives. |
| `src/providers` | `@personaforge/models` | Keep SDKs as optional peers and dynamically imported. |
| `src/tools` | `@personaforge/tools` plus domain tool packages | Split heavy tool families later into dedicated packages. |
| `src/session` | `@personaforge/session` | In-memory, SQLite, Redis shims. Redis implementation can also live in `adapter-redis`. |
| `src/guard` facade | `@personaforge/guard` | Root facade should re-export package implementation. |
| `src/observability` and `src/observe.ts` | `@personaforge/observe` and future `@personaforge/observability` | Keep basic tracing/logger in `observe`; advanced eval stores can be separate. |
| `src/create-agent` and `src/create-agent.ts` | `@personaforge/core` or `@personaforge/agentic` facade | Keep public `createAgent` API stable. Move implementation after `agentic`, `models`, `tools`, and `session` are ready. |
| `src/agentic` | `@personaforge/agentic` | ReAct loop package. Depends on core contracts, models, tools, guard, observe. |
| `src/guardrails` | `@personaforge/guardrails` | Content safety and prompt injection rules. Depends on contracts/core only. |
| `src/production` | `@personaforge/production` | Budget, approval, audit, checkpoint, tenant, health. Depends on contracts, guard, observe, session. |
| `src/memory` | `@personaforge/memory` | Long-term memory and vector stores. Optional vector SDKs stay peer deps. |
| `src/knowledge` | `@personaforge/knowledge` | RAG orchestration. Should consume `@personaforge/memory`, not duplicate vector logic. |
| `src/planner` | `@personaforge/planner` | Planning algorithms and task decomposition. Keep zero provider imports. |
| `src/reasoning` | `@personaforge/reasoning` | Reasoning manager and event stream types. Depends on models/core contracts. |
| `src/compression` | `@personaforge/compression` | Message and context compression. Should be provider-agnostic. |
| `src/context` | `@personaforge/context` | Context providers and backends. Keep storage adapters injected. |
| `src/execution` | `@personaforge/workflow` or `@personaforge/execution` | If it is generic workflow primitives, keep separate. If agent workflow only, merge into workflow. |
| `src/workflow.ts` | `@personaforge/workflow` | Root facade only after package exports match current API. |
| `src/graph` | `@personaforge/graph` | DAG engine, event store, scheduler helpers, durable executor. |
| `src/orchestration` | `@personaforge/orchestration` | A2A, consensus, handoff, routers. Depends on graph/workflow/core. |
| `src/scheduler` | `@personaforge/scheduler` | Cron parser and schedule manager. No provider imports. |
| `src/background` | `@personaforge/background` | Queue abstraction plus optional BullMQ/Kafka/SQS/RabbitMQ peers. |
| `src/runtime` and `src/serve.ts` | `@personaforge/runtime` and `@personaforge/serve` | Keep HTTP primitives in serve; agent lifecycle service in runtime. |
| `src/cli` | `@personaforge/cli` | CLI should depend on public package APIs only. |
| `src/dx` | `@personaforge/dx` | Friendly builders and dev logger. Depends on public APIs, not internals. |
| `src/sdk` | `@personaforge/sdk` | Typed builder layer. Depends on package APIs only. |
| `src/testing` and `src/test.ts` | `@personaforge/test-utils` plus `@personaforge/testing` | Keep unit helpers separate from integration harnesses. |
| `src/adapters` | `@personaforge/adapters` | Registry and in-memory adapters. Concrete external adapters get own packages. |
| `src/plugins` | `@personaforge/plugins` | Plugin contracts and built-ins. Avoid importing providers. |
| `src/storage` | `@personaforge/storage` | Generic key-value and file storage. Optional persistence adapters injected. |
| `src/artifacts` | `@personaforge/artifacts` | Artifact types and stores. |
| `src/voice` | `@personaforge/voice` | Voice provider abstraction and optional providers. |
| `src/video` | `@personaforge/video` | Video workflows and media adapters. |
| `src/extensions` | `@personaforge/extensions` | Integration adapters. Should depend on public packages only. |
| `src/config` | `@personaforge/config` | Config loading and secret manager adapters. Optional cloud SDKs as peers. |

## Migration Order

1. Finish existing foundation packages: `contracts`, `shared`, `core`, `guard`, `observe`, `session`.
2. Move provider and tool primitives: `models`, `tools`, then split heavy domain tools.
3. Extract `agentic` and switch `createAgent` to consume the package implementation.
4. Extract production safety: `guardrails`, `production`, `runtime`, `serve` integration.
5. Extract state and intelligence: `memory`, `knowledge`, `planner`, `reasoning`, `compression`, `context`.
6. Extract orchestration: `graph`, `execution`, `workflow`, `orchestration`, `scheduler`, `background`.
7. Move outer layers last: `dx`, `sdk`, `cli`, `testing`, `plugins`, `extensions`, media packages.
8. Convert root `src/` files to compatibility barrels and delete moved implementation files only after tests prove parity.

## Migration Rules

- Every package must build, typecheck, lint, and test independently before root imports it.
- Package implementation must not import from root `src/`.
- Root `src/` may import from packages only after the package is fully extracted and the root file is reduced to a facade.
- `contracts` and `shared` must remain dependency-light and must never import provider, adapter, or runtime code.
- Heavy SDKs stay as optional peer dependencies and are loaded only inside the adapter that uses them.
- Keep existing `personaforge/*` subpaths during v1. New package imports are additive until the next major version.
- Add parity tests before changing any public export path.

## Immediate Fixes

- Add `packageManager` so Turbo can resolve workspace behavior consistently.
- Keep root build as `build:root` with a larger heap for declaration generation.
- Add `build:packages` and `build:all` so CI can validate packages first and root compatibility second.
- Fix package manifests that export files that do not exist, such as `packages/tools` exporting `./search` before `src/search.ts` exists and `packages/knowledge` exporting `./loaders` before `src/loaders.ts` exists.
- Sync package versions with the root package before publishing.
- Decide whether package manifests should point directly at `dist` or keep source-first development fields with a publish tool that rewrites them. Do not publish mixed source/dist metadata.

## Definition Of Done

A module is considered migrated only when all of these are true:

1. The package has a clear public API and `exports` map.
2. It has package-local tests for the moved behavior.
3. It has no imports from root `src/`.
4. Root `src/` only re-exports from the package or contains compatibility glue.
5. Existing root imports and documented examples still pass.
6. `bun run build:all`, `bun run typecheck`, and `bun run test` pass.

---

## Migration Risk Analysis (2025-07)

### Risk overview by domain

| Domain | LOC | Cross-domain src imports | Test files | Risk level | Notes |
|---|---|---|---|---|---|
| `src/providers` | 5 492 | 5 (memory, observability, tools, shared) | 5 | **HIGH** | Most-imported file in codebase (`providers/types.ts` — 26 consumers). Duplicate types in `@personaforge/core`. |
| `src/orchestration` | 4 800 | 2 | **0** | **HIGH** | Zero test coverage. A2A + multi-agent consensus logic. Cannot migrate safely without first writing tests. |
| `src/graph` | 4 707 | 3 (memory, providers, tools) | 1 | **HIGH** | CLI imports `personaforge/graph` which resolves to `src/graph` via root src. Blocking clean package boundary for `@personaforge/cli`. |
| `src/execution` | 3 573 | 3 (contracts, core, planner) | **0** | **HIGH** | Zero test coverage. Contains two parallel engine implementations (`engine.ts` and `engine-v2.ts`). |
| `src/production` | 3 500 | 8 | 5 | MEDIUM | Partial duplicate with `@personaforge/guard` (`circuit-breaker.ts`, `budget.ts`, `rate-limiter.ts`). Must deduplicate before extracting. |
| `src/create-agent` | 832 | **14** | 1 | **HIGH** | Hub of the framework. 14 unique cross-domain imports. Must be last to migrate (after all deps are extracted). |
| `src/agentic` | 1 027 | 6 | **0** | HIGH | ReAct runner. Zero test coverage despite being the core execution loop. |
| `src/observability` | ~450 | 4 | 0 | MEDIUM | Partially duplicated by `@personaforge/observe`. Needs type reconciliation before extraction. |
| `src/session` | ~350 | 2 | 0 | LOW | Clean interface. `@personaforge/session` already exists. Root `src/session` can become a re-export immediately. |
| `src/memory` | ~280 | 0 | 0 | LOW | No cross-domain imports. Straightforward extraction. |
| `src/graph/event-store.ts` | ~200 | 0 | 1 | MEDIUM | SQLite event store used by CLI commands. Breaks build if not packaged before CLI is published standalone. |

### Structural risks

**1. `src/providers/types.ts` — the type hub (CRITICAL)**

26 src files import from `src/providers/types.ts`. The interfaces `LLMProvider`, `Message`, `GenerateOptions`,
`GenerateResult`, `StreamChunk` are defined twice — once here and once in `@personaforge/core`.
Both definitions are slightly different (field names, optionality).

Risk: any migration that moves either definition first will cause 20+ TypeScript errors across remaining domains.

Fix required before anything else: audit the two type sets, pick one canonical location (`@personaforge/core`
as the single source of truth), and alias the other.

**2. Circular-free but tightly coupled hub: `src/create-agent`**

`src/create-agent/factory.ts` imports from 14 distinct src domains. It is not circular, but it is the last
node to migrate because every one of its 14 dependencies must already be in packages first.
Migrating `create-agent` prematurely will cause an immediate DTS build failure because package implementations
must not import from root `src/`.

**3. Duplicate production-safety implementations**

`@personaforge/guard` contains `CircuitBreaker`, `withRetry`, `BudgetGuard`, `RateLimiter`.
`src/production/` has independent implementations of `circuit-breaker.ts`, `budget.ts`, `rate-limiter.ts`.
Until these are merged, any production fix must be applied in two places.

**4. CLI root-src leakage**

`packages/cli/src/commands/{export,replay,inspect,diff}-cmd.ts` import from `personaforge/graph`
and `personaforge/runtime`. These subpaths resolve to `src/graph/` and `src/runtime/` in the root package,
meaning the CLI package silently depends on root `src/` at runtime.

Breaking point: as soon as `@personaforge/graph` is added as a proper workspace package with its own
`package.json`, the root subpath will resolve to the package — which is the desired end state — but
will fail until the package exposes exactly the same named exports.

**5. Zero-test-coverage domains**

`src/agentic`, `src/execution`, and `src/orchestration` have 0 test files. These are among the most
complex parts of the framework. Migration is unsafe without tests because there is no regression signal.

---

## Concrete Migration Roadmap

### Wave 0 — Type layer consolidation (no new packages, immediate)

Prerequisite for everything. Estimated files changed: 30. No new packages needed.

| Step | Action | Files |
|---|---|---|
| 0a | Audit `@personaforge/core` exports vs `src/providers/types.ts`. Identify field-level diffs. | `packages/core/src/index.ts`, `src/providers/types.ts` |
| 0b | Move canonical LLM types (`LLMProvider`, `Message`, `GenerateOptions`, `GenerateResult`, `StreamChunk`, etc.) to `@personaforge/core` if not already there. | `packages/core/src/` |
| 0c | Replace `src/providers/types.ts` content with re-exports from `@personaforge/core`. This converts 26 consumers without touching them. | `src/providers/types.ts` |
| 0d | Run `bun run build:all && bun run typecheck && bun run test` — all must stay green. | — |

**Gate**: `providers/types.ts` is a thin re-export barrel. No domain logic changed.

---

### Wave 1 — Already-patterned re-exports (zero-risk, immediate)

These domains already have matching packages. Convert root `src/` files to re-exports.

| Step | Domain | Action |
|---|---|---|
| 1a | `src/session/` | Replace implementation with `export * from '@personaforge/session'`. Redis store already in `@personaforge/adapter-redis`. |
| 1b | `src/knowledge/` | Replace with `export * from '@personaforge/knowledge'`. |
| 1c | `src/shared/errors.ts` | Replace with `export * from '@personaforge/shared'` where shared already has the error classes. |
| 1d | `src/guardrails/` | Replace with `export * from '@personaforge/guard'` guardrails sub-exports. |

**Gate**: `bun run build:all && bun run test` — 515 tests still pass.

---

### Wave 2 — Provider implementations → `@personaforge/models` (medium effort)

Prerequisite: Wave 0 complete (canonical types in `@personaforge/core`).

| Step | Action |
|---|---|
| 2a | Move provider implementations from `src/providers/` (all `*-provider.ts`, `cost-tracker.ts`, `structured-output.ts`, etc.) into `packages/models/src/`. |
| 2b | Remove the moved files from `src/providers/`, replace `src/providers/index.ts` with `export * from '@personaforge/models'`. |
| 2c | Update `src/model.ts` root facade: it already imports from `src/providers/` — point it at `@personaforge/models` instead. |
| 2d | Add package-level tests to `packages/models/` that cover the moved provider classes (unit test with mock HTTP). |

**Gate**: `bun run --cwd packages/models build`, `bun run typecheck`, full test suite green.

---

### Wave 3 — Graph engine → new `@personaforge/graph` package (fixes CLI dep)

Prerequisite: Wave 0.

| Step | Action |
|---|---|
| 3a | Create `packages/graph/` with `package.json`, `tsconfig.json`, `tsup.config.ts`. |
| 3b | Move `src/graph/engine.ts`, `event-store.ts`, `builder.ts`, `types.ts`, `memory.ts`, `scheduler.ts`, `orchestrator.ts`, `plugins.ts` into `packages/graph/src/`. |
| 3c | Export `SqliteEventStore`, `GraphEventType`, `ExecutionId`, `GraphEvent` from `packages/graph/src/index.ts`. |
| 3d | Replace `src/graph/` with re-export barrel `export * from '@personaforge/graph'`. |
| 3e | Update `packages/cli/package.json` to add `"@personaforge/graph": "workspace:*"` as a dependency. |
| 3f | The 5 CLI command files that import from `personaforge/graph` now resolve to the real package — no source change needed. |

**Gate**: `bun run --cwd packages/graph build`, CLI typecheck, test for graph engine passes.

---

### Wave 4 — Memory, planner, reasoning, config (isolated leaf nodes)

These domains have 0 or 1 cross-domain imports and are entirely self-contained.
Create one new package per domain.

| Domain | New package | Dependencies |
|---|---|---|
| `src/memory/` | `@personaforge/memory` | `@personaforge/core` only |
| `src/planner/` | `@personaforge/planner` | `@personaforge/core` contracts only |
| `src/reasoning/` | `@personaforge/reasoning` | `@personaforge/core`, `@personaforge/models` |
| `src/config/` | `@personaforge/config` | `@personaforge/shared` only |
| `src/scheduler/` | `@personaforge/scheduler` | zero src deps |
| `src/compression/` | `@personaforge/compression` | `@personaforge/core` |
| `src/context/` | `@personaforge/context` | `@personaforge/core` |
| `src/storage/` | `@personaforge/storage` | `@personaforge/shared` |
| `src/artifacts/` | `@personaforge/artifacts` | `@personaforge/core` |

**Gate per package**: independent build, lint, typecheck. No inter-package circular deps.

---

### Wave 5 — Production safety deduplication → `@personaforge/guard` + new `@personaforge/production`

Prerequisite: Wave 3 (session already a package for redis-rate-limiter, wave 0 for types).

| Step | Action |
|---|---|
| 5a | Diff `src/production/circuit-breaker.ts` vs `packages/guard/src/circuit-breaker.ts`. Pick the more complete implementation (keep package). Delete the duplicate from `src/`. |
| 5b | Same for `budget.ts` / `rate-limiter.ts`. Keep the `@personaforge/guard` version. |
| 5c | Move `src/production/{approval-store, audit-store, checkpoint, idempotency, health, tenant, graceful-shutdown, resilient-agent, resumable-stream, latency-eval}.ts` into a new `packages/production/src/`. |
| 5d | Replace `src/production/index.ts` with `export * from '@personaforge/production'`. |

**Gate**: `bun run --cwd packages/guard build`, `bun run --cwd packages/production build`, test suite green.

---

### Wave 6 — Agentic runner (TESTS FIRST)

Prerequisite: Wave 2 (models), Wave 5 (guard), `@personaforge/core` canonical types.

> **Blocker**: `src/agentic` has zero test coverage. Do NOT migrate until unit tests are written.

| Step | Action |
|---|---|
| 6a | Write unit tests for `src/agentic/runner.ts` in `tests/` covering the ReAct loop, tool dispatch, streaming response assembly. Aim for ≥ 80% coverage. |
| 6b | Move `src/agentic/runner.ts` and `types.ts` into `packages/core/src/runner/` (or a new `packages/agentic/`). |
| 6c | Replace `src/agentic/index.ts` with re-export barrel. |

---

### Wave 7 — Execution and orchestration (TESTS FIRST, high risk)

Prerequisite: Wave 3 (graph), Wave 6 (agentic).

> **Blocker**: `src/execution` and `src/orchestration` have zero test coverage. Same rule applies.

| Domain | Target | Notes |
|---|---|---|
| `src/execution/` | `@personaforge/execution` (new) or merged into `@personaforge/workflow` | Decide if `engine-v2.ts` supersedes `engine.ts` — delete the older one first. |
| `src/orchestration/` | `@personaforge/orchestration` (new) | 4 800 LOC. A2A, multi-agent, consensus. Highest-risk migration. Write integration tests first. |
| `src/background/` | `@personaforge/background` (new) | Queue abstraction. Optional peer deps (BullMQ, Kafka, etc.). |

---

### Wave 8 — create-agent factory (last)

Prerequisite: **All of waves 0–7 complete.**

`src/create-agent/factory.ts` has 14 cross-domain imports. Once all 14 target domains are packages,
the factory can be refactored to import from those packages and moved into `packages/core/src/create-agent/`
or a new `packages/agentic/` package.

Replace `src/create-agent/index.ts` with a re-export shim.

---

### Wave 9 — DX, SDK, adapters, plugins, extensions, media (thin wrappers)

These are thin facades and adapters. Migrate last because they depend on the full package layer.

`src/dx/`, `src/sdk/`, `src/adapters/`, `src/plugins/`, `src/extensions/`, `src/voice/`, `src/video/`

---

### Final — Root `src/` becomes a compatibility facade

Once all waves are complete, every file under `src/` is either:
- A pure re-export barrel pointing at a workspace package, **or**
- Deleted (if the package covers all cases)

Root `src/index.ts` becomes:

```ts
// personaforge — backward-compatible umbrella re-export
export * from '@personaforge/core';
export * from '@personaforge/models';
export * from '@personaforge/tools';
// … etc
```

---

## Immediate Next Actions (Start Monday)

These are the highest-ROI, lowest-risk steps to do first:

1. **Wave 0a–0d** — Type reconciliation (`providers/types.ts` → `@personaforge/core`). Unblocks everything.
2. **Wave 3** — Extract `@personaforge/graph` package. Fixes the CLI root-src leakage immediately. Medium effort, clear boundary.
3. **Write tests for `src/agentic` and `src/execution`** (zero coverage is the single biggest risk in the codebase).
4. **Wave 5a–5b** — Deduplicate `circuit-breaker` / `budget` / `rate-limiter`. Stops dual-maintenance today.

---

## Known Blockers Summary

| Blocker | Impact | Resolution |
|---|---|---|
| `providers/types.ts` duplicate in `@personaforge/core` | Blocks all provider/agentic migration | Wave 0 |
| `src/agentic` — 0 test files | Cannot migrate safely | Write tests first |
| `src/execution` — 0 test files | Cannot migrate safely | Write tests first |
| `src/orchestration` — 0 test files | Cannot migrate safely | Write tests first |
| CLI imports `personaforge/graph` (root src) | CLI package not self-contained | Wave 3 |
| `production` duplicates `guard` implementations | Dual maintenance, inconsistent behaviour | Wave 5 dedup |
| `engine.ts` vs `engine-v2.ts` in `src/execution` | Dead code or unclear which is active | Audit and delete older one |
