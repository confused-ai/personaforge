---
title: Changelog
description: All notable changes to personaforge
---

# Changelog

All notable changes to `personaforge` are documented here.  
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) · [Semantic Versioning](https://semver.org/)

::: tip Full changelog
The authoritative `CHANGELOG.md` lives in the repository root.  
[View on GitHub →](https://github.com/rvuyyuru2/agent-framework/blob/main/CHANGELOG.md)
:::

## v0.7.0 — Current

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
- ReAct agentic loop with `createAgenticAgent`
- `createHttpService` HTTP runtime with OpenAPI
- 50+ built-in tools
- RAG / KnowledgeEngine

---

## v0.1.0

Initial release.
