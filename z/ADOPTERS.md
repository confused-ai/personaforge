# Adopters

Teams and products using `personaforge` in production. Add yourself by opening a
PR against this file — one line is enough, more if you'd like to share how
you're using it. We especially value entries that name a concrete use case
(support bot, code review, RAG chatbot, agentic ETL, etc.) so newcomers can
find peers.

## Format

```
- **[Company / project](https://link)** — one-line description of what
  personaforge powers. _Optional:_ modules used (agents / teams / workflow /
  serve / observe / guardrails / …).
```

## Adopters

<!-- START adopters — keep alphabetical by company/project name -->
<!--
- **[Example Corp](https://example.com)** — internal support-triage assistant
  running on `personaforge/agent` + `personaforge/serve`, with
  `personaforge/observe` piping traces to Langfuse.
-->
<!-- END adopters -->

## Case studies

Longer write-ups live in `docs/case-studies/` (one Markdown file per adopter).
See the [`case-study-template.md`](docs/case-studies/case-study-template.md) for
the structure. Include: workload shape, agents/teams topology, model choices,
evaluation approach, and any lessons learned. Case studies do **not** need
production numbers — architecture and honest tradeoffs are more useful than
metrics.

## Why add yourself

- **You get discovered.** Downstream integrations (agent gateways, eval tools,
  observability vendors) look at this file when planning framework support.
- **You steer the roadmap.** We prioritise fixes and features against real
  adopter workloads before speculative ones.
- **You help newcomers.** A concrete peer using the same shape (RAG, tools,
  workflows, …) is worth a hundred blog posts.

## What we ask in return

Nothing paid. If personaforge saves you time, opening a PR here — or filing a
useful bug report — is the whole exchange.
