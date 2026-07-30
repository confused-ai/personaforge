/**
 * Tool integration types and interfaces
 */

import type { EntityId } from '../../core/index.js';
import { z } from 'zod';

/**
 * Tool parameter schema using Zod
 */
export type ToolParameters = z.ZodObject<Record<string, z.ZodType>>;

/**
 * Tool execution context
 */
export interface ToolContext {
    readonly toolId: EntityId;
    readonly agentId: EntityId;
    readonly sessionId: string;
    readonly timeoutMs?: number;
    readonly permissions: ToolPermissions;
}

/**
 * Tool permissions
 */
export interface ToolPermissions {
    readonly allowNetwork: boolean;
    readonly allowFileSystem: boolean;
    readonly allowedPaths?: string[];
    readonly allowedHosts?: string[];
    readonly maxExecutionTimeMs: number;
}

/**
 * Tool execution result
 */
export interface ToolResult<T = unknown> {
    readonly success: boolean;
    readonly data?: T;
    readonly error?: ToolError;
    readonly executionTimeMs: number;
    readonly metadata: ToolExecutionMetadata;
}

/**
 * Tool error details
 */
export interface ToolError {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
}

/**
 * Tool execution metadata
 */
export interface ToolExecutionMetadata {
    readonly startTime: Date;
    readonly endTime: Date;
    readonly retries: number;
    readonly tokensUsed?: number;
}

/**
 * Tool definition
 */
export interface Tool<TParams extends ToolParameters = ToolParameters, TOutput = unknown> {
    readonly id: EntityId;
    readonly name: string;
    readonly description: string;
    readonly parameters: TParams;
    readonly permissions: ToolPermissions;
    readonly category: ToolCategory;
    readonly version: string;
    readonly author?: string;
    readonly tags?: string[];
    /**
     * Optional Zod schema for validating tool output.
     * When provided, tool results are validated against this schema before
     * being returned to the caller or fed back to the LLM.
     */
    readonly outputSchema?: z.ZodType<TOutput>;

    /**
     * Execute the tool with validated parameters
     */
    execute(params: z.infer<TParams>, context: ToolContext): Promise<ToolResult<TOutput>>;

    /**
     * Validate parameters without executing
     */
    validate(params: unknown): params is z.infer<TParams>;
}

/**
 * Tool categories
 */
export enum ToolCategory {
    WEB = 'web',
    DATABASE = 'database',
    FILE_SYSTEM = 'file_system',
    API = 'api',
    UTILITY = 'utility',
    AI = 'ai',
    CUSTOM = 'custom',
    AGENT = 'agent',
    WORKFLOW = 'workflow',
}

/**
 * Tool registry for managing available tools
 */
export interface ToolRegistry {
    /**
     * Register a tool
     */
    register(tool: Tool): void;

    /**
     * Unregister a tool by ID
     */
    unregister(toolId: EntityId): boolean;

    /**
     * Get a tool by ID
     */
    get(toolId: EntityId): Tool | undefined;

    /**
     * Get a tool by name
     */
    getByName(name: string): Tool | undefined;

    /**
     * List all registered tools
     */
    list(): Tool[];

    /**
     * List tools by category
     */
    listByCategory(category: ToolCategory): Tool[];

    /**
     * Search tools by name or description
     */
    search(query: string): Tool[];

    /**
     * Check if a tool is registered
     */
    has(toolId: EntityId): boolean;

    /**
     * Clear all registered tools
     */
    clear(): void;
}

/**
 * Tool sandbox configuration
 */
export interface ToolSandboxConfig {
    readonly enabled: boolean;
    readonly timeoutMs: number;
    readonly maxMemoryMb: number;
    readonly allowedModules?: string[];
    readonly blockedModules?: string[];
    readonly environmentVariables?: Record<string, string>;
}

/**
 * Tool middleware for intercepting tool calls
 */
export interface ToolMiddleware {
    /**
     * Called before tool execution
     */
    beforeExecute?: (tool: Tool, params: unknown, context: ToolContext) => Promise<void> | void;

    /**
     * Called after tool execution
     */
    afterExecute?: (tool: Tool, result: ToolResult, context: ToolContext) => Promise<void> | void;

    /**
     * Called on tool execution error
     */
    onError?: (tool: Tool, error: Error, context: ToolContext) => Promise<void> | void;
}

/**
 * Tool factory for creating tool instances
 */
export interface ToolFactory {
    /**
     * Create a tool instance
     */
    create(config: Record<string, unknown>): Tool;

    /**
     * Get the tool schema
     */
    getSchema(): ToolSchema;
}

/**
 * Tool schema for documentation and validation
 */
export interface ToolSchema {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, ParameterSchema>;
    readonly returns: ParameterSchema;
    readonly examples?: ToolExample[];
}

/**
 * Parameter schema
 */
export interface ParameterSchema {
    readonly type: string;
    readonly description: string;
    readonly required: boolean;
    readonly default?: unknown;
    readonly enum?: unknown[];
}

/**
 * Tool usage example
 */
export interface ToolExample {
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    readonly expectedOutput?: unknown;
}