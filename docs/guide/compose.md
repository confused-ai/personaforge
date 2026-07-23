---
title: Compose
description: Chain agents into linear pipelines with compose() and pipe(). Output of each agent becomes input of the next. Conditional hand-offs with when, output transformation with transform.
outline: [2, 3]
---

# Compose

`compose()` and `pipe()` chain agents into sequential pipelines. The output text of each agent becomes the prompt for the next. No graph required.

```ts
import { compose, pipe, createAgent } from 'personaforge';
```

---

## `compose()` — simple pipeline

```ts
import { createAgent, compose } from 'personaforge';

const researcher = createAgent({
  name: 'researcher',
  instructions: 'Research topics and return raw findings.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

const writer = createAgent({
  name: 'writer',
  instructions: 'Turn research findings into polished reports.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
});

// Always pass researcher output → writer
const pipeline = compose(researcher, writer);
const result = await pipeline.run('Write a report on TypeScript 5.5');
// result.text — the writer's final output
```

---

## Conditional hand-off

Use `when` to stop the pipeline early:

```ts
const pipeline = compose(researcher, writer, {
  // Only hand off to writer if research is substantial
  when: (result) => result.text.length > 200,
});
```

---

## Transform output between stages

Use `transform` to reshape the output before passing it to the next agent:

```ts
const pipeline = compose(researcher, writer, {
  transform: (result) => `Here are the research findings:\n\n${result.text}`,
});
```

---

## `pipe()` — fluent step-by-step builder

```ts
import { pipe } from 'personaforge';

const draft   = createAgent({ name: 'drafter',   instructions: 'Draft a blog post.', ... });
const editor  = createAgent({ name: 'editor',    instructions: 'Edit for clarity.', ... });
const publish = createAgent({ name: 'publisher', instructions: 'Format for publication.', ... });

const pipeline = pipe(draft)
  .then(editor,  { transform: (r) => `Edit this draft:\n\n${r.text}` })
  .then(publish, { when: (r) => r.text.length > 50 });

const result = await pipeline.run('TypeScript 5.5 features');
```

---

## Three-stage document pipeline

```ts
const summarizer = createAgent({ name: 'summarizer', instructions: 'Summarise this document in 3 bullet points.', ... });
const classifier = createAgent({ name: 'classifier', instructions: 'Classify the document: legal / technical / marketing.', ... });
const router     = createAgent({ name: 'router',     instructions: 'Given the classification, suggest the right team to handle this.', ... });

const result = await compose(summarizer, classifier, router, {
  transform: (r, i) => i === 0
    ? `Summary:\n${r.text}\n\nPlease classify this document.`
    : r.text,
}).run('CONTRACT-2024-001.pdf contents...');
```

---

## When to use `compose` vs graph

| Use case | Use |
|---|---|
| Linear, fixed-order pipeline | `compose()` / `pipe()` |
| Conditional branching | `pipe(...).then(agent, { when })` or [workflow-branching](./workflow-branching) |
| Cycles, loops, or revisiting stages | [Graph workflows](./graph) |
| Parallel execution | [Graph workflows](./graph) |
| Durable checkpointing across process restarts | [Graph workflows](./graph) |
| Supervisor / consensus / handoff patterns | [Orchestration](./orchestration) |

---

## Where to go next

- [Workflow branching](./workflow-branching) — conditional routing between stages.
- [Graph workflows](./graph) — DAG execution for complex multi-path flows.
- [Orchestration](./orchestration) — supervisor patterns and agent handoffs.
