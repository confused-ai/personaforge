---
title: Control Plane
description: A zero-dependency AgentOS dashboard server — browse sessions, inspect memory, run evals, view traces, manage HITL approvals, administer knowledge, and chat with agents from one UI.
outline: [2, 3]
---

# Control Plane

`createControlPlane` starts a zero-dependency HTTP dashboard for operating your agents: sessions, memory, evals, traces, HITL approvals, knowledge, and a chat playground — all from one browser tab.

```ts
import { createControlPlane } from 'personaforge/control-plane';
```

---

## Quick start

```ts
const cp = createControlPlane({
  agents: [
    { name: 'support', run: (prompt) => supportAgent.run(prompt) },
  ],
  sessionStore,
  evalStore,
  traceStore,
  approvalStore,
  knowledgeStore,
});

await cp.start(4100);
console.log('Control plane on http://localhost:4100');
```

Open the URL to get a tabbed dashboard. Every panel is backed by a JSON API under `/api/*`, so you can also drive it programmatically or build a custom frontend.

---

## Panels

| Panel | Backed by | Endpoint |
|---|---|---|
| Sessions | `sessionStore.list()` / `load(id)` | `/api/sessions` |
| Memory | `memory store` (inspector) | — |
| Evals | `evalStore.list()` | `/api/evals` |
| Traces | `traceStore.list()` | `/api/traces` |
| Approvals | `approvalStore.listPending/approve/reject` | `/api/approvals` |
| Knowledge | `knowledgeStore.listDocuments()` | `/api/knowledge` |
| Chat | `agents[].run()` | `/api/chat` |

Every config field is optional — the dashboard degrades gracefully, showing an empty state for panels without a backing store.

---

## Wiring stores

The config uses structural interfaces so your existing stores usually fit without adapters:

```ts
createControlPlane({
  sessionStore: {
    list: () => store.listSessions(),
    load: (id) => store.getSession(id),
  },
  approvalStore: {
    listPending: () => approvals.listPending(),
    approve: (id) => approvals.approve(id),
    reject: (id) => approvals.reject(id),
  },
});
```

---

## HITL approval queue

The Approvals panel lists pending requests with Approve / Reject buttons wired to `POST /api/approvals/approve?id=…` and `…/reject`. Combine with the [HITL guide](/guide/hitl) so agents pause on risky actions and a human resolves them from the dashboard.

---

## Chat playground

The Chat panel posts to `/api/chat` with `{ agent, prompt }` and streams the agent's reply into a log. Use it for smoke-testing agents without writing a client.

---

## Stopping

```ts
await cp.stop();
```

---

## Production notes

- The server has **no external dependencies** — pure `node:http`.
- Put it behind your own auth proxy; it does not ship authentication.
- Request bodies are capped at 64 KB to avoid unbounded memory growth.

---

## Related pages

- [Admin API](/guide/admin-api) — health, audit, throughput endpoints.
- [Observability](/guide/observability) — trace and metric sources.
- [Human-in-the-Loop](/guide/hitl) — the approval workflow behind the queue.
