/**
 * Tests for workflow control-flow primitives (personaforge/workflow):
 *   - compose (sequential pipeline with transforms)
 *   - branch (classifier-routed dispatch)
 *   - loopUntil (iterate until condition)
 *   - forEach (fan-out over items)
 *
 * Uses tiny deterministic mock agents; no LLM.
 */

import { describe, it, expect } from 'vitest';
import { compose } from '../src/workflow/compose.js';
import { branch, loopUntil, forEach } from '../src/workflow/branching.js';
import type { WorkflowAgent } from '../src/workflow/types.js';
import type { AgentRunResult } from '../src/core/types.js';

function mockResult(text: string): AgentRunResult {
    return { text, messages: [], steps: 1, finishReason: 'stop' } as unknown as AgentRunResult;
}

/** An agent that returns a fixed prefix + the prompt it received. */
function echoAgent(name: string, prefix = ''): WorkflowAgent {
    return {
        name,
        instructions: `agent ${name}`,
        run: async (prompt: string) => mockResult(`${prefix}${prompt}`),
    };
}

/** An agent that returns a constant string regardless of input. */
function constAgent(name: string, value: string): WorkflowAgent {
    return { name, instructions: name, run: async () => mockResult(value) };
}

describe('compose', () => {
    it('runs steps sequentially, threading text through', async () => {
        const pipeline = compose(
            { agent: echoAgent('a', 'A:') },
            { agent: echoAgent('b', 'B:') },
        );
        const result = await pipeline.run('start');
        // b receives a's output text ("A:start") as its prompt
        expect(result.text).toBe('B:A:start');
    });

    it('applies transform between steps', async () => {
        const pipeline = compose(
            { agent: echoAgent('a', 'A:'), transform: (r) => r.text.toUpperCase() },
            { agent: echoAgent('b', 'B:') },
        );
        const result = await pipeline.run('x');
        expect(result.text).toBe('B:A:X');
    });

    it('throws when no steps are provided', () => {
        expect(() => compose()).toThrow();
    });
});

describe('branch', () => {
    it('routes to the matching agent based on classifier output', async () => {
        const step = branch(constAgent('classifier', 'billing'))
            .when((c) => c.text === 'billing', constAgent('billing-agent', 'handled by billing'))
            .when((c) => c.text === 'tech', constAgent('tech-agent', 'handled by tech'))
            .build();
        const result = await step.run('my invoice is wrong');
        expect(result.text).toBe('handled by billing');
    });

    it('falls back to otherwise() when no branch matches', async () => {
        const step = branch(constAgent('classifier', 'unknown-topic'))
            .when((c) => c.text === 'billing', constAgent('billing', 'billing'))
            .otherwise(constAgent('fallback', 'default handler'))
            .build();
        const result = await step.run('something else');
        expect(result.text).toBe('default handler');
    });
});

describe('loopUntil', () => {
    it('stops as soon as the condition is met', async () => {
        let calls = 0;
        const agent: WorkflowAgent = {
            name: 'counter',
            instructions: 'count',
            run: async () => { calls += 1; return mockResult(String(calls)); },
        };
        const step = loopUntil(agent, (r) => Number(r.text) >= 3, { maxIterations: 10 });
        const result = await step.run('go');
        expect(result.text).toBe('3');
        expect(calls).toBe(3);
    });

    it('stops at maxIterations if the condition is never met', async () => {
        let calls = 0;
        const agent: WorkflowAgent = {
            name: 'never',
            instructions: 'x',
            run: async () => { calls += 1; return mockResult('nope'); },
        };
        const step = loopUntil(agent, () => false, { maxIterations: 4 });
        await step.run('go');
        expect(calls).toBe(4);
    });
});

describe('forEach', () => {
    it('runs the agent over every item and joins results into combined text', async () => {
        const step = forEach(echoAgent('worker', 'item:'), ['a', 'b', 'c']);
        const result = await step.run('unused');
        expect(result.text).toContain('item:a');
        expect(result.text).toContain('item:b');
        expect(result.text).toContain('item:c');
    });

    it('supports a custom toPrompt mapper', async () => {
        const step = forEach(echoAgent('worker'), ['x', 'y'], {
            toPrompt: (item, i) => `${i}:${item}`,
        });
        const result = await step.run('unused');
        expect(result.text).toContain('0:x');
        expect(result.text).toContain('1:y');
    });

    it('runs items concurrently while preserving output order', async () => {
        const step = forEach(echoAgent('worker', 'n:'), ['1', '2', '3', '4'], { concurrency: 2 });
        const result = await step.run('unused');
        const lines = result.text.split('\n\n');
        expect(lines).toEqual(['n:1', 'n:2', 'n:3', 'n:4']);
    });
});
