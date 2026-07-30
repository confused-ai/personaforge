/**
 * @personaforge/hooks — Unified lifecycle hooks for tools, agents, and workflows.
 *
 * ```ts
 * import { mergeHooks, createLifecycleHooks, toAgenticHooks } from 'personaforge/hooks';
 * ```
 */

export {
    createLifecycleHooks,
    mergeHooks,
    createHookChain,
    toAgenticHooks,
    fromAgenticHooks,
} from './unified-hooks.js';

export type {
    UnifiedLifecycleHooks,
    HookContext,
    ToolHookContext,
    WorkflowHookContext,
    RunHookContext,
    HookChain,
} from './unified-hooks.js';
