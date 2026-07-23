import { describe, it, expect } from 'vitest';
import { createDeepAgent } from '../src/skills/deep-research.js';

describe('createDeepAgent', () => {
  it('plans, researches (parallel), and synthesizes', async () => {
    const calls: string[] = [];
    const deep = createDeepAgent({
      generate: async (prompt: string) => {
        calls.push(prompt.slice(0, 40));
        if (prompt.includes('research planner')) return 'Sub Q1\nSub Q2\nSub Q3';
        if (prompt.includes('research synthesizer')) return 'Final synthesized answer with [Q1] citations.';
        return `Answer to: ${prompt.split('\n').pop()}`;
      },
      maxQuestions: 3,
      maxParallel: 3,
    });
    const result = await deep.run('What are XYZ effects?');
    expect(result.subQuestions).toEqual(['Sub Q1', 'Sub Q2', 'Sub Q3']);
    expect(result.rawSubAnswers.length).toBe(3);
    expect(result.answer).toContain('Final synthesized');
    expect(result.steps.map((s) => s.phase)).toContain('plan');
    expect(result.steps.map((s) => s.phase)).toContain('research');
    expect(result.steps.map((s) => s.phase)).toContain('synthesize');
  });

  it('uses tools for each sub-question', async () => {
    const toolCalls: string[] = [];
    const deep = createDeepAgent({
      generate: async (prompt: string) => {
        if (prompt.includes('research planner')) return 'Sub Q1';
        return 'answer';
      },
      tools: [
        {
          name: 'search',
          description: 'search',
          execute: async (input: unknown) => {
            toolCalls.push((input as { query: string }).query);
            return { results: ['fact 1'] };
          },
        },
      ],
      maxQuestions: 1,
    });
    await deep.run('question');
    expect(toolCalls).toContain('Sub Q1');
  });

  it('respects maxQuestions cap', async () => {
    const deep = createDeepAgent({
      generate: async (prompt: string) => {
        if (prompt.includes('research planner')) return Array.from({ length: 20 }, (_, i) => `Q${String(i)}`).join('\n');
        return 'x';
      },
      maxQuestions: 4,
    });
    const r = await deep.run('question');
    expect(r.subQuestions.length).toBe(4);
  });
});
