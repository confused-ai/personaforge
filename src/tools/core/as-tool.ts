/**
 * `asTool()` — the framework's "everything is a tool" dispatcher.
 *
 * Wrap any composable — an agent, a workflow, a pipeline, a memory store, a
 * knowledge base, or a prompt registry — as a standard callable tool in one
 * call. The target's shape is introspected automatically, or you can pin the
 * interpretation with `kind`.
 *
 * ```ts
 * import { asTool, toTool } from 'personaforge';
 *
 * const researchTool = asTool(researchAgent, {
 *   name: 'research',
 *   description: 'Run the research agent.',
 * });
 *
 * const pipelineTool = asTool(contentPipeline, {
 *   kind: 'pipeline',
 *   name: 'content_pipeline',
 *   description: 'Run the research → write → publish pipeline.',
 * });
 *
 * const recallTool = asTool(memoryStore, {
 *   name: 'user_memory',
 *   description: 'Store and recall user memory.',
 * });
 * ```
 *
 * `toTool` is an identical alias for ergonomics.
 *
 * @remarks
 * - Auto-detection order: prompt registry → memory → knowledge → workflow →
 *   runnable agent. `run`-shaped targets default to agent; pass
 *   `kind: 'pipeline'` for compose()/pipe() pipelines.
 * - All {@link AsToolConfig} fields are optional beyond `name`/`description`
 *   and are forwarded to the underlying domain adapter (`agentAsTool`,
 *   `workflowAsTool`, `pipelineAsTool`, `memoryAsTool`, `knowledgeAsTool`,
 *   `promptAsTool`).
 */

import { agentAsTool } from './agent-as-tool.js';
import { workflowAsTool } from './workflow-as-tool.js';
import { pipelineAsTool } from './pipeline-as-tool.js';
import { memoryAsTool, type MemoryStoreLike } from './memory-as-tool.js';
import { knowledgeAsTool, type KnowledgeBaseLike } from './knowledge-as-tool.js';
import { promptAsTool, type PromptRegistryLike } from './prompt-as-tool.js';
import { ToolCategory } from './types.js';
import type { ToolObjectSchemaLike, ToolSchemaLike, LightweightTool, SimpleToolContext } from './tool-helper.js';
import type { RunnableAgent } from './agent-as-tool.js';
import type { RunnableWorkflow } from './workflow-as-tool.js';
import type { RunnablePipeline } from './pipeline-as-tool.js';

// ── Types ──────────────────────────────────────────────────────────────────

/** The kinds of composable targets `asTool()` can wrap. */
export type AsToolKind =
    | 'agent'
    | 'workflow'
    | 'pipeline'
    | 'memory'
    | 'knowledge'
    | 'prompt';

/** Any value `asTool()` accepts. */
export type ToolTarget =
    | RunnableAgent
    | RunnableWorkflow
    | RunnablePipeline
    | MemoryStoreLike
    | KnowledgeBaseLike
    | PromptRegistryLike;

/**
 * Configuration for `asTool()` / `toTool()`.
 *
 * `name` and `description` are always required. Every other field is optional
 * and is forwarded to whichever domain adapter the target resolves to.
 */
export interface AsToolConfig {
    /** Tool name (used as function ID by the LLM). */
    readonly name: string;
    /** Human-readable description for the LLM. */
    readonly description: string;
    /** Pin the target interpretation. Default: auto-detect. */
    readonly kind?: AsToolKind | 'auto';
    /** Zod schema for tool parameters (overrides the domain default). */
    readonly parameters?: ToolObjectSchemaLike<Record<string, unknown>>;
    /** Zod schema for tool output validation. */
    readonly outputSchema?: ToolSchemaLike<unknown>;
    /** Category for organization. */
    readonly category?: ToolCategory;
    /** Tags for discoverability. */
    readonly tags?: string[];
    /** Maximum execution time in ms. */
    readonly timeoutMs?: number;
    /** Require human approval before execution. */
    readonly needsApproval?: boolean | ((params: Record<string, unknown>) => boolean | Promise<boolean>);
    /** Called before the target runs. Return false to cancel. */
    readonly beforeExecute?: (params: Record<string, unknown>, ctx: SimpleToolContext) => Promise<false | undefined> | false | undefined;
    /** Called after the target completes. */
    readonly afterExecute?: (output: unknown, params: Record<string, unknown>, ctx: SimpleToolContext) => Promise<void> | void;
    /** Handle errors during execution. */
    readonly onError?: (error: Error, params: Record<string, unknown>, ctx: SimpleToolContext) => unknown | Promise<unknown>;
    /** Transform the output before returning to the caller. */
    readonly transformOutput?: (output: unknown, params: Record<string, unknown>, ctx: SimpleToolContext) => unknown | Promise<unknown>;
    /** Map validated params to a prompt string (agent/pipeline targets). */
    readonly mapInput?: (params: Record<string, unknown>) => string | Promise<string>;
    /** Max nesting depth for agent-as-tool recursion. Default: 5. */
    readonly maxDepth?: number;
    /** Whether memory/knowledge tools may write. Default: true. */
    readonly writeable?: boolean;
    /** Default prompt name for prompt-registry targets. */
    readonly defaultName?: string;
}

// ── Auto-detection ─────────────────────────────────────────────────────────

function detectKind(target: ToolTarget): AsToolKind {
    const t = target as Record<string, unknown>;
    const has = (key: string): boolean => typeof t[key] === 'function';

    if (has('render') && (has('get') || has('names')) && !has('run')) return 'prompt';
    if (has('store') && has('retrieve') && !has('buildContext')) return 'memory';
    if (has('buildContext') || (has('retrieve') && has('addDocuments'))) return 'knowledge';
    if (has('execute') && !has('run')) return 'workflow';
    if (has('run')) return 'agent';
    throw new Error(
        'asTool(): cannot detect target kind. Pass an explicit `kind` ' +
            "('agent' | 'workflow' | 'pipeline' | 'memory' | 'knowledge' | 'prompt').",
    );
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Wrap any composable target as a callable tool.
 *
 * @param target The object to wrap (agent, workflow, pipeline, memory,
 *               knowledge base, or prompt registry).
 * @param config Common tool configuration.
 * @returns A {@link LightweightTool} ready to be passed to `agent({ tools })`.
 */
export function asTool(
    target: ToolTarget,
    config: AsToolConfig,
): LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, unknown> {
    const kind = (config.kind && config.kind !== 'auto' ? config.kind : detectKind(target)) as AsToolKind;

    const base = {
        name: config.name,
        description: config.description,
        ...(config.parameters !== undefined ? { parameters: config.parameters } : {}),
        ...(config.category !== undefined ? { category: config.category } : {}),
        ...(config.tags !== undefined ? { tags: config.tags } : {}),
        ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
        ...(config.needsApproval !== undefined ? { needsApproval: config.needsApproval } : {}),
        ...(config.beforeExecute !== undefined ? { beforeExecute: config.beforeExecute } : {}),
        ...(config.afterExecute !== undefined ? { afterExecute: config.afterExecute } : {}),
        ...(config.onError !== undefined ? { onError: config.onError } : {}),
    };

    switch (kind) {
        case 'agent':
            return agentAsTool({
                ...base,
                agent: target as RunnableAgent,
                ...(config.transformOutput !== undefined ? { transformOutput: config.transformOutput } : {}),
                ...(config.maxDepth !== undefined ? { maxDepth: config.maxDepth } : {}),
                ...(config.outputSchema !== undefined ? { outputSchema: config.outputSchema } : {}),
            });
        case 'workflow':
            return workflowAsTool({
                ...base,
                workflow: target as RunnableWorkflow,
                ...(config.transformOutput !== undefined ? { transformOutput: config.transformOutput } : {}),
                ...(config.outputSchema !== undefined ? { outputSchema: config.outputSchema } : {}),
            });
        case 'pipeline':
            return pipelineAsTool({
                ...base,
                pipeline: target as RunnablePipeline,
                ...(config.transformOutput !== undefined ? { transformOutput: config.transformOutput } : {}),
                ...(config.mapInput !== undefined ? { mapInput: config.mapInput } : {}),
                ...(config.outputSchema !== undefined ? { outputSchema: config.outputSchema } : {}),
            });
        case 'memory':
            return memoryAsTool({
                ...base,
                memory: target as MemoryStoreLike,
                ...(config.writeable !== undefined ? { writeable: config.writeable } : {}),
            });
        case 'knowledge':
            return knowledgeAsTool({
                ...base,
                knowledge: target as KnowledgeBaseLike,
                ...(config.writeable !== undefined ? { writeable: config.writeable } : {}),
            });
        case 'prompt':
            return promptAsTool({
                ...base,
                registry: target as PromptRegistryLike,
                ...(config.defaultName !== undefined ? { defaultName: config.defaultName } : {}),
            }) as LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, unknown>;
    }
}

/**
 * Alias of {@link asTool} — identical behaviour, alternate spelling.
 */
export const toTool = asTool;
