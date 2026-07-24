# Cross-framework benchmark protocol (v1)

To score frameworks like `personaforge`, `agno`, `langgraph`, `mastra`,
`crewai`, `openai-agents-sdk`, `pydantic-ai` on the same τ-bench tasks, each
framework exposes a **single HTTP endpoint** that accepts a task descriptor and
returns the tool calls it made plus the final text.

The τ-bench harness scores every framework with the **same verifiers** so
results are directly comparable.

## Endpoint

```
POST {baseUrl}/tau-bench/run
Content-Type: application/json
```

### Request body

```jsonc
{
  "instruction": "What is the status of order W1002?",
  "systemPreamble": "You are a task-completing agent...",   // optional
  "tools": [
    {
      "name": "get_order",
      "description": "Look up an order by its id.",
      "parameters": { "type": "object", "properties": { "orderId": { "type": "string" } }, "required": ["orderId"] }
    }
  ],
  "maxSteps": 8,       // optional, default 8
  "maxToolCalls": 16   // optional safety ceiling
}
```

### Server behaviour

The server must:

1. Instantiate its own agent using its native framework primitives.
2. Give the agent the provided tool schemas — but **implement each tool as a
   stub that echoes back the arguments it was called with** (see below).
3. Run the agent for at most `maxSteps` LLM turns.
4. Return the ordered list of tool calls the agent actually made and the final
   assistant text.

The stub tool implementation is the fair-comparison trick: verifiers only care
about *what arguments the agent chose*, not *what the tool returned*. Every
framework runs the same agent loop against the same LLM with the same tool
schemas — differences in pass-rate reflect the framework's tool-calling loop
quality, prompt engineering, and reliability, not tool implementations.

For tasks whose verifier inspects a specific returned payload (rare), a server
may return a fixed canonical value from its stub — spec'd per task if needed.

### Response body

```jsonc
{
  "framework": "personaforge",
  "version": "2.4.3",
  "text": "Order W1002 status: shipped.",
  "toolCalls": [
    { "name": "get_order", "arguments": { "orderId": "W1002" }, "result": null }
  ],
  "steps": 2,
  "finishReason": "stop",
  "usage": { "promptTokens": 421, "completionTokens": 18, "totalTokens": 439 },
  "durationMs": 2760
}
```

`finishReason` must be one of `stop | tool_calls | max_steps | max_tokens | error`.

### Errors

Any error → HTTP 500 with `{"error": "…"}`. The harness records the task as
failed with the error message as the reason.

## Reference implementations

- `benchmarks/tau-bench/servers/personaforge-server.ts` — TypeScript, Bun
- `benchmarks/tau-bench/servers/agno_server.py` — Python (existing)
- `benchmarks/tau-bench/servers/langgraph_server.py` — Python (LangGraph)
- `benchmarks/tau-bench/servers/mastra-server.ts` — TypeScript (Mastra)
- `benchmarks/tau-bench/servers/crewai_server.py` — Python (CrewAI)

Each is a single file. If a framework you want to compare isn't listed, write a
new server that implements the endpoint above — no changes to the harness or
tasks are needed.
