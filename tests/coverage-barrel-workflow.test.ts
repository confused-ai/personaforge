/**
 * Coverage for src/workflow.ts (barrel) — compose/pipe pipelines + message bus.
 * LLM-free: compose/pipe run against mock agents; MessageBusImpl is in-memory.
 */

import { describe, it, expect } from 'vitest';
import { compose, pipe, MessageBusImpl } from '../src/workflow.js';
import type { AgentMessage } from '../src/workflow.js';
import { createMockAgent } from '../src/test.js';

describe('workflow barrel', () => {
    it('compose() chains mock agents', async () => {
        const a = createMockAgent({ name: 'A', instructions: 'i', responses: ['alpha'] });
        const b = createMockAgent({ name: 'B', instructions: 'i', responses: ['beta'] });
        const res = await compose(a, b).run('start');
        expect(res.text).toBe('beta');
        expect(b.callHistory[0]!.prompt).toBe('alpha');
    });

    it('compose() honours a when() predicate to stop early', async () => {
        const a = createMockAgent({ name: 'A', instructions: 'i', responses: ['alpha'] });
        const b = createMockAgent({ name: 'B', instructions: 'i', responses: ['beta'] });
        const res = await compose(a, b, {
            when: () => false,
        }).run('start');
        // when() returns false after the first stage → returns stage A's result
        expect(res.text).toBe('alpha');
        expect(b.callHistory).toHaveLength(0);
    });

    it('pipe() builds and runs a builder pipeline', async () => {
        const a = createMockAgent({ name: 'A', instructions: 'i', responses: ['one'] });
        const b = createMockAgent({ name: 'B', instructions: 'i', responses: ['two'] });
        const p = pipe(a).then(b);
        const res = await p.run('go');
        expect(res.text).toBe('two');
    });

    it('MessageBusImpl sends, subscribes, and delivers messages', async () => {
        const bus = new MessageBusImpl();
        const received: AgentMessage[] = [];
        const sub = bus.subscribe(
            'b',
            { types: ['task_request'] } as never,
            ((m: AgentMessage) => {
                received.push(m);
            }) as never,
        );
        const msg = await bus.send({
            type: 'task_request',
            from: 'a',
            to: 'b',
            content: 'hi',
        } as never);
        expect(msg.id).toBeDefined();
        expect(received).toHaveLength(1);
        // Also exercisable via the history accessor.
        expect(bus.getMessages({ types: ['task_request'] } as never)).toHaveLength(1);
        bus.unsubscribe(sub);
    });
});
