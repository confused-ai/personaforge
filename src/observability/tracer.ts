/**
 * In-Memory Tracer Implementation
 *
 * Simple in-memory tracing for development and debugging
 *
 * @deprecated The live OpenTelemetry tracing stack is `@personaforge/observe`
 *   (`src/observe/tracing.ts`). This in-memory tracer is retained only for the
 *   legacy `personaforge/observability` path and has no active importers. Migrate to
 *   `personaforge/observe`.
 */

import { Tracer, TraceSpan, SpanStatus, SpanEvent } from './types.js';
import type { EntityId } from '../core/types.js';

/**
 * In-memory tracer implementation
 */
export class InMemoryTracer implements Tracer {
    private spans: Map<EntityId, TraceSpan> = new Map();
    private currentSpanId?: EntityId;

    startSpan(name: string, parentId?: EntityId): TraceSpan {
        const id = this.generateId();
        const traceId = parentId
            ? this.spans.get(parentId)?.traceId ?? this.generateTraceId()
            : this.generateTraceId();

        const span: TraceSpan = {
            id,
            traceId,
            parentId,
            name,
            startTime: new Date(),
            status: SpanStatus.UNSET,
            attributes: {},
            events: [],
        };

        this.spans.set(id, span);
        this.currentSpanId = id;

        return span;
    }

    endSpan(spanId: EntityId, status: SpanStatus = SpanStatus.OK): void {
        const span = this.spans.get(spanId);
        if (span) {
            Object.assign(span, {
                endTime: new Date(),
                status,
            });
        }

        if (this.currentSpanId === spanId) {
            this.currentSpanId = undefined;
        }
    }

    addEvent(spanId: EntityId, event: Omit<SpanEvent, 'timestamp'>): void {
        const span = this.spans.get(spanId);
        if (span) {
            span.events.push({
                ...event,
                timestamp: new Date(),
            });
        }
    }

    setAttributes(spanId: EntityId, attributes: Record<string, unknown>): void {
        const span = this.spans.get(spanId);
        if (span) {
            Object.assign(span.attributes, attributes);
        }
    }

    getSpan(spanId: EntityId): TraceSpan | undefined {
        return this.spans.get(spanId);
    }

    getCurrentSpan(): TraceSpan | undefined {
        return this.currentSpanId ? this.spans.get(this.currentSpanId) : undefined;
    }

    getTrace(traceId: string): TraceSpan[] {
        return Array.from(this.spans.values()).filter(span => span.traceId === traceId);
    }

    /**
     * Get all spans
     */
    getAllSpans(): TraceSpan[] {
        return Array.from(this.spans.values());
    }

    /**
     * Clear all spans
     */
    clear(): void {
        this.spans.clear();
        this.currentSpanId = undefined;
    }

    private generateId(): EntityId {
        return `span-${crypto.randomUUID()}`;
    }

    private generateTraceId(): string {
        return `trace-${crypto.randomUUID()}`;
    }
}
