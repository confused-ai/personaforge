/**
 * bare() — Absolute zero-defaults agent.
 *
 * Everything is your responsibility:
 * - No HttpClientTool / BrowserTool injected
 * - No InMemorySessionStore created
 * - No guardrails of any kind
 * - Instructions default to '' (empty)
 * - Name defaults to 'Agent'
 *
 * Use when you want to build an agent entirely from scratch.
 *
 * Internally delegates to `createAgent()` with all defaults explicitly disabled,
 * ensuring consistent behavior across the framework's agent creation pipeline.
 *
 * @example
 * ```ts
 * import { bare } from 'personaforge';
 *
 * const myAgent = bare({
 *   llm: new OpenAIProvider({ model: 'gpt-4o', apiKey: '...' }),
 * });
 * const result = await myAgent.run('Hello');
 * // → pure LLM call, no tools, no session, no guardrails
 *
 * // Bring your own everything:
 * const agent = bare({
 *   instructions: 'You are a code reviewer.',
 *   llm: new AnthropicProvider({ model: 'claude-opus-4-5' }),
 *   tools: [myCustomTool],
 *   hooks: { afterRun: (r) => { audit.log(r); return r; } },
 * });
 * ```
 */

import type { LLMProvider } from '../providers/types.js';
import type { Tool, ToolRegistry } from '../tools/core/index.js';
import type { AgenticLifecycleHooks } from '../agentic/index.js';
import type { CreateAgentResult } from '../create-agent/types.js';
import { createAgent } from '../create-agent/factory.js';

export interface BareAgentOptions {
    /** Agent name. Default: 'Agent' */
    name?: string;
    /** System instructions. Default: '' (no system prompt) */
    instructions?: string;
    /**
     * LLM provider. Required — bare() never auto-resolves from env.
     * Use createAgent() or agent() if you want env-based auto-resolution.
     */
    llm: LLMProvider;
    /**
     * Tools. Default: [] (none).
     * Pass false or omit for pure text reasoning.
     */
    tools?: Tool[] | ToolRegistry | false;
    /** Max agentic loop steps. Default: 10 */
    maxSteps?: number;
    /** Timeout in ms. Default: 60_000 */
    timeoutMs?: number;
    /** Lifecycle hooks */
    hooks?: AgenticLifecycleHooks;
}

/**
 * Create an agent with zero defaults.
 * You control LLM, tools, and every hook. Nothing is injected automatically.
 */
export function bare(options: BareAgentOptions): CreateAgentResult {
    const {
        name = 'Agent',
        instructions = '',
        llm,
        tools: toolsOpt,
        maxSteps = 10,
        timeoutMs = 60_000,
        hooks,
    } = options;

    // Delegate to createAgent with all defaults explicitly disabled.
    // This ensures bare() agents go through the same middleware, error handling,
    // and resolution pipeline as all other agents.
    return createAgent({
        name,
        instructions: instructions || ' ', // createAgent requires non-empty instructions
        llm,
        tools: toolsOpt === false || toolsOpt === undefined ? false : toolsOpt,
        sessionStore: false,
        guardrails: false,
        maxSteps,
        timeoutMs,
        hooks,
    });
}
