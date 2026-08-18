# Changelog

All notable changes to `personaforge` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] — production-hardening audit sweep (items 1–24)

### Added
- **`AgenticRunner` resilience parity** — repeated-state loop detection (`finishReason: 'loop_detected'`, configurable via `loopDetection`), admission control (`admissionControl` → `LoadShedError`), idempotent-tool memoization (`tool.idempotent` per-run cache), response cache + in-flight request coalescing (configurable `responseCache`), W3C `traceparent` header injection into provider calls, and `validateToolArgs` precision pre-flight.
- **Provider capability matrix** — `OpenAIProvider` (and the OpenAI-compatible factories) now accept `headers` + `extraBody` for provider-specific parameters (reasoning-effort, JSON-mode, thinking, non-standard auth), closing the "URL-shim" gap.
- **`personaforge/providers` embedding abstraction** — `EmbeddingProvider` interface satisfied by `OpenAIEmbeddingProvider`, new `GoogleEmbeddingProvider` and `CohereEmbeddingProvider`.
- **Long-tail cost/context metadata** — 23 new `MODEL_PRICING` entries and 27 `MODEL_CONTEXT_LIMITS` entries (Groq, xAI, Mistral, Cohere, Perplexity, MiniMax, Baichuan, Hunyuan, Doubao, Stepfun, OpenRouter, and more).

### Fixed
- **`core/runner/AgentRunner` is now a thin facade over `AgenticRunner`** — one canonical loop engine for the whole framework (no semantic divergence between runners).
- **AI SDK adapter** — assistant tool-call history is replayed as `tool-call` parts, tool-results pair by `toolCallId`/`tool_call_id`, stream tool-call args are accumulated raw and parsed once (no per-fragment JSON crash), `other`/`unknown` finish reasons map to `error`, and `headers` are forwarded.
- **OpenAI/Anthropic** — tool-result id read from both runner conventions (`toolCallId` + `tool_call_id`), headers forwarded, and an OpenAI streaming tool-call arg-drop bug fixed.
- **Bedrock** — full `toolUse`/`toolResult` mapping, abort-signal forwarding, and stream usage/stop capture (previously text-only).
- **Gemini** — stable monotonic tool-call ids, `toolChoice` → `functionCallingConfig`, abort-signal + headers forwarding.
- **`BaseAgent.runWithContext`** — opt-in `throwOnError` error contract (runners throw; adapters convert), preserving the legacy swallow-by-default.

### Tests
- New suites: `tests/agentic-hardening.test.ts` (loop detection, memoization, cache/coalescing, admission, traceparent, tool-message identity), `tests/provider-adapter-hardening.test.ts` (AI SDK tool replay/stream/finish/headers, OpenAI headers+extraBody, Gemini ids/toolChoice/abort, Bedrock tools/abort/usage, throwOnError), `tests/embeddings-providers.test.ts`, `tests/cost-metadata-longtail.test.ts`.
- Full suite: **196 files / 3088 tests passing** (4 skipped); `tsc --noEmit` and `eslint src --max-warnings 0` clean.

---

## [Unreleased] — parity-with-langchain-and-agno

### Added — 14 new feature areas closing the LangChain / LangGraph / Agno gap

- **`personaforge/knowledge/retrieval`** — RecursiveCharacterSplitter, MarkdownSplitter, SemanticSplitter; BM25Index; HybridRetriever + rrfFuse (Reciprocal-Rank Fusion); CohereReranker / JinaReranker / LLMReranker; MultiQueryRetriever, ContextualCompressionRetriever, ParentDocumentRetriever, SelfQueryRetriever, TimeWeightedRetriever.
- **`personaforge/runnable`** — LCEL-style primitive: `Runnable`, `RunnableSequence`, `RunnableParallel`, `RunnableLambda`, `RunnablePassthrough` with `.pipe/.batch/.stream/.map/.bind/.withRetry/.withFallbacks/.withConfig/.assign`.
- **`personaforge/parsers`** — String / Json (Zod-aware) / CsvList / Regex parsers plus OutputFixingParser and RetryWithErrorParser; all Runnable-composable.
- **`personaforge/structured`** — Unified native structured output via `generateStructured` with per-provider routing (OpenAI `response_format`, Anthropic tool-forced, Gemini schema, prompt fallback with retry).
- **`personaforge/streaming`** — LangGraph-style event stream: `values | updates | messages | debug | custom` modes, `StreamEventBus`, `StreamContext.emit()`, `createStreamableRun()`.
- **`personaforge/checkpoint`** — Durable `interrupt()` / `resume(threadId, value)` / `fork(threadId)` with in-memory + pluggable `CheckpointStore`.
- **`personaforge/reasoning`** — Agno-style `think` / `analyze` reasoning tools on top of `ReasoningScratchpad`.
- **`personaforge/orchestration`** — `createModeTeam({ mode: 'route' | 'coordinate' | 'collaborate' })` sugar.
- **`personaforge/models`** — `withFallbacks(primary, [alt1, alt2])` and `withRetry(provider, opts)` — model-level resilience one-liners.
- **`personaforge/toolkits`** — `sqlToolkit`, `httpToolkit`, `fileToolkit`, `combineToolkits` with system-prompt fragments.
- **`personaforge/knowledge`** — Additional loaders: `loadMarkdown`, `loadHtml`, `loadJson`, `loadDocx`, `loadSitemap`, `loadGithubRepo`, `loadS3`.
- **`personaforge/skills`** — `createDeepAgent` deep-research recipe (plan → parallel research → synthesize).
- **`personaforge/eval`** — `spanToSample`, `replayDataset`, `diffResults`, `summarizeDiff` — trace ↔ dataset loop for regression testing.
- **`personaforge/control-plane`** — Zero-dependency AgentOS dashboard server with sessions / memory / evals / traces / approvals / knowledge / chat panels.

### Tests
- 13 new test files, 93 new tests (all green).
- Full suite: **63 files / 910 tests passing** (2 skipped).

---

## [Unreleased]

## [2.4.0] — 2026-06-30

### Added

- `XquikToolkit` for opt-in X post search, user search, and trend lookup through the Xquik REST API.

### Security

- **Removed unsandboxed code execution (RCE).** `createProgramOfThought` no longer ships a `new Function`-based default executor; callers must opt in to an explicit sandboxed executor (vm-isolated, E2B, or Docker-backed).
- **Filesystem tools are now path-sandboxed.** New shared `resolveWithin` guard rejects `../` traversal, sibling-dir/absolute-path escapes, and symlink escapes; `fileSystem` and the `utils/file` tools are confined to a root (`CONFUSED_AI_FS_ROOT` or cwd). New `createFileSystemTool({ root })`.
- **JWT algorithm-confusion hardened.** Header `alg` is now required, pinned to the configured family, and `none` is rejected on the asymmetric path. `JwksVerifier` (RS/ES/PS, kid resolution, JWKS caching, exp/nbf) is fully implemented.
- **Docker tool no longer defaults to an open socket.** A host must be supplied (`DOCKER_HOST` or config); volume binds to sensitive host paths are rejected unless `allowHostMounts: true`.
- **SSRF closed on legacy HTTP/browser tools** — they now reuse the DNS-resolving guard (`checkSsrf`) that blocks IMDS/RFC-1918/CGNAT/IPv6-mapped/loopback, with per-redirect re-validation.
- **Secret/PII redaction before external trace export.** Langfuse/LangSmith ingestion now scrubs payloads with `maskSecrets` before sending.
- MCP remote tool output documented as untrusted (tool-poisoning vector).

### Fixed

- **Cancellation works end-to-end.** `AbortSignal` is threaded into LLM SDK calls and tool execution (provider `signal` option), so in-flight runs cancel instead of running to completion.
- **Retries are safe.** The agent loop retries only transient errors (429/5xx/network) instead of blanket-retrying 4xx/auth/validation; provider errors now carry `status`/headers so `Retry-After` is honored.
- **Anthropic tool-calling + streaming.** The live provider emits proper `tool_use`/`tool_result` blocks, passes `tools` in streaming, and reports token usage; OpenAI streaming sets `stream_options.include_usage`. Cost/budget accounting no longer reads zero on streamed traffic.
- The agent loop appends a single assistant message per turn (was duplicating text + tool calls).
- **Provider fallback/router classify by typed status, not message substrings**, and only fall back on transient errors.
- **Context-window truncation** pins a leading system prompt and keeps tool_use/tool_result pairs atomic.
- **Durable graph resume restores node outputs** (was persisting only a `hasOutput` flag → silent wrong results on resume); graph now fails fast on a failed node.
- **Multi-agent handoff passes conversation history** to the target and no longer hardcodes `COMPLETED` (multi-hop chains work); swarm subagent execution fails loud instead of returning fake placeholder results.
- **Idempotency is race-free** (atomic `reserve()` before work, Stripe-style); **Redis rate limiter is atomic** (single Lua `INCR`+`PEXPIRE`); **`BudgetEnforcer` is wired into the loop** (per-step cost + hard stop); **HITL `requireApprovalTool` implemented**; RBAC enforced on the resolved agent name (was bypassed on the main chat path).
- **Observability: OTel GenAI semantic conventions** (`gen_ai.*`) on LLM spans, LLM token/cost metrics now recorded (bounded labels), and the Prometheus endpoint reports "exporter not wired" instead of fake zeros.
- LLM-judge distinguishes JSON parse failures from a genuine score of 0 (`parseError`).
- Build: `pg`/`fluent-ffmpeg` optional-peer imports no longer break `tsc` (the CI typecheck gate).

### Changed

- **Unified token estimation** on a single shared estimator (`estimateTokenCount`); removed the ad-hoc `chars/4` divergence across the router and stream utils.
- **Eval regression detection** now accepts an optional baseline + tolerance band (aggregate-drop detection) instead of only a fixed per-run threshold.
- **Coverage now measures `src/`** (reported for visibility, ratcheted; `packages/*` stay gated at 80) so the shipped runtime is no longer a blind spot.

### Developer experience

- Quick-start `@packageDocumentation` example on the main entry points (`index`, `lite`).
- `@experimental` JSDoc banners on not-yet-stable subsystems (reasoning, multi-agent swarm/patterns, durable execution, learning, voice, video) so consumers know what is semver-stable.
- Actionable install/fix hints on peer-dependency and config errors.

### Deprecated

- The duplicate module stacks (`models/` vs `providers/`, `observability/` vs `observe/`, `eval/` vs `observability/eval`, `execution/` graph engine vs `graph/`) are now thin `@deprecated` re-exports of their canonical counterparts — content drift is eliminated and public paths still resolve. Physical removal and the `execution/`→`graph/` engine merge are slated for 3.0 (each still has live importers).

## [2.3.0] — 2026-06-03

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

## [2.0.0] — 2026-05-09


### Added

- **`defineAgent(name)` fluent builder** — `defineAgent('my-agent').instructions('...').model('openai:gpt-4o').tools(...).build()` returns a fully-typed `TypedAgent<TIn, TOut>` with `.run()`, `.stream()`, `.resume()`, and `.plan()`. Old `defineAgentFromConfig(config)` kept for backward compatibility.
- **`personaforge chat` CLI REPL** — `personaforge chat [--system <instructions>] [--model <id>] [--session-id <id>]` starts an interactive readline loop. Session ID is preserved across all turns; `/exit` and Ctrl-C handled cleanly.
- **`@personaforge/playground` package** — `createPlayground(agents, options?)` spins up a pure Node.js HTTP server with a built-in dark-theme chat UI. Routes: `GET /`, `POST /api/chat`, `GET /api/agents`, `GET /health`. CSP headers, 64 KB body cap, zero framework dependencies.
- **DNS-based SSRF guard** — `HttpClientTool` now resolves every hostname via `dns.promises.lookup()` (2-second timeout) before making any request. Requests resolving to RFC 1918 / loopback addresses are blocked with a descriptive error. Redirects are followed manually and re-validated on each hop.
- **`SpanName` constants** — `packages/platform/observe/src/spans.ts` exports 30+ canonical span name constants (`SpanName.AGENT_RUN`, `SpanName.LLM_GENERATE`, `SpanName.TOOL_CALL`, etc.). Import from `@personaforge/observe`.
- **`SecretManagerAdapter.watch()`** — polling-based secret rotation watch (5-minute default interval) added to all five adapter classes (`EnvSecretManager`, `AwsSecretsManagerAdapter`, `VaultSecretManager`, `AzureKeyVaultAdapter`, `GcpSecretManagerAdapter`). Fail-closed on errors.
- **DB migration runner** — `packages/state/db/src/migrations/runner.ts` applies versioned schema migrations on `PostgresAgentDb._doInit()`. Ships with a v1 baseline schema.
- **E2E integration tests** (`tests/e2e-agent.test.ts`) — 28 full-stack ReAct-loop tests covering: single/multi-turn tool use, tool error recovery, guardrail injection blocking, session persistence, max-steps guard, AbortSignal cancellation, all lifecycle hooks, concurrent run isolation, HTTP service, eval suite regression detection, prompt injection detection, and budget enforcement.
- **OTLP span validation tests** (`packages/observe/tests/span-validation.test.ts`) — 21 tests with a zero-dep in-memory `TracerProvider` built from `@opentelemetry/api` interfaces.
- **Migration guides** — `docs/guide/migration-langchain.md`, `docs/guide/migration-crewai.md`, `docs/guide/migration-vercel.md` with concept tables and side-by-side code examples.
- **Custom adapter guide** — `docs/guide/custom-adapter.md` covers `SessionStore`, `MemoryStore`, `VectorStore`, `LLMProvider`, and `QueueAdapter` with real interface signatures and ~30-line implementations.
- **`scripts/check-docs-claims.mjs`** — CI gate (`bun run check:docs`) that scans `docs/**/*.md` for `packages/…` and `src/…` file references and exits 1 if any referenced path does not exist on disk.
- **`scripts/check-bundle-size.mjs`** — CI gate (`bun run check:bundle`) that esbuild-bundles + gzip-measures every package and fails if any exceeds its configured budget (default 80 KB).
- **Test coverage** — **772 tests passing (2 skipped) across 38 test files** (`vitest run`).

### Changed

- **Package domain restructure** — 39 packages reorganised into six domain groups: `packages/foundation/`, `packages/platform/`, `packages/providers/`, `packages/runtime/`, `packages/state/`, `packages/tools-layer/`, `packages/developer/`, `packages/extensions/`. `pnpm-workspace.yaml` updated to `packages/*/*`.
- **Examples** — all 12 `examples/*.ts` and 5 `examples/quickstart/*.ts` now import from `personaforge` / `@personaforge/*` package paths; zero `../src/` relative imports remain.
- **`MockLLMProvider`** added to `@personaforge/test-utils` for use in examples and conformance suites.

### Fixed

- **`lint:packages` gate** — reduced from 956 errors / 26 warnings (audit baseline, May 8) to **0 errors / 2 warnings** under `--max-warnings 10`. Fixes cover: unnecessary type assertions, confusing void expressions in arrow shorthand, tautological conditions, non-null assertions without comments, and unnecessary optional chains.
- **`HttpClientTool` SSRF** — private-IP requests now blocked by default via DNS resolution; no `allowedDomains` config required for the common case.
- **Unified class API** — `SimpleAgent` and `LegacyAgent` were removed from public exports; `Agent` is now the single class surface with legacy defaults and modern fluent methods in one implementation.
- **Durable runtime lifecycle correctness** — resumptions now reject terminal workflows consistently, and terminal-state handling no longer allows invalid resume paths.
- **CQRS error propagation** — `EventBus.publish()` now surfaces handler failures via `AggregateError` after handlers run instead of failing silently.
- **State machine lifecycle hardening** — `AgentStateMachine.start()` is idempotent; transition commits in `send()` and `jumpTo()` are now atomic (state updates only after target `onEntry` succeeds).
- **Snapshot restore semantics** — `StateMachineSnapshot` now persists startup status via `started`; `fromSnapshot()` restores it and defaults legacy snapshots to started to prevent duplicate initial `onEntry` execution.

### Security

- `HttpClientTool` — DNS-based SSRF guard blocks all RFC 1918 and loopback destinations by default (see **Added** above).
- `SecretManagerAdapter.watch()` — secrets can now be rotated without redeployment.

---

## [1.1.7] — 2026-05-04

### Added

- **`DbScheduleStore`** (`packages/scheduler`) — bridges `ScheduleManager` with any `AgentDb` backend. Pass any `AgentDb` instance (SQLite, Postgres, MySQL, MongoDB, Redis, DynamoDB, Turso, JSON) as the `ScheduleStore` without writing custom persistence code. Exported from `personaforge/scheduler`.
- **DB health in `/health` endpoint** — `CreateHttpServiceOptions` now accepts `db?: AgentDb`. When set, `GET /health` and `GET /v1/health` run a live `db.health()` probe and return HTTP 503 with `{ status: 'degraded' }` if the database is unreachable.

### Fixed

- **`@personaforge/db` — `uuid()` not cryptographically secure** — all 8 backends now use `crypto.randomUUID()` via a shared `packages/db/src/utils.ts` module (was `Math.random()`-based).
- **`@personaforge/db` — `init()` race condition** — concurrent callers no longer double-initialize the connection pool. Async backends (Postgres, MongoDB, MySQL, DynamoDB, Turso) now guard with a shared `_initPromise`.
- **`PostgresAgentDb`** — `getKnowledgeItems()`, `getTrace()`, and `getTraces()` now re-serialize JSONB `content` / `metadata` columns back to strings. The `pg` driver returns JSONB as parsed objects, not strings; this caused type contract violations for consumers expecting `string | null`.
- **`PostgresAgentDb`** — `close()` method was accidentally removed during a refactor; restored.
- **`MongoAgentDb`** — all `findOne()` and `find()` calls now include `{ projection: { _id: 0 } }`, preventing MongoDB's internal `_id` ObjectId field from leaking into `SessionRow`, `MemoryRow`, and other row types.
- **`DynamoDbAgentDb`** — constructor now calls `validateTableNames()` to catch misconfigured table names at startup rather than at first use.
- **`TursoAgentDb`** — single-row casts (`LibSqlRow → SessionRow` etc.) now use the `as unknown as T` double-cast pattern, fixing TypeScript strict-mode errors.
- **`DbSessionStore`** (`packages/session`) — `now()` helper now returns Unix epoch **seconds** (`Math.floor(Date.now() / 1000)`) matching the `AgentDb` timestamp contract. Was returning milliseconds, causing `created_at`/`updated_at` to be stored 1000× too large.

---

## [1.1.6] — 2026-05-04

### Changed

- **Monorepo structure** — all source code now lives in independently-built workspace packages under `packages/`. `src/` retained as backward-compatible re-export barrel.
- **`packages/tools`** — rewrote `shell`, `browser`, and `types` as clean functional `defineTool` implementations; removed all class-based files with broken `../core/` relative imports.
- **`packages/test-utils`** — complete standalone implementation of `createMockLLM`, `createMockAgent`, `runScenario`; zero cross-package dependencies.
- **CI** — updated to 4 jobs: `typecheck → lint → test (Node 18/20/22) → build all packages`.

### Fixed

- `router/selectForBudget`: removed incorrect `* 1_000_000` scaling; budget comparison is now direct dollar-per-million.
- `adapter-redis/session-store`: removed unnecessary optional chain on non-null `hGetAll` result; fixed template literal number type.
- `tools/types.ts`: migrated from deprecated `ZodTypeAny` → `z.ZodType`, `_def` → `.def`.
- Removed 33 broken package copies that had relative `src/`-path imports.
- Docs URL: replaced all `rvuyyuru2.github.io/agent-framework` references with `personaforge.github.io/personaforge`.
- Version consistency: `ARCHITECTURE.md` and `SECURITY.md` now match `package.json` version `1.1.6`.

### Security

- `SECURITY.md`: added ShellTool sandbox requirements section.
- `SECURITY.md`: documented `RedisRateLimiter` for multi-instance rate limiting.
- `README.md`: qualified audit logging claim — removed SOC2/HIPAA label; added compliance footnote.

---

## [1.1.0] — 2026-04-27

### Added

- **`agent.stream()`** — every `CreateAgentResult` now exposes `stream(prompt, options?)` returning `AsyncIterable<string>`. Stream agent output with `for await` loops; accepts all `run()` options except `onChunk`.
- **`defineAgent().budget(config)`** — set per-run / per-user / monthly USD caps directly on the fluent builder without dropping to `createAgent()`.
- **`defineAgent().checkpoint(store)`** — wire a durable checkpoint store in one builder call.
- **`defineAgent().adapters(registry)`** — plug in adapter registry or explicit `AdapterBindings` via the builder.

### Performance

- **`AgenticRunner`** — Zod→JSON Schema conversion (`toolToLLMDef`) is now computed **once** in the constructor and reused on every `run()` call. Previously computed fresh on every run.
- **Tool execution** — fixed `Promise.race` timer leak: the 30-second timeout handle is now always cleared via `.finally()`, preventing timer accumulation in long-running processes. Timing switched to `performance.now()` for sub-millisecond accuracy.
- **`AuditPlugin`** — `getEventsByType()`, `getEventsForNode()`, and `getEventsForExecution()` are now O(1) index lookups backed by internal `Map`s maintained on each `onEvent()` call. Previously O(n) full array scans.
- **`OpenTelemetryPlugin`** — the `@opentelemetry/api` dynamic import is cached after the first successful load. Previously re-imported on every `onNodeStart()` call.

### Fixed

- **`compose()`** — agent detection now uses a precise three-field type guard (`run` + `instructions` + `createSession`) instead of fragile duck-typing, preventing accidental misclassification of option objects as agents.

---

## [1.0.0] — 2026-05-18

### Added

#### Reasoning Module (`personaforge/reasoning`)
- `ReasoningManager` — drives chain-of-thought and self-critique loops over a `generate` function; fully framework-agnostic (pass any LLM call)
- `ReasoningConfig` — `{ generate, minSteps, maxSteps, systemPrompt, temperature }`; configurable step counts and system prompt override
- `ReasoningEventType` — discriminated union: `step`, `action`, `complete`, `error` — iterate with `for await`
- `NextAction` — typed decision point: `continue | finish | backtrack | escalate`; `ReasoningStep` captures thought + observation + next action
- `ReasoningStore` — pluggable persistence for full reasoning traces (audit, replay, fine-tuning)
- Exported from `personaforge/reasoning` subpath

#### Scheduler Module (`personaforge/scheduler`)
- `ScheduleManager` — CRUD for cron-based job schedules; pluggable `ScheduleStore` + `ScheduleRunStore` backends
- `InMemoryScheduleStore` / `InMemoryScheduleRunStore` — zero-config for dev and testing
- `SqliteScheduleStore` / `SqliteScheduleRunStore` — durable persistence; survives process restarts
- `CreateScheduleInput` — `{ name, cronExpr, endpoint, enabled, maxRetries, retryDelaySeconds }`
- `ScheduleRunStatus` — `pending | running | success | failed | skipped`
- `manager.register(key, handler)` — in-process handler registry; no HTTP endpoint required
- `manager.create / update / delete / enable / disable` — full lifecycle CRUD
- `manager.triggerNow(id)` — manual trigger for backfill / testing
- `manager.listRuns(id, limit)` — query run history with status, duration, error
- `manager.start() / stop()` — poll loop lifecycle
- Exported from `personaforge/scheduler` subpath

#### CompressionManager (`personaforge/compression`)
- `CompressionManager` — transparently compresses context windows before LLM calls; pluggable strategy (`truncate | summarise | rolling`)
- `CompressionConfig` — `{ strategy, targetTokens, summaryPrompt, model }`
- Automatic trigger when token estimate exceeds `targetTokens`; preserves system prompt + most-recent N messages unconditionally
- Exported from `personaforge/compression` subpath

#### ContextProvider (`personaforge/context`)
- `ContextProvider` — retrieves grounding documents and injects them into the system prompt or user message at run time
- `ContextBackend` — pluggable retrieval backend: `InMemoryContextBackend`, `SqliteContextBackend`; implement `search(query, k)` for custom backends
- `ContextMode` — `prepend | append | system` — controls injection point
- `Document` — `{ id, content, metadata }`; `Answer` — `{ text, sources }`
- Exported from `personaforge/context` subpath

#### Freedom Layer — bare / compose / pipe (`personaforge`)
- `bare(opts)` — zero-defaults agent constructor; caller provides LLM, tools, hooks, everything; no sessions, no injected tools, no guardrails
- `BareAgentOptions` — `{ name, instructions, llm, tools?, hooks?, maxSteps?, timeoutMs? }`
- `compose(...agents, opts?)` — pipe N agents sequentially; output text of step N → input of step N+1
- `ComposeOptions` — `{ when?, transform? }` — conditional routing and data reshaping between steps
- `pipe(agent).then(agent).run(prompt)` — builder-style alternative to `compose()` with identical semantics
- `hooks.buildSystemPrompt` / `hooks.afterRun` — lifecycle interception on every `bare()` agent
- Exported from top-level `personaforge` import

#### Eval Regression Suite (`personaforge/observability`)
- `runEvalSuite({ suiteName, dataset, agent, store, scorer, passingScore, regressionThreshold, setBaseline, onSample })` — run a labeled dataset, score every sample, compare to baseline
- `EvalStore` interface — `appendSample`, `appendRun`, `querySamples`, `queryRuns`, `getBaseline`, `saveBaseline`
- `InMemoryEvalStore` — zero-config for dev; `SqliteEvalStore` — durable CI persistence
- `EvalReport` — `{ suiteRunId, suiteName, averageScore, passedCount, totalCount, passed, regressionDelta, baselineScore, samples }`
- `EvalDatasetItem` — `{ input, expectedOutput? }`; `EvalScorer` — `(input, expected, actual) => number | Promise<number>`
- `setBaseline: true` — saves the current run as the reference; subsequent runs compare against it
- `regressionThreshold` — decimal fraction; suite fails if `averageScore < baselineScore - threshold`
- CI-friendly: `process.exit(1)` on regression; `EXIT_ON_REGRESSION` env var pattern documented

#### Real-World Example Library
- `examples/reasoning-agent.ts` — **Incident Triage Bot**: uses `ReasoningManager` with a mock `generate` function to demonstrate 4-step chain-of-thought diagnosis and remediation plan; no API key required
- `examples/scheduled-agent.ts` — **Nightly Market Digest**: demonstrates `ScheduleManager` CRUD, cron scheduling (`0 9 * * 1-5`), handler registry, `triggerNow`, run history, enable/disable; no API key required
- `examples/code-review-pipeline.ts` — **PR Code Review Pipeline**: three `bare()` agents (DiffAnalyser, SecurityReviewer, ReportWriter) wired with `compose()`, `pipe()`, and conditional `when` hand-off; no API key required
- `examples/eval-regression.ts` — **CI Eval Regression Guard**: three back-to-back `runEvalSuite` calls (baseline → regression → fixed) using `MockLLMProvider`; custom `wordOverlapF1Scorer`; no API key required

#### Documentation (docs/examples/)
- `19-reasoning.md` — Incident triage with `ReasoningManager`, event streaming patterns, production wiring
- `20-scheduled-agents.md` — Fintech market digest scheduling, cron syntax reference, persistent store swap
- `21-code-review-pipeline.md` — `bare()` vs `createAgent()` comparison, all three composition styles, GitHub Actions integration
- `22-eval-ci.md` — Eval dataset design, word-overlap F1 scorer, SQLite persistence, full CI workflow

### Changed
- `package.json` scripts: added `example:reasoning`, `example:scheduled`, `example:code-review`, `example:eval`
- `docs/examples/index.md`: added rows 19–22 to the example table; updated framework map runnable list
- `src/shared/version.ts`: `VERSION` bumped from `0.3.0` → `1.0.0`

---

## [0.7.0] — 2026-04-27

### Added

#### Budget Enforcement
- `budget?: BudgetConfig` added to `CreateAgentOptions` — configure `maxUsdPerRun`, `maxUsdPerUser`, `maxUsdPerMonth`, and `onExceeded` behaviour (`'throw' | 'warn' | 'truncate'`)
- `BudgetEnforcer` instantiated in factory.ts; `budgetEnforcer?.resetRun()` called before each run
- `addStepCost()` called in `runner.ts` after each LLM call when `result.usage` is present
- `recordAndCheck(userId)` called in runner.ts after the run loop to enforce per-user daily + monthly caps
- `userId?: string` added to `AgenticRunConfig` for per-user cap enforcement
- `BudgetExceededError` thrown when a cap is crossed and `onExceeded === 'throw'`

#### HITL Approval HTTP Endpoints
- `approvalStore?: ApprovalStore` added to `CreateHttpServiceOptions`
- `GET /v1/approvals` — lists all pending approval requests
- `POST /v1/approvals/:id` — submits a decision `{ approved: boolean, comment?: string, decidedBy: string }`
- Both routes wired in `server.ts` and documented in the OpenAPI spec

#### Distributed Trace Context
- `extractTraceContext()` imported and called in `server.ts` from incoming request headers (`traceparent`, `tracestate`)
- `traceId` from the incoming trace is propagated in JSON responses and SSE event streams

#### Graph Engine Production Hardening
- `DurableExecutor` class — wraps `DAGEngine` + `EventStore` for fully durable execution; `.run()` starts a new execution, `.resume(executionId)` replays all events and continues from the last incomplete node; detects graph version mismatch on resume
- `computeWaves(graph: GraphDef): NodeId[][]` — topological level assignment returning groups of nodes that can execute in parallel, used internally by the scheduler and available for custom scheduling
- `BackpressureController(maxConcurrency)` — semaphore for concurrency control; `.acquire()` waits for a free slot, `.release()` frees one, `.inflight` and `.queueDepth` expose current state
- Graph testing utilities exported from `personaforge/testing`: `createTestRunner(opts?)`, `createMockLLMProvider(name, responses)`, `expectEventSequence(actual, expected)` (subset match), `assertExactEventSequence(actual, expected)` (strict match)
- 4 new CLI commands: `personaforge replay --run-id <id>` (stream events), `personaforge inspect --run-id <id>` (per-node summary), `personaforge export --run-id <id> [--out file]` (dump to JSON), `personaforge diff --run-id-a <id> --run-id-b <id>` (compare two runs; exits `1` if divergent)
- Benchmark suite under `benchmarks/` with 4 files targeting: executor (<1ms), event-store (>5 k writes/sec), replay (>10 k events/sec), graph-compile (<5ms); run via `bun run bench`
- ESLint layer-boundaries config (`eslint.config.js`) using `eslint-plugin-boundaries` to block illegal cross-layer imports

---

## [0.6.0]

### Added

#### Testing Module (`personaforge/testing`)
- `MockToolRegistry` — records all tool invocations for assertion in tests; supports `calls()`, `lastCall()`, `reset()`, `register()`, `toTools()`
- `createTestAgent()` — zero-config test harness that auto-wires `MockLLMProvider` + `MockSessionStore`
- `createTestHttpService()` — integration test helper that starts a real HTTP server on a random port with `.request()`, `.close()`, `.port`, `.baseUrl`
- Exported `./testing` subpath from package.json and tsup config

#### HTTP Runtime
- **X-Request-ID correlation**: Every HTTP response now includes `X-Request-ID` header, assigned at the start of request handling. Forwarded from incoming `x-request-id` header when present.
- **Rate limiting middleware**: `CreateHttpServiceOptions.rateLimit` option wires any `{ check(key): Promise<void> | void }` implementation (e.g. `RateLimiter`) into the HTTP middleware stack. Keyed on authenticated identity, `X-Forwarded-For`, or remote address. Returns 429 with JSON error on limit exceeded.

#### JWT RBAC
- `verifyJwtAsymmetric(token, publicKeyPem, algorithm)` — RS256/RS384/RS512/ES256/ES384/ES512 verification using Node.js `crypto.createVerify` (no external deps)
- `jwtAuth({ publicKey, algorithm })` — asymmetric verification path when `publicKey` is provided
- `algorithm` option on `JwtAuthOptions` for explicit algorithm selection

#### CLI
- `personaforge serve <file>` — new command; imports an agent file and starts the HTTP service on a configurable port; graceful SIGINT/SIGTERM handling
- `personaforge eval <dataset> --agent <file>` — new command; runs a JSON dataset against an agent and reports accuracy; CI-friendly exit code
- `personaforge run --watch` — fully implemented watch mode using `fs.watch()` with 150ms debounce and module cache busting
- `personaforge doctor` — complete rewrite: checks Node.js version, all LLM provider API keys, 7 optional packages, and network connectivity
- `personaforge create` — complete rewrite: multi-template scaffold (`basic`, `http`) generating `agent.ts`, `package.json`, `tsconfig.json`, `.env.example`, `README.md`

#### Package Exports
- Added `./testing`, `./learning`, `./video`, `./config` subpaths to package.json
- Added corresponding entries to tsup build config

#### Type Infrastructure
- `tsconfig.test.json` — separate tsconfig for test files with `"types": ["bun-types", "node"]`; enables Node.js types in tests without polluting source compilation
- `vitest.config.ts` — `typecheck.tsconfig` now points to `tsconfig.test.json`

#### Tests
- `tests/jwt-rbac.test.ts` — HS256 verification, tamper detection, expiry, wrong secret, `hasRole`, `jwtAuth` factory
- `tests/testing-utils.test.ts` — `MockToolRegistry`, `MockLLMProvider`, `MockSessionStore` assertions
- `tests/guardrails.test.ts` — PII detection, prompt injection, `GuardrailValidator`, URL validation
- `tests/budget.test.ts` — `BudgetEnforcer`, `BudgetExceededError`, `estimateCostUsd`, per-user daily limits
- `tests/storage.test.ts` — in-memory and file-based storage adapters

#### Documentation
- `SECURITY.md` — vulnerability reporting, JWT security guidance, hardening checklist
- `CONTRIBUTING.md` — setup, coding standards, PR process, release flow
- `CHANGELOG.md` — this file

### Fixed
- `runtime.test.ts` — `AgenticRunResult.markdown` was missing from mock return, causing type errors

---

## [0.5.0]

### Added

#### HTTP Runtime
- JWT RBAC middleware (`jwtAuth`, `verifyJwtHs256`, `hasRole`)
- OpenAPI schema generation endpoint (`/v1/openapi.json`)
- Server-sent events (SSE) streaming for long-running agent runs
- WebSocket support for bidirectional agent communication
- Admin API (`/v1/admin/health`, `/v1/admin/sessions`, `/v1/admin/circuit-breakers`)
- Audit log integration with `pushAudit()` on all request lifecycle events

#### Production
- `BudgetEnforcer` — hard USD caps per run, per user (daily), and per month
- `BudgetExceededError` with structured `cap`, `limitUsd`, `spentUsd`, `runCostUsd` fields
- `HealthChecker` — aggregated health endpoint for LLM providers, storage, and custom checks
- HITL (Human-in-the-loop) HTTP endpoints for approval workflows

#### Observability
- OpenTelemetry distributed trace context propagation (`traceparent` header injection/extraction)
- `EvalStore` for storing agent evaluation results

#### Adapters
- 20-category adapter registry: LLM, vector DB, storage, cache, message queue, observability, auth, email, SMS, payment, analytics, search, file, calendar, CRM, ERP, IoT, blockchain, multimedia, custom
- Production adapter bundle (Redis rate limiter, S3 storage, PostgreSQL session)

---

## [0.4.0]

### Added
- Agentic runner with configurable step limit, timeout, and tool execution
- Multi-agent orchestration: `AgentTeam` (parallel) and `SupervisorAgent` (sequential delegation)
- Long-term memory with vector similarity search
- RAG (Retrieval-Augmented Generation) knowledge base
- Background queue processing (BullMQ integration)
- Checkpoint/resume for long-running agentic tasks
- Circuit breaker with half-open probe on LLM provider failures
- Cost tracker with per-model pricing (`MODEL_PRICING` map)
- Plugin system with lifecycle hooks (onStart, onStep, onEnd, onError)

---

## [0.3.0]

### Added
- Session management with in-memory and persistent stores
- Lifecycle hooks system (`beforeRun`, `afterStep`, `afterRun`, `onError`, `onToolCall`)
- Structured artifact output (markdown, JSON, image, file, chart)
- LLM router (cost-based, performance-based, smart classification)
- Streaming token output via async iterators

---

## [0.2.0]

### Added
- Core `createAgent()` and `Agent` class
- Multi-provider LLM support: OpenAI, Anthropic Claude, Google Gemini, OpenRouter, AWS Bedrock
- Tool system with Zod schema validation
- `GuardrailValidator`, PII detection, prompt injection detection
- Rate limiter with sliding window algorithm
- `InMemorySessionStore`, `InMemoryCheckpointStore`

---

## [0.1.0]

### Added
- Initial release
- Basic agent with single LLM call
- OpenAI provider
- CLI scaffold (`personaforge create`)
