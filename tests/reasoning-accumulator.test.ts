import { describe, it, expect, afterEach } from 'vitest';
import { ReasoningAccumulator, isReasoningStreamEnabled } from '../src/streaming/reasoning-accumulator.js';

describe('ReasoningAccumulator', () => {
    it('accumulates pushed blocks and clears on flush', () => {
        const acc = new ReasoningAccumulator();
        acc.push({ text: 'first ' });
        acc.push({ text: 'second', title: 'Step 2' });
        expect(acc.flush()).toEqual([{ text: 'first ' }, { text: 'second', title: 'Step 2' }]);
        expect(acc.flush()).toEqual([]);
    });
});

describe('isReasoningStreamEnabled', () => {
    const ORIGINAL = process.env.ENABLE_REASONING_STREAM;
    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.ENABLE_REASONING_STREAM;
        else process.env.ENABLE_REASONING_STREAM = ORIGINAL;
    });

    it('defaults to enabled when unset', () => {
        delete process.env.ENABLE_REASONING_STREAM;
        expect(isReasoningStreamEnabled()).toBe(true);
    });

    it('is disabled only when explicitly set to "false"', () => {
        process.env.ENABLE_REASONING_STREAM = 'false';
        expect(isReasoningStreamEnabled()).toBe(false);
    });
});
