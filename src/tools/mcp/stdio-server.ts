/**
 * Minimal MCP **stdio** server for exposing {@link Tool}s (JSON-RPC one line per message).
 *
 * Implements a small subset: `initialize`, `tools/list`, `tools/call`, `ping`.
 * Not a full MCP compliance suite; validate against your MCP client version.
 */

import { createInterface } from 'node:readline';
import type { ZodType } from 'zod';
import type { Tool } from '../core/types.js';
import type { ToolContext } from '../core/types.js';
import { zodToJsonSchema } from '../core/zod-to-schema.js';

/**
 * Build the execution context for a tool invoked over stdio.
 *
 * SECURITY: do NOT blanket-grant network + filesystem to every tool. Each tool
 * only receives the capabilities it explicitly declares in its own
 * `permissions` (per-tool opt-in). A tool that does not request network/FS
 * access cannot obtain it via the gateway.
 */
function gatewayCtx(tool: Tool): ToolContext {
    return {
        toolId: tool.id,
        agentId: 'mcp-stdio',
        sessionId: 'mcp-stdio',
        permissions: {
            allowNetwork: tool.permissions?.allowNetwork ?? false,
            allowFileSystem: tool.permissions?.allowFileSystem ?? false,
            maxExecutionTimeMs: tool.permissions?.maxExecutionTimeMs ?? 120_000,
        },
    };
}

export interface McpStdioServerInfo {
    readonly name: string;
    readonly version: string;
}

/**
 * Process one JSON-RPC line; returns a response line or `null` (e.g. notifications).
 */
export async function handleMcpStdioLine(
    line: string,
    tools: Tool[],
    serverInfo: McpStdioServerInfo
): Promise<string | null> {
    const byName = new Map(tools.map((t) => [t.name, t]));
    const msg = JSON.parse(line) as {
        jsonrpc?: string;
        id?: string | number | null;
        method?: string;
        params?: unknown;
    };

    if (msg.jsonrpc !== '2.0') {
        return JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id ?? null,
            error: { code: -32600, message: 'Invalid Request' },
        });
    }

    const id = msg.id;
    const method = msg.method;

    if (method === 'initialize') {
        return JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: serverInfo.name, version: serverInfo.version },
            },
        });
    }

    if (method === 'notifications/initialized' || method === 'initialized') {
        return null;
    }

    if (method === 'tools/list') {
        const list = tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: zodToJsonSchema(t.parameters as ZodType),
        }));
        return JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: { tools: list },
        });
    }

    if (method === 'tools/call') {
        const p = msg.params as { name?: string; arguments?: Record<string, unknown> };
        const toolName = p?.name;
        if (!toolName) {
            return JSON.stringify({
                jsonrpc: '2.0',
                id,
                error: { code: -32602, message: 'Missing tool name' },
            });
        }
        const tool = byName.get(toolName);
        if (!tool) {
            return JSON.stringify({
                jsonrpc: '2.0',
                id,
                error: { code: -32602, message: `Unknown tool: ${toolName}` },
            });
        }
        const args = p.arguments && typeof p.arguments === 'object' ? p.arguments : {};
        const res = await tool.execute(args, gatewayCtx(tool));
        const text = res.success ? JSON.stringify(res.data ?? {}) : (res.error?.message ?? 'Tool failed');
        return JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
                content: [{ type: 'text', text }],
                isError: !res.success,
            },
        });
    }

    if (method === 'ping') {
        return JSON.stringify({ jsonrpc: '2.0', id, result: {} });
    }

    return JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: method ? `Method not found: ${method}` : 'Missing method' },
    });
}

/**
 * Read stdin line-by-line and write JSON-RPC responses to stdout until stdin closes.
 */
export async function runMcpStdioToolServer(
    tools: Tool[],
    options?: Partial<McpStdioServerInfo>
): Promise<void> {
    const serverInfo: McpStdioServerInfo = {
        name: options?.name ?? 'personaforge-mcp',
        version: options?.version ?? '0.6.0',
    };
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        let parsedId: string | number | null = null;
        try {
            parsedId = (JSON.parse(trimmed) as { id?: string | number | null }).id ?? null;
            const reply = await handleMcpStdioLine(trimmed, tools, serverInfo);
            if (reply) {
                process.stdout.write(`${reply}\n`);
            }
        } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            process.stdout.write(
                `${JSON.stringify({
                    jsonrpc: '2.0',
                    id: parsedId,
                    error: { code: -32603, message: err },
                })}\n`
            );
        }
    }
}
