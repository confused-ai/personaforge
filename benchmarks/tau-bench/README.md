# τ-bench — tool-agent benchmark for personaforge

A self-contained benchmark suite that measures how well personaforge agents
complete **multi-step, tool-calling tasks** — the same capability class that
τ-bench (retail/airline domains) and SWE-bench test.

## Design

Each task is defined as:

```ts
interface AgentTask {
  id: string;
  /** Natural-language instruction the agent receives */
  instruction: string;
  /** Tools available to the agent */
  tools: Tool[];
  /** A pure verifier: did the agent achieve the intended outcome? */
  verify: (toolCalls: ToolCall[], finalText: string) => boolean;
}
```

The verifier checks tool-call arguments and ordering — not LLM prose style.
This makes scores stable across model versions and reproducible in CI.

## Running

```bash
# Hermetic (mock LLM, deterministic): always in CI via `bun run test`
bun run test tests/tau-bench-hermetic.test.ts

# Live (real LLM, publishable scores): opt-in
OPENAI_API_KEY=... bun run test:integration
```

## Domains (initial)

| Domain   | Tasks | Tests                          |
|----------|-------|--------------------------------|
| Retail   |   5   | order lookup, cancel, totals   |
| Data     |   5   | query, filter, aggregate       |
| Coding   |   3   | rename, bug-fix, add export    |

More domains are added by dropping a task file in `benchmarks/tau-bench/tasks/`.


## Published results

Live run against **`gpt-4o-mini`** on 2026-07-24:

| Domain   | Passed | Total | Pass rate |
|----------|--------|-------|-----------|
| retail   |   4    |   5   |  80.0%    |
| data     |   5    |   5   | 100.0%    |
| coding   |   3    |   3   | 100.0%    |
| **all**  | **12** | **13**| **92.3%** |

_Total wall time: ~106s for 13 sequential tool-calling tasks._

### The bug this benchmark found

The very first live run scored 3/13 (23.1%) with retail at 0%. Every
argument-requiring task failed with `wrong orderId: undefined` — the model was
calling tools but never passing the right arguments.

Root cause: `src/agentic/_zod-to-schema.ts` read `def.shape` as an object, but
Zod v3's `ZodObject.shape` is a lazy **function**. Every tool declared via
`tool({ parameters: z.object({...}) })` was sending an empty JSON-Schema
(`{properties: {}, additionalProperties: true}`) to the LLM. Fixed in the same
session; the same run then scored **12/13 (92.3%)**.

Regression guarded by `tests/tool-schema-generation.test.ts`.


## Cross-framework comparison

The harness can score **any** framework side-by-side with personaforge:

- `personaforge` — in-process (no server)
- `langgraph`   — `benchmarks/tau-bench/servers/langgraph_server.py`
- `agno`        — `benchmarks/tau-bench/servers/agno_server.py`
- `crewai`      — `benchmarks/tau-bench/servers/crewai_server.py`
- `mastra`      — `benchmarks/tau-bench/servers/mastra-server.ts`
- Any other framework that speaks the protocol in
  `benchmarks/tau-bench/PROTOCOL.md`.

Each competitor is a single self-contained server that:
1. Instantiates its own agent using its native primitives.
2. Receives the same task instruction, tool schemas, and step budget.
3. Returns the ordered tool calls it made + final text.

Verifiers are pure and identical for every framework, so pass-rate differences
reflect the framework's tool-calling loop quality, not tool implementations.

### Run a comparison

Start the servers you want to include, then:

```bash
OPENAI_API_KEY=sk-... \
PF_FRAMEWORKS="langgraph=http://localhost:8812,agno=http://localhost:8815" \
bun benchmarks/tau-bench/compare.ts
```

Output is a single markdown table sorted by pass-rate, e.g.:

| Framework | Version | Pass rate | Passed/Total | Avg steps | Avg s/task |
|-----------|---------|-----------|--------------|-----------|------------|
| personaforge | 2.4.3 | 92.3% | 12/13 | 3.4 | 8.07 |
| langgraph    | 0.2.x |  …    |  …    |  …    |  …    |
| agno         | …     |  …    |  …    |  …    |  …    |

_Numbers you publish here are the numbers you can run yourself with the servers
in `benchmarks/tau-bench/servers/`. No fabricated comparisons._
