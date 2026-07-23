---
title: Concepts
description: Learn the mental model behind personaforge so the modules make sense before you wire them together.
outline: [2, 3]
---

# Concepts

`personaforge` becomes much easier to use when you stop thinking of it as a pile of modules and start thinking of it as a layered system. Each layer solves a different problem, and most applications only need some of them.

## The core mental model

At the center is the agent. Around that core are the layers that give the agent context, execution boundaries, and operational controls.

| Layer | Purpose |
|---|---|
| Agent | instructions, model choice, tools, and runtime behavior |
| Tools | live data access and controlled side effects |
| Sessions and memory | continuity across runs and selected recall |
| Knowledge and storage | document retrieval and durable application state |
| Runtime | HTTP serving, scheduling, and transport boundaries |
| Coordination | composition, workflows, teams, supervisors, and reasoning |
| Operations | observability, budgets, approvals, resilience, and guardrails |

## Why the single-package story matters

The public install story is intentionally simple: install `personaforge` once, then move to dedicated public subpaths only when a concern becomes explicit.

That matters because it lets the architecture grow without forcing you to reorganize the entire app just because the agent got more capable.

## How complexity should grow

The framework works best when complexity grows outward from a stable center:

1. first the agent works
2. then the agent can access what it needs
3. then the runtime becomes durable and observable
4. then coordination and policy layers get added where justified

If you invert that order, you usually end up debugging infrastructure before you understand the model behavior.

## The main design principle

Every new layer should answer a specific missing requirement. Add a feature because you know why it is needed, not because the framework happens to offer it.

That keeps the final system cleaner and makes the documentation path easier to follow in practice.

## Where to go next

- Read `agents.md` for the authoring model.
- Read `tools.md` for the system boundary model.
- Read `workflows.md` and `orchestration.md` when one agent is no longer enough.