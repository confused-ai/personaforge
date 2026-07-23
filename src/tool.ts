/**
 * personaforge/tool — Define, compose, and manage tools.
 *
 * ```ts
 * import { tool, createTools, defineTool, extendTool } from 'personaforge/tool'
 * ```
 */

// ── Core tool helper ────────────────────────────────────────────────────────
export {
    tool,
    createTool,
    createTools,
    defineTool,
    extendTool,
    wrapTool,
    pipeTools,
    isLightweightTool,
    ToolBuilder,
    type ToolHelperConfig,
    type LightweightTool,
    type SimpleToolContext,
    type ToolWrapMiddleware,
    type ExtendToolOptions,
} from './tools/index.js';

// ── Tool types ──────────────────────────────────────────────────────────────
export {
    ToolCategory,
} from './tools/index.js';

export type {
    Tool,
    ToolContext,
    ToolResult,
    ToolError,
    ToolPermissions,
    ToolRegistry,
    ToolMiddleware,
    ToolParameters,
} from './tools/index.js';

// ── Built-in tools ──────────────────────────────────────────────────────────
export * from './tools/index.js';

// ── MCP (Model Context Protocol) ────────────────────────────────────────────
