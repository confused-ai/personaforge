/**
 * Mock LLM provider for testing
 *
 * Allows testing agents without consuming API calls
 */

import type { LLMProvider } from '../providers/types.js';
import type { Message, GenerateResult, GenerateOptions } from '../providers/types.js';

export interface MockLLMOptions {
    /** Response to return for any prompt */
    response?: string;
    /** Map of prompts to responses */
    responses?: Map<string, string>;
    /** Simulate errors */
    shouldError?: boolean;
    /** Simulate tool calls */
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    /** Delay before responding (ms) */
    delay?: number;
}

/**
 * Mock LLM provider for testing
 *
 * @example
 * ```ts
 * const mockLLM = new MockLLMProvider({
 *   response: 'Hello, this is a test response',
 * });
 *
 * const agent = createAgent({
 *   name: 'Test Agent',
 *   instructions: 'Test',
 *   llmProvider: mockLLM,
 * });
 * ```
 */
export class MockLLMProvider implements LLMProvider {
    private options: MockLLMOptions;
    private callCount = 0;

    constructor(options: MockLLMOptions = {}) {
        this.options = {
            response: 'Mock response',
            ...options,
        };
    }

    async generateText(messages: Message[], _options?: GenerateOptions): Promise<GenerateResult> {
        this.callCount++;

        if (this.options.shouldError) {
            throw new Error('Mock LLM error');
        }

        if (this.options.delay) {
            await new Promise((resolve) => setTimeout(resolve, this.options.delay));
        }

        // Check if there's a specific response for this prompt
        let text = this.options.response || 'Mock response';
        if (this.options.responses && messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            if (typeof lastMessage.content === 'string') {
                const response = this.options.responses.get(lastMessage.content);
                if (response) {
                    text = response;
                }
            }
        }

        return {
            text,
            toolCalls: this.options.toolCalls,
            finishReason: 'stop',
        };
    }

    async streamText(
        messages: Message[],
        options?: GenerateOptions
    ): Promise<GenerateResult> {
        if (this.options.shouldError) {
            throw new Error('Mock LLM error');
        }

        const result = await this.generateText(messages, options);

        // Simulate streaming via onChunk callback (canonical LLMProvider contract:
        // string chunks; tool-call streaming is delivered via result.toolCalls).
        if (options?.onChunk) {
            const chunkSize = 5;
            for (let i = 0; i < result.text.length; i += chunkSize) {
                options.onChunk(result.text.slice(i, i + chunkSize));
                if (this.options.delay) {
                    await new Promise((resolve) => setTimeout(resolve, 10));
                }
            }
        }

        return result;
    }

    /**
     * Get the number of times this provider was called
     */
    getCallCount(): number {
        return this.callCount;
    }

    /**
     * Reset call counter
     */
    reset(): void {
        this.callCount = 0;
    }
}
