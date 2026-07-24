/**
 * Tests for StreamEventBus + StreamContext (personaforge/streaming).
 */

import { describe, it, expect } from 'vitest';
import { StreamEventBus, StreamContext } from '../src/streaming/index.js';

describe('StreamEventBus', () => {
    it('delivers emitted events to on() listeners', () => {
        const bus = new StreamEventBus(['updates', 'messages', 'custom']);
        const seen: unknown[] = [];
        bus.on((e) => seen.push(e));
        bus.emit({ type: 'custom', name: 'x', data: 1, timestamp: Date.now() });
        expect(seen.length).toBe(1);
    });

    it('on() returns an unsubscribe function', () => {
        const bus = new StreamEventBus(['custom']);
        let count = 0;
        const off = bus.on(() => { count++; });
        bus.emit({ type: 'custom', name: 'x', data: 1, timestamp: Date.now() });
        off();
        bus.emit({ type: 'custom', name: 'y', data: 2, timestamp: Date.now() });
        expect(count).toBe(1);
    });

    it('filters events by mode (only subscribed modes are emitted)', () => {
        // token events map to the "messages" mode; a bus without it drops them.
        const bus = new StreamEventBus(['updates']);
        const seen: unknown[] = [];
        bus.on((e) => seen.push(e));
        bus.emit({ type: 'token', data: 'hi', timestamp: Date.now() });
        expect(seen.length).toBe(0);
    });

    it('events() async-iterates queued events then ends on close()', async () => {
        const bus = new StreamEventBus(['custom']);
        bus.emit({ type: 'custom', name: 'a', data: 1, timestamp: Date.now() });
        bus.emit({ type: 'custom', name: 'b', data: 2, timestamp: Date.now() });
        bus.close();
        const got: string[] = [];
        for await (const e of bus.events()) {
            if (e.type === 'custom') got.push(e.name);
        }
        expect(got).toEqual(['a', 'b']);
    });

    it('does not emit after close()', () => {
        const bus = new StreamEventBus(['custom']);
        const seen: unknown[] = [];
        bus.on((e) => seen.push(e));
        bus.close();
        bus.emit({ type: 'custom', name: 'x', data: 1, timestamp: Date.now() });
        expect(seen.length).toBe(0);
    });
});

describe('StreamContext', () => {
    it('emit/token/toolCall/debug push shaped events onto the bus', () => {
        const bus = new StreamEventBus(['updates', 'messages', 'custom', 'debug']);
        const seen: Array<{ type: string }> = [];
        bus.on((e) => seen.push(e));
        const ctx = new StreamContext(bus, 'node-1');
        ctx.emit('custom-event', { k: 'v' });
        ctx.token('hello');
        ctx.toolCall('search', { q: 'x' }, { hits: 1 });
        ctx.debug({ trace: true });
        const types = seen.map((e) => e.type);
        expect(types).toContain('custom');
        expect(types).toContain('token');
        expect(types).toContain('tool_call');
    });
});
