# Agent Framework — Production Readiness Technical Audit

**Date:** 2026-08-17
**Scope:** `agent-framework` repository (core loop, tool-calling, resilience primitives, execution graph, session/memory stores)
**Verdict:** *Production-ready for single-node, moderate-throughput workloads. Not yet world-class for massive concurrency / multi-node horizontal scale.*

---

## 1. Executive Summary

The framework demonstrates a **mature, SOLID-aligned architecture** with strong separation of concerns, an excellent error taxonomy, and best-in-class algorithmic choices (O(1) lookups, lazy copy-on-write registries, exponential-backoff-with-jitter retries, sliding-window circuit breakers, token-bucket rate limiters). The core ReAct loop is well-isolated and stateless between runs.

However, review of the actual code paths reveals **consistency gaps and a few correctness risks** that would surface under production load:

| Risk | Severity | Where |
|------|----------|-------|
| No progress/loop detection — only `maxSteps` bounds the loop | **High** | `agentic/runner.ts`, `core/runner/agent-runner.ts` |
| Tool dispatch sequential in core runner, parallel in agentic runner (inconsistent) | Medium | `agent-runner.ts:_dispatchTools` |
| Retry fallback defaults *all* errors to transient when optional `guard` peer is absent | **High** | `agent-runner.ts:59` |
| Cost tracking uses agent name, not model id | Medium | `agent-runner.ts:302` |
| Error-handling model inconsistent (throw vs. return) between runners/agents | Medium | `base-agent.ts` vs `agentic/runner.ts` |
| No semantic cache / dedupe layer for LLM calls | Medium | `agentic/runner.ts` |
| In-memory stores are the default — no cross-process coordination | Medium | `session/in-memory.ts` |
| Provider adapters diverge; AI SDK adapter **drops assistant tool-call history**; Bedrock is tool-free | **High** | `providers/ai-sdk-provider.ts:221`, `providers/bedrock-provider.ts` |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Agent (fluent facade)  →  createAgent  →  AgenticRunner     │
│  core/base-agent.ts (legacy state machine)                   │
│  core/runner/agent-runner.ts (ReAct loop, seq dispatch)      │
│  agentic/runner.ts         (ReAct loop, parallel dispatch)   │
├─────────────────────────────────────────────────────────────┤
│  Cross-cutting:                                              │
│   • guard/retry.ts        (backoff + jitter + Retry-After)   │
│   • production/circuit-breaker.ts  (sliding window)          │
│   • production/rate-limiter.ts     (token bucket)            │
│   • production/concurrency.ts       (Semaphore, limiter)     │
│   • production/graceful-shutdown.ts                          │
│   • guardrails/            (PII, injection, moderation)      │
│   • execution/state-graph.ts (DAG workflow, cycle detection) │
├─────────────────────────────────────────────────────────────┤
│  Providers (providers/): single LLMProvider interface        │
│   • Native SDK: openai, anthropic, google(Gemini), bedrock,  │
│     openai-embedding, voice (openai, elevenlabs)             │
│   • Compat wave (~45 OpenAI-compatible factories): groq, xai,│
│     together, fireworks, deepseek, mistral, cohere,          │
│     perplexity, azure, cerebras, sambanova, nvidia, ai21,    │
│     hyperbolic, lambda, moonshot, dashscope, zhipu, yi,      │
│     upstage, novita, cloudflare, writer, deepinfra,          │
│     huggingface, lepton, featherless, snowflake, vllm,       │
│     lmstudio, hunyuan, volcengine, minimax, baichuan,        │
│     stepfun, internlm, replicate, runpod, watsonx, localai,  │
│     kobold, textgenwebui, jan                                │
│   • Gateways/meta: openrouter, fallback-chain, router, cache │
│   • AI SDK adapter (createAiSdkProvider → ~300 @ai-sdk/*)    │
├─────────────────────────────────────────────────────────────┤
│  Persistence: session/ (in-memory, sqlite, redis, fallback)  │
│               learning/ (in-memory, sqlite, postgres, mongo) │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Dimension 1 — Agent Loop Robustness

### What is strong
- **Bounded loop:** `maxSteps` (default 20) plus wall-clock `deadline` (default 60s) ensure termination. Finish reasons are exhaustive (`stop|max_steps|timeout|error|human_rejected|aborted|suspended|max_runs`).
- **Cancellation propagation:** a per-run `AbortController` links external signals and the deadline, and is forwarded into LLM SDK calls *and* tool execution.
- **Durability:** checkpoint save/restore supports resume; suspended/approval-required runs persist a snapshot and replay.
- **Isolation:** `mergeLifecycleHooks` creates local hook objects per run — no shared mutable state, so concurrent `run()` calls are safe.

### Gaps

**GAP-1.1 — No progress / repeated-state detection (HIGH).**
The loop only exits when `maxSteps` is hit. A model that repeatedly emits the *same* tool call (or oscillates between two states) burns the full step budget instead of bailing early. There is no embedding/signature-dedup or "no-op step" detection.

**GAP-1.2 — Goal-iteration can loop without a hard ceiling disconnected from `maxSteps`.**
`_evaluateGoal` keeps `continue`-ing on judge feedback (`agentic/runner.ts:638-648`). `max_runs` is the only bound, distinct from `maxSteps`; a flaky judge can drive unbounded cost.

**GAP-1.3 — Two divergent loop implementations.**
`core/runner/agent-runner.ts` (sequential tool dispatch) and `agentic/runner.ts` (parallel dispatch) represent the same ReAct semantic differently. Divergence invites divergent bug-fixes and inconsistent latency/semantics.

**GAP-1.4 — Legacy state machine is nominal, not enforced.**
`base-agent.ts` tracks `AgentState` (IDLE→PLANNING→…→COMPLETED/FAILED) but transitions are unguarded and there is no centralized transition map; `PAUSED/CANCELLED` are defined but never transitioned by the runner itself.

### Fixes (in priority order)

**FIX-1.1 — Repeated-state loop breaker.**
Add a compact conversation signature (hash of the last N assistant tool-call names+args) and break out with `finishReason = 'loop_detected'` when the signature repeats `k` consecutive steps.

```ts
// agentic/runner.ts — inside the ReAct loop
const loopDetector = new RepeatedStateDetector({ window: 2, tolerance: 3 });
while (steps < maxSteps) {
  // ... after tool dispatch, before next iteration:
  const sig = signatureOf(messages.slice(-2));
  if (loopDetector.record(sig)) {
    finishReason = 'loop_detected';
    break;
  }
}
```

**FIX-1.2 — Unify the loop into one authoritative runner.**
Promote `agentic/runner.ts` as the single runner; make `core/runner/agent-runner.ts` a thin compatibility shim that delegates. Removes the divergence class entirely.

**FIX-1.3 — Centralized state-transition table.**
Replace ad-hoc `setState` calls with a validated transition map (e.g. `IDLE→PLANNING`, `PLANNING→EXECUTING`, and reject illegal transitions with a typed error).

**FIX-1.4 — Tie goal-iteration to a shared cost budget.**
Introduce a per-run iteration budget shared by the ReAct loop *and* the goal/judge loop so neither can exceed total spend.

---

## 4. Dimension 2 — Tool-Calling Reliability

### What is strong
- **Retry with provider-aware backoff:** `guard/retry.ts` extracts `Retry-After`, `x-ratelimit-reset-*`, and Anthropic reset headers, and skips retry on 4xx/validation.
- **Per-tool timeout** via `Promise.race` with correct cleanup in `finally`.
- **Guardrail gate before execution** (`checkToolCall`), allowlists, and HITL approval/suspend flows.
- **Parallel dispatch** in `agentic/runner.ts` with deterministic ordering restored to the message history.

### Gaps

**GAP-2.1 — Args are not schema-validated before execution.**
`Tool.parameters` exists, but the core runner path passes raw `tc.arguments` to `tool.execute` without Zod validation. Malformed args from the LLM hit the tool and produce opaque errors.

**GAP-2.2 — Sequential dispatch in core runner.**
`agent-runner.ts:_dispatchTools` uses a `for` loop; parallelizable tool calls add `k × avgLatency` sequentially instead of `max(latency)`.

**GAP-2.3 — Timeout vs. failure is collapsed into a string.**
Tool errors are folded into `"Error: <msg>"` in the tool message, so the model cannot distinguish a transient timeout (retryable) from a permanent validation failure.

**GAP-2.4 — No idempotency / memoization for side-effect-free tools.**
Repeated identical calls (e.g. `calculator.add(1,2)`) re-execute. No cache keying by `(tool, args)`.

### Fixes

**FIX-2.1 — Zod argument validation as a middleware.**
Validate `tc.arguments` against `parameters` (or a supplied Zod schema) before `execute`; on failure, emit a structured `ToolValidationError` tool result instead of throwing.

**FIX-2.2 — Parallelize dispatch in the core runner** (align with agentic) and only serialize when a tool declares `serial: true` (dependency ordering).

**FIX-2.3 — Structured tool-result envelope.**
Return a discriminated result `{ ok, output } | { ok:false, code:'TIMEOUT'|'VALIDATION'|'PROVIDER', retryable }` so the model (and observability) can act on failure type.

**FIX-2.4 — Tool memoization.**
Add an optional `idempotent: true` flag on `Tool`; the runner caches results by a deterministic hash of `(name, args)` within a run (and optionally a TTL cross-run cache).

---

## 5. Dimension 3 — System Stability & Error Handling

### What is strong
- **Canonical error taxonomy** (`PersonaForgeError`, `ERROR_CODES[40]`, `retryable` flag, structured `context` + `toJSON`).
- **Monadic `Result<T,E>`** for tools/agents that prefer returning over throwing.
- **Circuit breaker** (sliding window, half-open recovery), **rate limiter** (token bucket with queue/reject), **graceful shutdown**, **health checks**.
- **Transient-only retry classification** in `guard/retry.ts`.

### Gaps

**GAP-3.1 — Default-transient retry fallback (HIGH).**
`agent-runner.ts:59`: `const transient = guard?.isTransientLLMError?.(err) ?? true;` — when the optional `guard` peer dep is absent, **every** error is treated as transient, so 4xx validation failures are retried pointlessly (and paying per attempt).

**GAP-3.2 — Inconsistent error contract (throw vs. return).**
`base-agent.ts:runWithContext` catches everything and returns an `AgentOutput` with `state: FAILED`, while `agentic/runner.ts` *throws* `LLMError`. Callers cannot rely on one convention.

**GAP-3.3 — Silent `.catch(() => undefined)` everywhere.**
Checkpoint saves, suspension persistence, and recorder calls swallow errors for availability but erase the failure signal from observability.

**GAP-3.4 — Circuit-breaker window is an O(n) array.**
`recordFailure`/`pruneOldFailures` filter the array on each failure — O(n) per failure; a time-bucketed counter would be O(1).

### Fixes

**FIX-3.1 — Never default to transient.**
Replace the `?? true` fallback with a conservative built-in `isTransientLLMError` (copy the shared helper into the runner module) so absence of the peer dep degrades *safely*.

**FIX-3.2 — Establish one contract at the boundary.**
Document and enforce: *runners throw typed errors; the HTTP/adapter boundary converts to `Result`. In `runWithContext`, re-throw after invoking `onError` instead of silently returning a FAILED output (or expose an `unwrap()` path).

**FIX-3.3 — Structured soft-failure logging.**
Replace bare `.catch(() => undefined)` with a `reportSoftFailure(err, { op: 'checkpoint' })` that logs a warning + increments a counter, without failing the run.

**FIX-3.4 — O(1) time-bucketed circuit window.**
Swap the `FailureRecord[]` for a ring buffer of fixed time buckets; count successes/failures per bucket for constant-time `getFailureCount()`.

---

## 6. Dimension 4 — Scalability & High-Throughput Performance

### What is strong
- **Concurrency primitives:** `Semaphore` + `ConcurrencyLimiter` for bounded parallelism and load-shedding.
- **WorkerPool:** logical Promise-based scheduler with O(1) dequeue (head pointer + compaction) and idle worker scaling — appropriate for I/O-bound orchestration.
- **Pluggable persistence:** Redis session store, Postgres/Mongo learning stores.
- **Cardinality-conscious metrics** (uses `budgetModelId` label, not per-run id).

### Gaps

**GAP-4.1 — In-memory store is the default.**
`Agent` defaults to `InMemorySessionStore`; multiple processes each keep their own copy — no shared session state, no sticky-session handling.

**GAP-4.2 — No end-to-end backpressure.**
`ConcurrencyLimiter.isOverloaded` exposes queue depth, but nothing upstream (HTTP server, gateway) consumes it to reject/shed load at admission time.

**GAP-4.3 — No LLM response cache / coalescing.**
Identical or near-identical prompts are not deduplicated; no request coalescing for hot keys.

**GAP-4.4 — Cost tracking is keyed to agent name, not model.**
`agent-runner.ts:302` calls `estimateCost(this.config.name, …)` where `name` is the agent name — pricing lookup by model id would be correct.

**GAP-4.5 — Distributed tracing not confirmed end-to-end.**
`traceId`/`runId` exist on run options but W3C trace-context propagation into provider SDKs is not verified in the hot path.

### Fixes

**FIX-4.1 — Make the default store explicit and production-oriented.**
Emit a warning when an in-memory store is used in a non-dev environment; document Redis as the multi-node default. Add a connection-pooled Redis client abstraction (already present in `session/redis-store.ts`).

**FIX-4.2 — Admission control hook.**
Expose a `getLoadShedDecision()` on the runner/gateway that rejects early when `isOverloaded` or circuit is open, returning `HTTP 503` + `Retry-After` instead of queuing unboundedly.

**FIX-4.3 — Response cache + request coalescing.**
Add a pluggable `CacheStore` keyed by a normalized `(model, system, messages)` hash; coalesce identical in-flight requests with a `Map<key, Promise>`.

**FIX-4.4 — Correct the cost key.**
Thread the actual `model` id (from the provider result) into `estimateCost`, falling back to the configured default model.

**FIX-4.5 — Verify/adopt W3C trace context.**
Ensure `traceId` seeds a `SpanContext` and is injected into provider SDK request headers for cross-service correlation.

---

## 6b. Dimension 5 — Provider & AI SDK Adapter Coverage

The earlier dimensions audit the loop and resilience core. This dimension audits the **provider adapter surface** (the entire `providers/` module), which the rest of this report only touched for OpenAI/Anthropic.

### Provider census (shipped surface)

| Class | Adapters | Location |
|-------|----------|----------|
| Native SDK | OpenAI, Anthropic, Google (Gemini), Bedrock Converse, OpenAI Embeddings, Voice (OpenAI + ElevenLabs) | `openai-provider.ts`, `anthropic-provider.ts`, `google-provider.ts`, `bedrock-provider.ts`, `openai-embedding-provider.ts`, `voice/*` |
| OpenAI-compatible factories (~45) | Groq, xAI, Together, Fireworks, DeepSeek, Mistral, Cohere, Perplexity, Azure OpenAI, Cerebras, SambaNova, NVIDIA, AI21, Hyperbolic, Lambda, Moonshot, DashScope, Zhipu, Yi, Upstage, Novita, Cloudflare, Writer, DeepInfra, HuggingFace, Lepton, Featherless, Snowflake, vLLM, LM Studio, Hunyuan, Volcengine, MiniMax, Baichuan, Stepfun, InternLM, Replicate, RunPod, Watsonx, LocalAI, Kobold, TextGenWebUI, Jan | `compat-providers.ts` |
| Gateways / meta | OpenRouter, FallbackChainProvider, LLMRouter, LLMCache | `openrouter-provider.ts`, `fallback-chain.ts`, `router.ts`, `cache.ts` |
| AI SDK adapter | `createAiSdkProvider` → any `@ai-sdk/*` model (~300 providers) | `ai-sdk-provider.ts` |

Every adapter implements the same `LLMProvider` interface and collapses SDK-specific finish-reason vocabularies through one `normalizeFinishReason` (`types.ts:80`).

### What is strong
- **Single swap-able interface:** provider choice is a one-line change in `createAgent()`.
- **Uniform finish-reason normalisation** across OpenAI/Anthropic/Google/Bedrock vocabularies.
- **ESM-safe peer-dependency loading** via `createRequire` in the native adapters; the OpenAI client is constructed lazily on the first call.
- **Retry classification retains SDK context:** `rethrowWithStatus` normalises `.status`/`.headers` so the retry layer can read `Retry-After` / rate-limit headers for OpenAI and Anthropic errors.
- **AI SDK adapter** keeps personforge's own tool/guardrail/cost/HITL loop and delegates only the transport protocol layer.

### Gaps

**GAP-5.1 — AI SDK adapter drops assistant tool-call history (HIGH).**
`pfToAiMessages` pushes assistant messages as **text only**; the `tool-call` parts branch is unimplemented (`ai-sdk-provider.ts:221-227`, with a comment admitting it). Multi-turn ReAct loops then emit `tool` messages whose `toolCallId` was never declared to the model → providers reject the round or fail to pair results.

**GAP-5.2 — Tool-result field-name mismatch between the two runners.**
`core/runner/agent-runner.ts:617` emits `{ tool_call_id, name }` while `agentic/runner.ts:1441` emits `{ toolCallId }` and sets no `name`. Native adapters read `toolMsg.toolCallId` (`openai-provider.ts:114`, `anthropic-provider.ts:119`); the AI SDK adapter reads `msg.tool_call_id`/`msg.name` (`ai-sdk-provider.ts:230-235`). One runner always loses the tool id/name for the other set of adapters → `''` / `'unknown'` in provider payloads. The duplicated `Message` type (`tool_call_id` in `core/types.ts` vs `toolCallId` in `contracts/interfaces.ts`) is the root cause.

**GAP-5.3 — AI SDK stream tool-call args parsed as standalone JSON per delta (HIGH).**
`collectStreamToResult` calls `JSON.parse(value.argsTextDelta)` on every `tool-call-delta` fragment (`ai-sdk-provider.ts:354-368`). Providers stream *incremental* fragments (e.g. `{"city":"`), which are not valid JSON on their own → `SyntaxError` aborts the stream. The OpenAI/Anthropic adapters correctly accumulate the raw string and parse once at the end.

**GAP-5.4 — Bedrock is text-only and tool-free (HIGH).**
`bedrock-provider.ts` header states "Tool / multimodal messages are not mapped yet". Tool results are folded into a `[tool result]` text block and assistant tool calls are flattened to text. Any agent with tools on Bedrock cannot actually execute the tool loop. Also: no `AbortSignal` is threaded into Converse, `streamText` always returns `finishReason: 'stop'`, and stream usage is never captured.

**GAP-5.5 — Gemini tool-call IDs are fabricated, not stable (MED).**
`google-provider.ts:193` mints `id = \`${name}-${Date.now()}\``. Two parallel calls in one response share the same millisecond → duplicate IDs; results in `functionResponse` are keyed by name, so parallel same-name calls collide. No `AbortSignal` is passed to `generateContent`/`generateContentStream` either, so run deadline/abort does not cancel Gemini requests.

**GAP-5.6 — Feature-parity gaps across adapters (MED).**
- `toolChoice`: OpenAI collapses `required` and `{type:'tool'}` to `auto` (`openai-provider.ts:213`); Anthropic never sends `tool_choice`; Gemini ignores it.
- Anthropic ignores `GenerateOptions.stop` (no `stop_sequences`); Gemini `streamText` silently drops `stopSequences` present in `generateText`.
- Multi-system-message handling differs: Anthropic keeps only the last system message; the AI SDK adapter emits one `system` message per entry (several providers accept only one).
- The AI SDK adapter flattens `image`/`file` content parts to `JSON.stringify(...)` text (`contentToParts`, `ai-sdk-provider.ts:270-274`), silently losing multimodal input.

**GAP-5.7 — OpenAI-compatible wave is a base-URL shim with no capability tuning (MED).**
All ~45 factories are `new OpenAIProvider({ baseURL })` swaps (`compat-providers.ts:38-46`). Provider-unique features are unrepresentable: reasoning-effort / thinking budgets (DeepSeek-R1, Qwen/GLM reasoning, Hunyuan), JSON-mode / `response_format` (Cohere, Perplexity sonar, Mistral structured), `thinking` flags, and custom request headers (e.g. DashScope `X-DashScope`, Azure `api-key` conventions). The guaranteed working contract is only the narrowest OpenAI-common denominator, so "supported provider" overstates real feature coverage.

**GAP-5.8 — Embedding coverage is OpenAI-only (MED).**
`openai-embedding-provider.ts` is the sole embedding adapter. RAG / agentic memory (learning/) are locked to OpenAI embeddings even when chat runs on another provider — a hard coupling for Bedrock/Gemini-only deployments.

**GAP-5.9 — Model metadata is thin for the long tail (MED).**
`MODEL_PRICING` covers a curated set; dozens of compat model IDs fall back to `__default__` (`cost-tracker.ts:197`), so cost metrics undercount for Groq/Cerebras/Chinese/VLLM models — compounding GAP-4.4.

**GAP-5.10 — Trace headers are defined but never sent (MED).**
`GenerateOptions.headers` (`contracts/interfaces.ts:60`) is plumbed by no adapter — OpenAI/Anthropic request options carry only `signal` — and the AI SDK adapter's call options have no headers field at all. GAP-4.5 is confirmed **unaddressed at the provider layer**.

### Fixes

**FIX-5.1 — Emit assistant tool-call parts + correct tool-result mapping in the AI SDK adapter (P0).**
Map `Message.toolCalls` → AI SDK `tool-call` parts; read the runner's canonical tool-result id/name consistently; add a round-trip unit test. (M)

**FIX-5.2 — Accumulate `argsTextDelta` as raw string, parse once on `finish` (P0).**
Mirror `openai-provider.ts:309-352`. Also default unknown/`other` finish reasons to `error`, not `stop`. (S)

**FIX-5.3 — Implement Bedrock tool mapping.**
Map `tool_use`/`tool_result` blocks with stable ids, thread `AbortSignal` into Converse, and capture per-block usage / stop reasons in `streamText`. (M)

**FIX-5.4 — Gemini: stable tool IDs + cancellation.**
Replace `Date.now()` ids with a monotonic counter; forward `options.signal` into `generateContent(…, { signal })` / stream; honor `toolChoice`. (M)

**FIX-5.5 — Provider capability matrix for the compat wave.**
Per-provider capability flags (thinking, JSON mode, multi-image, headers, toolChoice modes) with graceful degradation and a conformance test per factory. (L)

**FIX-5.6 — Embedding provider abstraction.**
Define `EmbeddingProvider` and ship non-OpenAI adapters (Anthropic, Bedrock, Cohere, Gemini, Azure) so RAG/memory are not OpenAI-coupled. (M)

**FIX-5.7 — Cost/context metadata for the long tail.**
Fold provider pricing + context limits (incl. `__default__` compliance floor) into `cost-tracker.ts` / `context-window-manager.ts` so no adapter silently undercounts. (M)

**FIX-5.8 — Header pass-through for tracing.**
Forward `GenerateOptions.headers` in every adapter (OpenAI/Anthropic request opts + AI SDK `headers`) and inject the `traceparent` from GAP-4.5. (S)

---

## 7. Consolidated Gap Analysis → Fix Roadmap

Legend: **P0** (blocks production), **P1** (should fix before scale-out), **P2** (optimization/consolidation).

| # | Dimension | Gap | Sev | Effort | Fix |
|---|-----------|-----|-----|--------|-----|
| 1 | Robustness | No loop/progress detection | **P0** | S | Repeated-state detector + `loop_detected` |
| 2 | Reliability | Retry fallback defaults transient | **P0** | S | Conservative built-in `isTransientLLMError` |
| 3 | Error | Inconsistent throw/return contract | **P0** | M | Single throw-at-boundary convention |
| 4 | Reliability | Args not schema-validated pre-exec | **P0** | M | Zod arg middleware |
| 5 | Robustness | Two divergent loop impls | **P1** | L | Unify on `agentic/runner`, shim the legacy |
| 6 | Scalability | In-memory store default (no shared state) | **P1** | M | Dev-mode guard + Redis default |
| 7 | Scalability | No admission control / backpressure | **P1** | M | Load-shed hook at gateway |
| 8 | Reliability | Sequential vs parallel dispatch inconsistent | **P1** | S | Parallelize core dispatch |
| 9 | Error | Silent `.catch(() => undefined)` | **P1** | S | `reportSoftFailure` logging |
| 10 | Scalability | Cost tracking keyed by agent name | **P2** | S | Key by model id |
| 11 | Error | O(n) circuit window | **P2** | S | Time-bucketed ring buffer |
| 12 | Reliability | No tool memoization | **P2** | M | Idempotent-tool cache |
| 13 | Scalability | No LLM response cache/coalescing | **P2** | L | CacheStore + in-flight dedupe |
| 14 | Robustness | Nominal (unguarded) state machine | **P2** | M | Validated transition table |
| 15 | Scalability | W3C trace propagation unverified | **P2** | M | Confirm/inject trace headers |
| 16 | Provider | AI SDK adapter drops assistant tool-call history | **P0** | M | Emit tool-call parts + round-trip test (FIX-5.1) |
| 17 | Provider | AI SDK stream args parsed as JSON per delta | **P0** | S | Accumulate raw, parse on finish (FIX-5.2) |
| 18 | Provider | Tool-result id/name mismatch across runners | **P0** | M | Unify `Message` tool fields; read consistently (FIX-5.1) |
| 19 | Provider | Bedrock text-only, no tools/abort | **P1** | M | Tool mapping + signal + stream usage (FIX-5.3) |
| 20 | Provider | Gemini fabricated tool IDs, no abort | **P1** | M | Counter ids + signal + toolChoice (FIX-5.4) |
| 21 | Provider | Compat wave is a URL shim (no thinking/JSON/headers) | **P1** | L | Provider capability matrix (FIX-5.5) |
| 22 | Provider | Embeddings OpenAI-only coupling | **P1** | M | EmbeddingProvider abstraction + adapters (FIX-5.6) |
| 23 | Provider | Cost/context metadata thin for long tail | **P2** | M | Fold pricing + context limits, `__default__` floor (FIX-5.7) |
| 24 | Provider | `GenerateOptions.headers` never sent | **P2** | S | Header pass-through + traceparent (FIX-5.8) |

---

## 8. Recommended Phasing

Legend: **P0** (blocks production), **P1** (before scale-out), **P2** (optimization).

1. **Phase 1 — Correctness (P0):** Items 1–4 and 16–18. Ship loop detection, safe retry defaults, one error contract, arg validation, and the provider adapter correctness fixes (AI SDK tool history/stream args, tool-result field unification). These are the only true production blockers — and 16–18 break solver/tool loops for every AI-SDK-backed and cross-runner agent.
2. **Phase 2 — Scale-out readiness (P1):** Items 5–9 and 19–22. Consolidate the loop, adopt shared-state stores, add admission control, align dispatch, stop swallowing failures, and close the provider feature-parity gaps (Bedrock tools, Gemini IDs/abort, compat capability matrix, non-OpenAI embeddings).
3. **Phase 3 — World-class throughput (P2):** Items 10–15 and 23–24. Correct cost accounting, O(1) circuit windows, memoization, response caching, full distributed tracing, and long-tail provider metadata + header propagation.

> **Provider coverage note:** the framework ships **50+ provider entry points** (4 native SDKs + ~45 OpenAI-compatible factories + OpenRouter + AI SDK adapter). Feature parity is **not** uniform — only text + basic tool calling is guaranteed across the compat wave; streaming/multimodal/reasoning/JSON mode and tracing are adapter-specific. Any "X is supported" claim in the README/docs should be scoped to the capability matrix from FIX-5.5.

---

## 9. Fix Status (2026-08-18)

> **Important:** this audit initially reported several items that were **already
> implemented** on branch `fix/production-hardening-review` by a prior session
> (the report was written against an earlier snapshot). Every item below was
> **re-verified against current source with file:line evidence before any change**,
> and all remaining gaps were fixed with tests. Full suite: **196 files / 3088 tests green**;
> `tsc --noEmit` and `eslint src --max-warnings 0` both clean.

Legend: **✅ done** · **🔧 fixed this sweep** (2026-08-18) · **(→)** referenced fix.

| # | Gap | Status | Where / test |
|---|-----|--------|--------------|
| 1 | Loop detection | 🔧 agentic ported; core had it | `agentic/runner.ts` loop detector; `tests/agentic-hardening.test.ts` |
| 2 | Retry defaults transient | ✅ core `agent-runner.ts` + agentic `toGuardRetryPolicy` | pre-existing |
| 3 | throw/return error contract | 🔧 `BaseAgent.runWithContext` `throwOnError` opt-in | `core/base-agent.ts`; `tests/provider-adapter-hardening.test.ts` |
| 4 | Args not schema-validated | ✅ core `validateToolArgs` + agentic preflight | 🔧 `validateToolArgs` wired into agentic `_executeOneTool` |
| 5 | Two divergent loops | 🔧 `core/runner/agent-runner.ts` is now an 84-line **shim over `AgenticRunner`** | fixed `.ts` import + tool-registry/hooks adaptation |
| 6 | In-memory default (no warning) | ✅ `InMemorySessionStore` warns on `NODE_ENV=production` | pre-existing |
| 7 | Admission control | 🔧 agentic ported; core had it | `agentic/runner.ts` `admissionControl` → `LoadShedError` |
| 8 | Sequential vs parallel dispatch | ✅ both runners parallel (worker pool) | pre-existing |
| 9 | Silent `.catch(() => undefined)` | ✅ `_softFail`/`onSoftFailure` in both runners | pre-existing |
| 10 | Cost keyed by agent name | ✅ `budgetModelId` keyed, cardinality-bounded labels | pre-existing |
| 11 | O(n) circuit window | ✅ time-bucketed ring `FAILURE_BUCKETS=60` | `production/circuit-breaker.ts` |
| 12 | No tool memoization | 🔧 agentic ported; core (`tool.idempotent` memo) had it | `_executeOneTool` memo; `tests/agentic-hardening.test.ts` |
| 13 | No LLM cache/coalescing | 🔧 agentic got `responseCache` + in-flight coalescing; core had it | `_invokeLlm`; `tests/agentic-hardening.test.ts` |
| 14 | Unguarded state machine | ✅ `AGENT_TRANSITIONS` + `InvalidStateTransitionError` | `core/base-agent.ts`; `tests/base-agent-strict-state.test.ts` |
| 15 | W3C trace propagation | 🔧 agentic mints `traceparent`; core had it; **all adapters now forward headers** | `_invokeLlm` + provider headers; tests |
| 16 | AI SDK drops assistant tool-calls | 🔧 `pfToAiMessages` replays `tool-call` parts (flat + legacy) | `ai-sdk-provider.ts`; `tests/provider-adapter-hardening.test.ts` |
| 17 | AI SDK stream args per-delta JSON | 🔧 raw-string accumulation, parse once on finish; `other/unknown`→`error` | `collectStreamToResult` |
| 18 | Tool-result id/name mismatch | 🔧 runners emit `name`; all adapters read `toolCallId ?? tool_call_id` | openai/anthropic/ai-sdk/google/bedrock; tests |
| 19 | Bedrock tool-free / text-only | 🔧 full `toolUse`/`toolResult` mapping + abort + stream usage | `bedrock-provider.ts` rewrite; tests |
| 20 | Gemini fabricated ids / no abort | 🔧 monotonic ids, `toolChoice`→`toolConfig`, abort+headers | `google-provider.ts`; tests |
| 21 | Compat wave = URL shim | 🔧 `headers`/`extraBody` capability plumbing across compat factories | `openai-provider.ts` + `compat-providers.ts` |
| 22 | Embeddings OpenAI-only | 🔧 `EmbeddingProvider` interface + Google + Cohere adapters (OpenAI already satisfied) | `types-embedding.ts`, `google/cohere-embedding-provider.ts`; `tests/embeddings-providers.test.ts` |
| 23 | Cost metadata thin long tail | 🔧 +23 pricing / +27 context-limit entries + parity test | `cost-tracker.ts`, `context-window-manager.ts`; `tests/cost-metadata-longtail.test.ts` |
| 24 | `headers` never sent | 🔧 forwarded in OpenAI/Anthropic/Gemini/Bedrock + AI SDK call options | see 15/18/21 |

All 24 roadmap items are addressed; the remaining work is the longer-horizon hardening in §7 table (FIX-5.5 full per-provider conformance suite, FIX-2.3 structured tool-error envelope, cross-run memo TTL) that the audit flagged as optimization rather than blockers.
