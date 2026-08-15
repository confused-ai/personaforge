import { describe, it, expect } from 'vitest';
import { AgentRunner } from '../src/core/runner/agent-runner.js';

describe('AgentRunner cost tracking', () => {
    it('returns costUsd=0 when no usage info from LLM', async () => {
        const llm = {
            generateText: async () => ({
                text: 'hello',
                toolCalls: [],
                finishReason: 'stop' as const,
            }),
        } as any;
        const tools = { list: () => [], get: () => undefined } as any;
        const runner = new AgentRunner({ name: 'test-agent', instructions: 'x', llm, tools });
        const result = await runner.run({ instructions: 'x', prompt: 'hi' });
        expect(result.text).toBe('hello');
        expect(result.costUsd).toBeUndefined();
    });

    it('estimates cost from token usage', async () => {
        const llm = {
            generateText: async () => ({
                text: 'response',
                toolCalls: [],
                finishReason: 'stop' as const,
                usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
            }),
        } as any;
        const tools = { list: () => [], get: () => undefined } as any;
        const runner = new AgentRunner({ name: 'gpt-4o-mini', instructions: 'x', llm, tools });
        const result = await runner.run({ instructions: 'x', prompt: 'hi' });
        expect(result.costUsd).toBeGreaterThan(0);
        expect(result.costUsd).toBeLessThan(0.01);
    });

    it('estimates cost across multiple LLM calls (multi-step)', async () => {
        let calls = 0;
        const llm = {
            generateText: async () => {
                calls++;
                if (calls === 1) {
                    return {
                        text: 'thinking...',
                        toolCalls: [{ id: 't1', name: 'dummy', arguments: { x: 1 } }],
                        finishReason: 'tool_calls' as const,
                        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
                    };
                }
                return {
                    text: 'final answer',
                    toolCalls: [],
                    finishReason: 'stop' as const,
                    usage: { promptTokens: 70, completionTokens: 30, totalTokens: 100 },
                };
            },
        } as any;
        const dummyTool = {
            name: 'dummy',
            description: 'test',
            parameters: { type: 'object', properties: {} },
            execute: async () => 'ok',
        };
        const tools = { list: () => [dummyTool], get: (n: string) => (n === 'dummy' ? dummyTool : undefined) } as any;
        const runner = new AgentRunner({ name: 'gpt-4o-mini', instructions: 'x', llm, tools });
        const result = await runner.run({ instructions: 'x', prompt: 'multi-step' });
        expect(calls).toBe(2);
        expect(result.costUsd).toBeGreaterThan(0);
    });

    it('includes model field when model name is set', async () => {
        const llm = {
            generateText: async () => ({
                text: 'hello',
                toolCalls: [],
                finishReason: 'stop' as const,
                usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            }),
        } as any;
        const tools = { list: () => [], get: () => undefined } as any;
        const runner = new AgentRunner({ name: 'gpt-4o-mini', instructions: 'x', llm, tools });
        const result = await runner.run({ instructions: 'x', prompt: 'hi' });
        expect(result.model).toBe('gpt-4o-mini');
    });
});
