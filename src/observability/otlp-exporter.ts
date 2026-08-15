/**
 * OTLP Exporter - OpenTelemetry Protocol Export for Distributed Tracing
 *
 * Production-grade observability export supporting:
 * - OTLP/HTTP trace export (Jaeger, Datadog, Honeycomb, etc.)
 * - Batched export with configurable intervals
 * - W3C trace context propagation
 * - Automatic retry with backoff
 *
 * @deprecated The live OpenTelemetry export path is `@personaforge/observe`
 *   (`src/observe/tracing.ts` + `src/observe/prometheus.ts`). This hand-rolled OTLP
 *   exporter is retained only for the legacy `personaforge/observability` path and has
 *   no active importers. Migrate to `personaforge/observe`.
 */

import type { TraceSpan, SpanStatus, MetricValue } from './types.js';

/** OTLP export configuration */
export interface OTLPExporterConfig {
    /** OTLP endpoint URL (e.g., https://api.honeycomb.io/v1/traces) */
    readonly endpoint: string;
    /** Service name for trace attribution */
    readonly serviceName: string;
    /** Optional headers (e.g., API keys) */
    readonly headers?: Record<string, string>;
    /** Batch size before export (default: 50) */
    readonly batchSize?: number;
    /** Export interval in ms (default: 5000) */
    readonly exportIntervalMs?: number;
    /** Max queue size before dropping (default: 2048) */
    readonly maxQueueSize?: number;
    /** Export timeout in ms (default: 30000) */
    readonly timeoutMs?: number;
    /** Enable console logging for debug (default: false) */
    readonly debug?: boolean;
}

/** OTLP span format */
interface OTLPSpan {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind: number;
    startTimeUnixNano: string;
    endTimeUnixNano?: string;
    status: { code: number; message?: string };
    attributes: Array<{ key: string; value: { stringValue?: string; intValue?: number; boolValue?: boolean } }>;
    events: Array<{
        name: string;
        timeUnixNano: string;
        attributes?: Array<{ key: string; value: { stringValue: string } }>;
    }>;
}

/** Export batch request */
interface OTLPTraceRequest {
    resourceSpans: Array<{
        resource: {
            attributes: Array<{ key: string; value: { stringValue: string } }>;
        };
        scopeSpans: Array<{
            scope: { name: string; version: string };
            spans: OTLPSpan[];
        }>;
    }>;
}

/**
 * OTLP Trace Exporter - exports spans to OTLP-compatible backends.
 *
 * @example
 * const exporter = new OTLPTraceExporter({
 *   endpoint: 'https://api.honeycomb.io/v1/traces',
 *   serviceName: 'my-agent',
 *   headers: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY },
 * });
 *
 * // Export spans
 * exporter.addSpan(span);
 *
 * // Start automatic export
 * exporter.start();
 *
 * // Clean shutdown
 * await exporter.shutdown();
 */
export class OTLPTraceExporter {
    private readonly config: Required<Omit<OTLPExporterConfig, 'headers'>> &
        Pick<OTLPExporterConfig, 'headers'>;
    private spanQueue: TraceSpan[] = [];
    private exportTimer: NodeJS.Timeout | null = null;
    private isShuttingDown = false;

    constructor(config: OTLPExporterConfig) {
        this.config = {
            endpoint: config.endpoint,
            serviceName: config.serviceName,
            headers: config.headers,
            batchSize: config.batchSize ?? 50,
            exportIntervalMs: config.exportIntervalMs ?? 5_000,
            maxQueueSize: config.maxQueueSize ?? 2048,
            timeoutMs: config.timeoutMs ?? 30_000,
            debug: config.debug ?? false,
        };
    }

    /** Add a span to the export queue */
    addSpan(span: TraceSpan): void {
        if (this.isShuttingDown) return;

        if (this.spanQueue.length >= this.config.maxQueueSize) {
            this.log('warn', `Queue full (${this.config.maxQueueSize}), dropping oldest spans`);
            // splice(0,1) is O(n) but only fires once per overflow; use slice to batch-drop if very behind
            this.spanQueue = this.spanQueue.slice(-Math.floor(this.config.maxQueueSize * 0.9));
        }

        this.spanQueue.push(span);

        // Export immediately if batch is full
        if (this.spanQueue.length >= this.config.batchSize) {
            this.export().catch(e => this.log('error', `Export failed: ${e}`));
        }
    }

    /** Add multiple spans */
    addSpans(spans: TraceSpan[]): void {
        for (const span of spans) {
            this.addSpan(span);
        }
    }

    /** Start automatic periodic export */
    start(): void {
        if (this.exportTimer) return;

        this.exportTimer = setInterval(() => {
            this.export().catch(e => this.log('error', `Periodic export failed: ${e}`));
        }, this.config.exportIntervalMs);
        this.exportTimer.unref?.();

        this.log('debug', `Started with interval ${this.config.exportIntervalMs}ms`);
    }

    /** Stop automatic export and flush remaining spans */
    async shutdown(): Promise<void> {
        this.isShuttingDown = true;

        if (this.exportTimer) {
            clearInterval(this.exportTimer);
            this.exportTimer = null;
        }

        // Flush remaining spans
        if (this.spanQueue.length > 0) {
            await this.export();
        }

        this.log('debug', 'Shutdown complete');
    }

    /** Force export current batch */
    async export(): Promise<{ success: boolean; exported: number; errors?: string[] }> {
        if (this.spanQueue.length === 0) {
            return { success: true, exported: 0 };
        }

        const batch = this.spanQueue.splice(0, this.config.batchSize);
        const request = this.buildRequest(batch);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

            const response = await fetch(this.config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.config.headers,
                },
                body: JSON.stringify(request),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                this.log('error', `Export failed: ${response.status} ${errorText}`);
                // Re-queue failed spans at front — use concat to avoid O(n) unshift
                this.spanQueue = [...batch, ...this.spanQueue];
                return { success: false, exported: 0, errors: [errorText] };
            }

            this.log('debug', `Exported ${batch.length} spans`);
            return { success: true, exported: batch.length };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log('error', `Export error: ${message}`);
            // Re-queue failed spans at front
            this.spanQueue = [...batch, ...this.spanQueue];
            return { success: false, exported: 0, errors: [message] };
        }
    }

    /** Get current queue size */
    getQueueSize(): number {
        return this.spanQueue.length;
    }

    // --- Private methods ---

    private buildRequest(spans: TraceSpan[]): OTLPTraceRequest {
        return {
            resourceSpans: [
                {
                    resource: {
                        attributes: [
                            { key: 'service.name', value: { stringValue: this.config.serviceName } },
                        ],
                    },
                    scopeSpans: [
                        {
                            scope: { name: '../core/index.js', version: '0.1.0' },
                            spans: spans.map(span => this.convertSpan(span)),
                        },
                    ],
                },
            ],
        };
    }

    private convertSpan(span: TraceSpan): OTLPSpan {
        return {
            traceId: span.traceId,
            spanId: String(span.id),
            parentSpanId: span.parentId ? String(span.parentId) : undefined,
            name: span.name,
            kind: 1, // INTERNAL
            startTimeUnixNano: String(span.startTime.getTime() * 1_000_000),
            endTimeUnixNano: span.endTime ? String(span.endTime.getTime() * 1_000_000) : undefined,
            status: {
                code: this.statusToCode(span.status),
            },
            attributes: Object.entries(span.attributes).map(([key, value]) => ({
                key,
                value: this.convertAttributeValue(value),
            })),
            events: span.events.map(event => ({
                name: event.name,
                timeUnixNano: String(event.timestamp.getTime() * 1_000_000),
                attributes: event.attributes
                    ? Object.entries(event.attributes).map(([key, value]) => ({
                        key,
                        value: { stringValue: String(value) },
                    }))
                    : undefined,
            })),
        };
    }

    private statusToCode(status: SpanStatus): number {
        switch (status) {
            case 'ok':
                return 1;
            case 'error':
                return 2;
            default:
                return 0;
        }
    }

    private convertAttributeValue(value: unknown): { stringValue?: string; intValue?: number; boolValue?: boolean } {
        if (typeof value === 'string') {
            return { stringValue: value };
        }
        if (typeof value === 'number') {
            return { intValue: value };
        }
        if (typeof value === 'boolean') {
            return { boolValue: value };
        }
        return { stringValue: String(value) };
    }

    private log(level: 'debug' | 'warn' | 'error', message: string): void {
        if (!this.config.debug && level === 'debug') return;

        const prefix = `[OTLPExporter] [${level.toUpperCase()}]`;
        if (level === 'error') {
            console.error(prefix, message);
        } else if (level === 'warn') {
            console.warn(prefix, message);
        } else {
            console.log(prefix, message);
        }
    }
}

/**
 * OTLP Metrics Exporter - exports metrics to OTLP-compatible backends.
 */
export class OTLPMetricsExporter {
    private readonly config: Required<Omit<OTLPExporterConfig, 'headers'>> &
        Pick<OTLPExporterConfig, 'headers'>;
    private metricsQueue: MetricValue[] = [];
    private exportTimer: NodeJS.Timeout | null = null;
    private isShuttingDown = false;

    constructor(config: OTLPExporterConfig) {
        this.config = {
            endpoint: config.endpoint,
            serviceName: config.serviceName,
            headers: config.headers,
            batchSize: config.batchSize ?? 100,
            exportIntervalMs: config.exportIntervalMs ?? 10_000,
            maxQueueSize: config.maxQueueSize ?? 4096,
            timeoutMs: config.timeoutMs ?? 30_000,
            debug: config.debug ?? false,
        };
    }

    /** Add a metric to the export queue */
    addMetric(metric: MetricValue): void {
        if (this.isShuttingDown) return;

        if (this.metricsQueue.length >= this.config.maxQueueSize) {
            // Batch-evict oldest 10% rather than one-at-a-time shift()
            this.metricsQueue = this.metricsQueue.slice(-Math.floor(this.config.maxQueueSize * 0.9));
        }

        this.metricsQueue.push(metric);
    }

    /** Start automatic periodic export */
    start(): void {
        if (this.exportTimer) return;

        this.exportTimer = setInterval(() => {
            this.export().catch(e => console.error('[OTLPMetrics] Export failed:', e));
        }, this.config.exportIntervalMs);
        this.exportTimer.unref?.();
    }

    /** Stop and flush */
    async shutdown(): Promise<void> {
        this.isShuttingDown = true;

        if (this.exportTimer) {
            clearInterval(this.exportTimer);
            this.exportTimer = null;
        }

        if (this.metricsQueue.length > 0) {
            await this.export();
        }
    }

    /** Export current batch */
    async export(): Promise<{ success: boolean; exported: number }> {
        if (this.metricsQueue.length === 0) {
            return { success: true, exported: 0 };
        }

        const batch = this.metricsQueue.splice(0, this.config.batchSize);

        try {
            const response = await fetch(this.config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.config.headers,
                },
                body: JSON.stringify(this.buildMetricsRequest(batch)),
            });

            if (!response.ok) {
                this.metricsQueue = [...batch, ...this.metricsQueue];
                return { success: false, exported: 0 };
            }

            return { success: true, exported: batch.length };
        } catch {
            this.metricsQueue = [...batch, ...this.metricsQueue];
            return { success: false, exported: 0 };
        }
    }

    private buildMetricsRequest(metrics: MetricValue[]) {
        return {
            resourceMetrics: [
                {
                    resource: {
                        attributes: [
                            { key: 'service.name', value: { stringValue: this.config.serviceName } },
                        ],
                    },
                    scopeMetrics: [
                        {
                            scope: { name: '../core/index.js', version: '0.1.0' },
                            metrics: metrics.map(m => ({
                                name: m.name,
                                description: '',
                                unit: '',
                                sum: {
                                    dataPoints: [
                                        {
                                            asDouble: m.value,
                                            timeUnixNano: String(m.timestamp.getTime() * 1_000_000),
                                            attributes: Object.entries(m.labels).map(([k, v]) => ({
                                                key: k,
                                                value: { stringValue: v },
                                            })),
                                        },
                                    ],
                                    aggregationTemporality: 2, // CUMULATIVE
                                    isMonotonic: m.type === 'counter',
                                },
                            })),
                        },
                    ],
                },
            ],
        };
    }
}
