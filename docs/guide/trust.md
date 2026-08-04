---
title: Trust & Reliability
description: Why teams trust personaforge for production AI agents — security policy, 1,500+ CI tests, τ-bench benchmarks, coverage gates, observability, audit logging, and open-source governance.
outline: [2, 3]
---

# Trust & Reliability

Choosing an agent framework is a production bet. This page collects the **evidence** behind personaforge — not just what it can do, but how it is tested, secured, benchmarked, and governed.

---

## At a glance

| Signal | Detail |
|---|---|
| **License** | MIT — use commercially, fork freely, zero lock-in |
| **Telemetry** | No telemetry sent by default. Your data stays in your infrastructure. |
| **Language** | TypeScript-first — same runtime as your application |
| **Package model** | One `npm install`, 70+ tree-shakeable subpaths |
| **Security contact** | Private disclosure via [SECURITY.md](https://github.com/confused-ai/personaforge/blob/main/SECURITY.md) |
| **Response SLA** | 72-hour acknowledgement, 14-day patch cycle for critical issues |

---

## Security {#security}

personaforge ships with security controls designed for production agent workloads — not as optional plugins.

### Vulnerability disclosure

Report security issues privately via [SECURITY.md](https://github.com/confused-ai/personaforge/blob/main/SECURITY.md). **Do not** open public GitHub issues for vulnerabilities.

### Built-in protections

| Control | What it does |
|---|---|
| **Guardrails engine** | PII detection, prompt-injection defense, content moderation hooks |
| **JWT RBAC** | Role-based access on HTTP routes with timing-safe verification |
| **SSRF-protected tools** | URL allow-lists and network isolation on outbound tool calls |
| **Secret manager adapters** | AWS Secrets Manager, Azure Key Vault, HashiCorp Vault, GCP Secret Manager |
| **ShellTool isolation** | Not in the default barrel — requires explicit import and container sandboxing |
| **Rate limiting** | In-process and Redis-backed distributed rate limiters |
| **Budget enforcement** | Per-user and per-tenant USD cost caps |

### Production hardening checklist

Before shipping to production, verify:

- [ ] LLM API keys in environment variables, never in source
- [ ] `rateLimit` wired into `createHttpService`
- [ ] PII guardrails enabled for user-facing agents
- [ ] Budget caps configured per tenant
- [ ] HTTPS termination in front of the agent service
- [ ] `personaforge doctor` run in CI to validate configuration
- [ ] ShellTool disabled or running inside a sandboxed container
- [ ] OTLP tracing exported to your observability backend

See [Guardrails & Safety](./guardrails), [Production](./production), and [Secret Manager](./secret-manager) for implementation details.

---

## Testing {#testing}

Every release is gated by an automated test suite designed for agent workloads — not just unit tests on utility functions.

### By the numbers

| Metric | Value |
|---|---|
| Test cases | **1,500+** |
| Test files | **124** |
| CI coverage floor (`src/`) | **43%** lines (ratcheting toward 75%) |
| CI coverage floor (`packages/`) | **48%** lines |
| Live API calls in CI | **None** — MockLLMProvider for deterministic runs |

### How we test agents

- **MockLLMProvider** — deterministic LLM responses without API keys or network calls
- **MockToolRegistry** — fixture helpers for tool-call assertions
- **Hermetic integration tests** — full agent loops run in CI with zero external dependencies
- **Regression detection** — `replayDataset` and `diffResults` for eval regression
- **Coverage ratchet** — thresholds increase quarterly; CI blocks PRs that drop below the floor

```bash
# Run the full test suite locally
bun run test

# Hermetic τ-bench (always in CI)
bun run test tests/tau-bench-hermetic.test.ts
```

See [Evaluation & Benchmarking](./eval) and the [testing runbook](../runbooks/testing.md).

---

## Benchmarks {#benchmarks}

Capability claims need measurable proof. personaforge ships a τ-bench-style harness that scores agents on **tool-calling correctness** — not prose quality.

### Published results

Live run against **gpt-4o-mini** (2026-07-24):

| Domain | Passed | Total | Pass rate |
|---|---|---|---|
| Retail | 4 | 5 | 80.0% |
| Data | 5 | 5 | 100.0% |
| Coding | 3 | 3 | 100.0% |
| **All** | **12** | **13** | **92.3%** |

Scores are **verifier-based**: each task checks tool-call arguments and ordering, making results reproducible across model versions and stable in CI.

### Cross-framework protocol

The same harness runs identical tasks against personaforge, LangGraph, Agno, CrewAI, and Mastra. See [`benchmarks/tau-bench/PROTOCOL.md`](https://github.com/confused-ai/personaforge/blob/main/benchmarks/tau-bench/PROTOCOL.md) for the full protocol.

```bash
# Head-to-head vs Agno
bun examples/agno-vs-personaforge.ts
```

---

## Observability {#observability}

Production agents need visibility into every run — not just the final text output.

| Capability | Detail |
|---|---|
| **OTLP tracing** | Export to Jaeger, Datadog, Honeycomb, or any OTLP-compatible backend |
| **Structured logging** | Context-aware logs with run ID, session ID, and tenant |
| **Prometheus metrics** | Request counts, latency, token usage, error rates |
| **Audit log** | Tamper-evident append-only log (SQLite, Redis, or pluggable) |
| **Control plane** | Built-in dashboard for runs, sessions, and agent health |
| **Trace ↔ Dataset** | Convert production traces into eval datasets for regression testing |

See [Observability & OTLP](./observability) and [Control Plane](./control-plane).

---

## Open source governance

| Resource | Link |
|---|---|
| Source code | [github.com/confused-ai/personaforge](https://github.com/confused-ai/personaforge) |
| Changelog | [Changelog](../changelog) |
| Contributing | [CONTRIBUTING.md](https://github.com/confused-ai/personaforge/blob/main/CONTRIBUTING.md) |
| Security policy | [SECURITY.md](https://github.com/confused-ai/personaforge/blob/main/SECURITY.md) |
| License | [MIT](https://github.com/confused-ai/personaforge/blob/main/LICENSE) |
| npm package | [personaforge](https://www.npmjs.com/package/personaforge) |

### Supported versions

| Version | Support |
|---|---|
| 1.1.x | Current — full support |
| 1.0.x | Critical fixes only |
| < 1.0 | No support |

---

## Adopters & case studies

We believe trust comes from real production usage. If you're running personaforge in production, add yourself to [ADOPTERS.md](https://github.com/confused-ai/personaforge/blob/main/ADOPTERS.md) — one line is enough.

Longer architecture write-ups follow the [case study template on GitHub](https://github.com/confused-ai/personaforge/blob/main/docs/case-studies/case-study-template.md). We value honest tradeoffs over vanity metrics.

---

## What we don't claim

Honesty matters more than marketing copy.

| Claim | Reality |
|---|---|
| SOC2 / HIPAA **certified** | We ship audit-logging **capabilities** that support compliance workflows. We are not SOC2 or HIPAA certified. |
| Competitor benchmark superiority | Cross-framework τ-bench numbers are published via a shared protocol. We do not fabricate competitor scores. |
| 100% test coverage | Coverage is CI-gated at 43%+ and ratcheting quarterly. We publish the floor, not an aspirational target. |
| Zero bugs | We have a 72-hour security acknowledgement SLA and a public issue tracker. Report problems — we fix them. |

---

## Compare with other frameworks

See [Framework Comparisons](./comparisons) for the full capability matrix and migration guides for LangChain, CrewAI, LangGraph, Mastra, and Agno.

---

## Where to go next

- [Production](./production) — circuit breakers, retries, budget enforcement.
- [Guardrails & Safety](./guardrails) — PII, prompt injection, moderation.
- [Evaluation & Benchmarking](./eval) — LLM-as-judge, regression detection.
- [Getting Started](./getting-started) — first agent in minutes.
