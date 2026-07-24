/**
 * Tests for reasoning primitives:
 *   - ReasoningScratchpad (add / all / count / search / clear / render)
 *   - createReasoningTools (think / analyze tools wired to a scratchpad)
 *   - TreeOfThoughtEngine.solve with deterministic injected generate/evaluate
 */

import { describe, it, expect } from 'vitest';
import { ReasoningScratchpad, createReasoningTools } from '../src/reasoning/reasoning-tools.js';
import { TreeOfThoughtEngine } from '../src/reasoning/tot.js';

describe('ReasoningScratchpad', () => {
    it('add() assigns sequential ids and stores steps', () => {
        const s = new ReasoningScratchpad();
        const a = s.add('plan', 'first, gather data');
        const b = s.add('act', 'then call the tool');
        expect(a.id).toBe(1);
        expect(b.id).toBe(2);
        expect(s.count()).toBe(2);
        expect(s.all().length).toBe(2);
    });

    it('search() matches on title and thought, case-insensitively', () => {
        const s = new ReasoningScratchpad();
        s.add('Gather', 'collect the SALES data');
        s.add('Compute', 'sum revenue');
        expect(s.search('sales').length).toBe(1);
        expect(s.search('COMPUTE').length).toBe(1);
        expect(s.search('nothing').length).toBe(0);
    });

    it('render() produces a readable transcript', () => {
        const s = new ReasoningScratchpad();
        s.add('Step A', 'do A');
        const text = s.render();
        expect(text).toContain('Step 1');
        expect(text).toContain('Step A');
        expect(text).toContain('do A');
    });

    it('clear() empties the scratchpad', () => {
        const s = new ReasoningScratchpad();
        s.add('x', 'y');
        s.clear();
        expect(s.count()).toBe(0);
    });
});

describe('createReasoningTools', () => {
    it('think tool records a step and reports totals', async () => {
        const s = new ReasoningScratchpad();
        const tools = createReasoningTools(s);
        const out = await tools.think.execute({ title: 'plan', thought: 'break it down' });
        expect(out.stepId).toBe(1);
        expect(out.totalSteps).toBe(1);
        expect(s.count()).toBe(1);
    });

    it('analyze tool searches prior reasoning', async () => {
        const s = new ReasoningScratchpad();
        const tools = createReasoningTools(s);
        await tools.think.execute({ title: 'data', thought: 'the revenue is high' });
        const out = await tools.analyze.execute({ query: 'revenue' });
        expect(Array.isArray(out.steps)).toBe(true);
        expect(out.steps.length).toBe(1);
    });
});

describe('TreeOfThoughtEngine.solve', () => {
    it('returns the highest-scoring branch with deterministic scorers', async () => {
        // generate() always returns a thought tagged with a numeric quality we
        // encode in the text; evaluate() scores by reading that number so the
        // search is fully deterministic.
        let counter = 0;
        const engine = new TreeOfThoughtEngine({
            beamWidth: 2,
            maxDepth: 2,
            generate: async () => {
                counter += 1;
                // alternate high/low quality thoughts
                const quality = counter % 2 === 0 ? 'GOOD' : 'meh';
                return `thought-${counter} ${quality}`;
            },
            evaluate: async (messages) => {
                const content = messages[messages.length - 1]?.content ?? '';
                return content.includes('GOOD') ? '0.9' : '0.2';
            },
        });

        const result = await engine.solve('reach the goal', '');
        expect(result.bestThought).toContain('GOOD');
        expect(result.score).toBeGreaterThan(0);
        expect(result.nodes.length).toBeGreaterThan(0);
        expect(result.depth).toBeGreaterThanOrEqual(1);
    });

    it('is resilient when generate throws (returns a result, no crash)', async () => {
        const engine = new TreeOfThoughtEngine({
            beamWidth: 2,
            maxDepth: 1,
            generate: async () => { throw new Error('llm down'); },
            evaluate: async () => '0.5',
        });
        const result = await engine.solve('goal', '');
        // Engine swallows generation errors (empty thoughts) and still returns.
        expect(result).toBeDefined();
        expect(Array.isArray(result.nodes)).toBe(true);
    });
});
