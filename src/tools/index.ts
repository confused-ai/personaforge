/**
 * @personaforge/tools — safe default tool surface.
 *
 * This entry point intentionally exports only core infrastructure and zero-dep
 * built-ins. Provider-backed tools live behind explicit category subpaths:
 *
 *   import { TavilySearchTool } from 'personaforge/tools/search'
 *   import { PlaywrightPageTitleTool } from 'personaforge/tools/scraping'
 *   import { StripeCreateCustomerTool } from 'personaforge/tools/finance'
 */

// ── Core: tool infrastructure ─────────────────────────────────────────────
export * from './core/types.js';
export * from './core/base-tool.js';
export * from './core/registry.js';
export { ToolNameTrie, NGramIndex } from './core/trie.js';
export * from './core/tool-helper.js';
export * from './core/tool-wrappers.js';
export * from './core/tool-cache.js';
export * from './core/tool-compressor.js';
export * from './core/tool-gateway-http.js';
export { zodToJsonSchema } from './core/zod-to-schema.js';

// ── Legacy top-level tool exports (backward compat) ───────────────────────
export { defineTool } from './types.js';
export type { Tool as LegacyTool, ToolInput } from './types.js';
export { httpClient } from './http-client.js';
export { fileSystem } from './file-system.js';
export { createShellTool } from './shell.js';
export { browserTool } from './browser.js';

// ── MCP protocol ─────────────────────────────────────────────────────────
export * from './mcp/client.js';
export * from './mcp/server.js';
export * from './mcp/transport-sse.js';
export * from './mcp/stdio-server.js';
export * from './mcp/resources.js';
export type { MCPClient, MCPToolDescriptor, MCPServerAdapter } from './mcp/_mcp-types.js';

// ── Utility tools ────────────────────────────────────────────────────────
export * from './utils/http.js';
export * from './utils/file.js';
export * from './utils/shell.js';
export * from './utils/browser.js';
export * from './utils/calculator.js';

// ── Tool composition helpers ──────────────────────────────────────────────
export { composeTool, parallelTools, fallbackTool, retryTool, timeoutTool, mapTool, filterTool } from './compose.js';
export type { ComposeToolOptions, ParallelToolsOptions, FallbackToolOptions, RetryToolOptions } from './compose.js';
