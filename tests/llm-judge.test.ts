import { describe, it, expect } from 'vitest';
import { runLlmAsJudge } from '@personaforge/eval';
import { MockLLMProvider } from '../src/testing/mock-llm.js';

describe('runLlmAsJudge', () => {
    it('parses JSON score from judge output', async () => {
        const llm = new MockLLMProvider({
            response: '{"score": 8, "rationale": "Accurate and concise."}',
        });
        const r = await runLlmAsJudge({
            llm,
            rubric: 'Reward correctness.',
            candidate: 'Paris is the capital of France.',
            maxScore: 10,
        });
        expect(r.score).toBe(8);
        expect(r.rationale).toContain('concise');
    });

    it('clamps score when model returns out of range', async () => {
        const llm = new MockLLMProvider({
            response: '{"score": 99, "rationale": "oops"}',
        });
        const r = await runLlmAsJudge({
            llm,
            rubric: 'x',
            candidate: 'y',
            maxScore: 10,
        });
        expect(r.score).toBe(10);
    });

    it('handles non-JSON gracefully', async () => {
        const llm = new MockLLMProvider({ response: 'cannot score this' });
        const r = await runLlmAsJudge({
            llm,
            rubric: 'x',
            candidate: 'y',
        });
        expect(r.score).toBe(0);
        expect(r.rationale).toMatch(/JSON/i);
    });
});
