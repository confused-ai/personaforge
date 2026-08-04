/**
 * Test helper: build a minimal `CreateAgentResult`-shaped agent (no LLM) for
 * compose()/pipeline()/workflow() tests.
 */

import { vi } from 'vitest';

export interface ComposeAgentStub {
    readonly name: string;
    readonly instructions: string;
    readonly run: (prompt: string, options?: { sessionId?: string }) => Promise<{ text: string; steps: number }>;
    readonly createSession: () => Promise<string>;
}

/**
 * A duck-typed CreateAgentResult whose `run()` returns `{ text, steps }` where
 * `text` is prefixed by the stage label.
 */
export function createComposeAgent(name: string, text: string): ComposeAgentStub {
    return {
        name,
        instructions: `You are the ${name} stage.`,
        createSession: vi.fn().mockResolvedValue(`sess-${name}`),
        run: vi.fn().mockImplementation(
            async (prompt: string): Promise<{ text: string; steps: number }> => ({
                text: `${text}${prompt ? `:${String(prompt).slice(0, 32)}` : ''}`,
                steps: 1,
            }),
        ),
    };
}
