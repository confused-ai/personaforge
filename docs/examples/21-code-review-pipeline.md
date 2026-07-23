---
title: 21 · Code Review Pipeline
description: Chain specialist agents into a sequential code review pipeline using compose() and pipe(). Each stage passes its output to the next.
outline: [2, 3]
---

# 21 · Code Review Pipeline

Sequential pipelines are the simplest multi-agent pattern: the output of each stage becomes the input of the next. `compose()` and `pipe()` make this explicit and testable without requiring a full orchestration graph.

---

## What you'll learn

- How to chain agents with `compose()` for a fixed pipeline
- How to build step-by-step with `pipe().then()`
- How to add conditional steps with `when` predicates
- How to transform output between stages with `transform`
- When to use pipelines vs the graph engine

---

## Three-stage code review pipeline

```ts
import { createAgent, compose } from 'personaforge';

// ── Stage 1: Understand the diff ─────────────────────────────────────────────
const diffAnalyser = createAgent({
  name: 'diff-analyser',
  instructions: [
    'You receive a git diff as input.',
    'Produce a concise summary of what changed: which functions were modified,',
    'what was added or removed, and the apparent intent of the change.',
  ].join(' '),
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

// ── Stage 2: Security review ─────────────────────────────────────────────────
const securityReviewer = createAgent({
  name: 'security-reviewer',
  instructions: [
    'You receive a summary of code changes.',
    'Review for security risks: authentication bypasses, injection vulnerabilities,',
    'insecure direct object references, exposed secrets, and missing input validation.',
    'If no issues are found, say "No security concerns found."',
  ].join(' '),
  model: 'gpt-4o',   // better model for security analysis
  apiKey: process.env.OPENAI_API_KEY!,
});

// ── Stage 3: Write the review comment ────────────────────────────────────────
const reportWriter = createAgent({
  name: 'report-writer',
  instructions: [
    'You receive a diff summary and a security review.',
    'Write a concise, actionable pull request review comment.',
    'Use markdown. List issues with severity (critical / warning / suggestion).',
    'End with an overall verdict: Approve, Request Changes, or Needs Discussion.',
  ].join(' '),
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

// ── Build the pipeline ────────────────────────────────────────────────────────
const reviewPipeline = compose(diffAnalyser, securityReviewer, reportWriter);

// ── Run it ────────────────────────────────────────────────────────────────────
const diff = `
diff --git a/src/auth/jwt.ts b/src/auth/jwt.ts
index 4a3f2b1..8c9d3a7 100644
--- a/src/auth/jwt.ts
+++ b/src/auth/jwt.ts
@@ -12,7 +12,11 @@ export function verifyToken(token: string): User {
-  const payload = jwt.verify(token, process.env.JWT_SECRET!);
+  try {
+    const payload = jwt.verify(token, process.env.JWT_SECRET!);
+    return payload as User;
+  } catch {
+    return { id: 'anonymous', role: 'guest' };
+  }
`;

const result = await reviewPipeline.run(diff);
console.log(result.text);
```

---

## Fluent builder with `pipe()`

`pipe()` is the step-by-step alternative to `compose()`. It's easier to read when you need per-step options.

```ts
import { createAgent, pipe } from 'personaforge';

const result = await pipe(diffAnalyser)
  .then(securityReviewer, {
    // Add context so the reviewer knows this is specifically about auth changes
    transform: (r) => `Auth module changes:\n\n${r.text}\n\nFocus on authentication and session handling.`,
  })
  .then(reportWriter, {
    // Only write the report if security found something worth reporting
    when: (r) => !r.text.toLowerCase().includes('no security concerns'),
    transform: (r) => `Security findings to address:\n\n${r.text}`,
  })
  .run(diff);

if (result) {
  console.log(result.text);
} else {
  console.log('No security issues — LGTM!');
}
```

---

## Multi-file pipeline

Run multiple diffs through the same pipeline:

```ts
const diffs = [
  { file: 'src/auth/jwt.ts',      diff: '...' },
  { file: 'src/payments/stripe.ts', diff: '...' },
  { file: 'src/api/users.ts',     diff: '...' },
];

const reviews = await Promise.all(
  diffs.map(async ({ file, diff }) => {
    const result = await reviewPipeline.run(
      `File: ${file}\n\n${diff}`,
    );
    return { file, review: result.text };
  }),
);

for (const { file, review } of reviews) {
  console.log(`\n=== ${file} ===`);
  console.log(review);
}
```

---

## `compose()` vs `pipe()` at a glance

| Feature | `compose()` | `pipe()` |
|---|---|---|
| API style | Functional — all agents passed at once | Fluent — `.then()` chain |
| Per-step options | Via `options` argument on compose | Via options object on `.then()` |
| Conditional steps | Via `when` in options | Via `when` on each `.then()` |
| Best for | Simple fixed pipelines | Step-by-step construction with varying options |

---

## When to use pipelines vs the graph engine

Use `compose()` / `pipe()` when:
- Stages always run in a fixed order
- You only need the final stage output
- There are no parallel branches or loops

Move to `createGraph()` when:
- Steps need parallel fan-out and a join
- The pipeline has retry loops or cycles
- You need durable checkpointing across process restarts
- There are more than 2–3 conditional branches

---

## What's next?

- [09 · Supervisor Workflow](./09-supervisor) — explicit coordination with `createSupervisor`
- [Compose guide](../guide/compose) — full `compose()` and `pipe()` API reference
- [Graph workflows](../guide/graph) — DAG execution for complex multi-path flows
