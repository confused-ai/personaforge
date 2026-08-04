/**
 * `promptAsTool()` — expose a {@link PromptRegistry} (or any template
 * renderer) to an agent as a callable tool, so the agent can select and render
 * a versioned prompt template through the standard tool-calling interface.
 *
 * Useful for prompt-as-a-tool: the agent picks a registered template, supplies
 * variables, and receives the fully rendered prompt — enabling runtime prompt
 * selection without re-deploying code.
 *
 * @example
 * ```ts
 * import { agent, promptAsTool, PromptRegistry } from 'personaforge';
 * import { z } from 'zod';
 *
 * const prompts = new PromptRegistry();
 * prompts.register('triage', [
 *   'You are a triage agent.',
 *   'Task: {{task}}',
 *   'Severity: {{severity}}',
 * ].join('\n'));
 *
 * const promptTool = promptAsTool({
 *   name: 'render_prompt',
 *   description: 'Render a registered prompt template with variables.',
 *   registry: prompts,
 * });
 *
 * const triager = agent({
 *   instructions: 'Use the prompt tool to render prompts before answering.',
 *   tools: [promptTool],
 * });
 * ```
 */

import { z } from 'zod';
import { ToolCategory } from './types.js';
import type { ToolObjectSchemaLike, SimpleToolContext, LightweightTool } from './tool-helper.js';
import { tool } from './tool-helper.js';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Minimal structural contract for a prompt registry. Any object exposing
 * `render(name, vars?, selector?)` can be wrapped.
 */
export interface PromptRegistryLike {
    render(
        name: string,
        vars?: Record<string, unknown>,
        selector?: { version?: string; label?: string },
    ): string | Promise<string>;
}

const DEFAULT_PROMPT_PARAMETERS = z.object({
    name: z.string().optional().describe('Registered prompt template name (defaults to defaultName)'),
    variables: z.record(z.string(), z.unknown()).optional().describe('Variables to substitute ({{var}})'),
    version: z.string().optional().describe('Explicit prompt version id'),
    label: z.string().optional().describe('Select latest version carrying this label'),
}) as ToolObjectSchemaLike<Record<string, unknown>>;

/**
 * Configuration for `promptAsTool()`.
 */
export interface PromptAsToolOptions {
    /** Tool name (used as function ID by the LLM). */
    readonly name: string;
    /** Human-readable description for the LLM. */
    readonly description: string;
    /** The prompt registry / renderer to wrap. */
    readonly registry: PromptRegistryLike;
    /** Required when the registry needs an explicit prompt name per call. */
    readonly defaultName?: string;
    /** Zod schema for tool parameters. Defaults to `{ name, variables, version, label }`. */
    readonly parameters?: ToolObjectSchemaLike<Record<string, unknown>>;
    /** Category for organization. */
    readonly category?: ToolCategory;
    /** Tags for discoverability. */
    readonly tags?: string[];
    /** Maximum execution time in ms. Default: 10_000. */
    readonly timeoutMs?: number;
    /** Require human approval before execution. */
    readonly needsApproval?: boolean | ((params: Record<string, unknown>) => boolean | Promise<boolean>);
    /** Called before the prompt tool runs. Return false to cancel. */
    readonly beforeExecute?: (params: Record<string, unknown>, ctx: SimpleToolContext) => Promise<false | undefined> | false | undefined;
    /** Called after the prompt tool completes. */
    readonly afterExecute?: (output: unknown, params: Record<string, unknown>, ctx: SimpleToolContext) => Promise<void> | void;
    /** Handle errors during prompt rendering. */
    readonly onError?: (error: Error, params: Record<string, unknown>, ctx: SimpleToolContext) => unknown | Promise<unknown>;
}

/**
 * Wrap a prompt registry as a tool so agents can render versioned templates
 * via function calling.
 */
export function promptAsTool(
    config: PromptAsToolOptions,
): LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, string> {
    const {
        name,
        description,
        registry,
        defaultName,
        parameters = DEFAULT_PROMPT_PARAMETERS,
        category = ToolCategory.UTILITY,
        tags = ['prompt-tool'],
        timeoutMs = 10_000,
        needsApproval = false,
        beforeExecute,
        afterExecute,
        onError,
    } = config;

    const execute = async (params: Record<string, unknown>): Promise<string> => {
        const promptName = (typeof params.name === 'string' && params.name.trim()
            ? params.name
            : defaultName) ?? '';

        if (!promptName) {
            throw new Error(
                `Prompt tool "${name}": no prompt name provided. Pass "name" or configure "defaultName".`,
            );
        }

        const variables =
            params.variables !== undefined && typeof params.variables === 'object' && params.variables !== null
                ? (params.variables as Record<string, unknown>)
                : {};

        const selector: { version?: string; label?: string } = {};
        if (typeof params.version === 'string') selector.version = params.version;
        if (typeof params.label === 'string') selector.label = params.label;

        return registry.render(promptName, variables, selector);
    };

    return tool({
        name,
        description,
        parameters,
        execute,
        needsApproval,
        category,
        tags,
        timeoutMs,
        ...(beforeExecute !== undefined ? { beforeExecute } : {}),
        ...(afterExecute !== undefined ? { afterExecute } : {}),
        ...(onError !== undefined ? { onError } : {}),
    } as import('./tool-helper.js').ToolHelperConfig<ToolObjectSchemaLike<Record<string, unknown>>, string>);
}
