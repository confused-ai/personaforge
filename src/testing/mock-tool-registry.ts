/**
 * MockToolRegistry — records all tool invocations for assertion in tests.
 *
 * @example
 * ```ts
 * const registry = new MockToolRegistry({
 *   search: async (args) => ({ results: ['TypeScript docs'] }),
 * });
 *
 * const agent = createAgent({
 *   name: 'TestAgent',
 *   instructions: 'Test',
 *   tools: registry.toTools(),
 *   llmProvider: new MockLLMProvider(),
 * });
 *
 * await agent.run('Search for TypeScript');
 *
 * expect(registry.calls('search')).toHaveLength(1);
 * expect(registry.lastCall('search')?.args.query).toBe('TypeScript');
 * ```
 */

import type { Tool, ToolResult, ToolContext } from '../tools/index.js';
import { ToolCategory } from '../tools/index.js';
import { z } from 'zod';
import { safeValidate } from '../validation/index.js';
import type { InferSchemaOutput } from '../validation/index.js';

export interface ToolCallRecord {
    readonly name: string;
    readonly args: Record<string, unknown>;
    readonly result: unknown;
    readonly calledAt: Date;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

/**
 * MockToolRegistry: in-memory registry that records all tool calls for test assertions.
 */
export class MockToolRegistry {
    private handlers: Map<string, ToolHandler>;
    private _calls: ToolCallRecord[] = [];

    constructor(handlers: Record<string, ToolHandler> = {}) {
        this.handlers = new Map(Object.entries(handlers));
    }

    /** Register or override a tool handler. */
    register(name: string, handler: ToolHandler): this {
        this.handlers.set(name, handler);
        return this;
    }

    /** Return all call records across all tools. */
    get allCalls(): ToolCallRecord[] {
        return [...this._calls];
    }

    /** Return call records for a specific tool. */
    calls(toolName: string): ToolCallRecord[] {
        return this._calls.filter((c) => c.name === toolName);
    }

    /** Return the last call record for a specific tool. */
    lastCall(toolName: string): ToolCallRecord | undefined {
        const filtered = this.calls(toolName);
        return filtered[filtered.length - 1];
    }

    /** Clear all recorded calls. */
    reset(): this {
        this._calls = [];
        return this;
    }

    /**
     * Convert to an array of Tool objects compatible with createAgent({ tools }).
     */
    toTools(): Tool[] {
        const records = this._calls;
        return Array.from(this.handlers.entries()).map(([name, handler]) => {
            const params = z.object({}).passthrough();
            return {
                id: `mock-tool-${name}`,
                name,
                description: `Mock tool: ${name}`,
                parameters: params as any,
                permissions: {
                    allowNetwork: false,
                    allowFileSystem: false,
                    maxExecutionTimeMs: 5000,
                },
                category: ToolCategory.CUSTOM,
                version: '1.0.0',
                validate: (raw): raw is InferSchemaOutput<typeof params> => safeValidate(params, raw).success,
                async execute(p: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
                    const start = new Date();
                    let result: unknown;
                    try {
                        result = await handler(p);
                    } catch (err) {
                        const end = new Date();
                        records.push({ name, args: p, result: null, calledAt: start });
                        return {
                            success: false,
                            error: {
                                code: 'TOOL_ERROR',
                                message: err instanceof Error ? err.message : String(err),
                            },
                            executionTimeMs: end.getTime() - start.getTime(),
                            metadata: { startTime: start, endTime: end, retries: 0 },
                        };
                    }
                    const end = new Date();
                    records.push({ name, args: p, result, calledAt: start });
                    return {
                        success: true,
                        data: result,
                        executionTimeMs: end.getTime() - start.getTime(),
                        metadata: { startTime: start, endTime: end, retries: 0 },
                    };
                },
            } satisfies Tool;
        });
    }
}
