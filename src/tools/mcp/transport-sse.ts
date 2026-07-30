/**
 * MCP Streamable HTTP + SSE Transport
 *
 * Implements the Model Context Protocol 2024-11-05 "Streamable HTTP" transport:
 *   - POST /mcp  → single JSON-RPC request (or batch) → JSON or SSE stream response
 *   - GET  /mcp  → SSE subscription for server-initiated notifications
 *
 * Also provides an SSE-capable MCP client that handles both response types
 * (immediate JSON and server-sent event streams).
 *
 * Reference: https://modelcontextprotocol.io/specification/2024-11-05/basic/transports
 */

import type { Tool } from '../core/types.js';
import type { MCPClient, MCPToolDescriptor } from './_mcp-types.js';
import { BaseTool, type BaseToolConfig } from '../core/base-tool.js';
import { ToolCategory } from '../core/types.js';
import type { ToolParameters } from '../core/types.js';
import { z } from 'zod';

// ── Types ──────────────────────────────────────────────────────────────────

export interface McpStreamableOptions {
    /** Endpoint URL, e.g. https://api.example.com/mcp */
    url: string;
    headers?: Record<string, string>;
    /** Timeout for non-streaming requests in ms (default: 60 000) */
    timeoutMs?: number;
    /**
     * Whether to prefer SSE streaming for responses.
     * When true, the client sends `Accept: text/event-stream` and parses
     * server-sent events.  Default: true.
     */
    preferStreaming?: boolean;
}

export interface McpNotification {
    method: string;
    params?: unknown;
}

export type NotificationHandler = (notification: McpNotification) => void | Promise<void>;

// ── SSE parser ─────────────────────────────────────────────────────────────

async function* parseSseStream(
    stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    yield line.slice(6).trim();
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

// ── Client ─────────────────────────────────────────────────────────────────

/**
 * MCP client using the Streamable HTTP transport (MCP 2024-11-05 spec).
 *
 * Differences from `HttpMcpClient`:
 *  - Sends `Accept: application/json, text/event-stream` and handles both.
 *  - Supports `notifications/` subscribe callbacks.
 *  - Sends `mcp-session-id` header once session is established.
 *  - Exposes `listResources`, `readResource`, `listPrompts`, `getPrompt`.
 */
export class StreamableMcpClient implements MCPClient {
    private readonly url: string;
    private readonly baseHeaders: Record<string, string>;
    private readonly timeoutMs: number;
    private readonly preferStreaming: boolean;
    private sessionId: string | undefined;
    private idCounter = 0;
    private notificationHandlers: NotificationHandler[] = [];

    constructor(options: McpStreamableOptions) {
        this.url = options.url.replace(/\/$/, '');
        this.baseHeaders = { 'content-type': 'application/json', ...options.headers };
        this.timeoutMs = options.timeoutMs ?? 60_000;
        this.preferStreaming = options.preferStreaming ?? true;
    }

    private nextId(): number {
        this.idCounter += 1;
        return this.idCounter;
    }

    private buildHeaders(): Record<string, string> {
        const h: Record<string, string> = { ...this.baseHeaders };
        if (this.preferStreaming) {
            h['accept'] = 'application/json, text/event-stream';
        }
        if (this.sessionId) {
            h['mcp-session-id'] = this.sessionId;
        }
        return h;
    }

    /** Emit a notification to all registered handlers */
    private async emitNotification(raw: string): Promise<void> {
        try {
            const msg = JSON.parse(raw) as { method?: string; params?: unknown };
            if (!msg.method) return;
            const notification: McpNotification = { method: msg.method, params: msg.params };
            for (const h of this.notificationHandlers) {
                await h(notification);
            }
        } catch { /* ignore malformed notifications */ }
    }

    /** Register a handler for server-side notifications */
    onNotification(handler: NotificationHandler): () => void {
        this.notificationHandlers.push(handler);
        return () => {
            this.notificationHandlers = this.notificationHandlers.filter(h => h !== handler);
        };
    }

    /**
     * Send a JSON-RPC request, handle both plain JSON and SSE stream responses.
     * Returns the `result` field on success.
     */
    private async rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(); }, this.timeoutMs);
        const id = this.nextId();

        try {
            const res = await fetch(this.url, {
                method: 'POST',
                headers: this.buildHeaders(),
                body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
                signal: controller.signal,
            });

            // Capture session ID on first response
            const newSession = res.headers.get('mcp-session-id');
            if (newSession && !this.sessionId) {
                this.sessionId = newSession;
            }

            if (!res.ok) {
                throw new Error(`MCP HTTP ${res.status}: ${await res.text()}`);
            }

            const contentType = res.headers.get('content-type') ?? '';

            // ── SSE stream response ────────────────────────────────────────
            if (contentType.includes('text/event-stream') && res.body) {
                for await (const data of parseSseStream(res.body)) {
                    if (!data) continue;
                    let msg: { id?: unknown; result?: unknown; error?: { code: number; message: string }; method?: string };
                    try { msg = JSON.parse(data) as typeof msg; } catch { continue; }

                    if (msg.method) {
                        // It's a server notification embedded in the stream
                        await this.emitNotification(data);
                        continue;
                    }
                    if (msg.id === id) {
                        if (msg.error) throw new Error(`MCP ${msg.error.code}: ${msg.error.message}`);
                        return msg.result as T;
                    }
                }
                throw new Error('MCP: SSE stream ended without matching response');
            }

            // ── Plain JSON response ────────────────────────────────────────
            const body = await res.json() as { id?: unknown; result?: unknown; error?: { code: number; message: string } };
            if (body.error) throw new Error(`MCP ${body.error.code}: ${body.error.message}`);
            return body.result as T;
        } finally {
            clearTimeout(timer);
        }
    }

    /** Initialize session (handshake) */
    async initialize(clientInfo?: { name: string; version: string }): Promise<{
        protocolVersion: string;
        capabilities: Record<string, unknown>;
        serverInfo: { name: string; version: string };
    }> {
        return this.rpc('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: { roots: { listChanged: true } },
            clientInfo: clientInfo ?? { name: 'agent-framework', version: '1.0.0' },
        });
    }

    async listTools(): Promise<MCPToolDescriptor[]> {
        const result = await this.rpc<{
            tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
        }>('tools/list');
        return (result.tools ?? []).map((t): MCPToolDescriptor => ({
            name: t.name,
            ...(t.description !== undefined ? { description: t.description } : {}),
            ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
        }));
    }

    async callTool(name: string, args: Record<string, unknown>): Promise<{
        content: Array<{ type: string; text?: string }>;
        isError?: boolean;
    }> {
        return this.rpc('tools/call', { name, arguments: args });
    }

    // ── Resources ──────────────────────────────────────────────────────────

    async listResources(cursor?: string): Promise<{
        resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
        nextCursor?: string;
    }> {
        return this.rpc('resources/list', cursor ? { cursor } : undefined);
    }

    async readResource(uri: string): Promise<{
        contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
    }> {
        return this.rpc('resources/read', { uri });
    }

    async subscribeResource(uri: string): Promise<void> {
        await this.rpc('resources/subscribe', { uri });
    }

    async unsubscribeResource(uri: string): Promise<void> {
        await this.rpc('resources/unsubscribe', { uri });
    }

    async listResourceTemplates(): Promise<{
        resourceTemplates: Array<{
            uriTemplate: string;
            name: string;
            description?: string;
            mimeType?: string;
        }>;
    }> {
        return this.rpc('resources/templates/list');
    }

    // ── Prompts ────────────────────────────────────────────────────────────

    async listPrompts(cursor?: string): Promise<{
        prompts: Array<{
            name: string;
            description?: string;
            arguments?: Array<{ name: string; description?: string; required?: boolean }>;
        }>;
        nextCursor?: string;
    }> {
        return this.rpc('prompts/list', cursor ? { cursor } : undefined);
    }

    async getPrompt(name: string, args?: Record<string, string>): Promise<{
        description?: string;
        messages: Array<{
            role: 'user' | 'assistant';
            content: { type: string; text?: string };
        }>;
    }> {
        return this.rpc('prompts/get', { name, arguments: args ?? {} });
    }

    // ── Completions (autocomplete) ─────────────────────────────────────────

    async complete(ref: { type: 'ref/prompt' | 'ref/resource'; name?: string; uri?: string }, argument: { name: string; value: string }): Promise<{
        completion: { values: string[]; total?: number; hasMore?: boolean };
    }> {
        return this.rpc('completion/complete', { ref, argument });
    }

    // ── Convenience: get framework Tool wrappers ───────────────────────────

    async getTools(): Promise<Tool[]> {
        const descriptors = await this.listTools();
        return descriptors.map(d => new StreamableMcpBridgeTool(d, this));
    }

    async disconnect(): Promise<void> {
        if (!this.sessionId) return;
        try {
            await fetch(this.url, {
                method: 'DELETE',
                headers: this.buildHeaders(),
            });
        } catch { /* best-effort */ }
        this.sessionId = undefined;
    }

    /**
     * Open a persistent GET SSE channel for server-pushed notifications.
     * Returns a cleanup function.
     */
    openNotificationChannel(): () => void {
        const controller = new AbortController();
        const headers = { ...this.buildHeaders(), accept: 'text/event-stream' };

        const run = async () => {
            try {
                const res = await fetch(this.url, { method: 'GET', headers, signal: controller.signal });
                if (!res.ok || !res.body) return;
                for await (const data of parseSseStream(res.body)) {
                    if (controller.signal.aborted) break;
                    await this.emitNotification(data);
                }
            } catch { /* aborted or connection closed */ }
        };
        void run();
        return () => { controller.abort(); };
    }
}

// ── Bridge tool ────────────────────────────────────────────────────────────

const McpOpenArgsSchema = z.record(z.string(), z.unknown()) as unknown as ToolParameters;
type McpOpenArgs = z.infer<typeof McpOpenArgsSchema>;

class StreamableMcpBridgeTool extends BaseTool<ToolParameters, string> {
    private readonly client: StreamableMcpClient;
    private readonly mcpName: string;

    constructor(descriptor: MCPToolDescriptor, client: StreamableMcpClient) {
        const config: BaseToolConfig<ToolParameters> = {
            name: descriptor.name.replace(/[^a-zA-Z0-9_-]/g, '_'),
            description: descriptor.description ?? `MCP tool: ${descriptor.name}`,
            parameters: McpOpenArgsSchema,
            category: ToolCategory.API,
        };
        super(config);
        this.mcpName = descriptor.name;
        this.client = client;
    }

    protected async performExecute(params: McpOpenArgs): Promise<string> {
        const args = params as Record<string, unknown>;
        const out = await this.client.callTool(this.mcpName, args);
        return (out.content ?? [])
            .map(c => c.type === 'text' && c.text ? c.text : JSON.stringify(c))
            .join('\n');
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create an initialized `StreamableMcpClient` and return it along with
 * framework `Tool` wrappers for all tools the server advertises.
 */
export async function connectMcpServer(
    url: string,
    options?: Omit<McpStreamableOptions, 'url'>,
): Promise<{ client: StreamableMcpClient; tools: Tool[] }> {
    const client = new StreamableMcpClient({ url, ...options });
    await client.initialize();
    const tools = await client.getTools();
    return { client, tools };
}
