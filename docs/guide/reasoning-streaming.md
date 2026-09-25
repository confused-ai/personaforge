---
title: Native Reasoning Streaming
description: Stream native chain-of-thought / thinking tokens from Anthropic, Bedrock, Gemini, Ollama, and OpenAI-compatible reasoning models through one interface.
outline: [2, 3]
---

# Native Reasoning Streaming

Several providers expose the model's own chain-of-thought as a distinct channel from the answer text — Anthropic extended thinking, Amazon Bedrock's Anthropic thinking config, Google Gemini thought summaries, Ollama's `think` mode, and the `reasoning_content` field used by DeepSeek, Groq, OpenRouter, vLLM, and other OpenAI-compatible endpoints. This framework surfaces all of them through the same `LLMProvider` interface — you don't need a provider-specific code path to read a model's reasoning.

> This is distinct from the [Reasoning (CoT)](./reasoning) module, which is a framework-level `ReasoningManager` that drives multi-step loops on top of *any* model. Native reasoning streaming instead surfaces the thinking tokens a model itself produces when it supports it.

## Reading reasoning

```ts
import { createAgent, AnthropicProvider } from 'personaforge';

const agent = createAgent({
  name: 'prover',
  llm: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
});

const result = await agent.run('Prove that sqrt(2) is irrational.', {
  onReasoning: (delta) => process.stdout.write(delta.text),
});

console.log(result.reasoningText);   // full reasoning text, accumulated
console.log(result.reasoning);       // { text, title?, signature?, redacted? }[]
```

- `GenerateOptions.onReasoning` — called with each reasoning delta as it streams.
- `GenerateResult.reasoning` — the full array of reasoning blocks once generation finishes.
- `Message.reasoning` and `AgentRunResult.reasoningText` — reasoning captured by the agentic runner, available on the final result and in session/message history for the current run.
- `streamEvents()` and the SSE data-stream wire format emit `reasoning-delta` events (`reasoningDelta` for text, `reasoningTitle` for a summary heading) alongside the normal token stream.
- The CLI `chat` command prints `[Reasoning: …]` before the assistant's reply whenever the active model returns reasoning.

## Per-provider support

| Provider | Reasoning source | Enable | Notes |
|---|---|---|---|
| **Anthropic** | Extended thinking — adaptive + summarized display on current models; budget thinking on Claude 3.7 and 4.0–4.5 | On by default | Omits the caller's `temperature` whenever thinking is requested; signed/redacted thinking blocks are round-tripped automatically in tool loops |
| **Amazon Bedrock** | Same Anthropic thinking config, via Bedrock's Anthropic models | On by default | |
| **Google Gemini** | Thought summaries | On by default for 2.5+/3 text models | Excludes image, TTS, live, embedding, and native-audio variants; `thoughtSignature` round-trips on function calls |
| **Ollama** | Native `think` | Automatic for known thinking-capable model families, or force with `ollama({ think: true })` | |
| **OpenAI-compatible** (`deepseek:`, `ollama:`, `groq:`, `openrouter:`, vLLM, Azure) | `reasoning_content` / `reasoning` response fields | On by default | Applies to any model string routed through `OpenAIProvider` |
| **OpenAI** (default `api.openai.com` endpoint) | Responses API reasoning summaries | Automatic for tool-free `o1` / `o3` / `o4` / `gpt-5` calls | Delivered once per turn, not streamed incrementally; calls with tools, `extraBody`, `stop`, or non-text content stay on Chat Completions and get no reasoning |
| **AI SDK v4 models** (`@ai-sdk/*`) | `reasoning`, `reasoning-signature`, `redacted-reasoning` parts | On by default | Mapped straight onto `onReasoning` / `result.reasoning` |

## The kill switch

Reasoning streaming is on by default. Turn it off globally with the `ENABLE_REASONING_STREAM` flag:

```ts
import { ENABLE_REASONING_STREAM } from 'personaforge';

// or set the env var before your process starts
process.env.ENABLE_REASONING_STREAM = 'false';
```

With the flag off, providers behave exactly as they did before this feature shipped — no thinking requested, no `onReasoning` calls, no `reasoning-delta` events.

## Cost and latency

Requesting thinking is not free:

- Anthropic thinking (adaptive or budget) consumes part of `max_tokens`; older-model budget thinking uses at most half of `max_tokens`, capped at 4096 — raise `maxTokens` if you need long final answers alongside reasoning.
- Thinking tokens are billed by the provider and add latency, since the model generates them before the visible answer.
- Anthropic 3.7 / 4.x / 5 models omit the caller's `temperature` whenever thinking is sent, since thinking and custom temperature are mutually exclusive on those models.
- OpenAI `o1`/`o3`/`o4`/`gpt-5` calls that qualify for the Responses API additionally set `store: false` and request reasoning summaries.

## Known limitations

- Reasoning is not persisted in session or memory stores between runs — it's available on the run/message that produced it, not on replay from storage.
- OpenAI Responses-API reasoning is delivered once per turn rather than streamed; OpenAI reasoning models called *with* tools get no reasoning text; OpenRouter-prefixed ids (e.g. `openai/o3`) aren't recognized as reasoning models.
- Anthropic reasoning is silently skipped (the request still succeeds) when the last assistant tool-use turn in history has no signed thinking block — for example, history imported from another provider, or a resumed tool call.
- The suspend/approval store does not persist Gemini's `thoughtSignature`, so a Gemini 3 tool run resumed from a suspended approval may fail on its next tool step.
- The standalone `anthropic()` adapter under `src/models/` has no reasoning support (use the `AnthropicProvider` class, or a model string backed by it); env auto-detect defaults (`claude-3-5-sonnet-20241022`, `gemini-2.0-flash`) don't request thinking; unlisted Claude/Gemini/Ollama model names get no reasoning until their classifiers are extended.
- `create-agent`'s `StreamChunk` interface is still separate from the core `StreamChunk` union — reasoning fields are mapped onto it but the two types haven't been unified.

See the [changelog](../changelog) for the complete list of fixes shipped with this feature.

## Where to go next

- [Providers](./providers#reasoning-thinking-token-streaming) — provider setup and the same support matrix in context.
- [Reasoning (CoT)](./reasoning) — framework-level multi-step reasoning loops, independent of native model thinking.
- [Event Streaming](./event-streaming) — consuming `reasoning-delta` alongside other stream event types.
