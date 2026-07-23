/**
 * Standard OpenTelemetry metric counters/histograms used across personaforge.
 *
 * Importers should ensure an OTEL meter provider is registered before reading
 * these — without one, the no-op default provider is used and writes are
 * silently discarded.
 *
 * @module
 */
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('personaforge');

export const Metrics = {
  // ── Agent runs ──────────────────────────────────────────────────────────
  /** Total agent runs initiated. Attributes: `agent_name`. */
  agentRunsTotal: meter.createCounter('agent.runs.total', {
    description: 'Total agent runs initiated',
  }),
  /** Wall-clock duration of each agent run. Attributes: `agent_name`. */
  agentRunDurationMs: meter.createHistogram('agent.run.duration_ms', {
    description: 'Wall-clock duration of agent runs',
    unit: 'ms',
  }),

  // ── Tools ───────────────────────────────────────────────────────────────
  /** Total tool invocations. Attributes: `tool_name`, `agent_name`. */
  toolCallsTotal: meter.createCounter('agent.tool_calls.total'),
  /** Tool invocations that resulted in an error. Attributes: `tool_name`. */
  toolErrorsTotal: meter.createCounter('agent.tool_errors.total'),
  /** Tool execution duration histogram. Attributes: `tool_name`, `agent_name`. */
  toolDurationMs: meter.createHistogram('agent.tool.duration_ms', {
    description: 'Tool execution latency',
    unit: 'ms',
  }),

  // ── Context window ───────────────────────────────────────────────────────
  /**
   * Fraction of the model's context window consumed by the prompt.
   * Value in [0, 1]. Attributes: `agent_name`, `model`.
   * Record after each LLM call when usage.promptTokens is available.
   */
  contextWindowUtilization: meter.createHistogram('agent.context_window.utilization', {
    description: 'Fraction of context window used by the prompt (0–1)',
    unit: '1',
  }),

  // ── LLM ─────────────────────────────────────────────────────────────────
  /** LLM token usage. Attributes: `model`, `token_type` (`input`|`output`). */
  llmTokensTotal: meter.createCounter('llm.tokens.total'),
  /** Cumulative LLM spend in USD. Attributes: `model`. */
  llmCostUsd: meter.createCounter('llm.cost.usd'),
  /** LLM provider errors. Attributes: `provider`, `error_type`. */
  llmErrorsTotal: meter.createCounter('llm.errors.total'),

  // ── Resilience ───────────────────────────────────────────────────────────
  /** Number of times a circuit breaker has transitioned to OPEN. Attributes: `service`. */
  circuitBreakerOpensTotal: meter.createCounter('circuit_breaker.opens.total'),
  /** Budget limit violations. Attributes: `scope` (`user`|`tenant`). */
  budgetExceededTotal: meter.createCounter('budget.exceeded.total'),
  /** Guardrail rule violations. Attributes: `rule`, `severity`. */
  guardrailViolationsTotal: meter.createCounter('guardrail.violations.total'),

  // ── HTTP ─────────────────────────────────────────────────────────────────
  /** Total inbound HTTP requests. Attributes: `agent_name`, `status_code`, `method`. */
  httpRequestsTotal: meter.createCounter('http.requests.total'),
  /** HTTP request duration histogram. Attributes: `route`, `method`, `status_code`. */
  httpRequestDurationMs: meter.createHistogram('http.request.duration_ms', { unit: 'ms' }),
  /** Number of active SSE / streaming connections. */
  httpActiveStreams: meter.createUpDownCounter('http.active_streams'),

  // ── Session ───────────────────────────────────────────────────────────────
  /**
   * Number of messages in a session at the time of read/write.
   * Attributes: `agent_name`, `store_type` (`memory`|`sqlite`|`redis`|`postgres`).
   * Use to detect session bloat before the context window limit is hit.
   */
  sessionMessageCount: meter.createHistogram('agent.session.size', {
    description: 'Number of messages in a session',
    unit: '{messages}',
  }),

  // ── Knowledge / RAG ───────────────────────────────────────────────────────
  /**
   * End-to-end latency of a knowledge retrieval call (embedding + vector search).
   * Attributes: `agent_name`, `store_type` (`pgvector`|`pinecone`|`qdrant`|`memory`).
   * Critical for differentiating RAG latency from LLM latency in traces.
   */
  knowledgeRetrievalLatencyMs: meter.createHistogram('knowledge.retrieval.duration_ms', {
    description: 'End-to-end latency of knowledge/RAG retrieval',
    unit: 'ms',
  }),

  // ── Background queues ─────────────────────────────────────────────────────
  /**
   * Current depth (pending job count) of a background queue.
   * Attributes: `queue_name`, `queue_type` (`bullmq`|`kafka`|`sqs`|`rabbitmq`|`redis`).
   * Use as an autoscaling signal for background job consumers.
   */
  backgroundQueueDepth: meter.createObservableGauge('background.queue.depth', {
    description: 'Number of pending jobs in a background queue',
    unit: '{jobs}',
  }),
} as const;

/**
 * Record LLM token usage (and cost, when available) for a single generation.
 *
 * Increments `llmTokensTotal` (split by `token_type`) and, when `costUsd` is
 * provided, `llmCostUsd`. Pass a **bounded** `model` label — never a per-run or
 * per-user identifier (cardinality explosion). The raw agent instance id must
 * not be used as a label here; omit `agentName` or pass a configured name.
 */
export function recordLlmUsage(usage: {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  /** Bounded, configured agent name — NOT a per-run/per-user instance id. */
  agentName?: string;
}): void {
  const base: Record<string, string> = { model: usage.model };
  if (usage.agentName) base['agent_name'] = usage.agentName;

  if (usage.inputTokens && usage.inputTokens > 0) {
    Metrics.llmTokensTotal.add(usage.inputTokens, { ...base, token_type: 'input' });
  }
  if (usage.outputTokens && usage.outputTokens > 0) {
    Metrics.llmTokensTotal.add(usage.outputTokens, { ...base, token_type: 'output' });
  }
  if (typeof usage.costUsd === 'number' && usage.costUsd > 0) {
    Metrics.llmCostUsd.add(usage.costUsd, base);
  }
}
