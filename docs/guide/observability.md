---
title: Observability
description: OTLP tracing, Prometheus metrics, console and structured logging, W3C trace context propagation, Langfuse, and LangSmith integration.
outline: [2, 3]
---

# Observability

The framework ships a full observability stack: structured logging, distributed tracing (OTLP), Prometheus metrics, W3C trace context propagation, and native integrations with Langfuse and LangSmith. Import from `personaforge` or `personaforge/observe`.

## Logging

### `ConsoleLogger`

```ts
import { ConsoleLogger } from 'personaforge';

const logger = new ConsoleLogger({ level: 'info' });
// levels: 'debug' | 'info' | 'warn' | 'error'

logger.info('Agent started', { agentName: 'assistant', runId: 'run-123' });
logger.warn('Guardrail violation', { rule: 'pii-detection', score: 0.9 });
logger.error('Tool call failed', { tool: 'search', error: err.message });
```

### Attach logger to an agent

```ts
import { createAgent } from 'personaforge';

const agent = createAgent({
  name: 'production-agent',
  instructions: '...',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  logger: new ConsoleLogger({ level: 'info' }),
});
```

---

## Tracing

### `InMemoryTracer` (development)

```ts
import { InMemoryTracer } from 'personaforge';

const tracer = new InMemoryTracer();

// Manually start/end spans
const span = tracer.startSpan('agent-run', { runId: 'run-123', agentName: 'assistant' });
// ... work ...
span.end({ status: 'ok', tokens: 420 });

// Inspect all spans
console.log(tracer.getSpans());
```

### OTLP (production)

Export traces to any OpenTelemetry-compatible backend (Grafana Tempo, Jaeger, Honeycomb, Datadog, etc.):

```ts
import { OTLPTraceExporter } from 'personaforge';

const exporter = new OTLPTraceExporter({
  endpoint: process.env.OTLP_ENDPOINT!,  // e.g. http://otel-collector:4318/v1/traces
  headers: {
    'x-honeycomb-team': process.env.HONEYCOMB_API_KEY!,
  },
  serviceName: 'my-agent-service',
});

// Plug into the framework's tracer
const tracer = exporter.createTracer();
```

---

## Metrics

### `MetricsCollectorImpl`

```ts
import { MetricsCollectorImpl } from 'personaforge';

const metrics = new MetricsCollectorImpl();

// Record a counter (e.g. requests, tool calls)
metrics.increment('agent.runs.total', 1, { agentName: 'assistant' });

// Record a gauge (e.g. active sessions)
metrics.gauge('agent.active_sessions', 42);

// Record a histogram (e.g. latency)
metrics.histogram('agent.run.duration_ms', 345, { agentName: 'assistant', status: 'ok' });

// Flush to Prometheus / OTLP
const snapshot = metrics.snapshot();
```

### OTLP Metrics export

```ts
import { OTLPMetricsExporter } from 'personaforge';

const metricsExporter = new OTLPMetricsExporter({
  endpoint: process.env.OTLP_METRICS_ENDPOINT!,
  serviceName: 'my-agent-service',
  exportIntervalMs: 15_000,  // push every 15s
});
```

---

## W3C trace context propagation

Propagate trace context across HTTP boundaries (microservices, A2A calls):

```ts
import {
  generateTraceparent,
  parseTraceparent,
  injectTraceHeaders,
  extractTraceContext,
  childSpan,
} from 'personaforge';

// Generate a new root trace
const traceparent = generateTraceparent();
// '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'

// Parse an incoming header
const ctx = parseTraceparent(req.headers['traceparent']);

// Create a child span context
const child = childSpan(ctx);

// Inject into outbound fetch headers
const headers = injectTraceHeaders({}, ctx);

// Extract from incoming request headers
const incoming = extractTraceContext(req.headers);
```

---

## Langfuse integration

Send traces and evals to [Langfuse](https://langfuse.com):

```ts
import { sendLangfuseBatch } from 'personaforge';

await sendLangfuseBatch({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: 'https://cloud.langfuse.com',
  batch: [
    {
      id: 'trace-123',
      type: 'trace',
      name: 'agent-run',
      input: { prompt: 'Hello' },
      output: { text: 'Hi there!' },
      usage: { promptTokens: 5, completionTokens: 4 },
    },
  ],
});
```

---

## LangSmith integration

```ts
import { sendLangSmithRunBatch } from 'personaforge';

await sendLangSmithRunBatch({
  apiKey: process.env.LANGSMITH_API_KEY!,
  projectName: 'my-agent-project',
  runs: [
    {
      id: 'run-456',
      name: 'agent-run',
      runType: 'chain',
      inputs: { prompt: 'Explain quantum computing.' },
      outputs: { text: agentResult.text },
      startTime: Date.now() - 1200,
      endTime: Date.now(),
    },
  ],
});
```

---

## Complete observability setup

```ts
import { createAgent, ConsoleLogger, OTLPTraceExporter, OTLPMetricsExporter, MetricsCollectorImpl } from 'personaforge';

// Tracing
const traceExporter = new OTLPTraceExporter({
  endpoint: process.env.OTLP_ENDPOINT!,
  serviceName: 'customer-service-agent',
});

// Metrics
const metricsExporter = new OTLPMetricsExporter({
  endpoint: process.env.OTLP_METRICS_ENDPOINT!,
  serviceName: 'customer-service-agent',
  exportIntervalMs: 15_000,
});

// Structured logging
const logger = new ConsoleLogger({ level: 'info' });

const agent = createAgent({
  name: 'customer-service',
  instructions: 'You are a customer service agent.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  logger,
});

// Wrap runs with tracing
const tracer = traceExporter.createTracer();
const metrics = new MetricsCollectorImpl();

const run = async (prompt: string, userId: string) => {
  const traceparent = generateTraceparent();
  const span = tracer.startSpan('agent-run', { userId });

  try {
    const result = await agent.run(prompt, { userId, traceId: traceparent });
    span.end({ status: 'ok', tokens: result.usage?.totalTokens });
    metrics.increment('agent.runs.success');
    metrics.histogram('agent.run.duration_ms', result.durationMs ?? 0);
    return result;
  } catch (err) {
    span.end({ status: 'error', error: (err as Error).message });
    metrics.increment('agent.runs.error');
    throw err;
  }
};
```

---

## Where to go next

- [Eval](./eval) — score agent quality with LLM-as-judge and text metrics.
- [Production](./production) — circuit breakers, budget enforcement, rate limiting.
