import { describe, it, expect } from 'vitest';
import type { StreamDelta, GenerateResult } from '../src/core/index.js';

describe('reasoning type plumbing', () => {
    it('ReasoningStreamChunk is a valid StreamDelta', () => {
        const delta: StreamDelta = { type: 'reasoning', text: 'thinking...', title: 'Step 1' };
        expect(delta.type).toBe('reasoning');
    });

    it('GenerateResult accepts a reasoning array', () => {
        const result: GenerateResult = { text: 'answer', reasoning: [{ text: 'thinking...' }] };
        expect(result.reasoning?.[0]?.text).toBe('thinking...');
    });
});
