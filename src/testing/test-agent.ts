/**
 * createTestAgent — zero-config agent harness for unit tests.
 *
 * Auto-wires MockLLMProvider + MockSessionStore so you can test agent behavior
 * without real API calls or a database.
 *
 * @example
 * ```ts
 * import { createTestAgent, MockLLMProvider } from 'personaforge/testing';
 *
 * const { agent, llm, sessionStore } = createTestAgent({
 *   response: 'Paris',
 * });
 *
 * const result = await agent.run('What is the capital of France?');
 * expect(result.text).toBe('Paris');
 * expect(llm.callCount).toBe(1);
 * expect(sessionStore.getCreatedSessionIds()).toHaveLength(1);
 * ```
 *
 * @example With tool registry
 * ```ts
 * const registry = new MockToolRegistry({ lookup: async (args) => 'data' });
 * const { agent } = createTestAgent({ response: 'done', tools: registry.toTools() });
 * await agent.run('Look up data');
 * expect(registry.calls('lookup')).toHaveLength(1);
 * ```
 */

import type { CreateAgentOptions, CreateAgentResult } from '../create-agent/types.js';
import type { Tool } from '../tools/index.js';
import type { LLMProvider } from '../providers/types.js';
import type { SessionStore } from '../session/index.js';
import type { MemoryStore } from '../memory/index.js';
import type { AgenticLifecycleHooks } from '../agentic/index.js';
import { MockLLMProvider, type MockLLMOptions } from './mock-llm.js';
import { MockSessionStore } from './mock-session-store.js';
import { MockMemoryStore } from './mock-memory-store.js';
import { MockToolRegistry } from './mock-tool-registry.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

export interface HookRecord {
    readonly name: keyof AgenticLifecycleHooks;
    readonly args: unknown[];
    readonly timestamp: Date;
}

export interface TestAgentOptions extends MockLLMOptions {
    /** Agent name. Default: 'test-agent' */
    name?: string;
    /** Agent instructions. Default: 'You are a test assistant.' */
    instructions?: string;
    /** Tools to give the agent. Default: [] (no tools) */
    tools?: Tool[];
    /** Custom LLM Provider override instead of MockLLMProvider */
    llm?: LLMProvider;
    /** Custom Session Store override instead of MockSessionStore */
    sessionStore?: SessionStore;
    /** Custom Memory Store override instead of MockMemoryStore */
    memoryStore?: MemoryStore;
    /** Inline mock tools handlers to register automatically */
    mockTools?: Record<string, ToolHandler>;
    /** Extra createAgent options */
    agentOptions?: Partial<CreateAgentOptions>;
}

export interface TestAgentHandle {
    /** The created agent (call .run() to invoke). */
    agent: CreateAgentResult;
    /** The MockLLM so you can inspect callCount, change responses etc. */
    llm: LLMProvider;
    /** The MockSessionStore so you can inspect created/deleted session IDs. */
    sessionStore: SessionStore;
    /** The MockMemoryStore so you can inspect memory entries. */
    memoryStore: MemoryStore;
    /** The MockToolRegistry if mockTools were provided. */
    toolRegistry?: MockToolRegistry;
    /** Log of all lifecycle hooks triggered during the agent run. */
    hooksHistory: ReadonlyArray<HookRecord>;
    /** Reset call histories on LLM, session/memory store, tool registry, and hooks log. */
    reset(): void;
}

/**
 * Create a pre-wired test agent: MockLLM + MockSessionStore + MockMemoryStore.
 * Returns the agent and mock handles for assertions.
 */
export async function createTestAgent(opts: TestAgentOptions = {}): Promise<TestAgentHandle> {
    // Lazy import so the testing module doesn't pull in createAgent at module load time
    const { createAgent } = await import('../create-agent/factory.js');

    const llm = opts.llm ?? new MockLLMProvider({
        response: opts.response,
        responses: opts.responses,
        shouldError: opts.shouldError,
        toolCalls: opts.toolCalls,
        delay: opts.delay,
    });

    const sessionStore = opts.sessionStore ?? new MockSessionStore() as any;
    const memoryStore = opts.memoryStore ?? new MockMemoryStore();

    let toolRegistry: MockToolRegistry | undefined;
    const allTools = [...(opts.tools ?? [])];
    if (opts.mockTools) {
        toolRegistry = new MockToolRegistry(opts.mockTools);
        allTools.push(...toolRegistry.toTools());
    }

    const hooksHistory: HookRecord[] = [];

    const hookWrapper: AgenticLifecycleHooks = {
        beforeRun: async (prompt, config) => {
            hooksHistory.push({ name: 'beforeRun', args: [prompt, config], timestamp: new Date() });
            if (opts.agentOptions?.hooks?.beforeRun) {
                return opts.agentOptions.hooks.beforeRun(prompt, config);
            }
            return prompt;
        },
        afterRun: async (result) => {
            hooksHistory.push({ name: 'afterRun', args: [result], timestamp: new Date() });
            if (opts.agentOptions?.hooks?.afterRun) {
                return opts.agentOptions.hooks.afterRun(result);
            }
            return result;
        },
        beforeStep: async (step, messages) => {
            hooksHistory.push({ name: 'beforeStep', args: [step, messages], timestamp: new Date() });
            if (opts.agentOptions?.hooks?.beforeStep) {
                return opts.agentOptions.hooks.beforeStep(step, messages);
            }
            return messages;
        },
        afterStep: async (step, messages, text) => {
            hooksHistory.push({ name: 'afterStep', args: [step, messages, text], timestamp: new Date() });
            if (opts.agentOptions?.hooks?.afterStep) {
                await opts.agentOptions.hooks.afterStep(step, messages, text);
            }
        },
        beforeToolCall: async (name, args, step) => {
            hooksHistory.push({ name: 'beforeToolCall', args: [name, args, step], timestamp: new Date() });
            if (opts.agentOptions?.hooks?.beforeToolCall) {
                return opts.agentOptions.hooks.beforeToolCall(name, args, step);
            }
            return args;
        },
        afterToolCall: async (name, result, args, step) => {
            hooksHistory.push({ name: 'afterToolCall', args: [name, result, args, step], timestamp: new Date() });
            if (opts.agentOptions?.hooks?.afterToolCall) {
                return opts.agentOptions.hooks.afterToolCall(name, result, args, step);
            }
            return result;
        },
        buildSystemPrompt: async (instructions, ragContext) => {
            hooksHistory.push({ name: 'buildSystemPrompt', args: [instructions, ragContext], timestamp: new Date() });
            if (opts.agentOptions?.hooks?.buildSystemPrompt) {
                return opts.agentOptions.hooks.buildSystemPrompt(instructions, ragContext);
            }
            return `${instructions}\n\n${ragContext ?? ''}`;
        },
        onError: async (error, step) => {
            hooksHistory.push({ name: 'onError', args: [error, step], timestamp: new Date() });
            if (opts.agentOptions?.hooks?.onError) {
                await opts.agentOptions.hooks.onError(error, step);
            }
        },
    };

    const agent = createAgent({
        name: opts.name ?? 'test-agent',
        instructions: opts.instructions ?? 'You are a test assistant.',
        llm,
        sessionStore,
        memoryStore,
        tools: allTools,
        guardrails: false,
        ...opts.agentOptions,
        hooks: hookWrapper,
    });

    const handle: TestAgentHandle = {
        agent,
        llm,
        sessionStore,
        memoryStore,
        ...(toolRegistry && { toolRegistry }),
        get hooksHistory() {
            return hooksHistory;
        },
        reset() {
            if (llm instanceof MockLLMProvider) {
                llm.reset();
            }
            if (sessionStore instanceof MockSessionStore) {
                sessionStore.reset();
            }
            if (memoryStore instanceof MockMemoryStore) {
                memoryStore.reset();
            }
            if (toolRegistry) {
                toolRegistry.reset();
            }
            hooksHistory.length = 0;
        },
    };

    return handle;
}

