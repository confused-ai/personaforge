---
title: <Company or project name>
adopter: <Company or project name>
url: <https://link>
date: <YYYY-MM-DD>
modules: [agent, tools, serve, observe]
---

# <Company or project name>

_One-sentence description of what personaforge powers here._

## Workload shape

- **User-facing?** internal / customer-facing / batch
- **Volume:** approx runs per day (order of magnitude is fine)
- **Latency budget:** interactive (< 5s) / conversational (< 30s) / batch
- **Cost sensitivity:** ($$$ / $$ / $) — matters when you tune model choice

## Agent topology

Describe the smallest thing that captures the shape: single agent, a supervisor +
specialists team, a directed workflow, or a graph. Name the primitives you used
(`agent`, `createTeam`, `createWorkflow`, `graph`) and where handoffs happen.

## Models

| Role         | Model                       | Why this one     |
|--------------|-----------------------------|------------------|
| planner      | e.g. gpt-4o                 | reasoning quality |
| worker       | e.g. gpt-4o-mini            | cost / latency    |
| guard        | e.g. claude-3-5-haiku       | second-opinion    |

## Evaluation

- **Offline suite:** what you regress before shipping. `personaforge/eval`?
  τ-bench? custom?
- **Online:** what you watch after shipping. `personaforge/observe`? Langfuse?

## Tradeoffs and lessons

- The one thing you'd tell yourself six months ago.
- The one thing that surprised you.
- The one thing you'd change about the framework.

## Reproducing

If your setup can be shared, link the smallest reproducible example (a repo
folder, a Gist, or a snippet). If not, name the shape so newcomers can build
their own from the corresponding personaforge examples.
