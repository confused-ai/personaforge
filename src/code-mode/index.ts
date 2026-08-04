/**
 * @personaforge/code-mode — run multi-tool computations in an isolated sandbox.
 *
 * Code mode lets an agent answer a multi-tool query with ONE tool call: the
 * model writes a function that orchestrates your existing tools as
 * `external_*` functions and reduces/aggregates their results into a single
 * structured answer — fewer round-trips, correct arithmetic, smaller context.
 *
 * ```ts
 * const { tool, instructions } = createCodeMode({
 *   tools: { getTopProducts, getProductRatings },
 *   sandbox: new LocalSandbox(), // default
 * });
 * const agent = agent({
 *   instructions: ['You are a helpful shopping assistant.', instructions],
 *   tools: { execute_typescript: tool },
 * });
 * ```
 */

import { z } from 'zod';
import { tool, type LightweightTool } from '../tools/core/tool-helper.js';
import type { Tool } from '../tools/core/types.js';
import { LocalSandbox, VMSandbox, type Sandbox } from './sandbox.js';
import { safeValidate } from '../validation/index.js';

export type { Sandbox, SandboxRunResult, ExternalCall } from './sandbox.js';
export { LocalSandbox, VMSandbox, createSandbox } from './sandbox.js';

export interface CodeModeOptions {
    /** Tool id/name. Default: 'execute_typescript'. */
    id?: string;
    description?: string;
    /** Scoped tools the generated code may call as `external_*`. */
    tools?: Record<string, Tool | LightweightTool> | Array<Tool | LightweightTool>;
    /** Execution boundary. Default: LocalSandbox (isolated node process). */
    sandbox?: Sandbox;
    timeoutMs?: number;
    /** Max code length the model may submit. Default 16_000 chars. */
    maxCodeChars?: number;
    /** Max returned output length (truncated). Default 100_000 chars. */
    maxOutputChars?: number;
}

export interface CodeModeResult {
    readonly tool: LightweightTool<any, any>;
    readonly instructions: string;
}

const CODE_SCHEMA = z.object({
    code: z.string().describe(
        'JavaScript/TypeScript source that defines a single async function body which ' +
        'calls the provided `external_*` functions, aggregates their results, and returns one answer.',
    ),
});

/** Normalize scoped tools into `name → executable` map. */
function normalizeTools(tools: CodeModeOptions['tools']): Record<string, Tool | LightweightTool> {
    if (!tools) return {};
    if (Array.isArray(tools)) {
        const out: Record<string, Tool | LightweightTool> = {};
        for (const t of tools) out[t.name] = t;
        return out;
    }
    return tools;
}

/** Build the code-mode tool + instructions (Mastra `createCodeMode()` parity). */
export function createCodeMode(opts: CodeModeOptions = {}): CodeModeResult {
    const id = opts.id ?? 'execute_typescript';
    const scoped = normalizeTools(opts.tools);
    const sandbox = opts.sandbox ?? new LocalSandbox();
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const maxCodeChars = opts.maxCodeChars ?? 16_000;
    const maxOutputChars = opts.maxOutputChars ?? 100_000;

    const externalNames = Object.keys(scoped);
    const externalList = externalNames.map((n) => `external_${n}`).join(', ') || 'none';

    const instructions =
        `Code mode is enabled. For multi-step or computational queries, call the \`${id}\` tool with a ` +
        `\`code\` field containing JavaScript/TypeScript source.\n\n` +
        `Rules:\n` +
        `- The code may call these external functions (host tools): ${externalList}.\n` +
        `- Each ${externalNames.length ? `external_*` : ''} function takes a single object argument and returns a Promise of its result.\n` +
        `- Use Promise.all to parallelize independent calls.\n` +
        `- Perform sums/averages/aggregations in real JavaScript — the computed numbers are exact.\n` +
        `- Return a single value (object/array/string/number) as the final answer — the code must end by returning that value.\n` +
        `- Do NOT use import/require, fetch, fs, net, child_process, or any module — only the provided external functions and plain JS.\n` +
        (externalNames.length === 0 ? `- With no external tools, only pure computation is allowed.\n` : ``) +
        `\nA useful pattern: build an async function body that collects data then reduces it:\n` +
        `\`\`\`js\nconst tops = await external_a({ limit: 5 });\nconst scores = await Promise.all(tops.map(t => external_b({ id: t.id })));\nreturn tops.map((t, i) => ({ ...t, avg: average(scores[i]) }));\n\`\`\``;

    const codeTool = tool({
        name: id,
        description: opts.description ?? 'Execute a JavaScript/TypeScript routine that orchestrates available external tools and returns a computed answer.',
        parameters: CODE_SCHEMA,
        timeoutMs,
        execute: async ({ code }, toolCtx) => {
            if (typeof code !== 'string' || !code.trim()) {
                throw new Error('Code mode requires a non-empty `code` string.');
            }
            if (code.length > maxCodeChars) {
                throw new Error(`Code exceeds the ${maxCodeChars}-char limit (${code.length} chars).`);
            }

            const externals: Record<string, (args: unknown) => Promise<unknown>> = {};
            for (const [name, scopedTool] of Object.entries(scoped)) {
                externals[name] = async (args: unknown) => {
                    const t = scopedTool as Tool;
                    // Validate input against the tool's parameter schema.
                    if (t.validate && args !== undefined) {
                        if (!t.validate(args)) {
                            throw new Error(`Invalid arguments for ${name}: ${JSON.stringify(args)}`);
                        }
                    } else if (args !== undefined && scopedTool.parameters) {
                        const r = safeValidate(scopedTool.parameters as import('../validation/index.js').SchemaInput, args);
                        if (!r.success) {
                            throw new Error(`Invalid arguments for ${name}: ${r.error.message}`);
                        }
                    }
                    const ctx = {
                        toolId: t.id ?? name,
                        // Thread the caller's context through so nested tool calls
                        // keep the originating agent/session identity (tracing,
                        // approval, and audit all rely on it).
                        agentId: toolCtx?.agentId ?? 'code-mode',
                        sessionId: toolCtx?.sessionId ?? 'code-mode',
                        abortSignal: toolCtx?.abortSignal,
                        timeoutMs: Math.min(timeoutMs, 60_000),
                        permissions: t.permissions ?? {
                            allowNetwork: false,
                            allowFileSystem: false,
                            maxExecutionTimeMs: timeoutMs,
                        },
                    };
                    const result = await t.execute(args as never, ctx as never);
                    if (result && typeof result === 'object' && 'success' in result && (result as { success?: boolean }).success === true) {
                        const data = (result as { data?: unknown }).data;
                        const json = JSON.stringify(data);
                        return json.length > maxOutputChars ? json.slice(0, maxOutputChars) + '[truncated]' : data;
                    }
                    if (result && typeof result === 'object' && 'success' in result && (result as { success?: boolean }).success === false) {
                        const err = (result as { error?: { message?: string } }).error;
                        throw new Error(err?.message ?? `Tool ${name} failed`);
                    }
                    return result;
                };
            }

            const out = await sandbox.run(code, externals, { timeoutMs, maxOutputBytes: maxOutputChars });
            if (!out.ok) {
                throw new Error(`Code execution failed: ${out.error.message}${out.stdout ? `\nstdout:\n${out.stdout}` : ''}`);
            }
            return {
                result: out.result,
                stdout: out.stdout.slice(0, maxOutputChars),
                executionMs: out.executionMs,
            };
        },
    });

    return { tool: codeTool as unknown as LightweightTool<any, any>, instructions };
}
