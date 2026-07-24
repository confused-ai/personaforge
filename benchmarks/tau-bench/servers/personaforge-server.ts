/**
 * Reference personaforge server for the cross-framework τ-bench protocol.
 * See `benchmarks/tau-bench/PROTOCOL.md`.
 *
 * Run:
 *   OPENAI_API_KEY=... bun benchmarks/tau-bench/servers/personaforge-server.ts
 *   # then the harness can point at http://localhost:8811
 */

import { serve } from 'bun';
import { z } from 'zod/v3';
import { OpenAIProvider } from '../../../src/providers/index.js';
import { AgenticRunner } from '../../../src/agentic/runner.js';
import { tool } from '../../../src/tools/core/tool-helper.js';
import type { Tool, ToolRegistry } from '../../../src/core/index.js';

const PORT = Number(process.env['PF_BENCH_PORT'] ?? 8811);
const MODEL = process.env['PF_IT_OPENAI_MODEL'] ?? process.env['OPENAI_MODEL'] ?? 'gpt-4o-mini';
const BASE_URL = process.env['PF_IT_OPENAI_BASE_URL'];

interface ProtocolTool {
    name: string;
    description: string;
    parameters?: { type?: string; properties?: Record<string, { type?: string }>; required?: string[] };
}

interface RunReq {
    instruction: string;
    tools: ProtocolTool[];
    maxSteps?: number;
}

// Build stub tools from JSON-schema descriptors — each tool records its args
// and returns an echo. Verifiers only care about the arguments the agent
// chose, so tool implementations are deliberately opaque and identical across
// frameworks.
function stubFromDescriptor(d: ProtocolTool, sink: Array<{ name: string; arguments: Record<string, unknown>; result: unknown }>): Tool {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [k, v] of Object.entries(d.parameters?.properties ?? {})) {
        // Best-effort JSON-schema → zod. Strings and numbers cover our task set;
        // fall back to unknown for anything else.
        shape[k] = v.type === 'number' ? z.number().optional() : z.string().optional();
    }
    return tool({
        name: d.name,
        description: d.description,
        parameters: z.object(shape),
        execute: async (args: Record<string, unknown>) => {
            const result = { ok: true, echoed: args };
            sink.push({ name: d.name, arguments: args, result });
            return result;
        },
    }) as unknown as Tool;
}

function registryFrom(tools: Tool[]): ToolRegistry {
    const map = new Map(tools.map((t) => [t.name, t]));
    return {
        register: () => undefined,
        unregister: () => undefined,
        get: (id: string) => map.get(id),
        getByName: (n: string) => map.get(n),
        list: () => tools,
        listByCategory: () => tools,
        search: () => tools,
        has: (id: string) => map.has(id),
    } as unknown as ToolRegistry;
}

const llm = new OpenAIProvider({
    apiKey: process.env['OPENAI_API_KEY']!,
    model: MODEL,
    ...(BASE_URL ? { baseURL: BASE_URL } : {}),
});

serve({
    port: PORT,
    fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname !== '/tau-bench/run' || req.method !== 'POST') {
            return new Response('not found', { status: 404 });
        }
        try {
            const body = (await req.json()) as RunReq;
            const sink: Array<{ name: string; arguments: Record<string, unknown>; result: unknown }> = [];
            const tools = body.tools.map((d) => stubFromDescriptor(d, sink));
            const started = performance.now();
            const res = await new AgenticRunner({
                llm,
                tools: registryFrom(tools),
                maxSteps: body.maxSteps ?? 8,
                timeoutMs: 90_000,
                retry: { maxRetries: 0 },
            }).run({ instructions: body.instruction, prompt: body.instruction });
            return Response.json({
                framework: 'personaforge',
                text: res.text,
                toolCalls: sink,
                steps: res.steps,
                finishReason: res.finishReason,
                usage: res.usage,
                durationMs: performance.now() - started,
            });
        } catch (err) {
            return Response.json(
                { error: err instanceof Error ? err.message : String(err) },
                { status: 500 },
            );
        }
    },
});

// eslint-disable-next-line no-console
console.log(`personaforge τ-bench server listening on http://localhost:${PORT}`);
