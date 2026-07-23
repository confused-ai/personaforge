/**
 * Prometheus `/metrics` endpoint for personaforge HTTP service.
 *
 * Zero external dependencies — renders OTEL metrics in Prometheus
 * text exposition format (version 0.0.4) by reading from the global
 * OTEL MeterProvider via @opentelemetry/api.
 *
 * Usage:
 * ```ts
 * import express from 'express';
 * import { prometheusMetricsHandler } from 'personaforge/serve';
 *
 * const app = express();
 * app.get('/metrics', prometheusMetricsHandler());
 * ```
 *
 * Or when using the built-in HTTP service:
 * ```ts
 * createHttpService(agents, { prometheusMetrics: true });
 * // Exposes GET /metrics automatically
 * ```
 *
 * The handler collects the current snapshot of all Metrics defined in
 * `@personaforge/observe` via a lightweight in-process registry. For
 * production-scale deployments, replace with `@opentelemetry/exporter-prometheus`
 * which integrates directly with the OTEL SDK pipeline.
 *
 * @module
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface PrometheusMetricsOptions {
  /**
   * Path prefix to strip from metric names before rendering.
   * E.g. `'personaforge_'` → `agent_runs_total` becomes `personaforge_agent_runs_total`.
   * Default: `'personaforge_'`.
   */
  prefix?: string;
  /**
   * Whether to include HELP and TYPE comment lines.
   * Disabling reduces output size but breaks some scrapers.
   * Default: `true`.
   */
  includeMetadata?: boolean;
}

// ── Prometheus text format helpers ─────────────────────────────────────────

function sanitizeName(name: string, prefix: string): string {
  // Prometheus metric names: [a-zA-Z_:][a-zA-Z0-9_:]* — replace dots/hyphens
  return (prefix + name).replace(/[.\-]/g, '_').replace(/[^a-zA-Z0-9_:]/g, '');
}

function formatLabels(labels: Record<string, string | number>): string {
  const pairs = Object.entries(labels)
    .map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
    .join(',');
  return pairs.length > 0 ? `{${pairs}}` : '';
}

// ── In-process metric registry ─────────────────────────────────────────────
// Maintains a flat list of metric observations that can be snapshotted on
// each scrape. Instruments registered here are separate from the OTEL SDK
// pipeline and do not require an SDK to be configured.

export interface MetricSample {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  help?: string;
  unit?: string;
  samples: Array<{
    labels: Record<string, string | number>;
    value: number;
  }>;
}

/**
 * Simple in-process metric registry. Call `record()` from your application
 * code to update values; the Prometheus handler reads the current snapshot
 * on each scrape request.
 *
 * For richer integration, wire OTEL SDK metrics directly via
 * `@opentelemetry/exporter-prometheus` instead.
 */
export class PrometheusRegistry {
  private readonly _metrics = new Map<string, MetricSample>();

  register(sample: MetricSample): void {
    this._metrics.set(sample.name, sample);
  }

  record(name: string, value: number, labels: Record<string, string | number> = {}): void {
    const existing = this._metrics.get(name);
    if (!existing) return;
    // Update or append the sample with matching labels
    const idx = existing.samples.findIndex(
      (s) => JSON.stringify(s.labels) === JSON.stringify(labels),
    );
    if (idx >= 0) {
      existing.samples[idx] = { labels, value };
    } else {
      existing.samples.push({ labels, value });
    }
  }

  increment(name: string, by = 1, labels: Record<string, string | number> = {}): void {
    const existing = this._metrics.get(name);
    if (!existing) return;
    const idx = existing.samples.findIndex(
      (s) => JSON.stringify(s.labels) === JSON.stringify(labels),
    );
    if (idx >= 0) {
      existing.samples[idx]!.value += by;
    } else {
      existing.samples.push({ labels, value: by });
    }
  }

  render(opts: PrometheusMetricsOptions = {}): string {
    const prefix = opts.prefix ?? 'personaforge_';
    const metadata = opts.includeMetadata !== false;
    const lines: string[] = [];

    for (const metric of this._metrics.values()) {
      const pname = sanitizeName(metric.name, prefix);
      if (metadata) {
        if (metric.help) lines.push(`# HELP ${pname} ${metric.help}`);
        lines.push(`# TYPE ${pname} ${metric.type}`);
      }
      for (const s of metric.samples) {
        lines.push(`${pname}${formatLabels(s.labels)} ${s.value}`);
      }
    }

    // Append scrape timestamp
    if (metadata) {
      lines.push(`# HELP personaforge_scrape_time_seconds Unix timestamp of last scrape`);
      lines.push(`# TYPE personaforge_scrape_time_seconds gauge`);
    }
    lines.push(`personaforge_scrape_time_seconds ${(Date.now() / 1000).toFixed(3)}`);

    return lines.join('\n') + '\n';
  }

  /** Clear all recorded samples (keeps metric definitions). */
  reset(): void {
    for (const metric of this._metrics.values()) {
      metric.samples = [];
    }
  }
}

/**
 * The default shared registry. Import and call `defaultRegistry.increment()`
 * or `defaultRegistry.record()` from anywhere in your application to push
 * metrics to the Prometheus scrape endpoint.
 */
export const defaultRegistry = new PrometheusRegistry();

// Pre-register the core personaforge metrics so scrapers always see HELP/TYPE.
const CORE_METRICS: MetricSample[] = [
  { name: 'agent.runs.total',            type: 'counter',   help: 'Total agent runs initiated',              unit: 'count', samples: [] },
  { name: 'agent.run.duration_ms',       type: 'histogram', help: 'Wall-clock duration of agent runs (ms)',  unit: 'ms',    samples: [] },
  { name: 'agent.tool_calls.total',      type: 'counter',   help: 'Total tool invocations',                  unit: 'count', samples: [] },
  { name: 'agent.tool_errors.total',     type: 'counter',   help: 'Tool invocations that resulted in error', unit: 'count', samples: [] },
  { name: 'agent.tool.duration_ms',      type: 'histogram', help: 'Tool execution latency (ms)',             unit: 'ms',    samples: [] },
  { name: 'agent.context_window.utilization', type: 'histogram', help: 'Fraction of context window used (0-1)', unit: '1', samples: [] },
  { name: 'agent.session.size',          type: 'histogram', help: 'Number of messages in a session',         unit: 'messages', samples: [] },
  { name: 'llm.tokens.total',            type: 'counter',   help: 'LLM token usage',                         unit: 'tokens', samples: [] },
  { name: 'llm.cost.usd',               type: 'counter',   help: 'Cumulative LLM spend in USD',             unit: 'USD',   samples: [] },
  { name: 'llm.errors.total',           type: 'counter',   help: 'LLM provider errors',                     unit: 'count', samples: [] },
  { name: 'circuit_breaker.opens.total', type: 'counter',   help: 'Circuit breaker OPEN transitions',        unit: 'count', samples: [] },
  { name: 'budget.exceeded.total',       type: 'counter',   help: 'Budget limit violations',                 unit: 'count', samples: [] },
  { name: 'guardrail.violations.total',  type: 'counter',   help: 'Guardrail rule violations',               unit: 'count', samples: [] },
  { name: 'http.requests.total',         type: 'counter',   help: 'Total inbound HTTP requests',             unit: 'count', samples: [] },
  { name: 'http.request.duration_ms',    type: 'histogram', help: 'HTTP request duration (ms)',              unit: 'ms',    samples: [] },
  { name: 'http.active_streams',         type: 'gauge',     help: 'Active SSE/streaming connections',        unit: 'count', samples: [] },
  { name: 'knowledge.retrieval.duration_ms', type: 'histogram', help: 'Knowledge/RAG retrieval latency (ms)', unit: 'ms', samples: [] },
  { name: 'background.queue.depth',      type: 'gauge',     help: 'Pending jobs in a background queue',      unit: 'jobs',  samples: [] },
];

for (const m of CORE_METRICS) defaultRegistry.register(m);

// ── Express-compatible handler ─────────────────────────────────────────────

interface Res {
  status(code: number): Res;
  setHeader(name: string, value: string): void;
  end(body: string): void;
  send?(body: string): void;
}
type Next = (err?: unknown) => void;

/**
 * Express/Connect-compatible middleware that serves a Prometheus text
 * exposition format scrape response.
 *
 * @example
 * ```ts
 * app.get('/metrics', prometheusMetricsHandler());
 * ```
 *
 * @example Custom registry and prefix:
 * ```ts
 * app.get('/metrics', prometheusMetricsHandler({
 *   registry: myRegistry,
 *   prefix: 'myapp_',
 * }));
 * ```
 */
export function prometheusMetricsHandler(opts: PrometheusMetricsOptions & {
  /** Override the registry to scrape. Defaults to `defaultRegistry`. */
  registry?: PrometheusRegistry;
} = {}) {
  const registry = opts.registry ?? defaultRegistry;
  return (_req: unknown, res: Res, _next?: Next): void => {
    const body = registry.render(opts);
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    if (typeof res.send === 'function') {
      res.send(body);
    } else {
      res.end(body);
    }
  };
}
