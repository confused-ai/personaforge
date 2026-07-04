import { describe, it, expect } from 'vitest';

import { simulate } from '../src/simulation/index.js';
import { InMemoryEventStore } from '../src/graph/event-store.js';

const promptOf = (messages: any[]): string => String(messages[messages.length - 1]?.content ?? '');

const llm = {
  generateText: async (messages: any[]) => {
    const p = promptOf(messages);
    return { text: p.includes('cat') ? 'meow' : 'woof', toolCalls: [], finishReason: 'stop' };
  },
} as any;

describe('simulate (agent wind tunnel)', () => {
  it('aggregates pass/fail across scenarios and records each run', async () => {
    const store = new InMemoryEventStore();
    const report = await simulate(
      { name: 'animal-bot', instructions: 'answer with an animal sound', llm },
      [
        { name: 'cat', prompt: 'say cat', expect: (r) => r.text === 'meow' },
        { name: 'dog', prompt: 'say dog', expect: (r) => r.text === 'woof' },
        { name: 'wrong', prompt: 'say dog', expect: (r) => r.text === 'meow' },
      ],
      { store, concurrency: 2 },
    );

    expect(report.total).toBe(3);
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.passRate).toBeCloseTo(2 / 3, 5);

    // Outcomes preserve input order.
    expect(report.outcomes.map((o) => o.name)).toEqual(['cat', 'dog', 'wrong']);

    // Every run was recorded into the durable log → replayable.
    const events = await store.load(report.outcomes[0]!.executionId);
    expect(events.length).toBeGreaterThan(0);
  });

  it('passes all when no expectation is given', async () => {
    const report = await simulate(
      { name: 'bot', instructions: 'x', llm },
      [{ name: 'a', prompt: 'hi' }, { name: 'b', prompt: 'yo' }],
    );
    expect(report.passed).toBe(2);
    expect(report.passRate).toBe(1);
  });
});
