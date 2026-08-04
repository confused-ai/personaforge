---
title: Code Mode
description: Run multi-tool computations in an isolated sandbox. The model writes a function that orchestrates your tools as external_* functions and returns one structured answer.
outline: [2, 3]
---

# Code Mode

`personaforge/code-mode` lets an agent answer a multi-tool query with **one tool call**: the model writes a JavaScript/TypeScript function that orchestrates your existing tools as `external_*` functions and reduces/aggregates their results into a single structured answer. Fewer round-trips, correct arithmetic, smaller context.

```ts
import { createCodeMode } from 'personaforge/code-mode';
```

---

## Quick start

```ts
import { createCodeMode } from 'personaforge/code-mode';
import { agent } from 'personaforge';

const { tool, instructions } = createCodeMode({
  tools: { getTopProducts, getProductRatings }, // scoped tools
  sandbox: new LocalSandbox(),                   // default: isolated node process
});

const shopping = agent({
  instructions: ['You are a helpful shopping assistant.', instructions],
  tools: { execute_typescript: tool },           // one tool for the LLM
});
```

Now the model can call `execute_typescript` with code like:

```js
const tops = await external_getTopProducts({ limit: 5 });
const scores = await Promise.all(tops.map(t => external_getProductRatings({ id: t.id })));
return tops.map((t, i) => ({ ...t, avg: average(scores[i]) }));
```

The generated code calls your real tools through the host bridge and returns an exact computed answer — no more multi-step tool-call round trips and no arithmetic hallucination.

---

## Scoped tools

Pass the tools the generated code may call as `external_*` functions. Each takes a single object argument and returns a Promise of its result:

```ts
const { tool, instructions } = createCodeMode({
  tools: [getTopProducts, getProductRatings],   // array or record form
});
```

Arguments are validated against each tool's parameter schema before execution, and the caller's tool context (agent/session identity, abort signal) is threaded through so tracing, approval, and audit keep working.

---

## Sandboxes

### `LocalSandbox` (default) — isolated child process

Spawns an isolated `node` child process over JSON-lines IPC. The script has **no filesystem, network, or module access** beyond the bridged tool calls — the strongest built-in boundary.

### `VMSandbox` — in-process `node:vm`

Runs in-process inside a `node:vm` context. Cheaper, but `vm` is **not a hard security boundary** — prefer `LocalSandbox` for untrusted input.

```ts
import { LocalSandbox, VMSandbox, createSandbox } from 'personaforge/code-mode';

const { tool } = createCodeMode({ sandbox: new VMSandbox() });
// or by name:
const sandbox = createSandbox('local'); // | 'vm'
```

---

## Options

```ts
export interface CodeModeOptions {
  id?: string;                    // default 'execute_typescript'
  description?: string;           // tool description
  tools?: Record<string, Tool | LightweightTool> | Array<Tool | LightweightTool>;
  sandbox?: Sandbox;              // default LocalSandbox
  timeoutMs?: number;             // default 60_000
  maxCodeChars?: number;          // default 16_000
  maxOutputChars?: number;        // default 100_000
}
```

The returned `tool` returns `{ result, stdout, executionMs }` on success. Failures throw with the sandbox error (and any captured stdout) attached.

---

## Related pages

- [Tools](./tools) — `tool()` and the tool helper.
- [Skills](./skills) — pre-built skill bundles.
- [Agentic Runner](./agents) — how tool calls execute in the loop.