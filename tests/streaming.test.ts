import { describe, it, expect } from 'vitest';
import { StreamEventBus, StreamContext, createStreamableRun } from '../src/streaming/index.js';
import type { StreamEvent, TokenEvent, CustomEvent } from '../src/streaming/index.js';

describe('StreamEventBus', () => {
  it('filters by mode', async () => {
    const bus = new StreamEventBus(['messages']);
    const collected: StreamEvent[] = [];
    const consume = (async () => { for await (const e of bus.events()) collected.push(e); })();
    await new Promise((r) => setTimeout(r, 5));

    bus.emit({ type: 'token', data: 'hi', timestamp: 1 });
    bus.emit({ type: 'update', data: 'x', node: 'n', timestamp: 2 });
    bus.close();
    await consume;

    expect(collected).toHaveLength(1);
    expect(collected[0]!.type).toBe('token');
  });

  it('respects custom + updates modes', async () => {
    const bus = new StreamEventBus(['custom', 'updates']);
    const collected: StreamEvent[] = [];
    const consume = (async () => { for await (const e of bus.events()) collected.push(e); })();
    await new Promise((r) => setTimeout(r, 5));

    bus.emit({ type: 'custom', name: 'foo', data: 1, timestamp: 1 });
    bus.emit({ type: 'update', data: 'x', node: 'n', timestamp: 2 });
    bus.emit({ type: 'token', data: 'ignored', timestamp: 3 });
    bus.close();
    await consume;

    expect(collected).toHaveLength(2);
    expect(collected.map((e) => e.type)).toEqual(['custom', 'update']);
  });

  it('drains buffered events even if close() called before consume', async () => {
    const bus = new StreamEventBus(['messages']);
    bus.emit({ type: 'token', data: 'pre', timestamp: 1 });
    bus.close();
    const collected: StreamEvent[] = [];
    for await (const e of bus.events()) collected.push(e);
    expect(collected).toHaveLength(1);
    expect((collected[0] as TokenEvent).data).toBe('pre');
  });
});

describe('createStreamableRun', () => {
  it('emits tokens and custom events, returns final result', async () => {
    const { events, result } = createStreamableRun(async (ctx) => {
      ctx.token('Hello');
      ctx.token(' world');
      ctx.emit('milestone', { step: 1 });
      return { answer: 'Hello world' };
    }, { streamMode: ['messages', 'custom'] });

    const collected: StreamEvent[] = [];
    for await (const e of events) collected.push(e);
    const output = await result;

    expect(output).toEqual({ answer: 'Hello world' });
    const tokens = collected.filter((e): e is TokenEvent => e.type === 'token');
    expect(tokens.map((t) => t.data).join('')).toBe('Hello world');
    const custom = collected.filter((e): e is CustomEvent => e.type === 'custom');
    expect(custom[0]!.name).toBe('milestone');
  });

  it('propagates errors from execute', async () => {
    const { events, result } = createStreamableRun(async () => {
      throw new Error('boom');
    });
    const drain = (async () => { for await (const _ of events) { /* noop */ } })();
    await expect(result).rejects.toThrow('boom');
    await drain;
  });
});
