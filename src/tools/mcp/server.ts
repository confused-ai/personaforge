/**
 * MCP HTTP Server — expose a framework ToolRegistry as an MCP-compatible JSON-RPC 2.0 endpoint.
 *
 * Implements the Model Context Protocol (MCP) server side, allowing external clients
 * (Claude Desktop, other agents, MCP clients) to discover and invoke tools hosted
 * inside this framework.
 *
 * Supported methods:
 *   - `initialize`                — handshake, return server capabilities
 *   - `tools/list`                — return all registered tool descriptors
 *   - `tools/call`                — execute a named tool with arguments
 *   - `notifications/initialized` — ignored notification (no response)
 *
 * Edge cases covered:
 *   - Missing `jsonrpc: "2.0"` field → -32600 Invalid Request
 *   - Unknown method → -32601 Method not found
 *   - Missing tool name → -32602 Invalid params
 *   - Tool not found → -32602 Invalid params with tool name
 *   - Tool execute throws → -32603 Internal error (message only, no stack leaked)
 *   - Validation failure → -32602 with zod message
 *   - Request body too large → 413
 *   - Non-POST requests → 405
 *   - CORS: configurable allowed origins; `*` for open, specific list for strict
 *   - Auth: optional bearer token check before any method dispatch
 *   - Batch requests: not supported → -32600 with clear message
 *   - Tool execution timeout: configurable per-tool via `toolTimeoutMs`
 *
 * @example
 * ```ts
 * import { createMcpServer } from 'personaforge/tools';
 * import { toToolRegistry, calculatorTool } from 'personaforge/tools';
 *
 * const registry = toToolRegistry([calculatorTool]);
 * const server = createMcpServer(registry, {
 *   name: 'my-tools',
 *   version: '1.0.0',
 *   port: 3100,
 *   auth: { type: 'bearer', token: process.env['MCP_TOKEN']! },
 * });
 * await server.start();
 * // GET http://localhost:3100/mcp → JSON-RPC endpoint
 * // Stop gracefully:
 * // await server.stop();
 * ```
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { ToolRegistry, ToolContext } from '../core/types.js';
import type { MCPServerAdapter, MCPToolDescriptor } from './_mcp-types.js';
import type { Tool } from '../core/types.js';

// ── JSON-RPC 2.0 types ─────────────────────────────────────────────────────

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: string | number | null;
    method: string;
    params?: unknown;
}

interface JsonRpcSuccess {
    jsonrpc: '2.0';
    id: string | number | null;
    result: unknown;
}

interface JsonRpcError {
    jsonrpc: '2.0';
    id: string | number | null;
    error: {
        code: number;
        message: string;
        data?: unknown;
    };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

const ERR_PARSE        = -32700;
const ERR_INVALID_REQ  = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS   = -32602;
const ERR_INTERNAL         = -32603;

function success(id: string | number | null, result: unknown): JsonRpcSuccess {
    return { jsonrpc: '2.0', id, result };
}

function rpcError(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown,
): JsonRpcError {
    const err: JsonRpcError['error'] = { code, message };
    if (data !== undefined) err.data = data;
    return { jsonrpc: '2.0', id, error: err };
}

// ── Auth helpers ───────────────────────────────────────────────────────────

export type McpAuthConfig =
    | { type: 'bearer'; token: string }
    | { type: 'api-key'; key: string; header?: string }
    | { type: 'none' };

function checkAuth(req: IncomingMessage, auth?: McpAuthConfig): boolean {
    if (!auth || auth.type === 'none') return true;
    if (auth.type === 'bearer') {
        const header = req.headers['authorization'] ?? '';
        const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
        if (provided.length === 0) return false;
        // Timing-safe compare via length + XOR pattern
        return timingSafeStringEqual(provided, auth.token);
    }
    if (auth.type === 'api-key') {
        const headerName = (auth.header ?? 'x-api-key').toLowerCase();
        const provided = String(req.headers[headerName] ?? '');
        return timingSafeStringEqual(provided, auth.key);
    }
    return false;
}

function timingSafeStringEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
        // Still iterate to prevent timing oracle on length
        let _ = 0;
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            _ |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
        }
        return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

// ── MCP Server config ──────────────────────────────────────────────────────

export interface McpServerOptions {
    /**
     * Server name returned in `initialize` response.
     * @default 'personaforge-mcp'
     */
    name?: string;
    /**
     * Server version returned in `initialize` response.
     * @default '1.0.0'
     */
    version?: string;
    /**
     * HTTP port to listen on.
     * @default 3100
     */
    port?: number;
    /**
     * Hostname / address to bind to.
     * @default '127.0.0.1'
     */
    host?: string;
    /**
     * URL path to serve the MCP endpoint at.
     * @default '/mcp'
     */
    path?: string;
    /**
     * Maximum request body size in bytes.
     * @default 1_048_576 (1 MB)
     */
    maxBodyBytes?: number;
    /**
     * CORS allowed origins. Use `'*'` for open access or an array for strict allow-list.
     * Set to `false` to disable CORS headers entirely (same-origin only).
     * @default '*'
     */
    cors?: '*' | string[] | false;
    /**
     * Optional authentication guard applied before any method dispatch.
     */
    auth?: McpAuthConfig;
    /**
     * Default timeout in ms for tool execution.
     * @default 60_000
     */
    toolTimeoutMs?: number;
    /**
     * Logger — receives `debug`, `info`, `warn`, `error` messages.
     */
    logger?: {
        debug?(msg: string, ctx?: unknown): void;
        info?(msg: string, ctx?: unknown): void;
        warn?(msg: string, ctx?: unknown): void;
        error?(msg: string, ctx?: unknown): void;
    };
}

// ── Tool descriptor builder ────────────────────────────────────────────────

function toolToMcpDescriptor(tool: Tool): MCPToolDescriptor {
    // Convert Zod schema → JSON Schema for MCP inputSchema
    let inputSchema: Record<string, unknown> | undefined;
    try {
        const shape = (tool.parameters as unknown as { shape?: Record<string, unknown> }).shape;
        if (shape) {
            // Build a minimal JSON Schema from the Zod shape descriptions
            const properties: Record<string, { type: string; description?: string }> = {};
            const required: string[] = [];
            for (const [key, zodField] of Object.entries(shape)) {
                const desc = (zodField as { description?: string }).description;
                const typeName: string =
                    (zodField as { _def?: { typeName?: string } })._def?.typeName ?? 'string';
                const jsType = typeName.startsWith('ZodNumber') ? 'number'
                    : typeName.startsWith('ZodBoolean') ? 'boolean'
                    : typeName.startsWith('ZodArray') ? 'array'
                    : typeName.startsWith('ZodObject') ? 'object'
                    : 'string';
                properties[key] = { type: jsType, ...(desc ? { description: desc } : {}) };
                // If not optional/nullable, mark as required
                if (!typeName.includes('Optional') && !typeName.includes('Nullable') &&
                    !(zodField as { isOptional?: () => boolean }).isOptional?.()) {
                    required.push(key);
                }
            }
            inputSchema = {
                type: 'object',
                properties,
                ...(required.length > 0 ? { required } : {}),
            };
        }
    } catch {
        // If schema introspection fails, omit inputSchema — tool still usable
    }
    return {
        name: tool.name,
        ...(tool.description !== undefined ? { description: tool.description } : {}),
        ...(inputSchema !== undefined ? { inputSchema } : {}),
    };
}

// ── Default ToolContext for MCP calls ──────────────────────────────────────

function buildToolContext(toolId: string, timeoutMs: number): ToolContext {
    return {
        toolId,
        agentId: 'mcp-server',
        sessionId: `mcp-${crypto.randomUUID()}`,
        timeoutMs,
        permissions: {
            allowNetwork: true,
            allowFileSystem: false,
            allowedPaths: [],
            allowedHosts: [],
            maxExecutionTimeMs: timeoutMs,
        },
    };
}

// ── HTTP helper ────────────────────────────────────────────────────────────

async function readBody(
    req: IncomingMessage,
    maxBytes: number,
): Promise<{ ok: true; data: string } | { ok: false; status: 400 | 413 }> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let aborted = false;

        req.on('data', (chunk: Buffer) => {
            if (aborted) return;
            total += chunk.length;
            if (total > maxBytes) {
                aborted = true;
                req.destroy();
                resolve({ ok: false, status: 413 });
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            if (aborted) return;
            resolve({ ok: true, data: Buffer.concat(chunks).toString('utf8') });
        });

        req.on('error', () => {
            if (!aborted) resolve({ ok: false, status: 400 });
        });
    });
}

function sendJson(res: ServerResponse, status: number, body: unknown, corsHeader?: string): void {
    const json = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(json),
        ...(corsHeader ? { 'access-control-allow-origin': corsHeader } : {}),
    });
    res.end(json);
}

// ── McpHttpServer ──────────────────────────────────────────────────────────

/**
 * HTTP JSON-RPC 2.0 server that exposes a `ToolRegistry` via MCP.
 * Implements `MCPServerAdapter`.
 */
export class McpHttpServer implements MCPServerAdapter {
    private readonly registry: ToolRegistry;
    private readonly opts: Required<
        Pick<McpServerOptions, 'name' | 'version' | 'port' | 'host' | 'path' | 'maxBodyBytes' | 'toolTimeoutMs'>
    > & McpServerOptions;
    private httpServer: Server | undefined;

    constructor(registry: ToolRegistry, opts: McpServerOptions = {}) {
        this.registry = registry;
        this.opts = {
            name: opts.name ?? 'personaforge-mcp',
            version: opts.version ?? '1.0.0',
            port: opts.port ?? 3100,
            host: opts.host ?? '127.0.0.1',
            path: opts.path ?? '/mcp',
            maxBodyBytes: opts.maxBodyBytes ?? 1_048_576,
            toolTimeoutMs: opts.toolTimeoutMs ?? 60_000,
            cors: opts.cors !== undefined ? opts.cors : '*',
            ...(opts.auth !== undefined ? { auth: opts.auth } : {}),
            ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
        };
    }

    registerTool(tool: Tool): void {
        this.registry.register(tool);
    }

    async start(): Promise<void> {
        if (this.httpServer) return; // already started
        return new Promise((resolve, reject) => {
            const server = createServer((req, res) => {
                void this.handleRequest(req, res).catch((err: unknown) => {
                    this.opts.logger?.error?.('McpHttpServer: unhandled error', err);
                    if (!res.headersSent) res.writeHead(500).end();
                });
            });
            server.on('error', reject);
            server.listen(this.opts.port, this.opts.host, () => {
                this.opts.logger?.info?.(
                    `McpHttpServer: listening on http://${this.opts.host}:${this.opts.port}${this.opts.path}`
                );
                this.httpServer = server;
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        const server = this.httpServer;
        if (!server) return;
        this.httpServer = undefined;
        return new Promise((resolve, reject) => {
            server.close((err) => { if (err) reject(err); else resolve(); });
        });
    }

    // ── CORS origin header ────────────────────────────────────────────────

    private corsHeader(req: IncomingMessage): string | undefined {
        const cors = this.opts.cors;
        if (!cors) return undefined;
        if (cors === '*') return '*';
        const origin = req.headers['origin'] ?? '';
        return cors.includes(origin) ? origin : undefined;
    }

    // ── Request dispatch ──────────────────────────────────────────────────

    private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const corsOrigin = this.corsHeader(req);

        // Handle preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                ...(corsOrigin ? {
                    'access-control-allow-origin': corsOrigin,
                    'access-control-allow-methods': 'POST',
                    'access-control-allow-headers': 'content-type, authorization, x-api-key',
                } : {}),
            });
            res.end();
            return;
        }

        // Only accept POST
        if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' }).end();
            return;
        }

        // Path check
        const urlPath = req.url?.split('?')[0] ?? '/';
        if (urlPath !== this.opts.path) {
            res.writeHead(404).end();
            return;
        }

        // Auth
        if (!checkAuth(req, this.opts.auth)) {
            res.writeHead(401, {
                'www-authenticate': 'Bearer realm="mcp"',
                ...(corsOrigin ? { 'access-control-allow-origin': corsOrigin } : {}),
            }).end('Unauthorized');
            return;
        }

        // Read body
        const bodyResult = await readBody(req, this.opts.maxBodyBytes);
        if (!bodyResult.ok) {
            res.writeHead(bodyResult.status).end();
            return;
        }

        // Parse JSON
        let parsed: unknown;
        try {
            parsed = JSON.parse(bodyResult.data);
        } catch {
            sendJson(res, 400, rpcError(null, ERR_PARSE, 'Parse error'), corsOrigin);
            return;
        }

        // Reject batch requests
        if (Array.isArray(parsed)) {
            sendJson(
                res,
                400,
                rpcError(null, ERR_INVALID_REQ, 'Batch requests are not supported'),
                corsOrigin,
            );
            return;
        }

        // Validate JSON-RPC shape
        const req2 = parsed as Partial<JsonRpcRequest>;
        if (req2.jsonrpc !== '2.0' || typeof req2.method !== 'string') {
            sendJson(res, 400, rpcError(req2.id ?? null, ERR_INVALID_REQ, 'Invalid Request'), corsOrigin);
            return;
        }

        const id: string | number | null = req2.id ?? null;
        const method = req2.method;
        const params = req2.params;

        this.opts.logger?.debug?.(`McpHttpServer: method=${method}`, { id });

        // Notifications (no id) — don't send response
        if (req2.id === undefined && method.startsWith('notifications/')) {
            res.writeHead(204).end();
            return;
        }

        const response = await this.dispatch(id, method, params);
        sendJson(res, 200, response, corsOrigin);
    }

    // ── Method dispatch ───────────────────────────────────────────────────

    private async dispatch(
        id: string | number | null,
        method: string,
        params: unknown,
    ): Promise<JsonRpcResponse> {
        switch (method) {
            case 'initialize':
                return this.handleInitialize(id);

            case 'tools/list':
                return this.handleToolsList(id);

            case 'tools/call':
                return await this.handleToolsCall(id, params);

            case 'ping':
                return success(id, {});

            default:
                return rpcError(id, ERR_METHOD_NOT_FOUND, `Method not found: ${method}`);
        }
    }

    // ── Handlers ──────────────────────────────────────────────────────────

    private handleInitialize(id: string | number | null): JsonRpcSuccess {
        return success(id, {
            protocolVersion: '2024-11-05',
            serverInfo: { name: this.opts.name, version: this.opts.version },
            capabilities: {
                tools: { listChanged: false },
            },
        });
    }

    private handleToolsList(id: string | number | null): JsonRpcSuccess {
        const tools = this.registry.list();
        const descriptors = tools.map(toolToMcpDescriptor);
        return success(id, { tools: descriptors });
    }

    private async handleToolsCall(
        id: string | number | null,
        params: unknown,
    ): Promise<JsonRpcResponse> {
        // Validate params shape
        if (!params || typeof params !== 'object' || Array.isArray(params)) {
            return rpcError(id, ERR_INVALID_PARAMS, 'params must be an object');
        }
        const p = params as Record<string, unknown>;
        const toolName = p['name'];
        if (typeof toolName !== 'string' || toolName.trim() === '') {
            return rpcError(id, ERR_INVALID_PARAMS, 'params.name is required');
        }
        const toolArgs = (p['arguments'] ?? {}) as Record<string, unknown>;

        // Lookup tool by name
        const tool = this.registry.getByName(toolName);
        if (!tool) {
            return rpcError(id, ERR_INVALID_PARAMS, `Tool not found: ${toolName}`);
        }

        // Validate input
        if (!tool.validate(toolArgs)) {
            return rpcError(id, ERR_INVALID_PARAMS, `Invalid arguments for tool: ${toolName}`);
        }

        // Execute with timeout
        const timeoutMs = this.opts.toolTimeoutMs;
        const ctx = buildToolContext(tool.id, timeoutMs);

        let execResult;
        try {
            let mcpTimer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<never>((_, reject) => {
                mcpTimer = setTimeout(
                    () => { reject(new Error(`Tool ${toolName} timed out after ${timeoutMs}ms`)); },
                    timeoutMs,
                );
            });
            execResult = await Promise.race([tool.execute(toolArgs, ctx), timeout]).finally(() => {
                if (mcpTimer !== undefined) { clearTimeout(mcpTimer); }
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Internal error';
            this.opts.logger?.error?.(`McpHttpServer: tool "${toolName}" threw`, { err });
            return rpcError(id, ERR_INTERNAL, msg);
        }

        if (!execResult.success) {
            const errMsg = execResult.error?.message ?? 'Tool execution failed';
            return rpcError(id, ERR_INTERNAL, errMsg);
        }

        // Return MCP content array format
        const content = [
            {
                type: 'text',
                text: typeof execResult.data === 'string'
                    ? execResult.data
                    : JSON.stringify(execResult.data),
            },
        ];
        return success(id, { content, isError: false });
    }

    /**
     * Return the base URL the server is listening on.
     * Only available after `start()` is called.
     */
    get baseUrl(): string {
        return `http://${this.opts.host}:${this.opts.port}${this.opts.path}`;
    }
}

// ── Factory function ───────────────────────────────────────────────────────

/**
 * Create an MCP HTTP server that exposes a `ToolRegistry` to external MCP clients.
 *
 * @param registry — The tool registry to expose. Call `.start()` on the returned server to begin serving.
 * @param opts      — Server configuration (port, auth, CORS, etc.)
 *
 * @example
 * ```ts
 * const server = createMcpServer(myRegistry, {
 *   port: 3100,
 *   auth: { type: 'bearer', token: process.env['MCP_TOKEN']! },
 * });
 * await server.start();
 * console.log(server.baseUrl); // http://127.0.0.1:3100/mcp
 * ```
 */
export function createMcpServer(
    registry: ToolRegistry,
    opts?: McpServerOptions,
): McpHttpServer {
    return new McpHttpServer(registry, opts);
}
