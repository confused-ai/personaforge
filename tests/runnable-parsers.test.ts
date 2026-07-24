/**
 * Tests for personaforge/runnable + personaforge/parsers.
 *
 * Covers Runnable's composition primitives (pipe / batch / withRetry /
 * withFallbacks / map / stream) and every output parser (String, Json, Csv,
 * Regex). All pure — no LLM.
 */

import { describe, it, expect } from 'vitest';
import {
    Runnable,
    RunnableLambda,
    RunnableSequence,
    RunnableParallel,
    RunnablePassthrough,
} from '../src/runnable/index.js';
import {
    StringOutputParser,
    JsonOutputParser,
    CsvListParser,
    RegexParser,
    ParseError,
} from '../src/parsers/index.js';

describe('Runnable primitives', () => {
    it('RunnableLambda.invoke wraps a plain function', async () => {
        const r = new RunnableLambda<number, number>((x) => x * 2);
        expect(await r.invoke(5)).toBe(10);
    });

    it('RunnablePassthrough returns input unchanged', async () => {
        const r = new RunnablePassthrough<string>();
        expect(await r.invoke('hi')).toBe('hi');
    });

    it('pipe() composes Runnables left-to-right', async () => {
        const a = new RunnableLambda<number, number>((x) => x + 1);
        const b = new RunnableLambda<number, number>((x) => x * 3);
        const chain = a.pipe(b);
        expect(await chain.invoke(2)).toBe((2 + 1) * 3);
    });

    it('map() transforms the output of a Runnable', async () => {
        const r = new RunnableLambda<number, number>((x) => x + 1).map((x) => `n=${x}`);
        expect(await r.invoke(4)).toBe('n=5');
    });

    it('RunnableSequence chains N steps in order', async () => {
        const seq = new RunnableSequence([
            new RunnableLambda<number, number>((x) => x + 1),
            new RunnableLambda<number, number>((x) => x + 10),
            new RunnableLambda<number, number>((x) => x * 2),
        ]);
        expect(await seq.invoke(0)).toBe(((0 + 1) + 10) * 2);
    });

    it('RunnableParallel fans out and merges results', async () => {
        const par = new RunnableParallel({
            doubled: new RunnableLambda<number, number>((x) => x * 2),
            squared: new RunnableLambda<number, number>((x) => x * x),
        });
        expect(await par.invoke(3)).toEqual({ doubled: 6, squared: 9 });
    });

    it('batch() runs many inputs, respecting concurrency', async () => {
        const r = new RunnableLambda<number, number>((x) => x + 1);
        const out = await r.batch([1, 2, 3, 4], { concurrency: 2 });
        expect(out).toEqual([2, 3, 4, 5]);
    });

    it('withRetry() retries on failure up to maxRetries', async () => {
        let calls = 0;
        const flaky = new RunnableLambda<number, number>(() => {
            calls += 1;
            if (calls < 3) throw new Error('flake');
            return 42;
        }).withRetry({ maxRetries: 3, delayMs: 0 });
        expect(await flaky.invoke(0)).toBe(42);
        expect(calls).toBe(3);
    });

    it('withRetry() surfaces the last error when retries exhausted', async () => {
        const alwaysFails = new RunnableLambda<number, number>(() => {
            throw new Error('nope');
        }).withRetry({ maxRetries: 2, delayMs: 0 });
        await expect(alwaysFails.invoke(0)).rejects.toThrow('nope');
    });

    it('withFallbacks() falls through to the next Runnable on failure', async () => {
        const primary = new RunnableLambda<number, string>(() => { throw new Error('down'); });
        const backup = new RunnableLambda<number, string>((x) => `backup:${x}`);
        const withFb = primary.withFallbacks([backup]);
        expect(await withFb.invoke(7)).toBe('backup:7');
    });

    it('stream() yields the single invoke result by default', async () => {
        const r = new RunnableLambda<number, number>((x) => x * 2);
        const items: unknown[] = [];
        for await (const v of r.stream(5)) items.push(v);
        expect(items).toEqual([10]);
    });
});

describe('Output parsers', () => {
    it('StringOutputParser trims and returns the input', async () => {
        const p = new StringOutputParser();
        expect(await p.invoke('  hello  ')).toBe('hello');
    });

    it('JsonOutputParser extracts JSON from markdown-wrapped output', async () => {
        const p = new JsonOutputParser<{ x: number }>();
        const text = 'Here is the answer:\n```json\n{"x": 42}\n```\n';
        const out = await p.invoke(text);
        expect(out).toEqual({ x: 42 });
    });

    it('JsonOutputParser parses raw JSON without fences', async () => {
        const p = new JsonOutputParser<{ n: number[] }>();
        expect(await p.invoke('{"n":[1,2,3]}')).toEqual({ n: [1, 2, 3] });
    });

    it('JsonOutputParser applies a schema if one is provided', async () => {
        const schema = {
            parse: (data: unknown) => {
                const d = data as { x: number };
                if (typeof d.x !== 'number') throw new Error('x must be number');
                return { x: d.x * 2 };
            },
        };
        const p = new JsonOutputParser<{ x: number }>({ schema });
        const out = await p.invoke('{"x": 21}');
        expect(out).toEqual({ x: 42 });
    });

    it('JsonOutputParser throws ParseError on invalid input', async () => {
        const p = new JsonOutputParser<unknown>();
        await expect(p.invoke('not json at all')).rejects.toBeInstanceOf(ParseError);
    });

    it('CsvListParser splits comma-separated values and trims', async () => {
        const p = new CsvListParser();
        expect(await p.invoke('a, b ,c,,d')).toEqual(['a', 'b', 'c', 'd']);
    });

    it('RegexParser extracts named groups', async () => {
        const p = new RegexParser(/name:\s*(?<name>\w+)/);
        expect(await p.invoke('name: Ada')).toEqual({ name: 'Ada' });
    });

    it('RegexParser throws ParseError when no match', async () => {
        const p = new RegexParser(/(?<x>\d+)/);
        await expect(p.invoke('no digits here')).rejects.toBeInstanceOf(ParseError);
    });

    it('parsers compose inside a pipe()', async () => {
        const upper = new RunnableLambda<string, string>((s) => s.toUpperCase());
        const chain = upper.pipe(new StringOutputParser());
        expect(await chain.invoke('  hello  ')).toBe('HELLO');
    });
});
