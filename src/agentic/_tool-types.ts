/**
 * Tool infrastructure types inlined to avoid cross-domain dependency on src/tools/core
 */
import type { EntityId } from '../core/index.js';
import type { AnySchema, InferOutput, SchemaInput } from '../validation/index.js';
import { safeValidate } from '../validation/index.js';

export type ToolParameters = SchemaInput;

export interface ToolPermissions {
    readonly allowNetwork: boolean;
    readonly allowFileSystem: boolean;
    readonly allowedPaths?: string[];
    readonly allowedHosts?: string[];
    readonly maxExecutionTimeMs: number;
}

export interface ToolError {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
}

export interface ToolExecutionMetadata {
    readonly startTime: Date;
    readonly endTime: Date;
    readonly retries: number;
    readonly tokensUsed?: number;
}

export interface ToolResult<T = unknown> {
    readonly success: boolean;
    readonly data?: T;
    readonly error?: ToolError;
    readonly executionTimeMs: number;
    readonly metadata: ToolExecutionMetadata;
}

export interface ToolContext {
    readonly toolId: EntityId;
    readonly agentId: EntityId;
    readonly sessionId: string;
    readonly timeoutMs?: number;
    readonly permissions: ToolPermissions;
    /** Per-run abort signal — tools may observe it for cooperative cancellation. */
    readonly signal?: AbortSignal;
    /** Data provided when resuming a `suspend()`-suspended tool. */
    readonly resumeData?: unknown;
    /** Agent-side helpers available inside `execute()` (approval / suspension). */
    readonly agent?: {
        readonly resumeData?: unknown;
        /** Self-suspend the tool mid-execution to request more input. */
        suspend(payload: unknown): never;
    };
}

export enum ToolCategory {
    WEB = 'web',
    DATABASE = 'database',
    FILE_SYSTEM = 'file_system',
    API = 'api',
    UTILITY = 'utility',
    AI = 'ai',
    CUSTOM = 'custom',
}

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
    /** Pause this tool's call before `execute()` for human approval. */
    readonly requireApproval?: boolean;
    /** Schema for the custom payload emitted when the tool self-suspends. */
    readonly suspendSchema?: SchemaInput;
    /** Schema for the data accepted when resuming a suspended call. */
    readonly resumeSchema?: SchemaInput;

    execute(params: InferOutput<TParams & AnySchema>, context: ToolContext): Promise<ToolResult<TOutput>>;
    validate(params: unknown): params is InferOutput<TParams & AnySchema>;
}

export interface ToolRegistry {
    register(tool: Tool): void;
    unregister(toolId: EntityId): boolean;
    get(toolId: EntityId): Tool | undefined;
    getByName(name: string): Tool | undefined;
    list(): Tool[];
    listByCategory(category: ToolCategory): Tool[];
    search(query: string): Tool[];
    has(toolId: EntityId): boolean;
    clear(): void;
}

export interface ToolMiddleware {
    beforeExecute?: (tool: Tool, params: unknown, context: ToolContext) => Promise<void> | void;
    afterExecute?: (tool: Tool, result: ToolResult, context: ToolContext) => Promise<void> | void;
    onError?: (tool: Tool, error: Error, context: ToolContext) => Promise<void> | void;
}

/** Pass an array or registry when configuring agents. */
export type ToolProvider = Tool[] | ToolRegistry;

class ToolRegistryImpl implements ToolRegistry {
    private readonly tools: Map<string, Tool> = new Map();
    private readonly nameIndex: Map<string, string> = new Map();

    register(tool: Tool): void {
        this.tools.set(tool.id as string, tool);
        this.nameIndex.set(tool.name, tool.id as string);
    }

    unregister(toolId: EntityId): boolean {
        const tool = this.tools.get(toolId as string);
        if (!tool) return false;
        this.nameIndex.delete(tool.name);
        return this.tools.delete(toolId as string);
    }

    get(toolId: EntityId): Tool | undefined {
        return this.tools.get(toolId as string);
    }

    getByName(name: string): Tool | undefined {
        const id = this.nameIndex.get(name);
        return id ? this.tools.get(id) : undefined;
    }

    list(): Tool[] {
        return Array.from(this.tools.values());
    }

    listByCategory(category: ToolCategory): Tool[] {
        return this.list().filter((t) => t.category === category);
    }

    search(query: string): Tool[] {
        const q = query.toLowerCase();
        return this.list().filter(
            (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
        );
    }

    has(toolId: EntityId): boolean {
        return this.tools.has(toolId as string);
    }

    clear(): void {
        this.tools.clear();
        this.nameIndex.clear();
    }
}

/** Default permissions used when a simple tool object omits the permissions field. */
const DEFAULT_PERMISSIONS: ToolPermissions = {
    allowNetwork: false,
    allowFileSystem: false,
    maxExecutionTimeMs: 30_000,
};

/**
 * Adapt a simple tool-like object (name/description/parameters/execute) into a
 * full {@link Tool} by filling in the required but rarely-needed fields with
 * sensible defaults.  This allows the zero-boilerplate style used in tests and
 * quick-start examples without sacrificing the typed registry contract.
 */
function adaptTool(raw: Partial<Tool> & { name: string; description: string; parameters: ToolParameters; execute: Tool['execute'] }): Tool {
    return {
        id:          (raw.id          ?? raw.name) as typeof raw.id & string,
        name:        raw.name,
        description: raw.description,
        parameters:  raw.parameters,
        permissions: raw.permissions ?? DEFAULT_PERMISSIONS,
        category:    raw.category    ?? ToolCategory.CUSTOM,
        version:     raw.version     ?? '1.0.0',
        execute:     raw.execute,
        validate:    raw.validate     ?? ((p: unknown): p is InferOutput<(typeof raw.parameters) & AnySchema> => safeValidate(raw.parameters, p).success),
        ...(raw.author && { author: raw.author }),
        ...(raw.tags   && { tags:   raw.tags }),
    };
}

/** Normalize tools to a ToolRegistry (extensible: plug any tools). */
export function toToolRegistry(tools: ToolProvider): ToolRegistry {
    if (Array.isArray(tools)) {
        const reg = new ToolRegistryImpl();
        for (const t of tools) reg.register(adaptTool(t as Parameters<typeof adaptTool>[0]));
        return reg;
    }
    return tools;
}
