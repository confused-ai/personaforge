/**
 * Coverage for src/lite.ts (barrel) — agent(), bare(), defineAgent(), compose(), pipe().
 * Construction only (no LLM call); compose/pipe are exercised with a mock agent.
 */

import { describe, it, expect } from 'vitest';
import { agent, bare, defineAgent, compose, pipe } from '../src/lite.js';
import { createMockAgent } from '../src/test.js';

describe('lite barrel', () => {
    const fakeProvider = { id: 'fake', run: async () => ({ text: 'x' }) } as never;

    it('agent() accepts a string and builds a runnable', () => {
        const a = agent({ instructions: 'You are helpful.', llm: fakeProvider });
        expect(typeof a.run).toBe('function');
        expect(a.name).toBe('Agent');
    });

    it('agent() accepts an options object', () => {
        const a = agent({ instructions: 'Do things.', name: 'Bot', llm: fakeProvider, sessionStore: false, guardrails: false });
        expect(a.name).toBe('Bot');
    });

    it('agent() throws without instructions', () => {
        expect(() => agent({} as never)).toThrow(/requires instructions/);
    });

    it('bare() builds with all defaults disabled', () => {
        const a = bare({ llm: fakeProvider, instructions: 'Do stuff.' } as never);
        expect(typeof a.run).toBe('function');
    });

    it('defineAgent() returns a builder (no build call needed for construction)', () => {
        const builder = defineAgent();
        expect(builder).toBeDefined();
        expect(typeof builder.build).toBe('function');
    });

    it('compose() chains mock agents and passes output forward', async () => {
        const r = createMockAgent({ name: 'R', instructions: 'i', responses: ['research'] });
        const w = createMockAgent({ name: 'W', instructions: 'i', responses: ['report'] });
        const pipeline = compose(r, w);
        const res = await pipeline.run('topic');
        expect(res.text).toBe('report');
        expect(r.callHistory[0]!.prompt).toBe('topic');
        expect(w.callHistory[0]!.prompt).toBe('research');
    });

    it('compose() throws with fewer than 2 agents', () => {
        const a = createMockAgent({ name: 'A', instructions: 'i', responses: ['x'] });
        expect(() => compose(a)).toThrow(/at least 2 agents/);
    });

    it('pipe() builds a builder and runs the pipeline', async () => {
        const a = createMockAgent({ name: 'A', instructions: 'i', responses: ['first'] });
        const b = createMockAgent({ name: 'B', instructions: 'i', responses: ['second'] });
        const built = pipe(a).then(b);
        expect(typeof built.run).toBe('function');
        const res = await built.run('go');
        expect(res.text).toBe('second');
    });
});
