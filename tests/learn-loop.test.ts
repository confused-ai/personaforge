import { describe, it, expect } from 'vitest';

import { simulate, trainsetFromReport } from '../src/simulation/index.js';
import { bootstrapFewShot } from '../src/optimize/index.js';

const llm = {
  generateText: async (messages: any[]) => {
    const p = String(messages[messages.length - 1]?.content ?? '');
    return { text: p.includes('cat') ? 'meow' : 'woof', toolCalls: [], finishReason: 'stop' };
  },
} as any;

describe('self-improvement loop (sim → learn → optimize)', () => {
  it('compiles a few-shot prompt from passing simulation outcomes', async () => {
    const report = await simulate(
      { name: 'animal', instructions: 'answer with an animal sound', llm },
      [
        { name: 'cat', prompt: 'say cat', expect: (r) => r.text === 'meow' },
        { name: 'dog', prompt: 'say dog', expect: (r) => r.text === 'woof' },
        { name: 'bad', prompt: 'say cat', expect: (r) => r.text === 'woof' }, // fails → excluded from trainset
      ],
    );

    const trainset = trainsetFromReport(report);
    expect(trainset).toHaveLength(2); // only the two passing outcomes
    expect(trainset).toContainEqual({ input: 'say cat', expected: 'meow' });

    const optimized = await bootstrapFewShot({
      instruction: 'answer with an animal sound',
      trainset,
      generate: async (prompt: string) => (prompt.includes('cat') ? 'meow' : 'woof'),
      scorer: (expected, actual) => (actual.trim() === expected ? 1 : 0),
    });

    expect(optimized.demos.length).toBeGreaterThan(0);
    expect(optimized.yield).toBeGreaterThan(0);
    // The rendered prompt embeds the learned demos.
    expect(optimized.render('say cat')).toContain('meow');
  });
});
