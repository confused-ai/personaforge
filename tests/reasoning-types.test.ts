import { describe, it, expect } from 'vitest';
import type { StreamDelta, GenerateResult, Message, AgentRunResult, StreamChunk } from '../src/core/index.js';

describe('reasoning type plumbing', () => {
    it('ReasoningStreamChunk is a valid StreamDelta', () => {
        const delta: StreamDelta = { type: 'reasoning', text: 'thinking...', title: 'Step 1' };
        expect(delta.type).toBe('reasoning');
    });

    it('GenerateResult accepts a reasoning array', () => {
        const result: GenerateResult = { text: 'answer', reasoning: [{ text: 'thinking...' }] };
        expect(result.reasoning?.[0]?.text).toBe('thinking...');
    });

    it('Message accepts a reasoning array', () => {
        const m: Message = { role: 'assistant', content: 'answer', reasoning: [{ text: 'thinking...', title: 'Step 1' }] };
        expect(m.reasoning?.[0]?.title).toBe('Step 1');
    });

    it('StreamChunk has a reasoning-delta variant', () => {
        const chunk: StreamChunk = { type: 'reasoning-delta', reasoningDelta: 'hmm', reasoningTitle: 'Step 1' };
        expect(chunk.type).toBe('reasoning-delta');
    });

    it('AgentRunResult accepts reasoningText', () => {
        const r = { reasoningText: 'full reasoning' } as Partial<AgentRunResult>;
        expect(r.reasoningText).toBe('full reasoning');
    });
});
