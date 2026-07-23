/**
 * hooksToPlugin — Bridge between per-agent AgenticLifecycleHooks and the global Plugin system.
 *
 * The framework has two interception models:
 * 1. `AgenticLifecycleHooks` (per-agent, fine-grained: beforeRun(prompt) → string)
 * 2. `Plugin` (global, structured: beforeRun(AgentInput, PluginContext) → AgentInput)
 *
 * This adapter converts lifecycle hooks into an anonymous Plugin so that
 * all interception flows through a single ordered pipeline:
 *
 *   Global Plugins (beforeRun, in registration order)
 *     → Agent Plugin (from hooks, via this adapter)
 *       → Execute agentic loop
 *     → Agent Plugin (afterRun)
 *   → Global Plugins (afterRun, in reverse order)
 *
 * @example
 * ```ts
 * import { hooksToPlugin } from 'personaforge/plugins';
 *
 * const hooks: AgenticLifecycleHooks = {
 *   beforeRun: async (prompt) => { console.log('Starting:', prompt); return prompt; },
 *   afterRun: async (result) => { console.log('Done:', result.text); return result; },
 * };
 *
 * // Convert to a Plugin and register globally
 * const plugin = hooksToPlugin(hooks, 'my-agent');
 * pluginRegistry.register(plugin);
 * ```
 *
 * @module
 */

import type { AgenticLifecycleHooks } from '../agentic/index.js';

/**
 * Documented execution order for hooks and plugins.
 *
 * When both global plugins AND per-agent hooks are registered, the execution
 * order is:
 *
 * **beforeRun phase:**
 * 1. Global plugins' `beforeRun()` — in registration order
 * 2. Agent-level hooks' `beforeRun()` — via `mergeLifecycleHooks()` in factory.ts
 *
 * **Execution phase:**
 * 3. Agentic loop runs (steps, tool calls, etc.)
 *    - Agent hooks' `beforeStep()`, `beforeToolCall()`, `afterToolCall()`, `afterStep()`
 *
 * **afterRun phase:**
 * 4. Agent-level hooks' `afterRun()`
 * 5. Global plugins' `afterRun()` — in reverse registration order
 *
 * **Error handling:**
 * - Agent hooks' `onError()` fires first (closer to the error source)
 * - Global plugins' `onError()` fires second (for cross-cutting observability)
 */
export const INTERCEPTION_ORDER = {
    GLOBAL_PLUGINS_BEFORE: 1,
    AGENT_HOOKS_BEFORE: 2,
    AGENTIC_LOOP: 3,
    AGENT_HOOKS_AFTER: 4,
    GLOBAL_PLUGINS_AFTER: 5,
} as const;

/**
 * A minimal Plugin-compatible interface for the hooks adapter.
 * This is a subset of the full Plugin interface from contracts/index.ts,
 * scoped to avoid circular imports.
 */
export interface HooksPluginAdapter {
    /** Unique identifier for this plugin */
    readonly id: string;
    /** Human-readable plugin name */
    readonly name: string;
    /** The original hooks, preserved for introspection */
    readonly hooks: AgenticLifecycleHooks;
}

/**
 * Convert per-agent `AgenticLifecycleHooks` into a named plugin descriptor.
 *
 * This is primarily for documentation and introspection — the actual hooks
 * are executed by `mergeLifecycleHooks()` in `create-agent/factory.ts`.
 * This adapter makes the hooks visible in the plugin registry so developers
 * can inspect the full interception pipeline.
 *
 * @param hooks - The agent's lifecycle hooks
 * @param agentName - The agent's name (used for the plugin ID)
 * @returns A plugin-like descriptor with the hooks attached
 */
export function hooksToPlugin(hooks: AgenticLifecycleHooks, agentName: string): HooksPluginAdapter {
    return {
        id: `agent-hooks:${agentName}`,
        name: `${agentName} Lifecycle Hooks`,
        hooks,
    };
}
