import { describe, it, expect } from 'vitest';
import {
  RunnableLambda,
  RunnableSequence,
  RunnableParallel,
  RunnablePassthrough,
} from '../src/runnable/index.js';

const upper = new RunnableLambda<string, string>((s) => s.toUpperCase());
const exclaim = new RunnableLambda<string, string>((s) => s + '!');

describe('Runnable.invoke / pipe', () => {
  it('pipes two runnables', async () => {
    const chain = upper.pipe(exclaim);
    expect(await chain.invoke('hi')).toBe('HI!');
  });
  it('flattens nested sequences', async () => {
    const chain = upper.pipe(exclaim).pipe(new RunnableLambda<string, number>((s) => s.length));
    expect(chain instanceof RunnableSequence).toBe(true);
    expect((chain as RunnableSequence).steps.length).toBe(3);
    expect(await chain.invoke('hi')).toBe(3);
  });
});

describe('Runnable.batch', () => {
  it('runs inputs in parallel', async () => {
    const results = await upper.batch(['a', 'b', 'c'], { concurrency: 2 });
    expect(results).toEqual(['A', 'B', 'C']);
  });
});

describe('Runnable.map / bind', () => {
  it('map transforms output', async () => {
    const chain = upper.map((s) => s.length);
    expect(await chain.invoke('hey')).toBe(3);
  });
  it('bind merges kwargs into object input', async () => {
    const r = new RunnableLambda<{ a: number; b: number }, number>((x) => x.a + x.b);
    const bound = r.bind({ a: 10 });
    expect(await bound.invoke({ b: 5 } as { a: number; b: number })).toBe(15);
  });
});

describe('Runnable.withRetry', () => {
  it('retries until success', async () => {
    let calls = 0;
    const flaky = new RunnableLambda<number, number>((n) => {
      calls++;
      if (calls < 3) throw new Error('fail');
      return n * 2;
    });
    const result = await flaky.withRetry({ maxRetries: 5, delayMs: 1 }).invoke(21);
    expect(result).toBe(42);
    expect(calls).toBe(3);
  });
  it('throws after exhausting retries', async () => {
    const always = new RunnableLambda<number, number>(() => { throw new Error('nope'); });
    await expect(always.withRetry({ maxRetries: 2, delayMs: 1 }).invoke(1)).rejects.toThrow('nope');
  });
});

describe('Runnable.withFallbacks', () => {
  it('falls back on primary failure', async () => {
    const primary = new RunnableLambda<string, string>(() => { throw new Error('down'); });
    const backup = new RunnableLambda<string, string>((s) => 'backup:' + s);
    const result = await primary.withFallbacks([backup]).invoke('x');
    expect(result).toBe('backup:x');
  });
  it('throws when all exhausted', async () => {
    const a = new RunnableLambda<string, string>(() => { throw new Error('a'); });
    const b = new RunnableLambda<string, string>(() => { throw new Error('b'); });
    await expect(a.withFallbacks([b]).invoke('x')).rejects.toThrow('exhausted');
  });
});

describe('Runnable.assign', () => {
  it('fans out and merges results', async () => {
    const base = new RunnablePassthrough<{ q: string }>();
    const chain = base.assign({
      len: new RunnableLambda<{ q: string }, number>((x) => x.q.length),
      up: new RunnableLambda<{ q: string }, string>((x) => x.q.toUpperCase()),
    });
    const result = await chain.invoke({ q: 'hi' });
    expect(result).toEqual({ q: 'hi', len: 2, up: 'HI' });
  });
});

describe('RunnableParallel', () => {
  it('runs branches in parallel', async () => {
    const par = new RunnableParallel({
      a: new RunnableLambda<number, number>((n) => n + 1),
      b: new RunnableLambda<number, number>((n) => n * 2),
    });
    expect(await par.invoke(10)).toEqual({ a: 11, b: 20 });
  });
});

describe('Runnable.stream', () => {
  it('default stream yields single result', async () => {
    const chunks: string[] = [];
    for await (const c of upper.stream('hi')) chunks.push(c);
    expect(chunks).toEqual(['HI']);
  });
  it('sequence stream runs prefix then streams last', async () => {
    const streamer = new (class extends RunnableLambda<string, string> {
      async *stream(input: string) { yield input + '1'; yield input + '2'; }
    })((s: string) => s);
    const chain = upper.pipe(streamer);
    const out: string[] = [];
    for await (const c of chain.stream('hi')) out.push(c);
    expect(out).toEqual(['HI1', 'HI2']);
  });
});
