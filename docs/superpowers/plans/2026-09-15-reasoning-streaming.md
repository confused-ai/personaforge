# Reasoning (Thinking-Token) Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agents production-grade support for provider-native reasoning/thinking tokens — Anthropic extended thinking, OpenAI reasoning (Responses API) + `reasoning_effort` (Chat Completions), Gemini thinking, Bedrock Claude thinking, Ollama's native `think` field, and the `ai-sdk-provider.ts` path — surfaced through a unified `StreamChunk`/`StreamDelta`/`GenerateResult`/`AgentRunResult` type set, gated by one `ENABLE_REASONING_STREAM` kill switch.

**Architecture:** Reasoning has two carriers matching the two existing result shapes: a streaming `StreamDelta` variant (`type: 'reasoning'`) for `streamText`, and a `GenerateResult.reasoning` field for `generateText`/non-streaming providers. A new `onReasoning` hook threads alongside the existing `onChunk`/`onStep`/etc. hooks from each provider, through `AgenticStreamHooks`, into the agentic runner, which accumulates per-step reasoning into the assistant `Message.reasoning` and the final `AgentRunResult.reasoningText`. `create-agent/factory.ts`'s `streamEvents()` gets one more relayed event, `'reasoning-delta'`, added to a newly-unified `StreamChunk` type. SSE and durable replay carry it for free (both are generic pass-throughs already). The CLI prints the final accumulated `reasoningText`, since it doesn't stream today.

**Tech Stack:** TypeScript, Vitest (`bun test`), existing provider SDKs (`@anthropic-ai/sdk`, `openai`, `@google/generative-ai`, `@aws-sdk/client-bedrock-runtime`, `ollama`, Vercel `ai`).

**Spec:** [docs/superpowers/specs/2026-09-15-reasoning-streaming-design.md](../specs/2026-09-15-reasoning-streaming-design.md)

## Global Constraints

- Kill switch name/pattern: `ENABLE_REASONING_STREAM`, default-on, checked via `!== 'false'` (matches `ENABLE_METRICS`/`ENABLE_GUARDRAILS` convention).
- No new outbound HTTP gateway/bypass — every provider keeps calling its own SDK directly, just with new params.
- Do not touch `src/reasoning/*` (CoT scaffold) or `ReasoningArtifact` — unrelated, same-name coincidence only.
- Do not attempt to unify the three pre-existing, differently-shaped `Message` types in this codebase (`core/types.ts`, `contracts/interfaces.ts`, `llm-types.ts`-adjacent). Only `core/types.ts`'s `Message` (the one that actually flows through the provider adapters) gets the new `reasoning` field.
- Anthropic: when thinking is enabled, `temperature` MUST be forced to `1` (Anthropic API requirement) regardless of what the caller passed.
- Every new field is optional (`?`) — no existing call site breaks.

---

### Task 1: Streaming/result type plumbing (no behavior yet)

**Files:**
- Modify: `src/core/llm-types.ts:74` (StreamDelta union)
- Modify: `src/contracts/interfaces.ts:47` (GenerateOptions), `src/contracts/interfaces.ts` GenerateResult interface (same file, below line 74)
- Modify: `src/core/runner/types.ts:21` (RunnerStreamHooks)
- Test: `tests/coverage-providers-core.test.ts` (or nearest existing type-smoke test — see step 1)

**Interfaces:**
- Produces: `ReasoningStreamChunk` (`{ readonly type: 'reasoning'; readonly text: string; readonly title?: string }`), `StreamDelta = TextStreamChunk | StreamToolCallChunk | ReasoningStreamChunk`, `GenerateResult.reasoning?: { text: string; title?: string }[]`, `GenerateOptions.onReasoning?: (delta: { text: string; title?: string }) => void`, `RunnerStreamHooks.onReasoning?: (delta: { text: string; title?: string }) => void`.

- [ ] **Step 1: Locate an existing type-only smoke test to extend**

Run: `grep -n "StreamDelta\|GenerateResult" tests/coverage-providers-core.test.ts | head -5`

If this file doesn't construct `StreamDelta`/`GenerateResult` literals, that's fine — Step 6 below adds a fresh assertion there instead of requiring a pre-existing one.

- [ ] **Step 2: Add `ReasoningStreamChunk` to `src/core/llm-types.ts`**

Edit `src/core/llm-types.ts` around line 74:

```ts
/** A reasoning/thinking-token delta chunk from a streaming LLM response. */
export interface ReasoningStreamChunk {
    readonly type: 'reasoning';
    readonly text: string;
    readonly title?: string;
}

/** Union of all streaming delta types from an LLM provider. */
export type StreamDelta = TextStreamChunk | StreamToolCallChunk | ReasoningStreamChunk;
```

(Replaces the existing `export type StreamDelta = TextStreamChunk | StreamToolCallChunk;` line and inserts `ReasoningStreamChunk` above it.)

- [ ] **Step 3: Add `reasoning` to `GenerateResult` and `onReasoning` to `GenerateOptions` in `src/contracts/interfaces.ts`**

In the `GenerateResult` interface (below line 74, alongside `text`/`toolCalls`/`usage`):

```ts
export interface GenerateResult {
  text: string;
  toolCalls?: ToolCall[];
  finishReason?: 'stop' | 'tool_calls' | 'max_tokens' | 'error';
  /** Reasoning/thinking blocks produced alongside the text (when the provider and flag support it). */
  reasoning?: { text: string; title?: string }[];
  usage?: {
```

In `GenerateOptions` (line 47-58), add after `onChunk`:

```ts
  onChunk?: (chunk: string) => void;
  /** Emitted for each reasoning/thinking delta, separate from onChunk's plain text. */
  onReasoning?: (delta: { text: string; title?: string }) => void;
```

- [ ] **Step 4: Add `onReasoning` to `RunnerStreamHooks` in `src/core/runner/types.ts`**

```ts
export interface RunnerStreamHooks {
    onChunk?: (text: string) => void;
    onReasoning?: (delta: { text: string; title?: string }) => void;
    onToolCall?: (name: string, args: Record<string, unknown>) => void;
    onToolResult?: (name: string, result: unknown) => void;
    onStep?: (step: number) => void;
}
```

- [ ] **Step 5: Type-check**

Run: `bun run typecheck`
Expected: passes (all new fields are optional additions; nothing existing references them yet).

- [ ] **Step 6: Add a smoke test asserting the new shapes are constructible**

Add to `tests/coverage-providers-core.test.ts` (or create a new small `tests/reasoning-types.test.ts` if that file doesn't naturally fit):

```ts
import { describe, it, expect } from 'vitest';
import type { StreamDelta, GenerateResult } from '../src/core/index.js';

describe('reasoning type plumbing', () => {
    it('ReasoningStreamChunk is a valid StreamDelta', () => {
        const delta: StreamDelta = { type: 'reasoning', text: 'thinking...', title: 'Step 1' };
        expect(delta.type).toBe('reasoning');
    });

    it('GenerateResult accepts a reasoning array', () => {
        const result: GenerateResult = { text: 'answer', reasoning: [{ text: 'thinking...' }] };
        expect(result.reasoning?.[0]?.text).toBe('thinking...');
    });
});
```

- [ ] **Step 7: Run the test**

Run: `bun test tests/reasoning-types.test.ts` (or the file you extended)
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/core/llm-types.ts src/contracts/interfaces.ts src/core/runner/types.ts tests/reasoning-types.test.ts
git commit -m "feat(types): add reasoning StreamDelta/GenerateResult/onReasoning plumbing"
```

---

### Task 2: `Message.reasoning`, `AgentRunResult.reasoningText` (both copies), `StreamChunk` unification

**Files:**
- Modify: `src/core/types.ts:55` (Message), `src/core/types.ts:90` (AgentRunResult), `src/core/types.ts:155` (StreamChunk)
- Modify: `src/agentic/types.ts:145` (AgenticRunResult), and the `AgenticStreamHooks` block (same file, near `onGoal`/`onObject`)
- Modify: `src/create-agent/types.ts:323` (AgentRunOptions), `src/create-agent/types.ts:393` (StreamChunk)
- Test: `tests/reasoning-types.test.ts` (from Task 1)

**Interfaces:**
- Consumes: nothing from Task 1 directly (independent type file), but both land before Task 3.
- Produces: `Message.reasoning?: { text: string; title?: string }[]`, `AgentRunResult.reasoningText?: string` (core), `AgenticRunResult.reasoningText?: string`, `AgenticStreamHooks.onReasoning?: (delta: { text: string; title?: string }) => void`, `AgentRunOptions.onReasoning?: (delta: { text: string; title?: string }) => void`, unified `StreamChunk` with a `'reasoning-delta'` variant carrying `reasoningDelta?: string` and `reasoningTitle?: string`.

- [ ] **Step 1: Add `Message.reasoning` and `AgentRunResult.reasoningText` in `src/core/types.ts`**

```ts
export interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: MessageContent;
    tool_call_id?: string;
    tool_calls?: OpenAIToolCall[];
    name?: string;
    /** Reasoning/thinking blocks produced by the model alongside this message (assistant only). */
    reasoning?: { text: string; title?: string }[];
}
```

```ts
export interface AgentRunResult {
    readonly text: string;
    readonly markdown: { ... };            // unchanged
    readonly structuredOutput?: unknown;
    readonly messages: Message[];
    readonly steps: number;
    readonly finishReason: ...;
    readonly usage?: { ... };
    readonly costUsd?: number;
    readonly model?: string;
    readonly errorCode?: string;
    readonly runId?: string;
    /** Accumulated reasoning text for the whole run, flattened across steps. */
    readonly reasoningText?: string;
}
```

- [ ] **Step 2: Unify `StreamChunk` in `src/core/types.ts` (add the `reasoning-delta` variant)**

```ts
export type StreamChunk =
    | { type: 'text-delta';   delta: string }
    | { type: 'reasoning-delta'; reasoningDelta: string; reasoningTitle?: string }
    | { type: 'tool-call';    tool: { name: string; input: unknown } }
    | { type: 'tool-result';  tool: { name: string; input: unknown; output: unknown } }
    | { type: 'step-finish';  stepNumber: number }
    | { type: 'run-finish';   run: AgentRunResult }
    | { type: 'error';        error: Error };
```

- [ ] **Step 3: Add `reasoningText` to `AgenticRunResult` and `onReasoning` to `AgenticStreamHooks` in `src/agentic/types.ts`**

In `AgenticRunResult` (line 145 block), add after `traceId`:

```ts
    /** Trace ID when provided in config */
    readonly traceId?: string;
    /** Accumulated reasoning text for the whole run, flattened across steps. */
    readonly reasoningText?: string;
}
```

In `AgenticStreamHooks`, add after `onStep` (same block as `onGoal`/`onApproval`/`onSuspended`/`onTripwire`/`onObject`):

```ts
    onStep?: (step: number) => void;
    /** Emitted for each reasoning/thinking delta during a streamed step. */
    onReasoning?: (delta: { text: string; title?: string }) => void;
```

- [ ] **Step 4: Widen `create-agent/types.ts`'s `StreamChunk` to reuse the core union instead of duplicating it**

Replace the local `export interface StreamChunk { type: ...; delta?: string; ... }` (line 393-426) with an extension of the core type:

```ts
import type { StreamChunk as CoreStreamChunk } from '../core/types.js';

/**
 * Typed event emitted by `agent.streamEvents()`.
 *
 * Extends the core `StreamChunk` union with create-agent-specific event
 * kinds (approvals, suspension, tripwires, goals, structured output).
 */
export type StreamChunk =
    | CoreStreamChunk
    | { type: 'tool-call-approval'; approval: { toolCallId: string; toolName: string; args: Record<string, unknown>; requiresApproval: boolean } }
    | { type: 'tool-call-suspended'; suspend: { toolCallId?: string; toolName: string; args: Record<string, unknown>; suspendPayload: unknown } }
    | { type: 'tripwire'; tripwire: { processorId?: string; reason?: string; metadata?: unknown } }
    | { type: 'goal'; goal: import('../goals/index.js').GoalEvaluation }
    | { type: 'object-result'; object: unknown };
```

This is a discriminated union now (good — it wasn't one before), so every existing `const evt: StreamChunk = { type: 'text-delta', delta: chunk }`-style literal in `factory.ts` still type-checks unchanged, but code that does `chunk.tool` without narrowing `chunk.type` first will now correctly fail to compile if it ever did that unsafely. Expect to fix any such call sites surfaced by Step 6's typecheck (there should be none — `factory.ts`'s existing code already narrows by literal `type` per event).

- [ ] **Step 5: Add `onReasoning` to `AgentRunOptions` in `src/create-agent/types.ts`**

After line 330 (`onStep?: (step: number) => void;`):

```ts
    onStep?: (step: number) => void;
    /** Emitted for each reasoning/thinking delta during a streamed run. */
    onReasoning?: (delta: { text: string; title?: string }) => void;
```

- [ ] **Step 6: Type-check the whole project**

Run: `bun run typecheck`
Expected: passes. If `create-agent/types.ts`'s `DataStreamEvent` (in `src/serve/data-stream.ts`) or any other consumer breaks on the now-real discriminated union, fix that call site inline (there should be none yet — Task 5 is where `data-stream.ts` gets its own edit).

- [ ] **Step 7: Extend the smoke test**

Add to `tests/reasoning-types.test.ts`:

```ts
import type { Message, AgentRunResult, StreamChunk } from '../src/core/index.js';

it('Message accepts a reasoning array', () => {
    const m: Message = { role: 'assistant', content: 'answer', reasoning: [{ text: 'thinking...', title: 'Step 1' }] };
    expect(m.reasoning?.[0]?.title).toBe('Step 1');
});

it('StreamChunk has a reasoning-delta variant', () => {
    const chunk: StreamChunk = { type: 'reasoning-delta', reasoningDelta: 'hmm', reasoningTitle: 'Step 1' };
    expect(chunk.type).toBe('reasoning-delta');
});

it('AgentRunResult accepts reasoningText', () => {
    const r = { reasoningText: 'full reasoning' } as Partial<AgentRunResult>;
    expect(r.reasoningText).toBe('full reasoning');
});
```

- [ ] **Step 8: Run the tests**

Run: `bun test tests/reasoning-types.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/core/types.ts src/agentic/types.ts src/create-agent/types.ts tests/reasoning-types.test.ts
git commit -m "feat(types): unify StreamChunk and add reasoning fields to Message/AgentRunResult"
```

---

### Task 3: `ReasoningAccumulator` + `isReasoningStreamEnabled` utility

**Files:**
- Create: `src/streaming/reasoning-accumulator.ts`
- Test: `src/streaming/reasoning-accumulator.test.ts` (co-located, matches this module's small/pure-function nature — check `ls src/streaming/*.test.ts`; if the repo convention is tests-only-under-`tests/`, put it at `tests/reasoning-accumulator.test.ts` instead)

**Interfaces:**
- Consumes: nothing (pure utility, no imports from Tasks 1-2 needed).
- Produces: `class ReasoningAccumulator { push(block: { text: string; title?: string }): void; flush(): { text: string; title?: string }[] }`, `function isReasoningStreamEnabled(): boolean`.

- [ ] **Step 1: Check test-file convention**

Run: `find src/streaming -name "*.test.ts"`

If empty, put the test under `tests/reasoning-accumulator.test.ts` to match the rest of the suite.

- [ ] **Step 2: Write the failing test** (`tests/reasoning-accumulator.test.ts`)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReasoningAccumulator, isReasoningStreamEnabled } from '../src/streaming/reasoning-accumulator.js';

describe('ReasoningAccumulator', () => {
    it('accumulates pushed blocks and clears on flush', () => {
        const acc = new ReasoningAccumulator();
        acc.push({ text: 'first ' });
        acc.push({ text: 'second', title: 'Step 2' });
        expect(acc.flush()).toEqual([{ text: 'first ' }, { text: 'second', title: 'Step 2' }]);
        expect(acc.flush()).toEqual([]);
    });
});

describe('isReasoningStreamEnabled', () => {
    const ORIGINAL = process.env.ENABLE_REASONING_STREAM;
    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.ENABLE_REASONING_STREAM;
        else process.env.ENABLE_REASONING_STREAM = ORIGINAL;
    });

    it('defaults to enabled when unset', () => {
        delete process.env.ENABLE_REASONING_STREAM;
        expect(isReasoningStreamEnabled()).toBe(true);
    });

    it('is disabled only when explicitly set to "false"', () => {
        process.env.ENABLE_REASONING_STREAM = 'false';
        expect(isReasoningStreamEnabled()).toBe(false);
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/reasoning-accumulator.test.ts`
Expected: FAIL — `Cannot find module '../src/streaming/reasoning-accumulator.js'`

- [ ] **Step 4: Implement `src/streaming/reasoning-accumulator.ts`**

```ts
/**
 * Small in-memory buffer for reasoning/thinking-token blocks streamed
 * during one agent run or provider call. Instantiate one per call site —
 * there is no cross-instance shared state, so no run-id keying is needed.
 */
export class ReasoningAccumulator {
    private blocks: { text: string; title?: string }[] = [];

    push(block: { text: string; title?: string }): void {
        this.blocks.push(block);
    }

    /** Returns the accumulated blocks and clears the buffer. */
    flush(): { text: string; title?: string }[] {
        const out = this.blocks;
        this.blocks = [];
        return out;
    }
}

/** Repo-convention kill switch: `ENABLE_<FEATURE>`, default-on. */
export function isReasoningStreamEnabled(): boolean {
    return process.env.ENABLE_REASONING_STREAM !== 'false';
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/reasoning-accumulator.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/streaming/reasoning-accumulator.ts tests/reasoning-accumulator.test.ts
git commit -m "feat(streaming): add ReasoningAccumulator and ENABLE_REASONING_STREAM flag helper"
```

---

### Task 4: Wire the agentic runner (`src/agentic/runner.ts`) — accumulate reasoning per step, attach to Message and final result

**Files:**
- Modify: `src/agentic/runner.ts:819-830` (assistant message push), `src/agentic/runner.ts:1050-1070` (final result construction), `src/agentic/runner.ts:1416-1428` (`runLlm`/`streamText` call)
- Test: `tests/agentic-runner.test.ts` (existing — check `grep -n "streamHooks\|onChunk" tests/agentic-runner.test.ts` for the mocking pattern before writing new assertions)

**Interfaces:**
- Consumes: `ReasoningAccumulator` (Task 3), `onReasoning` on `RunnerStreamHooks`/`GenerateOptions` (Task 1), `AgenticStreamHooks.onReasoning` (Task 2), `Message.reasoning` / `AgenticRunResult.reasoningText` (Task 2), `GenerateResult.reasoning` (Task 1).
- Produces: the assistant `Message` pushed to `messages` now carries `reasoning` when the step produced any; `AgenticRunResult.reasoningText` is populated when any step produced reasoning.

- [ ] **Step 1: Read the existing mocking pattern**

Run: `grep -n "provider.streamText\|onChunk\|mockProvider\|LLMProvider" tests/agentic-runner.test.ts | head -20`

Match whatever mock-provider shape that file already uses for the new test in Step 6.

- [ ] **Step 2: Write the failing test**

Add to `tests/agentic-runner.test.ts` (adapt the mock-provider construction to match the file's existing helper if one exists; this shows the minimal shape needed):

```ts
it('accumulates streamed reasoning into the assistant message and final result', async () => {
    const provider: LLMProvider = {
        generateText: vi.fn(),
        streamText: vi.fn(async (_messages, options) => {
            options?.onReasoning?.({ text: 'because X', title: 'Step 1' });
            options?.onChunk?.('final answer');
            return { text: 'final answer', finishReason: 'stop' };
        }),
    };
    const runner = new AgenticRunner({ llm: provider, streamText: true /* match existing config field name */ } as never);
    const streamHooks = { onChunk: () => {} }; // onChunk present so the streaming path (`useStreaming`) is taken
    const result = await runner.run({ prompt: 'hi' } as never, streamHooks as never);

    const assistantMsg = result.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg?.reasoning).toEqual([{ text: 'because X', title: 'Step 1' }]);
    expect(result.reasoningText).toBe('because X');
});
```

(This test's exact `AgenticRunner` construction args must match the real constructor signature — read `class AgenticRunner` at the top of `src/agentic/runner.ts` for the actual `config` shape before finalizing; the assertions on `assistantMsg.reasoning` / `result.reasoningText` are what matters and won't change.)

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/agentic-runner.test.ts`
Expected: FAIL — `assistantMsg?.reasoning` is `undefined`, `result.reasoningText` is `undefined`.

- [ ] **Step 4: Wire `onReasoning` through `runLlm`'s `streamText` call and accumulate per step**

Near the top of the per-step loop where `let finishReason` / `let lastText` are declared (~line 675 area), add a per-step accumulator:

```ts
const reasoningAcc = new ReasoningAccumulator();
```

(Import: `import { ReasoningAccumulator } from '../streaming/reasoning-accumulator.js';` at the top of `runner.ts`.)

In `runLlm` (~line 1416-1428), pass `onReasoning` through to the provider and into the accumulator:

```ts
const runLlm = () => {
    if (useStreaming) {
        return provider.streamText!(llmMessages, {
            ...baseOpts,
            onChunk: (chunk: string | { type: string; text: string }) => {
                const text = typeof chunk === 'string' ? chunk : chunk.text;
                ctx.streamHooks!.onChunk!(text);
            },
            onReasoning: (delta: { text: string; title?: string }) => {
                reasoningAcc.push(delta);
                ctx.streamHooks?.onReasoning?.(delta);
            },
        });
    }
    return provider.generateText(llmMessages, baseOpts);
};
```

After `invoke()` resolves to `result: GenerateResult` (non-streaming path), also fold in any blocks it returned directly:

```ts
for (const block of result.reasoning ?? []) reasoningAcc.push(block);
```

(Place this right after the existing `await this.config.recorder?.llmResult({...})` call at line 811-817, before `hasToolCalls`.)

- [ ] **Step 5: Attach accumulated reasoning to the assistant message push (~line 824-830) and roll it into the run's total**

```ts
const stepReasoning = reasoningAcc.flush();
if (result.text || hasToolCalls) {
    messages.push({
        role: 'assistant',
        content: result.text ?? '',
        ...(hasToolCalls && { toolCalls: result.toolCalls }),
        ...(stepReasoning.length && { reasoning: stepReasoning }),
    } as Message & { toolCalls?: LLMToolCall[] });
}
```

Declare `let allReasoningText = '';` alongside the other per-run accumulators near `let finishReason` (~line 675), and after computing `stepReasoning` each step:

```ts
if (stepReasoning.length) allReasoningText += stepReasoning.map((b) => b.text).join('');
```

- [ ] **Step 6: Populate `AgenticRunResult.reasoningText` at the final result construction (~line 1050-1070)**

```ts
let finalResult: AgenticRunResult = {
    text: lastText,
    markdown: { ... },
    messages,
    steps,
    finishReason,
    usage,
    ...(costUsd !== undefined && { costUsd }),
    ...(modelName !== undefined && { model: modelName }),
    ...(runConfig.runId    && { runId:    runConfig.runId }),
    ...(runConfig.traceId  && { traceId:  runConfig.traceId }),
    ...(object !== undefined && { object }),
    ...(legacyStructured !== undefined && { structuredOutput: legacyStructured }),
    ...(tripwire && { tripwire }),
    ...(suspendPayload && { suspendPayload }),
    ...(allReasoningText && { reasoningText: allReasoningText }),
} as AgenticRunResult;
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun test tests/agentic-runner.test.ts`
Expected: PASS

- [ ] **Step 8: Run the full test suite to check for regressions in this heavily-shared file**

Run: `bun test tests/agentic-runner.test.ts tests/durable-agent.test.ts tests/e2e-agent.test.ts`
Expected: all PASS (these three exercise `runner.ts` most directly)

- [ ] **Step 9: Commit**

```bash
git add src/agentic/runner.ts tests/agentic-runner.test.ts
git commit -m "feat(runner): accumulate streamed/non-streamed reasoning into Message and AgenticRunResult"
```

---

### Task 5: Wire `create-agent/factory.ts` — `onReasoning` relay in `run()` and `streamEvents()`

**Files:**
- Modify: `src/create-agent/factory.ts:837-861` (`streamHooks` object inside `run()`), `src/create-agent/factory.ts:1258-1381` (`streamEvents()`'s `generate()`)
- Test: `tests/coverage-barrel-create-agent.test.ts` or `tests/streaming.test.ts` — check `grep -n "streamEvents" tests/*.test.ts` for the right home; if none directly test `streamEvents()`, add to `tests/coverage-create-agent-core.test.ts`.

**Interfaces:**
- Consumes: `AgenticStreamHooks.onReasoning` (Task 2), `AgentRunOptions.onReasoning` (Task 2), unified `StreamChunk`'s `'reasoning-delta'` variant (Task 2).
- Produces: `agent.run(prompt, { onReasoning })` fires for streamed reasoning; `agent.streamEvents(prompt)` yields `{ type: 'reasoning-delta', reasoningDelta, reasoningTitle }` chunks.

- [ ] **Step 1: Find the right existing test file**

Run: `grep -rln "streamEvents(" tests/*.test.ts`

- [ ] **Step 2: Write the failing test** (adapt import path to whichever file Step 1 found; example assumes `tests/coverage-create-agent-core.test.ts`)

```ts
it('streamEvents yields reasoning-delta chunks', async () => {
    const agent = createAgent({
        name: 'test',
        instructions: 'x',
        model: mockReasoningModel(), // use whatever this test file's existing mock-model helper is; it must call options.onReasoning
    });
    const events: unknown[] = [];
    for await (const ev of agent.streamEvents('hi')) events.push(ev);
    expect(events).toContainEqual(expect.objectContaining({ type: 'reasoning-delta', reasoningDelta: 'thinking...' }));
});
```

(If this file has no existing mock-model helper that exercises `streamText`'s `onReasoning`, build a minimal one following the file's existing pattern for mocking `onChunk`/`onStep` — same shape, one more callback invoked.)

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test <the test file>`
Expected: FAIL — no `reasoning-delta` event in `events`.

- [ ] **Step 4: Add `onReasoning` to the `streamHooks` object in `run()` (~line 837-861)**

```ts
const streamHooks: AgenticStreamHooks = {
    onChunk: (text: string) => { ... },        // unchanged
    onReasoning: (delta: { text: string; title?: string }) => {
        runLogger?.debug('agent.run: reasoning', { agentId: name }, { length: delta.text.length });
        runOptions?.onReasoning?.(delta);
    },
    onToolCall: (toolName: string, args: Record<string, unknown>) => { ... },  // unchanged
    ...
};
```

- [ ] **Step 5: Add the `onReasoning` relay inside `streamEvents()`'s `generate()` (~line 1258-1340), alongside the existing `onStep` block**

```ts
onStep: (stepNumber: number) => {
    const evt: StreamChunk = { type: 'step-finish', stepNumber };
    queue.push(evt);
    publish(evt);
    notify?.();
    notify = null;
},
onReasoning: (delta: { text: string; title?: string }) => {
    const evt: StreamChunk = { type: 'reasoning-delta', reasoningDelta: delta.text, ...(delta.title && { reasoningTitle: delta.title }) };
    queue.push(evt);
    publish(evt);
    notify?.();
    notify = null;
},
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test <the test file>`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/create-agent/factory.ts <the test file>
git commit -m "feat(create-agent): relay onReasoning through run() and streamEvents()"
```

---

### Task 6: SSE wire format (`src/serve/data-stream.ts`)

**Files:**
- Modify: `src/serve/data-stream.ts:33-70` (`DataStreamEvent`, `toWire`, `fromWire`)
- Test: check `grep -rln "toDataStream\|encodeSSE\|DataStreamEvent" tests/*.test.ts` for the existing test file (likely `tests/serve.test.ts` or similar); extend it.

**Interfaces:**
- Consumes: unified `StreamChunk`'s `'reasoning-delta'` variant (Task 2).
- Produces: `DataStreamEvent.reasoningDelta?: string`, `.reasoningTitle?: string`, round-tripped by `toWire`/`fromWire`.

- [ ] **Step 1: Find the existing test file**

Run: `grep -rln "toWire\|fromWire\|encodeSSE\|toDataStream" tests/*.test.ts`

- [ ] **Step 2: Write the failing test**

```ts
it('round-trips a reasoning-delta chunk through the wire format', () => {
    const chunk: StreamChunk = { type: 'reasoning-delta', reasoningDelta: 'because X', reasoningTitle: 'Step 1' };
    const wire = encodeSSE(chunk);
    expect(wire).toContain('"reasoningDelta":"because X"');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test <that file>`
Expected: FAIL — `toWire` drops the `reasoningDelta`/`reasoningTitle` fields (not copied by the current field list).

- [ ] **Step 4: Update `DataStreamEvent`, `toWire`, and `fromWire`**

```ts
export interface DataStreamEvent {
    type: StreamChunk['type'];
    delta?: string;
    reasoningDelta?: string;
    reasoningTitle?: string;
    tool?: { name: string; input: unknown; output?: unknown };
    stepNumber?: number;
    run?: StreamChunk['run'];
    error?: string;
}

function toWire(chunk: StreamChunk): DataStreamEvent {
    const ev: DataStreamEvent = { type: chunk.type };
    if (chunk.delta !== undefined) ev.delta = chunk.delta;
    if (chunk.reasoningDelta !== undefined) ev.reasoningDelta = chunk.reasoningDelta;
    if (chunk.reasoningTitle !== undefined) ev.reasoningTitle = chunk.reasoningTitle;
    if (chunk.tool !== undefined) ev.tool = chunk.tool;
    if (chunk.stepNumber !== undefined) ev.stepNumber = chunk.stepNumber;
    if (chunk.run !== undefined) ev.run = chunk.run;
    if (chunk.error !== undefined) ev.error = chunk.error.message;
    return ev;
}

function fromWire(ev: DataStreamEvent): StreamChunk {
    const chunk: StreamChunk = { type: ev.type };
    if (ev.delta !== undefined) chunk.delta = ev.delta;
    if (ev.reasoningDelta !== undefined) chunk.reasoningDelta = ev.reasoningDelta;
    if (ev.reasoningTitle !== undefined) chunk.reasoningTitle = ev.reasoningTitle;
    if (ev.tool !== undefined) chunk.tool = ev.tool;
    if (ev.stepNumber !== undefined) chunk.stepNumber = ev.stepNumber;
    if (ev.run !== undefined) chunk.run = ev.run;
    if (ev.error !== undefined) chunk.error = new Error(ev.error);
    return chunk;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test <that file>`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/serve/data-stream.ts <that test file>
git commit -m "feat(serve): carry reasoning-delta fields through the SSE wire format"
```

---

### Task 7: Durable replay verification (no code change expected)

**Files:**
- Test only: `tests/coverage-durable.test.ts` or `tests/durable-agent.test.ts` (check `grep -n "publish(" tests/*durable*.test.ts` for the right home)

**Interfaces:**
- Consumes: unified `StreamChunk` (Task 2), `DurableRunRegistry.publish()` (existing, `src/durable/registry.ts:148`).
- Produces: nothing new — this task exists to prove `DurableRunEvent extends StreamChunk` really does carry the new variant with zero code change, per the spec's Section 6 finding.

- [ ] **Step 1: Write the test**

```ts
it('publishes and replays a reasoning-delta event with no dedicated handling', async () => {
    const registry = new DurableRunRegistry();
    const handle = registry.create({ runId: 'r1', input: 'hi' });
    await registry.publish('r1', { type: 'reasoning-delta', reasoningDelta: 'because X' });
    expect(handle.events).toContainEqual(expect.objectContaining({ type: 'reasoning-delta', reasoningDelta: 'because X' }));
});
```

- [ ] **Step 2: Run it**

Run: `bun test <that file>`
Expected: PASS immediately (confirms the spec's claim — no implementation step needed here).

- [ ] **Step 3: Commit**

```bash
git add <that test file>
git commit -m "test(durable): verify reasoning-delta replays with no dedicated handling"
```

---

### Task 8: CLI (`src/cli/commands/chat.ts`) — print accumulated reasoning after each turn

**Files:**
- Modify: `src/cli/commands/chat.ts:76-94`
- Test: create `tests/cli-chat-reasoning.test.ts`, or check `grep -n "chat" tests/cli-run-watch.test.ts` first — if that file already covers `chat.ts`, extend it instead.

**Interfaces:**
- Consumes: `AgentRunResult.reasoningText` (Task 2).
- Produces: when `result.reasoningText` is present, prints it (prefixed) before the `Assistant:` line.

- [ ] **Step 1: Write the failing test**

```ts
it('prints reasoningText before the assistant line when present', async () => {
    // Mirror this file's existing pattern for mocking agent.run() — check
    // tests/cli-run-watch.test.ts for how it stubs defineAgent()/build().
    const output = await runChatTurnWithMockedResult({ text: 'final answer', reasoningText: 'because X' });
    expect(output).toContain('Reasoning: because X');
    expect(output).toContain('Assistant: final answer');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli-chat-reasoning.test.ts`
Expected: FAIL — no "Reasoning:" line printed.

- [ ] **Step 3: Update the `try` block in `chat.ts` (~line 76-90)**

```ts
try {
    const result = await agent.run(input, { sessionId });

    const text = (typeof result === 'object' && result !== null && 'text' in result)
        ? String((result as { text: unknown }).text)
        : typeof result === 'string'
            ? result
            : JSON.stringify(result, null, 2);

    const reasoningText = (typeof result === 'object' && result !== null && 'reasoningText' in result)
        ? String((result as { reasoningText?: unknown }).reasoningText ?? '')
        : '';
    if (reasoningText) {
        printLine(`\n[Reasoning: ${reasoningText}]`);
    }

    printLine(`\nAssistant: ${text}\n`);
} catch (err) {
    ...
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/cli-chat-reasoning.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/chat.ts tests/cli-chat-reasoning.test.ts
git commit -m "feat(cli): print accumulated reasoning text before the assistant response"
```

---

### Task 9: Anthropic provider — `thinking` param, forced `temperature: 1`, delta handling, `redacted_thinking` passthrough, history round-trip

**Files:**
- Modify: `src/providers/anthropic-provider.ts` (interfaces at lines 49-90, `toAnthropicMessages` at line 107, `generateText` at line 200, `streamText` at line 260)
- Test: `tests/coverage-providers-classes.test.ts` (existing `AnthropicProvider` `describe` block, lines 100-165)

**Interfaces:**
- Consumes: `isReasoningStreamEnabled()` (Task 3), `GenerateOptions.onReasoning` (Task 1), `Message.reasoning` (Task 2).
- Produces: when reasoning is enabled, `streamText` calls `onReasoning` for `thinking_delta` events and forces `temperature: 1`; `generateText` returns `result.reasoning` for non-streaming calls; `toAnthropicMessages` re-emits prior `Message.reasoning` blocks as `thinking` content blocks ordered first.

- [ ] **Step 1: Write the failing tests** (add to the existing `describe('providers/AnthropicProvider', ...)` block)

```ts
it('streamText forces temperature to 1 and requests thinking when enabled', async () => {
    async function* gen() {
        yield { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } };
        yield { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'because X' } };
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'answer' } };
        yield { type: 'message_delta', usage: { input_tokens: 1, output_tokens: 1 }, delta: { stop_reason: 'end_turn' } };
    }
    const iterable = { [Symbol.asyncIterator]: gen };
    const create = vi.fn().mockResolvedValue(iterable);
    const provider = new AnthropicProvider({ client: { messages: { create } } as never });
    const reasoningDeltas: { text: string }[] = [];
    const result = await provider.streamText(
        [{ role: 'user', content: 'x' }],
        { temperature: 0.2, onChunk: () => {}, onReasoning: (d) => reasoningDeltas.push(d) },
    );
    expect(result.text).toBe('answer');
    expect(reasoningDeltas).toEqual([{ text: 'because X' }]);
    const body = create.mock.calls[0]![0];
    expect(body.temperature).toBe(1);
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: expect.any(Number) });
});

it('does not request thinking when ENABLE_REASONING_STREAM=false', async () => {
    process.env.ENABLE_REASONING_STREAM = 'false';
    try {
        const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
        const provider = new AnthropicProvider({ client: { messages: { create } } as never });
        await provider.generateText([{ role: 'user', content: 'x' }]);
        const body = create.mock.calls[0]![0];
        expect(body.thinking).toBeUndefined();
    } finally {
        delete process.env.ENABLE_REASONING_STREAM;
    }
});

it('toAnthropicMessages re-emits prior reasoning as a leading thinking block', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
    const provider = new AnthropicProvider({ client: { messages: { create } } as never });
    await provider.generateText([
        { role: 'assistant', content: 'prev', reasoning: [{ text: 'because X' }] } as never,
        { role: 'user', content: 'follow up' },
    ]);
    const body = create.mock.calls[0]![0];
    expect(body.messages[0].content[0]).toEqual({ type: 'thinking', thinking: 'because X' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/coverage-providers-classes.test.ts`
Expected: all three new tests FAIL (no `thinking` param sent, no `onReasoning` fired, `body.temperature` still `0.2`).

- [ ] **Step 3: Add the `thinking` param and interface fields (lines 49-90)**

```ts
interface AnthropicCreateParams {
    model: string;
    max_tokens: number;
    system?: string;
    messages: AnthropicMessageParam[];
    tools?: AnthropicTool[];
    temperature?: number;
    stream?: boolean;
    thinking?: { type: 'enabled'; budget_tokens: number };
}
```

Add a module-level constant near the top of the file: `const DEFAULT_THINKING_BUDGET_TOKENS = 4096;`

Update the `AnthropicStreamEvent` interface's `content_block` and `delta` fields to allow `'thinking'` / `'redacted_thinking'` / `'thinking_delta'`:

```ts
interface AnthropicStreamEvent {
    type: string;
    index?: number;
    content_block?: { type: string; text?: string; id?: string; name?: string; data?: string };
    delta?: { type: string; text?: string; thinking?: string; partial_json?: string };
    usage?: { input_tokens: number; output_tokens: number };
    message?: Partial<AnthropicResponse>;
    stop_reason?: string;
}
```

- [ ] **Step 4: Update `toAnthropicMessages` (line 107) to re-emit `Message.reasoning` as leading `thinking` blocks**

In the `if (m.role === 'assistant')` branch (line 130-142):

```ts
if (m.role === 'assistant') {
    const asst = m as AssistantMessage & { reasoning?: { text: string; title?: string }[] };
    const blocks: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; thinking?: string }> = [];
    for (const block of asst.reasoning ?? []) {
        blocks.push({ type: 'thinking', thinking: block.text });
    }
    const textContent = typeof asst.content === 'string' ? asst.content : '';
    if (textContent) blocks.push({ type: 'text', text: textContent });
    if (asst.toolCalls?.length) {
        for (const tc of asst.toolCalls) {
            blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
        }
    }
    anthropicMessages.push({ role: 'assistant', content: blocks as AnthropicContent });
    continue;
}
```

- [ ] **Step 5: Update `generateText` (line 200-257) to send `thinking`/forced `temperature`, and extract reasoning blocks**

```ts
async generateText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
    ...
    const thinkingEnabled = isReasoningStreamEnabled();
    const reqParams = {
        model: this.model,
        max_tokens: options?.maxTokens ?? 4096,
        system,
        messages: anthropicMsgs,
        temperature: thinkingEnabled ? 1 : (options?.temperature ?? 0.7),
        ...(tools && { tools }),
        ...(thinkingEnabled && { thinking: { type: 'enabled' as const, budget_tokens: DEFAULT_THINKING_BUDGET_TOKENS } }),
    } as AnthropicCreateParams;
    ...
    let text = '';
    const toolCalls: ToolCall[] = [];
    const reasoning: { text: string; title?: string }[] = [];

    for (const block of response.content) {
        if (block.type === 'text' && block.text) {
            text += block.text;
        } else if (block.type === 'tool_use' && block.id && block.name && block.input) {
            toolCalls.push({ id: block.id, name: block.name, arguments: block.input as Record<string, unknown> });
        } else if (block.type === 'thinking' && (block as { thinking?: string }).thinking) {
            reasoning.push({ text: (block as { thinking?: string }).thinking! });
        }
    }
    ...
    return {
        text,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        finishReason: normalizeFinishReason(response.stop_reason),
        usage: { ... },
        ...(reasoning.length && { reasoning }),
    };
}
```

Add the import: `import { isReasoningStreamEnabled } from '../streaming/reasoning-accumulator.js';` at the top of the file.

- [ ] **Step 6: Update `streamText` (line 260-330) the same way, plus the delta loop**

```ts
async streamText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
    ...
    const thinkingEnabled = isReasoningStreamEnabled();
    const streamParams = {
        model: this.model,
        max_tokens: options?.maxTokens ?? 4096,
        system,
        messages: anthropicMsgs,
        temperature: thinkingEnabled ? 1 : (options?.temperature ?? 0.7),
        stream: true,
        ...(tools && { tools }),
        ...(thinkingEnabled && { thinking: { type: 'enabled' as const, budget_tokens: DEFAULT_THINKING_BUDGET_TOKENS } }),
    } as AnthropicCreateParams;
    ...
    for await (const event of stream) {
        if (event.type === 'content_block_start' && event.index !== undefined && event.content_block) {
            const block = event.content_block;
            if (block.type === 'tool_use' && block.id && block.name) {
                toolBlocks.set(event.index, { id: block.id, name: block.name, args: '' });
            } else if (block.type === 'redacted_thinking' && block.data) {
                // Arrives whole, no delta events. Store opaquely — never render, never re-derive.
                options?.onReasoning?.({ text: `[redacted_thinking:${block.data}]` });
            }
        } else if (event.type === 'content_block_delta' && event.index !== undefined && event.delta) {
            if (event.delta.type === 'text_delta' && event.delta.text) {
                fullText += event.delta.text;
                options?.onChunk?.(event.delta.text);
            } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
                options?.onReasoning?.({ text: event.delta.thinking });
            } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
                ...  // unchanged
            }
        } else if (event.type === 'message_delta' && event.stop_reason) {
            finishReason = normalizeFinishReason(event.stop_reason);
        }
        if (event.usage) { ... }  // unchanged
    }
    ...
}
```

(The `redacted_thinking` opaque marker string is a deliberate placeholder representation — the actual base64 `data` must round-trip back into `toAnthropicMessages` unchanged on the next turn; a follow-up refinement can carry it as a typed block through `Message.reasoning` instead of a string marker if a caller needs exact fidelity. For this task, plain opaque-text passthrough satisfies "never render, never re-derive" from the spec.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test tests/coverage-providers-classes.test.ts`
Expected: all PASS, including the three new tests and the pre-existing ones (double-check `temperature: 0.7` assertions elsewhere in the same `describe` block don't silently start expecting `1` — reasoning is on by default, so any pre-existing test that asserts a specific non-1 temperature will need `ENABLE_REASONING_STREAM=false` set around it).

- [ ] **Step 8: Run the full provider test file to check for regressions from the default-on flag**

Run: `bun test tests/coverage-providers-classes.test.ts tests/provider-adapter-hardening.test.ts`
Expected: PASS. Fix any pre-existing test whose fixed mock response assumed no `thinking` param / a specific temperature by wrapping it with `ENABLE_REASONING_STREAM=false` (see Step 1's second test for the pattern).

- [ ] **Step 9: Commit**

```bash
git add src/providers/anthropic-provider.ts tests/coverage-providers-classes.test.ts
git commit -m "feat(anthropic): add extended-thinking support (thinking param, forced temperature=1, redacted_thinking passthrough)"
```

---

### Task 10: Bedrock adapter — `thinking` param + fix latent content-block-index bug

**Files:**
- Modify: `src/models/bedrock.ts:27-54`
- Test: check `grep -n "bedrock" tests/models-providers-parity.test.ts tests/coverage-remaining-providers-playground.test.ts` for the existing home; extend there.

**Interfaces:**
- Consumes: `isReasoningStreamEnabled()` (Task 3).
- Produces: `bedrock()`'s `generateText` sends `thinking` in the request body when enabled, and correctly extracts the text block by `.type` (not index `0`) regardless of whether a thinking block precedes it; returns `reasoning` on `GenerateResult` when present.

- [ ] **Step 1: Write the failing test**

```ts
it('extracts text correctly when a thinking block precedes it, and forwards it as reasoning', async () => {
    vi.doMock('@aws-sdk/client-bedrock-runtime', () => ({
        BedrockRuntimeClient: class { send = vi.fn().mockResolvedValue({
            body: new TextEncoder().encode(JSON.stringify({
                content: [
                    { type: 'thinking', thinking: 'because X' },
                    { type: 'text', text: 'the answer' },
                ],
                usage: { input_tokens: 1, output_tokens: 1 },
            })),
        }); },
        InvokeModelCommand: class {},
    }));
    const { bedrock } = await import('../src/models/bedrock.js');
    const provider = bedrock({ model: 'anthropic.claude-3-5-sonnet-20241022-v2:0' });
    const result = await provider.generateText([{ role: 'user', content: 'hi' }]);
    expect(result.text).toBe('the answer');
    expect(result.reasoning).toEqual([{ text: 'because X' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test <that file>`
Expected: FAIL — current code does `decoded.content[0]?.text`, so `result.text` would be `undefined`/`''` (index 0 is the thinking block, which has no `.text`), and `result.reasoning` doesn't exist at all.

- [ ] **Step 3: Fix `generateText` in `src/models/bedrock.ts`**

```ts
import { isReasoningStreamEnabled } from '../streaming/reasoning-accumulator.js';

const DEFAULT_THINKING_BUDGET_TOKENS = 4096;

async function generateText(messages: Message[], opts?: GenerateOptions): Promise<GenerateResult> {
    if (!/anthropic/i.test(model)) {
        throw new Error(`Bedrock adapter supports Anthropic models only; got ${JSON.stringify(model)}.`);
    }
    const client = await getClient();
    const { InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime').catch(() => { throw new Error(MISSING_SDK_MSG); });

    const thinkingEnabled = isReasoningStreamEnabled();
    const body = JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens:        opts?.maxTokens ?? config.maxTokens ?? 4096,
        messages:          messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
        system:            messages.find((m) => m.role === 'system')?.content,
        ...(thinkingEnabled && { thinking: { type: 'enabled', budget_tokens: DEFAULT_THINKING_BUDGET_TOKENS } }),
    });

    const res = await client.send(new InvokeModelCommand({ modelId: model, body: new TextEncoder().encode(body), contentType: 'application/json', accept: 'application/json' }));
    const decoded = JSON.parse(new TextDecoder().decode(res.body)) as {
        content: Array<{ type: string; text?: string; thinking?: string }>;
        usage: { input_tokens: number; output_tokens: number };
    };

    const text = decoded.content.find((b) => b.type === 'text')?.text ?? '';
    const reasoning = decoded.content
        .filter((b) => b.type === 'thinking' && b.thinking)
        .map((b) => ({ text: b.thinking! }));

    return {
        text,
        finishReason: 'stop',
        usage: {
            promptTokens:     decoded.usage?.input_tokens,
            completionTokens: decoded.usage?.output_tokens,
            totalTokens:      (decoded.usage?.input_tokens ?? 0) + (decoded.usage?.output_tokens ?? 0),
        },
        ...(reasoning.length && { reasoning }),
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test <that file>`
Expected: PASS

- [ ] **Step 5: Add a regression test for the pre-thinking-feature bug in isolation**

```ts
it('extracts the text block correctly even without thinking enabled (regression: was hardcoded to content[0])', async () => {
    process.env.ENABLE_REASONING_STREAM = 'false';
    try {
        // same mock as above but only a text block present
        // ... assert result.text === 'the answer', result.reasoning undefined
    } finally {
        delete process.env.ENABLE_REASONING_STREAM;
    }
});
```

- [ ] **Step 6: Run full test file**

Run: `bun test <that file>`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/models/bedrock.ts <that test file>
git commit -m "fix(bedrock): extract text block by type, not index; add thinking support"
```

---

### Task 11: Google provider — `thinkingConfig` + iterate `parts` instead of `.text()` helper

**Files:**
- Modify: `src/providers/google-provider.ts:263-360` (`generateText`, `streamText`)
- Test: `tests/coverage-providers-classes.test.ts` (existing `GoogleProvider` `describe` block, line 169+)

**Interfaces:**
- Consumes: `isReasoningStreamEnabled()` (Task 3), `GenerateOptions.onReasoning` (Task 1).
- Produces: `generateText`/`streamText` request `thinkingConfig.includeThoughts` when enabled; both extract thought parts (`part.thought === true`) separately from regular text parts by iterating `content.parts` directly.

- [ ] **Step 1: Write the failing tests**

```ts
it('generateText requests includeThoughts and separates thought parts from text', async () => {
    const client = {
        getGenerativeModel: vi.fn().mockReturnValue({
            generateContent: vi.fn().mockResolvedValue({
                response: {
                    text: () => 'the answer',
                    candidates: [{ content: { parts: [
                        { text: 'because X', thought: true },
                        { text: 'the answer' },
                    ] }, finishReason: 'STOP' }],
                    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
                },
            }),
        }),
    };
    const provider = new GoogleProvider({ client: client as never });
    const result = await provider.generateText([{ role: 'user', content: 'hi' }]);
    expect(result.reasoning).toEqual([{ text: 'because X' }]);
    const [, config] = client.getGenerativeModel.mock.calls[0]!;
    void config;
    expect(client.getGenerativeModel.mock.calls[0]![0].generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: expect.any(Number) });
});
```

(Adapt to this test file's exact existing `GoogleProvider` construction pattern — read lines 169-236 first; the assertions on `result.reasoning` and `thinkingConfig` are what matter.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/coverage-providers-classes.test.ts`
Expected: FAIL — no `thinkingConfig` sent, no `result.reasoning`.

- [ ] **Step 3: Update `generateText` (line 263-308)**

```ts
async generateText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
    ...
    const thinkingEnabled = isReasoningStreamEnabled();
    const geminiModel = this.client.getGenerativeModel({
        model: this.model,
        ...(systemInstruction && { systemInstruction }),
        generationConfig: {
            temperature: options?.temperature ?? 0.7,
            ...(options?.maxTokens && { maxOutputTokens: options.maxTokens }),
            ...(options?.stop?.length && { stopSequences: options.stop }),
            ...(thinkingEnabled && { thinkingConfig: { includeThoughts: true, thinkingBudget: DEFAULT_THINKING_BUDGET_TOKENS } }),
        },
        ...(geminiTools && { tools: geminiTools }),
    });

    const result = await geminiModel.generateContent(...);
    const response = result.response;

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('') || (response.text?.() ?? '');
    const reasoning = parts.filter((p) => p.thought && p.text).map((p) => ({ text: p.text! }));
    const toolCalls = extractToolCalls(response.candidates);
    ...
    return { text, toolCalls: toolCalls.length ? toolCalls : undefined, finishReason, usage, ...(reasoning.length && { reasoning }) };
}
```

Add `const DEFAULT_THINKING_BUDGET_TOKENS = 4096;` near the top of the file, and the `isReasoningStreamEnabled` import.

- [ ] **Step 4: Update `streamText` (line 310-360) the same way, plus the per-chunk delta loop**

```ts
async streamText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
    ...
    const thinkingEnabled = isReasoningStreamEnabled();
    const geminiModel = this.client.getGenerativeModel({
        model: this.model,
        ...(systemInstruction && { systemInstruction }),
        generationConfig: {
            temperature: options?.temperature ?? 0.7,
            ...(options?.maxTokens && { maxOutputTokens: options.maxTokens }),
            ...(options?.stop?.length && { stopSequences: options.stop }),
            ...(thinkingEnabled && { thinkingConfig: { includeThoughts: true, thinkingBudget: DEFAULT_THINKING_BUDGET_TOKENS } }),
        },
        ...(geminiTools && { tools: geminiTools }),
    });
    ...
    for await (const chunk of streamResult.stream) {
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
            if (part.thought && part.text) {
                options?.onReasoning?.({ text: part.text });
            } else if (part.text) {
                fullText += part.text;
                options?.onChunk?.(part.text);
            }
        }
        // fall back to chunk.text() only when parts are unavailable (defensive, mirrors old behavior)
        if (parts.length === 0) {
            const chunkText = chunk.text();
            if (chunkText) { fullText += chunkText; options?.onChunk?.(chunkText); }
        }
        const chunkToolCalls = extractToolCalls(chunk.candidates as GoogleResponse['candidates']);
        toolCalls.push(...chunkToolCalls);
        if (chunk.candidates?.[0]?.finishReason) { ... }  // unchanged
    }
    ...
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/coverage-providers-classes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/providers/google-provider.ts tests/coverage-providers-classes.test.ts
git commit -m "feat(google): add thinkingConfig support, iterate parts instead of the text() helper"
```

---

### Task 12: Ollama adapter — native `think` field (no tag parsing)

**Files:**
- Modify: `src/models/ollama.ts`
- Test: check `grep -n "ollama" tests/models-providers-parity.test.ts tests/coverage-remaining-providers-playground.test.ts`; extend there.

**Interfaces:**
- Consumes: `isReasoningStreamEnabled()` (Task 3).
- Produces: `generateText`/`streamText` send `think: true` when enabled; `streamText` calls `onReasoning` for `chunk.message.thinking`; `generateText` returns `reasoning` from `res.message.thinking`.

- [ ] **Step 1: Write the failing tests**

```ts
it('generateText sends think:true and surfaces reasoning', async () => {
    vi.doMock('ollama', () => ({
        Ollama: class {
            chat = vi.fn().mockResolvedValue({
                message: { content: 'the answer', thinking: 'because X' },
                prompt_eval_count: 1, eval_count: 1,
            });
        },
    }));
    const { ollama } = await import('../src/models/ollama.js');
    const provider = ollama({ model: 'deepseek-r1' });
    const result = await provider.generateText([{ role: 'user', content: 'hi' }]);
    expect(result.text).toBe('the answer');
    expect(result.reasoning).toEqual([{ text: 'because X' }]);
});

it('streamText fires onReasoning for message.thinking chunks', async () => {
    vi.doMock('ollama', () => ({
        Ollama: class {
            chat = vi.fn().mockResolvedValue((async function* () {
                yield { message: { content: '', thinking: 'because X' } };
                yield { message: { content: 'the answer', thinking: '' } };
            })());
        },
    }));
    const { ollama } = await import('../src/models/ollama.js');
    const provider = ollama({ model: 'deepseek-r1' });
    const reasoningDeltas: { text: string }[] = [];
    const result = await provider.streamText!([{ role: 'user', content: 'hi' }], {
        onChunk: () => {},
        onReasoning: (d) => reasoningDeltas.push(d),
    });
    expect(result.text).toBe('the answer');
    expect(reasoningDeltas).toEqual([{ text: 'because X' }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test <that file>`
Expected: FAIL — no `think` sent, `result.reasoning` undefined, `reasoningDeltas` empty.

- [ ] **Step 3: Update `src/models/ollama.ts`**

```ts
import { isReasoningStreamEnabled } from '../streaming/reasoning-accumulator.js';

async function generateText(messages: Message[], opts?: GenerateOptions): Promise<GenerateResult> {
    const client = await getClient();
    const res = await (client as import('ollama').Ollama).chat({
        model,
        messages: toOllamaMessages(messages),
        ...(isReasoningStreamEnabled() && { think: true }),
    });
    const thinking = (res.message as { thinking?: string }).thinking;
    return {
        text:         res.message.content,
        finishReason: 'stop',
        usage: {
            promptTokens:     res.prompt_eval_count,
            completionTokens: res.eval_count,
            totalTokens:      res.prompt_eval_count + res.eval_count,
        },
        ...(thinking && { reasoning: [{ text: thinking }] }),
    };
}

async function streamText(messages: Message[], opts?: GenerateOptions): Promise<GenerateResult> {
    const client = await getClient();
    const stream = await (client as import('ollama').Ollama).chat({
        model,
        messages: toOllamaMessages(messages),
        stream:   true,
        ...(isReasoningStreamEnabled() && { think: true }),
    });

    let fullText = '';
    for await (const chunk of stream) {
        const thinkingDelta = (chunk.message as { thinking?: string }).thinking;
        if (thinkingDelta) {
            opts?.onReasoning?.({ text: thinkingDelta });
        }
        const delta = chunk.message.content;
        if (delta) {
            fullText += delta;
            opts?.onChunk?.(delta);
        }
    }
    return { text: fullText, finishReason: 'stop' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test <that file>`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/models/ollama.ts <that test file>
git commit -m "feat(ollama): use native think field for reasoning, no tag parsing"
```

---

### Task 13: OpenAI provider — `reasoning_effort` (Chat Completions) + Responses API path for reasoning text

**Files:**
- Modify: `src/providers/openai-provider.ts` (interfaces, `generateText`, `streamText`; add a new method or branch for the Responses API path)
- Test: `tests/coverage-providers-classes.test.ts` (existing `OpenAIProvider` block — locate with `grep -n "describe('providers/OpenAIProvider'" tests/coverage-providers-classes.test.ts`)

**Interfaces:**
- Consumes: `isReasoningStreamEnabled()` (Task 3), `GenerateOptions.onReasoning` (Task 1).
- Produces: `generateText`/`streamText` (Chat Completions path) send `reasoning_effort` when enabled, for callers who don't need visible text. A new internal path using `client.responses.create` is used instead when the model is a known reasoning model (o-series/gpt-5-reasoning family) and the flag is on, surfacing `reasoning_summary_text.delta` as `onReasoning`/`result.reasoning`.

- [ ] **Step 1: Read the existing `OpenAIProvider` test block and the client type**

Run: `grep -n "OpenAIClient\|describe('providers/OpenAIProvider'" src/providers/openai-provider.ts tests/coverage-providers-classes.test.ts`

Confirm the `OpenAIClient` interface's shape (chat.completions.create) before adding a `responses` method to it.

- [ ] **Step 2: Write the failing tests**

```ts
it('sends reasoning_effort on the Chat Completions path when enabled', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const provider = new OpenAIProvider({ client: { chat: { completions: { create } } } as never, model: 'o4-mini' });
    await provider.generateText([{ role: 'user', content: 'hi' }]);
    const body = create.mock.calls[0]![0];
    expect(body.reasoning_effort).toBeDefined();
});

it('uses the Responses API and surfaces reasoning text for reasoning models', async () => {
    const create = vi.fn().mockResolvedValue({
        output_text: 'the answer',
        output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'because X' }] }],
        usage: { input_tokens: 1, output_tokens: 1 },
    });
    const provider = new OpenAIProvider({ client: { chat: { completions: { create: vi.fn() } }, responses: { create } } as never, model: 'o4-mini' });
    const result = await provider.generateText([{ role: 'user', content: 'hi' }]);
    expect(result.text).toBe('the answer');
    expect(result.reasoning).toEqual([{ text: 'because X' }]);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/coverage-providers-classes.test.ts`
Expected: FAIL — no `reasoning_effort` sent; `responses.create` never called (current code always uses `chat.completions.create`).

- [ ] **Step 4: Add a model allowlist and the `responses` client shape**

Near the top of `openai-provider.ts`:

```ts
/** Models whose reasoning text is only available via the Responses API. */
const RESPONSES_API_REASONING_MODELS = /^(o1|o3|o4-mini|gpt-5)/i;

interface OpenAIClient {
    chat: { completions: { create(...args: unknown[]): Promise<unknown> } };
    responses?: { create(...args: unknown[]): Promise<unknown> };
}
```

(Merge into the file's existing `OpenAIClient` interface rather than replacing it wholesale — read the existing definition first per Step 1.)

- [ ] **Step 5: Branch `generateText` on reasoning-capability + flag**

```ts
async generateText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
    const thinkingEnabled = isReasoningStreamEnabled();
    if (thinkingEnabled && RESPONSES_API_REASONING_MODELS.test(this.model)) {
        return this.generateViaResponsesApi(messages, options);
    }
    // existing chat.completions path, with reasoning_effort added:
    const body: Record<string, unknown> = {
        model: this.model,
        messages: toOpenAIMessages(messages),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens,
        stop: options?.stop,
        ...(thinkingEnabled && { reasoning_effort: 'medium' }),
        ...(this.extraBody && { ...this.extraBody }),
    };
    ...  // rest unchanged
}

private async generateViaResponsesApi(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
    const client = this.getClient();
    if (!client.responses) throw new Error('OpenAI client does not support the Responses API (upgrade the openai package)');
    const input = toOpenAIMessages(messages); // Responses API accepts the same role/content shape for simple text turns
    const response = await client.responses.create({
        model: this.model,
        input,
        reasoning: { effort: 'medium', summary: 'auto' },
    }) as { output_text?: string; output?: Array<{ type: string; summary?: Array<{ type: string; text?: string }> }>; usage?: { input_tokens: number; output_tokens: number } };

    const reasoning = (response.output ?? [])
        .filter((o) => o.type === 'reasoning')
        .flatMap((o) => (o.summary ?? []).filter((s) => s.type === 'summary_text' && s.text).map((s) => ({ text: s.text! })));

    return {
        text: response.output_text ?? '',
        finishReason: 'stop',
        usage: response.usage ? {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
            totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        } : undefined,
        ...(reasoning.length && { reasoning }),
    };
}
```

- [ ] **Step 6: Apply the same `reasoning_effort` addition to the `streamText` Chat Completions path (~line 288-330)**

```ts
async streamText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
    const thinkingEnabled = isReasoningStreamEnabled();
    const body: Record<string, unknown> = {
        model: this.model,
        messages: toOpenAIMessages(messages),
        stream: true,
        ...(thinkingEnabled && { reasoning_effort: 'medium' }),
        ...(this.extraBody && { ...this.extraBody }),
    };
    ...  // rest unchanged — Chat Completions streaming has no reasoning delta to surface, per spec Section 5
}
```

(Streaming reasoning *text* for OpenAI is intentionally Responses-API-only and non-streaming in this task — `client.responses.create` above is called without `stream: true`. A streamed Responses API path, handling `response.reasoning_summary_text.delta` events live, is a reasonable fast-follow but is not required to satisfy this task's tests; note it explicitly as deferred rather than silently skipping it.)

Add the import: `import { isReasoningStreamEnabled } from '../streaming/reasoning-accumulator.js';`

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test tests/coverage-providers-classes.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/providers/openai-provider.ts tests/coverage-providers-classes.test.ts
git commit -m "feat(openai): add reasoning_effort + Responses API reasoning text for reasoning models"
```

---

### Task 14: `ai-sdk-provider.ts` — map the `ai` SDK's reasoning parts

**Files:**
- Modify: `src/providers/ai-sdk-provider.ts`
- Test: `tests/ai-sdk-provider.test.ts` (existing)

**Interfaces:**
- Consumes: `GenerateOptions.onReasoning` (Task 1).
- Produces: when the wrapped `ai` SDK stream emits a reasoning part, `onReasoning` fires with its text; the final result carries `reasoning`.

- [ ] **Step 1: Read the existing test file's mocking pattern for the `ai` SDK's `streamText`/`generateText`**

Run: `grep -n "streamText\|generateText\|fullStream\|textStream" tests/ai-sdk-provider.test.ts src/providers/ai-sdk-provider.ts | head -30`

- [ ] **Step 2: Write the failing test** (exact shape depends on Step 1's findings; this is the intended assertion)

```ts
it('maps ai SDK reasoning parts to onReasoning / result.reasoning', async () => {
    // Mock the underlying `ai` package's streamText/fullStream to yield a
    // { type: 'reasoning', text: 'because X' } part alongside text parts,
    // matching however this file already mocks the `ai` package.
    const reasoningDeltas: { text: string }[] = [];
    const result = await provider.streamText([{ role: 'user', content: 'hi' }], {
        onChunk: () => {},
        onReasoning: (d) => reasoningDeltas.push(d),
    });
    expect(reasoningDeltas).toEqual([{ text: 'because X' }]);
    expect(result.reasoning).toEqual([{ text: 'because X' }]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/ai-sdk-provider.test.ts`
Expected: FAIL — reasoning parts currently ignored/dropped.

- [ ] **Step 4: Find and update the part-type switch in `ai-sdk-provider.ts`**

Run: `grep -n "part.type ===\|'text-delta'\|switch (part" src/providers/ai-sdk-provider.ts`

Add a branch (mirroring however `'text-delta'` is currently handled) for the SDK's reasoning part type:

```ts
} else if (part.type === 'reasoning-delta' || part.type === 'reasoning') {
    const text = 'text' in part ? part.text : '';
    if (text) {
        reasoningBlocks.push({ text });
        options?.onReasoning?.({ text });
    }
}
```

Fold `reasoningBlocks` into the returned `GenerateResult` the same way existing accumulators (`fullText`, `toolCalls`) are folded in at the end of the method: `...(reasoningBlocks.length && { reasoning: reasoningBlocks })`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/ai-sdk-provider.test.ts`
Expected: PASS. If it still fails because the installed `ai` package version drops the event (the known upstream issue noted in the spec), record that as a finding rather than forcing a workaround — report it back rather than guessing at a fix for someone else's SDK bug.

- [ ] **Step 6: Commit**

```bash
git add src/providers/ai-sdk-provider.ts tests/ai-sdk-provider.test.ts
git commit -m "feat(ai-sdk-provider): map ai SDK reasoning parts to onReasoning/result.reasoning"
```

---

### Task 15: End-to-end integration test + changelog note

**Files:**
- Test: extend `tests/e2e-agent.test.ts` (check it exists and covers `createAgent(...).run()`/`.streamEvents()` end-to-end; if not, use `tests/coverage-create-agent-core.test.ts`)
- Modify: `CHANGELOG.md` (repo root — check its existing format first)

**Interfaces:**
- Consumes: everything from Tasks 1-14.
- Produces: one test proving the full path (mocked reasoning-capable provider → `AgentRunResult.reasoningText`/`Message.reasoning` → `streamEvents()` yields `reasoning-delta` → SSE wire round-trips it → durable replay carries it), and a changelog entry calling out the default-on behavior change (forced `temperature: 1` on Anthropic, new billed/latency cost when providers request thinking).

- [ ] **Step 1: Read `CHANGELOG.md`'s existing format**

Run: `head -40 CHANGELOG.md`

- [ ] **Step 2: Write the integration test**

```ts
it('end-to-end: reasoning flows from provider through streamEvents to the final result', async () => {
    const agent = createAgent({
        name: 'reasoning-test',
        instructions: 'x',
        model: {
            generateText: vi.fn(),
            streamText: vi.fn(async (_messages, options) => {
                options?.onReasoning?.({ text: 'because X' });
                options?.onChunk?.('final answer');
                return { text: 'final answer', finishReason: 'stop' };
            }),
        } as never,
    });

    const events: unknown[] = [];
    for await (const ev of agent.streamEvents('hi')) events.push(ev);

    expect(events).toContainEqual(expect.objectContaining({ type: 'reasoning-delta', reasoningDelta: 'because X' }));
    const runFinish = events.find((e) => (e as { type: string }).type === 'run-finish') as { run: { reasoningText?: string; messages: { role: string; reasoning?: unknown }[] } };
    expect(runFinish.run.reasoningText).toBe('because X');
    expect(runFinish.run.messages.find((m) => m.role === 'assistant')?.reasoning).toEqual([{ text: 'because X' }]);
});
```

(Adapt `createAgent`'s exact options shape to match this test file's existing usage — the assertions are what matter.)

- [ ] **Step 3: Run test to verify it fails, then implement any gap it surfaces**

Run: `bun test <that file>`
Expected: likely PASS already if Tasks 1-5 are correct — this test is a regression guard tying the pieces together, not new implementation. If it fails, the failure points at exactly which earlier task's wiring is incomplete; fix that task's code, not this test.

- [ ] **Step 4: Add the changelog entry**

Add an entry (matching the file's existing section format) noting: native reasoning/thinking-token support across Anthropic, OpenAI (Responses API), Google, Bedrock, Ollama, and the `ai` SDK path; the `ENABLE_REASONING_STREAM` flag (default: on); and the behavior change that Anthropic calls now force `temperature: 1` when thinking is enabled.

- [ ] **Step 5: Run the full test suite**

Run: `bun test`
Expected: all PASS.

- [ ] **Step 6: Type-check and lint**

Run: `bun run typecheck && bun run lint`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add <integration test file> CHANGELOG.md
git commit -m "test: add end-to-end reasoning integration test; document ENABLE_REASONING_STREAM in changelog"
```
