import { describe, it, expect } from 'vitest';
import { spanToSample, replayDataset, diffResults, summarizeDiff } from '../src/eval/trace-dataset.js';
import type { TraceSpan } from '../src/eval/trace-dataset.js';

const span: TraceSpan = {
  id: 's1',
  name: 'agent.run',
  input: 'What is 2+2?',
  output: '4',
  startTime: 0,
  endTime: 100,
  metadata: { model: 'gpt-4o' },
};

describe('spanToSample', () => {
  it('converts a span into an eval sample', () => {
    const sample = spanToSample(span);
    expect(sample.id).toBe('s1');
    expect(sample.input).toBe('What is 2+2?');
    expect(sample.expected).toBe('4');
    expect(sample.metadata!.source).toBe('trace');
    expect(sample.metadata!.model).toBe('gpt-4o');
  });
});

describe('replayDataset', () => {
  it('runs samples through a run fn (string return)', async () => {
    const samples = [spanToSample(span)];
    const results = await replayDataset(samples, async (input) => `echo:${input}`);
    expect(results).toHaveLength(1);
    expect(results[0]!.output).toBe('echo:What is 2+2?');
    expect(results[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });
  it('handles {text} return shape', async () => {
    const samples = [spanToSample(span)];
    const results = await replayDataset(samples, async () => ({ text: 'wrapped' }));
    expect(results[0]!.output).toBe('wrapped');
  });
});

describe('diffResults + summarizeDiff', () => {
  it('detects unchanged, regression, improvement', async () => {
    const samples = [
      { id: 'a', input: 'q1', expected: 'correct' },
      { id: 'b', input: 'q2', expected: 'correct' },
      { id: 'c', input: 'q3', expected: 'correct' },
    ];
    const baseline = await replayDataset(samples, async (input) => {
      if (input === 'q1') return 'correct';   // baseline correct
      if (input === 'q2') return 'correct';   // baseline correct
      return 'wrong';                          // baseline wrong
    });
    const candidate = await replayDataset(samples, async (input) => {
      if (input === 'q1') return 'correct';   // still correct -> unchanged
      if (input === 'q2') return 'wrong';     // regression
      return 'correct';                        // improvement
    });
    const diffs = diffResults(baseline, candidate);
    expect(diffs).toHaveLength(3);
    const summary = summarizeDiff(diffs);
    expect(summary.total).toBe(3);
    expect(summary.unchanged).toBe(1);
    expect(summary.regressions).toBe(1);
    expect(summary.improvements).toBe(1);
  });

  it('throws on length mismatch', () => {
    expect(() => diffResults([], [{ sample: { input: 'x' }, output: 'y', durationMs: 0 }])).toThrow('same length');
  });
});
