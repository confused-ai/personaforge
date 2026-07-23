/**
 * Metrics Collector Implementation
 *
 * In-memory metrics collection for monitoring and observability
 *
 * @deprecated The live metrics stack is `@personaforge/observe`
 *   (`src/observe/metrics.ts` + `src/observe/prometheus.ts`). This in-memory collector
 *   is retained only for the legacy `personaforge/observability` path and has no active
 *   importers. Migrate to `personaforge/observe`.
 */

import { MetricsCollector, MetricValue, MetricType } from './types.js';

/**
 * Metrics collector implementation
 */
export class MetricsCollectorImpl implements MetricsCollector {
    private metrics: MetricValue[] = [];
    // Gauge index: canonical key → position in metrics[] for O(1) gauge dedup
    private gaugeIndex = new Map<string, number>();
    private static readonly MAX_METRICS = 50_000;

    private _gaugeKey(name: string, labels: Record<string, string>): string {
        // Stable key regardless of label insertion order
        const sorted = Object.keys(labels).sort().map(k => `${k}=${labels[k]}`).join(',');
        return `${name}|${sorted}`;
    }

    counter(name: string, value = 1, labels: Record<string, string> = {}): void {
        this.metrics.push({
            name,
            type: MetricType.COUNTER,
            value,
            labels,
            timestamp: new Date(),
        });
        // Cap total metrics to prevent unbounded growth
        if (this.metrics.length > MetricsCollectorImpl.MAX_METRICS) {
            this.metrics = this.metrics.slice(-MetricsCollectorImpl.MAX_METRICS);
            // Rebuild gauge index after compaction
            this.gaugeIndex.clear();
            for (let i = 0; i < this.metrics.length; i++) {
                const m = this.metrics[i]!;
                if (m.type === MetricType.GAUGE) {
                    this.gaugeIndex.set(this._gaugeKey(m.name, m.labels), i);
                }
            }
        }
    }

    gauge(name: string, value: number, labels: Record<string, string> = {}): void {
        const key = this._gaugeKey(name, labels);
        const existing = this.gaugeIndex.get(key);
        const entry: MetricValue = { name, type: MetricType.GAUGE, value, labels, timestamp: new Date() };
        if (existing !== undefined && existing < this.metrics.length && this.metrics[existing]?.name === name) {
            // Update in-place — O(1), avoids filter+rebuild
            this.metrics[existing] = entry;
        } else {
            this.gaugeIndex.set(key, this.metrics.length);
            this.metrics.push(entry);
        }
    }

    histogram(name: string, value: number, labels: Record<string, string> = {}): void {
        this.metrics.push({
            name,
            type: MetricType.HISTOGRAM,
            value,
            labels,
            timestamp: new Date(),
        });
    }

    getMetrics(): MetricValue[] {
        return [...this.metrics];
    }

    clear(): void {
        this.metrics = [];
        this.gaugeIndex.clear();
    }

    /**
     * Get metrics by name
     */
    getMetricsByName(name: string): MetricValue[] {
        return this.metrics.filter(m => m.name === name);
    }

    /**
     * Get metrics by type
     */
    getMetricsByType(type: MetricType): MetricValue[] {
        return this.metrics.filter(m => m.type === type);
    }

    /**
     * Get the latest value for a metric — O(n) linear scan, no sort
     */
    getLatestValue(name: string): number | undefined {
        let latest: MetricValue | undefined;
        for (const m of this.metrics) {
            if (m.name === name && (!latest || m.timestamp > latest.timestamp)) {
                latest = m;
            }
        }
        return latest?.value;
    }
}
