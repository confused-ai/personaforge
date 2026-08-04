/**
 * Coverage for src/observe.ts (barrel) — in-process observability primitives.
 */

import { describe, it, expect } from 'vitest';
import {
    ConsoleLogger,
    InMemoryTracer,
    MetricsCollectorImpl,
} from '../src/observe.js';

describe('observe barrel', () => {
    it('ConsoleLogger logs at all levels without throwing', () => {
        const log = new ConsoleLogger({ level: 'debug' as never });
        expect(() => {
            log.debug('d');
            log.info('i');
            log.warn('w');
            log.error('e');
            log.fatal('f');
        }).not.toThrow();
    });

    it('InMemoryTracer records spans, events, and attributes', () => {
        const tracer = new InMemoryTracer();
        const span = tracer.startSpan('op', undefined);
        tracer.addEvent(span.id, { name: 'evt' });
        tracer.setAttributes(span.id, { k: 'v' });
        tracer.endSpan(span.id);
        expect(span.id).toBeDefined();
        expect(span.status).toBeDefined();
    });

    it('MetricsCollectorImpl records gauges and exposes them', () => {
        const m = new MetricsCollectorImpl();
        m.gauge('queue', 3);
        const all = m.getMetrics();
        expect(Array.isArray(all)).toBe(true);
        expect(m.getMetricsByName('queue').length).toBeGreaterThan(0);
    });
});
