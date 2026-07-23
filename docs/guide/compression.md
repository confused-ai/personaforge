---
title: Compression
description: Reduce context size when long conversations or large tool outputs exceed the model window. CompressionManager compresses tool results in-place via LLM summarisation with configurable triggers.
outline: [2, 3]
---

# Compression

`CompressionManager` detects when message threads have grown too large and compresses verbose tool outputs into compact, fact-preserving summaries — in-place, without losing the context the task depends on.

```ts
import { CompressionManager } from 'personaforge';
```

---

## Quick start

```ts
import { createAgent } from 'personaforge';

// Mastermind context compression is built into createAgent and ON by default.
// It compresses tool outputs, logs, code, and history before they reach the LLM.
const agent = createAgent({
  name: 'research-agent',
  instructions: 'Research topics in depth using multiple searches.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  // Pass a MastermindConfig to tune it — or `mastermind: false` to disable.
  mastermind: {
    contextTokenBudget: 16_000,    // keep history under ~16k tokens
    messageTokenThreshold: 2_000,  // compress messages larger than ~2k tokens
    compressToolResults: true,
  },
});

// Inspect cumulative savings after runs:
await agent.run('Research the history of TypeScript.');
const stats = agent.getCompressionStats();
console.log(`saved ${stats?.tokensSaved} tokens (~$${stats?.costSavedUsd.toFixed(4)})`);
```

---

## `CompressionManager` API

### Constructor options

```ts
interface CompressionManagerConfig {
  /** LLM callable for summarisation */
  generate: (messages: Array<{ role: string; content: string }>) => Promise<string>;

  /** Whether to compress tool / function call results (default: true) */
  compressToolResults?: boolean;

  /** Minimum number of tool messages before compressing (default: 3) */
  compressToolResultsLimit?: number;

  /**
   * Single-message content token threshold above which compression triggers
   * regardless of message count. Estimated as content.length / 4.
   * Set to 0 to disable. (default: 4096)
   */
  compressTokenLimit?: number;

  /** Override the default compression system prompt */
  prompt?: string;

  debug?: boolean;
}
```

### Methods

```ts
// Check if the message list needs compression
cm.shouldCompress(messages);

// Compress tool-result messages in-place (sequential)
await cm.compress(messages);

// Compress in parallel (faster for large batches)
await cm.acompress(messages);
```

---

## What gets compressed

- Tool / function-call result messages where content exceeds `compressTokenLimit`
- Any batch of tool-result messages that reaches `compressToolResultsLimit`

Compressed messages have the original content replaced with a fact-preserving summary. The original `role` and all other message fields are preserved.

---

## Manual use in hooks

You can also trigger compression explicitly in an `afterRun` hook or before sending to the model:

```ts
const agent = createAgent({
  name: 'deep-researcher',
  instructions: '...',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  hooks: {
    beforeRun: async (input) => {
      if (compression.shouldCompress(input.messages)) {
        await compression.acompress(input.messages);
      }
      return input;
    },
  },
});
```

---

## Default compression prompt

The built-in prompt instructs the model to:
1. Preserve all key facts, entities, IDs, numbers, names, dates.
2. Remove filler, pleasantries, repeated boilerplate, and excess whitespace.
3. Keep the same language as the input.
4. Output only the compressed content — no preamble.

Override it with the `prompt` option if your domain has specific compression requirements.

---

---

## Mastermind Context Compression Suite

While `CompressionManager` handles general summarization, the **Mastermind** compression pipeline is a production-grade, multi-stage compression engine. It optimizes KV-cache reuse, compresses message formats using specialized parsers, enforces strict token budgets, and stashes original data in an on-demand retrieval store (CCR).

The pipeline executes four stages on every run:
1. **CacheAligner**: Stabilizes the prefix of the message history to maximize KV-cache hits.
2. **Content Routing & Crusher Dispatch**: Routes message content based on type (JSON, Code, Logs, CSV, XML) to specialized, deterministic parsing algorithms that compress the text without LLM latency.
3. **Group-based Budget Enforcement**: Drops conversation groups oldest-first to fit within a strict token budget, while ensuring tool calls and tool results are never orphaned.
4. **Code & Context Reduction (CCR)**: Replaces original content with compressed annotations, stashing the originals. Re-injects a retrieval tool so the agent can fetch the raw details if needed.

```ts
import { Mastermind, OpenAIProvider } from 'personaforge';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });

const mastermind = new Mastermind({
  contextTokenBudget: 16_000,        // Fit history within 16k tokens
  messageTokenThreshold: 1_500,       // Only compress messages larger than 1.5k tokens
  enableCCR: true,                    // Allow agents to retrieve uncompressed content
  recentMessagesWindow: 4,            // Keep the last 4 messages completely uncompressed
  generate: async (msgs) => {         // Fallback LLM summarizer for prose
    const res = await provider.generateText({
      messages: msgs,
      model: 'gpt-4o-mini',
    });
    return res.text;
  },
});

const agent = createAgent({
  name: 'mastermind-agent',
  instructions: 'Use your tools to solve tasks.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  // Expose the retrieve tool so the agent can recall compressed details
  tools: [mastermind.retrieveTool],
  hooks: {
    beforeRun: async (input) => {
      const { messages } = await mastermind.compress(input.messages);
      // Materialize replaces message contents with their compressed versions
      input.messages = Mastermind.materialize(messages);
      return input;
    },
  },
});
```

### Stage 1: Cache Aligner
LLM providers charge less and respond faster when prompts hit their KV-cache. The `CacheAligner` normalizes whitespaces, matches repetitive formatting, and structures history headers so prefix matches are maximized.

### Stage 2: Specialized Crushers
Instead of relying purely on expensive LLMs to summarize structural data, Mastermind inspects the text and routes it to optimized local parsers:
* **JSON Crusher (`smart-crusher`)**: Strips empty properties, normalizes indentation, and collapses deeply nested schemas.
* **Code Compressor**: Minifies JS/TS, python, and other codeblocks by removing comments, redundant blank lines, and compressing indentation.
* **Log Crusher**: Aggregates duplicate trace lines, strips timestamps, and retains only unique stack traces or warning/error contexts.
* **CSV / XML Crushers**: Retains headers while truncating or downsampling datasets.
* **Prose Summarizer (`summary-llm`)**: Falls back to an LLM summary ONLY when unstructured markdown/prose is detected.

### Stage 3: Sliding-Window Group Budget Enforcement
When history exceeds the budget, Mastermind drops the oldest messages. However, standard truncation often separates a tool call from its tool result, breaking the ReAct loop. Mastermind groups assistant tool calls and their subsequent tool results into **atomic blocks** that are dropped together, ensuring the conversation tree remains valid.

### Stage 4: Code & Context Reduction (CCR)
For highly detailed inputs, compression can lose crucial bits. Under CCR:
1. Mastermind compresses the message and stashes the raw string in an in-memory `CCRStore`.
2. The message is annotated with a handle, e.g. `[ccr_0001 — call mastermind_retrieve("ccr_0001") for full content]`.
3. If the agent needs the exact values, it invokes the built-in `mastermind_retrieve` tool — `execute({ handle, query? })`. Pass a `query` to get back only the original lines matching it (case-insensitive); omit it to get the full original.

### Session stats & inspection

Every `Mastermind` instance tracks cumulative savings and exposes budget / CCR inspection:

```ts
// Cumulative savings across every compress() call on this instance
const life = mastermind.stats();
console.log(life.tokensSaved, life.costSavedUsd);  // plus life.recent[] ring buffer

// Is the current message list over the token budget?
mastermind.isOverBudget(messages);

// CCR store occupancy
mastermind.ccrStats();  // { size, maxEntries }
```

Attached to an agent via the `mastermind` option, the same lifetime dashboard is available through `agent.getCompressionStats()`.

### Also in the compression module

Beyond `CompressionManager` and `Mastermind`, `personaforge/compression` also exports standalone utilities: `HuffmanCodec` (+ `compressContext` / `decompressContext`), `SummaryBufferMemory`, `createSlidingWindow` / `applyWindow`, `EntityExtractionMemory`, `createTokenCounter` / `countTokens` / `contextBudget`, the structural crushers (`crushJsonText`, `compressCode`, `crushLog`, `crushXml`, `crushCsv`), and the CCR primitives `CCRStore` / `createRetrieveTool`.

---

## Where to go next

- [Session](./session) — conversation persistence; use compression to keep sessions lean.
- [Memory](./memory) — retain selected facts rather than summarising everything.
- [Context providers](./context-provider) — inject context deliberately instead of accumulating it.

