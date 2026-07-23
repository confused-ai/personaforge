---
title: Team Modes
description: createModeTeam — route, coordinate, and collaborate multi-agent team modes for delegating, synthesizing, or merging specialist agent outputs.
outline: [2, 3]
---

# Team Modes

`createModeTeam` is ergonomic sugar over the orchestration layer for three common multi-agent patterns. Each mode has different routing and aggregation semantics.

```ts
import { createModeTeam } from 'confused-ai/orchestration';
```

| Mode | Behaviour |
|---|---|
| `route` | Leader picks **one** specialist per query |
| `coordinate` | All specialists respond; leader **synthesizes** one answer |
| `collaborate` | All specialists respond; outputs are **merged** verbatim |

---

## `route`

The leader agent selects the single best specialist for each query. Requires a `leader`.

```ts
const team = createModeTeam({
  mode: 'route',
  leader: routerAgent,
  agents: [mathAgent, proseAgent, codeAgent],
});

const result = await team.run('What is the derivative of x^2?');
// result.text            — the selected agent's answer
// result.contributions   — [{ agent: 'math', text: '...' }]
```

The leader is prompted with each agent's `instructions` as a manifest and asked to return `{"agent": "<name>"}`. Falls back to the first agent if selection is ambiguous.

---

## `coordinate`

Every specialist answers in parallel, then the leader synthesizes a single coherent response. Requires a `leader`.

```ts
const team = createModeTeam({
  mode: 'coordinate',
  leader: editorAgent,
  agents: [researchAgent, factCheckAgent],
  maxRounds: 1,
});

const result = await team.run('Explain quantum computing.');
// result.text           — the synthesized answer
// result.contributions  — every specialist's raw response
```

---

## `collaborate`

Every specialist answers; outputs are merged verbatim with agent labels. No leader needed.

```ts
const team = createModeTeam({
  mode: 'collaborate',
  agents: [optimistAgent, skepticAgent],
});

const result = await team.run('Should we adopt this technology?');
// result.text: "[optimist]: ...\n\n[skeptic]: ..."
```

---

## Team result shape

```ts
interface TeamResult {
  text: string;                                        // aggregated answer
  contributions: Array<{ agent: string; text: string }>;
}
```

---

## Choosing a mode

- **route** — mutually exclusive specialties (a math agent vs a writing agent). Cheapest: only one specialist runs.
- **coordinate** — overlapping perspectives that should merge into one authoritative answer.
- **collaborate** — you want to preserve each voice (e.g. a debate, or multiple independent drafts).

---

## Related pages

- [Orchestration](/guide/orchestration) — full multi-agent primitives (supervisor, swarm, pipeline).
- [Reasoning Tools](/guide/reasoning-tools) — structured thinking for individual agents.
