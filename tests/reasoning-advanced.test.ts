import { describe, it, expect } from 'vitest';
import { ReflexionEngine } from '../src/reasoning/reflexion.js';
import { ReWooEngine } from '../src/reasoning/rewoo.js';
import { GotEngine } from '../src/reasoning/got.js';

describe('ReflexionEngine', () => {
    it('retries on evaluation failure and passes when evaluator succeeds', async () => {
        let attemptsCount = 0;
        const engine = new ReflexionEngine({
            maxAttempts: 3,
            generate: async (msgs) => {
                const sys = msgs[0]?.content ?? '';
                const user = msgs[msgs.length - 1]?.content ?? '';
                if (sys.includes('self-reflection')) {
                    return 'Critique: Need to double check calculations and format correctly.';
                }
                attemptsCount++;
                return attemptsCount < 2 ? 'Incorrect answer 41' : 'Correct answer 42';
            },
            evaluate: async (resp) => {
                const passed = resp.includes('42');
                return { passed, score: passed ? 1.0 : 0.2, feedback: passed ? 'Verified' : 'Wrong output' };
            },
        });

        const result = await engine.solve('What is 6 * 7?');
        expect(result.passed).toBe(true);
        expect(result.totalAttempts).toBe(2);
        expect(result.solution).toContain('42');
        expect(result.attempts.length).toBe(2);
        expect(result.attempts[0]?.critique).toContain('Critique');
    });

    it('stops at maxAttempts if evaluation continues to fail', async () => {
        const engine = new ReflexionEngine({
            maxAttempts: 2,
            generate: async () => 'Always wrong answer',
            evaluate: async () => ({ passed: false, score: 0.1, feedback: 'Incorrect' }),
        });

        const result = await engine.solve('Unsolvable problem');
        expect(result.passed).toBe(false);
        expect(result.totalAttempts).toBe(2);
        expect(result.score).toBe(0.1);
    });
});

describe('ReWooEngine', () => {
    it('decouples planning, variable substitution tool execution, and solver synthesis', async () => {
        const executedTools: Array<{ name: string; input: string }> = [];

        const engine = new ReWooEngine({
            generate: async (msgs) => {
                const user = msgs[msgs.length - 1]?.content ?? '';
                if (user.includes('Generate the execution plan')) {
                    return JSON.stringify([
                        { id: '#E1', tool: 'search', input: 'weather in Paris' },
                        { id: '#E2', tool: 'calculator', input: 'convert 20C to F using data from #E1' },
                    ]);
                }
                return 'Final answer: Paris weather is 68F based on #E1 and #E2';
            },
            executeTool: async (tool, input) => {
                executedTools.push({ name: tool, input });
                if (tool === 'search') return 'Temperature in Paris is 20C';
                if (tool === 'calculator') return '68F';
                return 'ok';
            },
        });

        const result = await engine.solve('Check Paris weather in F');
        expect(result.plan.length).toBe(2);
        expect(executedTools.length).toBe(2);
        expect(executedTools[1]?.input).toContain('Temperature in Paris is 20C');
        expect(result.variableMap['#E1']).toBe('Temperature in Paris is 20C');
        expect(result.variableMap['#E2']).toBe('68F');
        expect(result.solution).toContain('Paris weather');
        expect(result.successCount).toBe(2);
    });
});

describe('GotEngine', () => {
    it('builds a non-linear graph with generate, aggregate, and refine operations', async () => {
        let counter = 0;
        const engine = new GotEngine({
            numBranches: 2,
            maxIterations: 2,
            keepBest: 2,
            generate: async (msgs) => {
                const sys = msgs[0]?.content ?? '';
                counter++;
                if (sys.includes('merge multiple partial thoughts')) {
                    return `Aggregated super-thought ${counter}`;
                }
                if (sys.includes('improve a candidate thought')) {
                    return `Refined thought ${counter}`;
                }
                return `Initial thought ${counter}`;
            },
            evaluate: async (msgs) => {
                const content = msgs[msgs.length - 1]?.content ?? '';
                if (content.includes('Aggregated')) return JSON.stringify({ score: 0.95 });
                if (content.includes('Refined')) return JSON.stringify({ score: 0.8 });
                return JSON.stringify({ score: 0.5 });
            },
        });

        const result = await engine.solve('Graph problem');
        expect(result.nodes.length).toBeGreaterThan(2);
        expect(result.edges.length).toBeGreaterThan(0);
        expect(result.iterations).toBeGreaterThan(0);
        expect(result.score).toBeGreaterThanOrEqual(0.8);
        expect(result.solution).toBeDefined();

        const ops = result.nodes.map((n) => n.operation);
        expect(ops).toContain('generate');
        expect(ops.some((op) => op === 'refine' || op === 'aggregate')).toBe(true);
    });
});
