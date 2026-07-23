import { describe, it, expect } from 'vitest';
import { wordOverlapF1, rougeLWords } from '@personaforge/eval';

describe('lexical eval metrics', () => {
    it('wordOverlapF1 is 1 for identical', () => {
        expect(wordOverlapF1('hello world', 'hello world')).toBe(1);
    });

    it('wordOverlapF1 handles partial overlap', () => {
        const s = wordOverlapF1('the cat sat', 'the dog sat');
        expect(s).toBeGreaterThan(0);
        expect(s).toBeLessThan(1);
    });

    it('rougeLWords rewards shared word order', () => {
        expect(rougeLWords('a b c d', 'a b c d')).toBe(1);
        expect(rougeLWords('a b', 'x y')).toBe(0);
    });
});
