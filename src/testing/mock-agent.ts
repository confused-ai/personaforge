/**
 * MockAgent — fake agent with deterministic responses for pipeline/orchestration testing.
 *
 * Use in place of a real `createAgent()` result when testing multi-agent pipelines,
 * compose() chains, or orchestration routing — without needing an LLM provider.
 *
 * @example
 * ```ts
 * import { createMockAgent } from 'personaforge/testing';
 *
 * const researcher = createMockAgent({
 *   name: 'Researcher',
 *   responses: ['Found 3 papers on topic X.', 'Summary: ...'],
 * });
 *
 * // Use in a compose() pipeline
 * const pipeline = compose({ agents: [researcher, writer] });
 * const result = await pipeline.run('Research topic X');
 *
 * // Inspect call history
 * expect(researcher.callHistory).toHaveLength(1);
 * expect(researcher.callHistory[0].prompt).toBe('Research topic X');
 * ```
 */

import type { AgenticRunResult } from '../agentic/index.js';
import type { CreateAgentResult } from '../create-agent/types.js';

/** Options for creating a mock agent. */
export interface MockAgentOptions {
    /** Agent name. Default: 'mock-agent' */
    name?: string;
    /** System instructions. Default: 'Mock agent for testing.' */
    instructions?: string;
    /**
     * Ordered responses the agent will return.
     * Cycles through the array; if exhausted, repeats the last response.
     */
    responses: string[];
    /** Simulated delay per run (ms). Default: 0 */
    delayMs?: number;
    /** If true, the agent will throw on the next run. Default: false */
    shouldError?: boolean;
    /** Error message when shouldError is true. Default: 'MockAgent error' */
    errorMessage?: string;
}

/** Record of a single mock agent invocation. */
export interface MockAgentCall {
    prompt: string;
    options?: Record<string, unknown>;
    timestamp: Date;
}

/** Extended result with call history for assertions. */
export interface MockAgentHandle extends CreateAgentResult {
    /** All prompts this mock agent has been called with. */
    readonly callHistory: ReadonlyArray<MockAgentCall>;
    /** Reset call history and response index. */
    reset(): void;
}

/**
 * Create a mock agent that returns deterministic responses without an LLM.
 *
 * The returned object satisfies `CreateAgentResult`, so it can be used
 * anywhere a real agent is expected (compose, pipe, orchestration, etc.).
 */
export function createMockAgent(options: MockAgentOptions): MockAgentHandle {
    const {
        name = 'mock-agent',
        instructions = 'Mock agent for testing.',
        responses,
        delayMs = 0,
        shouldError = false,
        errorMessage = 'MockAgent error',
    } = options;

    let callIndex = 0;
    const callHistory: MockAgentCall[] = [];

    const agent: MockAgentHandle = {
        name,
        instructions,

        async run(prompt: string, opts?: Record<string, unknown>): Promise<AgenticRunResult> {
            callHistory.push({ prompt, options: opts, timestamp: new Date() });

            if (shouldError) {
                throw new Error(errorMessage);
            }

            if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }

            const text = responses[Math.min(callIndex, responses.length - 1)] ?? '';
            callIndex++;

            return {
                text,
                markdown: {
                    name: 'response',
                    content: text,
                    mimeType: 'text/markdown' as const,
                    type: 'markdown' as const,
                },
                messages: [
                    { role: 'user' as const, content: prompt },
                    { role: 'assistant' as const, content: text },
                ],
                steps: 1,
                finishReason: 'stop' as const,
                usage: {
                    promptTokens: prompt.length,
                    completionTokens: text.length,
                    totalTokens: prompt.length + text.length,
                },
            };
        },

        async createSession(_userId?: string): Promise<string> {
            return `mock-session-${Date.now()}`;
        },

        async *stream(prompt: string, opts?: Record<string, unknown>): AsyncIterable<string> {
            const result = await agent.run(prompt, opts);
            yield result.text;
        },

        async *streamEvents(prompt: string, opts?: Record<string, unknown>) {
            const result = await agent.run(prompt, opts);
            yield { type: 'text-delta' as const, delta: result.text };
            yield { type: 'run-finish' as const, run: result };
        },

        getSessionMessages(_sessionId: string) {
            return Promise.resolve([]);
        },

        getCompressionStats() {
            return undefined; // mock agent runs no compression pipeline
        },

        resume(sessionId: string) {
            return {
                run: (prompt: string, opts?: Record<string, unknown>) => agent.run(prompt, { ...opts, sessionId }),
                stream: async function* (prompt: string, opts?: Record<string, unknown>) {
                    yield* agent.stream(prompt, { ...opts, sessionId });
                },
                streamEvents: async function* (prompt: string, opts?: Record<string, unknown>) {
                    yield* agent.streamEvents(prompt, { ...opts, sessionId });
                },
            };
        },

        get callHistory() {
            return callHistory as ReadonlyArray<MockAgentCall>;
        },

        reset() {
            callHistory.length = 0;
            callIndex = 0;
        },
    };

    return agent;
}
