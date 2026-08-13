/**
 * Model Context Protocol (MCP) — HTTP JSON-RPC client and tool adapters.
 * Connects to remote tool servers and exposes their tools to the agent registry.
 */

import { z } from 'zod';
import type { MCPClient, MCPToolDescriptor } from './_mcp-types.js';
import { BaseTool, type BaseToolConfig } from '../core/base-tool.js';
import type { Tool, ToolParameters } from '../core/types.js';
import { ToolCategory } from '../core/types.js';
import { detectPromptInjection } from '../../guardrails/injection.js';

const JsonRpcRequestSchema = z.object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]),
    result: z.unknown().optional(),
    error: z
        .object({
            code: z.number(),
            message: z.string(),
            data: z.unknown().optional(),
        })
        .optional(),
});

export interface HttpMcpClientOptions {
    /** Base URL of the MCP HTTP endpoint (e.g. https://api.example.com/mcp) */
    url: string;
    headers?: Record<string, string>;
    /** Request timeout in ms (default: 60_000) */
    timeoutMs?: number;
}

/**
 * JSON-RPC 2.0 over HTTP. Compatible with many hosted MCP HTTP transports.
 */
export class HttpMcpClient implements MCPClient {
    private readonly url: string;
    private readonly headers: Record<string, string>;
    private readonly timeoutMs: number;
    private idCounter = 0;

    constructor(options: HttpMcpClientOptions) {
        this.url = options.url.replace(/\/$/, '');
        this.headers = { 'content-type': 'application/json', ...options.headers };
        this.timeoutMs = options.timeoutMs ?? 60_000;
    }

    private nextId(): number {
        this.idCounter += 1;
        return this.idCounter;
    }

    private async rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
        const controller = new AbortController();
        const t = setTimeout(() => { controller.abort(); }, this.timeoutMs);
        let body: unknown;
        try {
            const res = await fetch(this.url, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: this.nextId(),
                    method,
                    params,
                }),
                signal: controller.signal,
            });
            body = await res.json();
        } finally {
            clearTimeout(t);
        }

        const parsed = JsonRpcRequestSchema.safeParse(body);
        if (!parsed.success) {
            throw new Error(`MCP: invalid JSON-RPC response: ${JSON.stringify(body)}`);
        }
        if (parsed.data.error) {
            throw new Error(`MCP error ${parsed.data.error.code}: ${parsed.data.error.message}`);
        }
        if (parsed.data.result === undefined) {
            throw new Error('MCP: missing result in JSON-RPC response');
        }
        return parsed.data.result as T;
    }

    async listTools(): Promise<MCPToolDescriptor[]> {
        const result = await this.rpc<{ tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }>(
            'tools/list'
        );
        const tools = result.tools ?? [];
        return tools.map((t): MCPToolDescriptor => ({
            name: t.name,
            ...(t.description !== undefined ? { description: t.description } : {}),
            ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
        }));
    }

    async callTool(
        name: string,
        args: Record<string, unknown>
    ): Promise<{ content: Array<{ type: string; text?: string }> }> {
        return this.rpc('tools/call', { name, arguments: args });
    }

    async getTools(): Promise<Tool[]> {
        const descriptors = await this.listTools();
        return descriptors.map((d) => new McpBridgeTool(d, this));
    }
}

/** Open object: model tool-call args are forwarded to MCP as-is. */
const McpOpenArgsSchema = z.record(z.string(), z.unknown()) as unknown as ToolParameters;
type McpOpenArgs = z.infer<typeof McpOpenArgsSchema>;

/**
 * Wraps a single remote MCP tool as a framework `Tool`.
 */
class McpBridgeTool extends BaseTool<ToolParameters, string> {
    private readonly client: HttpMcpClient;
    private readonly mcpName: string;

    constructor(descriptor: MCPToolDescriptor, client: HttpMcpClient) {
        const params: BaseToolConfig<ToolParameters> = {
            name: descriptor.name.replace(/[^a-zA-Z0-9_-]/g, '_'),
            description: descriptor.description ?? `MCP tool: ${descriptor.name}`,
            parameters: McpOpenArgsSchema,
            category: ToolCategory.API,
        };
        super(params);
        this.mcpName = descriptor.name;
        this.client = client;
    }

    /**
     * SECURITY — UNTRUSTED OUTPUT.
     *
     * The string returned here is the raw response of a **remote** MCP tool and
     * is concatenated into the agent's context. It must be treated as untrusted:
     * a malicious or compromised MCP server can return tool-poisoning / indirect
     * prompt-injection payloads (OWASP LLM01). Do NOT assume it is safe to act on.
     *
     * Mitigation: every tool result is scanned with `detectPromptInjection()`
     * before it reaches the model. Suspicious payloads are surfaced with an
     * explicit UNTRUSTED tag so the model is warned rather than silently
     * following injected instructions. For stronger guarantees, configure the
     * framework guardrail engine (`src/guardrails`) with an output rule
     * (`createPromptInjectionRule`) and a fail-closed severity.
     */
    protected async performExecute(params: McpOpenArgs): Promise<string> {
        const args = params as Record<string, unknown>;
        const out = await this.client.callTool(this.mcpName, args);
        // UNTRUSTED: remote MCP tool output — see security note above.
        const text = (out.content ?? [])
            .map((c) => (c.type === 'text' && c.text ? c.text : JSON.stringify(c)))
            .join('\n');
        return this._scanUntrustedOutput(text);
    }

    /**
     * Scan untrusted MCP tool output for prompt-injection patterns.
     * Returns the original text, prefixed with a warning tag when a payload is
     * detected so the model treats the content as untrusted instructions.
     */
    private _scanUntrustedOutput(text: string): string {
        if (!text) return text;
        const result = detectPromptInjection(text, { threshold: 0.6 });
        if (!result.detected) return text;
        const signals = result.signals.map((s) => `${s.pattern}(${s.match.slice(0, 60)})`).join(', ');
        return `[UNTRUSTED: possible prompt injection (score ${result.score.toFixed(2)}; ${signals})]\n${text}`;
    }
}

/**
 * Shorthand: create a client and return framework `Tool` instances.
 */
export async function loadMcpToolsFromUrl(url: string, headers?: Record<string, string>): Promise<Tool[]> {
    const client = new HttpMcpClient({ url, ...(headers !== undefined && { headers }) });
    return client.getTools();
}
