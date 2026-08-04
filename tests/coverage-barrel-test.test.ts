/**
 * Coverage for src/test.ts (barrel) — mock agent + scenario runner utilities.
 * These run deterministically with no LLM.
 */

import { describe, it, expect } from 'vitest';
import {
    createMockAgent,
    mockAgent,
    scenario,
    createScenarioRunner,
    ScenarioRunner,
} from '../src/test.js';

describe('test barrel', () => {
    it('createMockAgent returns deterministic responses and tracks history', async () => {
        const a = createMockAgent({ name: 'R', instructions: 'i', responses: ['one', 'two'] });
        const r1 = await a.run('hi');
        expect(r1.text).toBe('one');
        const r2 = await a.run('again');
        expect(r2.text).toBe('two');
        expect(a.callHistory).toHaveLength(2);
        expect(a.callHistory[0]!.prompt).toBe('hi');
        a.reset();
        expect(a.callHistory).toHaveLength(0);
    });

    it('createMockAgent throws when shouldError is set', async () => {
        const a = createMockAgent({ responses: ['x'], shouldError: true, errorMessage: 'boom' });
        await expect(a.run('hi')).rejects.toThrow('boom');
    });

    it('mockAgent is an alias for createMockAgent', async () => {
        const a = mockAgent({ name: 'A', instructions: 'i', responses: ['ok'] });
        expect(await a.run('q')).toMatchObject({ text: 'ok' });
    });

    it('scenario() drives a multi-turn flow with assertions', async () => {
        const a = createMockAgent({ name: 'A', instructions: 'i', responses: ['Hello!', 'Alice'] });
        const results = await scenario(a)
            .send('Hi')
            .expectText('Hello')
            .send('name?')
            .expectText('Alice')
            .expectSteps(1)
            .run();
        expect(results).toHaveLength(2);
    });

    it('createScenarioRunner / ScenarioRunner reject a failing assertion', async () => {
        const a = createMockAgent({ name: 'A', instructions: 'i', responses: ['nope'] });
        const runner = createScenarioRunner(a);
        expect(runner).toBeInstanceOf(ScenarioRunner);
        await expect(
            runner.send('hi').expectText('Expected').run(),
        ).rejects.toThrow(/Expected/);
    });

    it('ScenarioRunner requires .send() before assertions', () => {
        const a = createMockAgent({ name: 'A', instructions: 'i', responses: ['x'] });
        expect(() => createScenarioRunner(a).expectText('x')).toThrow(/call \.send\(\)/);
    });
});
