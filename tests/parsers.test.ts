import { describe, it, expect } from 'vitest';
import {
  StringOutputParser,
  JsonOutputParser,
  CsvListParser,
  RegexParser,
  OutputFixingParser,
  RetryWithErrorParser,
  ParseError,
} from '../src/parsers/index.js';
import { RunnableLambda } from '../src/runnable/index.js';

describe('StringOutputParser', () => {
  it('trims text', async () => {
    expect(await new StringOutputParser().invoke('  hi  ')).toBe('hi');
  });
});

describe('JsonOutputParser', () => {
  it('parses raw JSON', async () => {
    const p = new JsonOutputParser<{ a: number }>();
    expect(await p.invoke('{"a": 1}')).toEqual({ a: 1 });
  });
  it('parses fenced JSON', async () => {
    const p = new JsonOutputParser();
    expect(await p.invoke('Here:\n```json\n{"b": 2}\n```')).toEqual({ b: 2 });
  });
  it('throws when no JSON', async () => {
    await expect(new JsonOutputParser().invoke('no json here')).rejects.toThrow(ParseError);
  });
  it('validates against schema', async () => {
    const schema = {
      parse(data: unknown) {
        const d = data as { n: number };
        if (typeof d.n !== 'number') throw new Error('n must be number');
        return d;
      },
    };
    const p = new JsonOutputParser({ schema });
    expect(await p.invoke('{"n": 5}')).toEqual({ n: 5 });
    await expect(p.invoke('{"n": "x"}')).rejects.toThrow('n must be number');
  });
});

describe('CsvListParser', () => {
  it('splits comma list', async () => {
    expect(await new CsvListParser().invoke('a, b ,c')).toEqual(['a', 'b', 'c']);
  });
});

describe('RegexParser', () => {
  it('extracts named groups', async () => {
    const p = new RegexParser(/(?<name>\w+):(?<age>\d+)/);
    expect(await p.invoke('bob:42')).toEqual({ name: 'bob', age: '42' });
  });
  it('throws on no match', async () => {
    await expect(new RegexParser(/\d+/).invoke('abc')).rejects.toThrow(ParseError);
  });
});

describe('OutputFixingParser', () => {
  it('fixes malformed output via fixer LLM', async () => {
    const inner = new JsonOutputParser<{ ok: boolean }>();
    const p = new OutputFixingParser({
      parser: inner,
      fixer: async () => '{"ok": true}',
      maxRetries: 1,
    });
    expect(await p.invoke('not json')).toEqual({ ok: true });
  });
  it('throws if fixer also fails', async () => {
    const p = new OutputFixingParser({
      parser: new JsonOutputParser(),
      fixer: async () => 'still not json',
      maxRetries: 1,
    });
    await expect(p.invoke('bad')).rejects.toThrow();
  });
});

describe('RetryWithErrorParser', () => {
  it('re-runs chain with error feedback', async () => {
    let attempt = 0;
    const retryChain = new RunnableLambda<string, string>(() => {
      attempt++;
      return '{"fixed": true}';
    });
    const p = new RetryWithErrorParser({
      parser: new JsonOutputParser<{ fixed: boolean }>(),
      retryChain,
      maxRetries: 2,
    });
    expect(await p.invoke('garbage')).toEqual({ fixed: true });
    expect(attempt).toBe(1);
  });
});

describe('composition with pipe', () => {
  it('llm.pipe(parser) works', async () => {
    const llm = new RunnableLambda<string, string>((q) => `{"answer": "${q}"}`);
    const chain = llm.pipe(new JsonOutputParser<{ answer: string }>());
    expect(await chain.invoke('42')).toEqual({ answer: '42' });
  });
});
