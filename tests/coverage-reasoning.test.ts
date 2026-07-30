/**
 * Hermetic coverage for src/reasoning — manager/ToT/tools remaining branches.
 * Callers: bunx vitest run tests/coverage-*.test.ts. No production imports.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    ReasoningManager,
    REASONING_SYSTEM_PROMPT,
    NextAction,
    ReasoningEventType,
    TreeOfThoughtEngine,
    ReasoningScratchpad,
    createReasoningTools,
} from '../src/reasoning/index.js';

function step(nextAction: NextAction, extra: Record<string, unknown> = {}) {
    return JSON.stringify({
        title: 't',
        action: 'a',
        result: 'r',
        reasoning: 'why',
        nextAction,
        confidence: 0.8,
        ...extra,
    });
}

describe('reasoning/manager gaps', () => {
    beforeEach(() => {
        vi.spyOn(console, 'debug').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('exports default system prompt and honors custom prompt + debug', async () => {
        expect(REASONING_SYSTEM_PROMPT).toContain('Reasoning Agent');
        const generate = vi.fn().mockResolvedValueOnce(step(NextAction.FINAL_ANSWER));
        const manager = new ReasoningManager({
            generate,
            systemPrompt: 'CUSTOM',
            debug: true,
            minSteps: 1,
        });
        const result = await manager.run([{ role: 'user', content: 'q' }]);
        expect(result.success).toBe(true);
        expect(generate.mock.calls[0]![0][0]).toEqual({ role: 'system', content: 'CUSTOM' });
        expect(console.debug).toHaveBeenCalled();
    });

    it('RESET clears steps and continues; FINAL_ANSWER before minSteps continues', async () => {
        const generate = vi
            .fn()
            .mockResolvedValueOnce(step(NextAction.RESET))
            .mockResolvedValueOnce(step(NextAction.FINAL_ANSWER))
            .mockResolvedValueOnce(step(NextAction.FINAL_ANSWER));
        const manager = new ReasoningManager({ generate, minSteps: 2, maxSteps: 5 });
        const result = await manager.run([{ role: 'user', content: 'q' }]);
        expect(result.success).toBe(true);
        expect(result.steps.length).toBeGreaterThanOrEqual(1);
    });

    it('ignores invalid nextAction strings and missing JSON braces', async () => {
        const generate = vi
            .fn()
            .mockResolvedValueOnce(JSON.stringify({ title: 't', nextAction: 'nope', confidence: 1 }))
            .mockResolvedValueOnce(step(NextAction.FINAL_ANSWER));
        const manager = new ReasoningManager({ generate, minSteps: 1, maxSteps: 3 });
        const result = await manager.run([{ role: 'user', content: 'q' }]);
        expect(result.success).toBe(true);
        expect(result.steps[0]!.nextAction).toBeUndefined();

        const bad = new ReasoningManager({
            generate: async () => 'no braces here',
            minSteps: 1,
        });
        const fail = await bad.run([{ role: 'user', content: 'q' }]);
        expect(fail.success).toBe(false);
    });

    it('parse failure on invalid JSON object body', async () => {
        const manager = new ReasoningManager({
            generate: async () => '{not-json}',
            minSteps: 1,
        });
        const result = await manager.run([{ role: 'user', content: 'q' }]);
        expect(result.success).toBe(false);
    });
});

describe('reasoning/tot gaps', () => {
    it('returns empty bestThought when all generates fail', async () => {
        const engine = new TreeOfThoughtEngine({
            beamWidth: 2,
            maxDepth: 2,
            generate: async () => {
                throw new Error('down');
            },
        });
        const result = await engine.solve('goal');
        expect(result.bestThought).toBe('');
        expect(result.score).toBe(0);
        expect(result.depth).toBe(0);
    });

    it('uses generate as evaluate by default and parses JSON / float / fallback scores', async () => {
        let calls = 0;
        const engine = new TreeOfThoughtEngine({
            beamWidth: 1,
            maxDepth: 2,
            generate: async (msgs) => {
                calls += 1;
                const sys = msgs[0]?.content ?? '';
                if (sys.includes('evaluator')) {
                    if (calls === 2) return '{"score": 0.8}';
                    if (calls === 4) return 'score is 1.5 clipped';
                    return 'no numeric';
                }
                return `thought-${calls}`;
            },
            evaluationPrompt: 'You are a rigorous evaluator',
            generationPrompt: 'gen',
        });
        const result = await engine.solve('g', 'ctx');
        expect(result.nodes.length).toBeGreaterThan(0);
        expect(result.bestThought).toBeTruthy();
    });

    it('evaluate rejection yields zero score for that candidate', async () => {
        const engine = new TreeOfThoughtEngine({
            beamWidth: 1,
            maxDepth: 1,
            generate: async () => 'ok thought',
            evaluate: async () => {
                throw new Error('eval fail');
            },
        });
        const result = await engine.solve('goal');
        expect(result.score).toBe(0);
        expect(result.bestThought).toBe('ok thought');
    });
});

describe('reasoning/tools gaps', () => {
    it('analyze without query returns all steps', async () => {
        const pad = new ReasoningScratchpad();
        const tools = createReasoningTools(pad);
        await tools.think.execute({ title: 'a', thought: 'one' });
        await tools.think.execute({ title: 'b', thought: 'two' });
        const all = await tools.analyze.execute({});
        expect(all.steps).toHaveLength(2);
    });
});
