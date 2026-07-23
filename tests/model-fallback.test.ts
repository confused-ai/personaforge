import { describe, it, expect } from 'vitest';
import { withFallbacks, withRetry } from '../src/models/fallback.js';
import type { LLMProvider, Message, GenerateResult } from '../src/contracts/interfaces.js';

const msgs: Message[] = [{ role: 'user', content: 'hi' }];

function stubProvider(behavior: () => Promise<GenerateResult> | GenerateResult): LLMProvider {
  return { async generateText() { return behavior(); } };
}

describe('withFallbacks', () => {
  it('returns primary result when primary succeeds', async () => {
    const p = withFallbacks(stubProvider(() => ({ text: 'A' })), [stubProvider(() => ({ text: 'B' }))]);
    expect((await p.generateText(msgs)).text).toBe('A');
  });

  it('falls back on primary error', async () => {
    const p = withFallbacks(
      stubProvider(() => { throw new Error('down'); }),
      [stubProvider(() => ({ text: 'backup' }))],
    );
    expect((await p.generateText(msgs)).text).toBe('backup');
  });

  it('throws when all fail', async () => {
    const p = withFallbacks(
      stubProvider(() => { throw new Error('a'); }),
      [stubProvider(() => { throw new Error('b'); })],
    );
    await expect(p.generateText(msgs)).rejects.toThrow();
  });

  it('proxies streamText when any provider has it', async () => {
    const primary: LLMProvider = { async generateText() { return { text: 'x' }; } };
    const backup: LLMProvider = {
      async generateText() { return { text: 'x' }; },
      async streamText() { return { text: 'streamed' }; },
    };
    const p = withFallbacks(primary, [backup]);
    expect(p.streamText).toBeDefined();
    expect((await p.streamText!(msgs)).text).toBe('streamed');
  });
});

describe('withRetry', () => {
  it('retries on failure', async () => {
    let calls = 0;
    const p = withRetry(stubProvider(() => {
      calls++;
      if (calls < 3) throw new Error('flaky');
      return { text: 'ok' };
    }), { maxRetries: 5, baseDelayMs: 1 });
    expect((await p.generateText(msgs)).text).toBe('ok');
    expect(calls).toBe(3);
  });

  it('respects retryOn predicate', async () => {
    let calls = 0;
    const p = withRetry(stubProvider(() => {
      calls++;
      throw new Error('fatal');
    }), { maxRetries: 5, baseDelayMs: 1, retryOn: (err) => (err as Error).message !== 'fatal' });
    await expect(p.generateText(msgs)).rejects.toThrow('fatal');
    expect(calls).toBe(1);
  });

  it('gives up after maxRetries', async () => {
    const p = withRetry(stubProvider(() => { throw new Error('nope'); }), { maxRetries: 2, baseDelayMs: 1 });
    await expect(p.generateText(msgs)).rejects.toThrow('nope');
  });
});

describe('composition', () => {
  it('withRetry(withFallbacks(...)) works', async () => {
    let primaryCalls = 0;
    const primary = stubProvider(() => { primaryCalls++; throw new Error('down'); });
    const backup = stubProvider(() => ({ text: 'backup' }));
    const chained = withRetry(withFallbacks(primary, [backup]), { maxRetries: 2, baseDelayMs: 1 });
    expect((await chained.generateText(msgs)).text).toBe('backup');
    expect(primaryCalls).toBe(1); // fallback succeeded on first attempt
  });
});
