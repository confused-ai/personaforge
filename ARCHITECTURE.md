/**
 * Confused-AI — Architecture & Developer Guide
 *
 * > For the full architectural specification, interface contracts, ADRs, and data-flow
 * > diagrams, see docs/ARCHITECTURE-SPECIFICATION.md
 * >
 * > For the competitive analysis (Agno / LangChain / CrewAI), see docs/COMPETITIVE-ANALYSIS.md
 * >
 * > For the enterprise production-readiness audit, see docs/PRODUCTION-READINESS-AUDIT.md
 * >
 * > For production-grade integration blueprints, see docs/INTEGRATION-BLUEPRINTS.md
 * >
 * > For the strategic transformation roadmap (v1.2 → v2.0), see docs/STRATEGIC-TRANSFORMATION-ROADMAP.md
 *
 * ## Quick Start (5 seconds)
 *
 * ```ts
 * import { agent } from 'personaforge'
 * const a = agent('You are a helpful assistant.')
 * const result = await a.run('Summarize the news today.')
 * console.log(result.text)
 * ```
 *
 * ## Import Map — What to use, where
 *
 * | What you want                   | Import from              | Key exports                               |
 * |---------------------------------|--------------------------|-------------------------------------------|
 * | Create agents                   | `personaforge`            | `agent`, `createAgent`, `compose`, `pipe` |
 * | LLM providers                   | `personaforge/model`      | `openai()`, `anthropic()`, `ollama()`     |
 * | Define tools                    | `personaforge/tool`       | `tool()`, `createTools()`, `defineTool()` |
 * | Multi-agent workflows           | `personaforge/workflow`   | `compose`, `pipe`, `AgentRuntime`         |
 * | Production safety               | `personaforge/guard`      | `BudgetEnforcer`, `RateLimiter`, `CircuitBreaker` |
 * | HTTP server                     | `personaforge/serve`      | `serve()`, `createRouter()`               |
 * | Telemetry & logging             | `personaforge/observe`    | `createTracer()`, `createLogger()`        |
 * | Testing                         | `personaforge/test`       | `mockAgent()`, `scenario()`               |
 * | Low-level graph engine          | `personaforge/graph`      | `createGraph()`, `DAGEngine`              |
 * | Pluggable adapters              | `personaforge/adapters`   | `createAdapterRegistry()`                 |
 *
 * ## Architecture — Layers
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      Developer API                               │
 * │                                                                   │
 * │   import { agent, openai, tool, compose } from 'personaforge'    │
 * │                                                                   │
 * │   agent()  ·  openai()  ·  anthropic()  ·  ollama()             │
 * │   tool()   ·  createTools()  ·  defineTool()                    │
 * │   compose()  ·  pipe()                                           │
 * └──────────────────────────┬──────────────────────────────────────┘
 *                            │
 * ┌──────────────────────────▼──────────────────────────────────────┐
 * │                    Agentic Core                                   │
 * │                                                                   │
 * │   AgenticRunner (ReAct loop: Think → Act → Observe → Repeat)    │
 * │     ├── LLM Provider  (openai, anthropic, google, bedrock)       │
 * │     ├── Tool Registry (validated, type-safe, Zod schemas)        │
 * │     ├── Guardrail Engine (input/output safety checks)            │
 * │     ├── HITL hooks (human-in-the-loop approvals)                 │
 * │     └── Session + Memory (short-term + vector long-term)         │
 * └──────────────────────────┬──────────────────────────────────────┘
 *                            │
 * ┌──────────────────────────▼──────────────────────────────────────┐
 * │                  Production Safety (guard/)                       │
 * │                                                                   │
 * │   BudgetEnforcer  ·  RateLimiter  ·  CircuitBreaker              │
 * │   ApprovalStore   ·  IdempotencyGuard  ·  AuditLogger            │
 * │   HealthCheckManager  ·  TenantContext                           │
 * └──────────────────────────┬──────────────────────────────────────┘
 *                            │
 * ┌──────────────────────────▼──────────────────────────────────────┐
 * │               Infrastructure (Adapters)                           │
 * │                                                                   │
 * │   SQL · NoSQL · Vector · Cache · Object Storage · Message Queue   │
 * │   Embedding · Search · Analytics · Observability · Auth          │
 * │   (All pluggable — bring your own Postgres, Redis, Pinecone …)   │
 * └─────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Design Principles
 *
 * 1. **Progressive disclosure** — `agent('...')` works in 1 line. Scale to production
 *    by adding options one at a time. Nothing forced.
 *
 * 2. **Zero abstraction overhead** — No heavy base classes or metaclasses. The factory
 *    function returns a plain object with `run()`, `stream()`, and `stop()`.
 *
 * 3. **Pluggable everything** — LLM providers, tools, memory, session storage, guardrails,
 *    rate limiters — every piece accepts an interface, not a specific class.
 *
 * 4. **Async-first** — All operations are async and abort-signal aware for clean cancellation.
 *
 * 5. **Type-safe end-to-end** — Zod schemas for tool parameters auto-generate JSON Schema
 *    for LLM function calling, and TypeScript types flow through automatically.
 *
 * ## Recipes
 *
 * ### 1. Minimal agent (zero config)
 *
 * ```ts
 * import { agent } from 'personaforge'
 *
 * const a = agent('You are a helpful assistant.')
 * const { text } = await a.run('What is 2 + 2?')
 * ```
 *
 * ### 2. Agent with tools
 *
 * ```ts
 * import { agent } from 'personaforge'
 * import { tool } from 'personaforge/tool'
 * import { z } from 'zod'
 *
 * const weather = tool({
 *   name: 'getWeather',
 *   description: 'Get current weather for a city',
 *   parameters: z.object({ city: z.string().describe('City name') }),
 *   execute: async ({ city }) => fetch(`https://wttr.in/${city}?format=j1`).then(r => r.json()),
 * })
 *
 * const a = agent('You are a weather assistant.', { tools: [weather] })
 * const { text } = await a.run('What is the weather in London?')
 * ```
 *
 * ### 3. Choose your model
 *
 * ```ts
 * import { agent } from 'personaforge'
 * import { openai, anthropic, ollama } from 'personaforge/model'
 *
 * const gpt4 = agent('...', { model: openai('gpt-4.1') })
 * const claude = agent('...', { model: anthropic('claude-sonnet-4-20250514') })
 * const local = agent('...', { model: ollama('llama3.2') }) // localhost, no API key
 * ```
 *
 * ### 4. Sequential pipeline
 *
 * ```ts
 * import { agent, compose } from 'personaforge'
 *
 * const researcher = agent('Research the topic and return bullet points.')
 * const writer     = agent('Turn bullet points into a polished blog post.')
 * const editor     = agent('Edit for clarity, grammar, and conciseness.')
 *
 * const pipeline = compose(researcher, writer, editor)
 * const { text } = await pipeline.run('Write about TypeScript 5.5 features')
 * ```
 *
 * ### 5. Multi-model consensus
 *
 * ```ts
 * import { MultiAgentOrchestrator, AgentRuntime, wrapCoreLLM } from 'personaforge/workflow'
 * import { openai, anthropic } from 'personaforge/model'
 *
 * const orchestrator = new MultiAgentOrchestrator()
 *   .addAgent({ name: 'GPT', instructions: 'Review the code.', llm: wrapCoreLLM('gpt-4o', openai()) })
 *   .addAgent({ name: 'Claude', instructions: 'Review the code.', llm: wrapCoreLLM('claude', anthropic()) })
 *
 * const { text } = await orchestrator.runConsensus({
 *   agents: ['GPT', 'Claude'],
 *   task: 'Review this PR: ...',
 *   strategy: 'best',
 * })
 * ```
 *
 * ### 6. DAG workflow
 *
 * ```ts
 * import { createGraph, DAGEngine } from 'personaforge/graph'
 *
 * const graph = createGraph('data-pipeline')
 *   .addNode('fetch',   { kind: 'task', execute: ctx => fetchData() })
 *   .addNode('process', { kind: 'task', execute: ctx => processData(ctx.input) })
 *   .addNode('save',    { kind: 'task', execute: ctx => saveData(ctx.input) })
 *   .chain('fetch', 'process', 'save')
 *   .build()
 *
 * const { output } = await new DAGEngine(graph).execute()
 * ```
 *
 * ### 7. Production agent with safety
 *
 * ```ts
 * import { createAgent } from 'personaforge'
 *
 * const a = createAgent({
 *   name: 'SupportBot',
 *   instructions: 'You are a customer support agent.',
 *   budget: { maxUsdPerUserPerDay: 0.50 },
 *   rateLimit: { requestsPerMinute: 10 },
 *   guardrails: true,
 *   sessionStore: myRedisStore,
 * })
 * ```
 *
 * ### 8. HTTP server
 *
 * ```ts
 * import { createAgent } from 'personaforge'
 * import { createAgentRouter } from 'personaforge/serve'
 *
 * const a = createAgent({ name: 'Bot', instructions: '...' })
 * const router = createAgentRouter(a)
 * // → POST /run, GET /health, WS /stream
 * ```
 *
 * ### 9. Testing without a real LLM
 *
 * ```ts
 * import { mockAgent, scenario } from 'personaforge/test'
 *
 * const a = mockAgent({ responses: ['Hello!', 'Goodbye!'] })
 *
 * await scenario(a)
 *   .send('Hi')
 *   .expectText('Hello')
 *   .send('Bye')
 *   .expectText('Goodbye')
 *   .run()
 * ```
 *
 * ### 10. Custom LLM provider
 *
 * ```ts
 * import type { LLMProvider, Message, GenerateResult } from 'personaforge/model'
 *
 * const myProvider: LLMProvider = {
 *   async generateText(messages: Message[]): Promise<GenerateResult> {
 *     const response = await myAIService.complete(messages)
 *     return { text: response.text, finishReason: 'stop' }
 *   }
 * }
 *
 * const a = createAgent({ name: 'Bot', instructions: '...', model: myProvider })
 * ```
 *
 * ### 11. Custom tool (fluent builder)
 *
 * ```ts
 * import { defineTool } from 'personaforge/tool'
 * import { z } from 'zod'
 *
 * const stockTool = defineTool()
 *   .name('getStockPrice')
 *   .description('Get current stock price for a ticker symbol')
 *   .parameters(z.object({
 *     ticker: z.string().describe('Stock ticker e.g. AAPL'),
 *   }))
 *   .execute(async ({ ticker }) => fetchStockPrice(ticker))
 *   .timeout(5_000)
 *   .build()
 * ```
 *
 * ### 12. Extend a built-in tool
 *
 * ```ts
 * import { extendTool } from 'personaforge/tool'
 * import { webSearchTool } from 'personaforge/tools/search'
 *
 * const cachedSearch = extendTool(webSearchTool, {
 *   name: 'cachedSearch',
 *   beforeExecute: async (params) => console.log('Searching:', params.query),
 *   transformOutput: (results) => results.slice(0, 3), // top 3 only
 * })
 * ```
 *
 * ## Error Handling
 *
 * All errors extend `AgentError` and carry a structured `code` + `retryable` flag:
 *
 * ```ts
 * import { AgentError, ErrorCode } from 'personaforge'
 *
 * try {
 *   await agent.run(prompt)
 * } catch (err) {
 *   if (err instanceof AgentError) {
 *     console.log(err.code)       // e.g. 'RATE_LIMITED', 'BUDGET_EXCEEDED'
 *     console.log(err.retryable)  // true = safe to retry
 *   }
 * }
 * ```
 *
 * | Error class            | Code                | Retryable |
 * |------------------------|---------------------|-----------|
 * | `LLMError`             | `LLM_ERROR`         | true      |
 * | `TimeoutError`         | `TIMEOUT`           | true      |
 * | `RateLimitError`       | `RATE_LIMITED`      | true      |
 * | `CircuitOpenError`     | `CIRCUIT_OPEN`      | true      |
 * | `BudgetExceededError`  | `BUDGET_EXCEEDED`   | false     |
 * | `ApprovalRejectedError`| `APPROVAL_REJECTED` | false     |
 *
 * ## Interception Order
 *
 * When both plugins and per-agent hooks are registered:
 *
 * ```
 * 1. Global plugins  beforeRun()   (in registration order)
 * 2. Agent hooks     beforeRun()
 * 3. Agentic loop    (steps, tool calls)
 *    └─ Agent hooks  beforeStep() · beforeToolCall() · afterToolCall() · afterStep()
 * 4. Agent hooks     afterRun()
 * 5. Global plugins  afterRun()    (in reverse order)
 * ```
 *
 * ## Module Reference
 *
 * ### `src/model.ts` → `personaforge/model`
 * Provider classes (`OpenAIProvider`, `AnthropicProvider`, `GoogleProvider`, `BedrockConverseProvider`)
 * and factory shorthands (`openai()`, `anthropic()`, `ollama()`).
 *
 * ### `src/tool.ts` → `personaforge/tool`
 * `tool()` helper, `createTools()`, `defineTool()` builder, `extendTool()`, `wrapTool()`,
 * `pipeTools()`, built-in utility tools, MCP client/server.
 *
 * ### `src/workflow.ts` → `personaforge/workflow`
 * `compose()`, `pipe()` for linear pipelines; `AgentRuntime`, `MultiAgentOrchestrator`
 * for multi-agent; `createGraph()`, `DAGEngine` for DAG workflows; `wrapCoreLLM()` bridge.
 *
 * ### `src/guard.ts` → `personaforge/guard`
 * `BudgetEnforcer`, `RateLimiter`, `CircuitBreaker`, `InMemoryApprovalStore`,
 * `HealthCheckManager`, `InMemoryIdempotencyStore`, `InMemoryAuditStore`.
 *
 * ### `src/serve.ts` → `personaforge/serve`
 * HTTP runtime: `createAgentRouter()`, auth middleware, health endpoints.
 *
 * ### `src/observe.ts` → `personaforge/observe`
 * OTLP tracing, metrics, structured logging.
 *
 * ### `src/test.ts` → `personaforge/test`
 * `mockAgent()`, `scenario()` — LLM-free deterministic testing.
 *
 * ### `src/graph/` → `personaforge/graph`
 * Full DAG execution engine: `createGraph()`, `DAGEngine`, `DurableExecutor`,
 * `DistributedEngine`, `MultiAgentOrchestrator`, `AgentRuntime`, event stores,
 * memory system, graph plugins.
 *
 * ### `src/adapters/` → `personaforge/adapters`
 * Universal adapter registry for SQL, NoSQL, vector, cache, object storage,
 * message queues, observability, embedding, auth, rate-limit, and audit-log backends.
 *
 * ### `src/contracts/` → `personaforge/contracts`
 * Dependency-free shared interfaces (domain model layer). All modules import
 * types from here instead of cross-importing.
 *
 * ### `src/contracts/extensions.ts` → `personaforge/contracts/extensions`
 * Canonical pluggable interface re-exports: `SessionStore`, `MemoryStore`,
 * `LLMProvider`, `Tool`, `RAGEngine`, `Tracer`, `MetricsCollector`, etc.
 */

export const VERSION = '1.1.6';
export const FRAMEWORK_NAME = 'Confused-AI';