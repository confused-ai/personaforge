# Design: Native Reasoning (Thinking-Token) Streaming

**Date:** 2026-09-15
**Status:** Design — awaiting review before planning.

---

## 1. Goal

Give agents production-grade support for provider-native "reasoning"/"thinking" tokens — Anthropic extended thinking, OpenAI o-series reasoning effort, Gemini thinking config, Bedrock Claude thinking, and local reasoning models (DeepSeek-R1 via Ollama) — plus the Vercel `ai` SDK path (`ai-sdk-provider.ts`), which already normalizes reasoning across the providers it wraps. Reasoning text streams as a first-class chunk type, accumulates into a shared buffer, and is consumable identically from the CLI, the SSE wire format, and durable replay. A repo-convention kill switch (`ENABLE_REASONING_STREAM`) turns it off everywhere with one flag.

This is **not** the same thing as `src/reasoning/*` (the ReWOO/ToT/GoT chain-of-thought *prompting* scaffold) or `ReasoningArtifact` (persisted thought storage). Those are unrelated and untouched by this work.

## 2. Non-goals (YAGNI)

- No new "governed HTTP" gateway. Investigation found none exists for outbound provider calls — each provider adapter already owns its own SDK client and HTTP path. Nothing to bypass; nothing to build to avoid a bypass.
- No changes to `src/reasoning/*` (CoT scaffold) or `ReasoningArtifact`. Naming collision is cosmetic — no code sharing.
- No redaction/decoding of Anthropic's `redacted_thinking` blocks. They pass through opaquely and get echoed back verbatim on the next turn, per Anthropic's API contract. We never attempt to render or interpret their content.
- No reasoning support for providers without a native reasoning API and not covered by the `ai` SDK (e.g. no fabricated reasoning for models that don't expose it).

## 3. Key findings (grounded in code)

1. **Two incompatible `StreamChunk` types share a name.** [`src/core/types.ts:155`](../../../src/core/types.ts#L155) is a real 6-variant discriminated union used by the abstract `Agent` interface. [`src/create-agent/types.ts:393`](../../../src/create-agent/types.ts#L393) is a looser 11-variant string union — the one actually implemented by `streamEvents()` and wired to SSE (`src/serve/data-stream.ts`) and durable replay (`src/durable/registry.ts`). No exhaustive switch/`never` guard enforces parity between them today — they have already silently drifted.
2. **No single outbound "governed HTTP" layer exists.** `src/gateway/` is inbound-only (exposes agents to callers, not the reverse). Each provider adapter (`anthropic-provider.ts`, `openai-provider.ts`, `google-provider.ts`, etc.) builds its own SDK client and calls it directly.
3. **Zero native reasoning support today.** No `thinking` param in `AnthropicCreateParams` ([`anthropic-provider.ts:50`](../../../src/providers/anthropic-provider.ts#L50)); OpenAI adapter only has a generic `extraBody` escape hatch; `ai-sdk-provider.ts` has no reasoning wiring despite the underlying `ai` package supporting reasoning parts.
4. **No `AI_*` env flags exist anywhere.** Convention is `ENABLE_<FEATURE>`, default-on via `!== 'false'`, centralized in [`src/config/loader.ts:86`](../../../src/config/loader.ts#L86) (`ENABLE_METRICS`, `ENABLE_GUARDRAILS`, `ENABLE_RATE_LIMITING`, `CIRCUIT_BREAKER_ENABLED`).
5. **No transcript/activity accumulator exists.** CLI chat ([`src/cli/commands/chat.ts:20`](../../../src/cli/commands/chat.ts#L20)) does raw `readline`/`stdout` writes. Nothing buffers streamed content into an assembled shape today outside of the final `AgentRunResult`.

## 4. Data model

- **Unify `StreamChunk`.** `src/core/types.ts`'s union becomes the single source of truth; `src/create-agent/types.ts` re-exports/extends it instead of maintaining a parallel shape. Add one new variant: `'reasoning-delta'` (mirrors the existing `'text-delta'` naming), carrying `reasoningDelta?: string` and an optional `reasoningTitle?: string` for providers that label reasoning segments (OpenAI's summary segments).
- **`Message`** ([`src/core/types.ts:55`](../../../src/core/types.ts#L55)) gains `reasoning?: { text: string; title?: string }[]` — an array because providers can emit multiple thinking blocks per turn, and because Anthropic requires reasoning blocks to be echoed back verbatim on subsequent turns for tool-use continuation.
- **`AgentRunResult`** ([`src/core/types.ts:90`](../../../src/core/types.ts#L90)) gains `readonly reasoningText?: string` — the flattened, accumulated reasoning text for the whole run, for callers who don't want to walk `messages`.

## 5. Provider wiring

All providers gate reasoning at the **request-building step** — one check per provider, reading `ENABLE_REASONING_STREAM`, deciding whether to ask for thinking at all. Delta-handling code has no flag-awareness: if reasoning wasn't requested, no reasoning chunks are ever produced.

| Provider | Mechanism | Notes |
|---|---|---|
| `ai-sdk-provider.ts` | Map the `ai` SDK's native reasoning-part stream events to our `reasoning-delta` | Thin translation only, no new HTTP logic — reuses the SDK's existing cross-provider normalization |
| `anthropic-provider.ts` | Add `thinking: { type: 'enabled', budget_tokens }` to `AnthropicCreateParams`; handle `thinking_delta` SSE events alongside existing text/tool deltas ([`anthropic-provider.ts:295`](../../../src/providers/anthropic-provider.ts#L295)) | `redacted_thinking` blocks stored opaquely, never rendered |
| `openai-provider.ts` | Add `reasoning_effort` for o-series models | OpenAI streams reasoning as discrete *summary* segments, not raw deltas — each segment becomes one `reasoning-delta` chunk, `reasoningTitle` set from the segment label when present |
| `google-provider.ts` / `src/models/google.ts` | Add `thinkingConfig.includeThoughts` | Map thought parts to `reasoning-delta` |
| `src/models/bedrock.ts` | Claude-on-Bedrock takes the same `thinking` param shape as direct Anthropic | Reuse the Anthropic mapping code — no duplicate implementation |
| `src/models/ollama.ts` | DeepSeek-R1-style models emit reasoning inline as `<think>...</think>` tags in the content stream, not a separate API field | Parse the tag out of the text stream and re-emit as `reasoning-delta`; must handle a tag boundary that doesn't align with a chunk boundary |

## 6. Accumulator

New module `src/streaming/reasoning-accumulator.ts`: one class, `push(runId, { text, title? })` appends to an in-progress buffer keyed by run, `flush(runId)` returns the assembled `{ text, title? }[]` and clears the buffer. It is a buffer, not a persistence layer.

Wired where `create-agent/factory.ts`'s `generate()` loop ([`factory.ts:1258`](../../../src/create-agent/factory.ts#L1258)) turns provider deltas into `StreamChunk`s: every `reasoning-delta` also feeds the accumulator; on `run-finish`, the flushed blocks populate `AgentRunResult.reasoningText` / `Message.reasoning`.

Three consumers read the same accumulated shape — no per-consumer reasoning logic:

- **CLI** ([`chat.ts:20`](../../../src/cli/commands/chat.ts#L20)): print reasoning deltas as they arrive, same stdout loop.
- **SSE** ([`data-stream.ts:27`](../../../src/serve/data-stream.ts#L27)): `reasoning-delta` gets one new case in the existing per-chunk-type switch.
- **Durable replay** ([`registry.ts:82`](../../../src/durable/registry.ts#L82)): `reasoning-delta` added to the replayable event types so a resumed run reconstructs reasoning text, not just tool/text history.

## 7. Kill switch

`ENABLE_REASONING_STREAM` added to [`src/config/loader.ts:86`](../../../src/config/loader.ts#L86), same `!== 'false'` default-on pattern as its neighbors. Read once per provider at request-building time (Section 5) — the single choke point. Off means no provider ever requests thinking tokens, so nothing downstream needs to know the flag exists.

## 8. Testing

- Per-provider unit tests: mocked SDK response with thinking/reasoning blocks → correct `reasoning-delta` chunks; flag off → no thinking param sent, no reasoning chunks.
- Accumulator unit test: interleaved `push()` across two concurrent runs → `flush()` returns correctly isolated, cleared buffers per run.
- One integration test extending `tests/streaming.test.ts` / `tests/learning-reasoning-context.test.ts`: full run with a mocked reasoning-capable provider → `AgentRunResult.reasoningText` and `Message.reasoning` populated; SSE stream carries `reasoning-delta`; durable replay reconstructs the same text.
- Focused Ollama test: `<think>` tag split across a chunk boundary still parses correctly — the one genuinely fiddly string-handling case in the feature.

## 9. Migration & compatibility

- `StreamChunk` unification is additive from the consumer side (new variant, no existing variants removed/renamed) but is a structural change to where the type is defined — anything importing the `create-agent/types.ts` copy directly needs to resolve to the unified type instead. No public API behavior change.
- `Message.reasoning` and `AgentRunResult.reasoningText` are new optional fields — existing callers unaffected.
- Default-on flag means reasoning-capable providers start requesting thinking tokens on upgrade unless `ENABLE_REASONING_STREAM=false` is set — this has a cost/latency impact (thinking tokens are billed and add latency) worth calling out in the changelog, not just the flag docs.
