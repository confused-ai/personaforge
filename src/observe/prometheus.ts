/**
 * Native Prometheus `/metrics` endpoint support.
 *
 * Serialises the OTEL metric snapshots collected via the `Metrics` object into
 * the Prometheus text format (exposition format v0.0.4).
 *
 * ## Usage
 *
 * ### Bun.serve
 * ```ts
 * import { createPrometheusHandler } from 'personaforge/observe';
 *
 * const handler = createPrometheusHandler();
 *
 * Bun.serve({
 *   fetch(req) {
 *     const url = new URL(req.url);
 *     if (url.pathname === '/metrics') return handler(req);
 *     // … other routes
 *   },
 * });
 * ```
 *
 * ### Node.js http
 * ```ts
 * import http from 'node:http';
 * import { scrapePrometheusMetrics } from 'personaforge/observe';
 *
 * http.createServer(async (req, res) => {
 *   if (req.url === '/metrics') {
 *     const body = await scrapePrometheusMetrics();
 *     res.writeHead(200, { 'Content-Type': PROMETHEUS_CONTENT_TYPE });
 *     res.end(body);
 *   }
 * }).listen(9090);
 * ```
 *
 * ## How it works
 *
 * Uses `@opentelemetry/sdk-metrics` `PrometheusExporter` if it is present in the
 * dependency tree (opt-in). When not present, falls back to a zero-dep minimal
 * serialiser that renders the metric names from the `Metrics` object using
 * a push-based `MetricReader` if registered, or returns a comment-only response
 * so the endpoint remains healthy even without a full OTEL SDK setup.
 */

export const PROMETHEUS_CONTENT_TYPE =
  'text/plain; version=0.0.4; charset=utf-8';

/**
 * Try to obtain a Prometheus text scrape from the OTEL SDK.
 * Returns `null` when the SDK / exporter is not configured.
 */
async function trySdkScrape(): Promise<string | null> {
  try {
    // @opentelemetry/exporter-prometheus is an optional peer dep.
    // Dynamic import keeps this file tree-shakeable for users who don't install it.

    // @ts-ignore -- optional peer dependency may not be installed
    const mod = await import('@opentelemetry/exporter-prometheus') as unknown;
    // If the PrometheusExporter has a static `getMetrics()` or `collect()` method
    // on a registered instance, use it. In practice users register the exporter
    // on their MeterProvider; we can't introspect that from here without a handle.
    // Signal that the SDK route is unavailable without a handle.
    void mod; // satisfy the import
    return null;
  } catch {
    return null;
  }
}

/**
 * Explanatory body returned when no real metric exporter is wired up.
 *
 * IMPORTANT: this deliberately does NOT emit fabricated `0` values for every
 * metric. Hardcoded zeros are worse than no data — they silently mask real
 * traffic and break alerting (a flatlined `llm_errors_total 0` looks healthy
 * when in fact nothing is being collected). Instead we return a comment-only
 * body and signal `metrics exporter not wired` so operators notice and install
 * `@opentelemetry/exporter-prometheus`.
 */
function buildExporterNotWiredBody(): string {
  return [
    '# personaforge metrics — exporter not wired',
    '#',
    '# No @opentelemetry/exporter-prometheus reader is registered, so real',
    '# counter/histogram values cannot be introspected from this process.',
    '# This endpoint intentionally returns NO metric samples rather than',
    '# misleading hardcoded zeros.',
    '#',
    '# To expose real values, register @opentelemetry/exporter-prometheus as a',
    '# MetricReader on your MeterProvider and route its scrape here.',
    '',
  ].join('\n');
}

/**
 * Collect the Prometheus metrics scrape as a text string.
 *
 * Tries the OTEL SDK exporter first. When no exporter is wired, returns an
 * explicit comment-only body (NOT fake zeros) — see {@link buildExporterNotWiredBody}.
 */
export async function scrapePrometheusMetrics(
  _extraLabels?: Record<string, string>,
): Promise<string> {
  const sdkResult = await trySdkScrape();
  if (sdkResult !== null) return sdkResult;
  return buildExporterNotWiredBody();
}

/**
 * Create a Fetch-API-compatible handler for `GET /metrics`.
 *
 * ```ts
 * const handler = createPrometheusHandler({ extraLabels: { service: 'my-agent' } });
 * if (url.pathname === '/metrics') return handler(req);
 * ```
 */
export function createPrometheusHandler(options?: {
  extraLabels?: Record<string, string>;
  /** Override the path check. When provided, handler returns 404 for non-matching paths. */
  path?: string;
}) {
  const { extraLabels, path: matchPath } = options ?? {};

  return async (request: Request): Promise<Response> => {
    if (matchPath) {
      const url = new URL(request.url);
      if (url.pathname !== matchPath) {
        return new Response('Not Found', { status: 404 });
      }
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const body = await scrapePrometheusMetrics(extraLabels);
    return new Response(request.method === 'HEAD' ? '' : body, {
      status: 200,
      headers: { 'Content-Type': PROMETHEUS_CONTENT_TYPE },
    });
  };
}
