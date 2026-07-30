/**
 * Base tool implementation
 */

import {
    Tool,
    ToolParameters,
    ToolContext,
    ToolResult,
    ToolError,
    ToolExecutionMetadata,
    ToolPermissions,
    ToolCategory,
} from './types.js';
import type { EntityId } from '../../core/index.js';
import { DebugLogger, createDebugLogger } from '../../shared/index.js';
import { newId } from '../../contracts/index.js';
import { safeValidate } from '../../validation/index.js';
import type { InferOutput, AnySchema } from '../../validation/index.js';

/**
 * Configuration for creating a base tool
 */
export interface BaseToolConfig<TParams extends ToolParameters> {
    id?: EntityId;
    name: string;
    description: string;
    parameters: TParams;
    permissions?: Partial<ToolPermissions>;
    category?: ToolCategory;
    version?: string;
    author?: string;
    tags?: string[];
    /** Enable debug logging for this tool */
    debug?: boolean;
}

/**
 * Abstract base class for tools.
 *
 * @deprecated Prefer the `tool()` helper from `@personaforge/tools` for new
 * tool definitions. `BaseTool` requires a class and `EntityId` boilerplate;
 * `tool()` is a plain function with the same schema validation and auto-execution.
 *
 * Migration:
 * ```ts
 * // Before:
 * class MyTool extends BaseTool<typeof MySchema> {
 *   async execute(params) { return fetch(params.url); }
 * }
 *
 * // After:
 * import { tool } from '../index.js';
 * const myTool = tool({ name: 'my_tool', description: '...', parameters: MySchema, execute: async (p) => fetch(p.url) });
 * ```
 */
export abstract class BaseTool<TParams extends ToolParameters = ToolParameters, TOutput = unknown>
    implements Tool<TParams, TOutput> {
    readonly id: EntityId;
    readonly name: string;
    readonly description: string;
    readonly parameters: TParams;
    readonly permissions: ToolPermissions;
    readonly category: ToolCategory;
    readonly version: string;
    readonly author?: string;
    readonly tags?: string[];
    protected logger: DebugLogger;

    constructor(config: BaseToolConfig<TParams>) {
        this.id = config.id ?? newId('tool');
        this.name = config.name;
        this.description = config.description;
        this.parameters = config.parameters;
        this.permissions = {
            allowNetwork: config.permissions?.allowNetwork ?? false,
            allowFileSystem: config.permissions?.allowFileSystem ?? false,
            ...(config.permissions?.allowedPaths !== undefined && { allowedPaths: config.permissions.allowedPaths }),
            ...(config.permissions?.allowedHosts !== undefined && { allowedHosts: config.permissions.allowedHosts }),
            maxExecutionTimeMs: config.permissions?.maxExecutionTimeMs ?? 30000,
        };
        this.category = config.category ?? ToolCategory.UTILITY;
        this.version = config.version ?? '1.0.0';
        if (config.author !== undefined) this.author = config.author;
        if (config.tags !== undefined) this.tags = config.tags;
        this.logger = createDebugLogger(`Tool:${this.name}`, config.debug ?? false);
    }

    /**
     * Execute the tool with the given parameters
     */
    async execute(params: InferOutput<TParams & AnySchema>, context: ToolContext): Promise<ToolResult<TOutput>> {
        const startTime = new Date();
        const retries = 0;

        this.logger.logStart(`Tool execution: ${this.name}`, {
            toolId: this.id,
            category: this.category,
        });

        try {
            // Validate parameters
            this.logger.debug('Validating parameters');
            const validation = safeValidate(this.parameters, params);
            if (!validation.success) {
                this.logger.error('Parameter validation failed', undefined, {
                    error: validation.error.message,
                });
                return this.createErrorResult(
                    startTime,
                    retries,
                    'VALIDATION_ERROR',
                    `Invalid parameters: ${validation.error.message}`
                );
            }

            // Check permissions
            this.logger.debug('Checking permissions');
            const permissionError = this.checkPermissions(context);
            if (permissionError) {
                this.logger.error('Permission denied', undefined, { error: permissionError });
                return this.createErrorResult(
                    startTime,
                    retries,
                    'PERMISSION_DENIED',
                    permissionError
                );
            }

            // Execute with timeout
            this.logger.debug('Executing tool logic');
            const timeoutMs = context.timeoutMs ?? this.permissions.maxExecutionTimeMs;
            const data = await this.executeWithTimeout(validation.data, context, timeoutMs);

            const endTime = new Date();
            const metadata: ToolExecutionMetadata = {
                startTime,
                endTime,
                retries,
            };

            this.logger.logComplete(`Tool execution: ${this.name}`, endTime.getTime() - startTime.getTime());
            return {
                success: true,
                data,
                executionTimeMs: endTime.getTime() - startTime.getTime(),
                metadata,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Tool execution failed: ${this.name}`, undefined, { error: errorMessage });
            return this.createErrorResult(startTime, retries, 'EXECUTION_ERROR', errorMessage);
        }
    }

    /**
     * Validate parameters without executing
     */
    validate(params: unknown): params is InferOutput<TParams & AnySchema> {
        return safeValidate(this.parameters, params).success;
    }

    /**
     * Execute the tool's core logic - must be implemented by subclasses
     */
    protected abstract performExecute(
        params: InferOutput<TParams & AnySchema>,
        context: ToolContext
    ): Promise<TOutput>;

    /**
     * Execute with timeout support
     */
    private async executeWithTimeout(
        params: InferOutput<TParams & AnySchema>,
        context: ToolContext,
        timeoutMs: number
    ): Promise<TOutput> {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this.performExecute(params, context)
                .then(result => {
                    clearTimeout(timeoutId);
                    resolve(result);
                })
                .catch((error: unknown) => {
                    clearTimeout(timeoutId);
                    reject(error instanceof Error ? error : new Error(String(error)));
                });
        });
    }

    /**
     * Check if the tool has required permissions
     */
    private checkPermissions(context: ToolContext): string | null {
        // Check network permission
        if (this.permissions.allowNetwork && !context.permissions.allowNetwork) {
            return 'Network access not permitted in context';
        }

        // Check filesystem permission
        if (this.permissions.allowFileSystem && !context.permissions.allowFileSystem) {
            return 'Filesystem access not permitted in context';
        }

        return null;
    }

    /**
     * Create an error result
     */
    private createErrorResult(
        startTime: Date,
        retries: number,
        code: string,
        message: string
    ): ToolResult<TOutput> {
        const endTime = new Date();
        const error: ToolError = {
            code,
            message,
        };

        const metadata: ToolExecutionMetadata = {
            startTime,
            endTime,
            retries,
        };

        return {
            success: false,
            error,
            executionTimeMs: endTime.getTime() - startTime.getTime(),
            metadata,
        };
    }
}