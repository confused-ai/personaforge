---
title: Changelog
description: All notable changes to Confused-AI
---

# Changelog

All notable changes to `personaforge` are documented here.  
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) · [Semantic Versioning](https://semver.org/)

::: tip Full changelog
The authoritative `CHANGELOG.md` lives in the repository root.  
[View on GitHub →](https://github.com/personaforge/personaforge/blob/main/CHANGELOG.md)
:::

## v2.3.0 — Current

### Added

- **9 Extended Multi-Agent Orchestration Patterns** (`@personaforge/orchestration`) — Mixture-of-Agents (MoA), Actor-Critic loops, Socratic tutor guiding, Prompt Chaining pipelines, Program-of-Thought code sandbox runtimes, Skeleton-of-Thought parallel generation, Step-Back conceptual abstraction solvers, Rejection Sampling (Best-of-N) evaluations, and validation-driven Self-Correction.
- **`createGSDCoordinator()` (Get Shit Done)** — spec-driven workflow coordinator that executes project goals inPlan-Execute-Verify phases, using a workspace `.planning` folder to isolate contexts.
- **`createRalphLoop()` (RALF)** — autonomous cycle executor that leverages fresh session isolation to prevent context bloat while propagating iteration summaries.
- **`Mastermind` Context Compression** (`@personaforge/compression`) — a multi-stage intelligent context compression suite featuring:
  - `CacheAligner` (KV-cache prefix alignment).
  - Specialized crushers (`smart-crusher` for JSON, minifiers for Code, log timestamp/duplicate aggregators, XML, CSV).
  - Sliding-window group budget enforcers to prevent orphaned tool call/result pairs.
  - Code & Context Reduction (CCR) annotations with `retrieveTool` for on-demand details recall.

---

## v1.1.7


### Added

- **`DbScheduleStore`** (`@personaforge/scheduler`) — bridges `ScheduleManager` with any `AgentDb` backend. Persist schedules to SQLite, Postgres, MySQL, MongoDB, Redis, DynamoDB, or Turso with no custom glue code. See [Scheduler → Production persistence](./guide/scheduler.md).
- **DB health in `/health` endpoint** — `createHttpService` now accepts a `db?: AgentDb` option. When provided, `GET /health` (and `/v1/health`) runs a live `db.health()` probe. Returns HTTP 503 with `{ status: 'degraded' }` when the database is unreachable.

### Fixed

- **`@personaforge/db` — `uuid()` security** — all 8 backends (InMemory, SQLite, Postgres, MongoDB, Redis, JSON, MySQL, DynamoDB, Turso) now generate IDs with `crypto.randomUUID()` instead of the previous `Math.random()`-based implementation.
- **`@personaforge/db` — `init()` race condition** — concurrent callers no longer double-initialize the connection. All async backends (Postgres, MongoDB, MySQL, DynamoDB, Turso) now share a single `_initPromise` guard.
- **`PostgresAgentDb`** — `getKnowledgeItems()`, `getTrace()`, and `getTraces()` now correctly re-serialize JSONB `content` and `metadata` columns to string (the `pg` driver returns these as parsed objects).
- **`MongoAgentDb`** — all `findOne` and `find` calls now include `{ projection: { _id: 0 } }` so MongoDB's internal `_id` field is never included in returned rows.
- **`DynamoDbAgentDb`** — constructor now calls `validateTableNames()` to catch invalid table names at construction time instead of silently failing at runtime.
- **`DbSessionStore`** — `now()` helper now returns Unix epoch seconds (`Math.floor(Date.now() / 1000)`) to match the `AgentDb` timestamp contract (was returning milliseconds, causing `created_at`/`updated_at` to be off by ×1000).
- **`TursoAgentDb`** — single-row casts (`LibSqlRow → SessionRow`, `MemoryRow`, etc.) now use the `as unknown as T` double-cast pattern, fixing TypeScript strict-mode errors.
- **`PostgresAgentDb`** — `close()` method was accidentally stripped during a refactor; restored.
- **Unified class API** — `SimpleAgent` and `LegacyAgent` were removed from public exports; `Agent` is now the only class-based API and includes both legacy defaults and modern fluent methods.
- **Durable runtime lifecycle correctness** — resume now rejects terminal workflows consistently; terminal-state handling no longer allows invalid resume paths.
- **CQRS error propagation** — event-bus handler failures are now surfaced via `AggregateError` after handlers run.
- **State machine lifecycle hardening** — `start()` is idempotent; transition commits in `send()` and `jumpTo()` are atomic (state changes apply only after target `onEntry` succeeds).
- **Snapshot restore semantics** — snapshots persist startup status (`started`); restore defaults legacy snapshots to started to avoid duplicate initial `onEntry` execution.

---

## v1.1.6

### Changed

#### Monorepo restructure — packages fully independent
- All source code now lives in independently-built workspace packages under `packages/`. The `src/` directory is retained as a backward-compatible re-export barrel — **no breaking API changes**.
- `packages/tools` rewritten with clean functional `defineTool` implementations; removed all class-based files with broken relative imports.
- `packages/test-utils` is now a fully standalone package: `createMockLLM`, `createMockAgent`, `runScenario` with zero cross-package dependencies.
- CI pipeline updated to 4 sequential jobs: `typecheck → lint → test (Node 18 / 20 / 22) → build all packages`.

### Fixed

- **`router/selectForBudget`** — removed incorrect `× 1,000,000` scaling; budget comparison is now a direct dollar-per-million comparison.
- **`adapter-redis/session-store`** — removed unnecessary optional chain on non-null `hGetAll` result; fixed template literal number type.
- **`tools/types.ts`** — migrated from deprecated `ZodTypeAny` → `z.ZodType`; `_def` private field access replaced with `.def`.
- Removed 33 broken package copies that had relative `src/`-path imports causing circular resolution failures.
- Documentation URLs updated from `rvuyyuru2.github.io/agent-framework` to `personaforge.github.io/personaforge` throughout all docs.
- Version consistency: `ARCHITECTURE.md` and `SECURITY.md` now match the `package.json` version.

### Security

- `SECURITY.md`: added `ShellTool` sandbox requirements section documenting blocked command patterns.
- `SECURITY.md`: documented `RedisRateLimiter` as the required solution for multi-instance distributed rate limiting.
- `README.md`: qualified audit-logging claim — removed unqualified SOC 2 / HIPAA label; added compliance footnote.

---

## v1.1.0

### Added

#### `agent.stream()` — async iterable streaming on every agent
- Every `CreateAgentResult` now has a built-in `stream(prompt, options?)` method
- Returns an `AsyncIterable<string>` — chunks arrive as the LLM generates
- Works with `for await` loops; no extra setup; accepts all `run()` options except `onChunk`

```ts
for await (const chunk of agent.stream('Explain quantum computing')) {
  process.stdout.write(chunk);
}
```

#### `defineAgent()` builder — `budget()`, `checkpoint()`, `adapters()`
- `.budget(config)` — USD spend caps without dropping down to `createAgent()`
- `.checkpoint(store)` — durable crash recovery wired in one line
- `.adapters(registry)` — plug in adapter registry or explicit bindings
- Full builder method table now documented in [Creating Agents](/guide/agents)

### Performance

#### `AgenticRunner` — Zod→JSON Schema cached per agent (not per run)
- Tool definitions (Zod → JSON Schema) are computed once in the constructor and reused
- Zero `toolToLLMDef()` overhead on hot-path `run()` calls after initial agent creation

#### Tool execution — timer leak fixed
- `Promise.race` timeout timer is now always cleared via `.finally()` on every tool call
- Prevents 30-second timer handles accumulating in long-running processes
- Timing now uses `performance.now()` for sub-millisecond accuracy

#### `AuditPlugin` — O(1) event queries
- Internal `Map` indexes maintained on every `onEvent()` call
- `getEventsByType()`, `getEventsForNode()`, `getEventsForExecution()` are all O(1) index lookups
- Previously O(n) full scans — eliminates bottleneck on high-event-volume workflows

#### `OpenTelemetryPlugin` — OTel module imported once and cached
- The `@opentelemetry/api` dynamic import is now cached after the first successful load
- Previously re-imported on every `onNodeStart()` call

---

## v1.0.0

### Added

#### Reasoning Module
- `ReasoningManager` — chain-of-thought and self-critique loops over any `generate` function
- `ReasoningEventType` discriminated union: `step`, `action`, `complete`, `error`
- `NextAction` typed decision point: `continue | finish | backtrack | escalate`
- `ReasoningStore` — pluggable trace persistence (audit, replay, fine-tuning)

#### Scheduler Module
- `ScheduleManager` — CRUD for cron-based job schedules with pluggable `ScheduleStore` + `ScheduleRunStore`
- `InMemoryScheduleStore` (dev) / `SqliteScheduleStore` (prod)
- In-process handler registry — no HTTP endpoint required
- Full lifecycle: `create / update / delete / enable / disable / triggerNow / listRuns`

#### CompressionManager
- Transparent context-window compression before LLM calls; `truncate | summarise | rolling` strategies

#### ContextProvider
- Retrieves and injects grounding documents into the system prompt or user message at run time
- Pluggable `ContextBackend`: `InMemoryContextBackend`, `SqliteContextBackend`

#### Freedom Layer — bare / compose / pipe
- `bare(opts)` — zero-defaults agent; caller owns LLM, tools, hooks, everything
- `compose(...agents, opts?)` — sequential pipeline; output of each agent → input of next
- `compose` options: `when` (conditional routing) + `transform` (reshape data between steps)
- `pipe(agent).then(agent).run(prompt)` — builder-style equivalent to `compose()`

#### Eval Regression Suite
- `runEvalSuite` — labeled dataset, per-sample scoring, baseline comparison, CI exit code
- `InMemoryEvalStore` / `SqliteEvalStore` — durable baseline persistence across CI jobs
- `setBaseline: true` — promote current run as new reference; `regressionThreshold` — allowable score drop

#### Real-World Example Library (4 new runnable examples)
- `examples/reasoning-agent.ts` — Incident Triage Bot (no API key needed)
- `examples/scheduled-agent.ts` — Nightly Market Digest (no API key needed)
- `examples/code-review-pipeline.ts` — PR Code Review Pipeline (no API key needed)
- `examples/eval-regression.ts` — CI Eval Regression Guard (no API key needed)

#### Documentation
- [19 · Incident Triage Bot](./examples/19-reasoning) — `ReasoningManager`, event streaming
- [20 · Scheduled Agent Jobs](./examples/20-scheduled-agents) — cron scheduling, run history
- [21 · Code Review Pipeline](./examples/21-code-review-pipeline) — `bare()`, `compose()`, `pipe()`
- [22 · Eval Regression Guard](./examples/22-eval-ci) — `runEvalSuite`, CI baseline guard

---

## v0.7.0

### Added

#### Budget Enforcement
- `budget?: BudgetConfig` added to `CreateAgentOptions` — hard USD caps per run and per user
- `BudgetEnforcer` instantiated in factory, `recordAndCheck(userId)` called after the run loop
- `userId?: string` added to `AgenticRunConfig` for per-user cap enforcement

#### HITL Approval HTTP Endpoints
- `GET /v1/approvals` — list pending approvals
- `POST /v1/approvals/:id` — submit decision `{ approved, comment, decidedBy }`
- `approvalStore?: ApprovalStore` added to `CreateHttpServiceOptions`

#### Distributed Trace Context
- W3C `traceparent` / `tracestate` extraction from incoming HTTP request headers
- `traceId` from incoming trace propagated in JSON and SSE responses
- `src/observability/trace-context.ts` — `extractTraceContext()`, `injectTraceContext()`

---

## v0.6.0

### Added

#### Testing Module (`personaforge/testing`)
- `MockToolRegistry` — records all invocations; `calls()`, `lastCall()`, `reset()`
- `createTestAgent()` — zero-config test harness with `MockLLMProvider` + `MockSessionStore`
- `createTestHttpService()` — integration test helper on a random port

#### HTTP Runtime
- `X-Request-ID` correlation header on every response
- `rateLimit` middleware option in `CreateHttpServiceOptions`
- `auditStore` option — SQLite-backed persistent audit log
- WebSocket transport (`websocket: true`) — attaches to existing `http.Server`
- Admin API (`adminApi: true`) — `/admin/health`, `/admin/agents`, `/admin/audit`, `/admin/stats`, `/admin/checkpoints`

#### Adapter System (`personaforge/adapters`)
- 20-category adapter system covering SQL, NoSQL, vector, cache, object storage, message queues, observability, embedding, session, memory, guardrail, RAG, tool registry, auth, rate limiting, audit log
- `createProductionSetup()` — opinionated full-stack wiring with progressive upgrade path

#### LLM Router (`personaforge/llm`)
- `LLMRouter` — intelligent routing by task type, complexity, and strategy
- Four strategies: `balanced`, `cost`, `quality`, `speed`
- Factories: `createBalancedRouter`, `createCostOptimizedRouter`, `createQualityFirstRouter`, `createSpeedOptimizedRouter`

#### Deployment Templates (`/templates`)
- `Dockerfile`, `docker-compose.yml`, `fly.toml`, `render.yaml`, `k8s.yaml`
- Grafana dashboard JSON (`grafana-dashboard.json`)

#### DX Improvements
- `defineTool()` helper — AI SDK-style fluent builder with Zod schemas, `needsApproval`, streaming hooks
- `createWorkflow().then(step).commit()` — Mastra-style typed step workflows
- `createStepWorkflow`, `StepWorkflow`, `StepWorkflowBuilder`, `StepWorkflowStep` exports

#### Resilience
- `withResilience()` — circuit breaker + rate limiter + retry + health check wrapper
- `RedisRateLimiter` — distributed rate limiting via Redis

#### Secret Manager (`personaforge/config`)
- `createSecretManager()` with adapters: `EnvSecretManagerAdapter`, `AwsSecretsManagerAdapter`, `AzureKeyVaultAdapter`, `VaultAdapter`, `GcpSecretManagerAdapter`

#### Orchestration Extensions
- `AgentRouter` — capability-based, round-robin, least-loaded routing
- `HandoffProtocol` — structured agent-to-agent task handoff with tracing
- `ConsensusProtocol` — multi-agent voting (majority, unanimous, weighted, best-of-n)

---

## v0.5.0

### Added
- Checkpoint/resume for long-running agents — `checkpointStore?` in `AgenticRunnerConfig`
- `createSqliteSessionStoreSync` — sync init, safe for factory use
- Persistent user profiles and learning modes
- Eval dataset persistence — `EvalStore`, `InMemoryEvalStore`, `SqliteEvalStore`, `runEvalSuite`
- Plugin system — `personaforge/plugins` with built-in logging, rate-limit, telemetry plugins
- Contracts layer — `personaforge/contracts` for shared interfaces without runtime code

---

## v0.4.0

### Added
- Full adapter system for all infrastructure categories
- Multi-tenancy with `createTenantContext()`
- JWT RBAC on HTTP routes
- SOC 2 / HIPAA audit trail

---

## v0.3.0

### Added
- ReAct agentic loop with `createAgent`
- `createHttpService` HTTP runtime with OpenAPI
- 50+ built-in tools
- RAG / KnowledgeEngine

---

## v0.1.0

Initial release.
