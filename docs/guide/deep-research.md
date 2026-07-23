---
title: Deep Research Agent
description: createDeepAgent — an opinionated recipe for multi-step research that decomposes a question into sub-questions, researches each in parallel, and synthesizes a final answer with citations.
outline: [2, 3]
---

# Deep Research Agent

`createDeepAgent` packages planner + parallel sub-agents + compression into a single opinionated factory for long-horizon research tasks.

```ts
import { createDeepAgent } from 'confused-ai/skills';
```

---

## Quick start

```ts
const deep = createDeepAgent({
  generate: (prompt) => llm.generate(prompt),
  tools: [webSearchTool, wikipediaTool],
});

const result = await deep.run('What are the long-term economic effects of UBI?');
console.log(result.answer);
console.log(result.subQuestions);
console.log(result.rawSubAnswers);
console.log(result.steps.map((s) => `${s.phase}: ${s.detail}`));
```

---

## Pipeline

1. **Plan** — the LLM decomposes the question into focused sub-questions.
2. **Research** — each sub-question runs in parallel. Optional tools (search, Wikipedia) are called first, and their results are injected into the research prompt.
3. **Synthesize** — the findings are concatenated and a final synthesis prompt produces a structured answer with inline citations.

---

## Configuration

```ts
interface DeepAgentConfig {
  generate: (prompt: string) => Promise<string>;  // any LLM
  tools?: Array<{ name; description; execute }>;   // called per sub-question
  maxParallel?: number;      // default 5
  maxQuestions?: number;     // default 5
  subAnswerMaxChars?: number; // default 2000
}
```

---

## Result shape

```ts
interface DeepResearchResult {
  answer: string;                                  // multi-paragraph synthesis
  steps: Array<{ phase; detail }>;                 // audit trail
  subQuestions: string[];
  rawSubAnswers: Array<{ question; answer }>;
}
```

---

## Usage tips

- **Narrow `maxQuestions`** for simple queries to avoid over-decomposition.
- **Add a reranker** after the tool calls to filter noisy search results before feeding them to the sub-agent.
- **Chain with compression** if the synthesis prompt grows beyond the model's context window.

---

## Related pages

- [Planner](/guide/planner) — lower-level task decomposition.
- [Orchestration](/guide/orchestration) — multi-agent pipeline patterns.
- [Compression](/guide/compression) — token budget control.
