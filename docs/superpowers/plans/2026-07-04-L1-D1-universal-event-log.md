# L1-D1: Universal Event Log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans or subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Make every `agent.run()` emit a durable, ordered `GraphEvent` log into any `EventStore`, off by default, without coupling the core runner to the graph engine.

**Architecture:** The core `AgentRunner` calls a narrow `EventRecorder` interface (defined in core, no graph import) at four seams: agent start, each LLM result, each tool result, agent end. A concrete `RunRecorder` (in `src/runtime/`) implements that interface by constructing `GraphEvent`s with monotonic sequence numbers and appending them to a supplied `EventStore`. Existing `InMemoryEventStore`/`SqliteEventStore` are reused unchanged.

**Tech Stack:** TypeScript (ESM), vitest, existing `src/graph/` event store + event types.

---

## File structure

- Modify `src/graph/types.ts` — add 4 members to `GraphEventType` (agent/llm/tool lifecycle).
- Modify `src/core/runner/types.ts` — add `EventRecorder` interface + `recorder?` field on `RunnerConfig`.
- Modify `src/core/runner/agent-runner.ts` — call `recorder` at 4 seams.
- Create `src/runtime/run-recorder.ts` — `RunRecorder implements EventRecorder`.
- Modify `src/runtime/index.ts` — export `RunRecorder`.
- Create `tests/run-recorder.test.ts` — unit + integration tests.

---

### Task 1: Extend the event vocabulary

**Files:** Modify `src/graph/types.ts` (enum `GraphEventType`, ~line 300).

- [ ] **Step 1:** Add to the `GraphEventType` enum, before the closing `}`:

```ts
  // Agent-level (single-agent runner emits these)
  AGENT_STARTED = 'agent.started',
  AGENT_COMPLETED = 'agent.completed',
  LLM_CALL = 'llm.call',
  TOOL_CALL = 'tool.call',
```

- [ ] **Step 2:** `npx tsc --noEmit` (or `npm run build`) — expect no new errors.

---

### Task 2: EventRecorder interface + RunnerConfig field

**Files:** Modify `src/core/runner/types.ts`.

- [ ] **Step 1:** Append the interface after `RunnerConfig`:

```ts
// ── Event recorder (durable log seam; core stays decoupled from graph) ────────

/** Narrow seam the runner calls to record a run as a durable event log. */
export interface EventRecorder {
    agentStart(data: { agent: string; prompt: string }): void | Promise<void>;
    llmResult(data: { step: number; text: string; toolCalls?: readonly { name: string }[]; usage?: unknown }): void | Promise<void>;
    toolResult(data: { step: number; name: string; args: unknown; output: unknown; error?: boolean }): void | Promise<void>;
    agentEnd(data: { text: string; steps: number; finishReason: string }): void | Promise<void>;
}
```

- [ ] **Step 2:** Add `recorder?` to `RunnerConfig`:

```ts
    readonly toolTimeoutMs?: number;
    /** Optional durable event recorder. Off by default. */
    readonly recorder?: EventRecorder;
```

---

### Task 3: RunRecorder (write failing test first)

**Files:** Create `tests/run-recorder.test.ts`; create `src/runtime/run-recorder.ts`.

- [ ] **Step 1 — failing unit test** (`tests/run-recorder.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { InMemoryEventStore } from '../src/graph/event-store.js';
import { RunRecorder } from '../src/runtime/run-recorder.js';
import { GraphEventType } from '../src/graph/types.js';

describe('RunRecorder', () => {
  it('appends ordered, monotonically-sequenced events', async () => {
    const store = new InMemoryEventStore();
    const rec = new RunRecorder(store);

    await rec.agentStart({ agent: 'a', prompt: 'hi' });
    await rec.llmResult({ step: 1, text: 'thinking', toolCalls: [{ name: 'search' }] });
    await rec.toolResult({ step: 1, name: 'search', args: {}, output: 'ok' });
    await rec.llmResult({ step: 2, text: 'done' });
    await rec.agentEnd({ text: 'done', steps: 2, finishReason: 'stop' });

    const events = await store.load(rec.executionId);
    expect(events.map(e => e.type)).toEqual([
      GraphEventType.AGENT_STARTED,
      GraphEventType.LLM_CALL,
      GraphEventType.TOOL_CALL,
      GraphEventType.LLM_CALL,
      GraphEventType.AGENT_COMPLETED,
    ]);
    expect(events.map(e => e.sequence)).toEqual([0, 1, 2, 3, 4]);
  });
});
```

- [ ] **Step 2:** `npm test -- run-recorder` — expect FAIL (`RunRecorder` not found).

- [ ] **Step 3 — implement** (`src/runtime/run-recorder.ts`):

```ts
import {
  type EventStore, type GraphEvent, type ExecutionId, type GraphId,
  GraphEventType, uid, graphId as makeGraphId, executionId as makeExecutionId,
} from '../graph/types.js';
import type { EventRecorder } from '../core/runner/types.js';

/** Records an agent run as a durable, ordered GraphEvent log in any EventStore. */
export class RunRecorder implements EventRecorder {
  private seq = 0;
  readonly executionId: ExecutionId;
  readonly graphId: GraphId;

  constructor(
    private readonly store: EventStore,
    opts: { executionId?: ExecutionId; graphId?: GraphId } = {},
  ) {
    this.executionId = opts.executionId ?? makeExecutionId();
    this.graphId = opts.graphId ?? makeGraphId();
  }

  private emit(type: GraphEventType, data: Record<string, unknown>): Promise<void> {
    const event: GraphEvent = {
      id: uid('e'), type,
      executionId: this.executionId, graphId: this.graphId,
      timestamp: Date.now(), sequence: this.seq++, data,
    };
    return this.store.append([event]);
  }

  agentStart(data: { agent: string; prompt: string }): Promise<void> {
    return this.emit(GraphEventType.AGENT_STARTED, { ...data });
  }
  llmResult(data: { step: number; text: string; toolCalls?: readonly { name: string }[]; usage?: unknown }): Promise<void> {
    return this.emit(GraphEventType.LLM_CALL, { ...data });
  }
  toolResult(data: { step: number; name: string; args: unknown; output: unknown; error?: boolean }): Promise<void> {
    return this.emit(GraphEventType.TOOL_CALL, { ...data });
  }
  agentEnd(data: { text: string; steps: number; finishReason: string }): Promise<void> {
    return this.emit(GraphEventType.AGENT_COMPLETED, { ...data });
  }
}
```

- [ ] **Step 4:** `npm test -- run-recorder` — expect PASS.

- [ ] **Step 5:** Export from `src/runtime/index.ts`: `export { RunRecorder } from './run-recorder.js';`

---

### Task 4: Wire the runner (integration test first)

**Files:** Modify `src/core/runner/agent-runner.ts`; extend `tests/run-recorder.test.ts`.

- [ ] **Step 1 — failing integration test** (append to `tests/run-recorder.test.ts`):

```ts
import { AgentRunner } from '../src/core/runner/agent-runner.js';

describe('AgentRunner emits events via recorder', () => {
  it('records start, llm, tool, completion for a tool-using run', async () => {
    const store = new InMemoryEventStore();
    const rec = new RunRecorder(store);

    let call = 0;
    const llm = {
      generateText: async () => {
        call++;
        return call === 1
          ? { text: '', toolCalls: [{ id: 't1', name: 'echo', arguments: { v: 1 } }], finishReason: 'tool_calls' }
          : { text: 'final', toolCalls: [], finishReason: 'stop' };
      },
    } as any;

    const echo = { name: 'echo', description: '', parameters: {} as any, execute: async (a: any) => ({ echoed: a }) };
    const tools = { list: () => [echo], get: (n: string) => (n === 'echo' ? echo : undefined) } as any;

    const runner = new AgentRunner({ name: 'bot', instructions: 'x', llm, tools, recorder: rec });
    await runner.run({ instructions: 'x', prompt: 'go' });

    const types = (await store.load(rec.executionId)).map(e => e.type);
    expect(types[0]).toBe(GraphEventType.AGENT_STARTED);
    expect(types).toContain(GraphEventType.TOOL_CALL);
    expect(types.at(-1)).toBe(GraphEventType.AGENT_COMPLETED);
  });
});
```

- [ ] **Step 2:** `npm test -- run-recorder` — expect FAIL (no events emitted by runner yet).

- [ ] **Step 3 — wire seams** in `agent-runner.ts`:
  - In `_loop`, after building `messages` and before the `while` loop:
    ```ts
    await this.config.recorder?.agentStart({ agent: this.config.name, prompt: runConfig.prompt });
    ```
  - In `_loop`, right after `accumulateUsage(usage, result.usage); finalText = result.text ?? '';`:
    ```ts
    await this.config.recorder?.llmResult({ step: steps, text: finalText, toolCalls: result.toolCalls, usage: result.usage });
    ```
  - In `_dispatchTools`, immediately before the final `messages.push({ role: 'tool', ... })`:
    ```ts
    await this.config.recorder?.toolResult({ step, name: tc.name, args, output });
    ```
  - In `_loop`, replace the final `return ...runResult` block so the event is emitted before returning:
    ```ts
    await this.config.recorder?.agentEnd({ text: finalText, steps, finishReason });
    return lifecycle.afterRun ? await lifecycle.afterRun(runResult) : runResult;
    ```

- [ ] **Step 4:** `npm test -- run-recorder` — expect PASS.

- [ ] **Step 5:** `npm test` — full suite green (no regressions).

- [ ] **Step 6 — commit:**

```bash
git add src/graph/types.ts src/core/runner/types.ts src/core/runner/agent-runner.ts src/runtime/run-recorder.ts src/runtime/index.ts tests/run-recorder.test.ts docs/superpowers/
git commit -m "feat(runtime): universal durable event log for agent runs (L1-D1)"
```

---

## Self-review notes

- **Spec coverage:** implements D1 first-slice from the L1 design (single-agent path → events into a default store). D2 (determinism) and D3 (engine collapse) are out of scope by design.
- **Type consistency:** `EventRecorder` methods identical across interface (Task 2), impl (Task 3), and call sites (Task 4). `executionId`/`graphId`/`uid` imported from `graph/types.ts` (confirmed exported).
- **No new deps.** Reuses `InMemoryEventStore`.
